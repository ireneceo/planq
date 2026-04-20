// Q Project 다양성 시드 — 6가지 시나리오로 프로젝트 생성.
//
// 시나리오 A: 진행 중 일반 (fixed, 진척률 ~50%)
// 시나리오 B: 지연 업무 다수 (fixed, overdue)
// 시나리오 C: 완료 직전 (fixed, 진척률 95%)
// 시나리오 D: 신규 (업무 0, 빈 대시보드 확인)
// 시나리오 E: 지속 구독 (ongoing)
// 시나리오 F: 다수 멤버 + 복수 채널 + 이슈/메모
//
// 멱등: 제목이 [SAMPLE] 로 시작하는 기존 것 재생성
// 대상 bizId: 환경변수 BIZ_ID (기본 6, owner@test.planq.kr 소유)
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const {
  sequelize, Project, ProjectMember, ProjectClient, ProjectNote, ProjectIssue,
  Task, TaskReviewer, Conversation, Business, BusinessMember, User,
} = require('../models');

const BIZ_ID = Number(process.env.BIZ_ID || 6);
const PREFIX = '[SAMPLE]';

function daysFrom(today, offset) {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

(async () => {
  const biz = await Business.findByPk(BIZ_ID);
  if (!biz) throw new Error(`Business ${BIZ_ID} not found`);
  console.log(`[target] business=${biz.name || biz.brand_name} (id=${BIZ_ID})`);

  const members = await BusinessMember.findAll({
    where: { business_id: BIZ_ID },
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'is_ai'] }],
  });
  const humans = members.filter((m) => !m.user?.is_ai);
  if (humans.length === 0) throw new Error('no human members');
  const owner = humans[0];
  const others = humans.slice(1);
  console.log(`[members] owner=${owner.user.name} others=${others.map(m=>m.user.name).join(', ')||'-'}`);

  // 기존 샘플 제거 (멱등)
  const existing = await Project.findAll({
    where: { business_id: BIZ_ID, name: { [require('sequelize').Op.like]: `${PREFIX}%` } },
  });
  if (existing.length > 0) {
    const ids = existing.map((p) => p.id);
    await Task.destroy({ where: { project_id: ids } });
    await ProjectNote.destroy({ where: { project_id: ids } });
    await ProjectIssue.destroy({ where: { project_id: ids } });
    await Conversation.destroy({ where: { project_id: ids } });
    await ProjectMember.destroy({ where: { project_id: ids } });
    await ProjectClient.destroy({ where: { project_id: ids } });
    await Project.destroy({ where: { id: ids } });
    console.log(`[cleanup] removed ${existing.length} existing [SAMPLE] projects`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const created = [];

  async function makeProject(attrs, tasks = [], memberIds = [], noteBodies = [], issueBodies = []) {
    const proj = await Project.create({
      business_id: BIZ_ID,
      owner_user_id: owner.user_id,
      status: 'active',
      ...attrs,
    });
    await ProjectMember.create({
      project_id: proj.id, user_id: owner.user_id, role: '오너', role_order: 0,
    });
    for (const uid of memberIds) {
      await ProjectMember.create({
        project_id: proj.id, user_id: uid, role: '팀원', role_order: 1,
      });
    }
    for (const t of tasks) {
      await Task.create({
        business_id: BIZ_ID, project_id: proj.id,
        title: t.title, description: t.description || null,
        status: t.status || 'not_started',
        start_date: t.start_date || null, due_date: t.due_date || null,
        estimated_hours: t.estimated_hours ?? null,
        actual_hours: t.actual_hours ?? 0,
        progress_percent: t.progress_percent ?? 0,
        assignee_id: t.assignee_id || owner.user_id,
        created_by: owner.user_id,
        source: t.source || 'manual',
      });
    }
    for (const body of noteBodies) {
      await ProjectNote.create({ project_id: proj.id, body, visibility: 'internal', author_user_id: owner.user_id });
    }
    for (const body of issueBodies) {
      await ProjectIssue.create({ project_id: proj.id, body, author_user_id: owner.user_id });
    }
    created.push(proj);
    return proj;
  }

  // A. 진행 중 일반
  await makeProject(
    { name: `${PREFIX} A. 진행 중 일반`, description: '평범한 진행 중 프로젝트. 업무 진척률 ~50%',
      project_type: 'fixed', client_company: 'Acme Co.',
      start_date: daysFrom(today, -14), end_date: daysFrom(today, 21), color: '#14B8A6' },
    [
      { title: '킥오프 미팅', status: 'completed', progress_percent: 100, start_date: daysFrom(today, -14), due_date: daysFrom(today, -13), estimated_hours: 2, actual_hours: 2 },
      { title: '요구사항 정리', status: 'completed', progress_percent: 100, start_date: daysFrom(today, -12), due_date: daysFrom(today, -8), estimated_hours: 8, actual_hours: 7 },
      { title: '와이어프레임', status: 'in_progress', progress_percent: 60, start_date: daysFrom(today, -5), due_date: daysFrom(today, 3), estimated_hours: 12, actual_hours: 7 },
      { title: '프로토타입 개발', status: 'not_started', progress_percent: 0, start_date: daysFrom(today, 4), due_date: daysFrom(today, 14), estimated_hours: 24 },
      { title: '사용자 테스트', status: 'not_started', progress_percent: 0, start_date: daysFrom(today, 15), due_date: daysFrom(today, 21), estimated_hours: 8 },
    ],
    others.slice(0, 2).map((m) => m.user_id),
    ['1차 시안 금요일 납기, 월요일 임원 미팅 예정'],
    [],
  );

  // B. 지연 업무 다수
  await makeProject(
    { name: `${PREFIX} B. 지연 위험`, description: '마감이 지난 업무가 다수. 복구 필요',
      project_type: 'fixed', client_company: 'Beta Corp.',
      start_date: daysFrom(today, -30), end_date: daysFrom(today, -1), color: '#F43F5E' },
    [
      { title: '레거시 DB 분석', status: 'in_progress', progress_percent: 40, start_date: daysFrom(today, -20), due_date: daysFrom(today, -5), estimated_hours: 16, actual_hours: 9 },
      { title: '마이그레이션 스크립트 작성', status: 'in_progress', progress_percent: 30, start_date: daysFrom(today, -15), due_date: daysFrom(today, -2), estimated_hours: 20, actual_hours: 7 },
      { title: '스테이징 테스트', status: 'not_started', progress_percent: 0, start_date: daysFrom(today, -3), due_date: daysFrom(today, -1), estimated_hours: 6 },
      { title: '배포 준비', status: 'not_started', progress_percent: 0, start_date: daysFrom(today, -2), due_date: daysFrom(today, 0), estimated_hours: 4 },
    ],
    others.slice(0, 1).map((m) => m.user_id),
    [],
    ['일정 재조정 필요', '스테이징 DB 권한 아직 미확보'],
  );

  // C. 완료 직전
  await makeProject(
    { name: `${PREFIX} C. 완료 직전`, description: '거의 다 끝냈고 마무리 작업만 남음',
      project_type: 'fixed', client_company: 'Gamma Inc.',
      start_date: daysFrom(today, -30), end_date: daysFrom(today, 3), color: '#22C55E' },
    [
      { title: '전체 설계', status: 'completed', progress_percent: 100, start_date: daysFrom(today, -30), due_date: daysFrom(today, -20), estimated_hours: 16, actual_hours: 15 },
      { title: '개발', status: 'completed', progress_percent: 100, start_date: daysFrom(today, -19), due_date: daysFrom(today, -5), estimated_hours: 60, actual_hours: 58 },
      { title: 'QA', status: 'completed', progress_percent: 100, start_date: daysFrom(today, -4), due_date: daysFrom(today, -1), estimated_hours: 8, actual_hours: 7 },
      { title: '배포', status: 'in_progress', progress_percent: 80, start_date: daysFrom(today, 0), due_date: daysFrom(today, 1), estimated_hours: 4, actual_hours: 3 },
      { title: '인수 테스트', status: 'reviewing', progress_percent: 100, start_date: daysFrom(today, 2), due_date: daysFrom(today, 3), estimated_hours: 2, actual_hours: 2 },
    ],
    others.slice(0, 1).map((m) => m.user_id),
    ['납품 체크리스트 최종 확인'],
    [],
  );

  // D. 신규 (업무 0)
  await makeProject(
    { name: `${PREFIX} D. 신규 프로젝트`, description: '방금 시작. 업무 설계 전',
      project_type: 'fixed', client_company: 'Delta Ltd.',
      start_date: daysFrom(today, 0), end_date: daysFrom(today, 60), color: '#3B82F6' },
    [],
    others.slice(0, 1).map((m) => m.user_id),
    [],
    [],
  );

  // E. 지속 구독
  await makeProject(
    { name: `${PREFIX} E. 월간 유지보수`, description: '매월 반복되는 유지보수 계약',
      project_type: 'ongoing', client_company: 'Epsilon Enterprise',
      start_date: daysFrom(today, -180), end_date: null, color: '#A855F7' },
    [
      { title: '이번 달 정기 점검', status: 'in_progress', progress_percent: 50, start_date: daysFrom(today, -3), due_date: daysFrom(today, 4), estimated_hours: 6, actual_hours: 3 },
      { title: '보안 패치 적용', status: 'not_started', progress_percent: 0, start_date: daysFrom(today, 7), due_date: daysFrom(today, 10), estimated_hours: 4 },
      { title: '고객 문의 대응', status: 'in_progress', progress_percent: 30, start_date: daysFrom(today, -3), due_date: daysFrom(today, 27), estimated_hours: 10, actual_hours: 3 },
    ],
    others.slice(0, 2).map((m) => m.user_id),
    ['매월 첫 주 점검 보고서 공유'],
    [],
  );

  // F. 복합 — 다수 멤버, 다양한 상태
  await makeProject(
    { name: `${PREFIX} F. 복합 시나리오`, description: '다양한 상태의 업무 + 다수 멤버',
      project_type: 'fixed', client_company: 'Zeta Group',
      start_date: daysFrom(today, -21), end_date: daysFrom(today, 35), color: '#F59E0B' },
    [
      { title: '기획 단계 워크샵', status: 'completed', progress_percent: 100, start_date: daysFrom(today, -21), due_date: daysFrom(today, -19), estimated_hours: 6, actual_hours: 6 },
      { title: '리서치 보고서 작성', status: 'done_feedback', progress_percent: 100, start_date: daysFrom(today, -18), due_date: daysFrom(today, -10), estimated_hours: 10, actual_hours: 9, assignee_id: others[0]?.user_id || owner.user_id },
      { title: '디자인 시안 3안', status: 'reviewing', progress_percent: 100, start_date: daysFrom(today, -9), due_date: daysFrom(today, -1), estimated_hours: 16, actual_hours: 17, assignee_id: others[0]?.user_id || owner.user_id },
      { title: '콘텐츠 카피라이팅', status: 'revision_requested', progress_percent: 70, start_date: daysFrom(today, -5), due_date: daysFrom(today, 3), estimated_hours: 8, actual_hours: 6, assignee_id: others[1]?.user_id || owner.user_id },
      { title: '프론트엔드 구현', status: 'in_progress', progress_percent: 45, start_date: daysFrom(today, 0), due_date: daysFrom(today, 18), estimated_hours: 40, actual_hours: 18, assignee_id: others[0]?.user_id || owner.user_id },
      { title: '백엔드 API', status: 'in_progress', progress_percent: 30, start_date: daysFrom(today, 2), due_date: daysFrom(today, 20), estimated_hours: 32, actual_hours: 9 },
      { title: '통합 테스트', status: 'not_started', progress_percent: 0, start_date: daysFrom(today, 22), due_date: daysFrom(today, 28), estimated_hours: 8 },
      { title: '납품 준비', status: 'waiting', progress_percent: 0, start_date: daysFrom(today, 30), due_date: daysFrom(today, 35), estimated_hours: 4, source: 'internal_request' },
    ],
    others.slice(0, 3).map((m) => m.user_id),
    ['전체 진행 보고는 격주 금요일', '디자인 방향성 2안 확정'],
    ['카피 수정 요청 → 2일내 반영 필요', '백엔드 배포 일정 확인 필요'],
  );

  console.log(`\n[created] ${created.length} sample projects:`);
  for (const p of created) console.log(`  - id=${p.id} "${p.name}" type=${p.project_type}`);

  await sequelize.close();
  console.log('\n✅ done');
})().catch((e) => { console.error(e); process.exit(1); });
