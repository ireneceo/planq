// 샘플 고객 시드 — /business/clients 페이지 데이터 확보용.
// - User 계정 없으면 이메일/이름으로 User 를 먼저 생성 (플랜Q 가 초대받은 client 역할로)
// - Client 테이블에 연결 (business_id + user_id)
// - 일부는 ProjectClient 로 샘플 프로젝트에 편입 → /business/clients 에서 프로젝트 수 표시 확인
// 멱등: 이메일 기준으로 기존 존재 시 재사용
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { sequelize, User, Client, Project, ProjectClient } = require('../models');

const BIZ_ID = Number(process.env.BIZ_ID || 6);
const DEFAULT_PW = 'Test1234!';

const SAMPLES = [
  { email: 'client.acme@planq-sample.kr', name: '김에이스', company: 'Acme Co.', phone: '010-1111-2222', notes: 'A시나리오 고객' },
  { email: 'client.beta@planq-sample.kr', name: '박베타', company: 'Beta Corp.', phone: '010-3333-4444', notes: 'B시나리오 고객 — 일정 지연 민감' },
  { email: 'client.gamma@planq-sample.kr', name: '이감마', company: 'Gamma Inc.', phone: '010-5555-6666', notes: 'C시나리오 마무리 단계' },
  { email: 'client.delta@planq-sample.kr', name: '최델타', company: 'Delta Ltd.', phone: null, notes: 'D시나리오 신규' },
  { email: 'client.epsilon@planq-sample.kr', name: '정엡실론', company: 'Epsilon Enterprise', phone: '010-7777-8888', notes: 'E시나리오 월간 구독' },
  { email: 'client.zeta@planq-sample.kr', name: '장제타', company: 'Zeta Group', phone: '010-9999-0000', notes: 'F시나리오 복합 — 장기 고객' },
];

(async () => {
  console.log(`[target] business_id=${BIZ_ID}`);

  for (const s of SAMPLES) {
    let u = await User.findOne({ where: { email: s.email } });
    if (!u) {
      u = await User.create({
        email: s.email, name: s.name, phone: s.phone,
        password_hash: await bcrypt.hash(DEFAULT_PW, 12),
        platform_role: 'user', status: 'active',
      });
      console.log(`  user ${s.email} 생성 (id=${u.id})`);
    }
    const existing = await Client.findOne({ where: { business_id: BIZ_ID, user_id: u.id } });
    if (existing) {
      await existing.update({
        display_name: s.name, company_name: s.company, notes: s.notes,
        status: 'active',
      });
      console.log(`  client ${s.email} 업데이트`);
    } else {
      await Client.create({
        business_id: BIZ_ID, user_id: u.id,
        display_name: s.name, company_name: s.company, notes: s.notes,
        status: 'active', invited_at: new Date(),
      });
      console.log(`  client ${s.email} 생성`);
    }
  }

  // 일부 고객을 샘플 프로젝트에 ProjectClient 로 추가 (이미 있다면 skip)
  const projects = await Project.findAll({ where: { business_id: BIZ_ID }, order: [['created_at', 'ASC']] });
  const sample = projects.filter((p) => (p.name || '').startsWith('[SAMPLE]'));
  const pairs = [
    { emailKey: 'client.acme@planq-sample.kr', match: 'A.' },
    { emailKey: 'client.beta@planq-sample.kr', match: 'B.' },
    { emailKey: 'client.gamma@planq-sample.kr', match: 'C.' },
    { emailKey: 'client.delta@planq-sample.kr', match: 'D.' },
    { emailKey: 'client.epsilon@planq-sample.kr', match: 'E.' },
    { emailKey: 'client.zeta@planq-sample.kr', match: 'F.' },
    // 복합 — zeta 는 A 에도 함께 (프로젝트 수>=2 케이스)
    { emailKey: 'client.zeta@planq-sample.kr', match: 'A.' },
  ];
  for (const pair of pairs) {
    const proj = sample.find((p) => p.name.includes(pair.match));
    const s = SAMPLES.find((x) => x.email === pair.emailKey);
    if (!proj || !s) continue;
    const exists = await ProjectClient.findOne({
      where: { project_id: proj.id, contact_email: s.email },
    });
    if (exists) continue;
    await ProjectClient.create({
      project_id: proj.id,
      contact_name: s.name,
      contact_email: s.email,
      invite_token: require('crypto').randomBytes(24).toString('hex'),
      invited_by: null,
    });
    console.log(`  linked ${s.name} → ${proj.name}`);
  }

  await sequelize.close().catch(() => {});
  console.log('\n✅ done');
})().catch((e) => { console.error(e); process.exit(1); });
