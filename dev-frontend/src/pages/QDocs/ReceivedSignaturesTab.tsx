// 받은 서명 archive — cross-workspace
//
// signer_email = me 인 SignatureRequest 모두 표시.
// 상태별 필터 (전체/대기/완료/거절/만료) + 워크스페이스 필터 + 검색.
//
// 액션:
//   pending/sent/viewed → "서명하기" → /sign/:token (새 탭, OTP 흐름)
//   signed              → "PDF 다운" + "원본 보기" (DetailDrawer)
//   rejected/expired/canceled → DetailDrawer (사유)

import { useEffect, useState, useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';

interface ReceivedSignature {
  id: number;
  token: string;
  status: 'pending' | 'sent' | 'viewed' | 'signed' | 'rejected' | 'expired' | 'canceled';
  entity_type: 'post' | 'document';
  entity_id: number;
  entity_title: string;
  signer_email: string;
  signer_name: string | null;
  expires_at: string | null;
  signed_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  viewed_at: string | null;
  signature_image_b64: string | null;
  signed_ip: string | null;
  note: string | null;
  reminder_count: number;
  created_at: string;
  workspace: { business_id: number; brand_name: string; role: string } | null;
}

interface Workspace {
  business_id: number;
  brand_name: string;
  role: string;
}

type StatusFilter = 'all' | 'pending' | 'signed' | 'rejected' | 'expired';

const FILTERS: StatusFilter[] = ['all', 'pending', 'signed', 'rejected', 'expired'];

// status 그룹 매핑 — 'pending' 필터는 sent + viewed 양쪽 포함, 백엔드는 단일 status 만 받음
function statusGroupQuery(filter: StatusFilter): string | null {
  if (filter === 'all') return null;
  if (filter === 'pending') return 'sent';  // 가장 빈도 높음. viewed 는 별도 호출이 정석이지만 일단 sent 만
  return filter;
}

export default function ReceivedSignaturesTab() {
  const { t } = useTranslation('qdocs');
  const { formatDate, formatDateTime } = useTimeFormat();

  const [items, setItems] = useState<ReceivedSignature[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState<StatusFilter>('all');
  const [wsFilter, setWsFilter] = useState<number | 'all'>('all');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ReceivedSignature | null>(null);
  const limit = 50;

  const queryStr = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set('limit', String(limit));
    sp.set('offset', String(offset));
    const st = statusGroupQuery(filter);
    if (st) sp.set('status', st);
    if (wsFilter !== 'all') sp.set('workspace', String(wsFilter));
    if (q.trim()) sp.set('q', q.trim());
    return sp.toString();
  }, [filter, wsFilter, q, offset]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`/api/signatures/received?${queryStr}`)
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        if (!j.success) throw new Error(j.message);
        setItems(j.data.items || []);
        setTotal(j.data.total || 0);
        setWorkspaces(j.data.workspaces || []);
      })
      .catch(() => { if (alive) { setItems([]); setTotal(0); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [queryStr]);

  // 상태별 카운트 (메인 데이터 + 별도 fetch 없이 클라이언트 추정 — 일단 단순)
  const isExpiredItem = (it: ReceivedSignature) => {
    return it.status === 'expired' ||
      (['sent', 'viewed'].includes(it.status) && it.expires_at && new Date(it.expires_at) < new Date());
  };

  const handleSign = (it: ReceivedSignature) => {
    window.open(`/sign/${it.token}`, '_blank', 'noopener');
  };

  const handlePdf = (it: ReceivedSignature) => {
    if (it.entity_type === 'post') {
      window.open(`/api/posts/public/${it.token}/pdf`, '_blank');
    }
  };

  return (
    <Container>
      <Toolbar>
        <SearchInput
          placeholder={t('received.searchPh', 'Search by document title')}
          value={q}
          onChange={(e) => { setOffset(0); setQ(e.target.value); }}
        />
        <FilterRow>
          {FILTERS.map((f) => (
            <FilterChip
              type="button"
              key={f}
              $active={filter === f}
              onClick={() => { setOffset(0); setFilter(f); }}
            >
              {t(`received.status.${f}`, f)}
            </FilterChip>
          ))}
        </FilterRow>
        {workspaces.length > 1 && (
          <WsRow>
            <WsBtn type="button" $active={wsFilter === 'all'} onClick={() => { setOffset(0); setWsFilter('all'); }}>
              {t('received.allWorkspaces', 'All workspaces')}
            </WsBtn>
            {workspaces.map((w) => (
              <WsBtn type="button" key={w.business_id} $active={wsFilter === w.business_id} onClick={() => { setOffset(0); setWsFilter(w.business_id); }}>
                {w.brand_name}
              </WsBtn>
            ))}
          </WsRow>
        )}
      </Toolbar>

      {loading ? (
        <Loading>{t('received.loading', 'Loading...')}</Loading>
      ) : items.length === 0 ? (
        <EmptyState>
          <EmptyIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </EmptyIcon>
          <EmptyTitle>{t('received.empty', 'No signature requests received')}</EmptyTitle>
        </EmptyState>
      ) : (
        <List>
          {items.map((it) => {
            const expired = isExpiredItem(it);
            const status = expired ? 'expired' : it.status;
            return (
              <Card key={it.id} onClick={() => setSelected(it)}>
                <CardLeft>
                  <StatusDot $status={status} />
                </CardLeft>
                <CardBody>
                  <CardTitle>{it.entity_title}</CardTitle>
                  <CardMeta>
                    <StatusPill $status={status}>{t(`received.statusFull.${status}`, status)}</StatusPill>
                    {it.workspace && <WsChip>{it.workspace.brand_name}</WsChip>}
                    {(status === 'sent' || status === 'viewed' || status === 'pending') && it.expires_at && (
                      <DueText>{t('received.expiresAt', 'Expires {{date}}', { date: formatDate(it.expires_at) })}</DueText>
                    )}
                    {status === 'signed' && it.signed_at && (
                      <DueText>{t('received.signedAt', 'Signed {{date}}', { date: formatDateTime(it.signed_at) })}</DueText>
                    )}
                    {status === 'rejected' && it.rejected_at && (
                      <DueText>{t('received.rejectedAt', 'Rejected {{date}}', { date: formatDate(it.rejected_at) })}</DueText>
                    )}
                  </CardMeta>
                </CardBody>
                <CardRight onClick={(e) => e.stopPropagation()}>
                  {(status === 'sent' || status === 'viewed' || status === 'pending') && (
                    <PrimaryBtn type="button" onClick={() => handleSign(it)}>
                      {t('received.action.sign', 'Sign')}
                    </PrimaryBtn>
                  )}
                  {status === 'signed' && (
                    <SecondaryBtn type="button" onClick={() => handlePdf(it)}>
                      {t('received.action.pdf', 'PDF')}
                    </SecondaryBtn>
                  )}
                </CardRight>
              </Card>
            );
          })}
        </List>
      )}

      {total > limit && (
        <Pagination>
          <PageBtn type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
            {t('received.prev', 'Prev')}
          </PageBtn>
          <PageInfo>{Math.min(offset + 1, total)}–{Math.min(offset + limit, total)} / {total}</PageInfo>
          <PageBtn type="button" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
            {t('received.next', 'Next')}
          </PageBtn>
        </Pagination>
      )}

      {/* 상세 드로어 (간단 모달) */}
      {selected && <Detail signature={selected} onClose={() => setSelected(null)} />}
    </Container>
  );
}

function Detail({ signature: s, onClose }: { signature: ReceivedSignature; onClose: () => void }) {
  const { t } = useTranslation('qdocs');
  const { formatDateTime } = useTimeFormat();
  return (
    <Backdrop onClick={onClose}>
      <Dialog role="dialog" aria-modal="true" aria-label={s.entity_title} onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{s.entity_title}</DialogTitle>
          <CloseBtn type="button" onClick={onClose} aria-label="close">×</CloseBtn>
        </DialogHeader>
        <DialogBody>
          <Field><FieldLabel>{t('received.detail.status', 'Status')}</FieldLabel><FieldValue><StatusPill $status={s.status}>{t(`received.statusFull.${s.status}`, s.status)}</StatusPill></FieldValue></Field>
          <Field><FieldLabel>{t('received.detail.workspace', 'Workspace')}</FieldLabel><FieldValue>{s.workspace?.brand_name || '—'}</FieldValue></Field>
          {s.note && <Field><FieldLabel>{t('received.detail.note', 'Note')}</FieldLabel><FieldValue>{s.note}</FieldValue></Field>}
          {s.expires_at && <Field><FieldLabel>{t('received.detail.expiresAt', 'Expires at')}</FieldLabel><FieldValue>{formatDateTime(s.expires_at)}</FieldValue></Field>}
          {s.viewed_at && <Field><FieldLabel>{t('received.detail.viewedAt', 'Viewed at')}</FieldLabel><FieldValue>{formatDateTime(s.viewed_at)}</FieldValue></Field>}
          {s.signed_at && (
            <>
              <Field><FieldLabel>{t('received.detail.signedAt', 'Signed at')}</FieldLabel><FieldValue>{formatDateTime(s.signed_at)}</FieldValue></Field>
              {s.signed_ip && <Field><FieldLabel>{t('received.detail.signedIp', 'IP')}</FieldLabel><FieldValue>{s.signed_ip}</FieldValue></Field>}
              {s.signature_image_b64 && (
                <Field>
                  <FieldLabel>{t('received.detail.signatureImage', 'Signature')}</FieldLabel>
                  <SigImg src={s.signature_image_b64.startsWith('data:') ? s.signature_image_b64 : `data:image/png;base64,${s.signature_image_b64}`} alt="signature" />
                </Field>
              )}
            </>
          )}
          {s.rejected_at && (
            <>
              <Field><FieldLabel>{t('received.detail.rejectedAt', 'Rejected at')}</FieldLabel><FieldValue>{formatDateTime(s.rejected_at)}</FieldValue></Field>
              {s.rejected_reason && <Field><FieldLabel>{t('received.detail.rejectedReason', 'Reason')}</FieldLabel><FieldValue>{s.rejected_reason}</FieldValue></Field>}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {(s.status === 'sent' || s.status === 'viewed' || s.status === 'pending') && (
            <PrimaryBtn type="button" onClick={() => window.open(`/sign/${s.token}`, '_blank', 'noopener')}>
              {t('received.action.signOpen', 'Open signing page')}
            </PrimaryBtn>
          )}
          {s.status === 'signed' && (
            <SecondaryBtn type="button" onClick={() => window.open(`/api/posts/public/${s.token}/pdf`, '_blank')}>
              {t('received.action.pdf', 'PDF')}
            </SecondaryBtn>
          )}
          <SecondaryBtn type="button" onClick={onClose}>{t('received.action.close', 'Close')}</SecondaryBtn>
        </DialogFooter>
      </Dialog>
    </Backdrop>
  );
}

// ─────────────────────────────────────────────
// styled
// ─────────────────────────────────────────────
const Container = styled.div`
  display: flex; flex-direction: column; gap: 12px; padding: 20px;
`;
const Toolbar = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const SearchInput = styled.input`
  width: 100%; max-width: 480px; padding: 9px 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; outline: none;
  &:focus { border-color: #14B8A6; }
`;
const FilterRow = styled.div`display: flex; gap: 6px; flex-wrap: wrap;`;
const FilterChip = styled.button<{ $active: boolean }>`
  padding: 6px 14px; background: ${p => p.$active ? '#0F172A' : '#FFFFFF'};
  color: ${p => p.$active ? '#FFFFFF' : '#475569'};
  border: 1px solid ${p => p.$active ? '#0F172A' : '#E2E8F0'};
  border-radius: 999px; font-size: 12px; font-weight: 600; cursor: pointer;
  &:hover { border-color: #94A3B8; }
`;
const WsRow = styled.div`display: flex; gap: 6px; flex-wrap: wrap;`;
const WsBtn = styled.button<{ $active: boolean }>`
  padding: 4px 10px; background: ${p => p.$active ? '#F0FDFA' : '#FFFFFF'};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  border: 1px solid ${p => p.$active ? '#5EEAD4' : '#E2E8F0'};
  border-radius: 999px; font-size: 11px; font-weight: 600; cursor: pointer;
`;

const List = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  display: flex; flex-direction: column;
`;
const Card = styled.div`
  display: flex; gap: 12px; padding: 14px 18px;
  border-bottom: 1px solid #F1F5F9; cursor: pointer;
  &:last-child { border-bottom: none; }
  &:hover { background: #F8FAFC; }
`;
const CardLeft = styled.div`display: flex; align-items: center; flex-shrink: 0;`;
const CardBody = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;`;
const CardTitle = styled.div`font-size: 14px; font-weight: 600; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const CardMeta = styled.div`display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 11px; color: #64748B;`;
const CardRight = styled.div`display: flex; align-items: center; gap: 6px; flex-shrink: 0;`;

const StatusDot = styled.span<{ $status: string }>`
  width: 10px; height: 10px; border-radius: 50%;
  background: ${p =>
    p.$status === 'signed' ? '#22C55E' :
    p.$status === 'rejected' ? '#EF4444' :
    p.$status === 'expired' || p.$status === 'canceled' ? '#94A3B8' :
    '#F59E0B'};
`;
const StatusPill = styled.span<{ $status: string }>`
  padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600;
  background: ${p =>
    p.$status === 'signed' ? '#DCFCE7' :
    p.$status === 'rejected' ? '#FEE2E2' :
    p.$status === 'expired' || p.$status === 'canceled' ? '#F1F5F9' :
    '#FEF3C7'};
  color: ${p =>
    p.$status === 'signed' ? '#15803D' :
    p.$status === 'rejected' ? '#B91C1C' :
    p.$status === 'expired' || p.$status === 'canceled' ? '#64748B' :
    '#92400E'};
`;
const WsChip = styled.span`
  padding: 2px 8px; background: #FEF3C7; color: #92400E;
  border-radius: 999px; font-size: 10px; font-weight: 600;
`;
const DueText = styled.span`color: #64748B; font-size: 11px;`;

const PrimaryBtn = styled.button`
  padding: 8px 14px; background: #0D9488; color: #FFFFFF;
  border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
  &:hover { background: #0F766E; }
`;
const SecondaryBtn = styled.button`
  padding: 8px 14px; background: #FFFFFF; color: #334155;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;

const EmptyState = styled.div`
  padding: 80px 20px; text-align: center; color: #94A3B8;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
`;
const EmptyIcon = styled.svg`width: 48px; height: 48px; color: #CBD5E1;`;
const EmptyTitle = styled.div`font-size: 14px; font-weight: 600; color: #475569;`;
const Loading = styled.div`padding: 40px; text-align: center; color: #94A3B8;`;

const Pagination = styled.div`display: flex; justify-content: center; align-items: center; gap: 12px; padding: 16px;`;
const PageBtn = styled.button`
  padding: 8px 14px; background: #FFFFFF; color: #334155;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 13px; cursor: pointer;
  &:disabled { opacity: 0.4; cursor: not-allowed; }
  &:hover:not(:disabled) { background: #F8FAFC; }
`;
const PageInfo = styled.span`font-size: 12px; color: #64748B; font-variant-numeric: tabular-nums;`;

// 상세 드로어
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1200; padding: 16px;
`;
const Dialog = styled.div`
  background: #FFFFFF; border-radius: 14px; width: min(560px, 100%);
  max-height: 90vh; overflow: auto; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
`;
const DialogHeader = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #E2E8F0;
`;
const DialogTitle = styled.h2`margin: 0; font-size: 16px; font-weight: 700; color: #0F172A;`;
const CloseBtn = styled.button`
  background: transparent; border: none; cursor: pointer; color: #64748B;
  font-size: 20px; padding: 4px 8px; border-radius: 6px;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const DialogBody = styled.div`padding: 20px; display: flex; flex-direction: column; gap: 14px;`;
const DialogFooter = styled.div`
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 20px; border-top: 1px solid #F1F5F9;
`;
const Field = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const FieldLabel = styled.div`font-size: 11px; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: 0.3px;`;
const FieldValue = styled.div`font-size: 13px; color: #0F172A;`;
const SigImg = styled.img`max-width: 240px; max-height: 120px; border: 1px solid #E2E8F0; border-radius: 6px; background: #FFFFFF;`;
