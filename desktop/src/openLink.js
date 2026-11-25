// planq://open?url=<https 전체 주소>&u=<사용자 번호> — 브라우저의 «데스크탑 앱에서 열기» 가 넘긴 PlanQ 링크 판정 한 곳 (2026-11-25).
//   설계: Fable 판정(DESIGN-CHANGE 반영) — ② 경로가 아니라 전체 주소(운영·개발 껍데기가 같은 planq:// 를 쓴다 → 출처가 다르면 버림)
//   ③ new URL 로 푼 pathname 에 접두어 맞춤 · 접두어(앱 화면)만 · oauth 복귀는 open 으로 안 받음 · 탈락하면 아무것도 안 보냄.
//   화면 이동만 한다(폰 앱 유니버설 링크와 같은 수준). 접두어 목록은 link-paths.json — scripts/cap-link-domains.js 가 쓴다.
'use strict';

const { prefixes } = require('./link-paths.json');

// 제어문자·역슬래시·인코딩된 점/슬래시 — URL 정규화를 우회하려는 모양은 통째로 버린다
const BAD = /[\u0000-\u001f\u007f\\]|%2e|%2f|%5c/i;

/** @returns {{ path: string, u: number|null } | null} */
function judgeOpenLink(raw, appOrigin) {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let outer;
  try { outer = new URL(raw); } catch { return null; }
  if (outer.protocol !== 'planq:' || outer.hostname !== 'open' || !/^\/?$/.test(outer.pathname)) return null;
  const target = outer.searchParams.get('url');
  if (!target || BAD.test(target)) return null;
  let t;
  try { t = new URL(target); } catch { return null; }
  if (t.origin !== appOrigin || t.username || t.password) return null;
  const p = t.pathname;
  if (!prefixes.some((x) => p === x || p.startsWith(x))) return null;
  const uRaw = outer.searchParams.get('u');
  const u = uRaw && /^\d{1,12}$/.test(uRaw) ? Number(uRaw) : null;
  return { path: (p + t.search + t.hash).slice(0, 1000), u };
}

module.exports = { judgeOpenLink };
