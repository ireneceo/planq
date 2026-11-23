// /api/places — 일정 «위치» 칸 장소 자동완성 프록시 (2026-10-29, Irene «구글처럼 일정에 주소검색되서 입력»)
//   설계: Fable DESIGN-READY (D1~D8) — 카카오 로컬 키워드 검색 · 키는 서버 .env(KAKAO_REST_API_KEY)에만.
//   2026-11-23 해외 장소 — 구글 Places Autocomplete(New) 를 두 번째 제공자로(키 GOOGLE_PLACES_API_KEY · 없으면 카카오만, 종전 그대로).
//     고르는 순서(사용자는 고르지 않는다 — orderFor):
//       워크스페이스가 한국 기준(공휴일 국가 KR, 없으면 시간대 Asia/Seoul · 모르면 한국)이거나 검색어에 한글 → 카카오 먼저, 0건·못 쓰면 구글
//       그 밖 → 구글 먼저, 0건·못 쓰면 카카오. 앞 제공자가 주면 거기서 멈춘다 — 예외 하나: 한국 기준 + 한글 없는 검색어에
//       카카오가 1~2건만 주면 구글 후보를 뒤에 붙인다(«Tropicana» → «트로피카나» 1건 + 말레이시아 후보).
//     비용(구글만 유료): 3글자 이상만 · 화면 입력 지연 300ms + 늦은 요청 취소 · 세션 토큰(st) · 결과 캐시 5분(메모리만)
//       · 구글 전용 하루 상한 GOOGLE_PLACES_DAILY_CAP(기본 300 ≈ 월 9천 회 < 무료 1만 회). 넘으면 그날은 카카오만.
//     Place Details 는 부르지 않는다 — 자동완성의 이름·주소 줄로 충분하고, 세션 앞 12번 요청은 어차피 요청 단가라 Details 는 비용만 더한다.
//
// 계약:
//   - 응답은 화이트리스트 5칸(id·name·road_address·address·provider)만. 좌표·전화·카테고리·URL 은 싣지 않는다(저장도 안 한다).
//   - 두 키 다 없음 → 200 { data:[], disabled:true } · 부른 제공자가 모두 오류·타임아웃·상한 → 200 { data:[], degraded:true }.
//     자동완성은 부가 기능이라 4xx/5xx 로 입력칸을 흔들지 않는다(사용자 한도 초과 429 만 예외 — costGuard).
//   - 로그에 검색어 원문을 남기지 않는다(길이·상태·ms 만). DB 저장·감사로그 없음(CUD 아님).
//   - 테넌트 데이터를 내보내지 않는다. 워크스페이스는 «어느 제공자 먼저» 를 정하는 데만 읽는다(헤더 범위 · 명시 인자는 받지 않는다).
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { perUserDaily, capText } = require('../middleware/costGuard');
const { successResponse } = require('../utils/response');
const { requestScope } = require('../middleware/workspaceContext');

const KAKAO_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const GOOGLE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const GOOGLE_FIELDS = 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat';
const TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 카카오 약관 — 결과 영구 저장 금지라 짧게(구글도 같은 값, 메모리에만)
const CACHE_MAX = 300;

// 전역 일일 상한 — 제공자별. 카카오는 무료 한도(10만/일) 앞에서, 구글은 월 무료 1만 회 안에서 멈춘다.
const caps = { kakao: { day: '', n: 0 }, google: { day: '', n: 0 } };
function capOf(provider) {
  if (provider === 'google') {
    const raw = process.env.GOOGLE_PLACES_DAILY_CAP;
    const v = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(v) && v >= 0 ? v : 300;
  }
  return Number(process.env.PLACES_DAILY_CAP) || 30000;
}
function underDailyCap(provider) {
  const c = caps[provider];
  const today = new Date().toISOString().slice(0, 10);
  if (today !== c.day) { c.day = today; c.n = 0; }
  if (c.n >= capOf(provider)) return false;
  c.n += 1;
  return true;
}

const cache = new Map(); // key → { at, data } (Map 삽입 순서 = LRU)
function cacheGet(k) {
  const hit = cache.get(k);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(k); return null; }
  cache.delete(k); cache.set(k, hit);
  return hit.data;
}
function cacheSet(k, data) {
  cache.set(k, { at: Date.now(), data });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// 오류 로그는 분당 1회 요약
let errWindow = 0;
let errCount = 0;
function logDegraded(provider, status, ms, qLen) {
  const now = Date.now();
  if (now - errWindow > 60 * 1000) {
    if (errCount > 1) console.warn(`[places] degraded ×${errCount} (지난 1분)`);
    errWindow = now; errCount = 0;
    console.warn(`[places] degraded provider=${provider} status=${status} ms=${ms} qlen=${qLen}`);
  }
  errCount += 1;
}

function normalizeQuery(raw) {
  if (typeof raw !== 'string') return '';
  return capText(raw, 100)
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function normalizeLang(raw) {
  const m = typeof raw === 'string' && raw.match(/^([a-z]{2})(?:-[A-Za-z]{2})?$/);
  return m ? m[1] : 'ko';
}
function normalizeSession(raw) {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : '';
}
const hasHangul = (q) => /[가-힣ㄱ-ㆎ]/.test(q);

function toItem(doc) {
  return {
    id: String(doc.id || ''),
    name: String(doc.place_name || ''),
    road_address: String(doc.road_address_name || ''),
    address: String(doc.address_name || ''),
    provider: 'kakao',
  };
}
function toGoogleItem(s) {
  const p = s && s.placePrediction;
  if (!p) return null;   // queryPrediction(검색어 추천)은 장소가 아니다
  const main = p.structuredFormat?.mainText?.text || p.text?.text || '';
  const second = p.structuredFormat?.secondaryText?.text || '';
  return { id: String(p.placeId || ''), name: String(main), road_address: '', address: String(second), provider: 'google' };
}

// 워크스페이스가 어느 나라 기준인가 — 국가 칸이 따로 없어 공휴일 국가 → 시간대 순으로 본다. 모르면 한국.
const homeCache = new Map(); // bizId → { at, home }
async function homeRegion(bizId) {
  if (!bizId) return 'KR';
  const hit = homeCache.get(bizId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.home;
  let home = 'KR';
  try {
    const { Business } = require('../models');
    const b = await Business.findByPk(bizId, { attributes: ['holiday_country', 'timezone'] });
    if (b) {
      if (b.holiday_country) home = String(b.holiday_country).toUpperCase();
      else if (b.timezone && b.timezone !== 'Asia/Seoul') home = 'XX'; // 한국 밖 · 나라는 모름
    }
  } catch { /* 못 읽으면 한국 */ }
  homeCache.set(bizId, { at: Date.now(), home });
  if (homeCache.size > 1000) homeCache.delete(homeCache.keys().next().value);
  return home;
}

function orderFor(q, home) {
  return (home === 'KR' || hasHangul(q)) ? ['kakao', 'google'] : ['google', 'kakao'];
}

// 제공자 한 번 부르기 → { data } | { off:true }(키 없음·조건 밖·구글 상한) | { failed:true }(오류·카카오 상한)
async function callKakao(q) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return { off: true };
  if (!underDailyCap('kakao')) return { failed: true };
  const started = Date.now();
  try {
    const r = await fetch(`${KAKAO_URL}?size=7&query=${encodeURIComponent(q)}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) { logDegraded('kakao', r.status, Date.now() - started, q.length); return { failed: true }; }
    const body = await r.json();
    return { data: (Array.isArray(body?.documents) ? body.documents : []).map(toItem).filter(d => d.name || d.address) };
  } catch (e) {
    logDegraded('kakao', e?.name === 'TimeoutError' ? 'timeout' : 'error', Date.now() - started, q.length);
    return { failed: true };
  }
}
async function callGoogle(q, { lang, session, home }) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { off: true };
  if (Array.from(q).length < 3) return { off: true };   // 두 글자로는 쓸 만한 해외 후보가 안 나온다 — 돈만 든다
  if (!underDailyCap('google')) return { off: true };   // 상한은 오류가 아니다 — 화면을 30초 쉬게 하지 않고 그날은 카카오만
  const started = Date.now();
  const payload = { input: q, languageCode: lang };
  if (session) payload.sessionToken = session;
  if (/^[A-Z]{2}$/.test(home) && home !== 'KR') payload.regionCode = home.toLowerCase();
  try {
    const r = await fetch(GOOGLE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_FIELDS },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) { logDegraded('google', r.status, Date.now() - started, q.length); return { failed: true }; }
    const body = await r.json();
    const data = (Array.isArray(body?.suggestions) ? body.suggestions : [])
      .map(toGoogleItem).filter(d => d && (d.name || d.address)).slice(0, 7);
    return { data };
  } catch (e) {
    logDegraded('google', e?.name === 'TimeoutError' ? 'timeout' : 'error', Date.now() - started, q.length);
    return { failed: true };
  }
}

router.get('/search',
  authenticateToken,
  ...perUserDaily('places-search', { perMin: 40, perDay: 800 }),
  async (req, res) => {
    const q = normalizeQuery(req.query.q);
    if (Array.from(q).length < 2) return successResponse(res, []);
    if (!process.env.KAKAO_REST_API_KEY && !process.env.GOOGLE_PLACES_API_KEY) {
      return res.json({ success: true, data: [], disabled: true });
    }
    const lang = normalizeLang(req.query.lang);
    const session = normalizeSession(req.query.st);
    const home = await homeRegion(requestScope(req, null).businessId);
    const order = orderFor(q, home);
    const ck = `${order[0]}|${home}|${lang}|${q}`;
    const cached = cacheGet(ck);
    if (cached) return successResponse(res, cached);

    // 한국 기준인데 한글 없는 검색어로 카카오가 1~2건만 주면(«Tropicana» → «트로피카나» 1건) 해외 장소일 수 있다 —
    // 이때만 구글 후보를 뒤에 붙인다(카카오가 3건 이상이면 한국 장소로 보고 구글을 안 부른다).
    let failed = false;
    let got = [];
    for (const p of order) {
      const r = p === 'kakao' ? await callKakao(q) : await callGoogle(q, { lang, session, home });
      if (r.failed) { failed = true; continue; }
      if (r.off) continue;
      got = got.concat(r.data).slice(0, 7);
      const thinLatin = p === 'kakao' && order[0] === 'kakao' && !hasHangul(q) && r.data.length > 0 && r.data.length < 3;
      if (got.length && !thinLatin) break;
    }
    if (!got.length && failed) return res.json({ success: true, data: [], degraded: true });
    cacheSet(ck, got);
    return successResponse(res, got);
  });

module.exports = router;
module.exports._test = { normalizeQuery, toItem, toGoogleItem, orderFor, normalizeLang, normalizeSession, capOf };
