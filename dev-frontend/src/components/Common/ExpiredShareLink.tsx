// 만료된 공개 공유 링크 안내 페이지 (사이클 N+44).
//
// Public*Page 들이 fetch 응답 status === 410 && code === 'share_expired' 받을 때 이 컴포넌트 렌더.
// 외부 사용자가 받는 UI 라 first impression 중요 — 친절한 안내 + 발급자에게 새 링크 요청 안내.
//
// 백엔드 응답 형식 (share_helper.checkShareExpiry):
//   { success: false, code: 'share_expired', message: '...', expired_at: '...' }

// ★ 2026-09-10 — 여기서 `useTimeFormat` 을 쓰고 있었는데 그 훅은 내부에서 **`useAuth()` 를 부른다**
//   (hooks/useTimeFormat.ts). 즉 **무로그인 화면이 인증 컨텍스트를 구독**하고 있었고, 같은 만료일이
//   로그인한 사람에게는 워크스페이스 타임존, 익명 방문자에게는 브라우저 타임존으로 다르게 보였다.
//   공개 화면의 날짜는 보는 사람 로케일이면 충분하다 → utils/dateFormat.ts 의 formatPublicDate.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { formatPublicDate } from '../../utils/dateFormat';
import PublicPageShell from '../Layout/PublicPageShell';

interface Props {
  expiredAt?: string | null;
  entityLabel?: string;  // "이 업무", "이 문서" 등 (선택)
}

const ExpiredShareLink: React.FC<Props> = ({ expiredAt, entityLabel }) => {
  const { t } = useTranslation('common');

  return (
    <PublicPageShell layout="card" width="sm" brand={false} center print={false}>
      <Inner>
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
              date: formatPublicDate(expiredAt),
              defaultValue: '만료일: {{date}}',
            })}
          </Meta>
        )}
        <Hint>
          {t('expired.hint', {
            defaultValue: '공유한 분에게 새 링크를 요청하세요.',
          })}
        </Hint>
      </Inner>
    </PublicPageShell>
  );
};

export default ExpiredShareLink;

// 옛 Card 가 갖고 있던 것 중 **껍데기가 대신 못 하는 것**만 남긴다 — 가운데 정렬.
//   폭·배경·테두리·라운드·그림자는 PublicPageShell 의 card 레이아웃이 준다.
const Inner = styled.div`text-align: center;`;

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
  font-size: 1.125rem; font-weight: 700; color: #0F172A;
`;
const Desc = styled.p`
  margin: 0 0 12px;
  font-size: 0.875rem; color: #334155; line-height: 1.5;
`;
const Meta = styled.p`
  margin: 0 0 16px;
  font-size: 0.8125rem; color: #64748B;
`;
const Hint = styled.p`
  margin: 0;
  padding-top: 16px;
  border-top: 1px solid #F1F5F9;
  font-size: 0.8125rem; color: #94A3B8; line-height: 1.5;
`;
