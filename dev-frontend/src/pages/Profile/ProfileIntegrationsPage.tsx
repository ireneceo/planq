// /profile/integrations — 개인 외부 연동 (Phase 1, 2026-05-26)
//
// 본인 단위 (owner_scope='user') external_connections 관리.
// 워크스페이스 설정 (admin only, /business/settings/integrations) 과 명확 분리.
//
// Phase 1 — read/list + 옛 OAuth 연결 (Google 로그인) display.
// Phase 2~: 개인 Google Calendar / Gmail / Drive 직접 등록 (옛 OAuth 인프라 재사용 + owner_scope='user')
import React, { useEffect, useState, useCallback } from 'react';
import { startAuthRedirect, startAuthPopup } from '../../services/oauth';
import { isNativeApp } from '../../services/native';
import styled from 'styled-components';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';

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

// 개인 메일 (EmailAccount owner_user_id=me) — 외부 연동 Phase 3
interface PersonalMailRow {
  id: number;
  email: string;
  display_name: string | null;
  auth_type: string;
  is_active: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
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
  const navigate = useNavigate();
  const { formatDate, formatDateTime } = useTimeFormat();
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  const [personalConns, setPersonalConns] = useState<ExternalConnection[]>([]);
  const [oauthConns, setOauthConns] = useState<OauthConnectionRow[]>([]);
  const [personalMail, setPersonalMail] = useState<PersonalMailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2, r3] = await Promise.all([
        apiFetch(`/api/me/external-connections${businessId ? `?business_id=${businessId}` : ''}`).then(r => r.json()),
        apiFetch('/api/auth/oauth-connections').then(r => r.json()),
        businessId ? apiFetch(`/api/me/email-accounts?business_id=${businessId}`).then(r => r.json()) : Promise.resolve({ success: false }),
      ]);
      if (r1.success) setPersonalConns(r1.data);
      if (r2.success) setOauthConns(r2.data);
      if (r3.success) setPersonalMail(r3.data);
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
      // Google OAuth redirect — 웹은 같은 탭, 네이티브는 시스템 브라우저(§6.8). callback 완료 시 복귀.
      startAuthRedirect(j.data.auth_url);
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
        // #125a — 네이티브면 콜백이 HTML(창 멈춤) 대신 앱 딥링크로 복귀하도록 서버에 알린다
        body: JSON.stringify({ provider, business_id: businessId, client: isNativeApp() ? 'native' : 'web' }),
      });
      const j = await r.json();
      if (!j.success || !j.data?.auth_url) {
        setErrorMsg(j.message || (t('integrations.connectFailed2', { defaultValue: '연결 시작에 실패했어요' }) as string));
        setConnProvider(null);
        return;
      }
      // 웹: 팝업 + postMessage. 네이티브: 시스템 브라우저 → 완료는 planq:oauth-connected 이벤트로(§6.8).
      const popup = await startAuthPopup(j.data.auth_url, 'planq-personal-oauth', 'width=520,height=660');
      if (!isNativeApp() && !popup) {
        setErrorMsg(t('integrations.popupBlocked', { defaultValue: '팝업이 차단되었어요. 브라우저에서 팝업을 허용해 주세요.' }) as string);
        setConnProvider(null);
      }
    } catch (e) {
      setErrorMsg((e as Error).message);
      setConnProvider(null);
    }
  }, [businessId, connProvider, t]);

  // popup 콜백 완료 → postMessage(웹) 또는 planq:oauth-connected(네이티브 딥링크 복귀) 수신 시 목록 갱신
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data && e.data.type === 'personal:connected') {
        setConnProvider(null);
        if (e.data.ok) load();
        else setErrorMsg(t('integrations.connectFailed2', { defaultValue: '연결에 실패했어요. 다시 시도해 주세요.' }) as string);
      }
    };
    // 네이티브: 시스템 브라우저 OAuth 완료 후 앱 복귀(App.tsx appUrlOpen) 시 발행되는 이벤트.
    const onNativeDone = () => { setConnProvider(null); load(); };
    // 시스템 브라우저가 닫힘(성공/취소 공통) — 연결 중 스피너 해제 (L-4).
    const onDismiss = () => setConnProvider(null);
    window.addEventListener('message', onMsg);
    window.addEventListener('planq:oauth-connected', onNativeDone);
    window.addEventListener('planq:oauth-dismissed', onDismiss);
    return () => {
      window.removeEventListener('message', onMsg);
      window.removeEventListener('planq:oauth-connected', onNativeDone);
      window.removeEventListener('planq:oauth-dismissed', onDismiss);
    };
  }, [load, t]);

  const onDisconnectPersonal = async (id: number | string) => {
    if (typeof id === 'string') return;  // legacy 표시 row
    try {
      await apiFetch(`/api/me/external-connections/${id}`, { method: 'DELETE' });
      await load();
    } catch (_) { /* skip */ }
  };

  // 개인 메일 추가·재연결·해제는 "내 메일 계정"(EmailAccountSettings scope=personal) 단일 화면에서
  //   처리 — 여기(내 외부 연동)는 읽기전용 요약 + 관리 링크만. (중복 관리 표면 제거)

  return (
    <PageShell title={t('integrations.title', '내 외부 연동') as string}>
      {/* 운영 #53 — 개인 vs 팀 연동 정의를 명확히 (사용자 "헷갈려: 개인만? 모두 연동 후 개인뷰?") */}
      <IntroCard>
        <IntroLine>
          <IntroDot $tone="personal" />
          <span>{t('integrations.defPersonal', { defaultValue: '여기서 연결하는 건 나만 보는 내 개인 계정이에요. 같은 워크스페이스 동료에게는 보이지 않아요. (예: 개인 Gmail 을 연결하면 그 메일은 Q Mail 에서 나에게만, 회사 메일과 분리 표시)' }) as string}</span>
        </IntroLine>
        <IntroLine>
          <IntroDot $tone="team" />
          <span>{t('integrations.defTeam', { defaultValue: '회사가 함께 쓰는 공용 연동(회사 Google Drive·공용 캘린더·대표 메일)은 모든 멤버가 공유하며, 아래 회사 설정에서 관리해요.' }) as string}</span>
        </IntroLine>
      </IntroCard>
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
                  <ConnMeta>{t('integrations.connectedAt', '연결: {{date}}', { date: formatDate(c.connected_at) }) as string}</ConnMeta>
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

      {/* ─── 개인 메일 (읽기전용 요약 + 관리 링크. 추가/편집/해제는 "내 메일 계정" 화면에서 —
             Gmail·네이버·다음·회사메일 등 아무 메일이나 앱 비밀번호로 연결 가능) ─── */}
      <Section>
        <SectionTitle>{t('integrations.mail', '메일') as string}</SectionTitle>
        <SectionSub>{t('integrations.mailSub2', { defaultValue: 'Gmail·네이버·다음·회사 메일 등 아무 메일이나 연결해 Q Mail 인박스에서 받을 수 있어요 (본인만 보임). 추가·재연결은 "내 메일 계정"에서 해요.' }) as string}</SectionSub>
        {personalMail.length === 0 ? (
          <Empty>
            <span>{t('integrations.mailEmpty', '연결된 개인 메일이 없어요') as string}</span>
            <MailManageLink to="/business/settings/mail-accounts?scope=personal">
              {t('integrations.manageMail', { defaultValue: '메일 계정 연결' }) as string} →
            </MailManageLink>
          </Empty>
        ) : (
          <ConnList>
            {personalMail.map(m => (
              <ConnRow key={m.id}>
                <ConnIcon>✉️</ConnIcon>
                <ConnInfo>
                  <ConnTitle>{m.auth_type === 'google_oauth' ? 'Gmail' : (m.email?.split('@')[1] || t('integrations.mailAccount', { defaultValue: '메일 계정' }) as string)}</ConnTitle>
                  <ConnSub>{m.email}</ConnSub>
                  {m.last_sync_error
                    ? <ConnMeta style={{ color: '#B91C1C' }}>{t('integrations.mailSyncError', { defaultValue: '동기화 오류 — 재연결이 필요할 수 있어요' }) as string}</ConnMeta>
                    : m.last_sync_at && <ConnMeta>{t('integrations.lastSync', { defaultValue: '최근 동기화: {{date}}', date: formatDateTime(m.last_sync_at) }) as string}</ConnMeta>}
                </ConnInfo>
              </ConnRow>
            ))}
            <MailManageLink to="/business/settings/mail-accounts?scope=personal">
              {t('integrations.manageMailMore', { defaultValue: '메일 계정 관리 · 추가' }) as string} →
            </MailManageLink>
          </ConnList>
        )}
      </Section>

      {/* ─── 개인 Drive (옵션) ─── */}
      <Section>
        <SectionTitle>{t('integrations.drive', '파일') as string}</SectionTitle>
        <SectionSub>{t('integrations.driveSub', 'PlanQ 파일을 내 개인 Google Drive 에 저장하고 여기서 함께 봐요 (회사 Drive 와 분리)') as string}</SectionSub>
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
        <DividerBtn type="button" onClick={() => navigate('/business/settings/mail-accounts')}>
          {t('integrations.gotoWorkspace', '회사 설정으로') as string} →
        </DividerBtn>
      </DividerBox>

      {loading && <Loading>{t('integrations.loading', '로드 중...') as string}</Loading>}
    </PageShell>
  );
};

export default ProfileIntegrationsPage;

// ─── styled ────────────────────────────────────
// 운영 #53 — 개인 vs 팀 연동 정의 카드
const IntroCard = styled.div`
  display: flex; flex-direction: column; gap: 10px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 14px 16px; margin: 0 0 20px;
`;
const IntroLine = styled.div`
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 13px; color: #334155; line-height: 1.55;
`;
const IntroDot = styled.span<{ $tone: 'personal' | 'team' }>`
  flex-shrink: 0; width: 8px; height: 8px; border-radius: 50%; margin-top: 6px;
  background: ${p => p.$tone === 'personal' ? '#14B8A6' : '#94A3B8'};
`;
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
const MailManageLink = styled(Link)`
  display: inline-flex; align-items: center; gap: 4px;
  height: 34px; padding: 0 14px;
  background: #14B8A6; color: #FFFFFF;
  border-radius: 8px; font-size: 13px; font-weight: 600;
  text-decoration: none; white-space: nowrap; align-self: flex-start;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const Loading = styled.div`padding: 40px; text-align: center; color: #94A3B8;`;
