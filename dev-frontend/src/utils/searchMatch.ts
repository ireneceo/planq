// 검색어 하이라이트 · "왜 이 결과가 여기 있는가" — 모든 검색 결과 화면의 **단일 구현**.
//
// Irene 2026-09-11: "검색된 단어 키워드 색상 표시해서 알게 해줘. 모든 검색 결과에서 동일하게 적용해.
//                    왜 그 검색결과가 거기 있는지 알게."
//
// 서버 매칭 규칙을 그대로 따른다. 규칙을 바꾸면 **서버 짝도 같이** 바꾼다:
//   dev-backend/utils/searchMatch.js  (같은 함수 이름 · 같은 정규식)
//   · 검색어는 NFC 정규화 후 trim            — routes/search.js #364 (맥 NFD 검색어)
//   · 공백 무시 — "워드프레스" ↔ "워드 프레스"  — REPLACE(col,' ','') LIKE %squashed%
//   · 공백은 토큰 구분자, 최대 4개            — routes/email_threads.js #212 ("wordpress org")
//   · 대소문자 무시                           — MySQL *_ci collation
// ★ 정규식 메타문자는 전부 리터럴이다 — "c++ (x)" · "50%" 를 쳐도 패턴이 깨지거나 전건 매칭되지 않는다.
// ★ 화면마다 includes()·split() 으로 따로 칠하지 않는다. 같은 값의 공식이 두 벌이면 이미 갈라져 있다.

export const SEARCH_MAX_TOKENS = 4;
export const SEARCH_MAX_QUERY = 100;

export interface ParsedSearchQuery {
  /** NFC · trim · 100자 */
  raw: string;
  /** 공백으로 나눈 토큰 (최대 4) */
  tokens: string[];
  /** 공백을 모두 지운 검색어 */
  squashed: string;
}

export function parseSearchQuery(q: string | null | undefined): ParsedSearchQuery {
  const raw = String(q ?? '').normalize('NFC').trim().slice(0, SEARCH_MAX_QUERY);
  const tokens = raw ? raw.split(/\s+/).filter(Boolean).slice(0, SEARCH_MAX_TOKENS) : [];
  return { raw, tokens, squashed: raw.replace(/\s+/g, '') };
}

// u 플래그에서는 "문법 문자" 외의 역슬래시 이스케이프(\- 등)가 SyntaxError 다 — 문법 문자만 이스케이프한다.
const REGEX_SYNTAX = /[\\^$.*+?()[\]{}|/]/g;
const escapeRegex = (s: string) => s.replace(REGEX_SYNTAX, '\\$&');
// 글자 사이에 스페이스가 끼어도 맞는다 — REPLACE(col, ' ', '') 와 같은 뜻(줄바꿈은 건너지 않는다).
const GAP = '[ \\u00A0]*';

function needleSource(needle: string): string {
  return Array.from(needle.replace(/\s+/g, '')).map(escapeRegex).join(GAP);
}

const sourceCache = new Map<string, string | null>();

function regexSource(q: string | null | undefined): string | null {
  const key = String(q ?? '');
  if (sourceCache.has(key)) return sourceCache.get(key) ?? null;
  const { tokens, squashed } = parseSearchQuery(key);
  let src: string | null = null;
  if (squashed) {
    // 통째(공백 무시) + 토큰 각각. 긴 것부터 — 겹치면 긴 쪽이 이긴다.
    const needles = Array.from(new Set([squashed, ...(tokens.length > 1 ? tokens : [])]))
      .sort((a, b) => Array.from(b).length - Array.from(a).length);
    src = needles.map(needleSource).join('|');
  }
  if (sourceCache.size > 200) sourceCache.clear();
  sourceCache.set(key, src);
  return src;
}

/** 새 RegExp 를 만든다(g 플래그의 lastIndex 상태를 공유하지 않게). 검색어가 비면 null. */
export function buildSearchRegex(q: string | null | undefined): RegExp | null {
  const src = regexSource(q);
  return src ? new RegExp(src, 'giu') : null;
}

export interface MatchRange { start: number; end: number }

/** text 안의 매칭 구간 — 겹치거나 붙은 구간은 합친다. text 는 호출자가 NFC 로 넘긴다. */
export function findMatches(text: string | null | undefined, q: string | null | undefined): MatchRange[] {
  const s = text == null ? '' : String(text);
  if (!s) return [];
  const re = buildSearchRegex(q);
  if (!re) return [];
  const out: MatchRange[] = [];
  let m: RegExpExecArray | null;
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

export function textMatches(text: unknown, q: string | null | undefined): boolean {
  if (text == null) return false;
  const re = buildSearchRegex(q);
  if (!re) return false;
  return re.test(String(text).normalize('NFC'));
}

const ENTITY: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** HTML·엔티티를 걷어낸 한 줄 평문. 검색 스니펫 전용(표시용 sanitize 가 아니다 — 결과는 텍스트 노드로만 그린다). */
export function toPlainText(input: unknown): string {
  if (input == null) return '';
  let s = String(input);
  if (/<[a-z!/][^>]*>/i.test(s)) {
    s = s
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|td|th|blockquote|pre)>/gi, ' ')
      .replace(/<[^>]+>/g, '');
  }
  s = s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const n = parseInt(h, 16); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '; })
    .replace(/&#(\d+);/g, (_, d) => { const n = Number(d); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '; })
    .replace(/&(nbsp|lt|gt|quot|apos|#39);/g, (_, k) => ENTITY[k] ?? ' ')
    .replace(/&amp;/g, '&');
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export interface SearchSnippet {
  /** 창 안의 본문(말줄임표 없음) */
  text: string;
  before: string;
  match: string;
  after: string;
  truncatedStart: boolean;
  truncatedEnd: boolean;
  /** 잘린 쪽에 … 를 붙인 표시용 문자열 */
  display: string;
}

export interface SnippetOptions {
  /** 첫 매칭 앞에 남길 글자 수 (기본 40) */
  before?: number;
  /** 창 전체 최대 글자 수 (기본 160) */
  max?: number;
  /** 이미 평문이면 true — HTML 걷기를 건너뛴다 */
  plain?: boolean;
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** 첫 매칭 주변의 짧은 창. 매칭이 없으면 null. */
export function makeSnippet(text: unknown, q: string | null | undefined, opts: SnippetOptions = {}): SearchSnippet | null {
  const plain = opts.plain
    ? String(text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
    : toPlainText(text);
  if (!plain) return null;
  const hits = findMatches(plain, q);
  if (!hits.length) return null;
  const { start: ms, end: me } = hits[0];
  const max = Math.max(opts.max ?? 160, me - ms);
  const lead = Math.max(0, opts.before ?? 40);
  const len = plain.length;

  let start = Math.max(0, ms - lead);
  let end = Math.min(len, start + max);
  if (end < me) end = me;
  // 뒤가 모자라면 앞 문맥으로 채운다
  if (end === len) start = Math.max(0, Math.min(start, end - max));
  // 단어 경계로 살짝 맞춘다 (12자 이내)
  if (start > 0) {
    const sp = plain.indexOf(' ', start);
    if (sp !== -1 && sp < ms && sp - start <= 12) start = sp + 1;
  }
  if (end < len) {
    const sp = plain.lastIndexOf(' ', end);
    if (sp >= me && end - sp <= 12) end = sp;
  }
  // 이모지(서로게이트 쌍)를 반으로 자르지 않는다
  if (start > 0 && start < ms && isLow(plain.charCodeAt(start))) start += 1;
  if (end < len && end > me && isHigh(plain.charCodeAt(end - 1))) end -= 1;

  const body = plain.slice(start, end).trim();
  const truncatedStart = start > 0;
  const truncatedEnd = end < len;
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

/** 결과 행이 설명해야 하는 필드 이름 — i18n common:search.matchedIn.<key> 와 1:1. */
export type MatchFieldKey =
  | 'title' | 'name' | 'body' | 'content' | 'description' | 'summary' | 'memo'
  | 'sender' | 'recipient' | 'subject' | 'message' | 'label' | 'tag' | 'category'
  | 'attachment' | 'file_name' | 'email' | 'phone' | 'company' | 'client' | 'author'
  | 'project' | 'table' | 'value' | 'number' | 'url';

/** 서버가 결과마다 붙여 주는 설명. snippet 은 필드가 행에 안 보일 때만 채워진다. */
export interface SearchMatchInfo {
  field: MatchFieldKey | string;
  snippet?: string | null;
}

export interface MatchCandidate {
  field: MatchFieldKey;
  text: unknown;
  /** 이 필드가 이미 행에 보이는가 — 보이면 스니펫을 만들지 않는다(하이라이트로 충분) */
  shown?: boolean;
}

export interface PickedMatch {
  field: MatchFieldKey;
  shown: boolean;
  snippet: string | null;
}

/**
 * 어느 필드에서 맞았는가 — 후보 순서가 곧 우선순위다(보이는 필드를 앞에 둔다).
 * 클라이언트 필터 화면이 MatchReason 을 붙일 때 쓴다.
 */
export function pickMatch(candidates: MatchCandidate[], q: string | null | undefined, opts: SnippetOptions = {}): PickedMatch | null {
  if (!parseSearchQuery(q).squashed) return null;
  for (const c of candidates) {
    const values = Array.isArray(c.text) ? c.text : [c.text];
    for (const v of values) {
      if (v == null || v === '') continue;
      const plain = toPlainText(v);
      if (!plain || !textMatches(plain, q)) continue;
      if (c.shown) return { field: c.field, shown: true, snippet: null };
      const sn = makeSnippet(plain, q, { ...opts, plain: true });
      return { field: c.field, shown: false, snippet: sn ? sn.display : plain.slice(0, opts.max ?? 160) };
    }
  }
  return null;
}
