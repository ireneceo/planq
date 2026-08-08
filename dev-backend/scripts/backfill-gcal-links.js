/**
 * calendar_events.gcal_event_id 만 있고 링크 row 가 없는 옛 일정에 workspace 링크를 채운다.
 *
 * 왜 필요한가:
 *   Meet 자동생성(services/actions/event_actions.js)과 push-to-gcal(routes/calendar.js)은
 *   구글 이벤트를 만들면서 **링크 row 를 만들지 않았다.** 그래서 그 일정을 다음에 저장하면
 *   reconcile 이 "워크스페이스 링크 없음" 으로 보고 **두 번째 구글 이벤트를 insert** 했다
 *   (사본 2개 + gcal_event_id 가 나중 것으로 덮어써져 삭제·재발급이 엉뚱한 이벤트를 잡음).
 *   쓰기측은 이미 고쳤다. 이 스크립트는 **이미 쌓인 옛 데이터**를 같은 상태로 끌어올린다.
 *   (memory feedback_backfill_needs_write_side_fix — 쓰기측을 먼저 고친 뒤 백필한다.)
 *
 * 멱등:
 *   이미 링크가 있으면 건너뛴다. 재실행하면 변경 0 이어야 한다(검증 항목).
 *
 * ★ 이 백필은 회수(reconcile remove) 경로를 **켠다**. 링크가 생기는 순간, 다음 저장 때
 *   "지금은 원하지 않는 목적지" 로 판정되는 일정의 구글 사본이 삭제된다. 두 부류가 그렇다:
 *     ① 비공개(L1/L2/personal) 인데 옛날에 팀 캘린더로 push 된 일정 → #126 유출 회수(올바름)
 *     ② gcal_sync_workspace 가 꺼진 일정 → 문서화된 의미의 뒤늦은 집행
 *   둘 다 의도된 동작이지만 사용자에겐 갑작스러우므로 **건수를 집계해 출력**한다.
 *   백필 자체는 reconcile 을 호출하지 않는다 — 구글 API 를 한 번도 부르지 않으며,
 *   실제 정리는 각 일정의 다음 저장 시점으로 자연히 분산된다.
 *
 * 사용법:
 *   node scripts/backfill-gcal-links.js            # dry-run (변경 없음, 집계만)
 *   node scripts/backfill-gcal-links.js --apply    # 실제 반영
 */
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { CalendarEvent, CalendarEventGcalLink } = require('../models');
const gcal = require('../services/google_calendar');
const { wantsWorkspace } = require('../services/calendarSync');

const APPLY = process.argv.includes('--apply');

async function main() {
  await sequelize.authenticate();

  const events = await CalendarEvent.findAll({
    where: { gcal_event_id: { [Op.ne]: null } },
    attributes: [
      'id', 'business_id', 'gcal_event_id', 'meeting_provider', 'meeting_url',
      // 옛 단일 컬럼 gcal_sync 는 DB 에 실재하지 않는다(모델 호환 분기만 남아 있다).
      // 조회에 넣으면 ER_BAD_FIELD_ERROR. wantsWorkspace 는 undefined 를 기본 ON 으로 처리한다.
      'visibility', 'vlevel', 'gcal_sync_workspace',
    ],
    order: [['id', 'ASC']],
  });

  const stats = {
    scanned: events.length,
    already_linked: 0,
    created: 0,
    holds_meeting: 0,
    will_revoke_private: 0,   // 다음 저장 때 #126 유출 회수 대상
    will_revoke_toggle: 0,    // 다음 저장 때 토글 off 집행 대상
  };

  for (const ev of events) {
    const existing = await CalendarEventGcalLink.findOne({
      where: { event_id: ev.id, target: 'workspace', connection_id: null },
    });
    if (existing) { stats.already_linked++; continue; }

    // Meet 을 들고 있는가 — 이 판정을 빼먹으면 옛 회의들이 보호 없이 남아
    // 토글 off 첫 저장에 삭제된다(회수 보호의 취지가 레거시에서만 무너진다).
    const holdsMeeting = ev.meeting_provider === 'google_meet' && !!ev.meeting_url;

    const isPrivate = gcal.isPrivateForGcal(ev);
    if (isPrivate) stats.will_revoke_private++;
    else if (!wantsWorkspace(ev)) stats.will_revoke_toggle++;

    if (APPLY) {
      await CalendarEventGcalLink.create({
        event_id: ev.id,
        target: 'workspace',
        connection_id: null,
        user_id: null,
        gcal_event_id: ev.gcal_event_id,
        holds_meeting: holdsMeeting,
      });
    }
    stats.created++;
    if (holdsMeeting) stats.holds_meeting++;
  }

  console.log(APPLY ? '[backfill-gcal-links] APPLY' : '[backfill-gcal-links] DRY-RUN (반영하려면 --apply)');
  console.table(stats);
  if (stats.will_revoke_private > 0) {
    console.log(`⚠️  비공개 일정 ${stats.will_revoke_private}건 — 다음 저장 시 팀 캘린더에서 회수됩니다 (#126 유출 차단, 올바른 동작).`);
  }
  if (stats.will_revoke_toggle > 0) {
    console.log(`⚠️  팀 동기화 off 일정 ${stats.will_revoke_toggle}건 — 다음 저장 시 구글 사본이 정리됩니다.`);
  }
  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
