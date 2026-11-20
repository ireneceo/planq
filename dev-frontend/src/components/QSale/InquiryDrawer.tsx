// InquiryDrawer — «신규 문의» 한 건 상세 (2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §5.4)
//
//   내용 전체 + 연락처 + [고객으로 등록] [메일로 답장] [처리함] [스팸] (보류·처리·스팸 건은 [신규로 되돌리기]).
//   껍데기는 공용 DetailDrawer(폭·뒤로=닫기·Esc 가 한 곳). 등록은 다른 등록과 같은 문(save-as-client from:'inquiry').
// ★ 등록하면 문의는 «처리함» 이 되고 고객 상세로 이어진다(같은 건을 두 줄로 세지 않는다).
// ★ [메일로 답장] 은 Q mail 작성(못 쓰면 기기 메일 앱) — EmailLink 와 같은 길(openMailCompose). 보낸 뒤 [처리함] 은 사람이 누른다.
import { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import DetailDrawer from '../Common/DetailDrawer';
import { openMailCompose } from '../People/EmailLink';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { navigateTab } from '../../hooks/useChromeNav';

export type Inquiry = {
  id: number; status: 'new' | 'handled' | 'held' | 'spam'; via: string;
  name: string; email: string; phone: string | null; company: string | null;
  message: string; service_id: string | null; service_name: string | null;
  held_reason: string | null; client_id: number | null; created_at: string;
};

type Props = {
  inquiry: Inquiry | null;
  businessId: number;
  canWrite: boolean;
  onClose: () => void;
  onChanged: (next: Inquiry | null) => void;
  onRegistered: () => void;
};

export default function InquiryDrawer({ inquiry, businessId, canWrite, onClose, onChanged, onRegistered }: Props) {
  const { t } = useTranslation('qsale');
  const { user } = useAuth();
  const { formatDateTime } = useTimeFormat();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const q = inquiry;

  const setStatus = async (status: 'new' | 'handled' | 'spam') => {
    if (!q || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/api/sale/${businessId}/inquiries/${q.id}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || `error_${r.status}`); return; }
      onChanged(j.data);
    } catch { setErr('network'); } finally { setBusy(false); }
  };

  const register = async () => {
    if (!q || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/api/sale/${businessId}/save-as-client`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'inquiry', inquiry_id: q.id }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || (r.status === 422 ? 'quota' : `error_${r.status}`)); return; }
      onRegistered();
      const cid = j.data?.client?.id;
      onClose();
      if (cid) navigateTab(`/sale/${cid}`);
    } catch { setErr('network'); } finally { setBusy(false); }
  };

  const reply = () => {
    if (!q) return;
    void openMailCompose([q.email], { bizId: businessId, qmailLevel: user?.menu_levels?.qmail });
  };

  return (
    <DetailDrawer open={!!q} onClose={onClose} ariaLabel={t('inquiryBox.detail', '문의 상세') as string}>
      <DetailDrawer.Header onClose={onClose}>
        <HTitle>{q?.name}</HTitle>
      </DetailDrawer.Header>
      <DetailDrawer.Body>
        {q && (
          <>
            <Meta>
              <Badge $s={q.status}>{t(`inquiryBox.status.${q.status}`, q.status)}</Badge>
              {q.status === 'held' && q.held_reason && <Muted>{t(`inquiryBox.held.${q.held_reason}`, q.held_reason)}</Muted>}
              <Muted data-testid="inquiry-drawer-received">{t('inquiryBox.received', '받은 시각')} {formatDateTime(q.created_at)} · {t(`inquiryBox.via.${q.via}`, q.via)}</Muted>
            </Meta>
            <Sec>
              <L>{t('inquiryBox.contact', '연락처')}</L>
              <KV><K>{t('inquiryBox.email', '이메일')}</K><V>{q.email}</V></KV>
              {q.phone && <KV><K>{t('inquiryBox.phone', '전화')}</K><V><a href={`tel:${q.phone}`}>{q.phone}</a></V></KV>}
              {q.company && <KV><K>{t('inquiryBox.company', '회사')}</K><V>{q.company}</V></KV>}
              {q.service_name && <KV><K>{t('inquiryBox.service', '관심 서비스')}</K><V>{q.service_name}</V></KV>}
            </Sec>
            <Sec>
              <L>{t('inquiryBox.message', '내용')}</L>
              <Body data-testid="inquiry-drawer-message">{q.message}</Body>
            </Sec>
            {q.client_id && (
              <LinkBtn type="button" onClick={() => { onClose(); navigateTab(`/sale/${q.client_id}`); }}>
                {t('inquiryBox.openClient', '등록된 고객 보기 →')}
              </LinkBtn>
            )}
            {err && <Err role="alert" data-testid="inquiry-drawer-error">{t(`inquiryBox.err.${err}`, t('inquiryBox.err.generic', '처리하지 못했어요. 다시 시도해 주세요.'))}</Err>}
            {!canWrite && <Muted>{t('inquiryBox.readOnly', 'Q sale 쓰기 권한이 있는 사람만 처리할 수 있어요.')}</Muted>}
          </>
        )}
      </DetailDrawer.Body>
      {q && canWrite && (
        <DetailDrawer.Footer>
          {q.status === 'new' ? (
            <>
              <Btn type="button" $danger disabled={busy} onClick={() => setStatus('spam')} data-testid="inquiry-spam">{t('inquiryBox.spam', '스팸')}</Btn>
              <Btn type="button" disabled={busy} onClick={() => setStatus('handled')} data-testid="inquiry-handled">{t('inquiryBox.handled', '처리함')}</Btn>
              <Btn type="button" disabled={busy} onClick={reply} data-testid="inquiry-reply">{t('inquiryBox.reply', '메일로 답장')}</Btn>
              {!q.client_id && (
                <Btn type="button" $primary disabled={busy} onClick={register} data-testid="inquiry-register">{t('inquiryBox.register', '고객으로 등록')}</Btn>
              )}
            </>
          ) : (
            <>
              <Btn type="button" disabled={busy} onClick={reply}>{t('inquiryBox.reply', '메일로 답장')}</Btn>
              <Btn type="button" $primary disabled={busy} onClick={() => setStatus('new')} data-testid="inquiry-restore">{t('inquiryBox.restore', '신규로 되돌리기')}</Btn>
            </>
          )}
        </DetailDrawer.Footer>
      )}
    </DetailDrawer>
  );
}

const HTitle = styled.h2`margin:0;font-size:1rem;font-weight:700;color:#0F172A;overflow-wrap:anywhere;`;
const Meta = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;`;
const Badge = styled.span<{ $s: string }>`
  font-size:0.6875rem;font-weight:700;border-radius:999px;padding:2px 10px;
  background:${(p) => (p.$s === 'new' ? '#F0FDFA' : p.$s === 'held' ? '#FFFBEB' : p.$s === 'spam' ? '#FFF1F2' : '#F1F5F9')};
  color:${(p) => (p.$s === 'new' ? '#0F766E' : p.$s === 'held' ? '#B45309' : p.$s === 'spam' ? '#B91C3C' : '#475569')};
`;
const Muted = styled.span`font-size:0.75rem;color:#94A3B8;`;
const Sec = styled.div`display:flex;flex-direction:column;gap:6px;`;
const L = styled.div`font-size:0.6875rem;font-weight:600;color:#94A3B8;`;
const KV = styled.div`display:flex;gap:10px;font-size:0.8125rem;color:#334155;a{color:#0D9488;}`;
const K = styled.span`flex:0 0 80px;color:#94A3B8;font-size:0.75rem;`;
const V = styled.span`min-width:0;overflow-wrap:anywhere;`;
const Body = styled.div`font-size:0.875rem;color:#0F172A;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;`;
const Err = styled.div`padding:8px 12px;background:#FFF1F2;border:1px solid #FECDD3;border-radius:8px;font-size:0.75rem;color:#B91C3C;`;
const LinkBtn = styled.button`align-self:flex-start;border:none;background:none;padding:0;cursor:pointer;color:#0D9488;font-size:0.8125rem;font-weight:600;`;
const Btn = styled.button<{ $primary?: boolean; $danger?: boolean }>`
  height:36px;padding:0 12px;border-radius:8px;cursor:pointer;white-space:nowrap;font-size:0.8125rem;font-weight:600;
  border:1px solid ${(p) => (p.$primary ? '#14B8A6' : p.$danger ? '#FECDD3' : '#cbd5e1')};
  background:${(p) => (p.$primary ? '#14B8A6' : '#fff')};
  color:${(p) => (p.$primary ? '#fff' : p.$danger ? '#B91C3C' : '#334155')};
  &:hover:not(:disabled){border-color:${(p) => (p.$danger ? '#F43F5E' : '#14B8A6')};}
  &:disabled{opacity:.55;cursor:default;}
`;
