// biz=3 프로젝트 3개에 대화 + 샘플 메시지 시드.
// 대상: 38 온보딩 / 39 AI 어시스턴트 / 40 워크플로우 테스트
// - 각 프로젝트에 customer + internal 채널 (없으면 생성)
// - 프로젝트 멤버 + Cue AI + 연결 고객을 참여자로
// - 각 채널에 10~15개 실적인 대화 메시지 시드
// - 멱등: 이미 같은 title 채널 존재 시 skip, 메시지 기존 있으면 skip
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const {
  sequelize, Project, ProjectMember, ProjectClient, Business,
  Conversation, ConversationParticipant, Message, User,
} = require('../models');

const BIZ_ID = 3;

// 프로젝트별 메시지 시나리오
const SCENARIOS = [
  {
    projectName: '클라이언트 온보딩 자동화',
    customer: [
      { sender: 'client', who: 'kim.onboarding@warpro-sample.kr', body: '안녕하세요. 온보딩 자동화 진행 어떻게 되어가나요? 이번 주 중 1차 시안 볼 수 있을까요?' },
      { sender: 'team', body: '안녕하세요 김수진 님, 금요일 오전 중 1차 시안 전달 예정입니다. 메일과 이 채팅방에 동시 공유드립니다.' },
      { sender: 'client', who: 'jung.cross@warpro-sample.kr', body: '저는 크로스포인트 정다은이에요. 우리 쪽 요구사항 세 가지 다시 정리해서 보냈어요.' },
      { sender: 'team', body: '@정다은 공유해 주신 요구사항 반영해서 시안에 포함했습니다. 확인 부탁드려요.' },
      { sender: 'client', who: 'kim.onboarding@warpro-sample.kr', body: '금요일 5시까지 피드백 정리해서 회신드릴게요.' },
    ],
    internal: [
      { sender: 'team', body: '온보딩 1차 시안 검토 완료. 디자인 파트 pending.' },
      { sender: 'team', body: '정다은 측 요구사항 3건 중 2건 반영됨. 1건(다국어) 는 2차 일정에.' },
      { sender: 'team', body: '김수진 CS 3건 처리 — 댓글 확인' },
    ],
  },
  {
    projectName: 'AI 어시스턴트 리서치',
    customer: [
      { sender: 'client', who: 'lee.ai@warpro-sample.kr', body: '이지호입니다. 이번 주 리서치 요약본 공유 일정 확인 부탁드려요.' },
      { sender: 'team', body: '수요일 오후 5시 공유 예정입니다. Competitor 5곳 분석 + 기능 맵핑 포함.' },
      { sender: 'client', who: 'jung.cross@warpro-sample.kr', body: '정다은입니다. 시장 포지셔닝 부분 B2B 앵글도 포함 가능할까요?' },
      { sender: 'team', body: '네, B2B SaaS 각도로 추가 분석 들어갑니다. 목요일까지 스냅샷 먼저 보여드릴게요.' },
      { sender: 'client', who: 'lee.ai@warpro-sample.kr', body: '좋아요. 조사된 툴 리스트 링크 공유도 부탁드립니다.' },
    ],
    internal: [
      { sender: 'team', body: 'Competitor 5곳 — Notion AI / Claude / Cursor / Perplexity / ChatGPT Team. 기능 맵핑 완료.' },
      { sender: 'team', body: '요약본 draft 준비 중. Figma 에 링크함.' },
    ],
  },
  {
    projectName: '워크플로우 테스트',
    customer: [
      { sender: 'client', who: 'park.wf@warpro-sample.kr', body: '박태원입니다. 이번 주 워크플로우 베타 테스트 일정 확인 부탁드려요.' },
      { sender: 'team', body: '수요일 오후 2시부터 한 시간 예정입니다. 프로세스 3가지 시연합니다.' },
      { sender: 'client', who: 'choi.ops@warpro-sample.kr', body: '최윤아입니다. 운영팀 피드백 채널은 이 채팅방으로 통일하면 될까요?' },
      { sender: 'team', body: '네, 운영 관련 이슈는 이 채널에서 받고 있습니다. 월/수/금 오전에 요약 리포트 드립니다.' },
    ],
    internal: [
      { sender: 'team', body: '베타 시연 슬라이드 5페이지 완성. 내일 드라이런 한 번 더.' },
      { sender: 'team', body: '박태원 측 요청 — 모바일 퍼널 추가 시뮬레이션. 금주 금요일까지 준비.' },
    ],
  },
];

(async () => {
  const biz = await Business.findByPk(BIZ_ID);
  if (!biz) throw new Error(`business ${BIZ_ID} not found`);
  console.log(`[biz] ${biz.brand_name || biz.name}`);

  for (const sc of SCENARIOS) {
    const proj = await Project.findOne({ where: { business_id: BIZ_ID, name: sc.projectName } });
    if (!proj) { console.log(`  skip: 프로젝트 "${sc.projectName}" 없음`); continue; }
    console.log(`\n[project] ${proj.name} (id=${proj.id})`);

    const members = await ProjectMember.findAll({ where: { project_id: proj.id }, include: [{ model: User, attributes: ['id', 'name'] }] });
    const memberIds = members.map((m) => m.user_id);
    // 프로젝트 멤버가 비어있으면 owner 를 멤버로 자동 추가 후 진행
    if (memberIds.length === 0 && proj.owner_user_id) {
      await ProjectMember.create({ project_id: proj.id, user_id: proj.owner_user_id, role: '오너', role_order: 0 });
      memberIds.push(proj.owner_user_id);
      console.log(`  (auto) owner ${proj.owner_user_id} 를 프로젝트 멤버로 추가`);
    }
    const primaryTeamUserId = memberIds.find((uid) => uid === proj.owner_user_id) || memberIds[0] || proj.owner_user_id;
    if (!primaryTeamUserId) { console.log('  skip: 팀 송신자 없음'); continue; }

    // customer + internal 채널 존재 확인 / 생성
    for (const chType of ['customer', 'internal']) {
      const title = `${proj.name} ${chType === 'customer' ? '고객' : '내부'}`;
      let conv = await Conversation.findOne({ where: { project_id: proj.id, channel_type: chType } });
      if (!conv) {
        conv = await Conversation.create({
          business_id: BIZ_ID, project_id: proj.id, title,
          channel_type: chType, status: 'active',
          cue_enabled: chType === 'customer', auto_extract_enabled: chType === 'customer',
        });
        // 참여자
        for (const uid of memberIds) {
          await ConversationParticipant.create({
            conversation_id: conv.id, user_id: uid,
            role: uid === proj.owner_user_id ? 'owner' : 'member',
          });
        }
        if (chType === 'customer' && biz.cue_user_id) {
          await ConversationParticipant.create({ conversation_id: conv.id, user_id: biz.cue_user_id, role: 'member' });
        }
        console.log(`  conv 생성: ${title}`);
      } else {
        console.log(`  conv 재사용: ${conv.title} (id=${conv.id})`);
      }

      const scriptArr = chType === 'customer' ? sc.customer : sc.internal;
      // 기존 메시지가 있으면 skip
      const existingCount = await Message.count({ where: { conversation_id: conv.id } });
      if (existingCount > 0) {
        console.log(`    existing messages=${existingCount} → skip`);
        continue;
      }
      // 고객 참여자 테이블에 등록 (customer 채널만) — contact_email 로 User 찾아 연결
      if (chType === 'customer') {
        const pcList = await ProjectClient.findAll({ where: { project_id: proj.id } });
        for (const pc of pcList) {
          if (!pc.contact_email) continue;
          const u = await User.findOne({ where: { email: pc.contact_email } });
          if (!u) continue;
          const already = await ConversationParticipant.findOne({ where: { conversation_id: conv.id, user_id: u.id } });
          if (!already) {
            await ConversationParticipant.create({ conversation_id: conv.id, user_id: u.id, role: 'member' });
          }
        }
      }

      // 메시지 시드 — 시간 간격 분 단위로 벌려서 자연스럽게
      let cursor = new Date(Date.now() - scriptArr.length * 60 * 60 * 1000);
      for (const m of scriptArr) {
        let sender_user_id = primaryTeamUserId;
        if (m.sender === 'client' && m.who) {
          const u = await User.findOne({ where: { email: m.who } });
          if (u) sender_user_id = u.id;
        }
        await Message.create({
          conversation_id: conv.id,
          sender_id: sender_user_id,
          content: m.body,
          is_internal: chType === 'internal',
        });
        // 타임스탬프는 Sequelize 자동 부여 — 시드 순서대로 생성되므로 순차 증가
        cursor = new Date(cursor.getTime() + 15 * 60 * 1000);
      }
      await conv.update({ last_message_at: cursor });
      console.log(`    messages 생성: ${scriptArr.length}`);
    }
  }

  console.log('\n✅ done');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
