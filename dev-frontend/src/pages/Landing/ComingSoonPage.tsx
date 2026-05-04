// 디자인 자료 받기 전 임시 — Features / Pricing / About / Contact 4 페이지 공용 stub.
// LandingLayout 의 GNB / Footer 는 그대로 노출 (라우팅 정상 + 일관 UX 유지).
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';

interface Props { titleKey: string; descKey: string; }

const ComingSoonPage: React.FC<Props> = ({ titleKey, descKey }) => {
  const { t } = useTranslation('landing');
  return (
    <LandingLayout>
      <Wrap>
        <Inner>
          <Eyebrow>{t('coming.eyebrow', '준비 중')}</Eyebrow>
          <Title>{t(titleKey)}</Title>
          <Desc>{t(descKey)}</Desc>
          <BackBtn to="/">← {t('coming.backToHome', '홈으로')}</BackBtn>
        </Inner>
      </Wrap>
    </LandingLayout>
  );
};

export default ComingSoonPage;

const Wrap = styled.section`
  padding: 120px 0;
  background:
    radial-gradient(ellipse at top, #F0FDFA 0%, transparent 50%),
    #FFFFFF;
  min-height: 60vh;
  @media (max-width: 768px) { padding: 80px 0; }
`;
const Inner = styled.div`
  max-width: 720px; margin: 0 auto; padding: 0 24px;
  display: flex; flex-direction: column; align-items: center;
  text-align: center; gap: 16px;
  @media (max-width: 640px) { padding: 0 16px; }
`;
const Eyebrow = styled.div`
  font-size: 12px; font-weight: 700; color: #0D9488;
  text-transform: uppercase; letter-spacing: 1px;
`;
const Title = styled.h1`
  font-size: 44px; font-weight: 800; letter-spacing: -1px;
  color: #0F172A; margin: 0;
  @media (max-width: 640px) { font-size: 32px; }
`;
const Desc = styled.p`
  font-size: 16px; line-height: 1.7; color: #475569;
  margin: 0; max-width: 540px;
`;
const BackBtn = styled(Link)`
  margin-top: 12px;
  height: 44px; padding: 0 24px;
  display: inline-flex; align-items: center;
  background: transparent; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 10px;
  font-size: 14px; font-weight: 600;
  text-decoration: none;
  transition: background 0.15s;
  &:hover { background: #F8FAFC; }
`;
