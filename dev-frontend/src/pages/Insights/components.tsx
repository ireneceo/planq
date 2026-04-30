// Insights 통계 탭들의 공통 styled 컴포넌트.
import styled from 'styled-components';

// 인사이트 박스 — 가로 풀폭 1col, 안에서 가로 inline (제목 · 값 · 힌트 · 액션)
// 좌우 여백 최소화 (Irene 피드백 2026-04-30)
export const InsightRow = styled.div`
  display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px;
`;

export const InsightCard = styled.div<{ $severity: string; $clickable?: boolean }>`
  display: flex; align-items: stretch;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px;
  overflow: hidden; min-height: 56px;
  ${(p) => p.$clickable && 'cursor: pointer; &:hover { border-color: #14B8A6; box-shadow: 0 2px 8px rgba(20,184,166,0.08); }'}
`;

export const InsightStripe = styled.div<{ $severity: string }>`
  width: 4px; flex-shrink: 0;
  background: ${(p) =>
    p.$severity === 'urgent' ? '#EF4444' :
    p.$severity === 'warning' ? '#F59E0B' :
    '#14B8A6'};
`;

export const InsightBody = styled.div`
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px;
  flex-wrap: wrap;
`;
export const InsightTitle = styled.div`
  font-size: 12px; font-weight: 700; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.3px;
  flex-shrink: 0;
`;
export const InsightValue = styled.div`
  font-size: 14px; font-weight: 700; color: #0F172A;
  flex-shrink: 0;
`;
export const InsightHint = styled.div`
  font-size: 12px; color: #64748B; line-height: 1.4;
  flex: 1; min-width: 0;
`;
export const InsightAction = styled.div`
  font-size: 12px; font-weight: 600; color: #0F766E;
  flex-shrink: 0; margin-left: auto;
`;

export const KpiGrid = styled.div<{ $cols?: number }>`
  display: grid; grid-template-columns: repeat(${(p) => p.$cols || 6}, 1fr); gap: 12px; margin-bottom: 28px;
  @media (max-width: 1024px) { grid-template-columns: repeat(2, 1fr); }
`;

export const KpiCard = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 16px; display: flex; flex-direction: column; gap: 4px;
`;

export const KpiLabel = styled.div`font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;`;
export const KpiValueBig = styled.div`font-size: 24px; font-weight: 700; color: #0F172A; line-height: 1.1;`;
export const KpiHint = styled.div`font-size: 11px; color: #94A3B8;`;

export const SectionLabel = styled.h2`
  font-size: 12px; font-weight: 700; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.4px; margin: 0 0 8px;
`;

export const ChartCard = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 16px; min-height: 200px;
`;

export const ChartEmpty = styled.div`
  display: flex; align-items: center; justify-content: center;
  min-height: 240px; color: #94A3B8; font-size: 13px; text-align: center; padding: 16px;
`;

export const TableWrap = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  overflow-x: auto;
`;

export const Table = styled.table`width: 100%; border-collapse: collapse; font-size: 13px;`;
export const Tr = styled.tr<{ $clickable?: boolean }>`
  border-bottom: 1px solid #F1F5F9;
  ${(p) => p.$clickable && 'cursor: pointer; &:hover { background: #F8FAFC; }'}
  &:last-child { border-bottom: none; }
`;
export const Th = styled.th<{ $num?: boolean }>`
  text-align: ${(p) => (p.$num ? 'right' : 'left')};
  padding: 10px 14px; background: #F8FAFC;
  font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.3px;
`;
export const Td = styled.td<{ $num?: boolean }>`
  padding: 12px 14px; color: #0F172A;
  text-align: ${(p) => (p.$num ? 'right' : 'left')};
  ${(p) => p.$num && 'font-variant-numeric: tabular-nums;'}
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px;
`;

export const SkeletonGrid = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
  @media (max-width: 1024px) { grid-template-columns: 1fr; }
`;
export const SkeletonCard = styled.div`
  height: 120px; background: #F1F5F9; border-radius: 12px;
  animation: pulse 1.6s ease-in-out infinite;
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
`;

export const ErrorBanner = styled.div`
  padding: 12px 16px; background: #FEE2E2; border: 1px solid #FECACA;
  color: #991B1B; border-radius: 10px; font-size: 13px; margin-bottom: 16px;
`;

export const SectionRow = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  margin: 0 0 8px 0;
`;

export const DownloadBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; background: #FFFFFF; color: #0F766E;
  border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
  &:hover:not(:disabled) { border-color: #0F766E; background: #F0FDFA; }
  &:disabled { color: #94A3B8; cursor: not-allowed; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.3); }
`;

export const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

// helpers
export const fmtKRW = (v: number | null | undefined): string => {
  if (v == null || isNaN(v)) return '—';
  if (Math.abs(v) >= 100000000) return `₩${(v / 100000000).toFixed(1)}억`;
  if (Math.abs(v) >= 10000) return `₩${(v / 10000).toFixed(0)}만`;
  return `₩${v.toLocaleString()}`;
};

export const fmtNum = (v: number | null | undefined, suffix = ''): string => {
  if (v == null || isNaN(v)) return '—';
  return v.toLocaleString() + suffix;
};

export const fmtPct = (v: number | null | undefined, opts?: { signed?: boolean }): string => {
  if (v == null || isNaN(v)) return '—';
  const s = v.toFixed(1) + '%';
  return opts?.signed && v > 0 ? '+' + s : s;
};
