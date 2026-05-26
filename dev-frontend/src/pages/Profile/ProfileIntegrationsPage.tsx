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
        setErrorMsg(j.message || (t('integrations.disconnectFailed', { defaultValue: '해제 실패' }) as string));
        return;
      }
      await load();
    } catch (e) {
      setErrorMsg((e as Error).message);
    }
  };

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
            {t('integrations.loginEmpty', '연결된 로그인 계정이 없어요. 로그아웃 후 "Google 로 계속" 으로 연결할 수 있어요.') as string}
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
            <ComingSoonNote>{t('integrations.calendarSoon', '🚧 Phase 2 — 다음 사이클에서 등록 가능') as string}</ComingSoonNote>
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
        <Empty>
          <span>{t('integrations.driveEmpty', '연결된 개인 파일 저장소가 없어요') as string}</span>
          <ComingSoonNote>{t('integrations.driveSoon', '🚧 Phase 4 — 다음 사이클에서 등록 가능') as string}</ComingSoonNote>
        </Empty>
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
