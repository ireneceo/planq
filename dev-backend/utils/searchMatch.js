// 검색 결과의 "왜 여기 있는가" — 서버가 결과마다 { field, snippet } 을 붙인다.
//
// 짝: dev-frontend/src/utils/searchMatch.ts (같은 규칙 · 같은 정규식). 한쪽을 바꾸면 다른 쪽도 바꾼다.
//   · 검색어 NFC 정규화 + trim (routes/search.js #364)
//   · 공백 무시 — REPLACE(col,' ','') LIKE %squashed% 와 같은 뜻
//   · 공백은 토큰 구분자, 최대 4개 (routes/email_threads.js #212)
//   · 대소문자 무시 (MySQL *_ci)
//
// ★ 스니펫은 **평문 창(≤160자)** 만 내보낸다 — 본문 전체를 응답에 싣지 않는다.
// ★ 비밀(secret) 타입 값에서 스니펫을 만들지 않는다 — 호출자가 비밀 칸을 후보에서 뺀다.
// ★ 필드를 판정하지 못하면 null — 지어내지 않는다.
'use strict';

const SEARCH_MAX_TOKENS = 4;
const SEARCH_MAX_QUERY = 100;
const SNIPPET_MAX = 158;      // 양끝 … 포함 160자 이내
const SNIPPET_BEFORE = 60;

function parseSearchQuery(q) {
  const raw = String(q == null ? '' : q).normalize('NFC').trim().slice(0, SEARCH_MAX_QUERY);
  const tokens = raw ? raw.split(/\s+/).filter(Boolean).slice(0, SEARCH_MAX_TOKENS) : [];
  return { raw, tokens, squashed: raw.replace(/\s+/g, '') };
}

// u 플래그에서는 문법 문자 외 이스케이프(\- 등)가 SyntaxError — 문법 문자만.
const REGEX_SYNTAX = /[\\^$.*+?()[\]{}|/]/g;
const escapeRegex = (s) => s.replace(REGEX_SYNTAX, '\\$&');
const GAP = '[ \\u00A0]*';

function needleSource(needle) {
  return Array.from(String(needle).replace(/\s+/g, '')).map(escapeRegex).join(GAP);
}

/**
 * 검색어 → 정규식. mode:
 *   'any'    — 통째(공백 무시) + 토큰 각각 (하이라이트·필드 판정 기본)
 *   'phrase' — 통째(공백 무시)만
 *   needle   — 문자열 하나만 (opts.needle)
 */
function buildSearchRegex(q, opts = {}) {
  const { tokens, squashed } = parseSearchQuery(q);
  if (!squashed) return null;
  let needles;
  if (opts.needle != null) needles = [String(opts.needle)];
  else if (opts.mode === 'phrase') needles = [squashed];
  else needles = Array.from(new Set([squashed, ...(tokens.length > 1 ? tokens : [])]));
  needles = needles.filter((n) => n.replace(/\s+/g, ''))
    .sort((a, b) => Array.from(b).length - Array.from(a).length);
  if (!needles.length) return null;
  return new RegExp(needles.map(needleSource).join('|'), 'giu');
}

function findMatches(text, q, opts = {}) {
  const s = text == null ? '' : String(text);
  if (!s) return [];
  const re = buildSearchRegex(q, opts);
  if (!re) return [];
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[0].length === 0) { re.lastIndex += 1; continue; }
    const start = m.index;
    const end = m.index + m[0].length;
    const last = out[out.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else out.push({ start, end });
  }
  return out;
}

function textMatches(text, q, opts = {}) {
  if (text == null || text === '') return false;
  const re = buildSearchRegex(q, opts);
  if (!re) return false;
  return re.test(String(text).normalize('NFC'));
}

const ENTITY = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

function toPlainText(input) {
  if (input == null) return '';
  let s = String(input);
  if (/<[a-z!/][^>]*>/i.test(s)) {
    s = s
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|td|th|blockquote|pre)>/gi, ' ')
      .replace(/<[^>]+>/g, '');
  }
  const cp = (n) => (Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ');
  s = s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(Number(d)))
    .replace(/&(nbsp|lt|gt|quot|apos|#39);/g, (_, k) => ENTITY[k] || ' ')
    .replace(/&amp;/g, '&');
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

const isHigh = (c) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c) => c >= 0xdc00 && c <= 0xdfff;

/**
 * 첫 매칭 주변 창. 매칭이 없으면 null.
 * opts: before(앞 문맥 글자수) · max(창 최대) · plain(이미 평문) · forceStart/forceEnd(원문이 이미 잘린 창일 때 … 강제)
 *        · mode/needle (buildSearchRegex 와 같음)
 */
function makeSnippet(text, q, opts = {}) {
  const plain = opts.plain
    ? String(text == null ? '' : text).normalize('NFC').replace(/\s+/g, ' ').trim()
    : toPlainText(text);
  if (!plain) return null;
  const hits = findMatches(plain, q, opts);
  if (!hits.length) return null;
  const { start: ms, end: me } = hits[0];
  const max = Math.max(opts.max == null ? SNIPPET_MAX : opts.max, me - ms);
  const lead = Math.max(0, opts.before == null ? SNIPPET_BEFORE : opts.before);
  const len = plain.length;

  let start = Math.max(0, ms - lead);
  let end = Math.min(len, start + max);
  if (end < me) end = me;
  if (end === len) start = Math.max(0, Math.min(start, end - max));
  if (start > 0) {
    const sp = plain.indexOf(' ', start);
    if (sp !== -1 && sp < ms && sp - start <= 12) start = sp + 1;
  }
  if (end < len) {
    const sp = plain.lastIndexOf(' ', end);
    if (sp >= me && end - sp <= 12) end = sp;
  }
  if (start > 0 && start < ms && isLow(plain.charCodeAt(start))) start += 1;
  if (end < len && end > me && isHigh(plain.charCodeAt(end - 1))) end -= 1;

  const body = plain.slice(start, end).trim();
  const truncatedStart = start > 0 || !!opts.forceStart;
  const truncatedEnd = end < len || !!opts.forceEnd;
  return {
    text: body,
    before: plain.slice(start, ms),
    match: plain.slice(ms, me),
    after: plain.slice(me, end),
    truncatedStart,
    truncatedEnd,
    display: `${truncatedStart ? '…' : ''}${body}${truncatedEnd ? '…' : ''}`,
  };
}

/**
 * 후보 필드 중 처음 맞은 것 → { field, snippet }. 후보 순서가 우선순위.
 *   candidates: [{ field, text, shown }]  shown=true 면 스니펫을 만들지 않는다(행에 이미 보인다).
 *   text 가 배열이면 원소마다 검사한다.
 */
function pickMatch(candidates, q, opts = {}) {
  if (!parseSearchQuery(q).squashed) return null;
  for (const c of candidates) {
    const values = Array.isArray(c.text) ? c.text : [c.text];
    for (const v of values) {
      if (v == null || v === '') continue;
      const plain = toPlainText(v);
      if (!plain || !textMatches(plain, q, opts)) continue;
      if (c.shown) return { field: c.field, snippet: null };
      const sn = makeSnippet(plain, q, { ...opts, plain: true });
      return { field: c.field, snippet: sn ? sn.display : plain.slice(0, SNIPPET_MAX) };
    }
  }
  return null;
}

module.exports = {
  SEARCH_MAX_TOKENS,
  parseSearchQuery,
  buildSearchRegex,
  findMatches,
  textMatches,
  toPlainText,
  makeSnippet,
  pickMatch,
};
