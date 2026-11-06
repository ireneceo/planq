// 워크스페이스 참여 — 열림 판정 한 벌 (2026-11-06 · docs/SIGNUP_START_JOIN_DESIGN.md §6-2, Fable 설계)
//   Irene: *"다른 워크스페이스 검색해서 신청하게는 못할까?"* → 이름 검색은 없다(고객사 이름이 드러난다).
//   대표가 켠 워크스페이스만 ① 회사 메일 도메인 일치 추천 ② 참여 코드로 찾는다.
//
// ★ 도메인 = 대표의 **인증된** 이메일 도메인(DNS 확인 없음) − 공용 메일 도메인.
// ★ 켜기·추천·신청이 모두 domainJoinOpen 하나를 본다 — 대표가 바뀌거나 이메일을 바꾸면 저장값을 고치지 않아도 저절로 닫힌다.
const crypto = require('crypto');
const { User } = require('../models');
const { PUBLIC_MAIL_DOMAINS } = require('../utils/publicMailDomains');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 0/O/1/I 제외
const CODE_LEN = 8;

function domainOf(email) {
  const s = String(email || '').trim().toLowerCase();
  const at = s.lastIndexOf('@');
  return at > 0 ? s.slice(at + 1) : '';
}

/** 사람의 인증된 주소들(주 + 보조) — 소문자. */
function verifiedEmailsOf(user) {
  if (!user) return [];
  const out = [];
  if (user.email && user.email_verified_at) out.push(String(user.email).trim().toLowerCase());
  if (user.secondary_email && user.secondary_email_verified_at) out.push(String(user.secondary_email).trim().toLowerCase());
  return [...new Set(out)];
}

/** 인증된 주소의 회사 도메인(공용 메일 제외). */
function companyDomainsOf(user) {
  return [...new Set(verifiedEmailsOf(user).map(domainOf).filter((d) => d && !PUBLIC_MAIL_DOMAINS.has(d)))];
}

const USER_ATTRS = ['id', 'email', 'email_verified_at', 'secondary_email', 'secondary_email_verified_at'];

/** 대표가 켤 수 있는 도메인 — 대표(owner_id)의 인증된 회사 메일 도메인. */
async function ownerVerifiedDomains(biz) {
  if (!biz?.owner_id) return [];
  const owner = await User.findByPk(biz.owner_id, { attributes: USER_ATTRS });
  return companyDomainsOf(owner);
}

/** 도메인 참여가 지금 열려 있나 — 켬 ∧ 저장 도메인이 대표의 인증된 회사 도메인 ∧ 살아 있음. */
async function domainJoinOpen(biz) {
  if (!biz || biz.deleted_at || !biz.join_by_domain || !biz.join_domain) return false;
  const domains = await ownerVerifiedDomains(biz);
  return domains.includes(String(biz.join_domain).toLowerCase());
}

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LEN);
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

/** 입력 정규화 — 대문자 · '-'·공백 제거. 형식이 아니면 null. */
function normalizeCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== CODE_LEN) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** 화면 표시 — ABCD-EFGH */
function formatCode(code) {
  return code ? `${code.slice(0, 4)}-${code.slice(4)}` : null;
}

module.exports = {
  domainOf, verifiedEmailsOf, companyDomainsOf, ownerVerifiedDomains, domainJoinOpen,
  generateCode, normalizeCode, formatCode, USER_ATTRS,
};
