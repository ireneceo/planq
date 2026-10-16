// 사이드바 «메뉴 편집» 값 — 검증·정규화 한 곳(2026-10-16, Irene «권고대로»).
//
// 메뉴 키 목록은 화면 표(config/navMenus.ts)에 있다. 서버는 키 **모양**만 본다 —
// 모르는 키(앞으로 생기거나 사라진 메뉴)는 화면이 무시하고, 새 메뉴는 화면이 «보이는 끝» 에 붙인다.
// 숨김은 권한이 아니다(보기 편의) — 이 값으로 아무것도 막지 않는다.

const SECTIONS = ['features', 'personal'];
const KEY_RE = /^[a-z0-9-]{1,40}$/;
const MAX_KEYS = 40;

function cleanKeys(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const k of arr) {
    if (typeof k !== 'string' || !KEY_RE.test(k) || out.includes(k)) continue;
    out.push(k);
    if (out.length >= MAX_KEYS) break;
  }
  return out;
}

/** null/빈 값 → null(기본 그대로). 모양이 틀리면 throw('invalid_nav_prefs'). */
function normalizeNavPrefs(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_nav_prefs');
  const src = input.sections;
  if (!src || typeof src !== 'object' || Array.isArray(src)) throw new Error('invalid_nav_prefs');
  const sections = {};
  for (const name of SECTIONS) {
    const sec = src[name];
    if (!sec || typeof sec !== 'object') continue;
    const order = cleanKeys(sec.order);
    const hidden = cleanKeys(sec.hidden);
    if (order.length || hidden.length) sections[name] = { order, hidden };
  }
  return Object.keys(sections).length ? { v: 1, sections } : null;
}

module.exports = { normalizeNavPrefs, NAV_PREF_SECTIONS: SECTIONS };
