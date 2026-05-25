// /oauth/callback — Google/Microsoft OAuth fragment 받기
// URL: /oauth/callback#token=<JWT>&next=<inbox|onboarding>
// 1. hash 파싱
// 2. localStorage 'planq_token' 저장
// 3. dashboard 또는 onboarding 으로 redirect
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

const OAuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('auth');

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const token = params.get('token');
    const next = params.get('next') || 'inbox';
    if (!token) {
      navigate('/login?oauth_error=no_token', { replace: true });
      return;
    }
    try {
      localStorage.setItem('planq_token', token);
      // hash 제거 + redirect
      window.history.replaceState(null, '', '/oauth/callback');
      const target = next === 'onboarding' ? '/onboarding' : '/inbox';
      window.location.replace(target);
    } catch {
      navigate('/login?oauth_error=storage_failed', { replace: true });
    }
  }, [navigate]);

  return (
    <Wrap>
      <Card>
        <Spinner />
        <Title>{t('oauth.completing', { defaultValue: '로그인 완료 중...' }) as string}</Title>
        <Hint>{t('oauth.wait', { defaultValue: '잠시만 기다려주세요' }) as string}</Hint>
      </Card>
    </Wrap>
  );
};

export default OAuthCallbackPage;

const Wrap = styled.div`
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: #F8FAFC; padding: 40px 20px;
`;
const Card = styled.div`
  background: #FFFFFF; padding: 32px 28px; border-radius: 14px;
  max-width: 420px; width: 100%; text-align: center;
  box-shadow: 0 8px 32px rgba(15,23,42,0.08);
`;
const Spinner = styled.div`
  width: 36px; height: 36px;
  border: 3px solid #E2E8F0; border-top-color: #14B8A6;
  border-radius: 50%; animation: spin 0.8s linear infinite;
  margin: 0 auto 16px;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
const Title = styled.h2`margin: 0 0 8px; font-size: 16px; font-weight: 700; color: #0F172A;`;
const Hint = styled.p`margin: 0; font-size: 13px; color: #64748B;`;
