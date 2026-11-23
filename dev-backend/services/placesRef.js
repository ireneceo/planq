// 일정 장소 검색의 «기준 위치» 와 «최근에 쓴 장소» (2026-11-23, Irene «가까운 곳이 위로 · 최근에 쓴 장소 먼저»)
//
// 기준 위치(가까운 순서의 기준) — 앞에서부터 하나:
//   ① 사용자가 «내 주변» 을 눌러 보낸 위치(near) — 브라우저 위치는 묻는 창이 뜨므로 기본으로 쓰지 않는다(화면 버튼으로만)
//   ② 워크스페이스 주소 → 카카오 주소 검색(무료)으로 좌표. 한국 주소만 잡힌다
//   ③ 워크스페이스 시간대의 도시(시스템 tz 데이터 zone.tab 의 좌표 — 예: Asia/Kuala_Lumpur → 쿠알라룸푸르)
//   좌표는 메모리에만 두고 응답·DB·로그에 싣지 않는다.
// 최근에 쓴 장소 — 이 사람이 이 워크스페이스에서 만든 일정의 «위치» 글자(최근 180일) 중 검색어가 들어간 것. 본인 것만.
const fs = require('fs');

const TIMEOUT_MS = 3000;

// ── 시간대 → 도시 좌표 (zone.tab 은 tzdata 에 늘 있다. 없으면 이 단계만 건너뛴다)
let tzCoords = null;
function parseIso6709(s) {
  // ±DDMM±DDDMM 또는 ±DDMMSS±DDDMMSS
  const m = s.match(/^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/);
  if (!m) return null;
  const lat = (Number(m[2]) + Number(m[3]) / 60 + Number(m[4] || 0) / 3600) * (m[1] === '-' ? -1 : 1);
  const lng = (Number(m[6]) + Number(m[7]) / 60 + Number(m[8] || 0) / 3600) * (m[5] === '-' ? -1 : 1);
  return { lat, lng };
}
function loadTzCoords() {
  if (tzCoords) return tzCoords;
  tzCoords = new Map();
  for (const f of ['/usr/share/zoneinfo/zone.tab', '/usr/share/zoneinfo/zone1970.tab']) {
    try {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const [, coord, tz] = line.split('\t');
        if (tz && coord && !tzCoords.has(tz)) { const c = parseIso6709(coord); if (c) tzCoords.set(tz, c); }
      }
    } catch { /* 파일 없음 — 시간대 기준 없이 */ }
  }
  return tzCoords;
}
function tzPoint(tz) {
  return (tz && loadTzCoords().get(tz)) || null;
}

// ── 워크스페이스 주소 → 좌표 (카카오 주소 검색 · 24시간 메모리)
const addrCache = new Map(); // `${bizId}|${address}` → { at, point }
async function addressLookup(key, query) {
  try {
    const r = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?size=1&query=${encodeURIComponent(query)}`, {
      headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const d = (await r.json())?.documents?.[0];
    const lat = Number(d?.y); const lng = Number(d?.x);
    return d && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch { return null; }
}
async function geocodeKorean(address) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key || !address) return null;
  let q = String(address).replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  // 번지·층·호가 틀리면 0건이다 — 뒤의 숫자 토막을 두 번까지 떼며 다시 찾는다(도로·동 수준이면 기준 위치로 충분)
  for (let i = 0; i < 3 && q; i += 1) {
    const p = await addressLookup(key, q);
    if (p) return p;
    const parts = q.split(' ');
    if (parts.length < 3 || !/\d/.test(parts[parts.length - 1])) break;
    q = parts.slice(0, -1).join(' ');
  }
  return null;
}

const bizCache = new Map(); // bizId → { at, info:{ home, point, source } }
async function workspaceInfo(bizId) {
  if (!bizId) return { home: 'KR', point: null, source: null };
  const hit = bizCache.get(bizId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.info;
  const info = { home: 'KR', point: null, source: null };
  try {
    const { Business } = require('../models');
    const b = await Business.findByPk(bizId, { attributes: ['holiday_country', 'timezone', 'address'] });
    if (b) {
      if (b.holiday_country) info.home = String(b.holiday_country).toUpperCase();
      else if (b.timezone && b.timezone !== 'Asia/Seoul') info.home = 'XX';
      if (b.address) {
        const ak = `${bizId}|${b.address}`;
        const ah = addrCache.get(ak);
        let p;
        if (ah && Date.now() - ah.at < 24 * 3600 * 1000) p = ah.point;
        else { p = await geocodeKorean(b.address); addrCache.set(ak, { at: Date.now(), point: p }); }
        if (p) { info.point = p; info.source = 'address'; }
      }
      if (!info.point) { const p = tzPoint(b.timezone); if (p) { info.point = p; info.source = 'timezone'; } }
    }
  } catch { /* 못 읽으면 기준 없이 */ }
  bizCache.set(bizId, { at: Date.now(), info });
  if (bizCache.size > 1000) bizCache.delete(bizCache.keys().next().value);
  if (addrCache.size > 2000) addrCache.delete(addrCache.keys().next().value);
  return info;
}

// ── 최근에 쓴 장소 (본인이 만든 이 워크스페이스 일정 · 1분 메모리)
const recentCache = new Map(); // `${userId}|${bizId}` → { at, lines }
async function recentLines(userId, bizId) {
  if (!userId || !bizId) return [];
  const k = `${userId}|${bizId}`;
  const hit = recentCache.get(k);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.lines;
  let lines = [];
  try {
    const { CalendarEvent } = require('../models');
    const { Op } = require('sequelize');
    const rows = await CalendarEvent.findAll({
      attributes: ['location'],
      where: {
        business_id: bizId,
        created_by: userId,
        location: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] },
        updated_at: { [Op.gte]: new Date(Date.now() - 180 * 86400 * 1000) },
      },
      order: [['updated_at', 'DESC']],
      limit: 200,
      raw: true,
    });
    const seen = new Set();
    for (const r of rows) {
      const line = String(r.location || '').trim();
      const key = squash(line);
      if (!line || seen.has(key)) continue;
      seen.add(key); lines.push(line);
      if (lines.length >= 50) break;
    }
  } catch { lines = []; }
  recentCache.set(k, { at: Date.now(), lines });
  if (recentCache.size > 2000) recentCache.delete(recentCache.keys().next().value);
  return lines;
}
function squash(s) { return String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ''); }

// 검색어가 들어간 최근 장소 최대 n개 → 응답 칸 모양(«이름, 주소» 를 첫 쉼표에서 나눈다)
function matchRecent(lines, q, n = 3) {
  const nq = squash(q);
  if (!nq) return [];
  const out = [];
  for (const line of lines) {
    if (!squash(line).includes(nq)) continue;
    const i = line.indexOf(', ');
    const name = i > 0 ? line.slice(0, i) : line;
    const address = i > 0 ? line.slice(i + 2) : '';
    out.push({ id: `recent:${out.length}`, name, road_address: '', address, provider: 'recent', distance_m: null });
    if (out.length >= n) break;
  }
  return out;
}

// 브라우저가 보낸 «내 주변» 좌표 — 범위 검사 + 소수 3자리(≈110m)로 뭉갠다(캐시 키·요청에 정밀 위치를 남기지 않게)
function parseNear(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]); const lng = Number(m[2]);
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return null;
  return { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 };
}

module.exports = { workspaceInfo, recentLines, matchRecent, parseNear, squash, _test: { parseIso6709, tzPoint } };
