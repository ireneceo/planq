// /profile/integrations — 개인 외부 연동 (Phase 1, 2026-05-26)
//
// 본인 단위 (owner_scope='user') external_connections 관리.
// 워크스페이스 설정 (admin only, /business/settings/integrations) 과 명확 분리.
//
// Phase 1 — read/list + 옛 OAuth 연결 (Google 로그인) display.
// Phase 2~: 개인 Google Calendar / Gmail / Drive 직접 등록 (옛 OAuth 인프라 재사용 + owner_scope='user')
import React, { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import { useAuth, apiFetch } from '../../contexts/AuthContext';

interface ExternalConnection {
  id: number | string;
  owner_scope: 'workspace' | 'user';
  business_id: number;
  user_id: number | null;
  provider: string;
  auth_type: string;
  account_email: string;
  account_name: string | null;
  is_active: boolean;
  is_default: boolean;
  last_sync_at: string | null;
  created_at: string;
}

interface OauthConnectionRow {
  id: number;
  provider: 'google' | 'microsoft';
  email: string;
  display_name: string | null;
  picture: string | null;
  connected_at: string;
  last_used_at: string | null;
}

const PROVIDER_LABEL: Record<string, string> = {
  google_calendar: 'Google Calendar',
  google_drive: 'Google Drive',
  gmail: 'Gmail',
  microsoft_calendar: 'Microsoft Calendar',
  microsoft_drive: 'Microsoft OneDrive',
  outlook: 'Outlook Mail',
  apple_calendar: 'Apple Calendar',
};

const PROVIDER_ICON: Record<string, string> = {
  google_calendar: '📅',
  google_drive: '📁',
  gmail: '✉️',
  microsoft_calendar: '📅',
  microsoft_drive: '📁',
  outlook: '✉️',
  apple_calendar: '📅',
};

// Google 4색 G 로고 (브랜드 가이드라인) — 연결 버튼 공통
const GoogleIcon: React.FC = () => (
  <GoogleG viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
  </GoogleG>
);

const ProfileIntegrationsPage: React.FC = () => {
  const { t } = useTranslation('profile');
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  const [personalConns, setPersonalConns] = useState<ExternalConnection[]>([]);
  const [oauthConns, setOauthConns] = useState<OauthConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        apiFetch(`/api/me/external-connections${businessId ? `?business_id=${businessId}` : ''}`).then(r => r.json()),
        apiFetch('/api/auth/oauth-connections').then(r => r.json()),
      ]);
      if (r1.success) setPersonalConns(r1.data);
      if (r2.success) setOauthConns(r2.data);
    } catch (_) { /* skip */ } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const onDisconnectOauth = async (id: number) => {
    setErrorMsg(null);
    try {
      const r = await apiFetch(`/api/auth/oauth-connections/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.success) {
        // backend 의 lockout 방어 메시지를 사용자 친화 한글로
        const friendlyMap: Record<string, string> = {
          cannot_remove_last_oauth_method_set_password_first:
            t('integrations.disconnectLockoutWarn', { defaultValue: '비밀번호가 설정되지 않아 마지막 로그인 수단을 해제할 수 없어요. 먼저 프로필에서 비밀번호를 설정해주세요.' }) as string,
        };
        setErrorMsg(friendlyMap[j.message] || j.message || (t('integrations.disconnectFailed', { defaultValue: '해제 실패' }) as string));
        return;
      }
      await load();
    } catch (e) {
      setErrorMsg((e as Error).message);
    }
  };

  // N+75-C — Google 연결 시작 (Settings 에서 신규 추가). backend POST /initiate → auth_url 받아 같은 창 redirect.
  const [connectBusy, setConnectBusy] = useState(false);
  const onConnectGoogle = async () => {
    if (connectBusy) return;
    setConnectBusy(true);
    setErrorMsg(null);
    try {
      const r = await apiFetch('/api/auth/oauth-connections/google/initiate', { method: 'POST' });
      const j = await r.json();
      if (!j.success || !j.data?.auth_url) {
        setErrorMsg(j.message || (t('integrations.connectFailed', { defaultValue: 'Google 연결 시작 실패' }) as string));
        setConnectBusy(false);
        return;
      }
      // Google OAuth redirect — 같은 탭. callback 완료 시 자동으로 PlanQ 로 복귀.
      window.location.href = j.data.auth_url;
    } catch (e) {
      setErrorMsg((e as Error).message);
      setConnectBusy(false);
    }
  };

  // ── 개인 외부 자원 연결 (캘린더 등) — popup OAuth (owner_scope='user') ──
  const [connProvider, setConnProvider] = useState<string | null>(null);
  const connectPersonal = useCallback(async (provider: string) => {
    if (!businessId || connProvider) return;
    setConnProvider(provider);
    setErrorMsg(null);
    try {
      const r = await apiFetch('/api/me/oauth/google/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, business_id: businessId }),
      });
      const j = await r.json();
      if (!j.success || !j.data?.auth_url) {
        setErrorMsg(j.message || (t('integrations.connectFailed2', { defaultValue: '연결 시작에 실패했어요' }) as string));
        setConnProvider(null);
        return;
      }
      const popup = window.open(j.data.auth_url, 'planq-personal-oauth', 'width=520,height=660');
      if (!popup) {
        setErrorMsg(t('integrations.popupBlocked', { defaultValue: '팝업이 차단되었어요. 브라우저에서 팝업을 허용해 주세요.' }) as string);
        setConnProvider(null);
      }
    } catch (e) {
      setErrorMsg((e as Error).message);
      setConnProvider(null);
    }
  }, [businessId, connProvider, t]);

  // popup 콜백 완료 → postMessage 수신 시 목록 갱신
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data && e.data.type === 'personal:connected') {
        setConnProvider(null);
        if (e.data.ok) load();
        else setErrorMsg(t('integrations.connectFailed2', { defaultValue: '연결에 실패했어요. 다시 시도해 주세요.' }) as string);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [load, t]);

  const onDisconnectPersonal = async (id: number | string) => {
    if (typeof id === 'string') return;  // legacy 표시 row
    try {
      await apiFetch(`/api/me/external-connections/${id}`, { method: 'DELETE' });
      await load();
    } catch (_) { /* skip */ }
  };

  return (
    <PageShell title={t('integrations.title', '내 외부 연동') as string}>
      <Hint>
        {t('integrations.hint', '본인 계정에 연결된 외부 서비스예요. 워크스페이스 공용 연동은 회사 설정에서 별도로 관리합니다.') as string}
      </Hint>
      {errorMsg && <ErrorBanner>{errorMsg}</ErrorBanner>}

      {/* ─── 로그인 (OauthConnection) ─── */}
      <Section>
        <SectionTitle>{t('integrations.login', '로그인') as string}</SectionTitle>
        <SectionSub>{t('integrations.loginSub', 'PlanQ 에 로그인할 때 사용하는 외부 계정') as string}</SectionSub>
        {oauthConns.length === 0 ? (
          <Empty>
            <span>{t('integrations.loginEmpty2', { defaultValue: '연결된 로그인 계정이 없어요.' }) as string}</span>
            <ConnectGoogleBtn type="button" onClick={onConnectGoogle} disabled={connectBusy}>
              <GoogleG viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
              </GoogleG>
              {connectBusy
                ? t('integrations.connectingGoogle', { defaultValue: '연결 중…' }) as string
                : t('integrations.connectGoogle', { defaultValue: 'Google 계정 연결' }) as string}
            </ConnectGoogleBtn>
          </Empty>
        ) : (
          <ConnList>
            {oauthConns.map(c => (
              <ConnRow key={`oauth-${c.id}`}>
                <ConnIcon>{c.provider === 'google' ? '🔐' : '🪟'}</ConnIcon>
                <ConnInfo>
                  <ConnTitle>{c.provider === 'google' ? 'Google' : 'Microsoft'}</ConnTitle>
                  <ConnSub>{c.email}{c.display_name && ` · ${c.display_name}`}</ConnSub>
                  <ConnMeta>{t('integrations.connectedAt', '연결: {{date}}', { date: new Date(c.connected_at).toLocaleDateString() }) as string}</ConnMeta>
                </ConnInfo>
                <DangerBtn type="button" onClick={() => onDisconnectOauth(c.id)}>
                  {t('integrations.disconnect', '해제') as string}
                </DangerBtn>
              </ConnRow>
            ))}
            {/* N+75-C — 추가 provider (Microsoft) 안내 + 같은 google 다른 계정 추가는 향후 */}
            {!oauthConns.some(c => c.provider === 'google') && (
              <ConnectGoogleBtn type="button" onClick={onConnectGoogle} disabled={connectBusy}>
                <GoogleG viewBox="0 0 18 18" aria-hidden="true">
                  <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                  <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                  <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
                </GoogleG>
                {connectBusy
                  ? t('integrations.connectingGoogle', { defaultValue: '연결 중…' }) as string
                  : t('integrations.connectGoogle', { defaultValue: 'Google 계정 연결' }) as string}
              </ConnectGoogleBtn>
            )}
          </ConnList>
        )}
      </Section>

      {/* ─── 개인 캘린더 ─── */}
      <Section>
        <SectionTitle>{t('integrations.calendar', '캘린더') as string}</SectionTitle>
        <SectionSub>{t('integrations.calendarSub', '내 캘린더를 Q Calendar 에서 함께 봐요 (워크스페이스 공용과 색깔 분리)') as string}</SectionSub>
        {personalConns.filter(c => ['google_calendar', 'microsoft_calendar', 'apple_calendar'].includes(c.provider)).length === 0 ? (
          <Empty>
            <span>{t('integrations.calendarEmpty', '연결된 개인 캘린더가 없어요') as string}</span>
            <ConnectGoogleBtn type="button" onClick={() => connectPersonal('google_calendar')} disabled={connProvider === 'google_calendar'}>
              <GoogleIcon />
              {connProvider === 'google_calendar'
                ? t('integrations.connecting', { defaultValue: '연결 중…' }) as string
                : t('integrations.connectCalendar', { defaultValue: 'Google Calendar 연결' }) as string}
            </ConnectGoogleBtn>
          </Empty>
        ) : (
          <ConnList>
            {personalConns.filter(c => ['google_calendar', 'microsoft_calendar', 'apple_calendar'].includes(c.provider)).map(c => (
              <ConnRow key={c.id}>
                <ConnIcon>{PROVIDER_ICON[c.provider] || '📅'}</ConnIcon>
                <ConnInfo>
                  <ConnTitle>{PROVIDER_LABEL[c.provider]}</ConnTitle>
                  <ConnSub>{c.account_email}</ConnSub>
                </ConnInfo>
                <DangerBtn type="button" onClick={() => onDisconnectPersonal(c.id)}>{t('integrations.disconnect', '해제') as string}</DangerBtn>
              </ConnRow>
            ))}
          </ConnList>
        )}
      </Section>

      {/* ─── 개인 메일 ─── */}
      <Section>
        <SectionTitle>{t('integrations.mail', '메일 (개인)') as string}</SectionTitle>
        <SectionSub>{t('integrations.mailSub', '개인 메일도 Q Mail 인박스에서 받을 수 있어요 (회사 공용과 분리 표시)') as string}</SectionSub>
        {personalConns.filter(c => ['gmail', 'outlook'].includes(c.provider)).length === 0 ? (
          <Empty>
            <span>{t('integrations.mailEmpty', '연결된 개인 메일이 없어요') as string}</span>
            <ComingSoonNote>{t('integrations.mailSoon', '🚧 Phase 3 — 다음 사이클에서 등록 가능') as string}</ComingSoonNote>
          </Empty>
        ) : (
          <ConnList>
            {personalConns.filter(c => ['gmail', 'outlook'].includes(c.provider)).map(c => (
              <ConnRow key={c.id}>
                <ConnIcon>{PROVIDER_ICON[c.provider] || '✉️'}</ConnIcon>
                <ConnInfo>
                  <ConnTitle>{PROVIDER_LABEL[c.provider]}</ConnTitle>
                  <ConnSub>{c.account_email}</ConnSub>
                </ConnInfo>
                <DangerBtn type="button" onClick={() => onDisconnectPersonal(c.id)}>{t('integrations.disconnect', '해제') as string}</DangerBtn>
              </ConnRow>
            ))}
          </ConnList>
        )}
      </Section>

      {/* ─── 개인 Drive (옵션) ─── */}
      <Section>
        <SectionTitle>{t('integrations.drive', '파일 (개인)') as string}</SectionTitle>
        <SectionSub>{t('integrations.driveSub', '내 Drive 의 개인 파일을 PlanQ 에서 끌어와 봐요') as string}</SectionSub>
        {personalConns.filter(c => c.provider === 'google_drive').length === 0 ? (
          <Empty>
            <span>{t('integrations.driveEmpty', '연결된 개인 파일 저장소가 없어요') as string}</span>
            <ConnectGoogleBtn type="button" onClick={() => connectPersonal('google_drive')} disabled={connProvider === 'google_drive'}>
              <GoogleIcon />
              {connProvider === 'google_drive'
                ? t('integrations.connecting', { defaultValue: '연결 중…' }) as string
                : t('integrations.connectDrive', { defaultValue: 'Google Drive 연결' }) as string}
            </ConnectGoogleBtn>
          </Empty>
        ) : (
          <ConnList>
            {personalConns.filter(c => c.provider === 'google_drive').map(c => (
              <ConnRow key={c.id}>
                <ConnIcon>{PROVIDER_ICON[c.provider] || '📁'}</ConnIcon>
                <ConnInfo>
                  <ConnTitle>{PROVIDER_LABEL[c.provider]}</ConnTitle>
                  <ConnSub>{c.account_email}</ConnSub>
                </ConnInfo>
                <DangerBtn type="button" onClick={() => onDisconnectPersonal(c.id)}>{t('integrations.disconnect', '해제') as string}</DangerBtn>
              </ConnRow>
            ))}
          </ConnList>
        )}
      </Section>

      <DividerBox>
        <DividerText>{t('integrations.workspaceLink', '회사 공용 외부 연동 (Google Drive · 회사 메일 등) 은 회사 설정에서 관리해요') as string}</DividerText>
        <DividerBtn type="button" onClick={() => { window.location.href = '/business/settings/mail-accounts'; }}>
          {t('integrations.gotoWorkspace', '회사 설정으로') as string} →
        </DividerBtn>
      </DividerBox>

      {loading && <Loading>{t('integrations.loading', '로드 중...') as string}</Loading>}
    </PageShell>
  );
};

export default ProfileIntegrationsPage;

// ─── styled ────────────────────────────────────
const Hint = styled.p`font-size: 13px; color: #64748B; line-height: 1.6; margin: 0 0 20px;`;
const ErrorBanner = styled.div`
  padding: 10px 14px; margin-bottom: 16px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px;
  color: #B91C1C; font-size: 13px;
`;
const Section = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 20px; margin-bottom: 16px;
`;
const SectionTitle = styled.h3`margin: 0 0 4px; font-size: 15px; font-weight: 700; color: #0F172A;`;
const SectionSub = styled.p`margin: 0 0 14px; font-size: 12px; color: #64748B; line-height: 1.5;`;
const Empty = styled.div`
  padding: 24px 12px; text-align: center; color: #94A3B8;
  background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 8px;
  display: flex; flex-direction: column; gap: 6px;
  font-size: 13px;
`;
const ComingSoonNote = styled.div`font-size: 11px; color: #F59E0B; font-weight: 600;`;
const ConnList = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const ConnRow = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
`;
const ConnIcon = styled.div`font-size: 24px;`;
const ConnInfo = styled.div`flex: 1; display: flex; flex-direction: column; gap: 2px;`;
const ConnTitle = styled.div`font-size: 13px; font-weight: 700; color: #0F172A;`;
const ConnSub = styled.div`font-size: 12px; color: #475569;`;
const ConnMeta = styled.div`font-size: 11px; color: #94A3B8;`;
const DangerBtn = styled.button`
  height: 30px; padding: 0 12px;
  background: transparent; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 6px;
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  &:hover { background: #FEF2F2; border-color: #FCA5A5; color: #991B1B; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
// N+75-C — Google 연결 버튼 (Empty / ConnList 둘 다 사용). Google 브랜드 가이드라인 정합.
const ConnectGoogleBtn = styled.button`
  display: inline-flex; align-items: center; gap: 10px;
  height: 40px; padding: 0 16px;
  background: #FFFFFF; color: #1F1F1F;
  border: 1px solid #DADCE0; border-radius: 8px;
  font-size: 14px; font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, box-shadow 0.12s;
  &:hover:not(:disabled) {
    background: #F8FAFC; border-color: #CBD5E1;
    box-shadow: 0 1px 2px rgba(0,0,0,0.06);
  }
  &:disabled { opacity: 0.6; cursor: wait; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const GoogleG = styled.svg`
  width: 16px; height: 16px;
  flex-shrink: 0;
`;
const DividerBox = styled.div`
  margin-top: 24px; padding: 16px 18px;
  background: #F0FDFA; border: 1px solid #5EEAD4; border-radius: 10px;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  @media (max-width: 640px) { flex-direction: column; align-items: stretch; }
`;
const DividerText = styled.div`font-size: 12px; color: #0F766E; line-height: 1.5;`;
const DividerBtn = styled.button`
  height: 32px; padding: 0 14px;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px;
  font-size: 12px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const Loading = styled.div`padding: 40px; text-align: center; color: #94A3B8;`;
