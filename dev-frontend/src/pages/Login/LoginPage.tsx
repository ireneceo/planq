import React, { useState, useEffect } from 'react';
import { startAuthRedirect } from '../../services/oauth';
import GoogleAuthButton from '../../components/Auth/GoogleAuthButton';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { mapApiError } from '../../utils/apiError';
import styled from 'styled-components';
import { useAuth } from '../../contexts/AuthContext';

const Container = styled.div`
  /* dvh (dynamic viewport height) — iOS Safari 의 가변 주소창 포함 정확한 화면 높이.
     vh fallback 은 옛 브라우저 안전망. */
  min-height: 100vh;
  min-height: 100dvh;
  background: linear-gradient(180deg, #F8FAFC 0%, #E2E8F0 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;

  @media (max-width: 768px) {
    /* 모바일은 카드 박스 없이 풀스크린 — Container 자체가 폼 배경.
       padding 0 으로 LoginBox 가 가장자리까지 차지. */
    padding: 0;
    background: #FFFFFF;
    /* 모바일은 정확히 "가시영역" 만큼. 100dvh 는 네이티브 WebView 에서 실제보다 몇 px 커져
       body 를 스크롤 가능하게 만들고 iOS 고무줄을 유발한다(운영 실측 2026-08-25).
       --vvh 는 main.tsx 가 visualViewport.height 로 계속 sync 하는 값이라 항상 정확하다.
       height 고정 대신 min-height — 키보드가 올라와 가시영역이 줄면 내용이 잘리지 않고
       스크롤로 넘어가야 한다. */
    height: auto;
    min-height: var(--vvh, 100dvh);
  }
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
    max-width: 100%;
    /* 모바일 풀스크린 — 카드 시각 효과 제거 */
    border-radius: 0;
    box-shadow: none;
    height: 100%;
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
    /* 모바일 — 짧은 헤더로 (로고만). 폼이 주인. */
    /* ★ 헤더가 없는 화면이라 상단 안전영역을 **여기서** 비켜줘야 한다.
       노치(47~59px) 아래로 로고가 내려오지 않으면 잘려 보인다(2026-09-04 Irene 신고).
       웹·PWA 는 --pq-safe-top 이 0 이라 회귀 0. */
    padding: calc(24px + var(--pq-safe-top, 0px)) 24px 20px;
    min-height: auto;
    flex: 0 0 auto;
  }
`;

const BrandHome = styled(Link)`
  display: inline-block;
  border-radius: 8px;
  &:focus-visible { outline: 2px solid #fff; outline-offset: 4px; }
`;
const BrandLogo = styled.img`
  width: 100%;
  max-width: 200px;
  height: auto;
  display: block;
  margin: 0 auto 16px;
  user-select: none;

  @media (max-width: 768px) {
    max-width: 140px;
    margin-bottom: 8px;
  }
`;

const BrandDescription = styled.p`
  color: rgba(204, 251, 241, 0.6);
  font-size: 0.8125rem;
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
    /* 폼이 길어도 RightSection 안에서만 스크롤 — Container 자체는 fixed.
       safe-area-inset-bottom 으로 iOS 홈바 영역 보정. */
    padding: 24px 24px calc(24px + var(--pq-safe-bottom, 0px));
    flex: 1 1 auto;
    overflow-y: auto;
    justify-content: flex-start;
  }
`;

const FormTitle = styled.h2`
  font-size: 1.5rem;
  font-weight: 700;
  color: #0F172A;
  margin: 0 0 8px 0;
`;

const FormSubtitle = styled.p`
  font-size: 0.875rem;
  color: #475569;
  margin: 0 0 32px 0;
`;

const RecoverBanner = styled.div`
  display: flex; flex-direction: column; gap: 10px;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px;
  padding: 14px 16px; margin: 0 0 20px;
`;
const RecoverText = styled.p`font-size: 0.8125rem; color: #92400e; margin: 0; line-height: 1.5;`;
const RecoverBtn = styled.button`
  align-self: flex-start; height: 38px; padding: 0 16px; border-radius: 8px;
  border: none; background: #d97706; color: #fff; font-size: 0.8125rem; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #b45309; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
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
  font-size: 1rem;
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
  font-size: 1rem;
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
  font-size: 0.875rem;
  border: 1px solid #FEE2E2;
`;

const RememberRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: -8px;
`;
const RememberCheckbox = styled.input`
  width: 16px;
  height: 16px;
  accent-color: #14B8A6;
  cursor: pointer;
  margin: 0;
`;
const RememberLabel = styled.label`
  font-size: 0.8125rem;
  font-weight: 500;
  color: #334155;
  cursor: pointer;
  user-select: none;
`;
const RememberHint = styled.p`
  margin: -16px 0 0 24px;
  font-size: 0.6875rem;
  color: #94A3B8;
  line-height: 1.4;
`;

const DevPanel = styled.div`
  margin-top: 20px;
  padding: 16px;
  background: #FFF7ED;
  border: 1px dashed #FB923C;
  border-radius: 12px;
`;

const DevPanelTitle = styled.div`
  font-size: 0.75rem;
  font-weight: 700;
  color: #9A3412;
  margin-bottom: 4px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
`;

const DevPanelHint = styled.div`
  font-size: 0.6875rem;
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
  font-size: 0.75rem;
  color: #0F172A;
  transition: all 0.15s;

  strong {
    font-weight: 600;
    color: #0F172A;
    font-size: 0.75rem;
    margin-bottom: 1px;
  }
  span {
    color: #64748B;
    font-size: 0.625rem;
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
  font-size: 0.875rem;
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
  const { t: tErr } = useTranslation('errors');
  const navigate = useNavigate();
  const location = useLocation();
  const { login, logout, user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // 로그인 상태 유지 — default ON (Slack/Google/GitHub 표준).
  // OFF 시 백엔드가 session cookie 발급 → 브라우저 닫으면 자동 로그아웃 (공용 PC 안전).
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // 탈퇴 유예 중 복구 (account_deleted_pending)
  const [recoverPending, setRecoverPending] = useState(false);
  const [recovering, setRecovering] = useState(false);

  // ★ OAuth 실패 사유를 **화면이 말한다** (2026-09-06).
  //   서버는 실패하면 `/login?oauth_error=…` 로 보내고, 프론트도 세 곳(no_token·storage_failed·
  //   native_exchange)에서 같은 파라미터를 붙인다. 그런데 **읽는 곳이 0곳**이라 로그인 화면이
  //   아무 말 없이 되돌아왔다 — 사용자에겐 "그냥 안 됨" 이다
  //   (memory feedback_produced_link_no_consumer: 만드는 곳 4곳, 읽는 곳 0곳).
  //   ★ 서버 코드를 그대로 뿌리지 않는다 — 뜻 없는 영어 한 단어가 된다. 사유별 우리말/영어로.
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('oauth_error');
    if (!code) return;
    const known: Record<string, string> = {
      invalid_state: t('login.oauthErr.invalidState', { defaultValue: '로그인 시간이 초과됐어요. 다시 시도해 주세요.' }) as string,
      access_denied: t('login.oauthErr.denied', { defaultValue: 'Google 로그인이 취소됐습니다.' }) as string,
      email_not_verified: t('login.oauthErr.unverified', { defaultValue: '이메일이 확인되지 않은 Google 계정입니다.' }) as string,
      code_already_used: t('login.oauthErr.used', { defaultValue: '이미 사용된 로그인 링크예요. 다시 시도해 주세요.' }) as string,
      invalid_or_expired_code: t('login.oauthErr.expired', { defaultValue: '로그인 링크가 만료됐어요. 다시 시도해 주세요.' }) as string,
      account_unavailable: t('login.oauthErr.unavailable', { defaultValue: '사용할 수 없는 계정입니다. 관리자에게 문의해 주세요.' }) as string,
    };
    setError(known[code] || (t('login.oauthErr.generic', { defaultValue: 'Google 로그인을 마치지 못했어요. 다시 시도해 주세요.' }) as string));
    // 한 번 보여준 뒤 주소에서 지운다 — 새로고침 때마다 다시 뜨지 않게.
    const next = new URLSearchParams(location.search);
    next.delete('oauth_error');
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  }, [location.search, location.pathname, navigate, t]);

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
      setError(mapApiError(err, tErr));
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && isAuthenticated && user) {
      // 사이클 N+52 — state.from 의 pathname + search + hash 모두 보존.
      // PWA Share Target 시나리오: 미인증 사용자가 외부 앱에서 공유 → /share-receive?shared=1
      // 진입 → 로그인 후 ?shared=1 query 잃으면 SW Cache 안 읽어 빈 페이지 노출.
      const fromLoc = (location.state as { from?: { pathname: string; search?: string; hash?: string } })?.from;
      const fromPath = fromLoc ? `${fromLoc.pathname || ''}${fromLoc.search || ''}${fromLoc.hash || ''}` : null;
      const redirectQuery = new URLSearchParams(location.search).get('redirect');
      const target = redirectQuery || fromPath;
      const isValidPath = target && target.startsWith('/') && !target.startsWith('//') && !target.includes('javascript:');
      if (isValidPath && !target.startsWith('/login') && !target.startsWith('/register')) {
        navigate(target, { replace: true });
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
      const success = await login(email, password, remember);
      if (!success) {
        // 탈퇴 유예 중인지 확인 — 맞으면 복구 안내 (login 은 boolean 만 반환하므로 직접 조회)
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          const body = await res.json().catch(() => ({}));
          if (res.status === 403 && body?.code === 'account_deleted_pending') {
            setRecoverPending(true);
            setError('');
            return;
          }
        } catch { /* noop */ }
        setError(t('login.errorInvalid'));
      }
    } catch (err: unknown) {
      setError(mapApiError(err, tErr));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecover = async () => {
    setRecovering(true);
    setError('');
    try {
      const res = await fetch('/api/auth/deletion-recover', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) { setError(t('login.recoverFailed', '복구하지 못했습니다. 이메일·비밀번호를 확인하세요.')); return; }
      // 복구 성공 → 정상 로그인
      const success = await login(email, password, remember);
      if (!success) setError(t('login.errorInvalid'));
    } catch {
      setError(t('login.recoverFailed', '복구하지 못했습니다. 이메일·비밀번호를 확인하세요.'));
    } finally { setRecovering(false); }
  };

  return (
    <Container>
      <LoginBox>
        <LeftSection>
          {/* ★ 로고는 홈으로 가는 길이다 (Irene 2026-09-05 "로그인 페이지에서 다시 홈으로 갈 수가 없어").
              왼쪽 패널은 좁은 화면에서 숨으므로 아래 BottomLinks 에도 같은 길을 둔다. */}
          <BrandHome to="/" aria-label="PlanQ">
            <BrandLogo src="/planQ-slogan_white.svg" alt="PlanQ" />
          </BrandHome>
          <BrandDescription>
            {t('brand.description')}
          </BrandDescription>
        </LeftSection>

        <RightSection>
          <FormTitle>{t('login.title')}</FormTitle>
          <FormSubtitle>{t('login.subtitle')}</FormSubtitle>

          {recoverPending && (
            <RecoverBanner>
              <RecoverText>{t('login.recoverPending', '이 계정은 탈퇴 유예 중입니다. 지금 복구하면 계속 사용할 수 있습니다.')}</RecoverText>
              <RecoverBtn type="button" onClick={handleRecover} disabled={recovering}>
                {recovering ? t('login.recovering', '복구 중…') : t('login.recoverNow', '계정 복구하기')}
              </RecoverBtn>
            </RecoverBanner>
          )}

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

            <RememberRow>
              <RememberCheckbox
                type="checkbox"
                id="login-remember"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <RememberLabel htmlFor="login-remember">
                {t('login.rememberMe', '로그인 상태 유지')}
              </RememberLabel>
            </RememberRow>
            <RememberHint>
              {t('login.rememberHint', '공용 컴퓨터에서는 해제하세요. 해제 시 브라우저 닫으면 자동 로그아웃.')}
            </RememberHint>

            {error && <ErrorMessage>{error}</ErrorMessage>}

            <Button type="submit" disabled={isLoading}>
              {isLoading ? t('login.submitting') : t('login.submit')}
            </Button>
          </Form>

          {/* OAuth 로그인 (Google) — N+70.
              네이티브 앱: initiate 에 ?client=native → callback 이 일회용 code-exchange 딥링크로 분기(H-2).
              시스템 브라우저(SFSafariViewController)로 로그인 후 앱 복귀 시 세션이 WebView 에 심긴다. */}
          {/* 로그인·회원가입 공용 버튼 — components/Auth/GoogleAuthButton */}
          <GoogleAuthButton onStart={startAuthRedirect} disabled={isLoading} />

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
            <span><Link to="/forgot-password">{t('login.forgotPassword', '비밀번호를 잊으셨나요?')}</Link></span>
            {/* 좁은 화면에서는 왼쪽 브랜드 패널이 숨는다 — 홈으로 가는 길을 여기에도 둔다. */}
            <span><Link to="/">{t('login.backHome', { defaultValue: '← PlanQ 홈으로' }) as string}</Link></span>
          </BottomLinks>
        </RightSection>
      </LoginBox>
    </Container>
  );
};

export default LoginPage;
