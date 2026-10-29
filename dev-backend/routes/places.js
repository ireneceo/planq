// /api/places — 일정 «위치» 칸 장소 자동완성 프록시 (2026-10-29, Irene «구글처럼 일정에 주소검색되서 입력»)
//   설계: Fable DESIGN-READY (D1~D8) — 카카오 로컬 키워드 검색 하나 · 키는 서버 .env(KAKAO_REST_API_KEY)에만.
//
// 계약:
//   - 응답은 화이트리스트 5칸(id·name·road_address·address·provider)만. 좌표·전화·카테고리·URL 은 싣지 않는다(저장도 안 한다).
//   - 키 없음 → 200 { data:[], disabled:true } · 카카오 오류·타임아웃·전역 상한 → 200 { data:[], degraded:true }.
//     자동완성은 부가 기능이라 4xx/5xx 로 입력칸을 흔들지 않는다(사용자 한도 초과 429 만 예외 — costGuard).
//   - 로그에 검색어 원문을 남기지 않는다(길이·상태·ms 만). DB 저장·감사로그 없음(CUD 아님).
//   - 테넌트 데이터가 아니라 워크스페이스 범위를 보지 않는다.
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { perUserDaily, capText } = require('../middleware/costGuard');
const { successResponse } = require('../utils/response');

const KAKAO_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 카카오 약관 — 결과 영구 저장 금지라 짧게
const CACHE_MAX = 300;

// 전역 일일 상한 — 사용자별 한도 × 사용자 수가 무료 한도(10만/일)를 넘기 전에 앱 쪽에서 멈춘다
let dayKey = '';
let dayCount = 0;
function underDailyCap() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) { dayKey = today; dayCount = 0; }
  const cap = Number(process.env.PLACES_DAILY_CAP) || 30000;
  if (dayCount >= cap) return false;
  dayCount += 1;
  return true;
}

const cache = new Map(); // q → { at, data } (Map 삽입 순서 = LRU)
function cacheGet(q) {
  const hit = cache.get(q);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(q); return null; }
  cache.delete(q); cache.set(q, hit);
  return hit.data;
}
function cacheSet(q, data) {
  cache.set(q, { at: Date.now(), data });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// 오류 로그는 분당 1회 요약
let errWindow = 0;
let errCount = 0;
function logDegraded(status, ms, qLen) {
  const now = Date.now();
  if (now - errWindow > 60 * 1000) {
    if (errCount > 1) console.warn(`[places] degraded ×${errCount} (지난 1분)`);
    errWindow = now; errCount = 0;
    console.warn(`[places] degraded provider=kakao status=${status} ms=${ms} qlen=${qLen}`);
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

function toItem(doc) {
  return {
    id: String(doc.id || ''),
    name: String(doc.place_name || ''),
    road_address: String(doc.road_address_name || ''),
    address: String(doc.address_name || ''),
    provider: 'kakao',
  };
}

router.get('/search',
  authenticateToken,
  ...perUserDaily('places-search', { perMin: 40, perDay: 800 }),
  async (req, res) => {
    const q = normalizeQuery(req.query.q);
    if (Array.from(q).length < 2) return successResponse(res, []);
    const key = process.env.KAKAO_REST_API_KEY;
    if (!key) return res.json({ success: true, data: [], disabled: true });

    const cached = cacheGet(q);
    if (cached) return successResponse(res, cached);
    if (!underDailyCap()) return res.json({ success: true, data: [], degraded: true });

    const started = Date.now();
    try {
      const url = `${KAKAO_URL}?size=7&query=${encodeURIComponent(q)}`;
      const r = await fetch(url, {
        headers: { Authorization: `KakaoAK ${key}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r.ok) {
        logDegraded(r.status, Date.now() - started, q.length);
        return res.json({ success: true, data: [], degraded: true });
      }
      const body = await r.json();
      const data = (Array.isArray(body?.documents) ? body.documents : []).map(toItem).filter(d => d.name || d.address);
      cacheSet(q, data);
      return successResponse(res, data);
    } catch (e) {
      logDegraded(e?.name === 'TimeoutError' ? 'timeout' : 'error', Date.now() - started, q.length);
      return res.json({ success: true, data: [], degraded: true });
    }
  });

module.exports = router;
module.exports._test = { normalizeQuery, toItem };
