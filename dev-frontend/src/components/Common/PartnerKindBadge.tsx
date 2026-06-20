/**
 * PartnerKindBadge — 외부 파트너 유형 배지 (공통)
 *
 * D2 (#66) 외부 파트너 유형(고객/협력사/프리랜서/기타)의 단일 시각 표현.
 * ClientsPage 명단·상세, 업무 담당자/컨펌자 picker 등 어디서든 같은 pill 을 쓴다.
 * 라벨은 clients 네임스페이스(kind.*)에서 가져오므로 호출 측 네임스페이스와 무관.
 *
 * 색상은 COLOR_GUIDE 토큰 (유형별 고정 페어).
 */
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

export type PartnerKind = 'customer' | 'vendor' | 'freelancer' | 'other';

export const PARTNER_KIND_META: Record<PartnerKind, { bg: string; fg: string }> = {
  customer: { bg: '#F0FDFA', fg: '#0F766E' },
  vendor: { bg: '#DBEAFE', fg: '#1E40AF' },
  freelancer: { bg: '#FEF3C7', fg: '#92400E' },
  other: { bg: '#F1F5F9', fg: '#64748B' },
};

const normalizeKind = (k?: string): PartnerKind =>
  (k && k in PARTNER_KIND_META ? k : 'customer') as PartnerKind;

/** 유형 라벨 훅 — clients 네임스페이스 kind.* 단일 출처. */
export function usePartnerKindLabel() {
  const { t } = useTranslation('clients');
  return (k?: string) => t(`kind.${normalizeKind(k)}`, { defaultValue: normalizeKind(k) }) as string;
}

const Pill = styled.span<{ $bg: string; $fg: string; $size: 'sm' | 'xs' }>`
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  font-weight: 700;
  border-radius: 999px;
  white-space: nowrap;
  line-height: 1.4;
  font-size: ${(p) => (p.$size === 'xs' ? '10px' : '11px')};
  padding: ${(p) => (p.$size === 'xs' ? '1px 6px' : '2px 8px')};
  background: ${(p) => p.$bg};
  color: ${(p) => p.$fg};
`;

interface Props {
  kind?: string;
  size?: 'sm' | 'xs';
  /** 라벨 오버라이드 (기본은 유형명). */
  label?: string;
  className?: string;
}

export default function PartnerKindBadge({ kind, size = 'sm', label, className }: Props) {
  const kindLabel = usePartnerKindLabel();
  const k = normalizeKind(kind);
  const meta = PARTNER_KIND_META[k];
  return (
    <Pill $bg={meta.bg} $fg={meta.fg} $size={size} className={className}>
      {label ?? kindLabel(k)}
    </Pill>
  );
}
