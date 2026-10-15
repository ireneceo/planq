// 급여 화면들이 같이 쓰는 작은 조각 — 상태 칩 · 출처 뱃지(예상/대장/입력).
//   ★ 돈 화면에서 뱃지 없는 숫자를 만들지 않는다(설계 §1): 예상(PlanQ 가 계산) · 대장(세무사 값) · 입력(사람이 넣음).
//     색이 아니라 **글자**로 가른다 — 색만으로는 무엇인지 알 수 없다.
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { FinalSource, RunStatus } from './payrollApi';

const STATUS_TONE: Record<RunStatus, { bg: string; fg: string }> = {
  draft: { bg: '#F1F5F9', fg: '#475569' },
  reconciling: { bg: '#FEF3C7', fg: '#B45309' },
  confirmed: { bg: '#CCFBF1', fg: '#0F766E' },
  paid: { bg: '#E0E7FF', fg: '#3730A3' },
};

export function RunStatusChip({ status }: { status: RunStatus }) {
  const { t } = useTranslation('payroll');
  const tone = STATUS_TONE[status] || STATUS_TONE.draft;
  return <Chip $bg={tone.bg} $fg={tone.fg} data-testid="payroll-run-status">{t(`runStatus.${status}`)}</Chip>;
}

export function SourceBadge({ source }: { source: FinalSource }) {
  const { t } = useTranslation('payroll');
  if (!source) return null;
  const tone = source === 'statement' ? { bg: '#EEF2FF', fg: '#4338CA' } : source === 'manual' ? { bg: '#FFF7ED', fg: '#C2410C' } : { bg: '#F1F5F9', fg: '#64748B' };
  return <Badge $bg={tone.bg} $fg={tone.fg}>{t(`run.badge.${source}`)}</Badge>;
}

export const Chip = styled.span<{ $bg: string; $fg: string }>`
  display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; flex: 0 0 auto;
  background: ${(p) => p.$bg}; color: ${(p) => p.$fg}; font-size: 0.75rem; font-weight: 600; white-space: nowrap;
`;
export const Badge = styled.span<{ $bg: string; $fg: string }>`
  display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 4px;
  background: ${(p) => p.$bg}; color: ${(p) => p.$fg}; font-size: 0.6875rem; font-weight: 600; white-space: nowrap;
`;
