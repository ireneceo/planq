// 표 열 설정(순서·폭·숨김) 값 — 검증·정규화 한 곳(2026-10-27, Irene «권고대로» 계정별 · Fable 설계 GO).
//
// 열 키·표 id 목록은 화면(dev-frontend/src/pages/*/…Columns.ts)에 있다. 서버는 **모양**만 본다 —
// 모르는 키는 화면이 버리고(normalizeTablePrefs), 폭 범위도 화면이 열마다 다시 자른다.
// 숨김은 권한이 아니다(보기 편의) — 이 값으로 아무것도 막지 않는다. 사이드바 메뉴 편집(navPrefs)과 같은 축.

const ID_RE = /^[a-z0-9-]{1,40}$/;
const MAX_KEYS = 40;
const MAX_TABLES = 30;
const MIN_W = 20;
const MAX_W = 2000;

function cleanKeys(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const k of arr) {
    if (typeof k !== 'string' || !ID_RE.test(k) || out.includes(k)) continue;
    out.push(k);
    if (out.length >= MAX_KEYS) break;
  }
  return out;
}

/** 표 하나. null/빈 값 → null(기본 그대로). 모양이 틀리면 throw('invalid_table_prefs'). */
function normalizeOneTable(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_table_prefs');
  const order = cleanKeys(input.order);
  const hidden = cleanKeys(input.hidden);
  const widths = {};
  if (input.widths !== undefined) {
    if (!input.widths || typeof input.widths !== 'object' || Array.isArray(input.widths)) throw new Error('invalid_table_prefs');
    for (const [k, v] of Object.entries(input.widths)) {
      if (!ID_RE.test(k) || typeof v !== 'number' || !Number.isFinite(v)) continue;
      widths[k] = Math.round(Math.min(MAX_W, Math.max(MIN_W, v)));
      if (Object.keys(widths).length >= MAX_KEYS) break;
    }
  }
  if (!order.length && !hidden.length && !Object.keys(widths).length) return null;
  return { order, widths, hidden };
}

/** 저장된 전체 값에 표 하나를 넣거나(prefs) 뺀다(null). 결과가 비면 null. */
function mergeTablePrefs(current, tableId, prefs) {
  if (typeof tableId !== 'string' || !ID_RE.test(tableId)) throw new Error('invalid_table_prefs');
  const one = normalizeOneTable(prefs);
  const tables = {};
  const src = current && typeof current === 'object' && current.tables && typeof current.tables === 'object' ? current.tables : {};
  for (const [id, v] of Object.entries(src)) {
    if (!ID_RE.test(id) || id === tableId) continue;
    try { const n = normalizeOneTable(v); if (n) tables[id] = n; } catch { /* 깨진 옛 값은 버린다 */ }
  }
  if (one) {
    if (Object.keys(tables).length >= MAX_TABLES) throw new Error('too_many_tables');
    tables[tableId] = one;
  }
  return Object.keys(tables).length ? { v: 1, tables } : null;
}

module.exports = { normalizeOneTable, mergeTablePrefs };
