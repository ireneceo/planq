// /dev-login — 상황판 «시험 계정으로 열기» 착지 (개발서버 전용, 2026-10-12)
// URL: /dev-login#code=v1.<payload>.<hmac>  — 상황판이 90초·1회용으로 서명한 코드. 해시라 서버 로그·Referer 에 안 남는다.
// 1. 해시의 code 를 읽고 주소창에서 지운다
// 2. 앱 부팅의 세션 확인(refresh)이 끝난 뒤 POST /api/auth/dev-login — 겹치면 앞 사람 refresh 응답이 새 쿠키를 덮을 수 있다
// 3. 서버가 보통 로그인과 같은 refresh 쿠키를 심는다 → 응답의 next 로 전체 새로 열기(부팅이 그 쿠키로 시험 계정 세션을 연다)
// next 는 **응답에서만** 읽는다(주소의 값은 믿지 않는다). 계약: ~/dev-server/kit/DEV-LOGIN.md
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { useAuth } from '../../contexts/AuthContext';
import { flushPendingSaves } from '../../services/pendingSaves';

const DEV_HOSTS = ['dev.planq.kr', 'localhost', '127.0.0.1'];
export const isDevLoginHost = () => DEV_HOSTS.includes(window.location.hostname);

// ★ 코드·진행 상태는 **모듈에** 둔다. 이 화면은 부팅 중 Suspense 로 다시 그려질 수 있다 — 컴포넌트 ref 에 두면
//   다시 그려진 화면이 «이미 지운 해시» 를 읽어 no_code 가 되고, 시작 표시도 새로 false 라 요청을 못 보냈다(2026-10-12 실측).
let capturedCode: string | null = null;
let started = false;
let lastError: string | null = null;
let showError: ((e: string) => void) | null = null;

function takeCode(): string {
  if (capturedCode === null) {
    capturedCode = new URLSearchParams(window.location.hash.slice(1)).get('code') || '';
    // 주소창에서 지운다(뒤로 가기·새로고침·화면 공유로 다시 쓰이지 않게)
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* noop */ }
  }
  return capturedCode;
}

function fail(e: string) {
  lastError = e;
  if (showError) showError(e);
}

async function run(isAuthenticated: boolean) {
  const code = takeCode();
  if (!code) { fail('no_code'); return; }
  // 내 계정으로 쓰던 자동저장이 남아 있으면 먼저 보낸다(상한 3초)
  if (isAuthenticated) { try { await flushPendingSaves(); } catch { /* noop */ } }
  try {
    const r = await fetch('/api/auth/dev-login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const j = await r.json().catch(() => ({} as Record<string, unknown>));
    const next = j?.data?.dev_login?.next;
    if (!r.ok || typeof next !== 'string' || !/^\/(?!\/)/.test(next)) {
      fail(String(j?.error || r.status));
      return;
    }
    // 데스크탑 탭 모드는 부팅 때 지난 탭을 되살린다 — 이 주소가 이기도록 딥링크로 넘긴다(App.tsx ModeGate)
    try { sessionStorage.setItem('planq_boot_deeplink', next); } catch { /* noop */ }
    window.location.replace(next);
  } catch {
    fail('network');
  }
}

const DevLoginPage: React.FC = () => {
  const { t } = useTranslation('auth');
  const { isLoading, isAuthenticated } = useAuth();
  const [error, setError] = useState<string | null>(lastError);

  if (isDevLoginHost()) takeCode();

  useEffect(() => {
    showError = setError;
    return () => { if (showError === setError) showError = null; };
  }, []);

  // 앱 부팅의 세션 확인(refresh)이 끝난 뒤에 보낸다 — 겹치면 앞 사람 refresh 응답이 새 쿠키를 덮을 수 있다
  useEffect(() => {
    if (!isDevLoginHost() || isLoading || started) return;
    started = true;
    run(isAuthenticated);
  }, [isLoading, isAuthenticated]);

  if (!isDevLoginHost()) return <Navigate to="/" replace />;

  return (
    <Wrap>
      <Card data-testid="dev-login-card">
        {error ? (
          <>
            <Title>{t('devLogin.failed', { code: error })}</Title>
            <Hint><a href="/login">{t('devLogin.normalLogin')}</a></Hint>
          </>
        ) : (
          <>
            <Spinner />
            <Title>{t('devLogin.signingIn')}</Title>
            <Hint>{t('devLogin.replaces')}</Hint>
          </>
        )}
      </Card>
    </Wrap>
  );
};

export default DevLoginPage;

const Wrap = styled.div`
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: #F8FAFC; padding: 40px 16px;
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
const Title = styled.h2`margin: 0 0 8px; font-size: 1rem; font-weight: 700; color: #0F172A;`;
const Hint = styled.p`
  margin: 0; font-size: 0.8125rem; color: #64748B;
  a { color: #0D9488; font-weight: 600; }
`;
