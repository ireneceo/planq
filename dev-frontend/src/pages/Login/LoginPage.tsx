import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { useAuth } from '../../contexts/AuthContext';

const Container = styled.div`
  min-height: 100vh;
  background: linear-gradient(180deg, #F8FAFC 0%, #E2E8F0 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
`;

const LoginBox = styled.div`
  background: white;
  border-radius: 20px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  width: 100%;
  max-width: 900px;
  display: flex;
  overflow: hidden;

  @media (max-width: 768px) {
    flex-direction: column;
    max-width: 440px;
  }
`;

const LeftSection = styled.div`
  flex: 1;
  background: linear-gradient(180deg, #0D9488 0%, #134E4A 100%);
  padding: 60px 48px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  min-height: 480px;

  @media (max-width: 768px) {
    padding: 40px 30px;
    min-height: auto;
  }
`;

const BrandLogo = styled.div`
  font-size: 40px;
  font-weight: 800;
  color: #FFFFFF;
  letter-spacing: -1px;
  margin-bottom: 16px;

  span {
    color: #5EEAD4;
  }
`;

const BrandTagline = styled.p`
  color: #CCFBF1;
  font-size: 16px;
  line-height: 1.6;
  margin: 0;
  max-width: 280px;
`;

const BrandDescription = styled.p`
  color: rgba(204, 251, 241, 0.6);
  font-size: 13px;
  margin-top: 24px;
  max-width: 260px;
  line-height: 1.5;
`;

const RightSection = styled.div`
  flex: 1;
  padding: 60px 48px;
  display: flex;
  flex-direction: column;
  justify-content: center;

  @media (max-width: 768px) {
    padding: 40px 30px;
  }
`;

const FormTitle = styled.h2`
  font-size: 24px;
  font-weight: 700;
  color: #0F172A;
  margin: 0 0 8px 0;
`;

const FormSubtitle = styled.p`
  font-size: 14px;
  color: #475569;
  margin: 0 0 32px 0;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
`;

const Input = styled.input`
  padding: 14px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 50px;
  font-size: 16px;
  transition: all 0.2s;
  width: 100%;
  box-sizing: border-box;
  background: #F8FAFC;
  color: #0F172A;

  &::placeholder {
    color: #94A3B8;
  }

  &:hover {
    border-color: #CBD5E1;
  }

  &:focus {
    outline: none;
    border-color: #14B8A6;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
    background: #FFFFFF;
  }
`;

const PasswordWrapper = styled.div`
  position: relative;
  display: flex;
  align-items: center;
`;

const PasswordToggle = styled.button`
  position: absolute;
  right: 14px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94A3B8;
  transition: color 0.2s;

  &:hover {
    color: #475569;
  }

  svg {
    width: 20px;
    height: 20px;
  }
`;

const Button = styled.button`
  padding: 14px 24px;
  background: #0D9488;
  color: white;
  border: none;
  border-radius: 50px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 8px;

  &:hover {
    background: #0F766E;
    transform: translateY(-2px);
    box-shadow: 0 10px 20px rgba(13, 148, 136, 0.3);
  }

  &:active {
    transform: translateY(0);
    background: #115E59;
  }

  &:disabled {
    background: #99F6E4;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }
`;

const ErrorMessage = styled.div`
  background: #FEF2F2;
  color: #DC2626;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  border: 1px solid #FEE2E2;
`;

const DevPanel = styled.div`
  margin-top: 20px;
  padding: 16px;
  background: #FFF7ED;
  border: 1px dashed #FB923C;
  border-radius: 12px;
`;

const DevPanelTitle = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: #9A3412;
  margin-bottom: 4px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
`;

const DevPanelHint = styled.div`
  font-size: 11px;
  color: #9A3412;
  opacity: 0.8;
  margin-bottom: 12px;
`;

const DevRoleGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
`;

const DevRoleBtn = styled.button`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 8px 10px;
  background: #FFFFFF;
  border: 1px solid #FED7AA;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  font-size: 12px;
  color: #0F172A;
  transition: all 0.15s;

  strong {
    font-weight: 600;
    color: #0F172A;
    font-size: 12px;
    margin-bottom: 1px;
  }
  span {
    color: #64748B;
    font-size: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  &:hover {
    border-color: #FB923C;
    background: #FFF7ED;
    transform: translateY(-1px);
  }
  &:active { transform: translateY(0); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const Divider = styled.div`
  width: 100%;
  height: 1px;
  background: #E2E8F0;
  margin: 24px 0;
`;

const BottomLinks = styled.div`
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  font-size: 14px;
  color: #475569;

  a {
    color: #0D9488;
    text-decoration: none;
    font-weight: 500;
    &:hover { text-decoration: underline; color: #0F766E; }
  }
`;

const LoginPage: React.FC = () => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const { login, logout, user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // dev 환경에서만 퀵로그인 패널 노출. 프로덕션(planq.kr)에서는 숨김.
  const isDev = typeof window !== 'undefined' && (
    window.location.hostname === 'dev.planq.kr' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );
  const DEV_ACCOUNTS = [
    { label: t('login.devPanel.admin', '플랫폼 관리자'), email: 'admin@test.planq.kr' },
    { label: t('login.devPanel.owner', '워크스페이스 관리자'), email: 'owner@test.planq.kr' },
    { label: t('login.devPanel.member1', '멤버 · 이디자'), email: 'member1@test.planq.kr' },
    { label: t('login.devPanel.member2', '멤버 · 박개발'), email: 'member2@test.planq.kr' },
    { label: t('login.devPanel.client', '고객 · 최고객'), email: 'client@test.planq.kr' },
  ];
  const DEV_PASSWORD = 'Test1234!';

  const handleQuickLogin = async (devEmail: string) => {
    setEmail(devEmail);
    setPassword(DEV_PASSWORD);
    setError('');
    setIsLoading(true);
    try {
      // 기존 세션이 남아있으면 선 제거 (쿠키/토큰 충돌 방지) — logout API 실패해도 진행
      if (isAuthenticated) {
        try { await logout(); } catch { /* noop */ }
      }
      // 직접 fetch — AuthContext state 경합 피함
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: devEmail, password: DEV_PASSWORD }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      // full page nav — SPA state 전부 리셋하고 dashboard 진입 (세션 쿠키는 그대로 유지)
      window.location.href = '/dashboard';
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[DevQuickLogin] failed', { email: devEmail, err });
      setError(err instanceof Error ? err.message : t('login.errorGeneric'));
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && isAuthenticated && user) {
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname;
      const isValidPath = from && from.startsWith('/') && !from.startsWith('//') && !from.includes('javascript:');
      if (isValidPath && from !== '/login' && from !== '/register') {
        navigate(from, { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [authLoading, isAuthenticated, user, navigate, location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const success = await login(email, password);
      if (!success) {
        setError(t('login.errorInvalid'));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('login.errorGeneric');
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Container>
      <LoginBox>
        <LeftSection>
          <BrandLogo>Plan<span>Q</span></BrandLogo>
          <BrandTagline>
            {t('brand.tagline')}
          </BrandTagline>
          <BrandDescription>
            {t('brand.description')}
          </BrandDescription>
        </LeftSection>

        <RightSection>
          <FormTitle>{t('login.title')}</FormTitle>
          <FormSubtitle>{t('login.subtitle')}</FormSubtitle>

          <Form onSubmit={handleSubmit}>
            <InputGroup>
              <Input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.emailPlaceholder')}
                required
                autoComplete="username"
              />
            </InputGroup>

            <InputGroup>
              <PasswordWrapper>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('login.passwordPlaceholder')}
                  required
                  autoComplete="current-password"
                />
                <PasswordToggle type="button" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </PasswordToggle>
              </PasswordWrapper>
            </InputGroup>

            {error && <ErrorMessage>{error}</ErrorMessage>}

            <Button type="submit" disabled={isLoading}>
              {isLoading ? t('login.submitting') : t('login.submit')}
            </Button>
          </Form>

          {isDev && (
            <DevPanel>
              <DevPanelTitle>{t('login.devPanel.title', '개발 테스트 계정')}</DevPanelTitle>
              <DevPanelHint>{t('login.devPanel.hint', '클릭하면 즉시 로그인됩니다 · 비밀번호: Test1234!')}</DevPanelHint>
              <DevRoleGrid>
                {DEV_ACCOUNTS.map((a) => (
                  <DevRoleBtn
                    key={a.email}
                    type="button"
                    disabled={isLoading}
                    onClick={() => handleQuickLogin(a.email)}
                  >
                    <strong>{a.label}</strong>
                    <span>{a.email}</span>
                  </DevRoleBtn>
                ))}
              </DevRoleGrid>
            </DevPanel>
          )}

          <Divider />

          <BottomLinks>
            <span>{t('login.noAccount')} <Link to="/register">{t('login.signUp')}</Link></span>
          </BottomLinks>
        </RightSection>
      </LoginBox>
    </Container>
  );
};

export default LoginPage;
