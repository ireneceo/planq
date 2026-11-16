// chartSvg.js 의 타입 — 화면(dev-frontend, TypeScript)이 이 파일을 빌드 때 가져오므로 옆에 둔다(2026-11-16, docs/DOC_CHART_BLOCK_DESIGN.md).
export type ChartKind = 'bar' | 'line' | 'area' | 'pie';
export interface ChartSeries { name: string; values: (number | null)[] }
export interface ChartData { v: number; kind: ChartKind; title: string; labels: string[]; series: ChartSeries[]; unit: string }
declare const api: {
  normalizeChart(raw: unknown): ChartData;
  chartSvg(raw: unknown): string;
  chartSummary(raw: unknown): string;
  chartText(raw: unknown): string;
  chartStubHtml(raw: unknown): string;
  chartDataUri(raw: unknown): string;
  chartHtml(raw: unknown): string;
  KINDS: ChartKind[];
  LIMIT: { labels: number; series: number; title: number; name: number; unit: number };
  PALETTE: string[];
};
export default api;
