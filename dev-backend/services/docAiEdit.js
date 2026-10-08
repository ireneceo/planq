// 문서 AI 수정 — 글 칸(텍스트 블록) 뽑기 · 전후 비교 · 최소 변경 적용. 설계 docs/DOC_AI_EDIT_DESIGN.md
//
// 왜 «문서를 다시 쓰게» 하지 않는가:
//   모델에게 HTML 전체를 돌려받으면(#312 고쳐 쓰기 방식) 안 건드려야 할 곳 — 서명 칸 노드·이미지 file_id·
//   글자 서식·표 칸 폭 — 이 왕복에서 바뀌거나 빠질 수 있고, 사람은 그것을 전후 비교로도 다 못 잡는다.
//   그래서 본문을 번호 붙은 글 칸 목록으로 뽑아 주고 «몇 번 칸을 이렇게» 만 받는다.
//   안 고른 칸은 JSON 노드가 그대로다 — 보존을 프롬프트가 아니라 **구조**가 보장한다.
//
// 이 파일은 순수 함수만 둔다(DB·LLM 없음) — 제안과 반영이 **같은 함수**로 칸을 뽑아야 id 가 어긋나지 않는다.

/** 인라인 노드 중 글자가 아닌 것(이미지·멘션·서명 칸 등) 자리표시. 모델이 이 글자를 지우거나 옮기면 그 제안은 버린다. */
const PLACEHOLDER = '￼';

const TEXTBLOCK = new Set(['paragraph', 'heading', 'codeBlock']);

function parseDoc(contentJson) {
  if (!contentJson) return null;
  try {
    const obj = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson;
    // 옛 문서 일부는 content_json 에 HTML 문자열이 JSON 문자열로 들어 있다 — 노드 구조가 없어 칸으로 못 뽑는다.
    if (!obj || typeof obj !== 'object' || obj.type !== 'doc') return null;
    return obj;
  } catch { return null; }
}

/** 인라인 자식들을 한 줄 글로. 글자 아닌 노드(줄바꿈 hardBreak 포함)는 모두 자리표시 한 글자 —
 *  줄바꿈을 '\n' 으로 펴면 되돌릴 때 글자 '\n' 이 텍스트 노드에 들어간다(Fable 2026-10-08). */
function inlineText(content) {
  let s = '';
  for (const n of content || []) {
    if (n.type === 'text') s += n.text || '';
    else s += PLACEHOLDER;
  }
  return s;
}

function plainOf(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  return (node.content || []).map(plainOf).join(TEXTBLOCK.has(node.type) ? '' : ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 글 칸 목록. id 는 문서 순서 번호(1부터) — 같은 본문이면 언제나 같은 id 다.
 * loc 은 사람이 읽는 위치를 화면이 i18n 으로 조립하도록 구조로 준다.
 * @returns {{ id:number, path:number[], type:string, text:string, loc:object }[]}
 */
function extractBlocks(doc) {
  const blocks = [];
  let tableNo = 0;
  let section = null;     // 가장 최근 제목 — «어느 절의 문단인가» (표·목록 칸에도 붙인다)
  const walk = (node, path, ctx) => {
    if (!node || typeof node !== 'object') return;
    if (TEXTBLOCK.has(node.type)) {
      const text = inlineText(node.content);
      const loc = { kind: ctx.cell ? 'table' : ctx.list ? 'list' : node.type === 'heading' ? 'heading' : 'paragraph' };
      if (node.type === 'heading') loc.level = node.attrs?.level || 1;
      if (section && node.type !== 'heading') loc.section = section;
      if (ctx.cell) Object.assign(loc, ctx.cell);
      if (text.trim()) blocks.push({ id: blocks.length + 1, path, type: node.type, text, loc });
      if (node.type === 'heading' && text.trim()) section = text.replace(PLACEHOLDER, '').trim().slice(0, 80);
      return;
    }
    if (node.type === 'table') {
      tableNo += 1;
      const rows = (node.content || []).filter((r) => r.type === 'tableRow');
      const headRow = rows[0];
      rows.forEach((row, ri) => {
        const cells = row.content || [];
        const rowHead = cells[0] ? plainOf(cells[0]).slice(0, 60) : '';
        cells.forEach((cell, ci) => {
          const colHead = headRow && headRow.content && headRow.content[ci] ? plainOf(headRow.content[ci]).slice(0, 60) : '';
          const cellCtx = {
            table: tableNo, row: ri + 1, col: ci + 1,
            ...(ci > 0 && rowHead ? { row_head: rowHead } : {}),
            ...(ri > 0 && colHead ? { col_head: colHead } : {}),
          };
          const rowIdx = node.content.indexOf(row);
          (cell.content || []).forEach((child, k) => walk(child, [...path, rowIdx, ci, k], { ...ctx, cell: cellCtx }));
        });
      });
      return;
    }
    const isList = node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList';
    (node.content || []).forEach((child, i) => walk(child, [...path, i], isList ? { ...ctx, list: true } : ctx));
  };
  (doc.content || []).forEach((child, i) => walk(child, [i], {}));
  return blocks;
}

function nodeAt(doc, path) {
  let n = doc;
  for (const i of path) { n = n && n.content ? n.content[i] : null; }
  return n;
}

/** 모델에게 줄 위치 설명(프롬프트 전용 — 화면 문구가 아니다). */
function locLabel(loc) {
  const parts = [];
  if (loc.kind === 'table') {
    parts.push(`표${loc.table} ${loc.row}행 ${loc.col}열`);
    if (loc.row_head) parts.push(`행머리="${loc.row_head}"`);
    if (loc.col_head) parts.push(`열머리="${loc.col_head}"`);
  } else if (loc.kind === 'heading') parts.push(`제목(h${loc.level})`);
  else if (loc.kind === 'list') parts.push('목록 항목');
  else parts.push('문단');
  if (loc.section) parts.push(`절="${loc.section}"`);
  return parts.join(' · ');
}

// ── 단어 단위 비교 ────────────────────────────────────────────────────────────
// 숫자 덩어리 / 글자 덩어리 / 공백 덩어리 / 그 밖 한 글자씩. 숫자와 글자를 가르는 이유 —
//   «12링깃» 의 값만 바뀌면 «12→5» 로 보여야 한다(어절째 바뀐 것처럼 보이면 전후를 읽기 어렵다).
function tokenize(s) {
  return String(s).match(/\p{N}+|\p{L}+|\s+|[^\p{L}\p{N}\s]/gu) || [];
}

/** before→after 조각 [{t:'eq'|'del'|'ins', s}]. 길면 앞뒤 공통부만 떼고 가운데를 통째 교체로 본다. */
function diffSegments(before, after) {
  const a = tokenize(before), b = tokenize(after);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf), bm = b.slice(pre, b.length - suf);
  const mid = [];
  if (am.length * bm.length > 400000) {
    if (am.length) mid.push({ t: 'del', s: am.join('') });
    if (bm.length) mid.push({ t: 'ins', s: bm.join('') });
  } else {
    // LCS
    const n = am.length, m = bm.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = am[i] === bm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) { mid.push({ t: 'eq', s: am[i] }); i++; j++; }
      else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { mid.push({ t: 'ins', s: bm[j] }); j++; }
      else { mid.push({ t: 'del', s: am[i] }); i++; }
    }
  }
  const out = [];
  const push = (t, s) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last && last.t === t) last.s += s; else out.push({ t, s });
  };
  push('eq', a.slice(0, pre).join(''));
  // 삭제·추가가 번갈아 잘게 쪼개지면 읽기 어렵다 — eq 사이의 del/ins 를 «del 묶음 + ins 묶음» 으로 모은다.
  let dels = '', inss = '';
  const flush = () => { push('del', dels); push('ins', inss); dels = ''; inss = ''; };
  for (const seg of mid) {
    if (seg.t === 'eq') {
      // 공백 하나만 같은 것은 바뀐 덩어리 사이에 끼우지 않는다(«12링깃 → 5링깃» 이 조각나지 않게)
      //   소수점·쉼표 한 글자도 같다(«9.50 → 5.00» 이 «9→5 . 50→00» 으로 쪼개지지 않게).
      if ((/^\s+$/.test(seg.s) || /^[.,:/\-]$/.test(seg.s)) && (dels || inss)) { dels += seg.s; inss += seg.s; continue; }
      flush(); push('eq', seg.s);
    } else if (seg.t === 'del') dels += seg.s; else inss += seg.s;
  }
  flush();
  push('eq', a.slice(a.length - suf).join(''));
  return out;
}

function sameMarks(a, b) { return JSON.stringify(a || []) === JSON.stringify(b || []); }

/**
 * 한 칸의 글을 after 로 바꾼 새 인라인 content. 바뀌지 않은 글자는 원래 서식을 그대로 갖고,
 * 끼워 넣은 글자는 바로 앞 글자의 서식(맨 앞이면 바로 뒤 글자의 서식)을 따른다.
 * 글자 아닌 노드(자리표시)는 원본 노드를 그대로 옮긴다 — 지워지거나 새로 생기면 throw.
 */
function applyText(content, after) {
  const items = [];   // 원래 글자 단위: { ch, marks } | { node }
  for (const n of content || []) {
    if (n.type === 'text') for (const ch of Array.from(n.text || '')) items.push({ ch, marks: n.marks });
    else items.push({ ch: PLACEHOLDER, node: n });
  }
  const before = items.map((x) => x.ch).join('');
  const segs = diffSegments(before, after);
  const out = [];
  let k = 0;   // items 커서 — 코드포인트 단위
  let delMarks;   // 바로 앞에서 지운 글자의 서식 — 바꿔 넣은 글자는 그 서식을 잇는다(굵은 «12» → 굵은 «5»)
  const lastTextMarks = () => { for (let i = out.length - 1; i >= 0; i--) if (!out[i].node) return out[i].marks; return undefined; };
  const nextTextMarks = () => { for (let i = k; i < items.length; i++) if (!items[i].node) return items[i].marks; return undefined; };
  for (const seg of segs) {
    const chars = Array.from(seg.s);
    if (seg.t === 'eq') { delMarks = undefined; for (let c = 0; c < chars.length; c++) out.push(items[k++]); }
    else if (seg.t === 'del') {
      delMarks = undefined;
      for (let c = 0; c < chars.length; c++) {
        const it = items[k++];
        if (it.ch === PLACEHOLDER) throw new Error('placeholder_removed');
        if (delMarks === undefined && !it.node && !/\s/.test(it.ch)) delMarks = it.marks || null;
      }
    } else {
      const marks = delMarks !== undefined ? (delMarks || undefined) : out.length ? lastTextMarks() : nextTextMarks();
      delMarks = undefined;
      for (const ch of chars) {
        if (ch === PLACEHOLDER) throw new Error('placeholder_added');
        out.push({ ch: ch === '\n' ? ' ' : ch, marks });
      }
    }
  }
  // 다시 노드로 — 같은 서식의 이웃 글자는 한 text 노드로 합친다.
  const nodes = [];
  for (const it of out) {
    if (it.node) { nodes.push(it.node); continue; }
    const last = nodes[nodes.length - 1];
    if (last && last.type === 'text' && sameMarks(last.marks, it.marks)) last.text += it.ch;
    else nodes.push({ type: 'text', ...(it.marks && it.marks.length ? { marks: it.marks } : {}), text: it.ch });
  }
  return nodes;
}

function countChar(s, ch) { let n = 0; for (const c of s) if (c === ch) n++; return n; }

/**
 * 모델 제안을 걸러낸다 — 모르는 칸 · 바뀐 것 없음 · 자리표시 개수 변화 · 줄바꿈 추가는 버린다.
 * 빈 글(= 칸 지우기)은 v1 범위 밖이라 반쯤 들이지 않고 «못 한 것» 으로 돌린다(빈 문단이 남는 반기능 금지).
 * @returns {{ ok: {id,before,after,reason}[], dropped:number, emptied:number[] }}
 */
function vetEdits(blocks, edits) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const seen = new Set();
  const ok = [];
  const emptied = [];
  let dropped = 0;
  for (const e of Array.isArray(edits) ? edits : []) {
    const id = Number(e && e.id);
    const b = byId.get(id);
    const after = typeof (e && e.new_text) === 'string' ? e.new_text : null;
    if (!b || after == null || seen.has(id)) { dropped++; continue; }
    if (after === b.text) continue;
    if (!after.replace(PLACEHOLDER, '').trim()) { emptied.push(id); continue; }
    if (countChar(after, PLACEHOLDER) !== countChar(b.text, PLACEHOLDER) || /\n/.test(after)
        || after.length > b.text.length * 4 + 2000) { dropped++; continue; }
    seen.add(id);
    ok.push({ id, before: b.text, after, reason: String((e && e.reason) || '').slice(0, 200) });
  }
  return { ok, dropped, emptied };
}

/**
 * 고른 변경을 문서에 적용한 새 doc(원본은 건드리지 않는다).
 * @param changes [{id, before, after}] — before 가 지금 칸 글과 다르면 throw('stale_block')
 */
function applyChanges(doc, changes) {
  const next = JSON.parse(JSON.stringify(doc));
  const blocks = extractBlocks(next);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  let applied = 0;
  for (const c of changes) {
    const b = byId.get(Number(c.id));
    if (!b) throw new Error('stale_block');
    // 칸별 대조 — 문서 단위 updated_at 검사와 별개로 «같은 칸» 인지 글로 한 번 더 본다.
    if (typeof c.before !== 'string' || c.before !== b.text) throw new Error('stale_block');
    if (typeof c.after !== 'string' || c.after === b.text) continue;
    if (!c.after.replace(PLACEHOLDER, '').trim() || /\n/.test(c.after)) throw new Error('invalid_change');
    if (countChar(c.after, PLACEHOLDER) !== countChar(b.text, PLACEHOLDER)) throw new Error('placeholder_changed');
    const node = nodeAt(next, b.path);
    if (!node) throw new Error('stale_block');
    node.content = applyText(node.content, c.after);
    applied++;
  }
  return { doc: next, applied };
}

module.exports = { PLACEHOLDER, parseDoc, extractBlocks, locLabel, diffSegments, applyText, vetEdits, applyChanges };
