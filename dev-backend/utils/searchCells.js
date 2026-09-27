// utils/searchCells.js — 표 셀·Q info 항목 값 검색의 판정·스니펫 (routes/search.js 에서 그대로 옮김, 2026-09-27).
//   ★ 비밀(secret) 칸은 판정에서도 스니펫에서도 뺀다. 동작을 바꾸지 않았다 — 파일 500줄 한도 때문에 옮긴 것이다.
const { makeSnippet, textMatches, toPlainText } = require('./searchMatch');

const asObj = (v) => {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};

// 셀·항목 값 → 검색용 평문. 배열(multi_select)은 쉼표로, 객체는 버린다(구조값에서 문장을 지어내지 않는다).
const cellText = (raw) => {
  if (raw == null) return '';
  if (Array.isArray(raw)) return raw.filter((x) => x != null && typeof x !== 'object').join(', ');
  if (typeof raw === 'object') return '';
  return String(raw);
};

// { 항목명: 값 } 에서 **비밀이 아닌** 첫 매칭 → "항목명: …값…" 스니펫. 없으면 null.
//   columns: [{ id, name, type }] — type==='secret' 인 칸은 후보에서 뺀다.
function columnValueSnippet(columns, values, q) {
  const cols = Array.isArray(columns) ? columns : [];
  const vals = values && typeof values === 'object' ? values : {};
  const secretIds = new Set(cols.filter((c) => c && c.type === 'secret').map((c) => String(c.id)));
  const nameOf = new Map(cols.filter(Boolean).map((c) => [String(c.id), c.name || c.label || '']));
  for (const [colId, raw] of Object.entries(vals)) {
    if (secretIds.has(String(colId))) continue;
    const text = toPlainText(cellText(raw));
    if (!text || !textMatches(text, q)) continue;
    const name = nameOf.get(String(colId)) || '';
    const sn = makeSnippet(text, q, { plain: true, max: name ? Math.max(40, 150 - name.length) : 158 });
    const body = sn ? sn.display : text.slice(0, 150);
    return name ? `${name}: ${body}` : body;
  }
  return null;
}

// 셀 값 → 판정용 원자 문자열들. 구조값(배열·객체)은 안의 원시값까지 편다.
//   각 원자는 **SQL 이 보는 JSON 표기 그대로**(이스케이프 포함) — 아래 판정이 SQL 후보 조건보다 넓어지지 않게.
const cellAtoms = (raw, out = []) => {
  if (raw == null) return out;
  if (Array.isArray(raw)) { for (const x of raw) cellAtoms(x, out); return out; }
  if (typeof raw === 'object') { for (const x of Object.values(raw)) cellAtoms(x, out); return out; }
  out.push(JSON.stringify(String(raw)).slice(1, -1));
  return out;
};

// ★ 표 셀·Q info 항목 값 검색의 **단일 판정** (#334 → 2026-09-11 표 분기까지).
//   SQL 은 values JSON 을 통째로 LIKE 해 **후보만** 좁힌다 — 거기엔 비밀 칸 값과 칸 id(JSON 키)가 섞여 있다.
//   결과에 올리는 것은 **비밀이 아닌 칸** 하나라도 SQL 과 같은 규칙(부분일치 / 공백 제거 부분일치)으로 맞을 때뿐이다.
//   판정 규칙을 SQL 보다 넓히지 않는다 — 넓히면 비밀 칸이 후보로 끌어온 행이 비밀 아닌 칸의 느슨한 규칙으로
//   통과해, "결과가 뜨는가" 가 다시 비밀 값에 좌우된다.
//   호출부는 SQL 에 두 조건(`LIKE :like` · `REPLACE(…,' ','') LIKE :likeSq`)을 **둘 다** 건다.
function matchesNonSecretCell(columns, values, q) {
  const cols = Array.isArray(columns) ? columns : [];
  const vals = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  const secretIds = new Set(cols.filter((c) => c && c.type === 'secret').map((c) => String(c.id)));
  const needle = q.toLowerCase();
  const needleSquashed = q.replace(/\s+/g, '').toLowerCase();
  for (const [colId, raw] of Object.entries(vals)) {
    if (secretIds.has(String(colId))) continue;
    for (const atom of cellAtoms(raw)) {
      const v = atom.toLowerCase();
      if (!v) continue;
      if (needle && v.includes(needle)) return true;
      if (needleSquashed && v.replace(/ /g, '').includes(needleSquashed)) return true;
    }
  }
  return false;
}

module.exports = { asObj, cellText, columnValueSnippet, cellAtoms, matchesNonSecretCell };
