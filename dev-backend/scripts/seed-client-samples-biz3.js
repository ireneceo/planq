// biz=3 (워프로랩) 에 실제 프로젝트 3개를 기준으로 고객 임의 시드 + 연결.
// 기존 프로젝트: 38 클라이언트 온보딩 자동화 / 39 AI 어시스턴트 리서치 / 40 워크플로우 테스트
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sequelize, User, Client, Project, ProjectClient } = require('../models');

const BIZ_ID = 3;
const DEFAULT_PW = 'Test1234!';

// 각 프로젝트에 실제 서비스 고객처럼 1~2명씩 배치
const SAMPLES = [
  { email: 'kim.onboarding@warpro-sample.kr', name: '김수진', company: '온보딩 스튜디오', phone: '010-1212-3434', notes: '온보딩 자동화 메인 담당자', projects: ['클라이언트 온보딩 자동화'] },
  { email: 'lee.ai@warpro-sample.kr', name: '이지호', company: 'Nova AI Labs', phone: '010-2323-4545', notes: 'AI 어시스턴트 파일럿 대표', projects: ['AI 어시스턴트 리서치'] },
  { email: 'park.wf@warpro-sample.kr', name: '박태원', company: '플로우웍스', phone: '010-3434-5656', notes: '워크플로우 실증 업무 오너', projects: ['워크플로우 테스트'] },
  { email: 'jung.cross@warpro-sample.kr', name: '정다은', company: '크로스포인트', phone: '010-5050-1001', notes: '2개 프로젝트에 걸친 통합 담당', projects: ['클라이언트 온보딩 자동화', 'AI 어시스턴트 리서치'] },
  { email: 'choi.ops@warpro-sample.kr', name: '최윤아', company: '운영전략랩', phone: null, notes: '운영 피드백 채널 고객', projects: ['워크플로우 테스트'] },
];

(async () => {
  console.log(`[target] business_id=${BIZ_ID} (워프로랩)`);
  const projects = await Project.findAll({ where: { business_id: BIZ_ID } });
  const byName = new Map(projects.map((p) => [p.name, p]));

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
      await existing.update({ display_name: s.name, company_name: s.company, notes: s.notes, status: 'active' });
      console.log(`  client ${s.email} 업데이트`);
    } else {
      await Client.create({
        business_id: BIZ_ID, user_id: u.id,
        display_name: s.name, company_name: s.company, notes: s.notes,
        status: 'active', invited_at: new Date(),
      });
      console.log(`  client ${s.email} 생성`);
    }

    for (const pname of s.projects) {
      const proj = byName.get(pname);
      if (!proj) { console.log(`    (skip) 프로젝트 "${pname}" 없음`); continue; }
      const exists = await ProjectClient.findOne({
        where: { project_id: proj.id, contact_email: s.email },
      });
      if (exists) continue;
      await ProjectClient.create({
        project_id: proj.id,
        contact_name: s.name,
        contact_email: s.email,
        invite_token: crypto.randomBytes(24).toString('hex'),
        invited_by: null,
      });
      console.log(`    linked ${s.name} → ${pname}`);
    }
  }

  console.log('\n✅ done');
  // sequelize.close 호환 이슈 있음 — 프로세스 종료 유도
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
