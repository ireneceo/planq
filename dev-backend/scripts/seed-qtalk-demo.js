// Q Talk 데모 데이터 시드 (idempotent — 재실행 시 이전 데모 데이터 정리 후 재생성)
//
// 생성 대상 워크스페이스:
//   - "PlanQ 테스트 워크스페이스" (id=6) — owner@test.planq.kr 소유
//   - "워프로랩" (id=3) — irene@irenecompany.com 소유
//
// 각 워크스페이스에 2~3개 프로젝트, 프로젝트마다 2채널 (내부 + 고객),
// 메시지·업무·메모·이슈·업무후보 모두 포함.

require('dotenv').config();
const { sequelize } = require('../config/database');
const {
  User, Business, BusinessMember, Client,
  Project, ProjectMember, ProjectClient,
  Conversation, ConversationParticipant, Message,
  Task, ProjectNote, ProjectIssue, TaskCandidate,
} = require('../models');

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────
const DEMO_TAG = '[Q_TALK_DEMO]';
const tagged = (s) => s.startsWith(DEMO_TAG) ? s : `${DEMO_TAG} ${s}`;
const isTagged = (s) => (s || '').startsWith(DEMO_TAG);

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function hoursAgo(n) {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

// ─────────────────────────────────────────────
// 팀 기본 역할 세팅 (business_members.default_role)
// ─────────────────────────────────────────────
async function setDefaultRoles() {
  const mapping = [
    // 테스트 워크스페이스 (id=6)
    { business_id: 6, user_email: 'owner@test.planq.kr', role: '기획' },
    { business_id: 6, user_email: 'member1@test.planq.kr', role: '디자인' },
    { business_id: 6, user_email: 'member2@test.planq.kr', role: '개발' },
    { business_id: 6, user_email: 'irene@irenecompany.com', role: '기획' },
    // 워프로랩 (id=3) — irene 소유
    { business_id: 3, user_email: 'irene@irenecompany.com', role: '기획' },
  ];
  for (const m of mapping) {
    const user = await User.findOne({ where: { email: m.user_email } });
    if (!user) continue;
    const bm = await BusinessMember.findOne({ where: { business_id: m.business_id, user_id: user.id } });
    if (bm) {
      await bm.update({ default_role: m.role });
    }
  }
  console.log('기본 역할 세팅 완료');
}

// ─────────────────────────────────────────────
// 기존 데모 데이터 정리
// ─────────────────────────────────────────────
async function cleanupDemo() {
  // 데모 시드로 만든 프로젝트 식별: name 기준 (알려진 5개) + 태그 잔재
  const demoNames = [
    '브랜드 리뉴얼', '패키지 디자인', '내부 툴 개선',
    '클라이언트 온보딩 자동화', 'AI 어시스턴트 리서치',
  ];
  const projs = await Project.findAll();
  const demoIds = projs
    .filter((p) => isTagged(p.name) || demoNames.some((n) => p.name === n || p.name.endsWith(n)))
    .map((p) => p.id);
  if (demoIds.length === 0) {
    console.log('이전 데모 데이터 없음');
    return;
  }
  // 수동 삭제 (FK CASCADE 지원되는 것만) + project_id 로 관련 테이블 정리
  await TaskCandidate.destroy({ where: { project_id: demoIds } });
  await ProjectNote.destroy({ where: { project_id: demoIds } });
  await ProjectIssue.destroy({ where: { project_id: demoIds } });
  await Task.destroy({ where: { project_id: demoIds } });
  // conversations + messages — project_id 연결된 것만
  const convs = await Conversation.findAll({ where: { project_id: demoIds } });
  const convIds = convs.map((c) => c.id);
  if (convIds.length) {
    await Message.destroy({ where: { conversation_id: convIds } });
    await ConversationParticipant.destroy({ where: { conversation_id: convIds } });
    await Conversation.destroy({ where: { id: convIds } });
  }
  await ProjectMember.destroy({ where: { project_id: demoIds } });
  await ProjectClient.destroy({ where: { project_id: demoIds } });
  await Project.destroy({ where: { id: demoIds } });
  console.log(`이전 데모 ${demoIds.length}개 프로젝트 정리 완료`);
}

// ─────────────────────────────────────────────
// 프로젝트 1개 풀 시드
// ─────────────────────────────────────────────
async function seedOneProject({
  businessId,
  name,
  clientCompany,
  description,
  startDate,
  endDate,
  ownerUserId,
  memberUserIds, // [{user_id, role, is_default}]
  clientContacts, // [{name, email}]
  messageScenario, // 'full' | 'early' | 'review'
  status = 'active',
}) {
  const defaultAssigneeId = memberUserIds.find((m) => m.is_default)?.user_id || ownerUserId;

  // 1) Project (이름은 원본 그대로, 태그는 별도 description 에 보관)
  const project = await Project.create({
    business_id: businessId,
    name,
    description,
    client_company: clientCompany,
    status,
    start_date: startDate,
    end_date: endDate,
    default_assignee_user_id: defaultAssigneeId,
    owner_user_id: ownerUserId,
  });

  // 2) ProjectMembers
  for (const m of memberUserIds) {
    await ProjectMember.create({
      project_id: project.id,
      user_id: m.user_id,
      role: m.role,
      role_order: 0,
    });
  }

  // 3) ProjectClients (초대 링크 토큰 포함)
  // contact_user_id 가 주어지면 그 사용자를 참여자로 바로 연결 (초대 수락된 상태로 시뮬레이션)
  const crypto = require('crypto');
  for (const c of clientContacts) {
    await ProjectClient.create({
      project_id: project.id,
      contact_user_id: c.contact_user_id || null,
      contact_name: c.name,
      contact_email: c.email,
      invite_token: crypto.randomBytes(24).toString('hex'),
      invite_token_used_at: c.contact_user_id ? new Date() : null,
      invited_by: ownerUserId,
    });
  }

  // 4) Conversations — 내부 + 고객
  const internalConv = await Conversation.create({
    business_id: businessId,
    project_id: project.id,
    channel_type: 'internal',
    display_name: '내부 논의',
    title: `${name} / 내부 논의`,
    status: 'active',
    auto_extract_enabled: false,
    cue_enabled: true,
  });
  const customerConv = await Conversation.create({
    business_id: businessId,
    project_id: project.id,
    channel_type: 'customer',
    display_name: `${clientCompany} 와의 소통`,
    title: `${name} / ${clientCompany}`,
    status: 'active',
    auto_extract_enabled: true,
    cue_enabled: true,
  });

  // 5) Messages — 시나리오별
  const ownerSender = ownerUserId;
  const designerSender = memberUserIds.find((m) => m.role === '디자인')?.user_id || memberUserIds[0].user_id;
  const devSender = memberUserIds.find((m) => m.role === '개발')?.user_id || memberUserIds[0].user_id;

  // 내부 논의 공통 메시지
  await Message.create({
    conversation_id: internalConv.id, sender_id: ownerSender,
    content: `${name} 킥오프 — 이번 주 내로 1차 시안 방향 잡아봅시다.`,
    created_at: daysAgo(4), updated_at: daysAgo(4),
  });
  await Message.create({
    conversation_id: internalConv.id, sender_id: designerSender,
    content: '컬러 레퍼런스 3종 정리해서 공유 드릴게요. 폰트는 Pretendard + Noto Serif 로 가볼까 해요.',
    created_at: daysAgo(3), updated_at: daysAgo(3),
  });
  await Message.create({
    conversation_id: internalConv.id, sender_id: ownerSender,
    content: '폰트 라이선스 확인 필요. 상업 사용 범위 체크해주세요.',
    created_at: daysAgo(2), updated_at: daysAgo(2),
  });

  // 고객 소통 시나리오
  if (messageScenario === 'full') {
    await Message.create({
      conversation_id: customerConv.id, sender_id: ownerSender,
      content: `안녕하세요 ${clientContacts[0]?.name || '대표'}님, ${name} 프로젝트 킥오프 일정 공유드립니다. 금주 내 1차 시안 공유 예정입니다.`,
      created_at: daysAgo(4), updated_at: daysAgo(4),
    });
    // 고객 질문 메시지 (is_question flag 는 현 스키마엔 없으므로 본문에 ? 포함)
    const clientMsg1 = await Message.create({
      conversation_id: customerConv.id, sender_id: ownerSender, // mock: 외부 user 없으니 owner 를 고객 대리로
      content: '감사합니다. 시안은 기존 컬러 방향 유지인가요, 아니면 새로운 방향도 섞이나요?',
      created_at: daysAgo(3), updated_at: daysAgo(3),
    });
    await Message.create({
      conversation_id: customerConv.id, sender_id: designerSender,
      content: '기존 컬러 방향을 기반으로 하고, 보조색 2종을 추가 제안 드릴 예정입니다. 금요일까지 전달드리겠습니다.',
      created_at: daysAgo(3), updated_at: daysAgo(3),
      reply_to_message_id: clientMsg1.id,
    });
    const clientMsg2 = await Message.create({
      conversation_id: customerConv.id, sender_id: ownerSender,
      content: '월요일 임원 미팅이 있어서 금요일 오전까지 받을 수 있을까요? 주말에 검토해보고 월요일 오전에 피드백 드리겠습니다.',
      created_at: hoursAgo(18), updated_at: hoursAgo(18),
    });
    await Message.create({
      conversation_id: customerConv.id, sender_id: ownerSender,
      content: '네, 금요일 오전 11시까지 전달 가능합니다. 일정 반영해서 작업 진행하겠습니다.',
      created_at: hoursAgo(17), updated_at: hoursAgo(17),
      reply_to_message_id: clientMsg2.id,
    });
    await Message.create({
      conversation_id: customerConv.id, sender_id: ownerSender,
      content: '참고 이미지와 톤 레퍼런스도 같이 공유 부탁드립니다.',
      created_at: hoursAgo(2), updated_at: hoursAgo(2),
    });
  } else if (messageScenario === 'early') {
    await Message.create({
      conversation_id: customerConv.id, sender_id: ownerSender,
      content: `안녕하세요, ${name} 프로젝트 시작합니다. 자료 준비되는 대로 공유드리겠습니다.`,
      created_at: daysAgo(1), updated_at: daysAgo(1),
    });
  } else if (messageScenario === 'review') {
    await Message.create({
      conversation_id: customerConv.id, sender_id: ownerSender,
      content: '이번 주 납품본 확인 부탁드립니다.',
      created_at: daysAgo(2), updated_at: daysAgo(2),
    });
    await Message.create({
      conversation_id: customerConv.id, sender_id: ownerSender,
      content: '확인했습니다. 세부 피드백 정리해서 다시 드릴게요.',
      created_at: daysAgo(1), updated_at: daysAgo(1),
    });
  }

  // 6) Tasks — 다양한 상태
  const taskSpecs = [
    { title: '1차 시안 3종 제안', assignee: designerSender, status: 'in_progress', due: daysFromNow(3) },
    { title: '폰트 라이선스 검토', assignee: designerSender, status: 'task_requested', due: daysFromNow(1) },
    { title: '컬러 팔레트 확정', assignee: ownerSender, status: 'review_requested', due: daysFromNow(7) },
    { title: '매주 월요일 스탠드업', assignee: ownerSender, status: 'in_progress', due: null, recurrence: 'weekly' },
    { title: '와이어프레임 초안', assignee: devSender, status: 'waiting', due: daysFromNow(14) },
  ];
  const createdTasks = [];
  for (const t of taskSpecs) {
    const task = await Task.create({
      business_id: businessId,
      project_id: project.id,
      client_id: null,
      title: t.title,
      assigned_to: t.assignee,
      created_by: ownerSender,
      status: t.status,
      due_date: t.due,
      recurrence: t.recurrence || null,
    });
    createdTasks.push(task);
  }

  // 7) Project Notes — 개인 / 내부 섞어서
  const noteSpecs = [
    { author: ownerSender, visibility: 'internal', body: '폰트 라이선스는 Pretendard 무료, Noto Serif OFL 확인 필요', ago: 8 },
    { author: ownerSender, visibility: 'personal', body: '월요일 미팅 대비 시안 피드백 일정 체크 — 주말 작업 최소화', ago: 20 },
    { author: designerSender, visibility: 'internal', body: '컬러 시스템 가이드라인 문서화 필요. 향후 유지보수 용이성', ago: 32 },
    { author: ownerSender, visibility: 'internal', body: '예산 재검토 — 웹사이트 개발 범위 논의 필요', ago: 48 },
  ];
  for (const n of noteSpecs) {
    await ProjectNote.create({
      project_id: project.id,
      author_user_id: n.author,
      visibility: n.visibility,
      body: n.body,
      created_at: hoursAgo(n.ago),
      updated_at: hoursAgo(n.ago),
    });
  }

  // 8) Project Issues
  const issueSpecs = [
    { body: `${name} — 1차 시안 금요일 납기, 월요일 임원 미팅 예정`, ago: 2 },
    { body: '폰트 라이선스 검토 중 — Noto Serif OFL 확인 필요', ago: 20 },
    { body: '웹사이트 개발 범위 재정의 필요 — 예산 재검토', ago: 40 },
    { body: '컬러 팔레트 A안 vs B안 이견 → 내주 미팅에서 결정', ago: 65 },
  ];
  for (const i of issueSpecs) {
    await ProjectIssue.create({
      project_id: project.id,
      body: i.body,
      author_user_id: ownerSender,
      created_at: hoursAgo(i.ago),
      updated_at: hoursAgo(i.ago),
    });
  }

  // 9) Task Candidates — pending 몇 개
  if (messageScenario === 'full') {
    await TaskCandidate.create({
      project_id: project.id,
      conversation_id: customerConv.id,
      source_message_ids: [], // 실 메시지 id 매핑 생략 (mock 범위)
      title: '금요일 오전 11시까지 1차 시안 3종 전달',
      description: '고객이 월요일 임원 미팅 때문에 금요일 오전 요청. 기존 컬러 방향 유지 + 보조색 2종 제안.',
      guessed_role: '디자인',
      guessed_assignee_user_id: designerSender,
      guessed_due_date: daysFromNow(2),
      similar_task_id: createdTasks[0].id,
      status: 'pending',
    });
    await TaskCandidate.create({
      project_id: project.id,
      conversation_id: customerConv.id,
      source_message_ids: [],
      title: '참고 이미지 및 톤 레퍼런스 공유',
      description: '고객이 별도 요청한 참고 자료 준비',
      guessed_role: '디자인',
      guessed_assignee_user_id: designerSender,
      guessed_due_date: daysFromNow(1),
      status: 'pending',
    });
  }

  return project;
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
(async () => {
  try {
    await sequelize.authenticate();
    console.log('DB 연결 OK\n');

    await setDefaultRoles();
    await cleanupDemo();

    // 사용자 조회
    const owner = await User.findOne({ where: { email: 'owner@test.planq.kr' } });
    const m1 = await User.findOne({ where: { email: 'member1@test.planq.kr' } });
    const m2 = await User.findOne({ where: { email: 'member2@test.planq.kr' } });
    const client = await User.findOne({ where: { email: 'client@test.planq.kr' } });
    const irene = await User.findOne({ where: { email: 'irene@irenecompany.com' } });
    if (!owner || !m1 || !m2 || !client || !irene) throw new Error('테스트 사용자 누락 — create-test-accounts.js 먼저 실행');

    // ── 테스트 워크스페이스 (id=6) 3개 프로젝트 ──
    console.log('\n[테스트 워크스페이스] 프로젝트 시드');
    await seedOneProject({
      businessId: 6,
      name: '브랜드 리뉴얼',
      clientCompany: 'Acme Corp',
      description: '로고 + 컬러 시스템 + 웹사이트 리뉴얼',
      startDate: '2026-03-01',
      endDate: '2026-05-31',
      ownerUserId: owner.id,
      memberUserIds: [
        { user_id: owner.id, role: '기획', is_default: true },
        { user_id: m1.id, role: '디자인', is_default: false },
        { user_id: m2.id, role: '개발', is_default: false },
      ],
      clientContacts: [
        { name: '최고객', email: 'client@test.planq.kr', contact_user_id: client.id },
      ],
      messageScenario: 'full',
    });
    console.log('  1) 브랜드 리뉴얼 (active, full) — 최고객 연결됨');

    await seedOneProject({
      businessId: 6,
      name: '패키지 디자인',
      clientCompany: 'Beta Industries',
      description: '신제품 런칭 패키지 디자인',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      ownerUserId: owner.id,
      memberUserIds: [
        { user_id: owner.id, role: '기획', is_default: true },
        { user_id: m1.id, role: '디자인', is_default: false },
      ],
      clientContacts: [
        { name: '최고객', email: 'client@test.planq.kr', contact_user_id: client.id },
      ],
      messageScenario: 'early',
    });
    console.log('  2) 패키지 디자인 (active, early)');

    await seedOneProject({
      businessId: 6,
      name: '내부 툴 개선',
      clientCompany: '내부 프로젝트',
      description: '업무 자동화 툴 리팩터',
      startDate: '2026-02-10',
      endDate: null,
      ownerUserId: owner.id,
      memberUserIds: [
        { user_id: owner.id, role: '기획', is_default: true },
        { user_id: m2.id, role: '개발', is_default: false },
      ],
      clientContacts: [],
      messageScenario: 'review',
      status: 'paused',
    });
    console.log('  3) 내부 툴 개선 (paused, review)');

    // ── 워프로랩 (id=3) 2개 프로젝트 ──
    console.log('\n[워프로랩] 프로젝트 시드');
    await seedOneProject({
      businessId: 3,
      name: '클라이언트 온보딩 자동화',
      clientCompany: '워프로랩 내부',
      description: '신규 고객 온보딩 플로우 개선',
      startDate: '2026-04-01',
      endDate: '2026-05-15',
      ownerUserId: irene.id,
      memberUserIds: [
        { user_id: irene.id, role: '기획', is_default: true },
      ],
      clientContacts: [],
      messageScenario: 'early',
    });
    console.log('  1) 클라이언트 온보딩 자동화');

    await seedOneProject({
      businessId: 3,
      name: 'AI 어시스턴트 리서치',
      clientCompany: '워프로랩 내부',
      description: 'Cue 엔진 고도화 리서치',
      startDate: '2026-03-20',
      endDate: null,
      ownerUserId: irene.id,
      memberUserIds: [
        { user_id: irene.id, role: '기획', is_default: true },
      ],
      clientContacts: [],
      messageScenario: 'review',
    });
    console.log('  2) AI 어시스턴트 리서치');

    console.log('\n─────────────────────────────');
    console.log('Q Talk 데모 시드 완료');
    console.log('─────────────────────────────');
    process.exit(0);
  } catch (err) {
    console.error('실패:', err.message);
    console.error(err);
    process.exit(1);
  }
})();
