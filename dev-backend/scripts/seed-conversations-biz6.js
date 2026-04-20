// biz=6 [SAMPLE] 프로젝트에 대화 + 메시지 시드 — Irene 이 member 로 참여하는 상태
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const {
  sequelize, Business, Project, ProjectMember, ProjectClient,
  Conversation, ConversationParticipant, Message, User,
} = require('../models');

const BIZ_ID = 6;
const IRENE_ID = 3;

const SCENARIOS = [
  {
    nameMatch: '[SAMPLE] A.',
    customer: [
      { from: 'client', email: 'client.acme@planq-sample.kr', body: 'Acme 입니다. 이번 주 와이어프레임 공유 가능할까요?' },
      { from: 'team', body: '목요일 오전 공유 예정입니다. 참고 링크 먼저 보내드릴게요.' },
      { from: 'client', email: 'client.acme@planq-sample.kr', body: '좋아요. 저희 쪽 우선순위는 회원가입 → 온보딩 흐름이에요.' },
    ],
    internal: [
      { from: 'team', body: 'Acme 와이어프레임 리뷰 — 온보딩 스텝 3개 + 진행률 표시.' },
      { from: 'team', body: '금주 금요일 중간 공유 예정.' },
    ],
  },
  {
    nameMatch: '[SAMPLE] F.',
    customer: [
      { from: 'client', email: 'client.zeta@planq-sample.kr', body: 'Zeta 장제타입니다. 디자인 시안 3안 다음주까지 가능할까요?' },
      { from: 'team', body: '네, 수요일 오후 3시 공유 예정입니다. 시안 3안 + 브랜드 가이드 초안 포함.' },
      { from: 'client', email: 'client.zeta@planq-sample.kr', body: '브랜드 가이드 초안에 컬러 시스템 포함되면 좋겠어요.' },
      { from: 'team', body: '컬러 시스템 + 타이포그래피 2종 포함하겠습니다.' },
    ],
    internal: [
      { from: 'team', body: '디자인 3안 중 C안이 가장 가능성 — 브랜드 가이드 C안 기준으로.' },
    ],
  },
];

(async () => {
  const biz = await Business.findByPk(BIZ_ID);
  if (!biz) throw new Error('biz 6 not found');
  console.log(`[biz] ${biz.brand_name || biz.name}`);

  for (const sc of SCENARIOS) {
    const proj = (await Project.findAll({ where: { business_id: BIZ_ID } })).find((p) => (p.name || '').includes(sc.nameMatch));
    if (!proj) { console.log(`  skip: ${sc.nameMatch}`); continue; }
    console.log(`\n[project] ${proj.name}`);

    const members = await ProjectMember.findAll({ where: { project_id: proj.id } });
    const memberIds = members.map((m) => m.user_id);
    // Irene 포함 여부 재확인
    if (!memberIds.includes(IRENE_ID)) {
      await ProjectMember.create({ project_id: proj.id, user_id: IRENE_ID, role: '기획', role_order: 1 });
      memberIds.push(IRENE_ID);
    }
    const teamSender = members.find((m) => m.user_id === proj.owner_user_id)?.user_id || memberIds[0];

    for (const chType of ['customer', 'internal']) {
      const title = `${proj.name} ${chType === 'customer' ? '고객' : '내부'}`;
      let conv = await Conversation.findOne({ where: { project_id: proj.id, channel_type: chType } });
      if (!conv) {
        conv = await Conversation.create({
          business_id: BIZ_ID, project_id: proj.id, title,
          channel_type: chType, status: 'active',
          cue_enabled: chType === 'customer', auto_extract_enabled: chType === 'customer',
        });
        for (const uid of memberIds) {
          await ConversationParticipant.create({
            conversation_id: conv.id, user_id: uid,
            role: uid === proj.owner_user_id ? 'owner' : 'member',
          });
        }
        // customer — 프로젝트 고객 자동 참여
        if (chType === 'customer') {
          const pcs = await ProjectClient.findAll({ where: { project_id: proj.id } });
          for (const pc of pcs) {
            if (!pc.contact_email) continue;
            const u = await User.findOne({ where: { email: pc.contact_email } });
            if (!u) continue;
            const dup = await ConversationParticipant.findOne({ where: { conversation_id: conv.id, user_id: u.id } });
            if (!dup) await ConversationParticipant.create({ conversation_id: conv.id, user_id: u.id, role: 'member' });
          }
          if (biz.cue_user_id) {
            await ConversationParticipant.create({ conversation_id: conv.id, user_id: biz.cue_user_id, role: 'member' });
          }
        }
        console.log(`  conv 생성: ${title}`);
      }

      const existing = await Message.count({ where: { conversation_id: conv.id } });
      if (existing > 0) continue;
      const script = chType === 'customer' ? sc.customer : sc.internal;
      for (const m of script) {
        let sender = teamSender;
        if (m.from === 'client' && m.email) {
          const u = await User.findOne({ where: { email: m.email } });
          if (u) sender = u.id;
        }
        await Message.create({
          conversation_id: conv.id, sender_id: sender,
          content: m.body, is_internal: chType === 'internal',
        });
      }
      await conv.update({ last_message_at: new Date() });
      console.log(`    messages: ${script.length}`);
    }
  }

  console.log('\n✅ done');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
