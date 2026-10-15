// 세무사 급여대장 가져오기 — 읽기 · 매칭 · 회차에 싣기 (docs/PAYROLL_DESIGN.md §7.2~§7.4)
//
//   엑셀·CSV = 기계가 읽는다(자체 파서 officeText.extractXlsxRows — 결정적·비용 0·개인정보 외부 전송 0).
//   PDF      = 본문을 뽑아 **주민번호·계좌번호 모양을 가린 뒤** AI 가 표로 옮긴다(이 파일의 maskSensitive 한 벌).
//   매칭     = 결정적 규칙 — 사람: 사번 → 이름(동명이인이면 미정) → 사람이 고른다 / 항목: 머리글 ↔ 이름·영문명·별칭.
//   ★ AI 는 «표로 옮기기» 까지다. 금액을 고치거나 채택하거나 확정하는 AI 경로는 없다.
//   ★ 저장하는 추출 결과(statement_extract_json)에도 주민번호·계좌 열은 남기지 않는다 — 그 열은 읽는 순간 버린다.
const { PayItem, PayrollRun, PayrollEntry, PayrollEntryLine, PayrollPerson } = require('../models');
const { sequelize } = require('../config/database');

// ── 가리기 — LLM 으로 보내기 전 · 저장하기 전 같은 함수 ─────────────────────────
const RRN_RE = /\b\d{6}\s?-\s?[1-8*]\d{6}\b|\b\d{6}\s?-\s?[1-8]\*{6}\b/g;        // 주민(외국인)등록번호
const ACCOUNT_RE = /\b\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,6})?\b|\b\d{10,16}\b/g;    // 계좌번호 모양(대시 묶음 · 10~16자리 연속)
function maskSensitive(text) {
  return String(text ?? '').replace(RRN_RE, '***').replace(ACCOUNT_RE, '***');
}

// ── 머리글 정규화·역할 ─────────────────────────────────────────────
const norm = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, '').replace(/[()（）\[\]·.]/g, '').toLowerCase();
const normItem = (s) => norm(s).replace(/료$/, '');
const ROLE_PATTERNS = [
  ['name', /^(성명|이름|사원명|직원명|성 ?명|name|employee(name)?)$/],
  ['emp_no', /^(사번|사원번호|직원번호|사원코드|empno|employeeno|employeeid|id)$/],
  ['gross', /^(지급합계|지급액계|총지급액|지급총액|지급계|급여총액|grosspay|totalearnings|gross)$/],
  ['deduction', /^(공제합계|공제액계|공제총액|공제계|totaldeductions|deductions)$/],
  ['net', /^(차인지급액|실지급액|실수령액|차감지급액|netpay|net)$/],
  ['department', /^(부서|부서명|소속|department)$/],
  ['job_title', /^(직위|직급|직책|직위명|jobtitle|title|position)$/],
  ['hired_on', /^(입사일|입사일자|hiredate|hiredon)$/],
  // 버리는 열 — 값을 읽지도 저장하지도 않는다
  ['secret', /(주민|등록번호|외국인번호|계좌|account|bank|은행)/],
  ['ignore', /^(no|번호|순번|연번|비고|메모|note|remark|지급일|귀속월|근무일수|근무시간)$/],
];
function roleOf(header) {
  const n = norm(header);
  if (!n) return 'ignore';
  for (const [role, re] of ROLE_PATTERNS) if (re.test(n)) return role;
  return 'item';
}
const TOTAL_ROW = /^(합계|계|총계|소계|총합계|total|subtotal|sum)$/;

function parseAmount(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s) return null;
  if (/^[-–—]$/.test(s)) return 0;                // 대장의 «-» 는 0
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[,\s원₩$€¥]/g, '').replace(/KRW|USD|EUR|JPY/gi, '');
  if (s.startsWith('△') || s.startsWith('▲')) { neg = true; s = s.slice(1); }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;   // 숫자가 아니다
  const n = Number(s);
  return neg ? -n : n;
}

// ── 표 → 행 ───────────────────────────────────────────────────────
/**
 * 격자(문자열 2차원)에서 대장을 읽는다. 머리행 = «성명/기본급/차인지급액…» 중 역할 있는 칸이 둘 이상인 첫 행.
 *   두 줄 머리(지급 줄 + 공제 줄, 사람도 두 줄씩)면 바로 아래 행도 머리로 보고 데이터를 두 줄씩 묶는다.
 */
function parseGrid(grid) {
  const isHeader = (row) => {
    const roles = row.map(roleOf);
    const named = roles.filter((r, i) => row[i] && r !== 'item' && r !== 'ignore').length;
    const items = roles.filter((r, i) => row[i] && r === 'item' && parseAmount(row[i]) === undefined).length;
    return { ok: named >= 1 && named + items >= 3 && row.some((c) => roleOf(c) === 'name' || roleOf(c) === 'net'), items };
  };
  let h = -1;
  for (let i = 0; i < Math.min(grid.length, 30); i++) if (isHeader(grid[i]).ok) { h = i; break; }
  if (h < 0) return { ok: false, code: 'header_not_found' };
  const headerRows = [grid[h]];
  const below = grid[h + 1] || [];
  // 둘째 머리줄: 이름 칸이 비어 있고 숫자가 아닌 글자가 셋 이상
  const nameCol = grid[h].findIndex((c) => roleOf(c) === 'name');
  if (below.length && !(nameCol >= 0 && below[nameCol]) && below.filter((c) => c && parseAmount(c) === undefined).length >= 3) headerRows.push(below);
  const step = headerRows.length;
  const columns = [];   // { key, header, role, line(0|1), col }
  headerRows.forEach((hr, line) => hr.forEach((c, col) => {
    if (!c) return;
    const role = roleOf(c);
    if (role === 'ignore') return;
    columns.push({ key: `${line}:${col}`, header: String(c).trim().slice(0, 60), role, line, col });
  }));
  const rows = [];
  const warnings = [];
  for (let i = h + step; i < grid.length; i += step) {
    const lines = [];
    for (let k = 0; k < step; k++) lines.push(grid[i + k] || []);
    const get = (c) => (lines[c.line] || [])[c.col] ?? '';
    const nameC = columns.find((c) => c.role === 'name');
    const name = nameC ? String(get(nameC)).trim() : '';
    const empC = columns.find((c) => c.role === 'emp_no');
    const empNo = empC ? String(get(empC)).trim() : '';
    if (!name && !empNo) continue;
    if (TOTAL_ROW.test(norm(name))) continue;   // 합계행은 사람이 아니다
    const cells = {}, totals = {}, meta = {};
    for (const c of columns) {
      const v = get(c);
      if (c.role === 'item') { const n = parseAmount(v); if (n !== undefined && n !== null) cells[c.key] = n; else if (n === undefined && v) warnings.push({ row: rows.length, header: c.header, code: 'not_a_number' }); }
      else if (['gross', 'deduction', 'net'].includes(c.role)) { const n = parseAmount(v); if (n !== undefined && n !== null) totals[c.role] = n; }
      else if (['department', 'job_title', 'hired_on'].includes(c.role) && v) meta[c.role] = maskSensitive(String(v).slice(0, 100));
    }
    rows.push({ idx: rows.length, name: maskSensitive(name).slice(0, 100), employee_no: empNo ? maskSensitive(empNo).slice(0, 30) : null, cells, totals, meta });
  }
  // 버리는 열(주민번호·계좌)은 머리글 이름만 남기지 않는다 — 열이 있었다는 사실만
  const secretCols = columns.filter((c) => c.role === 'secret').length;
  return {
    ok: true,
    columns: columns.filter((c) => c.role !== 'secret').map(({ key, header, role }) => ({ key, header, role })),
    rows, warnings: warnings.slice(0, 50), dropped_secret_columns: secretCols,
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur.trim()); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cur.trim()); cur = '';
      if (row.some((c) => c)) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur.trim());
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

/** PDF → (가린) 본문 → AI 가 표로. 결과는 parseGrid 와 같은 모양으로 맞춘다. */
async function parsePdf(buf) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buf });
  let text = '';
  try { text = String((await parser.getText())?.text || ''); } finally { if (typeof parser.destroy === 'function') await parser.destroy().catch(() => null); }
  if (!text.trim()) return { ok: false, code: 'pdf_no_text' };
  const masked = maskSensitive(text).slice(0, 30_000);
  const { callLLM } = require('./llm');
  const r = await callLLM({
    purpose: 'payroll_extract', json: true, fallback: '',
    messages: [
      { role: 'system', content: 'You convert a payroll register (급여대장) text into JSON. Output {"headers":["column header as written"],"rows":[{"name":"","employee_no":"","cells":{"<header>":number}}]} only. Use the exact column headers from the document. Numbers without thousands separators; parentheses or △ mean negative; "-" means 0. Skip total rows (합계/계). Never output resident registration numbers or bank accounts; masked values (***) must be omitted.' },
      { role: 'user', content: masked },
    ],
  });
  const llm = { model: r.model, input_tokens: r.input_tokens || 0, output_tokens: r.output_tokens || 0 };
  if (r.fallback || !r.content) return { ok: false, code: 'ai_unavailable' };
  let j;
  try { j = JSON.parse(r.content); } catch { return { ok: false, code: 'ai_bad_output', llm }; }
  const headers = [...new Set((Array.isArray(j.headers) ? j.headers : []).map((x) => String(x).trim().slice(0, 60)).filter(Boolean))];
  // 격자로 다시 세워 기계 경로와 같은 규칙(역할·합계행·숫자)을 탄다
  const grid = [headers.length ? headers : ['성명']];
  for (const row of Array.isArray(j.rows) ? j.rows : []) {
    const cells = row?.cells && typeof row.cells === 'object' ? row.cells : {};
    const line = grid[0].map((hd) => {
      const r0 = roleOf(hd);
      if (r0 === 'name') return String(row.name || '');
      if (r0 === 'emp_no') return String(row.employee_no || '');
      const v = cells[hd];
      return v === null || v === undefined ? '' : String(v);
    });
    if (!grid[0].some((hd) => roleOf(hd) === 'name')) { grid[0].unshift('성명'); line.unshift(String(row.name || '')); }
    grid.push(line);
  }
  return { ...parseGrid(grid), llm };
}

/** 파일 → 추출. kind: xlsx | csv | pdf */
async function parseStatement(buf, kind) {
  if (kind === 'xlsx') {
    const sheets = require('./officeText').extractXlsxRows(buf);
    for (const sh of sheets) {
      const p = parseGrid(sh.rows);
      if (p.ok && p.rows.length) return { ...p, sheet: sh.name };
    }
    return { ok: false, code: sheets.length ? 'header_not_found' : 'unreadable_file' };
  }
  if (kind === 'csv') {
    let text = buf.toString('utf-8');
    if (text.includes('�')) {
      // 한국 엑셀이 내보낸 CSV 는 대개 CP949 — 깨지면 그쪽으로 다시 읽는다
      try { text = new TextDecoder('euc-kr').decode(buf); } catch { /* utf-8 그대로 */ }
    }
    return parseGrid(parseCsv(text));
  }
  if (kind === 'pdf') return parsePdf(buf);
  return { ok: false, code: 'unsupported_file' };
}

function kindOf(fileName, mime) {
  const ext = String(fileName || '').toLowerCase().split('.').pop();
  if (ext === 'xlsx' || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (ext === 'csv' || mime === 'text/csv') return 'csv';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  return null;
}

// ── 매칭 ──────────────────────────────────────────────────────────
function matchItems(columns, items, prevMap = {}) {
  const idx = new Map();
  for (const it of items) {
    for (const a of [it.name, it.name_en, ...(Array.isArray(it.aliases) ? it.aliases : [])]) {
      const k = normItem(a);
      if (k && !idx.has(k)) idx.set(k, it.id);
    }
  }
  // 같은 머리글이 여러 항목에 맞을 수 있다(«소득세» = 직원 소득세 · 프리랜서 사업소득세) — 후보를 다 두고,
  //   사람마다 그 사람에게 붙는 항목(applies_to)을 고른다(applyToRun). 사람이 고른 열은 그 항목 하나로 고정.
  const cands = new Map();
  for (const it of items) {
    if (!it.is_active && it.code !== 'base') continue;
    for (const a of [it.name, it.name_en, ...(Array.isArray(it.aliases) ? it.aliases : [])]) {
      const k = normItem(a);
      if (!k) continue;
      const list = cands.get(k) || [];
      if (!list.includes(it.id)) list.push(it.id);
      cands.set(k, list);
    }
  }
  return columns.map((c) => {
    if (c.role !== 'item') return { ...c, item_id: null, candidates: [] };
    if (Object.prototype.hasOwnProperty.call(prevMap, c.key)) return { ...c, item_id: prevMap[c.key], candidates: prevMap[c.key] ? [prevMap[c.key]] : [], decided: true };
    const list = cands.get(normItem(c.header)) || [];
    return { ...c, item_id: list[0] || idx.get(normItem(c.header)) || null, candidates: list };
  });
}

function matchPeople(rows, people, prevMap = {}) {
  const byEmp = new Map(), byName = new Map();
  for (const p of people) {
    if (p.employee_no) byEmp.set(norm(p.employee_no), p.id);
    const k = norm(p.display_name);
    byName.set(k, byName.has(k) ? 'ambiguous' : p.id);
  }
  return rows.map((r) => {
    if (Object.prototype.hasOwnProperty.call(prevMap, r.idx)) {
      const v = prevMap[r.idx];
      return { ...r, person_id: v === 'skip' ? null : v, match: v === 'skip' ? 'skipped' : 'manual' };
    }
    if (r.employee_no && byEmp.has(norm(r.employee_no))) return { ...r, person_id: byEmp.get(norm(r.employee_no)), match: 'emp_no' };
    const n = byName.get(norm(r.name));
    if (n === 'ambiguous') return { ...r, person_id: null, match: 'ambiguous' };
    if (n) return { ...r, person_id: n, match: 'name' };
    return { ...r, person_id: null, match: null };
  });
}

/**
 * 추출 결과를 회차에 싣는다 — statement_amount 를 전부 다시 쓴다(다시 올리면 덮어쓴다). 트랜잭션 안.
 *   매칭된 사람이 회차에 없으면(계약 없이 대장에만 있는 사람) 사람줄을 만든다(계약 없음).
 *   대장의 합계 열이 있으면 다시 더한 값과 대조해 그 사람에게 경고를 단다.
 */
async function applyToRun(run, extract, t) {
  const calc = require('./payrollCalc');
  const { entryContext, recomputeEntry, recalcRunTotals } = require('./payrollTransition');
  const items = (await PayItem.findAll({ where: { business_id: run.business_id }, transaction: t })).map((r) => r.toJSON());
  const itemById = new Map(items.map((it) => [it.id, it]));
  const itemCols = extract.columns.filter((c) => c.role === 'item' && c.item_id);
  const people = new Map((await PayrollPerson.findAll({ where: { business_id: run.business_id }, attributes: ['id', 'income_kind'], transaction: t })).map((p) => [p.id, p]));
  /** 이 사람에게 이 열은 어느 항목인가 — 후보 중 그 사람에게 붙는 항목(전체 또는 같은 소득 종류) 우선 */
  const itemFor = (col, personId) => {
    const kind = people.get(personId)?.income_kind;
    const list = (col.candidates && col.candidates.length ? col.candidates : [col.item_id]).filter((id) => itemById.has(id));
    return list.find((id) => { const a = itemById.get(id).applies_to; return a === kind; })
      || list.find((id) => itemById.get(id).applies_to === 'all')
      || list[0] || null;
  };
  // 지난번 대장 값 지우기
  const entries = await PayrollEntry.findAll({ where: { run_id: run.id }, transaction: t });
  for (const e of entries) {
    await PayrollEntryLine.update({ statement_amount: null }, { where: { entry_id: e.id }, transaction: t });
    // 대장 값을 채택해 둔 칸은 출처를 잃으므로 초안으로 돌린다(새 대장 값은 사람이 다시 채택한다)
    await PayrollEntryLine.update({ final_source: null, final_amount: null }, { where: { entry_id: e.id, final_source: 'statement' }, transaction: t });
    await e.update({ statement_matched: false, statement_warnings: null }, { transaction: t });
  }
  const byPerson = new Map(entries.map((e) => [e.person_id, e]));
  for (const row of extract.rows) {
    if (!row.person_id) continue;
    let e = byPerson.get(row.person_id);
    if (!e) {
      const p = await PayrollPerson.findOne({ where: { id: row.person_id, business_id: run.business_id }, transaction: t });
      if (!p) continue;
      e = await PayrollEntry.create({ business_id: run.business_id, run_id: run.id, person_id: p.id, contract_id: null, display_name: p.display_name, employee_no: p.employee_no, job_title: p.job_title, currency: 'KRW' }, { transaction: t });
      byPerson.set(p.id, e);
    }
    const stmtByItem = {};
    for (const [key, v] of Object.entries(row.cells || {})) {
      const col = itemCols.find((c) => c.key === key);
      const itemId = col ? itemFor(col, row.person_id) : null;
      if (!itemId || !itemById.has(itemId)) continue;
      // 그 사람에게 붙지 않는 항목(프리랜서 줄의 «국민연금 -»)의 0 은 줄을 만들지 않는다 — 0 이 아니면 대장이 말한 것이니 싣는다
      const ap = itemById.get(itemId).applies_to;
      if (Number(v) === 0 && ap && ap !== 'all' && ap !== people.get(row.person_id)?.income_kind) continue;
      stmtByItem[itemId] = (stmtByItem[itemId] || 0) + Number(v);   // 같은 항목에 두 열이 맞으면 더한다(지급 줄 + 공제 줄 대장)
    }
    for (const [itemId, v] of Object.entries(stmtByItem)) {
      const [l] = await PayrollEntryLine.findOrCreate({ where: { entry_id: e.id, pay_item_id: Number(itemId) }, defaults: { business_id: run.business_id, entry_id: e.id, pay_item_id: Number(itemId) }, transaction: t });
      await l.update({ statement_amount: Math.round(v * 100) / 100 }, { transaction: t });
    }
    // 합계 대조 — 대장 값만으로 다시 더한 합 vs 대장의 합계 열
    const stmtItems = Object.keys(stmtByItem).map((id) => itemById.get(Number(id)));
    const tot = calc.totals(stmtItems, stmtByItem);
    const w = [];
    const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.5;
    if (row.totals.gross !== undefined && tot.gross_total !== null && !close(row.totals.gross, tot.gross_total)) w.push({ code: 'gross_mismatch', statement: row.totals.gross, recomputed: tot.gross_total });
    if (row.totals.deduction !== undefined && tot.deduction_total !== null && !close(row.totals.deduction, tot.deduction_total)) w.push({ code: 'deduction_mismatch', statement: row.totals.deduction, recomputed: tot.deduction_total });
    if (row.totals.net !== undefined && tot.net_total !== null && !close(row.totals.net, tot.net_total)) w.push({ code: 'net_mismatch', statement: row.totals.net, recomputed: tot.net_total });
    await e.update({ statement_matched: true, statement_warnings: w.length ? w : null }, { transaction: t });
  }
  for (const e of byPerson.values()) {
    const ctx = await entryContext(e, run.business_id, t);
    // 대장에서 새로 붙은 항목 줄도 그 사람의 대상에 넣는다
    const lineItems = (await PayrollEntryLine.findAll({ where: { entry_id: e.id }, attributes: ['pay_item_id'], transaction: t })).map((l) => itemById.get(l.pay_item_id)).filter(Boolean);
    const merged = [...new Map([...ctx.items, ...lineItems].map((it) => [it.id, it])).values()].sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
    await recomputeEntry(e, { items: merged, contract: ctx.contract, t });
  }
  await recalcRunTotals(run, t);
}

/** 화면용 요약 — 미매칭 사람·열 · 경고. 셀 값은 회차 줄에 있으므로 여기선 싣지 않는다. */
function summarize(extract) {
  if (!extract) return null;
  return {
    source: extract.source, file_name: extract.file_name, sheet: extract.sheet || null, imported_at: extract.imported_at,
    dropped_secret_columns: extract.dropped_secret_columns || 0,
    columns: extract.columns.map((c) => ({ key: c.key, header: c.header, role: c.role, item_id: c.item_id ?? null, decided: !!c.decided })),
    rows: extract.rows.map((r) => ({ idx: r.idx, name: r.name, employee_no: r.employee_no, person_id: r.person_id ?? null, match: r.match ?? null, meta: r.meta || {} })),
    warnings: extract.warnings || [],
  };
}

/** 사람·열 결정(사람이 고른 것)을 반영해 다시 매칭하고 회차에 다시 싣는다. */
async function rematch(run, extract, t) {
  const items = (await PayItem.findAll({ where: { business_id: run.business_id }, transaction: t })).map((r) => r.toJSON());
  const people = (await PayrollPerson.findAll({ where: { business_id: run.business_id }, attributes: ['id', 'display_name', 'employee_no'], transaction: t })).map((r) => r.toJSON());
  extract.columns = matchItems(extract.columns, items, extract.column_map || {});
  extract.rows = matchPeople(extract.rows, people, extract.row_map || {});
  await applyToRun(run, extract, t);
  return extract;
}

module.exports = { maskSensitive, roleOf, parseAmount, parseGrid, parseCsv, parseStatement, kindOf, matchItems, matchPeople, applyToRun, summarize, rematch };
