// 만료된 공개 공유 링크 안내 페이지 (사이클 N+44).
//
// Public*Page 들이 fetch 응답 status === 410 && code === 'share_expired' 받을 때 이 컴포넌트 렌더.
// 외부 사용자가 받는 UI 라 first impression 중요 — 친절한 안내 + 발급자에게 새 링크 요청 안내.
//
// 백엔드 응답 형식 (share_helper.checkShareExpiry):
//   { success: false, code: 'share_expired', message: '...', expired_at: '...' }

import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useTimeFormat } from '../../hooks/useTimeFormat';

interface Props {
  expiredAt?: string | null;
  entityLabel?: string;  // "이 업무", "이 문서" 등 (선택)
}

const ExpiredShareLink: React.FC<Props> = ({ expiredAt, entityLabel }) => {
  const { t } = useTranslation('common');
  const { formatDate } = useTimeFormat();

  return (
    <Wrap>
      <Card>
        <IconWrap aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </IconWrap>
        <Title>{t('expired.title', { defaultValue: '이 공유 링크는 만료되었습니다' })}</Title>
        <Desc>
          {entityLabel
            ? t('expired.descWithLabel', { label: entityLabel, defaultValue: '{{label}} 의 공유가 더 이상 유효하지 않습니다.' })
            : t('expired.desc', { defaultValue: '이 공유가 더 이상 유효하지 않습니다.' })}
        </Desc>
        {expiredAt && (
          <Meta>
            {t('expired.expiredOn', {
              date: formatDate(expiredAt),
              defaultValue: '만료일: {{date}}',
            })}
          </Meta>
        )}
        <Hint>
          {t('expired.hint', {
            defaultValue: '공유한 분에게 새 링크를 요청하세요.',
          })}
        </Hint>
      </Card>
    </Wrap>
  );
};

export default ExpiredShareLink;

const Wrap = styled.div`
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  background: #F8FAFC;
  padding: 24px;
`;
const Card = styled.div`
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 14px;
  padding: 32px 28px;
  max-width: 420px; width: 100%;
  text-align: center;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
`;
const IconWrap = styled.div`
  width: 56px; height: 56px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #FEF2F2;
  color: #EF4444;
  border-radius: 50%;
  margin-bottom: 16px;
  svg { width: 28px; height: 28px; }
`;
const Title = styled.h1`
  margin: 0 0 8px;
  font-size: 18px; font-weight: 700; color: #0F172A;
`;
const Desc = styled.p`
  margin: 0 0 12px;
  font-size: 14px; color: #334155; line-height: 1.5;
`;
const Meta = styled.p`
  margin: 0 0 16px;
  font-size: 13px; color: #64748B;
`;
const Hint = styled.p`
  margin: 0;
  padding-top: 16px;
  border-top: 1px solid #F1F5F9;
  font-size: 13px; color: #94A3B8; line-height: 1.5;
`;
