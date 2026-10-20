// 받은 서명 archive — cross-workspace
//
// signer_email = me 인 SignatureRequest 모두 표시.
// 상태별 필터 (전체/대기/완료/거절/만료) + 워크스페이스 필터 + 검색.
//
// 액션:
//   pending/sent/viewed → "서명하기" → /sign/:token (새 탭, OTP 흐름)
//   signed              → "PDF 다운" + "원본 보기" (DetailDrawer)
//   rejected/expired/canceled → DetailDrawer (사유)

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import HighlightText from '../../components/Common/HighlightText';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { onSocket } from '../../services/socket';
import { downloadFromApi } from '../../utils/download';

interface ReceivedSignature {
  id: number;
  token: string;
  status: 'pending' | 'sent' | 'viewed' | 'signed' | 'rejected' | 'expired' | 'canceled';
  entity_type: 'post' | 'document';
  entity_id: number;
  entity_title: string;
  party?: 'us' | 'them';
  signer_email: string;
  signer_name: string | null;
  expires_at: string | null;
  signed_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  viewed_at: string | null;
  signature_image_b64: string | null;
  signature_image_count?: number;
  signed_ip: string | null;
  note: string | null;
  reminder_count: number;
  created_at: string;
  workspace: { business_id: number; brand_name: string; role: string } | null;
  kind?: 'sign' | 'confirm';
  /** 같은 문서의 서명 진행 — 서명 요청일 때만. others 는 나 말고 나머지(칸·쪽·상태만) */
  progress?: { total: number; signed: number; others: Array<{ party: 'us' | 'them'; slot: number | null; status: string }> };
}

/** 내가 서명했는데 남은 사람이 있으면 누구를 기다리는지 — 쪽으로 말한다(이름은 싣지 않는다) */
function waitingKey(it: ReceivedSignature): 'waitingUs' | 'waitingThem' | 'allSigned' | null {
  const p = it.progress;
  if (!p || p.total < 2) return null;
  if (p.signed >= p.total) return 'allSigned';
  if (it.status !== 'signed') return null;
  const left = p.others.filter((o) => o.status !== 'signed');
  if (left.length && left.every((o) => o.party === 'us') && it.party !== 'us') return 'waitingUs';
  return 'waitingThem';
}

/** PDF 는 새 창 없이 받는다(2026-10-21 Irene «새창이 열렸다가 다운돼. 안열리고 바로 다운되어야지») — 다운로드 트레이 한 곳 */
function pdfName(it: ReceivedSignature) {
  return `${(it.entity_title || 'document').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120)}.pdf`;
}

interface Workspace {
  business_id: number;
  brand_name: string;
  role: string;
}

type StatusFilter = 'all' | 'pending' | 'signed' | 'rejected' | 'expired';

const FILTERS: StatusFilter[] = ['all', 'pending', 'signed', 'rejected', 'expired'];

// status 그룹 매핑 — «대기» 는 아직 서명 안 한 것 전부(pending·sent·viewed). 서버가 'open' 을 셋으로 푼다.
function statusGroupQuery(filter: StatusFilter): string | null {
  if (filter === 'all') return null;
  if (filter === 'pending') return 'open';
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

  // 2026-10-21 Irene «서명해도 완료되었는데도 계속 돌아» — 처음 한 번만 읽어서, 다른 창에서 서명하고 돌아와도 줄이
  //   «대기 + [서명하기]» 그대로였다(다시 누르면 «서명 완료» 화면 → 반복). 돌아오는 순간·서명 신호에 조용히 다시 읽는다.
  const seqRef = useRef(0);
  const load = useCallback(async (silent: boolean) => {
    const seq = ++seqRef.current;
    if (!silent) setLoading(true);
    try {
      const r = await apiFetch(`/api/signatures/received?${queryStr}`);
      const j = await r.json();
      if (seq !== seqRef.current) return;
      if (!j.success) throw new Error(j.message);
      setItems(j.data.items || []);
      setTotal(j.data.total || 0);
      setWorkspaces(j.data.workspaces || []);
    } catch {
      // 조용한 재조회 실패는 보던 목록을 그대로 둔다
      if (!silent && seq === seqRef.current) { setItems([]); setTotal(0); }
    } finally {
      if (!silent && seq === seqRef.current) setLoading(false);
    }
  }, [queryStr]);
  useEffect(() => { void load(false); }, [load]);
  const silentReload = useCallback(() => { void load(true); }, [load]);
  useVisibilityRefresh(silentReload, 1000);
  useEffect(() => {
    let pending: number | null = null;
    const debounced = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; silentReload(); }, 250);
    };
    // 서명 창은 새 탭이다 — 이 탭으로 돌아오는 순간(focus)이 곧 «서명이 끝났을 수 있다» 다
    window.addEventListener('focus', debounced);
    window.addEventListener('inbox:refresh', debounced);
    const off = onSocket('inbox:refresh', debounced);
    return () => {
      if (pending) window.clearTimeout(pending);
      window.removeEventListener('focus', debounced);
      window.removeEventListener('inbox:refresh', debounced);
      off();
    };
  }, [silentReload]);

  // 상태별 카운트 (메인 데이터 + 별도 fetch 없이 클라이언트 추정 — 일단 단순)
  const isExpiredItem = (it: ReceivedSignature) => {
    return it.status === 'expired' ||
      (['pending', 'sent', 'viewed'].includes(it.status) && it.expires_at && new Date(it.expires_at) < new Date());
  };

  const handleSign = (it: ReceivedSignature) => {
    // 우리 쪽·상대 쪽 모두 그 문서만 보이는 서명 화면(2026-10-07). 우리 쪽 서명자는 거기서 로그인으로 본인 확인
    //   (인증번호 메일 없음 — 화면이 로그인한 본인을 알아본다).
    window.open(`/sign/${it.token}`, '_blank', 'noopener');
  };

  const [pdfBusy, setPdfBusy] = useState<number | null>(null);
  const handlePdf = async (it: ReceivedSignature) => {
    if (it.entity_type !== 'post' || pdfBusy === it.id) return;
    setPdfBusy(it.id);
    // 실패 문구는 다운로드 트레이가 보여 준다
    try { await downloadFromApi(`/api/sign/${it.token}/pdf`, pdfName(it)); } catch { /* 트레이에 표시됨 */ }
    finally { setPdfBusy((v) => (v === it.id ? null : v)); }
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
            const wait = waitingKey(it);
            return (
              <Card key={it.id} onClick={() => setSelected(it)}>
                <CardLeft>
                  <StatusDot $status={status} />
                </CardLeft>
                <CardBody>
                  <CardTitle><HighlightText text={it.entity_title} query={q} /></CardTitle>
                  <CardMeta>
                    <StatusPill $status={status}>{t(`received.statusFull.${status}`, status)}</StatusPill>
                    {it.progress && it.progress.total >= 2 && (
                      <ProgressChip data-testid={`received-progress-${it.id}`}>
                        {t('received.progress', { signed: it.progress.signed, total: it.progress.total, defaultValue: '서명 {{signed}}/{{total}}명' })}
                      </ProgressChip>
                    )}
                    {wait && (
                      <WaitText $done={wait === 'allSigned'} data-testid={`received-wait-${it.id}`}>
                        {t(`received.${wait}`, { defaultValue: wait === 'allSigned' ? '모두 서명 완료' : wait === 'waitingUs' ? '보내는 쪽 서명 대기' : '상대 서명 대기' })}
                      </WaitText>
                    )}
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
                    <SecondaryBtn type="button" disabled={pdfBusy === it.id} data-testid={`received-pdf-${it.id}`} onClick={() => void handlePdf(it)}>
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
      {selected && (
        <Detail signature={items.find((x) => x.id === selected.id) || selected} onClose={() => setSelected(null)}
          onSign={(it) => { setSelected(null); handleSign(it); }}
          onPdf={(it) => void handlePdf(it)} pdfBusy={pdfBusy === selected.id} />
      )}
    </Container>
  );
}

function Detail({ signature: s, onClose, onSign, onPdf, pdfBusy }: {
  signature: ReceivedSignature; onClose: () => void; onSign: (it: ReceivedSignature) => void;
  onPdf: (it: ReceivedSignature) => void; pdfBusy: boolean;
}) {
  const { t } = useTranslation('qdocs');
  const { formatDateTime } = useTimeFormat();
  // 서명 이미지 — 응답은 본문 대신 '(present)' 다(진행 표와 같은 응답 모양). 그대로 src 에 넣어 깨진 그림이 떴다.
  //   본인 서명이라 GET /api/signatures/:id/image?i= 로 칸마다 받는다(사인 + 회사 스탬프면 2장, 2026-10-16).
  const [imgs, setImgs] = useState<string[]>([]);
  useEffect(() => {
    if (!s.signature_image_b64) return undefined;
    if (s.signature_image_b64 !== '(present)') {
      setImgs([s.signature_image_b64.startsWith('data:') ? s.signature_image_b64 : `data:image/png;base64,${s.signature_image_b64}`]);
      return undefined;
    }
    let alive = true;
    const made: string[] = [];
    void (async () => {
      const n = Math.max(1, s.signature_image_count || 1);
      for (let i = 0; i < n; i += 1) {
        try {
          const r = await apiFetch(`/api/signatures/${s.id}/image?i=${i}`);
          if (r.ok) made.push(URL.createObjectURL(await r.blob()));
        } catch { /* 한 장 실패는 그 장만 빠진다 */ }
      }
      if (alive) setImgs([...made]);
    })();
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [s.id, s.signature_image_b64, s.signature_image_count]);
  return (
    <Backdrop onClick={onClose}>
      <Dialog role="dialog" aria-modal="true" aria-label={s.entity_title} onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{s.entity_title}</DialogTitle>
          <CloseBtn type="button" onClick={onClose} aria-label="close">×</CloseBtn>
        </DialogHeader>
        <DialogBody>
          <Field><FieldLabel>{t('received.detail.status', 'Status')}</FieldLabel><FieldValue><StatusPill $status={s.status}>{t(`received.statusFull.${s.status}`, s.status)}</StatusPill></FieldValue></Field>
          {s.progress && s.progress.total >= 2 && (
            <Field>
              <FieldLabel>{t('received.detail.progress', { defaultValue: '서명 진행' })}</FieldLabel>
              <FieldValue>
                <ProgressList data-testid="received-detail-progress">
                  <li>{t('received.progress', { signed: s.progress.signed, total: s.progress.total, defaultValue: '서명 {{signed}}/{{total}}명' })}</li>
                  <li>
                    {t('received.detail.me', { defaultValue: '나' })} · <StatusPill $status={s.status}>{t(`received.statusFull.${s.status}`, s.status)}</StatusPill>
                  </li>
                  {s.progress.others.map((o, i) => (
                    <li key={i}>
                      {o.slot ? `${t('received.detail.slot', { n: o.slot, defaultValue: '{{n}}번 칸' })} · ` : ''}
                      {o.party === 'us' ? t('received.detail.partyUs', { defaultValue: '보내는 쪽' }) : t('received.detail.partyThem', { defaultValue: '받는 쪽' })}
                      {' · '}<StatusPill $status={o.status}>{t(`received.statusFull.${o.status}`, o.status)}</StatusPill>
                    </li>
                  ))}
                </ProgressList>
              </FieldValue>
            </Field>
          )}
          <Field><FieldLabel>{t('received.detail.workspace', 'Workspace')}</FieldLabel><FieldValue>{s.workspace?.brand_name || '—'}</FieldValue></Field>
          {s.note && <Field><FieldLabel>{t('received.detail.note', 'Note')}</FieldLabel><FieldValue>{s.note}</FieldValue></Field>}
          {s.expires_at && <Field><FieldLabel>{t('received.detail.expiresAt', 'Expires at')}</FieldLabel><FieldValue>{formatDateTime(s.expires_at)}</FieldValue></Field>}
          {s.viewed_at && <Field><FieldLabel>{t('received.detail.viewedAt', 'Viewed at')}</FieldLabel><FieldValue>{formatDateTime(s.viewed_at)}</FieldValue></Field>}
          {s.signed_at && (
            <>
              <Field><FieldLabel>{t('received.detail.signedAt', 'Signed at')}</FieldLabel><FieldValue>{formatDateTime(s.signed_at)}</FieldValue></Field>
              {s.signed_ip && <Field><FieldLabel>{t('received.detail.signedIp', 'IP')}</FieldLabel><FieldValue>{s.signed_ip}</FieldValue></Field>}
              {imgs.length > 0 && (
                <Field>
                  <FieldLabel>{t('received.detail.signatureImage', 'Signature')}</FieldLabel>
                  <SigImgs data-testid="received-sign-images">{imgs.map((src, i) => <SigImg key={i} src={src} alt="signature" />)}</SigImgs>
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
            <PrimaryBtn type="button" onClick={() => onSign(s)}>
              {t('received.action.signOpen', 'Open signing page')}
            </PrimaryBtn>
          )}
          {s.status === 'signed' && (
            <SecondaryBtn type="button" disabled={pdfBusy} onClick={() => onPdf(s)}>
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
  display: flex; flex-direction: column; gap: 12px;
  /* #422 — 여백은 PageShell Body(20 / 폰 14) 하나가 준다. 여기서 또 주면 폰 34px 로 넓어진다 */
`;
const Toolbar = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const SearchInput = styled.input`
  width: 100%; max-width: 480px; padding: 9px 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; outline: none;
  &:focus { border-color: #14B8A6; }
`;
const FilterRow = styled.div`display: flex; gap: 6px; flex-wrap: wrap;`;
const FilterChip = styled.button<{ $active: boolean }>`
  padding: 6px 14px; background: ${p => p.$active ? '#14B8A6' : '#FFFFFF'};
  color: ${p => p.$active ? '#FFFFFF' : '#475569'};
  border: 1px solid ${p => p.$active ? '#0D9488' : '#E2E8F0'};
  border-radius: 999px; font-size: 0.75rem; font-weight: 600; cursor: pointer;
  &:hover { border-color: #94A3B8; }
`;
const WsRow = styled.div`display: flex; gap: 6px; flex-wrap: wrap;`;
const WsBtn = styled.button<{ $active: boolean }>`
  padding: 4px 10px; background: ${p => p.$active ? '#F0FDFA' : '#FFFFFF'};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  border: 1px solid ${p => p.$active ? '#5EEAD4' : '#E2E8F0'};
  border-radius: 999px; font-size: 0.6875rem; font-weight: 600; cursor: pointer;
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
const CardTitle = styled.div`font-size: 0.875rem; font-weight: 600; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const CardMeta = styled.div`display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 0.6875rem; color: #64748B;`;
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
  padding: 2px 8px; border-radius: 999px; font-size: 0.625rem; font-weight: 600;
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
  border-radius: 999px; font-size: 0.625rem; font-weight: 600;
`;
const DueText = styled.span`color: #64748B; font-size: 0.6875rem;`;
const ProgressChip = styled.span`
  padding: 2px 8px; background: #F1F5F9; color: #334155;
  border-radius: 999px; font-size: 0.625rem; font-weight: 600;
`;
const WaitText = styled.span<{ $done: boolean }>`font-size: 0.6875rem; font-weight: 600; color: ${(p) => (p.$done ? '#15803D' : '#B45309')};`;
const ProgressList = styled.ul`
  margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px;
  li { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
`;

const PrimaryBtn = styled.button`
  padding: 8px 14px; background: #0D9488; color: #FFFFFF;
  border: none; border-radius: 8px; font-size: 0.75rem; font-weight: 600; cursor: pointer;
  &:hover { background: #0F766E; }
`;
const SecondaryBtn = styled.button`
  padding: 8px 14px; background: #FFFFFF; color: #334155;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 0.75rem; font-weight: 600; cursor: pointer;
  &:hover { background: #F8FAFC; }
  &:disabled { opacity: 0.6; cursor: progress; }
`;

const EmptyState = styled.div`
  padding: 80px 20px; text-align: center; color: #94A3B8;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
`;
const EmptyIcon = styled.svg`width: 48px; height: 48px; color: #CBD5E1;`;
const EmptyTitle = styled.div`font-size: 0.875rem; font-weight: 600; color: #475569;`;
const Loading = styled.div`padding: 40px; text-align: center; color: #94A3B8;`;

const Pagination = styled.div`display: flex; justify-content: center; align-items: center; gap: 12px; padding: 16px;`;
const PageBtn = styled.button`
  padding: 8px 14px; background: #FFFFFF; color: #334155;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 0.8125rem; cursor: pointer;
  &:disabled { opacity: 0.4; cursor: not-allowed; }
  &:hover:not(:disabled) { background: #F8FAFC; }
`;
const PageInfo = styled.span`font-size: 0.75rem; color: #64748B; font-variant-numeric: tabular-nums;`;

// 상세 드로어
const Backdrop = styled.div`
  position: fixed; inset: var(--pq-popup-top, 0px) 0 0; background: rgba(15,23,42,0.5);
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
const DialogTitle = styled.h2`margin: 0; font-size: 1rem; font-weight: 700; color: #0F172A;`;
const CloseBtn = styled.button`
  /* touch-target-44: 폰 터치 타깃 (theme/tokens CONTROL.touchMin). 데스크탑 크기는 그대로. */
  @media (max-width: 640px) { min-width: 44px; min-height: 44px; }

  background: transparent; border: none; cursor: pointer; color: #64748B;
  font-size: 1.25rem; padding: 4px 8px; border-radius: 6px;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const DialogBody = styled.div`padding: 20px; display: flex; flex-direction: column; gap: 14px;`;
const DialogFooter = styled.div`
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 20px; border-top: 1px solid #F1F5F9;
`;
const Field = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const FieldLabel = styled.div`font-size: 0.6875rem; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: 0.3px;`;
const FieldValue = styled.div`font-size: 0.8125rem; color: #0F172A;`;
const SigImgs = styled.div`display: flex; flex-wrap: wrap; gap: 8px;`;
const SigImg = styled.img`max-width: 240px; max-height: 120px; border: 1px solid #E2E8F0; border-radius: 6px; background: #FFFFFF;`;
