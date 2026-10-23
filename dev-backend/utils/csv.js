// utils/csv.js — CSV 칸 한 벌 (2026-10-23, docs/TRUST_SERVICES_DESIGN.md D6③).
//
// ★ 엑셀은 `= + - @` (그리고 탭·CR)로 시작하는 칸을 **수식으로 실행**한다(CSV 수식 주입).
//   사람이 입력한 이름·제목이 그대로 칸이 되는 곳(급여 대장·Q info·워크스페이스 백업)은
//   이 함수만 쓴다. 손으로 따옴표만 붙이면 수식 가드가 빠진다 — 가드 `--category=csv`.
//   숫자(음수 포함)는 그대로 둔다 — `'-5000` 이 되면 금액이 글자가 된다.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvLine(cells) {
  return cells.map(csvCell).join(',');
}

// 엑셀이 UTF-8 로 읽게 BOM 을 붙인다.
const CSV_BOM = '﻿';

module.exports = { csvCell, csvLine, CSV_BOM };
