// «시작하기» /welcome — 워크스페이스 0개 계정의 착지 · 두 번째 워크스페이스 만들기 (2026-11-06)
//   설계 docs/SIGNUP_START_JOIN_DESIGN.md §3 (Fable DESIGN-READY). Irene: *"우린 무료가 아닌데 모르는 새 그냥 만들어지면
//   안되잖아. 워크스페이스를 만들건지 다른 초대에 대응할건지 다른 워크스페이스 초대받은 걸 표시해야지."*
//   (a) 나에게 온 초대(이메일 인증 뒤에만) → (b) 우리 회사 워크스페이스에 참여 신청(도메인 추천·참여 코드) → (c) 새로 만들기(«14일 무료 체험» 문장을 읽고 누름).
//   들어가기·만들기 뒤에는 문서 이동 — 모드 판정(탭 셸 진입)이 워크스페이스 수를 다시 보게 한다.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import TrialPlanPicker, { DEFAULT_TRIAL_PLAN, parseTrialPlan, type TrialPlanCode } from '../../components/Auth/TrialPlanPicker';
import { formatDay } from '../../utils/dateFormat';
import { onSocket } from '../../services/socket';
import {
  getJoinSuggestions, lookupJoinCode, requestJoin, getMyJoinRequests, cancelJoinRequest, JoinApiError,
  type JoinWorkspaceCard,
} from '../../services/join';

interface InviteRow {
  type: 'workspace_member' | 'workspace_client' | 'project_client';
  id: number;
  business_id: number;
  workspace_name: string | null;
  workspace_logo_url: string | null;
  inviter_name: string | null;
  invited_at: string | null;
  expires_at: string;
  expired: boolean;
  role: 'member' | 'admin' | 'client';
  project_name?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const WelcomePage: React.FC = () => {
  const { t } = useTranslation('welcome');
  const { user, logout } = useAuth();
  const location = useLocation();
  const qs = new URLSearchParams(location.search);
  const fromSwitcher = qs.get('from') === 'switcher';
  const hasWorkspace = (user?.workspaces || []).length > 0;
  const verified = !!user?.email_verified_at;

  // (a) 받은 초대
  const [invites, setInvites] = useState<InviteRow[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [rowState, setRowState] = useState<Record<string, { busy?: boolean; err?: string }>>({});
  const loadInvites = useCallback(async () => {
    try {
      const r = await apiFetch('/api/me/invites');
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error('load');
      setInvites(j.data?.invites || []);
      setLoadErr(false);
    } catch { setLoadErr(true); }
  }, []);
  useEffect(() => { if (verified) void loadInvites(); }, [verified, loadInvites]);
  // 다시 보기 — 탭 복귀·초대 알림 도착(다른 창에서 초대가 오거나 수락된 경우)
  useEffect(() => {
    if (!verified) return;
    const onVis = () => { if (document.visibilityState === 'visible') void loadInvites(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    const off = onSocket<{ event_kind?: string }>('notification:new', (n) => { if (!n || n.event_kind === 'invite') void loadInvites(); });
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); off(); };
  }, [verified, loadInvites]);

  const enter = async (row: InviteRow) => {
    const k = `${row.type}:${row.id}`;
    setRowState((s) => ({ ...s, [k]: { busy: true } }));
    try {
      const r = await apiFetch(`/api/me/invites/${row.type}/${row.id}/accept`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (r.status === 422) {
        setRowState((s) => ({ ...s, [k]: { err: t('invites.quota', { workspace: row.workspace_name || '' }) as string } }));
        return;
      }
      if (r.status === 410) { void loadInvites(); setRowState((s) => ({ ...s, [k]: {} })); return; }
      if (!r.ok || !j?.success) throw new Error('accept');
      const to = typeof j.data?.redirect === 'string' && j.data.redirect.startsWith('/') ? j.data.redirect : '/dashboard';
      window.location.assign(to);
    } catch {
      setRowState((s) => ({ ...s, [k]: { err: t('invites.failed') as string } }));
    }
  };

  // 인증 메일 다시 보내기
  const [verifyMsg, setVerifyMsg] = useState<string>('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const resend = async () => {
    setVerifyBusy(true);
    try {
      const r = await apiFetch('/api/auth/resend-verify-email', { method: 'POST' });
      setVerifyMsg(r.status === 429 ? t('verify.tooMany') as string : r.ok ? t('verify.sent') as string : t('verify.failed') as string);
    } catch { setVerifyMsg(t('verify.failed') as string); }
    finally { setVerifyBusy(false); }
  };

  // (b) 참여 신청 — 회사 메일 도메인 추천 · 참여 코드 · 내가 보낸 신청
  const [sugg, setSugg] = useState<{ domains: string[]; workspaces: JoinWorkspaceCard[] } | null>(null);
  const [mine, setMine] = useState<JoinWorkspaceCard[]>([]);
  const [code, setCode] = useState('');
  const [found, setFound] = useState<JoinWorkspaceCard | null>(null);
  const [joinMsg, setJoinMsg] = useState('');
  const [joinBusy, setJoinBusy] = useState<number | null>(null);
  const loadJoin = useCallback(async () => {
    try { setSugg(await getJoinSuggestions()); } catch { setSugg({ domains: [], workspaces: [] }); }
    try { setMine(await getMyJoinRequests()); } catch { setMine([]); }
  }, []);
  useEffect(() => { if (verified) void loadJoin(); }, [verified, loadJoin]);
  useEffect(() => {
    if (!verified) return undefined;
    // 승인·거절 신호 — 승인이면 들어간다(다른 화면에서 고른 것이 아니면)
    const off = onSocket<{ status?: string }>('join_request:decided', (p) => {
      if (p?.status === 'approved' && !fromSwitcher) { window.location.assign('/dashboard'); return; }
      void loadJoin(); setFound(null);
    });
    const onVis = () => { if (document.visibilityState === 'visible') void loadJoin(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { off(); document.removeEventListener('visibilitychange', onVis); };
  }, [verified, fromSwitcher, loadJoin]);
  const findCode = async () => {
    setJoinMsg(''); setFound(null);
    if (!code.trim()) return;
    try { setFound(await lookupJoinCode(code.trim())); }
    catch (e) { setJoinMsg((e instanceof JoinApiError && e.status === 429 ? t('join.tooMany') : t('join.codeNotFound')) as string); }
  };
  const sendJoin = async (w: JoinWorkspaceCard, source: 'domain' | 'code') => {
    setJoinBusy(w.business_id); setJoinMsg('');
    try {
      await requestJoin({ business_id: w.business_id, source, ...(source === 'code' ? { code: code.trim() } : {}) });
      if (source === 'code') { try { setFound(await lookupJoinCode(code.trim())); } catch { setFound(null); } }
      await loadJoin();
    } catch (e) {
      setJoinMsg((e instanceof JoinApiError && e.status === 429 ? t('join.tooMany') : t('join.failed')) as string);
      await loadJoin();
    } finally { setJoinBusy(null); }
  };
  const cancelJoin = async (id: number) => {
    setJoinMsg('');
    try { await cancelJoinRequest(id); } catch { /* 다시 읽으면 상태가 보인다 */ }
    if (found) { try { setFound(await lookupJoinCode(code.trim())); } catch { setFound(null); } }
    await loadJoin();
  };
  const reqStatusText = (w: JoinWorkspaceCard): string | null => {
    const r = w.request;
    if (w.already_member) return t('join.alreadyMember') as string;
    if (!r) return null;
    if (r.status === 'pending') return t('join.pending') as string;
    if (r.status === 'approved') return t('join.approved') as string;
    if (r.status === 'expired') return t('join.expired') as string;
    if (r.status === 'rejected') return (r.retry_after ? t('join.rejected', { date: formatDay(r.retry_after) }) : t('join.rejectedNow')) as string;
    return null;
  };
  const canRequest = (w: JoinWorkspaceCard) => !w.already_member && (!w.request || w.request.status === 'expired' || w.request.status === 'canceled' || (w.request.status === 'rejected' && !w.request.retry_after));
  const renderJoinRow = (w: JoinWorkspaceCard, source: 'domain' | 'code') => (
    <InviteItem key={`${source}:${w.business_id}`} $expired={false} data-testid="welcome-join-row">
      <InviteMain>
        <InviteName>{w.brand_name}</InviteName>
        {reqStatusText(w) && <InviteMeta><span>{reqStatusText(w)}</span></InviteMeta>}
        {w.request?.status === 'rejected' && w.request.decision_note && <InviteMeta><span>{t('join.note', { note: w.request.decision_note })}</span></InviteMeta>}
      </InviteMain>
      {w.request?.status === 'pending' && (
        <SecondaryBtn type="button" onClick={() => { void cancelJoin(w.request!.id); }} data-testid="welcome-join-cancel">{t('join.cancel')}</SecondaryBtn>
      )}
      {canRequest(w) && (
        <PrimaryBtn type="button" disabled={joinBusy === w.business_id} onClick={() => { void sendJoin(w, source); }} data-testid="welcome-join-request">
          {t('join.request')}
        </PrimaryBtn>
      )}
    </InviteItem>
  );
  // 내가 보낸 신청 중 추천·코드 결과에 안 보이는 것(예: 코드로 신청한 곳)
  const shownIds = new Set([...(sugg?.workspaces || []).map((w) => w.business_id), ...(found ? [found.business_id] : [])]);
  const otherMine = mine.filter((w) => !shownIds.has(w.business_id));

  // (c) 새로 만들기
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<TrialPlanCode>(() => parseTrialPlan(qs.get('plan')) || DEFAULT_TRIAL_PLAN);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const create = async () => {
    if (creating) return;
    if (!name.trim()) { setCreateErr(t('create.nameRequired') as string); return; }
    setCreating(true); setCreateErr('');
    try {
      const lang = (user?.language === 'en') ? 'en' : 'ko';
      const r = await apiFetch('/api/businesses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_name: name.trim(), plan_code: plan, default_language: lang }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) throw new Error(j?.message || 'create');
      window.location.assign('/dashboard');
    } catch {
      setCreateErr(t('create.failed') as string);
      setCreating(false);
    }
  };

  const roleText = (r: InviteRow) => r.role === 'admin' ? t('invites.roleAdmin') : r.role === 'client' ? t('invites.roleClient') : t('invites.roleMember');
  const daysLeft = (r: InviteRow) => Math.max(0, Math.ceil((new Date(r.expires_at).getTime() - Date.now()) / DAY_MS));

  return (
    <Page data-testid="welcome-page">
      <TopBar>
        <Brand>Plan<span>Q</span></Brand>
        <TopActions>
          {fromSwitcher && hasWorkspace && <TopLink href="/dashboard">{t('back')}</TopLink>}
          <TopBtn type="button" onClick={() => { void logout(); }}>{t('logout')}</TopBtn>
        </TopActions>
      </TopBar>
      <Main>
        <Title>{t('title')}</Title>
        <Sub>{t('subtitle', { name: user?.name || '' })}</Sub>

        {!verified && (
          <VerifyBanner data-testid="welcome-verify">
            <span>{t('verify.banner', { email: user?.email || '' })}</span>
            <VerifyActions>
              <SecondaryBtn type="button" disabled={verifyBusy} onClick={() => { void resend(); }} data-testid="welcome-resend">
                {t('verify.resend')}
              </SecondaryBtn>
              {verifyMsg && <Hint>{verifyMsg}</Hint>}
            </VerifyActions>
          </VerifyBanner>
        )}

        {verified && (
          <Card data-testid="welcome-invites">
            <CardTitle>{t('invites.title')}</CardTitle>
            {loadErr && <ErrText>{t('invites.loadFailed')}</ErrText>}
            {!loadErr && invites && invites.length === 0 && <Empty>{t('invites.empty')}</Empty>}
            {(invites || []).map((r) => {
              const k = `${r.type}:${r.id}`;
              const st = rowState[k] || {};
              return (
                <InviteItem key={k} $expired={r.expired} data-testid="welcome-invite-row">
                  <InviteMain>
                    <InviteName>{r.workspace_name}</InviteName>
                    <InviteMeta>
                      <RoleChip>{roleText(r)}</RoleChip>
                      {r.project_name && <span>{t('invites.project', { name: r.project_name })}</span>}
                      {r.inviter_name && <span>{t('invites.by', { name: r.inviter_name })}</span>}
                      {r.invited_at && <span>{formatDay(r.invited_at)}</span>}
                      {r.expired ? <span>{t('invites.expired')}</span> : <span>{t('invites.daysLeft', { n: daysLeft(r) })}</span>}
                    </InviteMeta>
                    {st.err && <ErrText>{st.err}</ErrText>}
                  </InviteMain>
                  {!r.expired && (
                    <PrimaryBtn type="button" disabled={!!st.busy} onClick={() => { void enter(r); }} data-testid="welcome-invite-enter">
                      {t('invites.enter')}
                    </PrimaryBtn>
                  )}
                </InviteItem>
              );
            })}
          </Card>
        )}

        <Card data-testid="welcome-join">
          <CardTitle>{t('join.title')}</CardTitle>
          {!verified && <Empty>{t('join.needVerify')}</Empty>}
          {verified && sugg && (
            <>
              {sugg.domains.length > 0 && <Hint>{t('join.domainHint', { domain: sugg.domains.join(', @') })}</Hint>}
              {sugg.workspaces.length === 0 && sugg.domains.length > 0 && <Empty>{t('join.noDomain')}</Empty>}
              {sugg.workspaces.map((w) => renderJoinRow(w, 'domain'))}
            </>
          )}
          {verified && otherMine.length > 0 && (
            <>
              <Hint>{t('join.myRequests')}</Hint>
              {otherMine.map((w) => renderJoinRow(w, 'code'))}
            </>
          )}
          {verified && (
            <>
              <Hint>{t('join.codeLabel')}</Hint>
              <CodeRow>
                <NameInput
                  value={code}
                  maxLength={12}
                  placeholder={t('join.codePlaceholder') as string}
                  onChange={(e) => { setCode(e.target.value); setJoinMsg(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void findCode(); } }}
                  data-testid="welcome-join-code"
                  autoCapitalize="characters"
                  autoComplete="off"
                />
                <SecondaryBtn type="button" onClick={() => { void findCode(); }} data-testid="welcome-join-find">{t('join.codeFind')}</SecondaryBtn>
              </CodeRow>
              {found && renderJoinRow(found, 'code')}
            </>
          )}
          {joinMsg && <ErrText>{joinMsg}</ErrText>}
        </Card>

        <Card data-testid="welcome-create">
          <CardTitle>{t('create.title')}</CardTitle>
          <NameInput
            value={name}
            maxLength={60}
            placeholder={t('create.namePlaceholder') as string}
            onChange={(e) => { setName(e.target.value); setCreateErr(''); }}
            data-testid="welcome-create-name"
            autoComplete="organization"
          />
          <PickerGap><TrialPlanPicker value={plan} onChange={setPlan} disabled={creating} /></PickerGap>
          <Notice data-testid="welcome-trial-notice">{t('create.trialNotice')}</Notice>
          {createErr && <ErrText>{createErr}</ErrText>}
          <CreateRow>
            <PrimaryBtn type="button" disabled={creating} onClick={() => { void create(); }} data-testid="welcome-create-submit">
              {creating ? t('create.submitting') : t('create.submit')}
            </PrimaryBtn>
          </CreateRow>
        </Card>
      </Main>
    </Page>
  );
};

export default WelcomePage;

const Page = styled.div`
  min-height: 100vh; background: #F8FAFC;
  padding-top: var(--pq-safe-top, 0px);
`;
const TopBar = styled.div`
  height: 60px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0;
`;
const Brand = styled.div`
  font-size: 1.25rem; font-weight: 800; color: #0F172A; letter-spacing: -0.3px;
  span { color: #14B8A6; }
`;
const TopActions = styled.div`display: flex; align-items: center; gap: 8px;`;
const TopLink = styled.a`
  font-size: 0.8125rem; font-weight: 600; color: #475569; text-decoration: none;
  padding: 8px 10px; border-radius: 8px; min-height: 36px; display: inline-flex; align-items: center;
  &:hover { background: #F1F5F9; }
`;
const TopBtn = styled.button`
  font-size: 0.8125rem; font-weight: 600; color: #475569; background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 8px; padding: 0 12px; min-height: 36px; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
const Main = styled.main`
  max-width: 560px; margin: 0 auto; padding: 28px 16px calc(96px + var(--pq-safe-bottom, 0px));  /* 우하단 Q helper 단추가 마지막 버튼을 덮지 않게 */
  display: flex; flex-direction: column; gap: 16px;
`;
const Title = styled.h1`font-size: 1.375rem; font-weight: 800; color: #0F172A; margin: 0;`;
const Sub = styled.p`font-size: 0.875rem; color: #475569; margin: -8px 0 4px;`;
const Card = styled.section`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px; padding: 18px;
  display: flex; flex-direction: column; gap: 10px;
`;
const CardTitle = styled.h2`font-size: 1rem; font-weight: 700; color: #0F172A; margin: 0 0 2px;`;
const VerifyBanner = styled.div`
  background: #FFF7ED; border: 1px solid #FED7AA; border-radius: 12px; padding: 14px 16px;
  font-size: 0.8125rem; color: #9A3412; display: flex; flex-direction: column; gap: 10px;
`;
const VerifyActions = styled.div`display: flex; align-items: center; gap: 10px; flex-wrap: wrap;`;
const Hint = styled.span`font-size: 0.75rem; color: #64748B;`;
const Empty = styled.div`font-size: 0.8125rem; color: #94A3B8; padding: 6px 0;`;
const ErrText = styled.div`font-size: 0.75rem; color: #DC2626;`;
const InviteItem = styled.div<{ $expired: boolean }>`
  display: flex; align-items: center; gap: 12px; padding: 12px 0;
  border-top: 1px solid #F1F5F9;
  opacity: ${(p) => (p.$expired ? 0.55 : 1)};
  &:first-of-type { border-top: none; }
`;
const InviteMain = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;`;
const InviteName = styled.div`
  font-size: 0.9375rem; font-weight: 700; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const InviteMeta = styled.div`
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px;
  font-size: 0.75rem; color: #64748B;
`;
const RoleChip = styled.span`
  font-size: 0.6875rem; font-weight: 700; color: #0F766E; background: #F0FDFA;
  border: 1px solid #99F6E4; border-radius: 999px; padding: 1px 8px;
`;
const NameInput = styled.input`
  width: 100%; box-sizing: border-box; padding: 11px 13px; font-size: 0.875rem; min-height: 44px;
  border: 1px solid #CBD5E1; border-radius: 8px; color: #0F172A; outline: none;
  &:focus { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.18); }
`;
const PickerGap = styled.div`margin-top: 4px;`;
const Notice = styled.p`
  margin: 0; font-size: 0.8125rem; line-height: 1.6; color: #334155;
  background: #F1F5F9; border-radius: 8px; padding: 10px 12px;
`;
const CreateRow = styled.div`display: flex; justify-content: flex-end;`;
const CodeRow = styled.div`display: flex; gap: 8px; align-items: center; & > input { flex: 1; min-width: 0; }`;
const PrimaryBtn = styled.button`
  flex-shrink: 0; padding: 0 16px; min-height: 40px; font-size: 0.8125rem; font-weight: 700; color: #FFFFFF;
  background: #0D9488; border: none; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #0F766E; } &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 0 14px; min-height: 36px; font-size: 0.8125rem; font-weight: 600; color: #334155;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; } &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
