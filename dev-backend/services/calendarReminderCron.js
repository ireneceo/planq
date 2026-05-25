// N+63 — 일정 임박 알림 cron
//
// 매 5분마다 trigger. 다음 조건을 모두 만족하는 이벤트 attendees(멤버) 에게 push/email 발송:
//   - reminder_minutes IS NOT NULL (사용자가 알림 활성)
//   - reminder_sent_at IS NULL (아직 안 보냄)
//   - start_at > now (아직 시작 안 한 이벤트)
//   - start_at - reminder_minutes 시점이 [windowStart, now] 안 (직전 5분 window)
//
// 중복 발송 방지 — reminder_sent_at = now 로 마킹 (한 번만 발송).
// Client attendee 는 별도 채널 필요 (이메일 또는 SMS) — 본 cron 은 멤버만. 다음 사이클에 client 채널 추가.
//
// notifyMany 가 NotificationPref event_kind='event' 체크 — 사용자가 알림 OFF 면 자동 차단.

const cron = require('node-cron');
const { Op } = require('sequelize');
const { CalendarEvent, CalendarEventAttendee, Business } = require('../models');

async function runCalendarReminderCron() {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 5 * 60 * 1000);
  console.log('[calendarReminderCron] triggered at', now.toISOString());

  try {
    // 후보 이벤트: reminder_minutes 활성 + 아직 안 보냄 + 미래 이벤트
    const events = await CalendarEvent.findAll({
      where: {
        reminder_minutes: { [Op.ne]: null },
        reminder_sent_at: null,
        start_at: { [Op.gt]: now },
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
      const startMs = new Date(ev.start_at).getTime();
      const reminderMs = startMs - ev.reminder_minutes * 60 * 1000;
      // 발송 시점이 직전 5분 window 안인가?
      if (reminderMs <= windowStart.getTime() || reminderMs > now.getTime()) {
        skipped++;
        continue;
      }
      // 멤버 attendees (declined 제외)
      const memberIds = (ev.attendees || [])
        .filter(a => a.user_id && a.response !== 'declined')
        .map(a => a.user_id);
      // 생성자도 포함 (본인 일정 임박 알림)
      if (ev.created_by && !memberIds.includes(ev.created_by)) {
        memberIds.push(ev.created_by);
      }
      if (memberIds.length === 0) {
        // attendee 0명 = 알림 의미 X → 스킵 + 마킹 (다음 trigger 무한 반복 차단)
        await ev.update({ reminder_sent_at: now });
        skipped++;
        continue;
      }
      try {
        const biz = await Business.findByPk(ev.business_id, { attributes: ['name', 'brand_name'] });
        const wsName = biz?.brand_name || biz?.name || null;
        const startLocal = new Date(ev.start_at).toLocaleString('ko-KR', {
          timeZone: biz?.timezone || 'Asia/Seoul',
          dateStyle: 'short', timeStyle: 'short',
        });
        await notifyMany({
          userIds: memberIds,
          businessId: ev.business_id,
          eventKind: 'event',
          title: `곧 시작: ${ev.title}`,
          body: `${startLocal} (${ev.reminder_minutes}분 전 알림)${ev.location ? ` · ${ev.location}` : ''}`,
          link: `${appUrl}/calendar?event=${ev.id}`,
          ctaLabel: '일정 보기',
          workspaceName: wsName,
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

module.exports = { initCalendarReminderCron, runCalendarReminderCron };
