// 마케팅 캡처용 데모 워크스페이스 시드 (#146 랜딩 /features 스크린샷)
//
// 목적: 랜딩 /features 의 Q 시리즈 5블록에 넣을 제품 스크린샷을 "실제 PlanQ 화면"으로 캡처하기 위해
//       가상 회사 1개(온무늬)의 완결된 워크스페이스를 dev DB 에 만든다.
//       캡처는 scripts/marketing-capture.js 가 이 계정으로 로그인해 수행한다.
//
// 특징
//   - 멱등: 재실행 시 데모 워크스페이스의 자식 데이터를 전부 지우고 다시 만든다 (business/user row 는 재사용).
//   - fail-closed 격리 가드: dev DB 화이트리스트 · 데모 계정이 다른 워크스페이스에 속해 있으면 abort.
//   - 실 데이터: 파일은 실제 바이트를 uploads 에 기록하고 크기·해시를 실측한다 (빈 row 금지).
//
// 실행: cd /opt/planq/dev-backend && node scripts/seed-demo-workspace.js
// 선행: .env 에 DEMO_CAPTURE_PASSWORD (12자 이상)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');
const { Op } = require('sequelize');
const {
  User, Business, BusinessMember, Client,
  Conversation, ConversationParticipant, Message,
  Project, ProjectMember, ProjectClient,
  Task, File, FileFolder, BusinessStorageUsage,
  Invoice, InvoiceItem, InvoicePayment, PlatformSetting,
} = require('../models');

// ─────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────
const ALLOWED_DB = ['planq_dev_db'];          // ★ 운영 DB 에서는 절대 실행되지 않는다
const DEMO_SLUG = 'onmuni-demo';
const DEMO_EMAIL_SUFFIX = '@demo.planq.kr';   // 데모 계정 식별자 (실 사용자 계정과 도메인 분리)
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

const CAPTURE_EMAIL = `capture${DEMO_EMAIL_SUFFIX}`;

// ─────────────────────────────────────────────
// 날짜 유틸 (상대 날짜 — 캡처 시점 기준으로 항상 "최근"으로 보인다)
// ─────────────────────────────────────────────
const now = () => new Date();
function hoursAgo(n) { const d = new Date(); d.setHours(d.getHours() - n); return d; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function dateFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function mondayThisWeek() {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────
// 데모 콘텐츠 정의 (Irene 검수 대상 — 화면에 그대로 노출되는 문구)
// ─────────────────────────────────────────────
const TEAM = [
  { key: 'seoyeon', email: CAPTURE_EMAIL, name: '김서연', job: '대표 · 기획', role: 'owner', defaultRole: '기획' },
  { key: 'jimin', email: `design${DEMO_EMAIL_SUFFIX}`, name: '이지민', job: '디자인 리드', role: 'member', defaultRole: '디자인' },
  { key: 'junho', email: `dev${DEMO_EMAIL_SUFFIX}`, name: '박준호', job: '개발', role: 'member', defaultRole: '개발' },
];
// 고객사 담당자 계정 — 고객 채널이 한쪽만 말하는 화면이 되지 않도록 실제 참여자로 만든다
const CLIENT_USER = { email: `client${DEMO_EMAIL_SUFFIX}`, name: '정민아' };

// 지난 달 수금 이력 (Q bill 12개월 그래프용) — ago = 며칠 전 입금
const PAST_PAID = [
  { client: 'green', title: '들녘테이블 브랜드 키트 2차', item: '브랜드 키트 · 응용 디자인', amount: 1800000, ago: 38 },
  { client: 'haneul', title: '노들커머스 상세페이지 리뉴얼', item: '상세페이지 6종 디자인', amount: 2600000, ago: 66 },
  { client: 'brick', title: '모눈스터디 브랜드 가이드', item: '브랜드 가이드라인 제작', amount: 3200000, ago: 95 },
  { client: 'green', title: '들녘테이블 시즌 패키지', item: '시즌 한정 패키지 디자인', amount: 2100000, ago: 128 },
  { client: 'haneul', title: '노들커머스 광고 소재 제작', item: '퍼포먼스 광고 소재 12종', amount: 1450000, ago: 158 },
  { client: 'brick', title: '모눈스터디 앱 아이콘 · 스플래시', item: '앱 아이콘 및 스플래시 리디자인', amount: 900000, ago: 190 },
];

const CLIENTS = [
  { key: 'haneul', company: '노들커머스', contact: '정민아', title: '마케팅팀장', linkUser: true },
  { key: 'brick', company: '모눈스터디', contact: '강민재', title: '대표', linkUser: false },
  { key: 'green', company: '들녘테이블', contact: '윤소민', title: '브랜드 매니저', linkUser: false },
];

// ─────────────────────────────────────────────
// 가드 — 실패 시 아무것도 쓰지 않고 종료 (fail-closed)
// ─────────────────────────────────────────────
function abort(msg) {
  console.error(`\n❌ 중단: ${msg}\n`);
  process.exit(1);
}

async function assertSafeEnvironment() {
  if (!ALLOWED_DB.includes(process.env.DB_NAME)) {
    abort(`DB '${process.env.DB_NAME}' 은 데모 시드 허용 대상이 아닙니다 (허용: ${ALLOWED_DB.join(', ')})`);
  }
  if (process.env.NODE_ENV === 'production') {
    abort('NODE_ENV=production 에서는 실행할 수 없습니다');
  }
  const pw = process.env.DEMO_CAPTURE_PASSWORD;
  if (!pw || pw.length < 12) {
    abort('.env DEMO_CAPTURE_PASSWORD 가 없거나 12자 미만입니다');
  }
}

// 데모 계정이 데모 워크스페이스 밖의 어떤 것에도 묶여 있으면 abort.
// (캡처 스크린샷에 실 워크스페이스 데이터가 새어 들어가는 사고를 원천 차단)
async function assertDemoAccountsIsolated(demoBusinessId) {
  const emails = [...TEAM.map((t) => t.email), CLIENT_USER.email];
  const users = await User.findAll({ where: { email: emails } });
  for (const u of users) {
    if (u.platform_role === 'platform_admin') {
      abort(`데모 계정 ${u.email} 이 platform_admin 입니다`);
    }
    const foreignMember = await BusinessMember.findOne({
      where: {
        user_id: u.id,
        removed_at: null,
        ...(demoBusinessId ? { business_id: { [Op.ne]: demoBusinessId } } : {}),
      },
    });
    if (foreignMember) {
      abort(`데모 계정 ${u.email} 이 다른 워크스페이스(business_id=${foreignMember.business_id}) 멤버입니다`);
    }
    const foreignClient = await Client.findOne({
      where: {
        user_id: u.id,
        ...(demoBusinessId ? { business_id: { [Op.ne]: demoBusinessId } } : {}),
      },
    });
    if (foreignClient) {
      abort(`데모 계정 ${u.email} 이 다른 워크스페이스(business_id=${foreignClient.business_id})의 고객으로 연결돼 있습니다`);
    }
    const foreignOwned = await Business.findOne({
      where: {
        owner_id: u.id,
        ...(demoBusinessId ? { id: { [Op.ne]: demoBusinessId } } : {}),
      },
    });
    if (foreignOwned) {
      abort(`데모 계정 ${u.email} 이 다른 워크스페이스(business_id=${foreignOwned.id})의 소유자입니다`);
    }
  }
  // 반대 방향 — 데모 워크스페이스에 데모 아닌 사람이 들어와 있으면 abort
  if (demoBusinessId) {
    const members = await BusinessMember.findAll({
      where: { business_id: demoBusinessId, removed_at: null, user_id: { [Op.ne]: null } },
    });
    const memberIds = members.map((m) => m.user_id);
    if (memberIds.length) {
      const outsiders = await User.findAll({
        where: { id: memberIds, email: { [Op.notLike]: `%${DEMO_EMAIL_SUFFIX}` } },
        attributes: ['id', 'email'],
      });
      if (outsiders.length) {
        abort(`데모 워크스페이스에 데모 계정이 아닌 멤버가 있습니다: ${outsiders.map((o) => o.email).join(', ')}`);
      }
    }
  }
}

// ─────────────────────────────────────────────
// 계정 · 워크스페이스
// ─────────────────────────────────────────────
// 현재 약관/개인정보 버전 — 이 값이 없으면 로그인 직후 '약관이 업데이트됐습니다' 모달이 화면을 덮는다
let CURRENT_TERMS = { terms: null, privacy: null };
async function loadPolicyVersions() {
  const ps = await PlatformSetting.findOne();
  CURRENT_TERMS = { terms: ps ? ps.terms_version : null, privacy: ps ? ps.privacy_version : null };
}

async function upsertUser({ email, name, jobTitle }) {
  const password_hash = await bcrypt.hash(process.env.DEMO_CAPTURE_PASSWORD, 12);
  // 데모 계정은 username 도 demo_ 접두어로 통일 — 실 사용자 계정과 한눈에 구분되고 재실행 시 결정적
  const username = `demo_${email.split('@')[0].replace(/[^a-z0-9]/g, '')}`;
  const consent = {
    terms_accepted_at: now(), terms_version: CURRENT_TERMS.terms,
    privacy_accepted_at: now(), privacy_version: CURRENT_TERMS.privacy,
  };
  let user = await User.findOne({ where: { email } });
  if (user) {
    await user.update({ name, username, password_hash, status: 'active', language: 'ko', email_verified_at: user.email_verified_at || now(), ...consent });
    return user;
  }
  user = await User.create({
    email,
    username,
    password_hash,
    name,
    job_title: jobTitle || null,
    platform_role: 'user',
    status: 'active',
    language: 'ko',
    email_verified_at: now(),
    ...consent,
  });
  return user;
}

async function upsertBusiness(ownerId) {
  const attrs = {
    name: '온무늬',
    owner_id: ownerId,
    default_language: 'ko',
    brand_name: '온무늬',
    brand_name_en: 'Onmuni Studio',
    brand_tagline: '브랜드와 제품을 함께 만드는 스튜디오',
    legal_name: '주식회사 온무늬',
    legal_entity_type: 'corporation',
    representative: '김서연',
    biz_type: '서비스업',
    biz_item: '디자인 · 소프트웨어 개발',
    address: '서울특별시 성동구 성수동',
    phone: '02-1234-5678',
    email: 'hello@onmuni.example',
    timezone: 'Asia/Seoul',
    plan: 'pro',
    subscription_status: 'active',
    plan_expires_at: (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d; })(),
    default_currency: 'KRW',
    default_due_days: 14,
    deleted_at: null,
  };
  let biz = await Business.findOne({ where: { slug: DEMO_SLUG } });
  if (biz) { await biz.update(attrs); return biz; }
  return Business.create({ ...attrs, slug: DEMO_SLUG });
}

// ─────────────────────────────────────────────
// 자식 데이터 정리 (멱등 — 데모 워크스페이스 것만)
// ─────────────────────────────────────────────
async function wipeDemoData(businessId) {
  const convs = await Conversation.findAll({ where: { business_id: businessId }, attributes: ['id'] });
  const convIds = convs.map((c) => c.id);
  if (convIds.length) {
    await Message.destroy({ where: { conversation_id: convIds } });
    await ConversationParticipant.destroy({ where: { conversation_id: convIds } });
    await Conversation.destroy({ where: { id: convIds } });
  }

  const tasks = await Task.findAll({ where: { business_id: businessId }, attributes: ['id'] });
  const taskIds = tasks.map((t) => t.id);
  if (taskIds.length) {
    for (const table of ['task_status_history', 'task_reviewers', 'task_comments', 'task_attachments', 'task_daily_progress', 'task_links', 'task_user_hours']) {
      const col = table === 'task_links' ? 'task_a_id' : 'task_id';
      await sequelize.query(`DELETE FROM ${table} WHERE ${col} IN (:ids)`, { replacements: { ids: taskIds } }).catch(() => {});
      if (table === 'task_links') {
        await sequelize.query('DELETE FROM task_links WHERE task_b_id IN (:ids)', { replacements: { ids: taskIds } }).catch(() => {});
      }
    }
    await Task.destroy({ where: { id: taskIds } });
  }

  const invoices = await Invoice.findAll({ where: { business_id: businessId }, attributes: ['id'] });
  const invIds = invoices.map((i) => i.id);
  if (invIds.length) {
    for (const table of ['invoice_items', 'invoice_installments', 'invoice_status_history', 'invoice_payments']) {
      await sequelize.query(`DELETE FROM ${table} WHERE invoice_id IN (:ids)`, { replacements: { ids: invIds } }).catch(() => {});
    }
    await Invoice.destroy({ where: { id: invIds } });
  }

  const files = await File.findAll({ where: { business_id: businessId }, attributes: ['id', 'file_path'] });
  for (const f of files) {
    const abs = path.join(UPLOAD_ROOT, f.file_path || '');
    if (f.file_path && abs.startsWith(UPLOAD_ROOT) && fs.existsSync(abs)) fs.unlinkSync(abs);
  }
  await File.destroy({ where: { business_id: businessId }, force: true });
  await FileFolder.destroy({ where: { business_id: businessId } });
  await BusinessStorageUsage.destroy({ where: { business_id: businessId } });

  const projs = await Project.findAll({ where: { business_id: businessId }, attributes: ['id'] });
  const projIds = projs.map((p) => p.id);
  if (projIds.length) {
    await ProjectMember.destroy({ where: { project_id: projIds } });
    await ProjectClient.destroy({ where: { project_id: projIds } });
    for (const table of ['project_notes', 'project_issues', 'task_candidates', 'project_stages', 'project_workstreams', 'project_status_history']) {
      await sequelize.query(`DELETE FROM ${table} WHERE project_id IN (:ids)`, { replacements: { ids: projIds } }).catch(() => {});
    }
    await Project.destroy({ where: { id: projIds } });
  }

  await Client.destroy({ where: { business_id: businessId } });

  console.log(`  정리: 대화 ${convIds.length} · 업무 ${taskIds.length} · 청구서 ${invIds.length} · 파일 ${files.length} · 프로젝트 ${projIds.length}`);
}

// ─────────────────────────────────────────────
// 실제 파일 바이트 생성 (빈 row 금지 — 크기·해시 실측)
// ─────────────────────────────────────────────
function buildPdfBytes(title, lines, targetBytes) {
  // 유효 PDF 1페이지 — 제목 + 본문 몇 줄. 목록의 크기 표시가 실측값이 되도록 실제로 쓴다.
  // targetBytes 를 주면 미사용 스트림 오브젝트로 채워 실제 산출물다운 크기(수백 KB~MB)를 만든다.
  const esc = (s) => s.replace(/([()\\])/g, '\\$1');
  const body = [
    'BT /F1 20 Tf 60 760 Td (' + esc(title) + ') Tj ET',
    ...lines.map((l, i) => `BT /F1 11 Tf 60 ${720 - i * 18} Td (${esc(l)}) Tj ET`),
  ].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  if (targetBytes) {
    const pad = Math.max(0, targetBytes - 1200);
    const filler = 'PlanQ demo asset padding. '.repeat(Math.ceil(pad / 26)).slice(0, pad);
    objs.push(`<< /Length ${filler.length} >>\nstream\n${filler}\nendstream`);
  }
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { out += `${String(off).padStart(10, '0')} 00000 n \n`; });
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function createFileRow({ businessId, folderId, uploaderId, clientId, fileName, mime, bytes, description, ageDays }) {
  const ym = new Date().toISOString().slice(0, 7);
  const relDir = path.join(String(businessId), ym);
  const absDir = path.join(UPLOAD_ROOT, relDir);
  fs.mkdirSync(absDir, { recursive: true });
  const stored = `${crypto.randomUUID()}${path.extname(fileName)}`;
  fs.writeFileSync(path.join(absDir, stored), bytes);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const created = daysAgo(ageDays);
  return File.create({
    business_id: businessId,
    folder_id: folderId,
    client_id: clientId || null,
    uploader_id: uploaderId,
    file_name: fileName,
    file_path: path.join(relDir, stored),
    file_size: bytes.length,
    mime_type: mime,
    description: description || null,
    storage_provider: 'planq',
    content_hash: hash,
    ref_count: 1,
    visibility: 'L2',
    vlevel: 'L2',
    createdAt: created,
    updatedAt: created,
  });
}

// ─────────────────────────────────────────────
// 메인 시드
// ─────────────────────────────────────────────
async function seed() {
  console.log('─────────────────────────────────────');
  console.log('데모 워크스페이스 시드 (마케팅 캡처용)');
  console.log('─────────────────────────────────────\n');

  await assertSafeEnvironment();
  await sequelize.authenticate();
  await loadPolicyVersions();

  const existing = await Business.findOne({ where: { slug: DEMO_SLUG } });
  await assertDemoAccountsIsolated(existing ? existing.id : null);
  console.log('격리 가드 통과 (DB=' + process.env.DB_NAME + ')');

  // 1) 계정
  const users = {};
  for (const t of TEAM) users[t.key] = await upsertUser({ email: t.email, name: t.name, jobTitle: t.job });
  const clientUser = await upsertUser({ email: CLIENT_USER.email, name: CLIENT_USER.name, jobTitle: '마케팅팀장' });
  const owner = users.seoyeon;
  console.log(`계정 ${TEAM.length + 1}개 준비 (캡처 로그인: ${CAPTURE_EMAIL})`);

  // 2) 워크스페이스
  const biz = await upsertBusiness(owner.id);
  await assertDemoAccountsIsolated(biz.id);   // 생성 직후 재검사
  console.log(`워크스페이스 '${biz.name}' (id=${biz.id})`);

  // 3) 멤버
  for (const t of TEAM) {
    const u = users[t.key];
    const attrs = {
      role: t.role, name: t.name, default_role: t.defaultRole, job_title: t.job,
      joined_at: daysAgo(120), removed_at: null, invited_by: owner.id,
    };
    const bm = await BusinessMember.findOne({ where: { business_id: biz.id, user_id: u.id } });
    if (bm) await bm.update(attrs);
    else await BusinessMember.create({ business_id: biz.id, user_id: u.id, ...attrs });
  }

  // 4) 이전 데이터 정리
  await wipeDemoData(biz.id);

  // 5) 고객
  const clients = {};
  for (const c of CLIENTS) {
    clients[c.key] = await Client.create({
      business_id: biz.id,
      user_id: c.linkUser ? clientUser.id : null,
      display_name: c.contact,
      company_name: c.company,
      status: 'active',
      kind: 'customer',
      country: 'KR',
      is_business: true,
      biz_name: `주식회사 ${c.company}`,
      invited_by: owner.id,
      invited_at: daysAgo(90),
      joined_at: c.linkUser ? daysAgo(88) : null,
      accepted_at: c.linkUser ? daysAgo(88) : null,
      assigned_member_id: owner.id,
      notes: `${c.title} · ${c.contact}`,
    });
  }
  console.log(`고객 ${CLIENTS.length}곳`);

  // 5-1) 프로젝트 — 업무·대화가 어느 일에 속하는지 보이도록 (Q task 프로젝트 열 · Q talk 그룹)
  const projects = {};
  const projectSpecs = [
    { key: 'haneul', name: '노들커머스 브랜드 리뉴얼', desc: '로고 · 컬러 시스템 · 브랜드 가이드', start: -30, end: 45, lead: 'jimin' },
    { key: 'brick', name: '모눈스터디 앱 랜딩 리뉴얼', desc: '랜딩 5개 섹션 기획 · 디자인 · 퍼블리싱', start: -14, end: 30, lead: 'junho' },
    { key: 'green', name: '들녘테이블 패키지 디자인', desc: '패키지 3종 · 인쇄 감리', start: -60, end: -2, lead: 'jimin', status: 'closed' },
  ];
  for (const spec of projectSpecs) {
    const c = CLIENTS.find((x) => x.key === spec.key);
    const proj = await Project.create({
      business_id: biz.id,
      name: spec.name,
      description: spec.desc,
      client_company: c.company,
      status: spec.status || 'active',
      start_date: dateFromNow(spec.start),
      end_date: dateFromNow(spec.end),
      owner_user_id: owner.id,
      default_assignee_user_id: users[spec.lead].id,
    });
    await ProjectMember.create({ project_id: proj.id, user_id: owner.id, role: '기획', role_order: 0 });
    await ProjectMember.create({ project_id: proj.id, user_id: users[spec.lead].id, role: users[spec.lead] === users.jimin ? '디자인' : '개발', role_order: 1 });
    await ProjectClient.create({
      project_id: proj.id,
      contact_user_id: c.linkUser ? clientUser.id : null,
      contact_name: c.contact,
      contact_email: c.linkUser ? CLIENT_USER.email : null,
      invite_token: crypto.randomBytes(24).toString('hex'),
      invite_token_used_at: c.linkUser ? daysAgo(88) : null,
      invited_by: owner.id,
    });
    projects[spec.key] = proj;
  }
  console.log(`프로젝트 ${projectSpecs.length}개`);

  // 6) Q talk — 대화 3개
  const convHaneul = await Conversation.create({
    business_id: biz.id, client_id: clients.haneul.id, project_id: projects.haneul.id,
    channel_type: 'customer', display_name: '노들커머스 · 브랜드 리뉴얼',
    title: '노들커머스 · 브랜드 리뉴얼', status: 'active',
    auto_extract_enabled: true, cue_enabled: true, last_message_at: hoursAgo(5),
  });
  const convBrick = await Conversation.create({
    business_id: biz.id, client_id: clients.brick.id, project_id: projects.brick.id,
    channel_type: 'customer', display_name: '모눈스터디 · 앱 랜딩 리뉴얼',
    title: '모눈스터디 · 앱 랜딩 리뉴얼', status: 'active',
    auto_extract_enabled: true, cue_enabled: true, last_message_at: daysAgo(1),
  });
  const convTeam = await Conversation.create({
    business_id: biz.id,
    channel_type: 'internal', display_name: '온무늬 팀',
    title: '온무늬 팀', status: 'active',
    auto_extract_enabled: false, cue_enabled: true, last_message_at: hoursAgo(3),
  });

  const addParticipants = async (conv, entries) => {
    for (const e of entries) {
      await ConversationParticipant.create({
        conversation_id: conv.id, user_id: e.user_id, role: e.role, joined_at: daysAgo(30),
      });
    }
  };
  await addParticipants(convHaneul, [
    { user_id: owner.id, role: 'owner' },
    { user_id: users.jimin.id, role: 'member' },
    { user_id: clientUser.id, role: 'client' },
  ]);
  await addParticipants(convBrick, [
    { user_id: owner.id, role: 'owner' },
    { user_id: users.junho.id, role: 'member' },
  ]);
  await addParticipants(convTeam, [
    { user_id: owner.id, role: 'owner' },
    { user_id: users.jimin.id, role: 'member' },
    { user_id: users.junho.id, role: 'member' },
  ]);

  const msg = (conv, sender, content, at) => Message.create({
    conversation_id: conv.id, sender_id: sender.id, content, kind: 'text',
    createdAt: at, updatedAt: at,
  });

  await msg(convHaneul, owner, '안녕하세요 정민아 팀장님, 브랜드 리뉴얼 킥오프 내용 정리해서 공유드립니다. 이번 주 금요일에 1차 로고 시안 3종 보여드릴게요.', daysAgo(3));
  await msg(convHaneul, clientUser, '감사합니다. 저희 임원 보고가 다음 주 화요일이라 그 전에 컬러 시스템까지 같이 보면 좋겠습니다.', hoursAgo(68));
  await msg(convHaneul, owner, '네, 컬러 시스템 제안서도 같이 준비하겠습니다. 기존 로고 원본(AI) 파일만 전달 부탁드려요.', daysAgo(2));
  await msg(convHaneul, clientUser, '방금 자료실에 올려두었습니다. 확인 부탁드립니다.', hoursAgo(44));
  await msg(convHaneul, users.jimin, '확인했습니다. 시안 작업 착수했고 금요일 오전까지 PDF로 정리해 드리겠습니다.', daysAgo(1));
  await msg(convHaneul, clientUser, '좋습니다. 경쟁사 비교 자료도 한 장 넣어주시면 보고에 도움이 될 것 같아요.', hoursAgo(5));

  await msg(convBrick, owner, '강민재 대표님, 앱 랜딩 리뉴얼 범위 정리해서 견적서 초안 준비 중입니다. 페이지는 5개 기준으로 잡았습니다.', daysAgo(4));
  await msg(convBrick, users.junho, '현재 랜딩 성능 점검도 같이 진행 중입니다. 결과 나오면 개선 포인트와 함께 공유드리겠습니다.', daysAgo(1));

  await msg(convTeam, owner, '이번 주 우선순위 공유합니다. 노들커머스 시안 금요일 납품이 최우선이에요.', hoursAgo(30));
  await msg(convTeam, users.jimin, '로고 시안 3종 중 2종 완료했습니다. 오늘 중 나머지 한 종 마무리하겠습니다.', hoursAgo(26));
  await msg(convTeam, users.junho, '모눈스터디 랜딩 성능 점검 결과는 내일 오전에 정리해서 올릴게요.', hoursAgo(7));
  await msg(convTeam, owner, '좋습니다. 들녘테이블 청구서는 오늘 발송하겠습니다.', hoursAgo(3));
  console.log('대화 3개 · 메시지 12건');

  // 7) Q task — 업무 8건
  const week = mondayThisWeek();
  const taskSpecs = [
    { title: '노들커머스 로고 시안 3종 PDF 납품', assignee: users.jimin, client: clients.haneul, proj: 'haneul', status: 'in_progress', prog: 60, est: 8, act: 4.5, due: dateFromNow(2), start: dateFromNow(-2), cat: '디자인' },
    { title: '컬러 시스템 제안서(Primary·Secondary) 작성', assignee: users.jimin, client: clients.haneul, proj: 'haneul', status: 'in_progress', prog: 35, est: 5, act: 1.5, due: dateFromNow(3), start: dateFromNow(-1), cat: '디자인' },
    { title: '경쟁사 브랜드 비교표 1장 정리', assignee: owner, client: clients.haneul, proj: 'haneul', status: 'in_progress', prog: 40, est: 3, act: 1, due: dateFromNow(1), start: dateFromNow(-1), cat: '기획' },
    { title: '모눈스터디 랜딩 성능 점검 리포트 작성', assignee: users.junho, client: clients.brick, proj: 'brick', status: 'in_progress', prog: 70, est: 6, act: 4, due: dateFromNow(1), start: dateFromNow(-3), cat: '개발' },
    { title: '앱 랜딩 와이어프레임 5종 확정', assignee: users.junho, client: clients.brick, proj: 'brick', status: 'waiting', prog: 0, est: 12, act: 0, due: dateFromNow(10), start: dateFromNow(4), cat: '기획', week: null },
    { title: '노들커머스 리뉴얼 견적서 v2 작성', assignee: owner, client: clients.haneul, proj: 'haneul', status: 'not_started', prog: 0, est: 2, act: 0, due: dateFromNow(5), start: null, cat: '기획' },
    { title: '들녘테이블 패키지 최종 파일 납품', assignee: users.jimin, client: clients.green, proj: 'green', status: 'completed', prog: 100, est: 10, act: 11, due: dateFromNow(-2), start: dateFromNow(-12), cat: '디자인', done: daysAgo(2) },
    { title: '월간 운영 리포트 발송', assignee: owner, client: null, status: 'in_progress', prog: 50, est: 2, act: 1, due: dateFromNow(4), start: dateFromNow(-1), cat: '운영' },
  ];
  for (const t of taskSpecs) {
    await Task.create({
      business_id: biz.id,
      client_id: t.client ? t.client.id : null,
      project_id: t.proj ? projects[t.proj].id : null,
      title: t.title,
      assignee_id: t.assignee.id,
      created_by: owner.id,
      status: t.status,
      progress_percent: t.prog,
      estimated_hours: t.est,
      actual_hours: t.act,
      actual_source: 'user',
      start_date: t.start,
      due_date: t.due,
      completed_at: t.done || null,
      planned_week_start: t.week === null ? null : week,
      category: t.cat,
      source: 'manual',
      created_via: 'manual',
      createdAt: daysAgo(6),
      updatedAt: hoursAgo(6),
    });
  }
  console.log(`업무 ${taskSpecs.length}건`);

  // 8) Q file — 폴더 3 + 파일 8 (실제 바이트 기록)
  const folders = {};
  for (const [i, c] of CLIENTS.entries()) {
    folders[c.key] = await FileFolder.create({
      business_id: biz.id, parent_id: null, name: c.company, sort_order: i, created_by: owner.id,
    });
  }
  const fileSpecs = [
    { folder: 'haneul', client: 'haneul', name: '노들커머스_브랜드_리뉴얼_제안서.pdf', kind: 'pdf', up: 'seoyeon', age: 12, size: 1_240_000, desc: '킥오프 제안서 최종본', lines: ['1. 프로젝트 배경', '2. 리뉴얼 방향', '3. 일정 및 산출물', '4. 견적 개요'] },
    { folder: 'haneul', client: 'haneul', name: '로고_시안_3종_v1.pdf', kind: 'pdf', up: 'jimin', age: 2, size: 2_380_000, desc: '1차 시안 (A/B/C안)', lines: ['A안 — 심볼 중심', 'B안 — 워드마크 중심', 'C안 — 조합형'] },
    { folder: 'haneul', client: 'haneul', name: '컬러시스템_가이드.pdf', kind: 'pdf', up: 'jimin', age: 1, size: 880_000, desc: 'Primary·Secondary 팔레트', lines: ['Primary — Deep Teal', 'Secondary — Warm Sand', 'Accent — Coral'] },
    { folder: 'haneul', client: 'haneul', name: '기존_로고_사용_가이드.pdf', kind: 'pdf', up: 'seoyeon', age: 2, size: 640_000, desc: '고객 전달 기존 가이드', lines: ['현행 로고 사용 규정', '최소 여백 · 금지 사용 예'] },
    { folder: 'brick', client: 'brick', name: '모눈스터디_랜딩_와이어프레임.pdf', kind: 'pdf', up: 'junho', age: 5, size: 1_610_000, desc: '5개 페이지 구조', lines: ['Hero / Feature / Pricing', 'FAQ / CTA'] },
    { folder: 'brick', client: 'brick', name: '랜딩_성능점검_결과.pdf', kind: 'pdf', up: 'junho', age: 1, size: 430_000, desc: 'Lighthouse 측정 결과', lines: ['Performance 62 → 목표 90', 'LCP 4.1s / CLS 0.18', '이미지 최적화 우선'] },
    { folder: 'green', client: 'green', name: '들녘테이블_패키지_최종.pdf', kind: 'pdf', up: 'jimin', age: 3, size: 3_150_000, desc: '납품 최종 인쇄 데이터', lines: ['패키지 3종 전개도', '인쇄 사양 · 별색 지정'] },
    { folder: 'green', client: 'green', name: '들녘테이블_납품확인서.pdf', kind: 'pdf', up: 'seoyeon', age: 2, size: 264_000, desc: '최종 납품 확인', lines: ['납품일 · 산출물 목록', '검수 완료'] },
  ];
  let totalBytes = 0;
  for (const f of fileSpecs) {
    const bytes = buildPdfBytes(f.name.replace(/\.[^.]+$/, ''), f.lines, f.size);
    await createFileRow({
      businessId: biz.id,
      folderId: folders[f.folder].id,
      uploaderId: users[f.up].id,
      clientId: clients[f.client].id,
      fileName: f.name,
      mime: 'application/pdf',
      bytes,
      description: f.desc,
      ageDays: f.age,
    });
    totalBytes += bytes.length;
  }
  await BusinessStorageUsage.create({
    business_id: biz.id, bytes_used: totalBytes, file_count: fileSpecs.length, storage_provider: 'planq',
  });
  console.log(`파일 ${fileSpecs.length}건 (${(totalBytes / 1024 / 1024).toFixed(1)} MB) · 폴더 ${CLIENTS.length}개`);

  // 9) Q bill — 청구서 3건
  const year = new Date().getFullYear();
  const allNums = await Invoice.findAll({
    where: { invoice_number: { [Op.like]: `INV-${year}-%` } }, attributes: ['invoice_number'],
  });
  let maxSeq = 0;
  for (const r of allNums) {
    const m = /-(\d+)$/.exec(r.invoice_number || '');
    if (m) { const v = parseInt(m[1], 10); if (Number.isFinite(v) && v > maxSeq) maxSeq = v; }
  }
  const nextNumber = () => `INV-${year}-${String(++maxSeq).padStart(4, '0')}`;

  const invoiceSpecs = [
    {
      client: 'green', title: '들녘테이블 패키지 디자인 (최종)', status: 'paid',
      items: [
        { description: '패키지 디자인 3종', quantity: 1, unit_price: 2400000 },
        { description: '인쇄 감리 및 최종 파일 정리', quantity: 1, unit_price: 600000 },
      ],
      issued: daysAgo(18), due: dateFromNow(-4), paid: daysAgo(5),
    },
    {
      client: 'haneul', title: '노들커머스 브랜드 리뉴얼 착수금', status: 'sent',
      items: [
        { description: '브랜드 전략 · 로고 리뉴얼 착수금 (50%)', quantity: 1, unit_price: 5000000 },
      ],
      issued: daysAgo(6), due: dateFromNow(8),
    },
    {
      client: 'brick', title: '모눈스터디 앱 랜딩 리뉴얼', status: 'draft',
      items: [
        { description: '랜딩 페이지 5종 기획 · 디자인', quantity: 1, unit_price: 1600000 },
        { description: '퍼블리싱 및 성능 최적화', quantity: 1, unit_price: 600000 },
      ],
      due: dateFromNow(14),
    },
    // ── 지난 달들의 수금 이력 — Q bill 개요의 '월별 매출(12개월)' 그래프가 비어 보이지 않도록
    ...PAST_PAID.map((p) => ({
      client: p.client, title: p.title, status: 'paid',
      items: [{ description: p.item, quantity: 1, unit_price: p.amount }],
      issued: daysAgo(p.ago + 12), due: dateFromNow(-(p.ago - 2)), paid: daysAgo(p.ago),
    })),
  ];
  for (const spec of invoiceSpecs) {
    const subtotal = spec.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const tax = Math.round(subtotal * 0.1);
    const inv = await Invoice.create({
      business_id: biz.id,
      client_id: clients[spec.client].id,
      project_id: projects[spec.client].id,
      invoice_number: nextNumber(),
      title: spec.title,
      subtotal,
      total_amount: subtotal,
      tax_amount: tax,
      grand_total: subtotal + tax,
      paid_amount: spec.status === 'paid' ? subtotal + tax : 0,
      currency: 'KRW',
      vat_rate: 0.1,
      status: spec.status,
      installment_mode: 'single',
      payment_method: 'bank_transfer',
      receipt_type: 'tax_invoice',
      issued_at: spec.issued || null,
      sent_at: spec.status === 'draft' ? null : spec.issued,
      due_date: spec.due,
      paid_at: spec.paid || null,
      created_by: owner.id,
      owner_user_id: owner.id,
      createdAt: spec.issued || daysAgo(1),
      updatedAt: spec.paid || spec.issued || daysAgo(1),
    });
    for (const [i, it] of spec.items.entries()) {
      await InvoiceItem.create({
        invoice_id: inv.id,
        description: it.description,
        quantity: it.quantity,
        unit_price: it.unit_price,
        amount: it.quantity * it.unit_price,
        sort_order: i,
      });
    }
    // 수금 원장 — Insights 재무 엔진은 InvoicePayment 를 매출 원천으로 쓴다 (invoice.paid_at 단독은 집계 누락)
    if (spec.status === 'paid') {
      await InvoicePayment.create({
        invoice_id: inv.id,
        amount: subtotal + tax,
        method: 'bank_transfer',
        paid_at: spec.paid,
        currency: 'KRW',
        net_amount: subtotal + tax,
        recorded_by: owner.id,
        createdAt: spec.paid,
        updatedAt: spec.paid,
      });
    }
  }
  console.log(`청구서 ${invoiceSpecs.length}건 (수금 ${invoiceSpecs.filter((s2) => s2.status === 'paid').length}건)`);

  // 10) Q note — 별도 백엔드(FastAPI + SQLite)라 전용 파이썬 시드를 호출한다
  const { spawnSync } = require('child_process');
  const qnoteSeed = path.join(__dirname, '..', '..', 'q-note', 'scripts', 'seed_demo_sessions.py');
  const r = spawnSync('python3', [qnoteSeed, '--business-id', String(biz.id), '--user-id', String(owner.id), '--user-name', owner.name], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.warn(`⚠️ Q note 시드 실패 (스킵): ${(r.stderr || '').trim() || r.error?.message}`);
  } else {
    process.stdout.write(r.stdout);
  }

  console.log('\n─────────────────────────────────────');
  console.log('데모 워크스페이스 시드 완료');
  console.log(`  business_id : ${biz.id}`);
  console.log(`  로그인      : ${CAPTURE_EMAIL}`);
  console.log('─────────────────────────────────────');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n실패:', err.message);
    console.error(err);
    process.exit(1);
  });
