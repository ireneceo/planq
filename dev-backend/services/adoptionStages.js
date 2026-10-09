// 팀 적응 단계 — «무엇부터 습관으로 만들까» 를 다섯 단계로 (2026-10-09).
//
// 왜 (Irene 2026-10-09: "플랜큐는 기능이 너무 많아. 팀이 적응하는데 필요한 단계별 안내가 필요해 …
//   처음 가장 효과적인 건 업무 관리 업무요청이야 … 그리고 채팅과 이메일로 소통하는 거. 여기까지가 2단계")
// 정본: docs/TEAM_ADOPTION_STAGES_DESIGN.md — 도움말 글(team-adoption-stages)·랜딩 /start 와 **같은 다섯 단계**다.
//
// ★ 완료는 실제 데이터로 매번 센다(services/onboarding.js 와 같은 원칙). 저장하는 것은 «안 볼래» 하나뿐.
// ★ 판정 축은 **사람 × 워크스페이스** — 단계는 팀원 각자의 습관이다.
// ★ core / optional (Fable 2026-10-09) — 지금 단계·묶음 종료는 core 줄만 본다. «말로·AI 로 등록»·«프로젝트 연결»
//   같은 선택지가 core 면 손으로만 쓰는 팀은 영영 1단계에 묶인다.
// ★ 그 사람이 할 수 없는 줄은 보여주지 않는다 — 메뉴 권한 none · owner/admin 전용 행동. [열기] 가 403 으로 가는 줄을 두지 않는다.
// ★ done:null = 확인 못 함(q-note 장애). 단계 계산은 null 을 막지 않는 것으로 본다 — 장애로 카드가 단계를 되돌리며 깜빡이면 안 된다.
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { getMemberMenuLevels } = require('../middleware/menu_permission');
const { mailAttachmentFileIds } = require('./mailAttachmentFiles');
const { billableClientWhere } = require('./clientQuota');
const { Client } = require('../models');

const MANAGER_ROLES = new Set(['owner', 'admin']);
const HUMAN_ROLES = ['owner', 'admin', 'member'];

/** 줄 정의 — 순서가 곧 화면 순서. menu = 그 메뉴 권한이 none 이면 숨김. manager = owner/admin 만. */
const STEPS = [
  { stage: 1, key: 'invite_team', core: true, manager: true },
  { stage: 1, key: 'create_task', core: true, menu: 'qtask' },
  { stage: 1, key: 'request_task', core: true, menu: 'qtask' },
  { stage: 1, key: 'project_task', core: false, menu: 'qtask' },
  { stage: 1, key: 'ai_task', core: false, menu: 'qtask' },
  { stage: 2, key: 'team_chat', core: true, menu: 'qtalk' },
  // 메일: owner/admin 은 회사 메일을 연결할 수 있으니 core, 멤버는 개인 메일로 할 수도 있지만 선택(Fable ②).
  { stage: 2, key: 'connect_mail', core: 'manager', menu: 'qmail' },
  { stage: 3, key: 'create_event', core: true, menu: 'qcalendar' },
  { stage: 3, key: 'record_meeting', core: true, menu: 'qnote' },
  { stage: 4, key: 'upload_file', core: true, menu: 'qfile' },
  { stage: 4, key: 'create_document', core: true, menu: 'qdocs' },
  { stage: 5, key: 'invite_client', core: true, manager: true },
  // 고객 대화방은 고객이 있어야 열린다 — 멤버가 혼자 할 수 없으니 멤버에겐 선택.
  { stage: 5, key: 'client_chat', core: 'manager', menu: 'qtalk' },
  { stage: 5, key: 'issue_invoice', core: true, manager: true, menu: 'qbill' },
];
const STAGE_COUNT = 5;

async function countOne(sql, replacements) {
  const rows = await sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  return Number((rows[0] && rows[0].n) || 0);
}

/** q-note(별도 서비스) — 내 회의 기록 수. 실패는 null(확인 못 함). */
async function countMyRecordings(userId, businessId) {
  const key = process.env.INTERNAL_API_KEY;
  if (!key) return null;
  const base = process.env.QNOTE_INTERNAL_URL || 'http://localhost:8000';
  const qs = new URLSearchParams({ user_id: String(userId), business_id: String(businessId) });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const r = await fetch(`${base}/api/sessions/internal/count-mine?${qs}`, {
      headers: { 'x-internal-api-key': key }, signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const j = await r.json();
    const n = j && j.data && j.data.recordings;
    return Number.isFinite(Number(n)) ? Number(n) : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// 같은 판정을 쓰는 SQL — 고객이 끼어 있는 대화방(고객 대화방)인가.
const CLIENT_CONV = `(c.client_id IS NOT NULL OR EXISTS (
  SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.role = 'client'))`;

/**
 * @param {{ businessId:number, userId:number, role:string }} p
 * @returns {Promise<{ current: number|null, stage_count: number, steps: Array<{key:string, stage:number, core:boolean, done:boolean|null}> }>}
 */
async function getAdoptionStages({ businessId, userId, role }) {
  const biz = Number(businessId);
  const me = Number(userId);
  const isManager = MANAGER_ROLES.has(role);
  const levels = await getMemberMenuLevels(biz, me);
  const menus = (levels && levels.menus) || {};

  const visible = STEPS.filter((s) => (!s.manager || isManager) && (!s.menu || (menus[s.menu] || 'write') !== 'none'));
  const want = new Set(visible.map((s) => s.key));
  const R = { biz, me, humans: HUMAN_ROLES };

  const q = {
    invite_team: () => countOne(
      `SELECT COUNT(*) n FROM business_members
        WHERE business_id = :biz AND removed_at IS NULL AND role IN (:humans) AND user_id <> :me`, R),
    create_task: () => countOne(
      'SELECT COUNT(*) n FROM tasks WHERE business_id = :biz AND created_by = :me', R),
    // 요청 — 내가 **사람 동료**에게 맡겼거나, 남이 나에게 요청한 업무를 확인(ack)했다. 요청만 받는 사람도 이 습관을 익힌 것이다.
    request_task: () => countOne(
      `SELECT COUNT(*) n FROM tasks t
        WHERE t.business_id = :biz AND (
          (t.created_by = :me AND t.assignee_id IS NOT NULL AND t.assignee_id <> :me AND EXISTS (
             SELECT 1 FROM business_members bm WHERE bm.business_id = t.business_id AND bm.user_id = t.assignee_id
               AND bm.removed_at IS NULL AND bm.role IN (:humans)))
          OR (t.assignee_id = :me AND t.request_by_user_id IS NOT NULL AND t.request_by_user_id <> :me AND t.request_ack_at IS NOT NULL)
        )`, R),
    project_task: () => countOne(
      'SELECT COUNT(*) n FROM tasks WHERE business_id = :biz AND created_by = :me AND project_id IS NOT NULL', R),
    // 말로·AI — AI 업무 추가(ai_draft) · ChatGPT/Claude(agent) · Cue(cue). ai_draft 는 2026-10-09 부터 찍힌다(그래서 선택 줄이다).
    ai_task: () => countOne(
      `SELECT COUNT(*) n FROM tasks WHERE business_id = :biz AND created_by = :me
         AND created_via IN ('ai_draft','agent','cue')`, R),
    team_chat: () => countOne(
      `SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.business_id = :biz AND m.sender_id = :me AND m.kind = 'text' AND NOT ${CLIENT_CONV}`, R),
    // 메일 — 이 사람이 볼 수 있는 계정(회사 공용 + 내 개인). routes/email_accounts.js accessibleWhere 와 같은 술어.
    connect_mail: () => countOne(
      `SELECT COUNT(*) n FROM email_accounts WHERE business_id = :biz AND is_active = 1
         AND (owner_user_id IS NULL OR owner_user_id = :me)`, R),
    // 일정 — 고객 예약(booking)은 서버가 담당 멤버 명의로 만든다. 사람이 만든 것만.
    create_event: () => countOne(
      'SELECT COUNT(*) n FROM calendar_events WHERE business_id = :biz AND created_by = :me AND booking_status IS NULL', R),
    record_meeting: () => countMyRecordings(me, biz),
    upload_file: async () => {
      const mailIds = await mailAttachmentFileIds(biz);
      return countOne(
        `SELECT COUNT(*) n FROM files WHERE business_id = :biz AND uploader_id = :me AND deleted_at IS NULL
           ${mailIds.length ? 'AND id NOT IN (:mailIds)' : ''}`, { ...R, mailIds });
    },
    create_document: () => countOne(
      'SELECT COUNT(*) n FROM posts WHERE business_id = :biz AND author_id = :me AND deleted_at IS NULL', R),
    // 고객 초대 — 기존 «고객 초대» 줄·요금제 한도와 같은 술어(문의 고객 prospect 는 초대가 아니다).
    invite_client: () => Client.count({ where: billableClientWhere(biz) }),
    client_chat: () => countOne(
      `SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.business_id = :biz AND m.sender_id = :me AND m.kind = 'text' AND ${CLIENT_CONV}`, R),
    issue_invoice: () => countOne('SELECT COUNT(*) n FROM invoices WHERE business_id = :biz', R),
  };

  const keys = [...want];
  const counts = await Promise.all(keys.map((k) => q[k]()));
  const byKey = Object.fromEntries(keys.map((k, i) => [k, counts[i]]));

  const steps = visible.map((s) => {
    const n = byKey[s.key];
    return {
      key: s.key,
      stage: s.stage,
      core: s.core === 'manager' ? isManager : !!s.core,
      done: n === null ? null : n > 0,
    };
  });

  // 지금 단계 = 안 끝난 core 줄이 있는 첫 단계(null 은 막지 않는다). 다 끝났으면 null.
  let current = null;
  for (let st = 1; st <= STAGE_COUNT; st += 1) {
    if (steps.some((s) => s.stage === st && s.core && s.done === false)) { current = st; break; }
  }
  return { current, stage_count: STAGE_COUNT, steps };
}

module.exports = { getAdoptionStages, STEPS, STAGE_COUNT };
