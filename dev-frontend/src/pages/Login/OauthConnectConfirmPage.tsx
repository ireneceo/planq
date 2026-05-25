// /oauth/connect-confirm?token=... — OAuth 표준 분기 2 (기존 email 매칭 시 명시 연결 동의)
//
// 흐름:
// 1. backend callback 가 email 매칭 user 발견 → confirm token 발급 + 여기로 redirect
// 2. 이 page 가 token 으로 info fetch (기존 user + Google 프로필)
// 3. 사용자 "연결" 클릭 → POST → OauthConnection 생성 + 로그인 cookie 발급 → /inbox
// 4. 사용자 "취소" 클릭 → /login
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

interface ConnectInfo {
  existing_user: { id: number; email: string; name: string; avatar_url: string | null };
  google: { email: string; display_name: string | null; picture: string | null };
}

const OauthConnectConfirmPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('auth');
  const [sp] = useSearchParams();
  const token = sp.get('token') || '';
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError(t('oauth.connect.noToken', { defaultValue: '토큰 누락' }) as string);
      return;
    }
    fetch(`/api/auth/google/connect-confirm/info?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(j => {
        if (j.success) setInfo(j.data);
        else setError(j.message || 'invalid_token');
      })
      .catch(e => setError(e.message));
  }, [token, t]);

  const onConnect = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/google/connect-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, action: 'connect' }),
      });
      const j = await r.json();
      if (j.success && j.data.action === 'connected') {
        // refresh_token cookie set 됨 — AuthContext mount 시 자동 로그인
        window.location.replace(j.data.next || '/inbox');
      } else {
        setError(j.message || 'failed');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const onCancel = async () => {
    try {
      await fetch('/api/auth/google/connect-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'cancel' }),
      });
    } catch { /* ignore */ }
    navigate('/login', { replace: true });
  };

  if (error) {
    return (
      <Wrap>
        <Card>
          <Title>{t('oauth.connect.errorTitle', { defaultValue: '연결 확인 실패' }) as string}</Title>
          <ErrorMsg>{error}</ErrorMsg>
          <PrimaryBtn type="button" onClick={() => navigate('/login')}>
            {t('oauth.connect.backToLogin', { defaultValue: '로그인 페이지로' }) as string}
          </PrimaryBtn>
        </Card>
      </Wrap>
    );
  }

  if (!info) {
    return (
      <Wrap>
        <Card>
          <Spinner />
          <Title>{t('oauth.connect.loading', { defaultValue: '확인 중...' }) as string}</Title>
        </Card>
      </Wrap>
    );
  }

  return (
    <Wrap>
      <Card>
        <Title>{t('oauth.connect.title', { defaultValue: 'Google 계정 연결' }) as string}</Title>
        <Desc>
          {t('oauth.connect.desc', {
            defaultValue: '이 Google 계정의 이메일이 기존 PlanQ 계정과 일치해요. 연결할까요?',
          }) as string}
        </Desc>

        <ComparisonRow>
          <AccountCard>
            <AccountBadge>{t('oauth.connect.existing', { defaultValue: '기존 PlanQ 계정' }) as string}</AccountBadge>
            {info.existing_user.avatar_url && <Avatar src={info.existing_user.avatar_url} alt="" />}
            <AccountName>{info.existing_user.name}</AccountName>
            <AccountEmail>{info.existing_user.email}</AccountEmail>
          </AccountCard>

          <ConnectArrow>↔</ConnectArrow>

          <AccountCard>
            <AccountBadge $google>Google</AccountBadge>
            {info.google.picture && <Avatar src={info.google.picture} alt="" />}
            <AccountName>{info.google.display_name || '—'}</AccountName>
            <AccountEmail>{info.google.email}</AccountEmail>
          </AccountCard>
        </ComparisonRow>

        <Hint>
          {t('oauth.connect.hint', {
            defaultValue: '연결하면 이후 Google 로 한 번에 로그인할 수 있어요. 기존 비밀번호도 그대로 사용 가능합니다.',
          }) as string}
        </Hint>

        <Actions>
          <SecondaryBtn type="button" onClick={onCancel} disabled={submitting}>
            {t('oauth.connect.cancel', { defaultValue: '취소' }) as string}
          </SecondaryBtn>
          <PrimaryBtn type="button" onClick={onConnect} disabled={submitting}>
            {submitting
              ? t('oauth.connect.connecting', { defaultValue: '연결 중...' }) as string
              : t('oauth.connect.confirm', { defaultValue: '연결하고 로그인' }) as string}
          </PrimaryBtn>
        </Actions>
      </Card>
    </Wrap>
  );
};

export default OauthConnectConfirmPage;

// ─── styled ────────────────────────────────────
const Wrap = styled.div`
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: #F8FAFC; padding: 40px 20px;
`;
const Card = styled.div`
  background: #FFFFFF; padding: 32px 28px; border-radius: 14px;
  max-width: 520px; width: 100%; text-align: center;
  box-shadow: 0 8px 32px rgba(15,23,42,0.08);
  display: flex; flex-direction: column; gap: 16px;
`;
const Title = styled.h2`margin: 0; font-size: 18px; font-weight: 700; color: #0F172A;`;
const Desc = styled.p`margin: 0; font-size: 13px; color: #475569; line-height: 1.6;`;
const Hint = styled.p`margin: 0; font-size: 12px; color: #64748B; line-height: 1.6; padding: 10px 12px; background: #F8FAFC; border-radius: 8px;`;
const ComparisonRow = styled.div`
  display: flex; align-items: center; gap: 12px; margin: 8px 0;
  @media (max-width: 640px) { flex-direction: column; }
`;
const AccountCard = styled.div`
  flex: 1; padding: 16px 12px; background: #F8FAFC; border-radius: 10px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
`;
const AccountBadge = styled.div<{ $google?: boolean }>`
  font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 10px;
  background: ${p => p.$google ? '#FEF3C7' : '#CCFBF1'};
  color: ${p => p.$google ? '#92400E' : '#0F766E'};
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const Avatar = styled.img`width: 40px; height: 40px; border-radius: 50%; object-fit: cover;`;
const AccountName = styled.div`font-size: 13px; font-weight: 700; color: #0F172A;`;
const AccountEmail = styled.div`font-size: 11px; color: #64748B;`;
const ConnectArrow = styled.div`font-size: 18px; color: #14B8A6;`;
const Spinner = styled.div`
  width: 32px; height: 32px; margin: 0 auto;
  border: 3px solid #E2E8F0; border-top-color: #14B8A6;
  border-radius: 50%; animation: spin 0.8s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
const ErrorMsg = styled.div`color: #B91C1C; font-size: 13px; padding: 10px; background: #FEF2F2; border-radius: 6px;`;
const Actions = styled.div`display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px;`;
const PrimaryBtn = styled.button`
  padding: 10px 18px; background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 10px 16px; background: transparent; color: #475569;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
`;
