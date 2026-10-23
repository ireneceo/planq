// 안심 한 줄 — 이용자가 걱정할 자리(메일 연결·외부 연동·고객 초대·멤버 내보내기·데이터 내보내기)에 붙인다.
//   (2026-10-23, Fable 설계 docs/TRUST_SERVICES_DESIGN.md D2)
// ★ 문구 원천은 common.trust.<spot> 한 벌. 자리마다 새 문장을 쓰지 않는다 — 장치가 바뀌면 그 한 곳만 고친다.
// ★ 설계 §1-4 «확인된 장치» 에 없는 것은 쓰지 않는다(과장 금지). 링크는 공개 페이지 /security.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

export type TrustSpot = 'signup' | 'mailConnect' | 'integrations' | 'clientInvite' | 'memberRemove' | 'dataExport';

const TrustNote: React.FC<{ spot: TrustSpot; className?: string }> = ({ spot, className }) => {
  const { t } = useTranslation('common');
  return (
    <Note className={className} data-testid={`trust-${spot}`}>
      <Icon aria-hidden>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      </Icon>
      <span>
        {t(`trust.${spot}`)}{' '}
        <a href="/security" target="_blank" rel="noopener noreferrer">{t('trust.policyLink', '보안 정책 보기')}</a>
      </span>
    </Note>
  );
};

export default TrustNote;

const Note = styled.p`
  display: flex; gap: 6px; align-items: flex-start;
  margin: 0; font-size: 0.75rem; color: #64748B; line-height: 1.55;
  a { color: #0F766E; font-weight: 600; text-decoration: none; white-space: nowrap; }
  a:hover { text-decoration: underline; }
`;
const Icon = styled.span`color: #0F766E; display: inline-flex; margin-top: 2px; flex-shrink: 0;`;
