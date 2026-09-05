// 일정 임박 알림 cron (N+63 · 2026-09-05 전면 수정)
//
// Irene: "일정도 알림 있어야 하지 않아? … 당사자들은 일정을 알게 알림 보내야지."
//   기능은 있었는데 **운영에서 한 번도 나간 적이 없다**(Fable 실측: event 알림 0건,
//   크론 로그 `sent=0, skipped=3` 반복). 아래 다섯 가지가 겹쳐 있었다.
//
// ① **한 번 놓치면 영영 안 갔다.** 발송 시점이 "직전 5분 창" 안일 때만 보내고, 벗어나면
//    `reminder_sent_at` 도 안 찍고 넘어갔다 → 다음 회차엔 더 과거라 **영구 skip**.
//    배포·재시작 한 번이면 그 일정의 알림이 사라진다(하루에 pm2 가 5번 재시작되는 날도 있다).
//    → **발송 시각이 지났고 아직 시작 전이면 늦게라도 보낸다.** 중복은 reminder_sent_at 이 막는다.
//      늦은 알림이 무알림보다 낫다 — 상한을 두지 않는다.
// ② **"1440분 전 알림"** 이라고 나갔다. 기본값을 1일 전으로 켜면 전원이 이 문구를 받는다.
//    → 사람 말로("1일 전"·"1시간 전"), 수신자 언어로.
// ③ **워크스페이스 시간대가 항상 무시됐다.** `attributes` 에 `timezone` 을 안 넣고 `biz.timezone`
//    을 읽어 늘 undefined → 항상 Asia/Seoul. 해외 워크스페이스는 틀린 시각을 받았다.
// ④ **종일 일정** 을 안 봤다. 종일은 시작이 그날 0시라 "1일 전"이 **전날 자정**이 된다(자는 시간).
//    → 종일은 기준점을 **시작일 09:00(워크스페이스 시간대)** 으로 잡는다.
// ⑤ **반복 일정은 첫 회차조차 못 받았다.** 마스터 1행 + `start_at`=첫 회차인데 크론이
//    `start_at > now` 로 걸러 마스터가 후보에서 통째로 빠졌다.
//    → 마스터는 rrule 로 **다음 회차**를 구해 그 시각 기준으로 계산한다.
//      `reminder_sent_at < 그 회차의 발송시각` 이면 다시 보낸다 — 컬럼 하나로 회차가 구분된다
//      (직전 회차의 발송 시각은 언제나 다음 회차의 발송 시각보다 앞선다).
//
// 수신자 = **생성자 ∪ 멤버 attendee(declined 제외) ∪ target_member_ids(지정 멤버)**.
//   프로젝트 멤버 자동 포함은 하지 않는다 — 프로젝트에 걸린 개인 일정까지 전원 푸시가 되면 소음이다.
//   고객(client) attendee 는 아직 제외 — notify 대상 userId 가 없다(초대 메일 경로는 별건).
//
// notifyMany 가 NotificationPref event_kind='event' 를 보므로 사용자가 끄면 자동 차단된다.

const cron = require('node-cron');
const { Op } = require('sequelize');
const { CalendarEvent, CalendarEventAttendee, Business } = require('../models');
const { filterWorkspaceMemberIds } = require('../middleware/access_scope');

/**
 * 사람 말로 — "1440분 전" 같은 기계 말을 내보내지 않는다.
 * @param {boolean} allDay 종일 일정은 기준이 시작일 09:00 이라, 하루 안쪽(540분 미만) 설정은
 *   "1분 전" 이 아니라 **"당일 아침"** 이다. 화면 옵션 라벨("당일 아침 (오전 9시)")과 같은 말을 쓴다.
 */
function humanizeLead(minutes, lang = 'ko', allDay = false) {
  const en = lang === 'en';
  if (allDay && minutes < 1440) return en ? 'on the morning of' : '당일 아침';
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return en ? `${d} day${d > 1 ? 's' : ''} before` : `${d}일 전`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return en ? `${h} hour${h > 1 ? 's' : ''} before` : `${h}시간 전`;
  }
  return en ? `${minutes} minute${minutes > 1 ? 's' : ''} before` : `${minutes}분 전`;
}

/**
 * 이 일정의 **다음 발생 시각**. 반복이면 rrule 로 구한다(예외 날짜 제외).
 *   조회 라우트(routes/calendar.js)가 rrule 을 펼치는 것과 같은 뜻이어야 한다 —
 *   여기서만 다르게 계산하면 화면에 보이는 회차와 알림이 갈린다.
 * @returns {Date|null} 앞으로 올 회차. 없으면 null(끝난 반복·과거 단일)
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function nextOccurrence(ev, now) {
  const start = new Date(ev.start_at);
  // ★ **종일 일정은 하루가 끝날 때까지 아직 오지 않은 일정이다.**
  //   종일의 start_at 은 그날 자정이라, "당일 아침 9시" 알림(08:59)을 보낼 시점에는
  //   `start_at > now` 로 보면 이미 지나간 일정이 되어 후보에서 통째로 빠졌다 —
  //   즉 종일의 `reminder_minutes < 540` 은 **전부 죽은 경로**였다.
  //   모달의 "당일 아침 (오전 9시)" 옵션(value 1)이 여기에 해당한다.
  //   (Fable 게이트 2026-09-05 F3 실측: 단일·반복 모두 4/4·3/3 미발송.)
  const graceMs = ev.all_day ? DAY_MS : 0;
  const stillAhead = (d) => d.getTime() + graceMs > now.getTime();

  if (!ev.rrule) return stillAhead(start) ? start : null;
  try {
    const { rrulestr } = require('rrule');
    const rule = rrulestr(ev.rrule, { dtstart: start });
    const except = new Set((Array.isArray(ev.exception_dates) ? ev.exception_dates : [])
      .map((d) => new Date(d).toISOString().slice(0, 10)));
    // 종일은 오늘 회차(오늘 자정)가 지금보다 앞서 있으므로 커서를 하루 뒤로 물린다.
    let cursor = new Date(now.getTime() - graceMs);
    for (let i = 0; i < 20; i++) {          // 예외가 연달아도 스무 번이면 충분하다
      const next = rule.after(cursor, false);
      if (!next) return null;
      if (!except.has(next.toISOString().slice(0, 10))) return stillAhead(next) ? next : null;
      cursor = next;
    }
    return null;
  } catch {
    // rrule 을 못 읽으면 반복을 포기하고 단일로 다룬다 — 조용히 아무것도 안 보내지 않는다.
    return stillAhead(start) ? start : null;
  }
}

/**
 * 알림을 보내야 할 시각. 종일 일정은 시작일 **09:00(워크스페이스 시간대)** 이 기준이다 —
 *   0시 기준이면 "1일 전"이 전날 자정이 되어 아무도 안 본다.
 */
function reminderTimeFor(ev, occurrence, timezone) {
  let base = occurrence;
  if (ev.all_day) {
    // 그 날짜의 09:00 을 워크스페이스 시간대로 만든다.
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(occurrence);
    // 시간대 오프셋을 구해 09:00 로컬을 UTC 로 환산한다.
    const probe = new Date(`${ymd}T09:00:00Z`);
    const asLocal = new Date(probe.toLocaleString('en-US', { timeZone: timezone }));
    const asUtc = new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' }));
    base = new Date(probe.getTime() + (asUtc.getTime() - asLocal.getTime()));
  }
  return new Date(base.getTime() - ev.reminder_minutes * 60 * 1000);
}

async function runCalendarReminderCron() {
  const now = new Date();
  console.log('[calendarReminderCron] triggered at', now.toISOString());

  try {
    // 후보: 알림이 켜진 일정 전부. **`start_at > now` 로 거르지 않는다** —
    //   반복 마스터는 start_at 이 과거이면서도 다음 회차가 남아 있다(그래서 통째로 빠져 있었다).
    const events = await CalendarEvent.findAll({
      where: {
        reminder_minutes: { [Op.ne]: null },
        [Op.or]: [
          { start_at: { [Op.gt]: now } },     // 아직 안 시작한 단일 일정
          { rrule: { [Op.ne]: null } },       // 반복 마스터 — 다음 회차를 따로 계산한다
          // 종일은 시작이 그날 자정이라 아침 알림 시점엔 이미 과거다 — 하루치를 더 본다.
          //   nextOccurrence 가 같은 유예(DAY_MS)로 최종 판정하므로 여기선 후보만 넓힌다.
          { all_day: true, start_at: { [Op.gt]: new Date(now.getTime() - DAY_MS) } },
        ],
      },
      include: [{
        model: CalendarEventAttendee,
        as: 'attendees',
        required: false,
        attributes: ['user_id', 'client_id', 'response'],
      }],
      limit: 500,
    });

    let sent = 0;
    let skipped = 0;
    const { notifyMany } = require('../routes/notifications');
    const appUrl = process.env.APP_URL || 'https://planq.kr';

    for (const ev of events) {
      // ★ timezone 을 **반드시 attributes 에 넣는다** — 빠뜨리면 undefined 로 조용히 서울이 된다.
      const biz = await Business.findByPk(ev.business_id, { attributes: ['name', 'brand_name', 'timezone'] });
      const tz = biz?.timezone || 'Asia/Seoul';

      const occurrence = nextOccurrence(ev, now);
      if (!occurrence) { skipped++; continue; }          // 끝난 반복·이미 시작한 단일
      const remindAt = reminderTimeFor(ev, occurrence, tz);

      // 발송 시각이 아직 안 됐으면 다음 기회에.
      if (remindAt > now) { skipped++; continue; }
      // 이미 이 회차 몫을 보냈으면 건너뛴다. (직전 회차 발송 시각은 언제나 이 회차보다 앞선다)
      if (ev.reminder_sent_at && new Date(ev.reminder_sent_at) >= remindAt) { skipped++; continue; }

      // 수신자 — 생성자 ∪ 멤버 attendee(declined 제외) ∪ 지정 멤버.
      //
      // ★ **소속을 여기서 다시 확인한다.** 쓰기측을 고쳐도 이미 저장된 옛 행에는 남의 워크스페이스
      //   id 가 들어 있을 수 있고, 그 행은 아무도 다시 저장하지 않는다 — 보내는 쪽이 마지막 문이다.
      //   Fable 게이트 2026-09-05 F1 실측: biz 3 전용 사용자에게 biz 5 일정 알림이 실제로 나갔다
      //   (인박스 행 생성 + 메일 발송 시도). 정수 id 는 추측 가능하다.
      //   판정은 middleware/access_scope.filterWorkspaceMemberIds — 쓰기 두 곳과 같은 함수다.
      const ids = new Set();
      for (const a of (ev.attendees || [])) {
        if (a.user_id && a.response !== 'declined') ids.add(a.user_id);
      }
      for (const uid of (Array.isArray(ev.target_member_ids) ? ev.target_member_ids : [])) {
        if (uid) ids.add(Number(uid));
      }
      if (ev.created_by) ids.add(ev.created_by);
      const memberIds = await filterWorkspaceMemberIds(ev.business_id, [...ids]);

      if (memberIds.length === 0) {
        // 받을 사람이 없으면 의미가 없다. 마킹해 다음 회차부터 다시 보게 둔다.
        await ev.update({ reminder_sent_at: now });
        skipped++;
        continue;
      }
      try {
        const wsName = biz?.brand_name || biz?.name || null;
        const startLocalIn = (lang) => new Date(occurrence).toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR', {
          timeZone: tz,
          dateStyle: 'short',
          ...(ev.all_day ? {} : { timeStyle: 'short' }),
        });
        await notifyMany({
          userIds: memberIds,
          businessId: ev.business_id,
          eventKind: 'event',
          titleSpec: { feature: 'calendar', action: 'calendar_soon', subject: ev.title },
          // ★ 사람 말로, **수신자 언어로**. "1440분 전 알림" 이 나가던 자리다.
          //   함수로 주면 notify 가 수신자 언어를 넣어 부른다 — 제목만 현지화되어
          //   한 알림 안에서 언어가 섞이던 것을 막는다(Fable 게이트 2026-09-05).
          body: (lang) => `${startLocalIn(lang)} · ${humanizeLead(ev.reminder_minutes, lang, !!ev.all_day)}${ev.location ? ` · ${ev.location}` : ''}`,
          link: `${appUrl}/calendar?event=${ev.id}`,
          ctaLabel: (lang) => (lang === 'en' ? 'View event' : '일정 보기'),
          workspaceName: wsName,
          // ★ 회차별로 다른 tag — 같으면 OS 알림이 서로 덮어써 마지막 하나만 남는다.
          tag: `event:${ev.id}:${Math.floor(occurrence.getTime() / 60000)}`,
        });
        await ev.update({ reminder_sent_at: now });
        sent++;
      } catch (e) {
        console.warn(`[calendarReminderCron] event ${ev.id} notify failed:`, e.message);
      }
    }

    console.log(`[calendarReminderCron] done. sent=${sent}, skipped=${skipped}, total=${events.length}`);
  } catch (err) {
    console.error('[calendarReminderCron] error:', err.message);
  }
}

function initCalendarReminderCron() {
  // 매 5분마다 trigger
  cron.schedule('*/5 * * * *', runCalendarReminderCron);
  console.log('[calendarReminderCron] initialized — runs every 5 minutes');
}

module.exports = { initCalendarReminderCron, runCalendarReminderCron, humanizeLead, nextOccurrence, reminderTimeFor };
