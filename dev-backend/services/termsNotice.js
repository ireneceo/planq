// 이용약관 개정 고지 메일 — 받는 사람 고르기·보내기 한 곳. 약관 버전을 올리는 배포 단계(scripts/migrate-terms-handover.js)와
//   사람이 손으로 미리보기·재시도하는 문(scripts/send-terms-notice.js)이 같이 쓴다.
//   ★ 받는 사람 = 활성 계정 전체(삭제·정지·게스트·AI 제외). 막힌 주소(시스템·가짜)는 emailBlockReason 이 거른다.
//   ★ 멱등 — 이미 보낸 주소(EmailLog template·status='sent')는 건너뛴다. 중간에 끊겨도 다시 돌리면 남은 사람만.
//   ★ dev 는 EMAIL_SENDING_ENABLED=false 라 sendEmail 이 'skipped' 로만 남긴다.
const { Op } = require('sequelize');
const { User, EmailLog } = require('../models');
const { sendTermsNoticeEmail, emailBlockReason } = require('./emailService');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const templateFor = (version) => `terms_notice_${String(version).replace(/\W/g, '_')}`;

async function collectTargets({ version, only } = {}) {
  const where = { status: 'active', is_guest: false, is_ai: false, email: { [Op.ne]: null } };
  if (only) where.email = only;
  const users = await User.findAll({ where, attributes: ['id', 'email', 'name', 'language'], order: [['id', 'ASC']] });
  const sent = await EmailLog.findAll({ where: { template: templateFor(version), status: 'sent' }, attributes: ['to_email'] });
  const already = new Set(sent.map((r) => String(r.to_email || '').toLowerCase()));
  const targets = []; let done = 0; let blocked = 0;
  for (const u of users) {
    const to = String(u.email).trim().toLowerCase();
    if (already.has(to)) { done += 1; continue; }
    if (emailBlockReason(to)) { blocked += 1; continue; }
    targets.push({ id: u.id, to, name: u.name, lang: (u.language && u.language !== 'ko') ? 'en' : 'ko' });
  }
  return { users: users.length, done, blocked, targets };
}

/** 보내기 — { ok, fail }. log 는 한 줄씩 받는 함수(없으면 console.log). */
async function sendAll({ version, effectiveOn, targets, log = console.log, gapMs = 400 }) {
  let ok = 0; let fail = 0;
  for (const t of targets) {
    const r = await sendTermsNoticeEmail({ to: t.to, name: t.name, lang: t.lang, userId: t.id, effectiveOn, template: templateFor(version) });
    if (r) ok += 1; else fail += 1;
    if ((ok + fail) % 50 === 0) log(`[terms-notice] … ${ok + fail}/${targets.length}`);
    await sleep(gapMs);   // 발신 평판 — 한꺼번에 쏟지 않는다
  }
  return { ok, fail };
}

module.exports = { collectTargets, sendAll, templateFor };
