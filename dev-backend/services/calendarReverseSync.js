// services/calendarReverseSync.js — 역방향 동기화 (구글 → PlanQ). 운영 피드백 #242 ②.
//
// 문제
//   PlanQ 일정은 구글로 잘 나갔지만(push), **구글에서 고친 내용이 PlanQ 로 돌아오지 않았다.**
//   역방향 코드가 아예 없었다 — `events.list` 는 읽기 전용 오버레이 1곳뿐이었고 그마저
//   `isPlanqOrigin()` 으로 PlanQ 일정을 명시적으로 걸러내는 구조라, 구조상 되돌아올 수 없었다.
//
// v1 범위 (★ 절단면)
//   **PlanQ 가 만든 일정만** 되돌려 받는다 = `calendar_event_gcal_links` 에 링크가 있는 것만.
//   구글에서 새로 만든 일정을 PlanQ 일정으로 **가져오지 않는다** — 그건 "가져오기(import)" 라는
//   별개 기능이고, 이미 있는 읽기 전용 오버레이와 화면에서 **같은 일정이 두 번 그려진다**.
//   Irene 요구 원문도 "Q calendar에서 생성된 일정을 구글에서 수정하면 반영 안 됨" 이다.
//
// 전달 방식 — watch(push) 가 아니라 syncToken 증분 폴링
//   watch 채널은 수신 도메인 검증·7일 만료 재등록·중복 수신 처리가 붙는다. v1 과잉.
//
// 무한 루프를 막는 두 겹
//   ① etag 1차 필터 — 우리가 민 버전의 etag(`link.last_pushed_etag`)와 같으면 내 변경이므로 무시.
//      ★ etag 만으로는 부족하다. 구글 etag 는 참석자 응답·리마인더처럼 **우리가 안 미는
//        메타데이터 변화로도 바뀐다** → 그때마다 "남의 변경" 으로 오인해 되돌리기가 발동한다.
//   ② 멱등 가드(정본) — 화이트리스트 필드를 비교해 **실제로 다른 게 없으면 no-op**.
//      이게 있으면 etag 가 어긋나도 루프가 자생할 수 없다.
//
// 되돌려 받는 필드 (화이트리스트)
//   title / description / location / start_at / end_at / all_day / rrule
//   ★ 되돌려 받지 않는 것: 공개범위(vlevel)·참석자·담당자 등 PlanQ 고유 필드.
//     구글에는 이 개념이 없어 되돌리면 PlanQ 권한 모델이 파괴된다.
const { Op } = require('sequelize');
const { google } = require('googleapis');
const {
  CalendarEvent, CalendarEventGcalLink, ExternalConnection, BusinessCloudToken, BusinessMember,
} = require('../models');
const personalOauth = require('./personalOauth');
const personalCalendar = require('./personalCalendar');
const gcal = require('./google_calendar');
const calendarSync = require('./calendarSync');
const calendarPermission = require('./calendarPermission');
const { createAuditLog } = require('./auditService');

// 부트스트랩(최초 전체 1회)에서 훑을 페이지 상한. 초과분은 **조용히 버리지 않고 로그로 남긴다** —
//   말없이 자르면 "전부 커버했다" 로 읽힌다.
const BOOTSTRAP_PAGE_CAP = 20;
const PAGE_SIZE = 250;

/** 구글 종일 end.date(배타적) → PlanQ 마지막 날 23:59:59 (쓰기측 +1 과 정확히 대칭) */
function toPlanqTimes(item) {
  const start = item.start || {};
  const end = item.end || {};
  const allDay = !!start.date && !start.dateTime;
  if (allDay) {
    const endDate = end.date ? personalCalendar.exclusiveEndToInclusive(end.date) : start.date;
    return { all_day: true, start_at: new Date(`${start.date}T00:00:00`), end_at: new Date(`${endDate}T23:59:59`) };
  }
  return {
    all_day: false,
    start_at: start.dateTime ? new Date(start.dateTime) : null,
    end_at: end.dateTime ? new Date(end.dateTime) : null,
  };
}

/** 구글 recurrence 배열 → PlanQ rrule 단일 문자열 (RRULE: 접두 제거). 없으면 null. */
function toPlanqRrule(item) {
  const arr = Array.isArray(item.recurrence) ? item.recurrence : null;
  if (!arr || !arr.length) return null;
  const r = arr.find((x) => String(x).toUpperCase().startsWith('RRULE:'));
  return r ? String(r).replace(/^RRULE:/i, '') : null;
}

/** 구글 이벤트 → PlanQ 화이트리스트 patch 후보 */
function toPatch(item) {
  const times = toPlanqTimes(item);
  return {
    title: item.summary || '(제목 없음)',
    description: item.description ?? null,
    location: item.location ?? null,
    start_at: times.start_at,
    end_at: times.end_at,
    all_day: times.all_day,
    rrule: toPlanqRrule(item),
  };
}

const sameTime = (a, b) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
};

/**
 * 멱등 가드(정본) — 실제로 달라진 화이트리스트 필드만 남긴다. 비면 no-op.
 * etag 가 흔들려도 이 diff 가 비면 아무 일도 일어나지 않으므로 루프가 자생할 수 없다.
 */
function diffAgainstEvent(event, patch) {
  const out = {};
  if ((event.title || '') !== (patch.title || '')) out.title = patch.title;
  if ((event.description || '') !== (patch.description || '')) out.description = patch.description;
  if ((event.location || '') !== (patch.location || '')) out.location = patch.location;
  if (!!event.all_day !== !!patch.all_day) out.all_day = patch.all_day;
  if (patch.start_at && !sameTime(event.start_at, patch.start_at)) out.start_at = patch.start_at;
  if (patch.end_at && !sameTime(event.end_at, patch.end_at)) out.end_at = patch.end_at;
  if ((event.rrule || null) !== (patch.rrule || null)) out.rrule = patch.rrule;
  return out;
}

/**
 * 폴링 대상 판정 — 링크가 하나도 없는 연결은 부를 이유가 없다(구글 쿼터·로그 낭비).
 * 죽은 연결도 제외한다 — 5분 cron 이 계속 부딪히면 fail_count 가 하루 288 씩 오른다.
 */
async function personalSources() {
  const conns = await ExternalConnection.findAll({
    where: { provider: 'google_calendar', owner_scope: 'user', is_active: true },
  });
  const out = [];
  for (const conn of conns) {
    if (!personalCalendar.hasCalendarWrite(conn)) continue;   // 권한 없는 연결은 skip
    if (conn.last_sync_error) continue;                        // 죽은 연결은 skip (오류 폭증 차단)
    const n = await CalendarEventGcalLink.count({ where: { target: 'personal', connection_id: conn.id } });
    if (n > 0) out.push({ kind: 'personal', conn, businessId: conn.business_id });
  }
  return out;
}

async function workspaceSources() {
  const tokens = await BusinessCloudToken.findAll({ where: { provider: 'gcal' } });
  const out = [];
  for (const token of tokens) {
    if (!gcal.hasWriteScope(token.scope)) continue;
    if (token.last_error) continue;
    // ★ 반드시 business_id 로 좁힌다. 워크스페이스 링크는 connection_id 가 NULL 이라
    //   `{ target:'workspace' }` 만으로 세면 **다른 워크스페이스의 링크까지 센다** —
    //   링크가 0인 워크스페이스를 남의 데이터 때문에 폴링 대상으로 올리게 된다.
    //   테넌트 축은 link 에 없고 CalendarEvent 에 있으므로 조인으로 좁힌다.
    const n = await CalendarEventGcalLink.count({
      where: { target: 'workspace' },
      include: [{ model: CalendarEvent, as: 'event', required: true, attributes: [], where: { business_id: token.business_id } }],
    });
    if (n > 0) out.push({ kind: 'workspace', token, businessId: token.business_id });
  }
  return out;
}

async function clientFor(source) {
  if (source.kind === 'personal') {
    const auth = await personalOauth.getAuthedClient(source.conn);
    return google.calendar({ version: 'v3', auth });
  }
  return await gcal.getCalendarClient(source.token);
}

const cursorOf = (source) => (source.kind === 'personal' ? source.conn.gcal_sync_token : source.token.gcal_sync_token);
const saveCursor = (source, tokenStr) => (source.kind === 'personal'
  ? source.conn.update({ gcal_sync_token: tokenStr })
  : source.token.update({ gcal_sync_token: tokenStr }));

/**
 * 변경분 수집.
 *
 * ★ `singleEvents: false` 가 계약이다. true 로 두면 정기일정 변경이 **인스턴스 단위로 쏟아져**
 *   PlanQ 의 "rrule 단일 row" 모델과 맞지 않는다. false 면 시리즈 수정은 부모 이벤트 1건으로 오고,
 *   단일 회차 예외는 `recurringEventId` 를 단 별도 이벤트로 와서 링크가 없어 자연히 무시된다.
 *
 * 커서가 없으면 **부트스트랩**: 변경을 적용하지 않고 커서만 확보한다.
 *   적용하면 최초 1회에 구글의 (오래된) 상태로 PlanQ 를 덮을 수 있다 — 되돌릴 수 없는 사고다.
 */
async function collectChanges(cal, source) {
  const syncToken = cursorOf(source);
  const base = { calendarId: 'primary', singleEvents: false, maxResults: PAGE_SIZE, showDeleted: true };
  const items = [];
  let pageToken = null;
  let pages = 0;
  let nextSyncToken = null;
  const bootstrap = !syncToken;

  do {
    let resp;
    try {
      resp = await cal.events.list(
        { ...base, ...(syncToken ? { syncToken } : {}), ...(pageToken ? { pageToken } : {}) },
        { timeout: 15000 },
      );
    } catch (e) {
      const code = e && (e.code || e.status);
      if (code === 410) {
        // 커서 만료 — 토큰을 버리고 다음 회차에 재부트스트랩. 토큰은 캐시지 원장이 아니다.
        await saveCursor(source, null);
        return { items: [], nextSyncToken: null, expired: true, bootstrap };
      }
      throw e;
    }
    if (!bootstrap) items.push(...(resp.data.items || []));
    pageToken = resp.data.nextPageToken || null;
    nextSyncToken = resp.data.nextSyncToken || nextSyncToken;
    pages += 1;
    if (bootstrap && pages >= BOOTSTRAP_PAGE_CAP && pageToken) {
      // 상한 도달 — 커서를 못 만든 채 끊는다. 조용히 자르지 않고 남긴다.
      console.warn(`[reverseSync] 부트스트랩 페이지 상한(${BOOTSTRAP_PAGE_CAP}) 초과 — 커서 미확보, 다음 회차 재시도`);
      return { items: [], nextSyncToken: null, truncated: true, bootstrap };
    }
  } while (pageToken);

  return { items, nextSyncToken, bootstrap };
}

/** 이 링크의 소유자가 이 일정을 편집할 수 있는가 — 라우트와 **같은 헬퍼**로 판정한다. */
async function ownerCanEdit(event, userId, businessId) {
  if (!userId) return false;
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  return calendarPermission.canEditEvent(event, bm, userId);
}

/**
 * 역방향 반영 후, **같은 일정의 다른 목적지 사본**을 최신으로 맞춘다.
 *
 * ★ 이게 없으면 다른 사본이 영구 stale 이다. "다음 push 때 정렬된다" 는 거짓 —
 *   다음 push 는 사용자가 PlanQ 에서 직접 편집해야만 발생한다.
 *   etag 가드가 있으므로 여기서 미는 것은 루프를 만들지 않는다(자기 etag 로 기록되므로).
 */
async function propagateToOtherLinks(event, businessId, sourceLinkId) {
  const links = await CalendarEventGcalLink.findAll({
    where: { event_id: event.id, ...(sourceLinkId ? { id: { [Op.ne]: sourceLinkId } } : {}) },
  });
  let n = 0;
  for (const link of links) {
    try {
      if (await calendarSync.updateAtLink(link, event, businessId, null)) n += 1;
    } catch (e) {
      console.error(`[reverseSync] 사본 전파 실패 link#${link.id}: ${e.message}`);
    }
  }
  return n;
}

/**
 * 한 소스(개인 연결 또는 워크스페이스 토큰)의 변경분을 PlanQ 에 반영한다.
 * @returns {Promise<{applied:number, skipped:number, unlinked:number, errors:Array}>}
 */
async function pollSource(source, { io = null } = {}) {
  const out = { applied: 0, skipped: 0, unlinked: 0, errors: [] };
  const cal = await clientFor(source);
  const { items, nextSyncToken, expired, truncated, bootstrap } = await collectChanges(cal, source);
  if (expired || truncated) return { ...out, note: expired ? 'sync_token_expired' : 'bootstrap_truncated' };

  for (const item of items) {
    try {
      // ★ 워크스페이스 링크는 connection_id 가 NULL 이라 그것만으로는 테넌트가 좁혀지지 않는다.
      //   CalendarEvent 조인으로 business_id 를 강제한다 (멀티테넌트 격리 — 모든 조회에 필수).
      const link = source.kind === 'personal'
        ? await CalendarEventGcalLink.findOne({
          where: { gcal_event_id: item.id, target: 'personal', connection_id: source.conn.id },
        })
        : await CalendarEventGcalLink.findOne({
          where: { gcal_event_id: item.id, target: 'workspace' },
          include: [{ model: CalendarEvent, as: 'event', required: true, attributes: [], where: { business_id: source.businessId } }],
        });
      // 링크 없음 = PlanQ 가 만든 일정이 아니다 → v1 범위 밖.
      //   ★ 내용을 로그·DB 에 남기지 않는다 — 사용자 개인 캘린더의 사생활이다.
      if (!link) { out.unlinked += 1; continue; }

      if (item.status === 'cancelled') {
        // 구글에서 지워짐 → **PlanQ 일정은 지우지 않는다.** 파괴를 자동화하지 않는다.
        //   링크만 회수해 다음 저장 때 다시 만들어지게 한다.
        await link.destroy();
        out.applied += 1;
        continue;
      }

      // ① etag 1차 필터 — 내가 민 버전 그대로면 내 변경이다.
      if (item.etag && link.last_pushed_etag && item.etag === link.last_pushed_etag) { out.skipped += 1; continue; }

      const event = await CalendarEvent.findByPk(link.event_id);
      if (!event) { await link.destroy(); out.unlinked += 1; continue; }

      // ② 멱등 가드(정본) — 화이트리스트 diff 가 비면 아무것도 하지 않는다.
      const patch = diffAgainstEvent(event, toPatch(item));
      if (!Object.keys(patch).length) {
        if (item.etag && item.etag !== link.last_pushed_etag) await link.update({ last_pushed_etag: item.etag });
        out.skipped += 1;
        continue;
      }

      // 권한 — 링크 소유자가 이 일정을 편집할 수 있어야 한다(라우트와 같은 헬퍼).
      //   ★ 워크스페이스 링크는 `user_id` 가 **항상 NULL** 이다(reconcile 이 그렇게 만든다 —
      //     워크스페이스 목적지는 사람이 아니라 워크스페이스 하나뿐이라 소유자 개념이 없다).
      //     그래서 link.user_id 만 보면 actor 가 null 이 되어 `ownerCanEdit` 이 무조건 false →
      //     **워크스페이스 캘린더에서 고친 변경이 전부 조용히 폐기된다**(운영 링크 6/8 이 워크스페이스).
      //     워크스페이스 연결을 실제로 맺은 사람 = `BusinessCloudToken.connected_by` 를 actor 로 쓴다.
      const actorId = link.user_id
        || (source.kind === 'personal'
          ? source.conn.user_id
          : (source.token && source.token.connected_by) || null);
      if (!(await ownerCanEdit(event, actorId, event.business_id))) {
        out.skipped += 1;
        console.warn(`[reverseSync] 권한 없음 — event#${event.id} actor#${actorId} 변경 무시`);
        continue;
      }

      // 충돌 — 구글 updated(ms) vs PlanQ updated_at(DATETIME(3)). 최신 우선, 동률이면 PlanQ 우선.
      //   PlanQ 가 공개범위·권한을 들고 있으므로 동률에서 우리 쪽을 남긴다.
      const gUpdated = item.updated ? new Date(item.updated).getTime() : 0;
      const pUpdated = event.updatedAt ? new Date(event.updatedAt).getTime() : 0;
      if (pUpdated >= gUpdated) { out.skipped += 1; continue; }

      const before = {
        title: event.title, description: event.description, location: event.location,
        start_at: event.start_at, end_at: event.end_at, all_day: event.all_day, rrule: event.rrule,
      };
      // ★ 서비스 레벨에서 직접 갱신한다 — push 는 라우트가 reconcile 을 부를 때만 일어나므로
      //   여기서는 애초에 발화하지 않는다(에코 차단).
      await event.update(patch);
      if (item.etag) await link.update({ last_pushed_etag: item.etag });

      // 나머지 목적지 사본 정렬 (stale 방지)
      await propagateToOtherLinks(event, event.business_id, link.id);

      await createAuditLog({
        user_id: actorId, business_id: event.business_id,
        action: 'event.reverse_sync',
        target_type: 'calendar_event', target_id: event.id,
        old_value: before,
        new_value: { ...patch, source: 'gcal_reverse_sync', gcal_event_id: item.id },
      });

      // CLAUDE.md 16번 — 열려 있는 캘린더 화면이 새로고침 없이 갱신돼야 한다.
      //   notify(푸시/메일)는 **하지 않는다** — 구글에서 글자 하나 고칠 때마다 알림이 가면 소음이다.
      //   결정: broadcast 만.
      if (io && event.business_id) {
        const full = await CalendarEvent.findByPk(event.id);
        io.to(`business:${event.business_id}`).emit('event:updated', full.toJSON());
      }
      out.applied += 1;
    } catch (e) {
      out.errors.push({ gcal_event_id: item.id, message: e.message });
    }
  }

  if (nextSyncToken) await saveCursor(source, nextSyncToken);
  return { ...out, bootstrap: !!bootstrap };
}

/** cron 진입점 — 전 소스 1회 폴링. 개별 소스 실패는 삼키고 계속한다. */
async function runAll({ io = null } = {}) {
  const total = { sources: 0, applied: 0, skipped: 0, unlinked: 0, errors: 0 };
  let sources = [];
  try {
    sources = [...(await personalSources()), ...(await workspaceSources())];
  } catch (e) {
    console.error('[reverseSync] 소스 조회 실패:', e.message);
    return total;
  }
  for (const source of sources) {
    total.sources += 1;
    try {
      const r = await pollSource(source, { io });
      total.applied += r.applied; total.skipped += r.skipped;
      total.unlinked += r.unlinked; total.errors += r.errors.length;
    } catch (e) {
      total.errors += 1;
      // AUTH 계열만 연결에 기록한다 — 일시적 네트워크 오류로 fail_count 가 하루 288 오르면 안 된다.
      if (/invalid_grant|unauthorized|insufficient|invalid_credentials/i.test(e.message || '')) {
        if (source.kind === 'personal') await personalCalendar.recordConnError(source.conn, e);
        else await gcal.recordPushError(source.token, e);
      }
      console.error(`[reverseSync] ${source.kind} 폴링 실패:`, e.message);
    }
  }
  if (total.applied || total.errors) {
    console.log(`[reverseSync] 소스 ${total.sources} · 반영 ${total.applied} · 무시 ${total.skipped} · 비링크 ${total.unlinked} · 오류 ${total.errors}`);
  }
  return total;
}

module.exports = {
  runAll, pollSource, personalSources, workspaceSources,
  // 테스트·검증용 — 순수 함수라 실호출 없이 단위 검증할 수 있다
  toPatch, diffAgainstEvent, toPlanqTimes, toPlanqRrule,
};
