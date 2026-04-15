// 테스트 계정 생성 (idempotent — 몇 번 실행해도 안전)
// 사용: cd /opt/planq/dev-backend && node scripts/create-test-accounts.js
//
// 생성되는 계정 (모두 비밀번호: Test1234!):
//   admin@test.planq.kr    — 플랫폼 관리자
//   owner@test.planq.kr    — 워크스페이스 관리자
//   member1@test.planq.kr  — 멤버 (이름: 이디자)
//   member2@test.planq.kr  — 멤버 (이름: 박개발)
//   client@test.planq.kr   — 고객 (최고객)
//
// 생성되는 워크스페이스:
//   1. "PlanQ 테스트 워크스페이스" (기본 테스트용)
//      - owner@: 관리자 / member1@, member2@: 멤버 / client@: 고객
//      - irene@irenecompany.com: 멤버로 추가 (멀티 역할 테스트용)
//   2. "브랜드 파트너스" (irene 을 고객으로 넣기 위한 3번째 워크스페이스)
//      - owner@: 관리자 / irene@: 고객
//
// irene@irenecompany.com 의 역할 테스트:
//   - "워프로랩" (기존): 관리자 (owner)
//   - "PlanQ 테스트 워크스페이스": 멤버
//   - "브랜드 파트너스": 고객
//   → 워크스페이스 스위처로 3 역할 모두 체험 가능
//
// 멤버의 "역할(디자인/개발/...)"은 **프로젝트 단위 매핑**이지 계정 속성 아님.
// 계정 레벨에서는 모두 동등한 'member'. 역할은 프로젝트 생성 시 지정됨.
// 이미 존재하는 계정은 업서트 (비밀번호 재설정, 데이터 덮어씀 없이 유지).

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');
const { User, Business, BusinessMember, Client } = require('../models');

const PASSWORD = 'Test1234!';
const WORKSPACE_NAME = 'PlanQ 테스트 워크스페이스';
const CLIENT_COMPANY = 'Acme Test Corp';

const ACCOUNTS = {
  admin: { email: 'admin@test.planq.kr', name: 'Platform Admin', platform_role: 'platform_admin' },
  owner: { email: 'owner@test.planq.kr', name: '김오너', platform_role: 'user' },
  member1: { email: 'member1@test.planq.kr', name: '이디자', platform_role: 'user' },
  member2: { email: 'member2@test.planq.kr', name: '박개발', platform_role: 'user' },
  client: { email: 'client@test.planq.kr', name: '최고객', platform_role: 'user' },
};

async function ensureUser(spec) {
  const [u] = await User.findOrCreate({
    where: { email: spec.email },
    defaults: {
      email: spec.email,
      name: spec.name,
      password_hash: await bcrypt.hash(PASSWORD, 12),
      platform_role: spec.platform_role,
      status: 'active',
      language: 'ko',
    },
  });
  // 기존 유저도 비밀번호를 항상 알려진 값으로 재설정 (테스트 편의)
  u.password_hash = await bcrypt.hash(PASSWORD, 12);
  u.status = 'active';
  await u.save();
  return u;
}

async function ensureWorkspace(ownerId) {
  const [biz] = await Business.findOrCreate({
    where: { slug: 'planq-test' },
    defaults: {
      name: WORKSPACE_NAME,
      slug: 'planq-test',
      owner_id: ownerId,
      plan: 'pro',
      subscription_status: 'active',
      brand_name: WORKSPACE_NAME,
      legal_name: 'PlanQ 테스트 (주)',
      default_language: 'ko',
      cue_mode: 'smart',
      timezone: 'Asia/Seoul',
    },
  });
  return biz;
}

async function ensureMember(businessId, userId, role) {
  const [bm] = await BusinessMember.findOrCreate({
    where: { business_id: businessId, user_id: userId },
    defaults: { business_id: businessId, user_id: userId, role },
  });
  if (bm.role !== role) { bm.role = role; await bm.save(); }
  return bm;
}

async function ensureClient(businessId, userId, displayName, companyName) {
  const existing = await Client.findOne({ where: { business_id: businessId, user_id: userId } });
  if (existing) {
    existing.display_name = displayName;
    existing.company_name = companyName;
    existing.status = 'active';
    await existing.save();
    return existing;
  }
  return Client.create({
    business_id: businessId,
    user_id: userId,
    display_name: displayName,
    company_name: companyName,
    status: 'active',
    joined_at: new Date(),
  });
}

async function ensurePartnersWorkspace(ownerId) {
  const [biz] = await Business.findOrCreate({
    where: { slug: 'brand-partners-test' },
    defaults: {
      name: '브랜드 파트너스',
      slug: 'brand-partners-test',
      owner_id: ownerId,
      plan: 'basic',
      subscription_status: 'active',
      brand_name: '브랜드 파트너스',
      legal_name: '브랜드 파트너스 (주)',
      default_language: 'ko',
      cue_mode: 'smart',
      timezone: 'Asia/Seoul',
    },
  });
  return biz;
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log('DB 연결 OK');

    const admin = await ensureUser(ACCOUNTS.admin);
    const owner = await ensureUser(ACCOUNTS.owner);
    const m1 = await ensureUser(ACCOUNTS.member1);
    const m2 = await ensureUser(ACCOUNTS.member2);
    const cli = await ensureUser(ACCOUNTS.client);
    console.log('사용자 5명 upsert 완료');

    // 테스트 워크스페이스
    const biz = await ensureWorkspace(owner.id);
    console.log(`워크스페이스 "${biz.name}" (id=${biz.id}) 준비`);

    await ensureMember(biz.id, owner.id, 'owner');
    await ensureMember(biz.id, m1.id, 'member');
    await ensureMember(biz.id, m2.id, 'member');
    console.log('업무 멤버 3명 매핑 (owner + member×2)');

    await ensureClient(biz.id, cli.id, ACCOUNTS.client.name, CLIENT_COMPANY);
    console.log(`고객 1명 매핑 ("${CLIENT_COMPANY}" 소속 ${ACCOUNTS.client.name})`);

    // ── irene 멀티 역할 세팅 (자기 워크스페이스: 관리자 / 테스트: 멤버 / 파트너스: 고객) ──
    const irene = await User.findOne({ where: { email: 'irene@irenecompany.com' } });
    if (irene) {
      // 테스트 워크스페이스에 멤버로 추가 (기존 owner 역할은 irene 의 워프로랩에서 유지)
      await ensureMember(biz.id, irene.id, 'member');
      console.log(`irene → "${biz.name}" 에 멤버로 추가`);

      // 세 번째 워크스페이스 "브랜드 파트너스" — owner@ 가 소유, irene 이 고객
      const partnerBiz = await ensurePartnersWorkspace(owner.id);
      await ensureMember(partnerBiz.id, owner.id, 'owner');
      await ensureClient(partnerBiz.id, irene.id, '아이린', '워프로랩');
      console.log(`irene → "${partnerBiz.name}" (id=${partnerBiz.id}) 에 고객으로 추가`);
    } else {
      console.log('irene@irenecompany.com 없음 — 멀티 역할 세팅 건너뜀');
    }

    console.log('\n─────────────────────────────');
    console.log('테스트 계정 (비밀번호: ' + PASSWORD + ')');
    console.log('─────────────────────────────');
    console.log('  플랫폼 관리자         :', ACCOUNTS.admin.email);
    console.log('  워크스페이스 관리자    :', ACCOUNTS.owner.email);
    console.log('  멤버 · 이디자         :', ACCOUNTS.member1.email);
    console.log('  멤버 · 박개발         :', ACCOUNTS.member2.email);
    console.log('  고객 · 최고객         :', ACCOUNTS.client.email);
    console.log('─────────────────────────────');
    console.log('irene 은 3 워크스페이스 × 3 역할: 워프로랩(관리자) / 테스트(멤버) / 파트너스(고객)');
    console.log('─────────────────────────────\n');

    process.exit(0);
  } catch (err) {
    console.error('실패:', err.message);
    console.error(err);
    process.exit(1);
  }
})();
