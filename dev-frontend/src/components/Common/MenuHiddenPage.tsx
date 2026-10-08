// components/Common/MenuHiddenPage.tsx — 관리자가 숨긴 메뉴로 주소를 직접 들어왔을 때 (0-E E-2)
//
// 사이드바에서만 숨기면 주소창·북마크·알림 링크로는 그대로 열리고, 서버는 403 을 줘서 «빈 화면» 이 된다.
// 본문 대신 이유와 갈 곳을 말한다. 모양은 DetailFallback 과 같은 껍데기(베끼지 않는다).
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import ChromeLink from '../Tab/ChromeLink';
import { FallbackWrap, FallbackTitle, FallbackDesc, FallbackRow, FallbackPrimary } from './DetailFallback';

export default function MenuHiddenPage() {
  const { t } = useTranslation('layout');
  return (
    <FallbackWrap data-testid="menu-hidden" role="status">
      <FallbackTitle>{t('menuHidden.title')}</FallbackTitle>
      <FallbackDesc>{t('menuHidden.desc')}</FallbackDesc>
      <FallbackRow>
        <GoLink as={ChromeLink} to="/inbox" data-testid="menu-hidden-go-inbox">{t('menuHidden.goInbox')}</GoLink>
      </FallbackRow>
    </FallbackWrap>
  );
}

// 버튼 모양을 링크에 입힌다(주 내비게이션 계약 = ChromeLink)
const GoLink = styled(FallbackPrimary)`
  display: inline-flex; align-items: center; text-decoration: none;
`;
