// AI 가 «표로» 달라는 요청에 돌려준 평문 표(«칸 | 칸» 한 줄 = 한 행)를 진짜 표로 — 화면·복사·문서 저장이 같은 판정 한 벌을 쓴다.
//   (2026-11-23 Irene «표를 달라고 하면 실제 표(칸·줄)로 그려지게, 문서로 저장했을 때도 표로»)
//
// 판정: «|» 로 나눈 칸이 2개 이상인 줄이 **2줄 이상 이어지면** 표다 — 첫 줄 = 머리줄.
//   한 줄짜리 «A | B» 문장은 표로 바꾸지 않는다(문장 속 세로줄 오판 방지).
//   줄 앞 목록 표시(«- »·«* »·«• »·«1. »)는 표 행에서 떼고, Markdown 구분 줄(|---|:---:|)은 건너뛴다.
//   칸이 모자란 행은 빈 칸으로 채우고, 넘치는 칸은 마지막 칸에 « | » 로 붙인다(머리줄 칸 수 기준).
// 판정을 바꾸면 화면(NoteAiRequest)·복사·문서(qnoteSummaryDoc)가 같이 바뀐다 — 각자 다시 쓰지 않는다.

export type PipeBlock =
  | { kind: 'text'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] };

const BULLET = /^\s*(?:[-*•]\s+|\d{1,2}[.)]\s+)/;
const DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cellsOf(line: string): string[] | null {
  if (!line.includes('|')) return null;
  let s = line.replace(BULLET, '').trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = s.split('|').map((c) => c.trim());
  if (cells.length < 2 || cells.every((c) => !c)) return null;
  return cells;
}

function fit(cells: string[], n: number): string[] {
  if (cells.length === n) return cells;
  if (cells.length < n) return [...cells, ...Array(n - cells.length).fill('')];
  return [...cells.slice(0, n - 1), cells.slice(n - 1).join(' | ')];
}

export function parsePipeBlocks(text: string): PipeBlock[] {
  const lines = (text || '').split('\n');
  const out: PipeBlock[] = [];
  let buf: string[] = [];
  const flushText = () => {
    if (buf.length) out.push({ kind: 'text', text: buf.join('\n') });
    buf = [];
  };
  let i = 0;
  while (i < lines.length) {
    // 표 후보 — 칸 줄(구분 줄 포함)이 이어지는 구간
    let j = i;
    const rows: string[][] = [];
    while (j < lines.length) {
      if (DIVIDER.test(lines[j]) && lines[j].includes('-')) { j += 1; continue; }
      const c = cellsOf(lines[j]);
      if (!c) break;
      rows.push(c);
      j += 1;
    }
    if (rows.length >= 2) {
      flushText();
      const n = rows[0].length;
      out.push({ kind: 'table', header: rows[0], rows: rows.slice(1).map((r) => fit(r, n)) });
      i = j;
      continue;
    }
    buf.push(lines[i]);
    i += 1;
  }
  flushText();
  // 표 사이 빈 줄만 남은 글 조각은 버린다(빈 문단이 표 사이에 끼지 않게)
  return out.filter((b) => b.kind === 'table' || b.text.trim() !== '');
}

export function hasPipeTable(text: string): boolean {
  return parsePipeBlocks(text).some((b) => b.kind === 'table');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 복사용 HTML — 메일·문서 편집기에 붙이면 표로 들어간다. */
export function pipeBlocksToHtml(blocks: PipeBlock[]): string {
  const cellStyle = 'border:1px solid #CBD5E1;padding:6px 10px;text-align:left;vertical-align:top;';
  return blocks.map((b) => {
    if (b.kind === 'text') {
      return b.text.split('\n').map((l) => `<p>${l.trim() ? esc(l) : '<br>'}</p>`).join('');
    }
    const head = `<tr>${b.header.map((c) => `<th style="${cellStyle}background:#F1F5F9;">${esc(c)}</th>`).join('')}</tr>`;
    const body = b.rows.map((r) => `<tr>${r.map((c) => `<td style="${cellStyle}">${esc(c)}</td>`).join('')}</tr>`).join('');
    return `<table style="border-collapse:collapse;margin:8px 0;"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }).join('');
}
