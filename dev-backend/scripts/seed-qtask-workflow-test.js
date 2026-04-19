/**
 * Q Task 워크플로우 전 상태 시드 — 종류별 분리
 *
 * 워크스페이스: biz_id=6 (PlanQ 테스트 워크스페이스)
 * 프로젝트: project_id=35 (브랜드 리뉴얼)
 *
 *  ◆ M: 일반 업무 (manual, 요청자 없음)
 *    M1 not_started / M2 in_progress(컨펌0) / M3 in_progress(컨펌2)
 *    M4 reviewing R1 / M5 revision R1 / M6 reviewing R2 / M7 done_feedback / M8 completed
 *
 *  ◆ R: 내가 받은 요청 (internal_request, 요청자=owner, 담당자=irene)
 *    R1 task_requested (미확인) / R2 waiting (확인 완료)
 *    R3 in_progress / R4 reviewing R1 / R5 revision R1 / R6 done_feedback
 *
 *  ◆ S: 내가 보낸 요청 (requester=irene, assignee=member1/2)
 *    S1 task_requested (상대 미확인) / S2 in_progress / S3 reviewing (irene 리뷰어)
 *
 *  ◆ C: 내가 컨펌자 (assignee=다른사람)
 *    C1 reviewing (irene pending) / C2 reviewing (irene approved, 다른 1명 pending)
 *
 * idempotent — title prefix [WF] 로 시작하는 기존 항목 제거 후 재생성
 */

const { sequelize } = require('../config/database');
const { Task, TaskReviewer, TaskStatusHistory } = require('../models');

const BIZ = 3;
const IRENE = 3;
const OWNER = 15;
const MEMBER1 = 16;
const MEMBER2 = 17;
const PROJECT = 40;
const PREFIX = '[WF] ';

const today = new Date().toISOString().slice(0, 10);
const due = (addDays) => {
  const d = new Date(); d.setDate(d.getDate() + addDays);
  return d.toISOString().slice(0, 10);
};

async function wipe() {
  const old = await Task.findAll({ where: { business_id: BIZ } });
  for (const t of old) {
    if (t.title && t.title.startsWith(PREFIX)) {
      await TaskReviewer.destroy({ where: { task_id: t.id } });
      await TaskStatusHistory.destroy({ where: { task_id: t.id } });
      await t.destroy();
    }
  }
}

async function mk(opts) {
  return await Task.create({
    business_id: BIZ,
    project_id: PROJECT,
    title: PREFIX + opts.title,
    description: opts.description || null,
    assignee_id: opts.assignee_id,
    created_by: opts.created_by || IRENE,
    request_by_user_id: opts.request_by_user_id || null,
    source: opts.source || 'manual',
    status: opts.status || 'not_started',
    start_date: opts.start_date || today,
    due_date: opts.due_date || due(5),
    estimated_hours: opts.estimated_hours || 4,
    actual_hours: opts.actual_hours || 0,
    progress_percent: opts.progress_percent || 0,
    planned_week_start: opts.planned_week_start || null,
    request_ack_at: opts.request_ack_at || null,
    review_round: opts.review_round || 0,
    review_policy: opts.review_policy || 'all',
  });
}

async function addR(task, user_id, state = 'pending') {
  return await TaskReviewer.create({
    task_id: task.id, user_id, state,
    reverted_once: false,
    added_by_user_id: task.assignee_id || IRENE,
    action_at: state === 'pending' ? null : new Date(),
  });
}

async function hist(task, opts) {
  return await TaskStatusHistory.create({
    task_id: task.id,
    event_type: opts.event_type,
    from_status: opts.from_status || null,
    to_status: opts.to_status || null,
    actor_user_id: opts.actor || null,
    actor_role: opts.actor_role || null,
    target_user_id: opts.target || null,
    round: opts.round || null,
    note: opts.note || null,
  });
}

async function run() {
  await wipe();

  // ─── M: 일반 업무 (manual, 요청자 없음) ───
  await mk({ title: 'M1 미진행 (일반)', assignee_id: IRENE });
  await mk({ title: 'M2 진행중 (컨펌 없음, 일반)', assignee_id: IRENE, status: 'in_progress', progress_percent: 40 });

  const m3 = await mk({ title: 'M3 진행중 (컨펌자 2명 준비, 일반)', assignee_id: IRENE, status: 'in_progress', progress_percent: 80 });
  await addR(m3, OWNER); await addR(m3, MEMBER1);

  const m4 = await mk({ title: 'M4 확인요청중 R1 (일반)', assignee_id: IRENE, status: 'reviewing', progress_percent: 100, review_round: 1 });
  await addR(m4, OWNER); await addR(m4, MEMBER1);
  await hist(m4, { event_type: 'review_submit', from_status: 'in_progress', to_status: 'reviewing', actor: IRENE, actor_role: 'assignee', round: 1 });

  const m5 = await mk({ title: 'M5 수정필요 R1 (일반)', assignee_id: IRENE, status: 'revision_requested', progress_percent: 100, review_round: 1 });
  await addR(m5, OWNER, 'pending'); await addR(m5, MEMBER1, 'revision');
  await hist(m5, { event_type: 'review_submit', from_status: 'in_progress', to_status: 'reviewing', actor: IRENE, actor_role: 'assignee', round: 1 });
  await hist(m5, { event_type: 'revision', actor: MEMBER1, actor_role: 'reviewer', round: 1, note: '섹션 구조를 단순화해주세요.' });

  const m6 = await mk({ title: 'M6 확인요청중 R2 (재제출, 일반)', assignee_id: IRENE, status: 'reviewing', progress_percent: 100, review_round: 2 });
  await addR(m6, OWNER, 'pending'); await addR(m6, MEMBER1, 'pending');
  await hist(m6, { event_type: 'review_submit', from_status: 'in_progress', to_status: 'reviewing', actor: IRENE, actor_role: 'assignee', round: 1 });
  await hist(m6, { event_type: 'revision', actor: MEMBER1, actor_role: 'reviewer', round: 1, note: '섹션 구조를 단순화해주세요.' });
  await hist(m6, { event_type: 'review_submit', from_status: 'revision_requested', to_status: 'reviewing', actor: IRENE, actor_role: 'assignee', round: 2, note: '피드백 반영 완료' });

  const m7 = await mk({ title: 'M7 마무리 대기 (전원 승인, 일반)', assignee_id: IRENE, status: 'done_feedback', progress_percent: 100, review_round: 1 });
  await addR(m7, OWNER, 'approved'); await addR(m7, MEMBER1, 'approved');
  await hist(m7, { event_type: 'review_submit', from_status: 'in_progress', to_status: 'reviewing', actor: IRENE, actor_role: 'assignee', round: 1 });
  await hist(m7, { event_type: 'approve', actor: MEMBER1, actor_role: 'reviewer', round: 1 });
  await hist(m7, { event_type: 'approve', actor: OWNER, actor_role: 'reviewer', round: 1 });

  await mk({ title: 'M8 완료 (일반)', assignee_id: IRENE, status: 'completed', progress_percent: 100, actual_hours: 5 });

  // ─── R: 내가 받은 요청 (owner → irene) ───
  const r1 = await mk({
    title: 'R1 업무요청 받음 (미확인)',
    assignee_id: IRENE, created_by: OWNER, request_by_user_id: OWNER,
    source: 'internal_request', status: 'not_started',
  });
  await hist(r1, { event_type: 'request', actor: OWNER, actor_role: 'requester', target: IRENE });

  const r2 = await mk({
    title: 'R2 진행대기 (확인 완료)',
    assignee_id: IRENE, created_by: OWNER, request_by_user_id: OWNER,
    source: 'internal_request', status: 'waiting', request_ack_at: new Date(),
    planned_week_start: today,
  });
  await hist(r2, { event_type: 'request', actor: OWNER, actor_role: 'requester', target: IRENE });
  await hist(r2, { event_type: 'ack', actor: IRENE, actor_role: 'assignee' });

  const r3 = await mk({
    title: 'R3 진행중 (요청 업무)',
    assignee_id: IRENE, created_by: OWNER, request_by_user_id: OWNER,
    source: 'internal_request', status: 'in_progress', progress_percent: 50,
    request_ack_at: new Date(),
  });
  await hist(r3, { event_type: 'request', actor: OWNER, actor_role: 'requester', target: IRENE });
  await hist(r3, { event_type: 'ack', actor: IRENE, actor_role: 'assignee' });

  const r4 = await mk({
    title: 'R4 확인요청중 R1 (요청 업무)',
    assignee_id: IRENE, created_by: OWNER, request_by_user_id: OWNER,
    source: 'internal_request', status: 'reviewing', progress_percent: 100,
    request_ack_at: new Date(), review_round: 1,
  });
  await addR(r4, OWNER); await addR(r4, MEMBER1);
  await hist(r4, { event_type: 'review_submit', from_status: 'in_progress', to_status: 'reviewing', actor: IRENE, actor_role: 'assignee', round: 1 });

  const r5 = await mk({
    title: 'R5 수정필요 R1 (요청 업무)',
    assignee_id: IRENE, created_by: OWNER, request_by_user_id: OWNER,
    source: 'internal_request', status: 'revision_requested', progress_percent: 100,
    request_ack_at: new Date(), review_round: 1,
  });
  await addR(r5, OWNER, 'revision'); await addR(r5, MEMBER1, 'pending');
  await hist(r5, { event_type: 'review_submit', from_status: 'in_progress', to_status: 'reviewing', actor: IRENE, actor_role: 'assignee', round: 1 });
  await hist(r5, { event_type: 'revision', actor: OWNER, actor_role: 'reviewer', round: 1, note: '상단 카피 톤을 더 부드럽게.' });

  const r6 = await mk({
    title: 'R6 마무리 대기 (요청 업무)',
    assignee_id: IRENE, created_by: OWNER, request_by_user_id: OWNER,
    source: 'internal_request', status: 'done_feedback', progress_percent: 100,
    request_ack_at: new Date(), review_round: 1,
  });
  await addR(r6, OWNER, 'approved'); await addR(r6, MEMBER1, 'approved');

  // ─── S: 내가 보낸 요청 (irene → member1/2) ───
  const s1 = await mk({
    title: 'S1 내가 요청 (상대 미확인)',
    assignee_id: MEMBER1, created_by: IRENE, request_by_user_id: IRENE,
    source: 'internal_request', status: 'not_started',
  });
  await hist(s1, { event_type: 'request', actor: IRENE, actor_role: 'requester', target: MEMBER1 });

  const s2 = await mk({
    title: 'S2 내가 요청 (상대 진행중)',
    assignee_id: MEMBER1, created_by: IRENE, request_by_user_id: IRENE,
    source: 'internal_request', status: 'in_progress', progress_percent: 30,
    request_ack_at: new Date(),
  });
  await hist(s2, { event_type: 'request', actor: IRENE, actor_role: 'requester', target: MEMBER1 });
  await hist(s2, { event_type: 'ack', actor: MEMBER1, actor_role: 'assignee' });

  const s3 = await mk({
    title: 'S3 내가 요청 + 컨펌자',
    assignee_id: MEMBER2, created_by: IRENE, request_by_user_id: IRENE,
    source: 'internal_request', status: 'reviewing', progress_percent: 100,
    request_ack_at: new Date(), review_round: 1,
  });
  await addR(s3, IRENE, 'pending');
  await hist(s3, { event_type: 'request', actor: IRENE, actor_role: 'requester', target: MEMBER2 });
  await hist(s3, { event_type: 'review_submit', from_status: 'in_progress', to_status: 'reviewing', actor: MEMBER2, actor_role: 'assignee', round: 1 });

  // ─── C: 내가 컨펌자 (다른 담당자) ───
  const c1 = await mk({
    title: 'C1 내가 컨펌자 (대기중)',
    assignee_id: MEMBER1, created_by: OWNER, request_by_user_id: OWNER,
    source: 'internal_request', status: 'reviewing', progress_percent: 100,
    request_ack_at: new Date(), review_round: 1,
  });
  await addR(c1, IRENE, 'pending'); await addR(c1, OWNER, 'pending');
  await hist(c1, { event_type: 'review_submit', from_status: 'in_progress', to_status: 'reviewing', actor: MEMBER1, actor_role: 'assignee', round: 1 });

  const c2 = await mk({
    title: 'C2 내가 컨펌자 (내가 이미 승인함)',
    assignee_id: MEMBER2, created_by: OWNER, request_by_user_id: OWNER,
    source: 'internal_request', status: 'reviewing', progress_percent: 100,
    request_ack_at: new Date(), review_round: 1,
  });
  await addR(c2, IRENE, 'approved'); await addR(c2, OWNER, 'pending');
  await hist(c2, { event_type: 'review_submit', from_status: 'in_progress', to_status: 'reviewing', actor: MEMBER2, actor_role: 'assignee', round: 1 });
  await hist(c2, { event_type: 'approve', actor: IRENE, actor_role: 'reviewer', round: 1 });

  console.log('✓ Q Task 시나리오 시드 완료');
  console.log('  M1~M8  일반 업무 (요청자 없음)   — 8건');
  console.log('  R1~R6  내가 받은 요청            — 6건');
  console.log('  S1~S3  내가 보낸 요청            — 3건');
  console.log('  C1~C2  내가 컨펌자               — 2건');
  console.log('  합계 19건 — irene@irenecompany.com 로그인 후 https://dev.planq.kr/tasks');
}

run().then(() => sequelize.close()).catch((e) => { console.error(e); sequelize.close(); process.exit(1); });
