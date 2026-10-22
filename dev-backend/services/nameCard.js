// services/nameCard.js — 내 명함 한 곳. 설계 docs/BUSINESS_CARD_DESIGN.md (2026-10-17 Fable 설계 판정)
//
//   ① 칸 정규화·검증 normalizeFields — 인증 라우트 PATCH·만들기·불러오기가 같이 쓴다.
//   ② 공개 판정 resolvePublicCard — 공개 GET·사진·vcf·OG·보관·«새로 받기»·«원본 열기» 가 같은 함수.
//   ③ 공개 응답 cardPublicView — 공개 페이지 응답 = 받은 명함 스냅샷(두 벌이 갈라지지 않게).
//   ④ 채우기 prefillValues — 지금 내가 멤버(owner/admin/member)인 워크스페이스만.
//   ⑤ vCard toVcard · 사진 processPhoto(EXIF·위치정보 제거).
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const MAX_CARDS = 20;
const MAX_SAVED = 2000;
const MAX_LINKS = 6;

const CARD_DIR = path.join(__dirname, '..', 'uploads', 'name-cards');
const SAVED_DIR = path.join(CARD_DIR, 'saved');

class CardError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

function newToken() {
  return crypto.randomBytes(16).toString('base64url');   // 22자
}

// ─── ① 정규화 ───────────────────────────────────────────────────────────────
// 한 줄 칸은 제어문자·줄바꿈을 없앤다(vCard 속성 주입 — escape 만으로는 줄바꿈 주입이 남는다, Fable 비차단).
function oneLine(v, max) {
  if (v == null) return null;
  // eslint-disable-next-line no-control-regex
  const s = String(v).replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, max);
}
// 소개만 줄바꿈을 남긴다(최대 8줄)
function multiLine(v, max) {
  if (v == null) return null;
  const lines = String(v).replace(/\r\n?/g, '\n').split('\n')
    // eslint-disable-next-line no-control-regex
    .map((l) => l.replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim());
  const s = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().split('\n').slice(0, 8).join('\n');
  return s ? s.slice(0, max) : null;
}
function normUrl(v) {
  const s = oneLine(v, 300);
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  let u;
  try { u = new URL(withScheme); } catch { throw new CardError('invalid_url'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new CardError('invalid_url');
  if (!u.hostname || !u.hostname.includes('.')) throw new CardError('invalid_url');
  return u.toString().slice(0, 300);
}
function normPhone(v) {
  const s = oneLine(v, 40);
  if (!s) return null;
  if (!/^[0-9+()\-.\s]+(?:\s*(?:ext\.?|x|#|내선)\s*[0-9]{1,6})?$/i.test(s) || !/[0-9]{3,}/.test(s.replace(/\D/g, ''))) {
    throw new CardError('invalid_phone');
  }
  return s;
}
function normEmail(v) {
  const s = oneLine(v, 150);
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new CardError('invalid_email');
  return s;
}
function normColor(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new CardError('invalid_color');
  return s.toUpperCase();
}
function normLinks(v) {
  if (v == null) return null;
  if (!Array.isArray(v)) throw new CardError('invalid_links');
  const out = [];
  for (const it of v) {
    if (!it || typeof it !== 'object') continue;
    const url = normUrl(it.url);
    if (!url) continue;
    out.push({ label: oneLine(it.label, 40) || '', url });
    if (out.length > MAX_LINKS) throw new CardError('too_many_links');
  }
  return out.length ? out : null;
}

const FIELD_RULES = {
  label: (v) => oneLine(v, 60),
  name: (v) => oneLine(v, 100),
  name_en: (v) => oneLine(v, 100),
  job_title: (v) => oneLine(v, 100),
  department: (v) => oneLine(v, 100),
  company: (v) => oneLine(v, 150),
  intro: (v) => multiLine(v, 500),
  mobile: normPhone,
  phone: normPhone,
  fax: normPhone,
  email: normEmail,
  website: normUrl,
  address: (v) => oneLine(v, 300),
  links: normLinks,
  accent_color: normColor,
};
const CONTENT_FIELDS = Object.keys(FIELD_RULES).filter((k) => k !== 'label');

/** 들어온 키 중 아는 칸만 정규화해 돌려준다. 모르는 키는 버린다. 잘못된 값은 CardError. */
function normalizeFields(input) {
  const out = {};
  for (const [k, rule] of Object.entries(FIELD_RULES)) {
    if (input && Object.prototype.hasOwnProperty.call(input, k)) out[k] = rule(input[k]);
  }
  if (Object.prototype.hasOwnProperty.call(out, 'label') && !out.label) throw new CardError('label_required');
  return out;
}

// ─── ③ 응답 모양 ────────────────────────────────────────────────────────────
/** 공개 응답 — 화이트리스트. id·user_id·출처·명함 이름(label)·순서·토큰은 싣지 않는다. 받은 명함 스냅샷도 이 출력이다. */
/** 공개 응답 — 화이트리스트. brands 는 services/brands.brandsForCard(s) 가 거른 공개 모양(id 없음)을 받는다(v2 결정 1). */
function cardPublicView(card, brands = []) {
  const c = card.get ? card.get({ plain: true }) : card;
  return {
    name: c.name || '',
    name_en: c.name_en || null,
    job_title: c.job_title || null,
    department: c.department || null,
    company: c.company || null,
    intro: c.intro || null,
    mobile: c.mobile || null,
    phone: c.phone || null,
    fax: c.fax || null,
    email: c.email || null,
    website: c.website || null,
    address: c.address || null,
    links: Array.isArray(c.links) ? c.links.map((l) => ({ label: l.label || '', url: l.url })) : [],
    accent_color: c.accent_color || null,
    has_photo: !!c.has_photo,
    photo_ver: c.photo_ver || 0,
    updated_at: c.updated_at || c.updatedAt || null,
    brands: Array.isArray(brands) ? brands : [],
  };
}

/** 공개 응답 + 그 명함의 브랜드(지금 쓸 수 있는 것만) — 공개 GET·vcf·OG·보관이 같이 쓴다 */
async function cardPublicViewWithBrands(card) {
  const { brandsForCard } = require('./brands');
  return cardPublicView(card, await brandsForCard(card));
}

/** 주인 응답 — 공개 응답 + 주인만 보는 것(토큰·이름·출처·공개 여부). 주인 라우트에서만. */
function cardOwnerView(card, { linkOpen, brands } = {}) {
  const c = card.get ? card.get({ plain: true }) : card;
  return {
    ...cardPublicView(c, brands),
    id: c.id,
    label: c.label,
    source_business_id: c.source_business_id || null,
    is_public: !!c.is_public,
    public_token: c.public_token,
    sort_order: c.sort_order,
    // 링크가 지금 실제로 열리는가 — 공개를 켜도 이름이 비었거나 이메일 미인증이면 닫혀 있다
    link_open: linkOpen === undefined ? null : !!linkOpen,
    created_at: c.created_at || c.createdAt || null,
  };
}

// ─── ② 공개 판정 ────────────────────────────────────────────────────────────
/** 링크가 열리는가 — 열리면 null, 아니면 이유 코드. 주인 화면 안내와 공개 판정이 같은 함수를 쓴다. */
function closedReason(card, owner) {
  if (!card) return 'not_found';
  if (!card.is_public) return 'not_public';
  if (!card.name || !String(card.name).trim()) return 'no_name';
  if (!owner) return 'not_found';
  if (owner.status !== 'active' || owner.anonymized_at || owner.deletion_requested_at || owner.is_ai || owner.is_guest) return 'owner_inactive';
  // 미인증 계정이 planq.kr 아래 «공식처럼 보이는 연락처 페이지 + 외부 링크» 를 만드는 것을 막는다(Fable 비차단 → 반영)
  if (!owner.email_verified_at) return 'email_unverified';
  return null;
}

const OWNER_ATTRS = ['id', 'status', 'anonymized_at', 'deletion_requested_at', 'email_verified_at', 'is_ai', 'is_guest'];

/** 토큰 → 열린 명함(+ 주인) 또는 null. 없음·꺼짐·이름 없음·계정 비활성·미인증을 구분하지 않는다(존재 여부를 흘리지 않는다). */
async function resolvePublicCard(token) {
  const t = String(token || '');
  if (!TOKEN_RE.test(t)) return null;
  const { NameCard, User } = require('../models');
  const card = await NameCard.findOne({ where: { public_token: t } });
  if (!card) return null;
  const owner = await User.findByPk(card.user_id, { attributes: OWNER_ATTRS });
  return closedReason(card, owner) ? null : card;
}

/** 원본 명함(id) 이 지금 열려 있는가 — 받은 명함의 «새로 받기»·«원본 열기» */
async function resolveOpenById(cardId) {
  if (!cardId) return null;
  const { NameCard, User } = require('../models');
  const card = await NameCard.findByPk(cardId);
  if (!card) return null;
  const owner = await User.findByPk(card.user_id, { attributes: OWNER_ATTRS });
  return closedReason(card, owner) ? null : card;
}

// ─── ④ 채우기 ───────────────────────────────────────────────────────────────
const PREFILL_ROLES = ['owner', 'admin', 'member'];

async function prefillSources(userId) {
  const { BusinessMember, Business } = require('../models');
  const ms = await BusinessMember.findAll({ where: { user_id: userId, removed_at: null, role: PREFILL_ROLES }, attributes: ['business_id'], raw: true });
  if (!ms.length) return [];
  const bs = await Business.findAll({ where: { id: ms.map((m) => m.business_id) }, attributes: ['id', 'name', 'brand_name'], raw: true });
  return bs.map((b) => ({ business_id: b.id, name: b.brand_name || b.name || '' }));
}

function enOf(localized) {
  if (!localized) return null;
  let o = localized;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return null; } }
  return (o && typeof o === 'object' && o.en) ? String(o.en) : null;
}

function safe(rule, v) { try { return rule(v); } catch { return null; } }

/** 채울 값 — businessId 가 없으면 계정 정보만(빈 명함). 내가 멤버가 아니면 CardError 403. */
async function prefillValues(userId, businessId) {
  const { User, BusinessMember, Business, Department, Team } = require('../models');
  const user = await User.findByPk(userId, {
    attributes: ['id', 'name', 'name_localized', 'email', 'phone', 'job_title', 'organization', 'expertise', 'bio'],
  });
  if (!user) throw new CardError('user_not_found', 404);
  let member = null;
  let biz = null;
  let dept = null;
  if (businessId) {
    member = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId, removed_at: null, role: PREFILL_ROLES } });
    if (!member) throw new CardError('not_member', 403);
    biz = await Business.findByPk(businessId, { attributes: ['id', 'name', 'legal_name', 'address', 'phone', 'website'] });
    if (member.department_id && Department) dept = await Department.findOne({ where: { id: member.department_id, business_id: businessId }, attributes: ['name'] });
    if (!dept && member.team_id && Team) dept = await Team.findOne({ where: { id: member.team_id, business_id: businessId }, attributes: ['name'] });
  }
  const raw = {
    name: (member && member.name) || user.name,
    name_en: enOf(member && member.name_localized) || enOf(user.name_localized),
    job_title: (member && member.job_title) || user.job_title,
    department: dept ? dept.name : null,
    // 회사 칸 = 법인명(v2 결정 1 — 브랜드는 따로 고른다. 옛 brand_name 으로 채우던 것이 회사·브랜드가 섞이는 출발점이었다)
    company: biz ? (biz.legal_name || biz.name) : user.organization,
    intro: (member && member.expertise) || user.expertise,
    mobile: user.phone,
    phone: biz ? biz.phone : null,
    email: user.email,
    website: biz ? biz.website : null,
    address: biz ? biz.address : null,
  };
  // 원본에 이상한 값이 있어도 만들기가 실패하지 않게 — 통과하지 못한 칸은 비운다
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const val = safe(FIELD_RULES[k], v);
    if (val) out[k] = val;
  }
  return out;
}

// ─── ⑤ vCard ───────────────────────────────────────────────────────────────
function vEsc(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
// RFC 6350 — 75옥텟 넘으면 접는다(UTF-8 글자 중간을 자르지 않게)
function fold(line) {
  const buf = Buffer.from(line, 'utf8');
  if (buf.length <= 75) return line;
  const parts = [];
  let cur = '';
  let curLen = 0;
  let limit = 75;
  for (const ch of line) {
    const l = Buffer.byteLength(ch, 'utf8');
    if (curLen + l > limit) { parts.push(cur); cur = ''; curLen = 0; limit = 74; }
    cur += ch; curLen += l;
  }
  if (cur) parts.push(cur);
  return parts.join('\r\n ');
}

function toVcard(view, { photo, url } = {}) {
  const v = view || {};
  const name = v.name || '';
  // 한국어 이름은 성/이름을 가르지 않는다 — 통째로 FN·N 의 이름 칸
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:;${vEsc(name)};;;`, `FN:${vEsc(name)}`];
  if (v.name_en) lines.push(`X-PHONETIC-FIRST-NAME:${vEsc(v.name_en)}`, `NICKNAME:${vEsc(v.name_en)}`);
  const firstBrand = Array.isArray(v.brands) && v.brands[0] ? v.brands[0].name : '';
  const org = v.company || firstBrand;
  if (org || v.department) lines.push(`ORG:${vEsc(org || '')}${v.department ? `;${vEsc(v.department)}` : ''}`);
  if (v.job_title) lines.push(`TITLE:${vEsc(v.job_title)}`);
  if (v.mobile) lines.push(`TEL;TYPE=CELL:${vEsc(v.mobile)}`);
  if (v.phone) lines.push(`TEL;TYPE=WORK,VOICE:${vEsc(v.phone)}`);
  if (v.fax) lines.push(`TEL;TYPE=WORK,FAX:${vEsc(v.fax)}`);
  if (v.email) lines.push(`EMAIL;TYPE=INTERNET:${vEsc(v.email)}`);
  if (v.website) lines.push(`URL:${vEsc(v.website)}`);
  for (const l of v.links || []) lines.push(`URL:${vEsc(l.url)}`);
  for (const b of v.brands || []) for (const l of b.links || []) if (l.kind === 'website') lines.push(`URL:${vEsc(l.url)}`);
  if (url) lines.push(`URL;TYPE=PlanQ:${vEsc(url)}`);
  if (v.address) lines.push(`ADR;TYPE=WORK:;;${vEsc(v.address)};;;;`);
  if (v.intro) lines.push(`NOTE:${vEsc(v.intro)}`);
  if (photo && photo.length) lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${photo.toString('base64')}`);
  lines.push('END:VCARD');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

function vcardFilename(view) {
  const base = String((view && view.name) || 'card').replace(/[\\/:*?"<>|\r\n]+/g, '').trim().slice(0, 60) || 'card';
  return `attachment; filename="card.vcf"; filename*=UTF-8''${encodeURIComponent(`${base}.vcf`)}`;
}

// ─── 사진 ──────────────────────────────────────────────────────────────────
function cardPhotoPath(cardId) { return path.join(CARD_DIR, `c${Number(cardId)}.jpg`); }
function savedPhotoPath(savedId) { return path.join(SAVED_DIR, `s${Number(savedId)}.jpg`); }
function ensureDirs() {
  if (!fs.existsSync(SAVED_DIR)) fs.mkdirSync(SAVED_DIR, { recursive: true });
}
function readIfExists(p) {
  try { return fs.readFileSync(p); } catch { return null; }
}
function unlinkQuiet(p) {
  try { fs.unlinkSync(p); } catch { /* 없으면 그만 */ }
}

/** 올린 이미지 → 600×600 jpeg. sharp 는 기본으로 메타데이터(EXIF·GPS)를 버린다 — withMetadata() 를 부르지 않는다. */
async function processPhoto(buf) {
  const sharp = require('sharp');
  let meta;
  try { meta = await sharp(buf).metadata(); } catch { throw new CardError('image_unreadable'); }
  if (!meta || !['jpeg', 'png', 'webp', 'gif', 'avif', 'heif'].includes(meta.format)) throw new CardError('image_unreadable');
  try {
    return await sharp(buf, { failOn: 'error' }).rotate().resize(600, 600, { fit: 'cover', position: 'attention' })
      .flatten({ background: '#FFFFFF' }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  } catch { throw new CardError('image_unreadable'); }
}

module.exports = {
  TOKEN_RE, MAX_CARDS, MAX_SAVED, CARD_DIR, SAVED_DIR, CONTENT_FIELDS,
  CardError, newToken, normalizeFields, cardPublicView, cardPublicViewWithBrands, cardOwnerView, closedReason, OWNER_ATTRS, oneLine, normUrl,
  resolvePublicCard, resolveOpenById, prefillSources, prefillValues,
  toVcard, vcardFilename, cardPhotoPath, savedPhotoPath, ensureDirs, readIfExists, unlinkQuiet, processPhoto,
};
