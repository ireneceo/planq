// 보낸 서명(개인) · 서명 관리(워크스페이스 설정) — 한 컴포넌트 두 범위 (2026-10-23, docs/SIGNATURE_MANAGE_DESIGN.md)
//
//   mode 'sent'   → GET /api/signatures/sent?business_id=   (내가 요청한 것 · 지금 워크스페이스)
//   mode 'manage' → GET /api/signatures/manage/:businessId  (워크스페이스 전체 · owner/admin) + 요청자 칸·필터
//   관리 동작은 기존 문 그대로 — 재알림(받는 주소를 확인창에 적는다) · 요청 취소. «삭제» 는 없다(서명 기록은 증빙이다).
//   «수정» 은 문서로 간다 — 문서의 [고쳐서 다시 보내기] 가 회차를 닫는다.
//   서버가 읽을 수 없는 문서의 행은 가려서 준다(hidden) — 제목 대신 «비공개 문서», 동작 없음.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { onSocket } from '../../services/socket';
import { cancelSignature, remindSignature } from '../../services/posts';
import { tabStore } from '../../stores/tabStore';
import { displayName } from '../../utils/displayName';
import ConfirmDialog from '../Common/ConfirmDialog';
import SearchBox from '../Common/SearchBox';
import PlanQSelect from '../Common/PlanQSelect';
import HighlightText from '../Common/HighlightText';
import { FilterBar, FilterSearchSlot, FilterSlot, CheckFilter, axisOption } from '../Common/filterBar';

type EditBlock = 'signature_locked' | 'signature_signed' | 'no_permission';
interface Person { id: number; name?: string | null; name_localized?: unknown; display_name?: string | null; display_name_localized?: unknown }
export interface ManagedSignature {
  id: number;
  entity_type: 'post' | 'document';
  entity_id?: number;
  entity_title: string | null;
  hidden: boolean;
  kind: 'sign' | 'confirm';
  status: string;
  party: 'us' | 'them';
  slot: number | null;
  signer_name: string | null;
  signer_email: string;
  created_at: string;
  expires_at: string | null;
  signed_at: string | null;
  rejected_at?: string | null;
  rejected_reason?: string | null;
  superseded_at: string | null;
  reminder_count: number;
  requester: Person | null;
  doc: { can_read: boolean; can_edit?: boolean; edit_block?: EditBlock | null };
  can_manage: boolean;
}

type StatusFilter = 'open' | 'all' | 'signed' | 'rejected' | 'canceled' | 'expired';
const STATUS_FILTERS: StatusFilter[] = ['open', 'all', 'signed', 'rejected', 'canceled', 'expired'];
const LIVE = ['pending', 'sent', 'viewed'];
const LIMIT = 50;

function effectiveStatus(s: ManagedSignature): string {
  if (LIVE.includes(s.status) && s.expires_at && new Date(s.expires_at).getTime() < Date.now()) return 'expired';
  return s.status;
}

export default function SignatureRequestList({ mode, businessId }: { mode: 'sent' | 'manage'; businessId: number }) {
  const { t, i18n } = useTranslation('qdocs');
  const { formatDate, formatDateTime } = useTimeFormat();
  const [items, setItems] = useState<ManagedSignature[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [withPast, setWithPast] = useState(false);
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [requester, setRequester] = useState('');
  const [requesters, setRequesters] = useState<Array<{ user_id: number; display_name: string; is_member: boolean }>>([]);
  const [offset, setOffset] = useState(0);
  const [remindTarget, setRemindTarget] = useState<ManagedSignature | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ManagedSignature | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  // 검색은 0.3초 쉬었다가 — 글자마다 서버를 부르지 않는다
  useEffect(() => { const h = window.setTimeout(() => { setOffset(0); setQ(qLive.trim()); }, 300); return () => window.clearTimeout(h); }, [qLive]);

  const url = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set('limit', String(LIMIT));
    sp.set('offset', String(offset));
    sp.set('status', status);
    if (withPast) sp.set('include_superseded', '1');
    if (q) sp.set('q', q);
    if (mode === 'manage' && requester) sp.set('requester_user_id', requester);
    if (mode === 'sent') { sp.set('business_id', String(businessId)); return `/api/signatures/sent?${sp}`; }
    return `/api/signatures/manage/${businessId}?${sp}`;
  }, [mode, businessId, offset, status, withPast, q, requester]);

  const seqRef = useRef(0);
  const load = useCallback(async (silent: boolean) => {
    const seq = ++seqRef.current;
    if (!silent) setLoading(true);
    try {
      const r = await apiFetch(url);
      const j = await r.json();
      if (seq !== seqRef.current) return;
      if (!j.success) throw new Error(j.message);
      setItems(j.data || []);
      setTotal(j.pagination?.total || 0);
      if (Array.isArray(j.pagination?.requesters)) setRequesters(j.pagination.requesters);
      setFailed(false);
    } catch {
      // 조용한 재조회 실패는 보던 목록을 그대로 둔다
      if (!silent && seq === seqRef.current) { setItems([]); setTotal(0); setFailed(true); }
    } finally {
      if (!silent && seq === seqRef.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => { void load(false); }, [load]);
  const silentReload = useCallback(() => { void load(true); }, [load]);
  useVisibilityRefresh(silentReload, 1000);
  useEffect(() => {
    let pending: number | null = null;
    const debounced = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; silentReload(); }, 250);
    };
    window.addEventListener('inbox:refresh', debounced);
    window.addEventListener('socket:reconnected', debounced);
    const off = onSocket('inbox:refresh', debounced);
    return () => {
      if (pending) window.clearTimeout(pending);
      window.removeEventListener('inbox:refresh', debounced);
      window.removeEventListener('socket:reconnected', debounced);
      off();
    };
  }, [silentReload]);

  // 문서·회차 묶음 — 같은 문서 + 같은 회차(닫힌 회차는 superseded_at 이 같다). 가린 행은 행마다 따로.
  const groups = useMemo(() => {
    const map = new Map<string, ManagedSignature[]>();
    for (const s of items) {
      const key = s.hidden ? `h:${s.id}` : `${s.entity_type}:${s.entity_id}:${s.superseded_at || 'open'}`;
      const arr = map.get(key) || [];
      arr.push(s);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([key, rows]) => ({ key, rows }));
  }, [items]);

  const personName = (p: Person | null) => (p ? displayName(p as never, i18n.language) : '');

  const confirmRemind = async () => {
    if (!remindTarget || busyId) return;
    setBusyId(remindTarget.id); setActionErr(null);
    try { await remindSignature(remindTarget.id); setRemindTarget(null); await load(true); }
    catch { setRemindTarget(null); setActionErr(t('sigManage.remindFailed', '다시 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.') as string); }
    finally { setBusyId(null); }
  };
  const confirmCancel = async () => {
    if (!cancelTarget || busyId) return;
    setBusyId(cancelTarget.id); setActionErr(null);
    try {
      const done = await cancelSignature(cancelTarget.id);
      setCancelTarget(null);
      if (!done) setActionErr(t('sigManage.cancelFailed', '요청을 취소하지 못했어요. 이미 끝난 요청일 수 있어요.') as string);
      await load(true);
    } finally { setBusyId(null); }
  };

  const statusOptions = STATUS_FILTERS.map((f) => ({ value: f, label: t(`sigManage.filter.${f}`, f) as string }));
  const requesterOptions = [axisOption(t('sigManage.requester', '요청자') as string),
    ...requesters.map((r) => ({ value: String(r.user_id), label: r.is_member ? r.display_name : `${r.display_name} (${t('sigManage.formerMember', '내보낸 멤버')})` }))];

  return (
    <Wrap data-testid={`sig-list-${mode}`}>
      <FilterBar>
        <FilterSearchSlot data-testid={`sig-${mode}-search`}>
          <SearchBox value={qLive} onChange={setQLive} width="100%"
            placeholder={t('sigManage.searchPh', '문서 제목·받는 사람 검색') as string}
            ariaLabel={t('sigManage.searchPh', '문서 제목·받는 사람 검색') as string} />
        </FilterSearchSlot>
        <FilterSlot width={130} testId={`sig-${mode}-status`}>
          <PlanQSelect size="sm" isSearchable={false} options={statusOptions}
            aria-label={t('sigManage.statusAxis', '상태') as string}
            value={statusOptions.find((o) => o.value === status) || statusOptions[0]}
            onChange={(opt: unknown) => { setOffset(0); setStatus(((opt as { value?: string } | null)?.value || 'open') as StatusFilter); }} />
        </FilterSlot>
        {mode === 'manage' && (
          <FilterSlot width={150} testId="sig-manage-requester">
            <PlanQSelect size="sm" isSearchable={false} options={requesterOptions}
              aria-label={t('sigManage.requester', '요청자') as string}
              value={requesterOptions.find((o) => o.value === requester) || requesterOptions[0]}
              onChange={(opt: unknown) => { setOffset(0); setRequester(String((opt as { value?: string } | null)?.value ?? '')); }} />
          </FilterSlot>
        )}
        <CheckFilter>
          <input type="checkbox" checked={withPast} data-testid={`sig-${mode}-past`}
            onChange={(e) => { setOffset(0); setWithPast(e.target.checked); }} />
          {t('sigManage.includePast', '이전 회차 포함')}
        </CheckFilter>
      </FilterBar>

      {actionErr && <ErrLine role="alert">{actionErr}</ErrLine>}

      {loading ? (
        <Muted>{t('received.loading', '불러오는 중...')}</Muted>
      ) : failed ? (
        <Muted>{t('sigManage.loadFailed', '목록을 불러오지 못했어요.')}</Muted>
      ) : groups.length === 0 ? (
        <Empty>{mode === 'sent'
          ? t('sigManage.emptySent', '보낸 서명 요청이 없어요. 문서에서 [서명 받기] 로 보낼 수 있어요.')
          : t('sigManage.emptyManage', '조건에 맞는 서명 요청이 없어요.')}</Empty>
      ) : (
        <List>
          {groups.map(({ key, rows }) => {
            const head = rows[0];
            const signRows = rows.filter((r) => r.kind === 'sign');
            const signed = signRows.filter((r) => r.status === 'signed').length;
            return (
              <Group key={key} data-testid={`sig-group-${head.id}`}>
                <GroupHead>
                  <GroupTitleCol>
                    <GroupTitle $hidden={head.hidden}>
                      {head.hidden
                        ? t('sigManage.hiddenDoc', '비공개 문서')
                        : <HighlightText text={head.entity_title || t('sigManage.untitled', '제목 없음') as string} query={q} />}
                    </GroupTitle>
                    <GroupMeta>
                      <KindChip>{head.kind === 'confirm' ? t('sigManage.kindConfirm', '확인 요청') : t('sigManage.kindSign', '서명 요청')}</KindChip>
                      {signRows.length >= 2 && <span>{t('received.progress', { signed, total: signRows.length, defaultValue: '서명 {{signed}}/{{total}}명' })}</span>}
                      <span>{t('sigManage.requestedAt', '요청 {{date}}', { date: formatDate(head.created_at) })}</span>
                      {head.superseded_at && <PastChip>{t('sigManage.closedRound', '닫힌 회차 · {{date}}', { date: formatDate(head.superseded_at) })}</PastChip>}
                      {head.hidden && <span>{t('sigManage.hiddenHint', '읽을 수 없는 문서라 내용과 관리 버튼을 가렸어요')}</span>}
                    </GroupMeta>
                  </GroupTitleCol>
                  {!head.hidden && head.doc.can_read && head.entity_id && (
                    <GroupActions>
                      <SmallBtn type="button" data-testid={`sig-open-doc-${head.id}`}
                        onClick={() => tabStore.openInNewTab(`/docs?post=${head.entity_id}`)}>
                        {t('received.action.openDoc', '문서 보기')}
                      </SmallBtn>
                      {head.doc.edit_block === 'signature_locked' && !head.superseded_at && (
                        <SmallBtn type="button" data-testid={`sig-revise-${head.id}`} title={t('sigManage.reviseHint', '문서에서 [고쳐서 다시 보내기] 로 고칩니다') as string}
                          onClick={() => tabStore.openInNewTab(`/docs?post=${head.entity_id}`)}>
                          {t('sigManage.revise', '고쳐서 다시 보내기')}
                        </SmallBtn>
                      )}
                    </GroupActions>
                  )}
                </GroupHead>
                {rows.map((s) => {
                  const st = effectiveStatus(s);
                  const live = LIVE.includes(st);
                  const canRemind = s.can_manage && (s.status === 'sent' || s.status === 'viewed') && st !== 'expired' && s.party === 'them';
                  const canCancel = s.can_manage && LIVE.includes(s.status);
                  return (
                    <Row key={s.id} data-testid={`sig-row-${s.id}`}>
                      <RowMain>
                        <RowName>
                          {s.signer_name || s.signer_email}
                          {s.signer_name && <RowSub>{s.signer_email}</RowSub>}
                          {s.party === 'us' && <RowSub>· {t('received.detail.partyUs', '보내는 쪽')}</RowSub>}
                        </RowName>
                        <RowMeta>
                          <StatusPill $status={st} data-testid={`sig-status-${s.id}`}>{t(`received.statusFull.${st}`, st)}</StatusPill>
                          {mode === 'manage' && s.requester && (
                            <span data-testid={`sig-requester-${s.id}`}>{t('sigManage.requestedBy', '요청 {{name}}', { name: personName(s.requester) })}</span>
                          )}
                          {live && s.expires_at && <span>{t('received.expiresAt', '{{date}} 만료', { date: formatDate(s.expires_at) })}</span>}
                          {st === 'signed' && s.signed_at && <span>{t('received.signedAt', '{{date}} 서명', { date: formatDateTime(s.signed_at) })}</span>}
                          {st === 'rejected' && s.rejected_at && <span>{t('received.rejectedAt', '{{date}} 거절', { date: formatDate(s.rejected_at) })}</span>}
                          {s.reminder_count > 0 && live && <span>{t('signProgress.reminderCount', '재발송 {{n}}회', { n: s.reminder_count })}</span>}
                        </RowMeta>
                        {st === 'rejected' && s.rejected_reason && <Reason>"{s.rejected_reason}"</Reason>}
                      </RowMain>
                      {(canRemind || canCancel) && (
                        <RowActions>
                          {canRemind && (
                            <SmallBtn type="button" disabled={busyId !== null} data-testid={`sig-remind-${s.id}`} onClick={() => setRemindTarget(s)}>
                              {t('sigManage.remind', '다시 보내기')}
                            </SmallBtn>
                          )}
                          {canCancel && (
                            <SmallBtn type="button" $danger disabled={busyId !== null} data-testid={`sig-cancel-${s.id}`} onClick={() => setCancelTarget(s)}>
                              {t('sigManage.cancel', '요청 취소')}
                            </SmallBtn>
                          )}
                        </RowActions>
                      )}
                    </Row>
                  );
                })}
              </Group>
            );
          })}
        </List>
      )}

      {total > LIMIT && (
        <Pagination>
          <SmallBtn type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>{t('received.prev', '이전')}</SmallBtn>
          <PageInfo>{Math.min(offset + 1, total)}–{Math.min(offset + LIMIT, total)} / {total}</PageInfo>
          <SmallBtn type="button" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>{t('received.next', '다음')}</SmallBtn>
        </Pagination>
      )}

      <ConfirmDialog
        isOpen={!!remindTarget}
        onClose={() => setRemindTarget(null)}
        onConfirm={confirmRemind}
        title={t('signProgress.resendConfirm.title', '서명 링크를 다시 보낼까요?') as string}
        message={t('signProgress.resendConfirm.desc', '{{email}} 로 서명 링크 메일을 다시 보냅니다.', { email: remindTarget?.signer_email || '' }) as string}
        confirmText={t('signProgress.resendConfirm.ok', '보내기') as string}
        cancelText={t('common.close', '닫기') as string}
        variant="info"
      />
      <ConfirmDialog
        isOpen={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
        title={t('signProgress.cancelTitle', '서명 요청 취소') as string}
        message={(cancelTarget?.party === 'us'
          ? t('signProgress.cancelUsMessage', '{{name}} 님(보내는 쪽)의 서명 칸 요청을 취소합니다.', { name: cancelTarget?.signer_name || cancelTarget?.signer_email || '' })
          : t('sigManage.cancelMessage', '«{{email}}» 의 요청을 취소합니다. 보낸 링크는 바로 닫히고, 요청 기록(보낸 사람·시각)은 남습니다.', { email: cancelTarget?.signer_email || '' })) as string}
        confirmText={t('signProgress.cancelConfirmBtn', '취소하기') as string}
        cancelText={t('common.close', '닫기') as string}
        variant="danger"
      />
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; min-width: 0;`;
const ErrLine = styled.p`margin: 0 0 10px; padding: 8px 12px; border-radius: 8px; background: #FEF2F2; color: #B91C1C; font-size: 0.8125rem;`;
const Muted = styled.div`padding: 40px; text-align: center; color: #94A3B8; font-size: 0.8125rem;`;
const Empty = styled.div`padding: 60px 20px; text-align: center; color: #64748B; font-size: 0.8125rem; background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;`;
const List = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const Group = styled.section`background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;`;
const GroupHead = styled.div`
  display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; background: #F8FAFC; border-bottom: 1px solid #F1F5F9;
  @media (max-width: 640px) { flex-direction: column; gap: 8px; }
`;
const GroupTitleCol = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;`;
const GroupTitle = styled.div<{ $hidden: boolean }>`
  font-size: 0.875rem; font-weight: 700; color: ${(p) => (p.$hidden ? '#94A3B8' : '#0F172A')};
  font-style: ${(p) => (p.$hidden ? 'italic' : 'normal')};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const GroupMeta = styled.div`display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 0.6875rem; color: #64748B;`;
const GroupActions = styled.div`display: flex; gap: 6px; flex-shrink: 0; flex-wrap: wrap;`;
const KindChip = styled.span`padding: 2px 8px; border-radius: 999px; background: #F0FDFA; color: #0F766E; font-weight: 600; font-size: 0.625rem;`;
const PastChip = styled.span`padding: 2px 8px; border-radius: 999px; background: #F1F5F9; color: #475569; font-weight: 600; font-size: 0.625rem;`;
const Row = styled.div`
  display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #F1F5F9;
  &:last-child { border-bottom: none; }
  @media (max-width: 640px) { flex-direction: column; align-items: stretch; gap: 8px; }
`;
const RowMain = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;`;
const RowName = styled.div`font-size: 0.8125rem; font-weight: 600; color: #0F172A; display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; min-width: 0; word-break: break-all;`;
const RowSub = styled.span`font-size: 0.75rem; font-weight: 400; color: #64748B;`;
const RowMeta = styled.div`display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 0.6875rem; color: #64748B;`;
const Reason = styled.div`font-size: 0.75rem; color: #475569;`;
const RowActions = styled.div`display: flex; gap: 6px; flex-shrink: 0; @media (max-width: 640px) { justify-content: flex-end; }`;
const StatusPill = styled.span<{ $status: string }>`
  padding: 2px 8px; border-radius: 999px; font-size: 0.625rem; font-weight: 600;
  background: ${(p) => (p.$status === 'signed' || p.$status === 'confirmed' ? '#DCFCE7' : p.$status === 'rejected' ? '#FEE2E2'
    : ['expired', 'canceled', 'superseded'].includes(p.$status) ? '#F1F5F9' : '#FEF3C7')};
  color: ${(p) => (p.$status === 'signed' || p.$status === 'confirmed' ? '#15803D' : p.$status === 'rejected' ? '#B91C1C'
    : ['expired', 'canceled', 'superseded'].includes(p.$status) ? '#64748B' : '#92400E')};
`;
const SmallBtn = styled.button<{ $danger?: boolean }>`
  height: 32px; padding: 0 12px; border-radius: 8px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap;
  background: #FFFFFF; color: ${(p) => (p.$danger ? '#B91C1C' : '#334155')};
  border: 1px solid ${(p) => (p.$danger ? '#FECACA' : '#CBD5E1')};
  &:hover:not(:disabled) { background: ${(p) => (p.$danger ? '#FEF2F2' : '#F8FAFC')}; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (max-width: 640px) { height: 40px; }
`;
const Pagination = styled.div`display: flex; justify-content: center; align-items: center; gap: 12px; padding: 16px;`;
const PageInfo = styled.span`font-size: 0.75rem; color: #64748B; font-variant-numeric: tabular-nums;`;
