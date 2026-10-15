// services/mailImpersonation.js — 메일 사칭(숨김 문자·섞인 문자 체계·아는 도메인 흉내) 판정 **한 함수**.
//
// 설계 정본: docs/MAIL_IMPERSONATION_DESIGN.md (Fable 2026-10-15)
// Irene 2026-10-15: *"메일 스팸관련해서 이런 거 참고 가능해? … 기준이나 스팸관리 기능도 필요한 것 같아."*
//
// ★ 브랜드 목록·키워드로 가르지 않는다 — «구조(문자)» 와 «관계(아는 도메인)» 두 축뿐이다.
//   dev 실측: 진짜 피싱 4통이 **전부 SPF/DKIM pass**, 전부 표시이름·제목 단어 안에 숨김·방향 제어 문자.
//   유사 도메인·IDN 은 8,510통 중 0 → 아는 도메인과만 비교하면 조용하다.
// ★ 강한 근거 1개 = 격리(quarantine), 약한 근거만 = 경고(warn). 약을 더해 강으로 올리지 않는다.
// ★ 아는 상대(정확히 같은 주소)에게서 온 강 신호와 사람이 [스팸 아님] 한 스레드는 경고까지만.
// ★ detail 에는 원문을 넣지 않는다 — 코드·호스트·코드포인트만(검색 스니펫·공유로 새지 않게).
//
// 인입(emailImapCron)·재판정(retriage-mail)·[스팸 아님](mailSpamRelease)·브리프(mailBrief)가 이 함수를 같이 쓴다.
'use strict';

const url = require('url');
const CONF = require('./data/confusables-latin.json').map;

// ── 문자 ──────────────────────────────────────────────────────
const BIDI_RE = /[‪-‮⁦-⁩]/;
const FORMAT_CHARS = new Set([0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF, 0x2061, 0x2062, 0x2063, 0x2064, 0x00AD]);
const PICTO_RE = /[\p{Extended_Pictographic}︎️\u{1F3FB}-\u{1F3FF}]/u;
// ZWNJ/ZWJ 가 글자 사이에서 정상으로 쓰이는 문자 체계(페르시아어·인도계 문자 등) — 이 사이에 있으면 세지 않는다.
const JOINING_SCRIPT_RE = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Mongolian}]/u;

const hex = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

/** 단어 **안** 형식 문자 수와 코드포인트. 이모지 ZWJ 시퀀스·문자열 끝·공백 옆·결합 문자 체계 사이는 세지 않는다. */
function hiddenInWord(str) {
  const cps = Array.from(String(str || ''));
  let count = 0;
  const seen = new Set();
  for (let i = 0; i < cps.length; i += 1) {
    const cp = cps[i].codePointAt(0);
    if (!FORMAT_CHARS.has(cp)) continue;
    // 앞뒤의 «보이는» 글자 (연달아 붙은 형식 문자는 건너뛴다)
    let p = i - 1; while (p >= 0 && FORMAT_CHARS.has(cps[p].codePointAt(0))) p -= 1;
    let n = i + 1; while (n < cps.length && FORMAT_CHARS.has(cps[n].codePointAt(0))) n += 1;
    const prev = p >= 0 ? cps[p] : '';
    const next = n < cps.length ? cps[n] : '';
    if (!prev || !next || /\s/u.test(prev) || /\s/u.test(next)) continue;            // 끝·공백 옆 = 찌꺼기
    if (cp === 0x200D && (PICTO_RE.test(prev) || PICTO_RE.test(next))) continue;    // 🐈‍⬛ 같은 이모지 시퀀스
    if ((cp === 0x200C || cp === 0x200D) && JOINING_SCRIPT_RE.test(prev) && JOINING_SCRIPT_RE.test(next)) continue;
    count += 1;
    seen.add(hex(cp));
  }
  return { count, codes: [...seen] };
}

const stripFormat = (s) => Array.from(String(s || '')).filter((c) => !FORMAT_CHARS.has(c.codePointAt(0)) && !BIDI_RE.test(c)).join('');

/** UTS #39 skeleton(라틴 대상 부분집합) — NFD → 혼동 문자 → NFD → 소문자 → 결합 문자 제거. */
function skeleton(s) {
  const mapped = Array.from(String(s || '').normalize('NFD')).map((c) => {
    const key = c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    return CONF[key] != null ? CONF[key] : c;
  }).join('');
  return mapped.normalize('NFD').toLowerCase().replace(/\p{M}/gu, '');
}

// ── 문자 체계 ─────────────────────────────────────────────────
const SCRIPTS = ['Latin', 'Cyrillic', 'Greek', 'Armenian', 'Georgian', 'Cherokee', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Bopomofo',
  'Arabic', 'Hebrew', 'Thai', 'Devanagari'];
const SCRIPT_RES = SCRIPTS.map((s) => [s, new RegExp(`\\p{Script=${s}}`, 'u')]);
function scriptsOf(label) {
  const out = new Set();
  for (const ch of Array.from(label)) {
    if (!/\p{L}/u.test(ch)) continue;           // 숫자·하이픈(Common) 은 보지 않는다
    const hit = SCRIPT_RES.find(([, re]) => re.test(ch));
    out.add(hit ? hit[0] : 'Other');
  }
  return out;
}
// UTS #39 Highly Restrictive — 이 조합은 «섞임» 이 아니다.
const ALLOWED_MIXES = [
  new Set(['Latin', 'Han', 'Hiragana', 'Katakana']),
  new Set(['Latin', 'Han', 'Hangul']),
  new Set(['Latin', 'Han', 'Bopomofo']),
];
function isMixedScript(set) {
  if (set.size <= 1) return false;
  return !ALLOWED_MIXES.some((a) => [...set].every((s) => a.has(s)));
}

// ── 도메인 ────────────────────────────────────────────────────
// 등록 도메인(eTLD+1) 근사 — 공개 접미사 목록 대신 흔한 2단 접미사만(아는 도메인과 비교하는 용도로 충분).
const TWO_LEVEL_SUFFIX = /\.(co|or|ne|ac|go|re|pe|ed|mil|sc|hs|ms|es|kg)\.(kr|jp)$|\.(com|net|org|edu|gov|ac|co)\.(au|my|sg|uk|nz|cn|hk|tw|id|ph|vn|br|in|th|tr|za)$|\.co\.(uk|nz|za|id|in|th|il)$/i;
function asciiHost(host) {
  const h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!h) return '';
  const a = url.domainToASCII(h);
  return a || h;
}
function registrable(host) {
  const h = asciiHost(host);
  if (!h || /^[\d.]+$/.test(h)) return h;
  const parts = h.split('.');
  const keep = TWO_LEVEL_SUFFIX.test(h) ? 3 : 2;
  return parts.slice(-keep).join('.');
}
function domainOf(email) {
  const raw = String(email || '').toLowerCase().trim();
  const inAngle = raw.match(/<([^>]+)>/);
  const addr = (inAngle ? inAngle[1] : raw).trim();
  const at = addr.lastIndexOf('@');
  return at < 0 ? '' : addr.slice(at + 1).replace(/[>,;\s]+$/, '');
}

function damerau1(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const n = a.length; const m = b.length;
  const d = Array.from({ length: n + 1 }, (_, i) => { const r = new Array(m + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= m; j += 1) d[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[n][m];
}

const FREE_MAIL = () => require('./emailTriage').FREE_MAIL_DOMAIN;

/** 본문 <a href> 의 호스트 — 최대 50개. */
function linkHostsOf(html) {
  const out = new Set();
  if (!html) return [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']\s*https?:\/\/([^/"'?#\s:]+)/gi;
  let m;
  while ((m = re.exec(String(html))) && out.size < 50) out.add(m[1].toLowerCase());
  return [...out];
}

const DOMAIN_TOKEN_RE = /\b([a-z0-9][a-z0-9-]*\.)+(com|net|org|io|co|kr|jp|cn|group|biz|info|app|dev|me|us|uk|my|sg)\b/gi;

/**
 * 판정 — 순수 함수.
 * @returns null(신호 없음) | { level:'warn'|'quarantine', signals:[{code, level, detail}], known?:true, released_at? }
 */
function assess({
  fromName = '', fromEmail = '', replyTo = '', returnPath = '', subject = '',
  linkHosts = [], attachmentNames = [], knownDomains = null, workspaceName = '', ownDomains = null,
  known = false, released = null, bounce = false,
} = {}) {
  const signals = [];
  const add = (code, level, detail) => {
    if (!signals.some((s) => s.code === code && s.detail === detail)) signals.push({ code, level, detail });
  };

  // ① 양방향 제어 문자 — 업무 메일에 올 이유가 없다(실측 피싱 2/4).
  const textFields = [['name', fromName], ['subject', subject], ...attachmentNames.slice(0, 20).map((n) => ['file', n])];
  for (const [field, v] of textFields) {
    const cps = Array.from(String(v || '')).filter((c) => BIDI_RE.test(c)).map((c) => hex(c.codePointAt(0)));
    if (cps.length) add('bidi_override', 'strong', `${field}:${[...new Set(cps)].join(',')}`);
  }
  // ② 단어 안 숨김 문자 — 2개 이상 강, 1개 약.
  for (const [field, v] of textFields) {
    const h = hiddenInWord(v);
    if (h.count >= 2) add('hidden_chars', 'strong', `${field}:${h.codes.join(',')}`);
    else if (h.count === 1) add('hidden_chars', 'weak', `${field}:${h.codes.join(',')}`);
  }

  // ③④⑤ 도메인 — From·Reply-To·Return-Path·링크 호스트
  const fromDomain = domainOf(fromEmail);
  const hosts = [
    ['from', fromDomain], ['reply_to', domainOf(replyTo)], ['return_path', domainOf(returnPath)],
    // ★ 반송(DSN)의 본문 링크는 «우리가 잘못 적은 받는 주소» 다 — 오타 도메인이 아는 도메인과 한 글자 차이로 걸린다
    //   (dev 실측 4건 전부 이것). 반송은 링크를 보지 않는다(이름·제목·첨부 검사는 그대로).
    ...(bounce ? [] : linkHosts.slice(0, 50).map((h) => ['link', h])),
  ].filter(([, h]) => h);
  const known2 = knownDomains ? [...knownDomains].map(registrable).filter(Boolean) : [];
  const knownSet = new Set(known2);
  const knownSkel = new Map(known2.map((k) => [skeleton(url.domainToUnicode(k) || k), k]));
  for (const [where, host] of hosts) {
    const ascii = asciiHost(host);
    const uni = url.domainToUnicode(ascii) || host;
    for (const label of uni.split('.')) {
      const sc = scriptsOf(label);
      if (isMixedScript(sc)) { add('mixed_script_label', 'strong', `${where}:${ascii}`); break; }
      if (sc.size === 1 && !sc.has('Latin') && /[^\x00-\x7F]/.test(label)) {
        const sk = skeleton(label);
        if (/[a-z]/.test(sk) && /^[a-z0-9-]+$/.test(sk)) { add('ascii_masked_label', 'strong', `${where}:${ascii}`); break; }
      }
    }
    const reg = registrable(ascii);
    if (!reg || knownSet.has(reg) || FREE_MAIL().test(reg)) continue;
    const regSk = skeleton(url.domainToUnicode(reg) || reg);
    if (knownSkel.has(regSk)) { add('lookalike_known_domain', 'strong', `${where}:${ascii}~${knownSkel.get(regSk)}`); continue; }
    for (const k of known2) {
      if (k.length >= 6 && damerau1(reg, k) === 1) { add('lookalike_known_domain', 'strong', `${where}:${ascii}~${k}`); break; }
    }
  }

  // ⑥ 표시이름의 다른 도메인 / 아는 도메인의 이름 / 우리 워크스페이스 이름 (약)
  const cleanName = stripFormat(fromName).toLowerCase();
  const fromReg = registrable(fromDomain);
  if (cleanName && fromReg) {
    const toks = cleanName.match(DOMAIN_TOKEN_RE) || [];
    for (const tok of toks) {
      const tr = registrable(tok);
      // 같은 이름을 품은 자기 발송 도메인(Investing.com ← investingmail.com)은 사칭이 아니다 — dev 58스레드가 이것이었다.
      const a = tr.split('.')[0]; const b = fromReg.split('.')[0];
      const sameBrand = a.length >= 4 && b.length >= 4 && (b.includes(a) || a.includes(b));
      if (tr && tr !== fromReg && !fromReg.endsWith('.' + tr) && !sameBrand) { add('display_name_domain', 'weak', `${tr}~${fromReg}`); break; }
    }
    if (!knownSet.has(fromReg)) {
      for (const k of known2) {
        const brand = k.split('.')[0];
        if (brand.length >= 5 && cleanName.includes(brand)) { add('display_name_domain', 'weak', `${k}~${fromReg}`); break; }
      }
    }
    const ws = String(workspaceName || '').trim().toLowerCase();
    const own = ownDomains ? new Set([...ownDomains].map(registrable)) : null;
    if (ws.length >= 2 && cleanName.includes(ws) && own && !own.has(fromReg)) add('display_name_domain', 'weak', `workspace~${fromReg}`);
  }

  // ⑦ Reply-To 가 무료메일로 빠져나감 (약)
  const rtReg = registrable(domainOf(replyTo));
  if (rtReg && fromReg && rtReg !== fromReg && FREE_MAIL().test(rtReg) && !FREE_MAIL().test(fromReg)) {
    add('reply_to_divergent', 'weak', `${rtReg}~${fromReg}`);
  }

  if (!signals.length) return null;
  const strong = signals.some((s) => s.level === 'strong');
  const out = { level: strong ? 'quarantine' : 'warn', signals };
  // 아는 상대·사람이 풀어 준 스레드는 격리하지 않는다 — 배지(경고)는 남는다.
  if (strong && known) { out.level = 'warn'; out.known = true; }
  if (strong && released) { out.level = 'warn'; out.released_at = released; }
  return out;
}

/** 엔진·수집기가 같이 쓰는 결정 — 격리 기준이 꺼져 있으면 격리하지 않는다(배지는 남는다). */
function shouldQuarantine(result, off) {
  return !!(result && result.level === 'quarantine' && require('./mailCriteriaCatalog').isOn('impersonation', off));
}

// ── 아는 도메인 (5분 캐시) ─────────────────────────────────────
//   우리 발신 주소·별칭·워크스페이스 도메인 규칙 + 고객 주소 + 멤버 + 우리가 보낸 받는 사람.
//   무료메일은 뺀다(gmail.com 과 한 글자 차이인 도메인은 널렸다).
const _cache = new Map();
const TTL = 5 * 60 * 1000;
async function contextOf(businessId) {
  const hit = _cache.get(businessId);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const { sequelize } = require('../config/database');
  const T = require('./emailTriage');
  const free = FREE_MAIL();
  const known = new Set();
  const own = new Set();
  const addEmail = (set, e) => { const d = domainOf(e); if (d && !free.test(registrable(d))) set.add(registrable(d)); };
  try {
    for (const e of await T.buildOwnEmailSet(businessId)) { addEmail(known, e); addEmail(own, e); }
    const { EmailDomainRule, Business } = require('../models');
    const rules = await EmailDomainRule.findAll({ where: { business_id: businessId }, attributes: ['domain'] }).catch(() => []);
    for (const r of rules) { const d = registrable(r.domain); if (d) { known.add(d); own.add(d); } }
    const [cl] = await sequelize.query(
      `SELECT invite_email e FROM clients WHERE business_id = ? AND invite_email IS NOT NULL
       UNION SELECT billing_contact_email FROM clients WHERE business_id = ? AND billing_contact_email IS NOT NULL
       UNION SELECT u.email FROM business_members bm JOIN users u ON u.id = bm.user_id WHERE bm.business_id = ? AND bm.removed_at IS NULL`,
      { replacements: [businessId, businessId, businessId] });
    for (const r of cl) addEmail(known, r.e);
    const [sent] = await sequelize.query(
      `SELECT DISTINCT LOWER(SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(to_emails, '$[0].email')), '@', -1)) d
         FROM email_messages WHERE business_id = ? AND direction = 'outbound' AND to_emails IS NOT NULL
        ORDER BY d LIMIT 2000`, { replacements: [businessId] });
    for (const r of sent) { const d = registrable(r.d); if (d && d.includes('.') && !free.test(d)) known.add(d); }
    const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
    const value = { knownDomains: known, ownDomains: own, workspaceName: String(biz?.brand_name || biz?.name || '') };
    _cache.set(businessId, { at: Date.now(), value });
    if (_cache.size > 500) _cache.clear();
    return value;
  } catch (e) {
    console.warn('[mailImpersonation] contextOf', e.message);
    return { knownDomains: known, ownDomains: own, workspaceName: '' };
  }
}

/** mailparser 결과에서 입력을 만든다(인입). */
function inputFromParsed(parsed, { fromEmail, fromName }) {
  const rt = parsed.replyTo && parsed.replyTo.value && parsed.replyTo.value[0];
  const rp = parsed.headers && typeof parsed.headers.get === 'function' ? parsed.headers.get('return-path') : null;
  const rpAddr = rp && typeof rp === 'object' ? (rp.value && rp.value[0] && rp.value[0].address) || rp.text : rp;
  return {
    fromName, fromEmail, subject: parsed.subject || '',
    bounce: require('./emailTriage').isBounce(fromEmail, parsed.subject || ''),
    replyTo: rt ? rt.address : '', returnPath: rpAddr ? String(rpAddr) : '',
    linkHosts: linkHostsOf(parsed.html),
    attachmentNames: (parsed.attachments || []).map((a) => a.filename || '').filter(Boolean),
  };
}

/** 저장된 메시지에서 입력을 만든다(재판정·브리프·[스팸 아님]). */
function inputFromStored(message, attachmentNames = []) {
  const h = (message.triage_headers && typeof message.triage_headers === 'object') ? message.triage_headers : {};
  return {
    fromName: message.from_name || '', fromEmail: message.from_email || '', subject: message.subject || '',
    bounce: require('./emailTriage').isBounce(message.from_email || '', message.subject || ''),
    replyTo: h['reply-to'] || '', returnPath: h['return-path'] || '',
    linkHosts: linkHostsOf(message.body_html),
    attachmentNames,
  };
}

/** 한 스레드의 여러 판정 중 가장 센 것(스레드 = 메시지들의 최고 등급). released 는 유지한다. */
function mergeLevels(prev, next) {
  if (!next) return prev || null;
  if (!prev) return next;
  const rank = (x) => (x && x.level === 'quarantine' ? 2 : x ? 1 : 0);
  const pick = rank(next) >= rank(prev) ? next : prev;
  const signals = [...prev.signals];
  for (const s of next.signals) if (!signals.some((o) => o.code === s.code && o.detail === s.detail)) signals.push(s);
  return { ...pick, signals: signals.slice(0, 20), ...(prev.released_at ? { released_at: prev.released_at } : {}) };
}

/** 저장용 — 시각을 붙인다. */
function stamp(result) {
  return result ? { ...result, assessed_at: new Date().toISOString() } : null;
}

/** 스레드 하나를 저장된 메시지로 다시 판정(재판정 스크립트·[스팸 아님]·브리프가 쓴다). */
async function assessThread(thread, { known = false } = {}) {
  const { EmailMessage, EmailAttachment } = require('../models');
  const msgs = await EmailMessage.findAll({
    where: { thread_id: thread.id, direction: 'inbound' },
    attributes: ['id', 'from_email', 'from_name', 'subject', 'body_html', 'triage_headers'],
    order: [['id', 'ASC']], limit: 50,
  });
  if (!msgs.length) return null;
  const atts = await EmailAttachment.findAll({ where: { message_id: msgs.map((m) => m.id) }, attributes: ['message_id', 'filename'] });
  const ctx = await contextOf(Number(thread.business_id));
  const released = thread.impersonation && thread.impersonation.released_at ? thread.impersonation.released_at : null;
  let acc = null;
  for (const m of msgs) {
    const names = atts.filter((a) => a.message_id === m.id).map((a) => a.filename);
    acc = mergeLevels(acc, assess({ ...inputFromStored(m, names), ...ctx, known, released }));
  }
  return stamp(acc);
}

/** 목록 행용 — 등급과 신호 코드만. */
function rowView(imp) {
  if (!imp || !imp.level) return null;
  return { level: imp.level, codes: [...new Set((imp.signals || []).map((x) => x.code))], released: !!imp.released_at, known: !!imp.known };
}

/** 격리본의 링크를 죽인다 — href 를 떼고 글자만 남긴다(경고만 뜬 메일은 그대로). */
function disarmLinks(html) {
  if (!html) return html;
  return String(html).replace(/<(a|area)\b([^>]*)>/gi, (m, tag, attrs) => {
    const cleaned = attrs.replace(/\s(href|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return `<${tag}${cleaned} data-pq-disarmed="1">`;
  });
}

module.exports = {
  assess, rowView, disarmLinks, stripFormat, shouldQuarantine, contextOf, inputFromParsed, inputFromStored, assessThread, mergeLevels, stamp,
  // 검사용
  skeleton, hiddenInWord, registrable, linkHostsOf, damerau1,
  _clearCache: () => _cache.clear(),
};
