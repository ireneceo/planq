// 고객 프로젝트 링크 **개요 탭의 부품** — GuestProjectPage.tsx 가 800줄을 넘어 떼어 냈다(2026-10-11, god-file 래칫).
//   값·모양은 옮기기만 했다. 개요 배치 규칙(PC 가로 · 폰 세로)은 docs/GUEST_PROJECT_VIEW_DECISIONS.md §I-1 과 Irene 2026-10-11
//   *"아래로 하지 말고 가로로 … PC용하고 반응형 맞춰줘"*.
import styled from 'styled-components';

// 기본 정보 한 줄 — 값이 비면 «—» 로 그린다(숨기지 않는다, §I-1).
//   2026-10-11 (Irene: *"이거 아래로 하지 말고 가로로 좀 맞추면 안돼? 정돈 좀 PC용하고 반응형 맞춰줘."*)
//   — 항목 하나 = 칸 하나(이름 위 · 값 아래). PC 는 다섯 칸 한 줄 + 설명 한 줄, 폰은 두 칸씩(기간은 두 칸 차지).
export function InfoRow({ label, value, testId, pre, wide }: { label: string; value: string; testId: string; pre?: boolean; wide?: boolean }) {
  return (
    <InfoCell $wide={!!wide} $key={testId} data-testid={`guest-ov-cell-${testId}`}>
      <InfoKey>{label}</InfoKey>
      <InfoVal data-testid={`guest-ov-info-${testId}`} $pre={!!pre} $empty={!value}>{value || '—'}</InfoVal>
    </InfoCell>
  );
}

/** 두 덩어리를 나란히 — 칸이 320px 아래로 줄면 한 줄씩. 하나뿐이면 한 줄을 다 쓴다(auto-fit). */
export const Pair = styled.div`
  display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px 16px;align-items:start;
  @media (max-width:640px){ grid-template-columns:minmax(0,1fr); }
`;
// PC: 상태 · 기간(넓게) · 업무 · 문서 · 파일 한 줄, 설명은 아래 한 줄 전체. 칸 사이는 세로 구분선.
// 폰(≤640): 두 칸씩 — 기간·설명은 두 칸을 다 쓴다(날짜 두 개가 한 칸에 안 들어간다).
export const InfoGrid = styled.dl`
  display:grid;margin:0;
  grid-template-columns:minmax(0,1fr) minmax(0,2fr) minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr);
  background:#fff;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;
  @media (max-width:640px){ grid-template-columns:repeat(2,minmax(0,1fr)); }
`;
export const InfoCell = styled.div<{ $wide: boolean; $key: string }>`
  display:flex;flex-direction:column;gap:4px;min-width:0;padding:12px 14px;
  border-left:1px solid #F1F5F9;
  &:first-child{border-left:none;}
  ${p => (p.$wide ? 'grid-column:1 / -1;border-left:none;border-top:1px solid #F1F5F9;' : '')}
  @media (max-width:640px){
    border-left:none;border-top:1px solid #F1F5F9;
    &:first-child{border-top:none;}
    /* 짧은 넷(상태·업무 / 문서·파일)을 두 칸씩, 긴 둘(기간·설명)은 한 줄 전체 — 반쪽만 남는 칸이 없다 */
    order:${p => ({ status: 1, tasks: 2, docs: 3, files: 4, period: 5, desc: 6 } as Record<string, number>)[p.$key] ?? 9};
    ${p => (p.$key === 'period' ? 'grid-column:1 / -1;' : '')}
    ${p => (p.$key === 'tasks' || p.$key === 'files' ? 'border-left:1px solid #F1F5F9;' : '')}
    ${p => (p.$key === 'status' ? 'border-top:none;' : '')}
    ${p => (p.$key === 'tasks' ? 'border-top:none;' : '')}
  }
`;
export const InfoKey = styled.dt`font-size:0.6875rem;color:#94A3B8;font-weight:600;`;
export const InfoVal = styled.dd<{ $pre: boolean; $empty: boolean }>`
  margin:0;font-size:0.8125rem;color:${p => (p.$empty ? '#CBD5E1' : '#334155')};min-width:0;word-break:break-word;
  white-space:${p => (p.$pre ? 'pre-wrap' : 'normal')};line-height:1.5;
`;
export const CapNote = styled.span`font-weight:500;color:#94A3B8;`;
// auto-fit — 칸이 줄을 꽉 채운다(auto-fill 은 빈 칸 자리를 남겨 오른쪽이 비었다, 2026-10-11)
export const StatGrid = styled.div`display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px;`;
export const StatCell = styled.div<{ $warn?: boolean }>`
  background:#fff;border:1px solid ${p => (p.$warn ? '#FECDD3' : '#E2E8F0')};border-radius:10px;padding:10px 12px;
  display:flex;flex-direction:column;gap:2px;
`;
export const StatNum = styled.div`font-size:1.125rem;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;`;
export const StatName = styled.div`font-size:0.6875rem;color:#64748B;`;
export const DateSpan = styled.span<{ $warn: boolean }>`color:${p => (p.$warn ? '#E11D48' : 'inherit')};`;
export const WeekBars = styled.div`display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;align-items:end;
  background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:12px;`;
export const WeekCol = styled.div`display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;`;
export const WeekNum = styled.div`font-size:0.6875rem;font-weight:700;color:#475569;min-height:14px;`;
export const WeekTrack = styled.div`width:100%;max-width:28px;height:64px;background:#F1F5F9;border-radius:6px;display:flex;align-items:flex-end;overflow:hidden;`;
export const WeekFill = styled.div`width:100%;background:#14B8A6;border-radius:6px;`;
export const IssueList = styled.div`display:flex;flex-direction:column;gap:0;background:#fff;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;`;
export const IssueRow = styled.div`padding:11px 14px;border-bottom:1px solid #F1F5F9;&:last-child{border-bottom:none;}`;
export const IssueDate = styled.div`font-size:0.6875rem;color:#94A3B8;`;
export const IssueTitle = styled.div`font-size:0.875rem;color:#0F172A;font-weight:600;line-height:1.4;word-break:break-word;`;
export const IssueBody = styled.div`margin-top:4px;font-size:0.8125rem;color:#475569;line-height:1.55;white-space:pre-wrap;word-break:break-word;`;
