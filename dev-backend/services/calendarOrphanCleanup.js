// services/calendarOrphanCleanup.js — 구글에 남은 **PlanQ 고아 사본** 찾기·지우기.
//
// 무엇이 고아인가
//   PlanQ 가 만든 구글 이벤트인데(마커 `planq=1`), PlanQ 쪽 링크가 사라진 것.
//   링크가 없으면 PlanQ 는 그 사본을 영영 관리할 수 없다 — 수정도 삭제도 닿지 않는다.
//   운영 실사례: 연결이 삭제되며 고아가 된 link#1 의 사본. 여태 사용자에게 "구글에서 직접 지우세요"
//   라고 안내해 왔는데, 그건 우리가 할 일을 사용자에게 떠넘긴 것이다.
//
// ★ 왜 자동 삭제가 아니라 "찾아서 보여주고, 누르면 지운다" 인가
//   ① 사용자 자산 임의 변경 금지 원칙. ② 아래 교차 인스턴스 위험.
//
// ★ 교차 인스턴스 위험 (Fable 설계 게이트 치명-4)
//   같은 구글 계정을 dev 와 운영이 함께 쓰는 일이 이 팀에선 일상이다. 링크 테이블의 "부재" 는
//   **한 DB 안에서만** 전역이라, dev 에서 정리를 누르면 운영이 관리 중인 사본을 지울 수 있다.
//   그래서 ①이제부터 쓰기 시 `planq_env` 마커를 같이 박고 ②**같은 env 마커가 있는 것만**
//   일괄 삭제 후보로 올린다. ③마커가 없는 옛 사본(legacy)은 후보로 주되 `legacy: true` 로 표시해
//   화면이 **건별 선택**을 요구하게 한다. 일괄 버튼으로 지우지 않는다.
const { CalendarEventGcalLink, BusinessCloudToken, CalendarEvent } = require('../models');
const gcal = require('./google_calendar');
const { createAuditLog } = require('./auditService');

const MAX_DELETE_PER_CALL = 50;
const SCAN_LOOKBACK_DAYS = 400;

/**
 * 훑을 캘린더 = 지금 올리는 캘린더 ∪ 이 워크스페이스 팀 링크들이 가리키는 캘린더 ∪ primary.
 *   ★ 대표가 «올릴 캘린더» 를 바꾸면 옛 일정은 옛 캘린더에 남는다(docs/TEAM_CALENDAR_PICK_DESIGN.md §2).
 *     새 곳만 훑으면 옛 고아를, 옛 곳만 훑으면 새 고아를 놓친다. primary 는 링크가 다 사라진 옛 기본 캘린더의
 *     고아까지 잡으려고 늘 넣는다(종전 동작 — 이 기능 전에는 primary 만 훑었다).
 */
async function scanCalendarIds(businessId, token) {
  const rows = await CalendarEventGcalLink.findAll({
    where: { target: 'workspace' },
    attributes: ['gcal_calendar_id'],
    include: [{ model: CalendarEvent, as: 'event', required: true, attributes: [], where: { business_id: businessId } }],
    group: ['gcal_calendar_id'],
    raw: true,
  });
  const ids = new Set([gcal.calendarIdOf(token), 'primary']);
  rows.forEach((r) => { if (r.gcal_calendar_id) ids.add(String(r.gcal_calendar_id)); });
  return [...ids];
}

/**
 * 워크스페이스 캘린더에서 PlanQ 마커가 있는 이벤트를 훑어 고아를 가려낸다. (읽기 전용)
 * @returns {Promise<{supported:boolean, reason?:string, orphans:Array, scanned:number}>}
 */
async function scanWorkspaceOrphans(businessId) {
  const token = await BusinessCloudToken.findOne({ where: { business_id: businessId, provider: 'gcal' } });
  if (!token) return { supported: false, reason: 'not_connected', orphans: [], scanned: 0 };
  if (!gcal.hasWriteScope(token.scope)) return { supported: false, reason: 'no_calendar_scope', orphans: [], scanned: 0 };

  const cal = await gcal.getCalendarClient(token);
  const timeMin = new Date(Date.now() - SCAN_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  const items = [];
  for (const calendarId of await scanCalendarIds(businessId, token)) {
    let pageToken;
    do {
      let data;
      try {
        ({ data } = await cal.events.list({
          calendarId,
          privateExtendedProperty: 'planq=1',   // ★ 쓰기측 planqMarker() 와 정확히 같은 키·값
          showDeleted: false,
          singleEvents: false,
          maxResults: 250,
          timeMin,
          pageToken,
        }));
      } catch (e) {
        // 옛 캘린더가 지워졌거나 권한이 빠졌으면 그 캘린더만 건너뛴다 — 다른 캘린더 정리까지 막지 않는다.
        const code = e && (e.code || e.status);
        if (code === 404 || code === 403) { console.warn(`[gcalOrphan] 캘린더 ${calendarId} 건너뜀 (${code})`); break; }
        throw e;
      }
      (data.items || []).forEach((it) => items.push({ ...it, _calendarId: calendarId }));
      pageToken = data.nextPageToken;
    } while (pageToken && items.length < 1000);
  }

  const env = gcal.planqEnvTag();
  const orphans = [];
  for (const it of items) {
    if (!it.id) continue;
    // 링크가 하나라도 있으면 **관리 중** — 절대 후보가 아니다(음성 대조군의 정본).
    const linked = await CalendarEventGcalLink.count({ where: { gcal_event_id: it.id } });
    if (linked > 0) continue;
    const marker = (it.extendedProperties && it.extendedProperties.private) || {};
    const sameEnv = marker.planq_env ? marker.planq_env === env : false;
    // 다른 인스턴스가 관리 중일 수 있는 사본은 **후보에서 제외**한다(우리 DB 에 링크가 없다는 사실만으로
    //   지우면, 그 인스턴스에서 멀쩡히 살아있는 일정을 남이 지우는 셈이 된다).
    if (marker.planq_env && !sameEnv) continue;
    orphans.push({
      gcal_event_id: it.id,
      calendar_id: it._calendarId,   // 지울 때도 그 캘린더에서
      title: it.summary || '(제목 없음)',
      start: (it.start && (it.start.dateTime || it.start.date)) || null,
      html_link: it.htmlLink || null,
      legacy: !marker.planq_env,   // 마커 없는 옛 사본 — 화면이 건별 선택을 요구한다
    });
  }
  return { supported: true, orphans, scanned: items.length };
}

/**
 * 선택된 고아만 구글에서 삭제한다.
 * ★ 클라이언트가 보낸 id 를 믿지 않는다 — **서버 재스캔 ∩ 선택분** 만 지운다.
 *   스캔과 클릭 사이에 링크가 생겼을 수 있으므로(TOCTOU) 삭제 직전 링크 부재를 한 번 더 본다.
 */
async function cleanupWorkspaceOrphans(businessId, selectedIds, actorUserId) {
  const wanted = new Set((selectedIds || []).map(String));
  const scan = await scanWorkspaceOrphans(businessId);
  if (!scan.supported) return { deleted: 0, skipped: 0, failed: 0, reason: scan.reason };

  const targets = scan.orphans.filter((o) => wanted.has(String(o.gcal_event_id))).slice(0, MAX_DELETE_PER_CALL);
  const token = await BusinessCloudToken.findOne({ where: { business_id: businessId, provider: 'gcal' } });
  const cal = await gcal.getCalendarClient(token);

  const out = { deleted: 0, skipped: Math.max(0, wanted.size - targets.length), failed: 0 };
  for (const o of targets) {
    try {
      const linked = await CalendarEventGcalLink.count({ where: { gcal_event_id: o.gcal_event_id } });
      if (linked > 0) { out.skipped += 1; continue; }   // 그 사이 링크가 생겼다 — 건드리지 않는다
      await cal.events.delete({ calendarId: o.calendar_id || 'primary', eventId: o.gcal_event_id });
      out.deleted += 1;
      await createAuditLog({
        user_id: actorUserId || null,
        business_id: businessId,
        action: 'event.gcal_orphan_cleanup',
        target_type: 'business_cloud_token',
        target_id: token.id,
        new_value: { gcal_event_id: o.gcal_event_id, calendar_id: o.calendar_id || 'primary', title: o.title, start: o.start, legacy: o.legacy },
      });
    } catch (e) {
      // 이미 지워진 것(410/404)은 성공으로 친다 — 목표 상태가 같다.
      const code = e.code || e.status;
      if (code === 404 || code === 410) { out.deleted += 1; continue; }
      out.failed += 1;
      console.error(`[gcalOrphan] ${o.gcal_event_id} 삭제 실패:`, e.message);
    }
  }
  console.log(`[gcalOrphan] biz ${businessId} · 삭제 ${out.deleted} · 건너뜀 ${out.skipped} · 실패 ${out.failed}`);
  return out;
}

module.exports = { scanWorkspaceOrphans, cleanupWorkspaceOrphans, MAX_DELETE_PER_CALL };
