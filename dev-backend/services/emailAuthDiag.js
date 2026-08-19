// services/emailAuthDiag.js — 발신 도메인 인증 진단 (SPF / DKIM / DMARC).
//
// 왜 만드는가
//   "DKIM 설정됐나요?" 를 사람이 물으면 답하는 쪽이 추측한다. 실제로 그 추측이 두 번 틀렸다 —
//   와일드카드 DNS 가 있는 도메인에서 selector 조회가 전부 응답하는 바람에 "DKIM 없음" 이라고
//   단정했고(오판), 다른 도메인은 `default` selector 에 실재하는데 못 찾았다.
//   그래서 화면이 **직접 조회해서** 보여준다. 사람의 기억이 아니라 DNS 가 근거가 된다.
//
// ★ 정직성 규칙 (이 파일의 존재 이유)
//   1. 판정은 **레코드 내용**으로만 한다. 이름이 응답한다는 사실은 증거가 아니다 —
//      와일드카드 DNS 는 존재하지 않는 이름에도 응답한다.
//   2. **DKIM 에 "없음" 판정을 내리지 않는다.** selector 를 모르면 부재를 증명할 수 없다
//      (selector 공간이 무한하다). 못 찾으면 '판별 불가' 이고, 이유를 문장으로 적는다.
//   3. 조회 실패(타임아웃·SERVFAIL)를 "없음" 으로 격하하지 않는다. 모르는 것과 없는 것은 다르다.
//   4. LLM 을 쓰지 않는다 — 추측 문장이 생길 경로를 원천 차단한다.
'use strict';

const dns = require('dns');
const crypto = require('crypto');

const resolver = new dns.promises.Resolver({ timeout: 3000, tries: 2 });

// 진단 결과 캐시 — 같은 도메인을 연달아 열어도 DNS 를 다시 때리지 않는다.
//   "다시 진단" 버튼을 따로 두지 않는다: TTL 이 곧 재진단 주기다(조회 폭주 차단).
const TTL_MS = 10 * 60 * 1000;
const cache = new Map();   // key → { at, value }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) { cache.delete(key); return null; }
  return hit.value;
}
function cacheSet(key, value) {
  // 무한 증식 방지 — 워크스페이스당 도메인 수는 작지만 상한을 둔다.
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// TXT 레코드는 255자 단위로 쪼개져 배열로 온다 — 이어 붙여야 v=DKIM1 같은 태그가 보인다.
async function txt(name) {
  try {
    const rows = await resolver.resolveTxt(name);
    return { ok: true, records: rows.map((parts) => parts.join('')) };
  } catch (e) {
    // ENOTFOUND / ENODATA = 그 이름에 TXT 가 없다 (부재의 증거로 쓸 수 있다)
    if (e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA')) return { ok: true, records: [] };
    return { ok: false, error: e && e.code ? e.code : 'lookup_failed' };
  }
}

// 와일드카드 감지 — 존재할 리 없는 이름을 물어본다. 응답하면 이 도메인은 이름 존재가 증거가 못 된다.
async function detectWildcard(domain) {
  const probe = `planq-probe-${crypto.randomBytes(6).toString('hex')}._domainkey.${domain}`;
  const r = await txt(probe);
  return r.ok && r.records.length > 0;
}

// DKIM selector 후보 — 제공자 프리셋을 앞에 둔다(맞출 확률이 높은 것부터).
const SELECTOR_CANDIDATES = ['google', 'selector1', 'selector2', 'default', 's1', 's2', 'k1', 'dkim'];
const MAX_SELECTORS = 8;

function statusOf(found, lookupFailed) {
  if (found) return 'ok';
  return lookupFailed ? 'lookup_failed' : 'missing';
}

async function checkSpf(domain) {
  const r = await txt(domain);
  if (!r.ok) return { key: 'spf', status: 'lookup_failed', error: r.error, records: [] };
  const spf = r.records.filter((v) => /^v=spf1\b/i.test(v.trim()));
  if (spf.length === 0) return { key: 'spf', status: 'missing', records: [] };
  // 2건 이상이면 수신 서버가 permerror 로 처리한다 — 있는 것보다 나쁜 상태라 따로 표시한다.
  return { key: 'spf', status: spf.length > 1 ? 'conflict' : 'ok', records: spf };
}

async function checkDmarc(domain) {
  const r = await txt(`_dmarc.${domain}`);
  if (!r.ok) return { key: 'dmarc', status: 'lookup_failed', error: r.error, records: [] };
  // ★ 내용 기반 — 와일드카드로 이름이 응답해도 v=DMARC1 태그가 없으면 수신 서버도 "없음" 으로 본다.
  //   즉 우리 판정 = 수신자 판정. 그래서 여기서는 '없음' 이 정직한 답이다.
  const rec = r.records.filter((v) => /^v=DMARC1\b/i.test(v.trim()));
  return { key: 'dmarc', status: rec.length ? 'ok' : 'missing', records: rec };
}

async function checkDkim(domain, { wildcard, extraSelectors = [] }) {
  const list = [];
  for (const s of [...extraSelectors, ...SELECTOR_CANDIDATES]) {
    const v = String(s || '').trim().toLowerCase();
    if (v && !list.includes(v)) list.push(v);
    if (list.length >= MAX_SELECTORS) break;
  }
  let anyLookupFailed = false;
  for (const sel of list) {
    const r = await txt(`${sel}._domainkey.${domain}`);
    if (!r.ok) { anyLookupFailed = true; continue; }
    // ★ 내용 기반 — 와일드카드가 응답한 빈 문자열·무관한 TXT 는 통과하지 못한다.
    const hit = r.records.find((v) => /(^|;|\s)v=DKIM1\b/i.test(v) || /(^|;|\s)p=[A-Za-z0-9+/=]/.test(v));
    if (hit) return { key: 'dkim', status: 'ok', selector: sel, records: [hit], tried: list };
  }
  // ★ 여기서 '없음' 을 내지 않는다 — selector 를 모르면 부재를 증명할 수 없다.
  return {
    key: 'dkim',
    status: anyLookupFailed ? 'lookup_failed' : 'unknown',
    reason: wildcard ? 'wildcard_dns' : 'selector_unknown',
    tried: list,
    records: [],
  };
}

/** 도메인 1개 진단. 결과는 10분 캐시. */
async function diagnose(domain, { selector } = {}) {
  const d = String(domain || '').trim().toLowerCase();
  const key = `${d}|${String(selector || '').trim().toLowerCase()}`;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const wildcard = await detectWildcard(d);
  const extraSelectors = selector ? [String(selector).trim().toLowerCase()] : [];
  const [spf, dmarc, dkim] = await Promise.all([
    checkSpf(d),
    checkDmarc(d),
    checkDkim(d, { wildcard, extraSelectors }),
  ]);
  // 종합 판정 = 세 항목 중 가장 나쁜 상태. 'unknown' 은 실패가 아니라 **모름** 이라 별도로 둔다.
  const rank = { ok: 0, unknown: 1, conflict: 2, lookup_failed: 2, missing: 3 };
  const overall = [spf, dmarc, dkim].reduce(
    (worst, x) => (rank[x.status] > rank[worst] ? x.status : worst), 'ok',
  );
  const value = { domain: d, wildcard_dns: wildcard, checks: { spf, dmarc, dkim }, overall, cached: false };
  return cacheSet(key, value);
}

module.exports = { diagnose, SELECTOR_CANDIDATES, _cache: cache };
