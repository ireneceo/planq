// 문서 차트 블록 — 화면 쪽 입구 (2026-11-16, docs/DOC_CHART_BLOCK_DESIGN.md)
//
// ★ 그림 함수는 서버와 **같은 파일 하나**(dev-backend/utils/chartSvg.js)다. 여기서 다시 쓰지 않는다 —
//   두 벌이면 편집기·보기 화면과 PDF·서명본이 다른 그림이 된다. 타입은 옆의 chartSvg.d.ts.
//   ★ 이 파일만 바뀐 배포에서도 화면이 다시 빌드되는지는 scripts/deploy-planq.sh 가 정한다(설계 문서 4절).
import chartApi from '../../../../dev-backend/utils/chartSvg.js';
import type { ChartData, ChartKind, ChartSeries } from '../../../../dev-backend/utils/chartSvg.js';

export type { ChartData, ChartKind, ChartSeries };

export const normalizeChart = chartApi.normalizeChart;
export const chartDataUri = chartApi.chartDataUri;
export const chartSummary = chartApi.chartSummary;
export const chartStubHtml = chartApi.chartStubHtml;
export const CHART_KINDS = chartApi.KINDS;
export const CHART_LIMIT = chartApi.LIMIT;

const isNum = (s: string) => /^[-+]?[\d,]*\.?\d+%?$/.test(s.replace(/\s/g, '')) && /\d/.test(s);

/** 2차원 글자 표(엑셀 붙여넣기·문서 표) → 차트 데이터.
 *  첫 줄의 둘째 칸부터가 숫자가 아니면 머리줄(계열 이름), 첫 칸 = 항목 이름. 숫자가 아닌 값은 빈 칸(null). */
export function chartFromMatrix(matrix: string[][], base?: Partial<ChartData>): ChartData {
  const rows = matrix.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean));
  if (!rows.length) return normalizeChart({ ...base, labels: [], series: [] });
  const width = Math.max(...rows.map((r) => r.length));
  const head = rows[0];
  const hasHeader = head.slice(1).some((c) => c && !isNum(c)) || (width === 1 && !isNum(head[0] || ''));
  const body = hasHeader ? rows.slice(1) : rows;
  // 첫 칸이 숫자 하나뿐인 줄(항목 이름 없음)이면 이름 없이 값만
  const labelCol = width > 1;
  const names = hasHeader ? head.slice(labelCol ? 1 : 0) : [];
  const nSeries = Math.max(1, width - (labelCol ? 1 : 0));
  const series: ChartSeries[] = Array.from({ length: nSeries }, (_, k) => ({
    name: names[k] || '',
    values: body.map((r) => {
      const raw = r[k + (labelCol ? 1 : 0)] || '';
      return isNum(raw) ? Number(raw.replace(/[,\s%]/g, '')) : null;
    }),
  }));
  return normalizeChart({ ...base, labels: body.map((r, i) => (labelCol ? r[0] : String(i + 1))), series });
}

/** 탭·줄바꿈으로 나뉜 붙여넣기 글(엑셀·구글 시트) → 2차원 배열. 칸이 하나뿐이면 null(보통 붙여넣기). */
export function parseTsv(text: string): string[][] | null {
  const t = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!/[\t\n]/.test(t)) return null;
  return t.split('\n').map((line) => line.split('\t'));
}

export function emptyChart(): ChartData {
  return normalizeChart({ kind: 'bar', title: '', labels: ['', '', ''], series: [{ name: '', values: [null, null, null] }] });
}
