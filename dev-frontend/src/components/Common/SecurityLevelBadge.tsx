// D4 #62 — 보안등급 배지 (general/internal/confidential). 단일 출처 (PartnerKindBadge 패턴).
//   visibility(누가 보나)와 직교 축 = 민감도/취급 제한. internal↑ 는 외부공유 차단.
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

export type SecurityLevel = 'general' | 'internal' | 'confidential';

const META: Record<SecurityLevel, { bg: string; fg: string }> = {
  general: { bg: '#F1F5F9', fg: '#64748B' },
  internal: { bg: '#FEF3C7', fg: '#92400E' },
  confidential: { bg: '#FEE2E2', fg: '#B91C1C' },
};

export function useSecurityLevelLabel() {
  const { t } = useTranslation('common');
  return (lv?: string) => t(`securityLevel.${lv || 'general'}`, {
    defaultValue: { general: '일반', internal: '내부', confidential: '기밀' }[lv || 'general'] || lv,
  }) as string;
}

const SecurityLevelBadge: React.FC<{ level?: string; className?: string }> = ({ level, className }) => {
  const label = useSecurityLevelLabel();
  const lv = (level || 'general') as SecurityLevel;
  if (lv === 'general') return null; // 일반은 배지 노출 안 함 (노이즈 0)
  const m = META[lv] || META.general;
  return <Badge className={className} style={{ background: m.bg, color: m.fg }}>{label(lv)}</Badge>;
};

export default SecurityLevelBadge;

const Badge = styled.span`
  font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 8px; flex-shrink: 0;
`;
