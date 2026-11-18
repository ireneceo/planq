// AI 에이전트 — 업무 «참조(watcher)» 표면 (2026-11-18 Fable 설계 DESIGN-READY)
//
//   Irene «클로드가 업무를 추가해줬는데 참조에 이름을 넣을 수가 없어» — create_task 에 컨펌자만 있고 참조 칸·도구가 없었다.
//   · create_task.watcher_user_ids · add_task_watchers · get_task.watchers
//   · 추가 = MEDIUM(확인 2단계) — 알림(앱 + 메일) + 그 업무 볼 권한(숨은 업무도).
//   · 빼기는 화면에서만 — 남의 볼 권한 회수 = HIGH «권한»(2026-11-18 Fable 판정 A). 이름을 바꾸거나 가드 예외로 열지 않는다.
//   · 판정은 행동 계층 task_actions.checkWatcherCandidate 한 벌(addWatcher 본체·미리보기·만들기 전 판정이 같이 쓴다).
//     ★ assertAssignable 을 쓰지 않는다 — 고객을 통과시킨다(그건 컨펌자·담당자용).
//   · 자격 미달(고객·AI·다른 워크스페이스·퇴사자) = 거절(만들기 전) · 이미 이름 박힌 사람 = 빼고 watchers_skipped 로 보고.
//   · 반복 시리즈는 이 업무 한 건에만(series_scope 없음 — 여러 업무에 알림·권한이 퍼지는 «대량» 이다).
const { err, fromActionFailure } = require('../errors');
const { assertMenu } = require('../menu');

const tasks = () => require('./tasks');
const actions = () => require('../../actions/task_actions');

/** 참조자 명단 — 화면 GET /api/tasks/:id/workflow 와 같은 행(전부, 추가 순). 이름은 워크스페이스 표시명. */
async function watchersOf(p, taskId) {
  const { TaskWatcher } = require('../../../models');
  const rows = await TaskWatcher.findAll({ where: { task_id: taskId }, attributes: ['user_id'], order: [['created_at', 'ASC'], ['id', 'ASC']] });
  return Promise.all(rows.map(async (r) => ({ user_id: r.user_id, name: await tasks().memberName(p, r.user_id) })));
}

/** 반복 시리즈 안내 — 회차 생성기(recurringTaskGenerator)는 **시리즈 원본**의 참조자를 새로 만드는 회차에 복사한다. */
function seriesNote(t) {
  if (!t.recurrence_rule && !t.recurrence_parent_id) return null;
  const isOrigin = !!t.recurrence_rule && (!t.recurrence_parent_id || t.recurrence_parent_id === t.id);
  return isOrigin
    ? 'Applied to this task only. It is the series origin, so occurrences created from now on copy its watchers; existing occurrences are unchanged — change those in PlanQ.'
    : 'Applied to this occurrence only. To change the whole series, use PlanQ.';
}

/**
 * 후보 나누기 — 같은 판정(checkWatcherCandidate)으로 add / skip, 자격 미달은 던진다.
 * @returns {{ add:[{user_id,name}], skipped:[{user_id,reason}] }}
 */
async function classify(p, taskLike, ids, extraNamed = []) {
  const add = []; const skipped = [];
  for (const uid of [...new Set((ids || []).map(Number))]) {
    const r = await actions().checkWatcherCandidate(taskLike, uid, { extraNamed });
    if (r.ok) { add.push({ user_id: uid, name: await tasks().memberName(p, uid) }); continue; }
    if (r.code === 'already_named' || r.code === 'already_watcher') { skipped.push({ user_id: uid, reason: r.code }); continue; }
    throw err('VALIDATION_ERROR', r.code, { user_id: uid, hint: 'Watchers must be internal workspace members (not clients, AI or people outside this workspace). Find user_id with search_members.' });
  }
  return { add, skipped };
}

const ADD_NOTE = 'Each watcher is notified and can see this task (even if it is in a hidden project or private). Watchers do not need to sign off.';

// ── create_task.watcher_user_ids — 만들기 전 판정(업무를 만들지 않고 거절) ──
//   본인(작성자)·담당자·같은 호출의 컨펌자는 이미 이름이 박힌 사람 → skip.
async function checkNewTaskWatchers(p, a, assigneeId, reviewerIds = []) {
  if (!(a.watcher_user_ids || []).length) return { add: [], skipped: [] };
  const taskLike = { business_id: p.businessId, assignee_id: assigneeId, created_by: p.userId, request_by_user_id: null };
  return classify(p, taskLike, a.watcher_user_ids, reviewerIds);
}

/** create_task — 업무·컨펌자 뒤에 한 명씩 addWatcher(자기 트랜잭션·알림). 실패는 업무를 되돌리지 않고 watchers_failed. */
async function addAfterCreate(p, taskId, actor, plan) {
  const out = { watchers_added: [], watchers_skipped: [...plan.skipped] };
  const failed = [];
  for (const { user_id: uid, name } of plan.add) {
    const fresh = await tasks().loadTaskForSource(p, taskId);
    const r = await actions().addWatcher(fresh, actor, { userId: uid });
    if (r.ok) out.watchers_added.push({ user_id: uid, name });
    else if (r.code === 'already_named' || r.code === 'already_watcher') out.watchers_skipped.push({ user_id: uid, reason: r.code });
    else failed.push({ user_id: uid, reason: r.code || 'add_failed' });
  }
  if (!out.watchers_skipped.length) delete out.watchers_skipped;
  if (failed.length) out.watchers_failed = failed;
  out.watchers = await watchersOf(p, taskId);
  return out;
}

// ── add_task_watchers (MEDIUM) ──
async function loadForWatchers(p, taskId) {
  return tasks().loadTaskForSource(p, taskId);
}

async function planAdd(p, a) {
  const t = await loadForWatchers(p, a.task_id);
  if (!(await actions().canManageReviewers(t, p.userId))) throw err('PERMISSION_DENIED', 'forbidden_watchers', { hint: 'Only the assignee, the requester or a workspace owner/admin can add watchers.' });
  const plan = await classify(p, t, a.watcher_user_ids);
  if (!plan.add.length) throw err('CONFLICT', 'nothing_to_add', { watchers_skipped: plan.skipped, hint: 'Everyone is already on this task (assignee, requester, reviewer or watcher).' });
  return { t, plan };
}

async function previewAddWatchers(p, a) {
  await assertMenu(p, 'qtask', 'read');
  const { t, plan } = await planAdd(p, a);
  const series = seriesNote(t);
  return {
    task: { task_id: t.id, title: t.title },
    add_watchers: plan.add,
    ...(plan.skipped.length ? { watchers_skipped: plan.skipped } : {}),
    note: ADD_NOTE,
    ...(series ? { series_note: series } : {}),
  };
}

async function addWatchers(p, a, actor) {
  await assertMenu(p, 'qtask', 'write');
  const { t, plan } = await planAdd(p, a);
  const added = [];
  for (const { user_id: uid, name } of plan.add) {
    const fresh = await loadForWatchers(p, t.id);
    const r = await actions().addWatcher(fresh, actor, { userId: uid });
    if (!r.ok) throw fromActionFailure(r);
    added.push({ user_id: uid, name });
  }
  const series = seriesNote(t);
  return {
    task: { task_id: t.id, title: t.title },
    watchers_added: added,
    ...(plan.skipped.length ? { watchers_skipped: plan.skipped } : {}),
    watchers: await watchersOf(p, t.id),
    ...(series ? { series_note: series } : {}),
  };
}

module.exports = {
  watchersOf, checkNewTaskWatchers, addAfterCreate, ADD_NOTE,
  previewAddWatchers, addWatchers,
};
