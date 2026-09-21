// GoogleAuthButton — 로그인·회원가입 공용 "Google 로 계속" 버튼.
//
//   두 화면이 각자 버튼을 그리면 문구·아이콘·비활성 규칙이 갈리고, 심사 스위치도 두 벌이 된다.
//   여기 하나만 두고 두 화면이 가져다 쓴다.
//
// ★ 로그인과 회원가입은 **같은 엔드포인트**를 쓴다. 백엔드 `/api/auth/google/callback` 이
//   3분기로 갈린다 — ①이미 연결된 구글 계정이면 로그인 ②같은 이메일의 기존 계정이 있으면
//   연결 확인 페이지 ③둘 다 없으면 **신규 가입**(사용자 + 워크스페이스 + Cue + 14일 trial).
//   그래서 회원가입 화면에서도 같은 버튼이면 충분하다 — 별도 가입 경로를 만들 필요가 없다.
//
// ★ 노출 스위치는 `GOOGLE_AUTH_ENABLED` 하나다. Google OAuth 검증 승인(2026-08-24) 으로 켜져 있다.
//   다시 꺼야 할 일이 생기면 여기 한 줄만 false 로 되돌린다.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { isNativeApp } from '../../services/native';

export const GOOGLE_AUTH_ENABLED = true;

// ★ Sign in with Apple (2026-09-21) — App Store 심사 4.8: 구글 로그인이 있으면 애플도 같은 자리에.
//   **같은 컴포넌트에 둔다** — 로그인·회원가입이 이 파일 하나를 쓰므로 한 곳만 붙이면 둘 다 생긴다.
//   노출은 서버가 정한다(플랫폼 관리자에 애플 자격이 다 들어 있을 때만 `apple: true`).
//   자격이 없는데 버튼을 보이면 누르는 순간 실패한다 — 그래서 묻고 나서 그린다. 한 번만 묻는다.
let providersPromise: Promise<{ apple: boolean }> | null = null;
function fetchProviders(): Promise<{ apple: boolean }> {
  if (!providersPromise) {
    providersPromise = fetch('/api/auth/oauth-providers', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => ({ apple: !!(j && j.data && j.data.apple) }))
      .catch(() => { providersPromise = null; return { apple: false }; });
  }
  return providersPromise;
}

interface Props {
  /** OAuth 로 벗어나기 전에 해야 할 정리를 포함한 리다이렉트 실행자. 화면마다 다르다. */
  onStart: (url: string) => void;
  disabled?: boolean;
  /** 버튼 위 "또는" 구분선까지 그릴지 */
  withDivider?: boolean;
  /** 구분선 문구 (기본 '또는') */
  dividerLabel?: string;
}

const GoogleAuthButton: React.FC<Props> = ({ onStart, disabled, withDivider = true, dividerLabel }) => {
  const { t } = useTranslation('auth');
  const [apple, setApple] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchProviders().then((p) => { if (alive) setApple(p.apple); });
    return () => { alive = false; };
  }, []);
  if (!GOOGLE_AUTH_ENABLED) return null;
  const appleLabel = t('login.continueWithApple', 'Apple로 계속하기') as string;
  const label = t('login.continueWithGoogle', 'Google로 계속하기') as string;
  return (
    <>
      {withDivider && <OAuthDivider><span>{dividerLabel || (t('login.or', '또는') as string)}</span></OAuthDivider>}
      <GoogleBtn
        type="button"
        data-testid="google-auth-btn"
        onClick={() => onStart(isNativeApp() ? '/api/auth/google/initiate?client=native' : '/api/auth/google/initiate')}
        disabled={disabled}
        aria-label={label}
      >
        <GoogleIcon viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </GoogleIcon>
        {label}
      </GoogleBtn>
      {apple && (
        <AppleBtn
          type="button"
          data-testid="apple-auth-btn"
          onClick={() => onStart(isNativeApp() ? '/api/auth/apple/initiate?client=native' : '/api/auth/apple/initiate')}
          disabled={disabled}
          aria-label={appleLabel}
        >
          <AppleIcon viewBox="0 0 814 1000" width="16" height="18" aria-hidden="true">
            <path fill="currentColor" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
          </AppleIcon>
          {appleLabel}
        </AppleBtn>
      )}
    </>
  );
};

export default GoogleAuthButton;

const OAuthDivider = styled.div`
  display: flex; align-items: center; gap: 12px;
  margin: 16px 0 12px;
  & > span { font-size: 0.75rem; color: #94A3B8; padding: 0 12px; }
  &::before, &::after { content: ''; flex: 1; height: 1px; background: #E2E8F0; }
`;
const GoogleBtn = styled.button`
  display: flex; align-items: center; justify-content: center; gap: 10px;
  width: 100%; height: 44px;
  background: #FFFFFF; color: #0F172A;
  border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 0.875rem; font-weight: 600;
  cursor: pointer; font-family: inherit;
  transition: background 0.15s, border-color 0.15s;
  &:hover:not(:disabled) { background: #F8FAFC; border-color: #94A3B8; }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const GoogleIcon = styled.svg`width: 18px; height: 18px;`;
// 애플 휴먼 인터페이스 가이드 — 검정 바탕·흰 로고·다른 로그인 버튼과 **같은 크기**.
const AppleBtn = styled(GoogleBtn)`
  margin-top: 10px;
  background: #000000; color: #FFFFFF; border-color: #000000;
  &:hover:not(:disabled) { background: #1F2937; border-color: #1F2937; }
`;
const AppleIcon = styled.svg`flex-shrink: 0; margin-top: -2px;`;
