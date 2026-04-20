// biz=7 (브랜드 파트너스) — Irene 이 고객 역할로 보는 실데이터 시드.
// 프로젝트 2개 + Irene ProjectClient 연결 + 업무 8개 (일부는 Irene 요청자) + 대화 2개 + 메시지
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const crypto = require('crypto');
const {
  sequelize, Business, User, Project, ProjectMember, ProjectClient,
  Task, Conversation, ConversationParticipant, Message, ProjectStatusOption,
} = require('../models');

const BIZ_ID = 7;
const IRENE_ID = 3;
const OWNER_ID = 15; // 김오너

function daysFrom(off) { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().slice(0, 10); }

async function seedProject({ name, type, start, end, color, tasks, customerMessages, internalMessages }) {
  const existing = await Project.findOne({ where: { business_id: BIZ_ID, name } });
  let proj;
  if (existing) {
    console.log(`  [reuse] ${name}`);
    proj = existing;
  } else {
    proj = await Project.create({
      business_id: BIZ_ID, owner_user_id: OWNER_ID,
      name, project_type: type, start_date: start, end_date: end, color, status: 'active',
      default_assignee_user_id: OWNER_ID,
    });
    await ProjectMember.create({ project_id: proj.id, user_id: OWNER_ID, role: '오너', role_order: 0 });
    await ProjectStatusOption.bulkCreate([
      { project_id: proj.id, status_key: 'not_started', label: '미시작', color: '#94A3B8', order_index: 0 },
      { project_id: proj.id, status_key: 'in_progress', label: '진행중', color: '#14B8A6', order_index: 1 },
      { project_id: proj.id, status_key: 'done', label: '완료', color: '#22C55E', order_index: 2 },
    ]);
    console.log(`  [create] project ${proj.id} "${name}"`);
  }

  // Irene as ProjectClient — contact_user_id 설정 필수 (client role 권한 체크 기준)
  const pcExists = await ProjectClient.findOne({ where: { project_id: proj.id, contact_email: 'irene@irenecompany.com' } });
  if (!pcExists) {
    await ProjectClient.create({
      project_id: proj.id, contact_user_id: IRENE_ID,
      contact_name: '아이린', contact_email: 'irene@irenecompany.com',
      invite_token: crypto.randomBytes(24).toString('hex'), invited_by: OWNER_ID,
    });
    console.log('    ProjectClient: 아이린 추가');
  } else if (!pcExists.contact_user_id) {
    await pcExists.update({ contact_user_id: IRENE_ID });
  }

  // Tasks
  for (const tdef of tasks) {
    const exists = await Task.findOne({ where: { project_id: proj.id, title: tdef.title } });
    if (exists) continue;
    await Task.create({
      business_id: BIZ_ID, project_id: proj.id,
      title: tdef.title, description: tdef.description || null,
      status: tdef.status || 'not_started',
      start_date: tdef.start || null, due_date: tdef.due || null,
      estimated_hours: tdef.est ?? null,
      progress_percent: tdef.progress ?? 0,
      assignee_id: tdef.assignee || OWNER_ID,
      request_by_user_id: tdef.requestedBy || null,
      created_by: tdef.requestedBy || OWNER_ID,
      source: tdef.requestedBy ? 'internal_request' : 'manual',
      request_ack_at: tdef.acked ? new Date() : null,
    });
  }
  console.log(`    tasks seeded: ${tasks.length}`);

  // Conversations (customer + internal)
  let customerConv = await Conversation.findOne({ where: { project_id: proj.id, channel_type: 'customer' } });
  if (!customerConv) {
    customerConv = await Conversation.create({
      business_id: BIZ_ID, project_id: proj.id, title: `${name} 고객`,
      channel_type: 'customer', status: 'active',
      cue_enabled: true, auto_extract_enabled: true,
    });
    await ConversationParticipant.create({ conversation_id: customerConv.id, user_id: OWNER_ID, role: 'owner' });
    await ConversationParticipant.create({ conversation_id: customerConv.id, user_id: IRENE_ID, role: 'member' });
    const biz = await Business.findByPk(BIZ_ID);
    if (biz?.cue_user_id) {
      await ConversationParticipant.create({ conversation_id: customerConv.id, user_id: biz.cue_user_id, role: 'member' });
    }
    console.log(`    customer conv 생성`);
  }
  let internalConv = await Conversation.findOne({ where: { project_id: proj.id, channel_type: 'internal' } });
  if (!internalConv) {
    internalConv = await Conversation.create({
      business_id: BIZ_ID, project_id: proj.id, title: `${name} 내부`,
      channel_type: 'internal', status: 'active',
      cue_enabled: false, auto_extract_enabled: false,
    });
    await ConversationParticipant.create({ conversation_id: internalConv.id, user_id: OWNER_ID, role: 'owner' });
    console.log(`    internal conv 생성`);
  }

  // Messages
  async function seedMsgs(conv, list) {
    const existing = await Message.count({ where: { conversation_id: conv.id } });
    if (existing > 0) return;
    for (const m of list) {
      const senderId = m.from === 'irene' ? IRENE_ID : OWNER_ID;
      await Message.create({
        conversation_id: conv.id, sender_id: senderId,
        content: m.body, is_internal: conv.channel_type === 'internal',
      });
    }
    await conv.update({ last_message_at: new Date() });
  }
  await seedMsgs(customerConv, customerMessages);
  await seedMsgs(internalConv, internalMessages);
  console.log(`    messages seeded`);
}

(async () => {
  const biz = await Business.findByPk(BIZ_ID);
  if (!biz) throw new Error(`biz ${BIZ_ID} not found`);
  console.log(`[biz] ${biz.brand_name}`);

  await seedProject({
    name: '아이린 브랜드 리뉴얼',
    type: 'fixed', start: daysFrom(-14), end: daysFrom(28), color: '#F43F5E',
    tasks: [
      { title: '브랜드 자산 인벤토리', status: 'completed', progress: 100, start: daysFrom(-14), due: daysFrom(-10), est: 6, assignee: OWNER_ID },
      { title: '로고 시안 3안 제시', status: 'done_feedback', progress: 100, start: daysFrom(-9), due: daysFrom(-2), est: 12, assignee: OWNER_ID, requestedBy: IRENE_ID, acked: true, description: '아이린 요청 — 3안 중 최종 선정' },
      { title: '컬러 팔레트 조정', status: 'in_progress', progress: 40, start: daysFrom(-3), due: daysFrom(4), est: 4, assignee: OWNER_ID, requestedBy: IRENE_ID, acked: true, description: '2안 기준 파스텔 톤 조정' },
      { title: '타이포 시스템 가이드', status: 'not_started', progress: 0, start: daysFrom(5), due: daysFrom(14), est: 8, assignee: OWNER_ID },
      { title: '적용 가이드 최종 납품', status: 'not_started', progress: 0, start: daysFrom(20), due: daysFrom(28), est: 4, assignee: OWNER_ID },
    ],
    customerMessages: [
      { from: 'irene', body: '안녕하세요. 로고 시안 3안 중 2번 방향 발전시켜서 컬러 팔레트 조정 요청드려요. 조금 더 파스텔 톤이면 좋겠어요.' },
      { from: 'team', body: '요청 확인했어요. 이번 주 금요일까지 2안 기준 파스텔 조정본 공유드릴게요. 중간에 스냅샷도 드릴 수 있어요.' },
      { from: 'irene', body: '좋아요. 중간 스냅샷도 보여주세요.' },
      { from: 'team', body: '지금 시안 1차 공유드립니다. 회신 기다리겠습니다.' },
      { from: 'irene', body: '오 좋네요! 한 톤만 더 밝게 해주세요. 그 외엔 방향 좋습니다.' },
    ],
    internalMessages: [
      { from: 'team', body: '아이린 고객 피드백 — 로고 2안 베이스로 파스텔 조정. 디자인 파트 오늘 저녁까지 시안 업데이트.' },
      { from: 'team', body: '컬러 3-4 candidate 시트 공유. Figma 링크 첨부함.' },
      { from: 'team', body: '타이포 시스템 가이드는 다음 주 시작 — 글자 클래스 5종 기본.' },
    ],
  });

  await seedProject({
    name: '아이린 월간 브랜드 리포트',
    type: 'ongoing', start: daysFrom(-90), end: null, color: '#14B8A6',
    tasks: [
      { title: '이번 달 SNS 채널 지표 정리', status: 'in_progress', progress: 50, start: daysFrom(-3), due: daysFrom(4), est: 4, assignee: OWNER_ID },
      { title: '경쟁사 모니터링 요약', status: 'not_started', progress: 0, start: daysFrom(7), due: daysFrom(10), est: 3, assignee: OWNER_ID },
      { title: '월간 리포트 PDF 발송', status: 'not_started', progress: 0, start: daysFrom(12), due: daysFrom(14), est: 2, assignee: OWNER_ID },
    ],
    customerMessages: [
      { from: 'team', body: '이번 달 리포트 준비 시작합니다. 특별히 보시고 싶은 지표 있으시면 공유 부탁드려요.' },
      { from: 'irene', body: '이번엔 인스타그램 릴스 도달 수 추이가 궁금해요. 그리고 경쟁사 3곳 비교 추가해주세요.' },
      { from: 'team', body: '릴스 지표 + 경쟁사 3곳 (네이버/카카오/라인) 포함하겠습니다. 14일까지 완성본 발송 예정.' },
    ],
    internalMessages: [
      { from: 'team', body: '아이린 리포트 — 릴스 도달 수 신규 지표 포함. 데이터 소스 4곳 연결 필요.' },
    ],
  });

  console.log('\n✅ done');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
