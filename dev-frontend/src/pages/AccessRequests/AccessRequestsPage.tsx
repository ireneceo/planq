// 받은 «열람 요청» — 승인·거절·회수 (2026-11-25, Irene «열람요청하기» → «권고대로» · docs/FILE_SEARCH_DISCOVERY_DESIGN.md §3)
//   알림(«○○ 님이 열람을 요청했어요»)이 여기로 온다. 받는 사람 = 올린 사람·작성자(없으면 대표·관리자), 대표·관리자는 워크스페이스 전부.
//   승인 = 요청한 사람만 그 자료를 열 수 있다(공개 범위는 그대로) · 회수하면 다시 닫힌다. 실시간은 신호(access_request:changed) 뒤 다시 읽기.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import ActionButton from '../../components/Common/ActionButton';
import StandardModal from '../../components/Common/StandardModal';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { useAuth } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { getSocket } from '../../services/socket';
import { tabStore } from '../../stores/tabStore';
import { fetchInbox, decideRequest, type InboxItem } from '../../services/accessRequests';

const AccessRequestsPage: React.FC = () => {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  const { formatDateTime } = useTimeFormat();
  const [data, setData] = useState<{ pending: InboxItem[]; approved: InboxItem[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [denyFor, setDenyFor] = useState<InboxItem | null>(null);
  const [denyNote, setDenyNote] = useState('');
  const [revokeFor, setRevokeFor] = useState<InboxItem | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    try { setData(await fetchInbox(businessId)); setErr(null); }
    catch { setErr(t('accessRequest.page.loadFailed') as string); }
  }, [businessId, t]);
  useEffect(() => { void load(); }, [load]);
  useVisibilityRefresh(load);
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const on = (p: { business_id?: number }) => {
      if (p && p.business_id && Number(p.business_id) !== businessId) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void load(); }, 250);
    };
    s.on('access_request:changed', on);
    return () => { s.off('access_request:changed', on); if (timer) clearTimeout(timer); };
  }, [load, businessId]);

  const act = async (it: InboxItem, action: 'approve' | 'deny' | 'revoke', note?: string) => {
    if (!businessId || busy) return false;
    setBusy(it.id);
    try { await decideRequest(businessId, it.id, action, note); await load(); return true; }
    catch { setErr(t('accessRequest.page.actionFailed') as string); return false; }
    finally { setBusy(null); }
  };

  const nameOf = (it: InboxItem) => (it.missing ? t('accessRequest.page.missingItem') : (it.name || t('accessRequest.page.hiddenItem'))) as string;
  const who = (it: InboxItem) => it.requester?.name || (t('accessRequest.page.someone') as string);
  const openItem = (it: InboxItem) => tabStore.openInNewTab(it.entity_type === 'file' ? `/files?file=${it.entity_id}` : `/docs?post=${it.entity_id}`);

  const row = (it: InboxItem, mode: 'pending' | 'approved') => (
    <Row key={it.id} data-testid={`access-req-${mode}`}>
      <Main>
        <Top>
          <Kind>{t(`accessRequest.kind.${it.entity_type}`) as string}</Kind>
          {it.name ? <ItemLink type="button" onClick={() => openItem(it)}>{nameOf(it)}</ItemLink> : <Muted>{nameOf(it)}</Muted>}
        </Top>
        <Sub>{t('accessRequest.page.requestedBy', { name: who(it) }) as string} · {formatDateTime(mode === 'pending' ? it.created_at : (it.decided_at || it.created_at))}</Sub>
        {it.message && <Msg>“{it.message}”</Msg>}
      </Main>
      <Actions>
        {mode === 'pending' ? (
          <>
            <ActionButton tone="secondary" size="sm" disabled={busy === it.id} data-testid="access-req-deny"
              onClick={() => { setDenyNote(''); setDenyFor(it); }}>{t('accessRequest.page.deny') as string}</ActionButton>
            <ActionButton tone="primary" size="sm" loading={busy === it.id} disabled={!it.name} data-testid="access-req-approve"
              onClick={() => { void act(it, 'approve'); }}>{t('accessRequest.page.approve') as string}</ActionButton>
          </>
        ) : (
          <ActionButton tone="secondary" size="sm" disabled={busy === it.id} data-testid="access-req-revoke"
            onClick={() => setRevokeFor(it)}>{t('accessRequest.page.revoke') as string}</ActionButton>
        )}
      </Actions>
    </Row>
  );

  return (
    <PageShell title={t('accessRequest.page.title', '열람 요청') as string} count={data?.pending.length || undefined}>
      <Hint>{t('accessRequest.page.hint') as string}</Hint>
      {err && <ErrLine role="alert">{err}</ErrLine>}
      <Section>
        <SectionTitle>{t('accessRequest.page.pending') as string}</SectionTitle>
        {data && data.pending.length === 0 && <Empty>{t('accessRequest.page.empty') as string}</Empty>}
        {data?.pending.map((it) => row(it, 'pending'))}
      </Section>
      <Section>
        <SectionTitle>{t('accessRequest.page.approved') as string}</SectionTitle>
        {data && data.approved.length === 0 && <Empty>{t('accessRequest.page.emptyApproved') as string}</Empty>}
        {data?.approved.map((it) => row(it, 'approved'))}
      </Section>

      <StandardModal open={!!denyFor} onClose={() => setDenyFor(null)} size="sm" title={t('accessRequest.page.denyTitle') as string}
        footer={(
          <>
            <ActionButton tone="secondary" size="md" onClick={() => setDenyFor(null)}>{t('accessRequest.cancel') as string}</ActionButton>
            <ActionButton tone="danger" size="md" loading={!!denyFor && busy === denyFor.id} data-testid="access-req-deny-confirm"
              onClick={async () => { if (denyFor && await act(denyFor, 'deny', denyNote.trim() || undefined)) setDenyFor(null); }}>
              {t('accessRequest.page.deny') as string}
            </ActionButton>
          </>
        )}>
        <NoteLabel htmlFor="access-deny-note">{t('accessRequest.page.denyNoteLabel') as string}</NoteLabel>
        {/* draft-exempt: 거절 사유(선택) 한 줄 — 창을 닫으면 거절을 안 한 것이라 남길 글이 아니다 */}
        <NoteArea id="access-deny-note" rows={3} maxLength={300} value={denyNote} onChange={(e) => setDenyNote(e.target.value)} />
      </StandardModal>

      <ConfirmDialog
        isOpen={!!revokeFor}
        onClose={() => setRevokeFor(null)}
        onConfirm={async () => { if (revokeFor) { await act(revokeFor, 'revoke'); setRevokeFor(null); } }}
        title={t('accessRequest.page.revokeTitle') as string}
        message={revokeFor ? t('accessRequest.page.revokeMsg', { name: who(revokeFor) }) as string : ''}
        confirmText={t('accessRequest.page.revoke') as string}
        variant="danger"
      />
    </PageShell>
  );
};

export default AccessRequestsPage;

const Hint = styled.p` margin: 0 0 16px; font-size: 0.8125rem; color: #64748B; line-height: 1.55; `;
const ErrLine = styled.div` margin-bottom: 12px; font-size: 0.8125rem; color: #B91C1C; `;
const Section = styled.section`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px 16px; margin-bottom: 16px;
`;
const SectionTitle = styled.h2` margin: 4px 0 8px; font-size: 0.875rem; font-weight: 700; color: #0F172A; `;
const Empty = styled.div` padding: 12px 0; font-size: 0.8125rem; color: #94A3B8; `;
const Row = styled.div`
  display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid #F1F5F9;
  &:first-of-type { border-top: none; }
  @media (max-width: 640px) { flex-direction: column; align-items: stretch; }
`;
const Main = styled.div` flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; `;
const Top = styled.div` display: flex; align-items: center; gap: 6px; min-width: 0; `;
const Kind = styled.span` font-size: 0.6875rem; font-weight: 600; color: #94A3B8; flex-shrink: 0; `;
const ItemLink = styled.button`
  border: none; background: none; padding: 0; font: inherit; font-size: 0.875rem; font-weight: 600; color: #0F766E;
  cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
  &:hover { text-decoration: underline; }
`;
const Muted = styled.span` font-size: 0.875rem; color: #94A3B8; `;
const Sub = styled.div` font-size: 0.75rem; color: #64748B; `;
const Msg = styled.div` font-size: 0.8125rem; color: #334155; word-break: break-word; `;
const Actions = styled.div` display: flex; gap: 8px; flex-shrink: 0; @media (max-width: 640px) { justify-content: flex-end; } `;
const NoteLabel = styled.label` font-size: 0.8125rem; font-weight: 600; color: #475569; `;
const NoteArea = styled.textarea`
  width: 100%; box-sizing: border-box; border: 1px solid #CBD5E1; border-radius: 8px; padding: 10px 12px;
  font-size: 0.875rem; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
