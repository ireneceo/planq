// /api/places — 일정 «위치» 칸 장소 자동완성 프록시 (2026-10-29, Irene «구글처럼 일정에 주소검색되서 입력»)
//   설계: Fable DESIGN-READY (D1~D8) — 카카오 로컬 키워드 검색 · 키는 서버 .env(KAKAO_REST_API_KEY)에만.
//   2026-11-23 해외 장소 — 구글 Places Autocomplete(New) 를 두 번째 제공자로(키 GOOGLE_PLACES_API_KEY · 없으면 카카오만, 종전 그대로).
//     고르는 순서(Irene 11-23 «한글 없으면 구글, 한글이면 카카오 먼저 · 0개면 구글» — orderFor, 사용자는 고르지 않는다):
//       한글이 든 검색어 → 카카오 먼저, 0건·못 쓰면 구글(«쿠알라룸푸르 KLCC») · 한글 없음 → 구글 먼저, 0건·못 쓰면(키 없음 포함) 카카오.
//     가까운 곳이 위로(services/placesRef): 기준 = «내 주변» 버튼 위치(near) → 워크스페이스 주소(카카오 주소 검색) → 워크스페이스 시간대 도시.
//       카카오는 x·y 로 거리를 받아 정확도 순위와 섞는다(rankByNearness), 구글은 locationBias(원) + origin. 거리(distance_m)는 «내 주변» 일 때만 싣는다(도시 중심 거리는 뜻이 없다).
//     최근에 쓴 장소: 이 사람이 이 워크스페이스 일정에 쓴 «위치» 중 검색어가 든 것 최대 3개를 맨 위에(provider 'recent').
//     비용(구글만 유료): 3글자 이상만 · 화면 입력 지연 300ms + 늦은 요청 취소 · 세션 토큰(st) · 결과 캐시 5분(메모리만)
//       · 구글 전용 하루 상한 GOOGLE_PLACES_DAILY_CAP(기본 300 ≈ 월 9천 회 < 무료 1만 회). 넘으면 그날은 카카오만.
//     Place Details 는 부르지 않는다 — 자동완성의 이름·주소 줄로 충분하고, 세션 앞 12번 요청은 어차피 요청 단가라 Details 는 비용만 더한다.
//
// 계약:
//   - 응답은 화이트리스트 6칸(id·name·road_address·address·provider·distance_m)만. 좌표·전화·카테고리·URL 은 싣지 않는다(저장도 안 한다).
//   - 두 키 다 없음 → 200 { data:[], disabled:true } · 부른 제공자가 모두 오류·타임아웃·상한 → 200 { data:[], degraded:true }.
//     자동완성은 부가 기능이라 4xx/5xx 로 입력칸을 흔들지 않는다(사용자 한도 초과 429 만 예외 — costGuard).
//   - 로그에 검색어 원문을 남기지 않는다(길이·상태·ms 만). DB 저장·감사로그 없음(CUD 아님).
//   - 남의 데이터를 내보내지 않는다 — 워크스페이스는 기준 위치·나라에만, 일정은 본인이 만든 것의 «위치» 글자만 읽는다(헤더 범위 · 명시 인자는 받지 않는다).
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { perUserDaily, capText } = require('../middleware/costGuard');
const { successResponse } = require('../utils/response');
const { requestScope } = require('../middleware/workspaceContext');
const placesRef = require('../services/placesRef');

const KAKAO_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const GOOGLE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const GOOGLE_FIELDS = 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.distanceMeters';
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
    distance_m: doc.distance !== undefined && doc.distance !== '' && Number.isFinite(Number(doc.distance)) ? Math.round(Number(doc.distance)) : null,
  };
}
function toGoogleItem(s) {
  const p = s && s.placePrediction;
  if (!p) return null;   // queryPrediction(검색어 추천)은 장소가 아니다
  const main = p.structuredFormat?.mainText?.text || p.text?.text || '';
  const second = p.structuredFormat?.secondaryText?.text || '';
  const dm = Number(p.distanceMeters);
  return { id: String(p.placeId || ''), name: String(main), road_address: '', address: String(second), provider: 'google', distance_m: Number.isFinite(dm) && p.distanceMeters !== undefined ? Math.round(dm) : null };
}

function orderFor(q) {
  return hasHangul(q) ? ['kakao', 'google'] : ['google', 'kakao'];
}

// 제공자 한 번 부르기 → { data } | { off:true }(키 없음·조건 밖·구글 상한) | { failed:true }(오류·카카오 상한)
async function kakaoFetch(key, q, extra) {
  const started = Date.now();
  try {
    const r = await fetch(`${KAKAO_URL}?query=${encodeURIComponent(q)}${extra}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) { logDegraded('kakao', r.status, Date.now() - started, q.length); return null; }
    const body = await r.json();
    return (Array.isArray(body?.documents) ? body.documents : []).map(toItem).filter(d => d.name || d.address);
  } catch (e) {
    logDegraded('kakao', e?.name === 'TimeoutError' ? 'timeout' : 'error', Date.now() - started, q.length);
    return null;
  }
}

// 가까운 곳을 위로 — 단, 정확도를 버리지 않는다. 거리순(sort=distance)만 쓰면 «강남역» 에 근처 부동산이 맨 위로 온다(11-23 실측).
//   점수 = 정확도 순위(0~14, 정확도 목록에 없으면 10) + w·log10(1 + km) — 낮을수록 위. w: 내 주변 6 · 워크스페이스 기준 3.
//   예) 성수에서 «강남역»: 강남역 2호선 0+6·log10(10)=6 < 근처 가게 10+0.7 → 강남역이 위 · 부산에서 «스타벅스»: 근처 매장 10.5 < 서울 매장 15
function rankByNearness(accList, nearList, w) {
  const byId = new Map();
  accList.forEach((d, i) => byId.set(d.id || `a${i}`, { d, rank: i }));
  nearList.forEach((d, i) => { const k = d.id || `n${i}`; if (!byId.has(k)) byId.set(k, { d, rank: 10 }); });
  const score = ({ d, rank }) => rank + (d.distance_m == null ? 0 : w * Math.log10(1 + d.distance_m / 1000));
  return Array.from(byId.values()).sort((a, b) => score(a) - score(b)).map(x => x.d).slice(0, 7);
}

async function callKakao(q, ref, near) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return { off: true };
  if (!underDailyCap('kakao')) return { failed: true };
  if (!ref) {
    const list = await kakaoFetch(key, q, '&size=7');
    return list ? { data: list } : { failed: true };
  }
  const xy = `&x=${ref.lng}&y=${ref.lat}`;
  // 내 주변이면 3km 안 거리순도 같이(정확도 15건에 근처 매장이 없을 수 있다) — 카카오는 무료 한도 안이라 2회
  const [acc, nearBy] = await Promise.all([
    kakaoFetch(key, q, `&size=15${xy}`),
    near ? kakaoFetch(key, q, `&size=15${xy}&radius=3000&sort=distance`) : Promise.resolve([]),
  ]);
  if (!acc && !nearBy) return { failed: true };
  return { data: rankByNearness(acc || [], nearBy || [], near ? 6 : 3) };
}
async function callGoogle(q, { lang, session, home, ref, near }) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { off: true };
  if (Array.from(q).length < 3) return { off: true };   // 두 글자로는 쓸 만한 해외 후보가 안 나온다 — 돈만 든다
  if (!underDailyCap('google')) return { off: true };   // 상한은 오류가 아니다 — 화면을 30초 쉬게 하지 않고 그날은 카카오만
  const started = Date.now();
  const payload = { input: q, languageCode: lang };
  if (session) payload.sessionToken = session;
  if (/^[A-Z]{2}$/.test(home) && home !== 'KR') payload.regionCode = home.toLowerCase();
  if (ref) {
    const center = { latitude: ref.lat, longitude: ref.lng };
    payload.locationBias = { circle: { center, radius: near ? 20000 : 50000 } };   // 치우침일 뿐 — 먼 곳도 나온다
    payload.origin = center;
  }
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
    const near = placesRef.parseNear(req.query.near);
    const bizId = requestScope(req, null).businessId;
    const ws = await placesRef.workspaceInfo(bizId);
    const ref = near || ws.point;
    const recent = placesRef.matchRecent(await placesRef.recentLines(req.user?.id, bizId), q, 3);
    const order = orderFor(q);
    const refKey = ref ? `${ref.lat.toFixed(2)},${ref.lng.toFixed(2)}${near ? 'n' : ''}` : '-';
    const ck = `${ws.home}|${lang}|${refKey}|${q}`;
    const finish = (list) => {
      // 같은 곳이 두 번 나오지 않게 — 저장된 줄의 주소는 옛 표기(지번·직접 입력)일 수 있어 이름으로도 겹침을 본다
      const seenLine = new Set(recent.map(r => placesRef.squash(lineOf(r))));
      const seenName = new Set(recent.map(r => placesRef.squash(r.name)).filter(Boolean));
      const rest = list.filter(d => !seenLine.has(placesRef.squash(lineOf(d))) && !seenName.has(placesRef.squash(d.name)))
        .map(d => (near ? d : { ...d, distance_m: null }));
      return successResponse(res, recent.concat(rest).slice(0, 7));
    };

    const cached = cacheGet(ck);
    if (cached) return finish(cached);

    let failed = false;
    for (const p of order) {
      const r = p === 'kakao' ? await callKakao(q, ref, !!near) : await callGoogle(q, { lang, session, home: ws.home, ref, near: !!near });
      if (r.failed) { failed = true; continue; }
      if (r.off) continue;
      if (r.data.length) { cacheSet(ck, r.data); return finish(r.data); }
    }
    if (failed && !recent.length) return res.json({ success: true, data: [], degraded: true });
    if (!failed) cacheSet(ck, []);
    return finish([]);
  });

// 화면이 저장하는 줄과 같은 모양(LocationAutocomplete placeLine) — 최근 장소와 겹치는 후보를 빼는 데만 쓴다
function lineOf(p) {
  const addr = p.road_address || p.address;
  return !p.name || p.name === addr ? addr : addr ? `${p.name}, ${addr}` : p.name;
}

module.exports = router;
module.exports._test = { normalizeQuery, toItem, toGoogleItem, orderFor, normalizeLang, normalizeSession, capOf, lineOf, rankByNearness };
