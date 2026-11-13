// Q talk — 메시지를 다른 대화방으로 «전달» (docs/QTALK_FORWARD_DESIGN.md §4, Fable DESIGN-READY).
//   방 고르기 → 아래 버튼 «‘방’에 전달» 두 단계(누르는 즉시 보내지 않는다). 끝나면 창을 닫고 한 줄 알림 + «방으로 이동».
//   판정은 서버(services/messageForward)가 한다 — 화면은 전달 못 하는 메시지(카드·지운 것·내부 메모·미승인 초안)를
//   처음부터 고르지 못하게 할 뿐이다(메시지의 forwardable 은 QTalkPage apiMessageToMock 이 서버와 같은 식으로 채운다).
//   ChatPanel 이 god-file 이라 상태·창·알림을 여기 한 파일에 둔다 — ChatPanel 은 열고(ids) 닫기만 한다.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../../components/Common/StandardModal';
import ModalActionButton from '../../components/Common/ModalActionButton';
import ConversationPicker, { conversationLabel } from '../../components/Common/ConversationPicker';
import * as qtalkApi from '../../services/qtalk';
import type { MockMessage } from './types';

export const ForwardIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="15 17 20 12 15 7" /><path d="M4 18v-2a4 4 0 0 1 4-4h12" />
  </svg>
);

/** 받는 쪽 말풍선 위 «전달된 메시지» 한 줄 — ReplyQuote 와 같은 글자 크기 */
export function ForwardedLabel() {
  const { t } = useTranslation('qtalk');
  return <LabelLine data-testid="chat-forwarded-label"><ForwardIcon size={12} />{t('forward.label', '전달된 메시지')}</LabelLine>;
}

interface Props {
  businessId: number | null;
  sourceConversationId: number | null;
  /** 고른 메시지들(전달 못 하는 것이 섞여 있어도 된다 — 빼고 센다). null 이면 창 닫힘 */
  messages: MockMessage[] | null;
  onClose: () => void;
  /** 보낸 뒤 — 선택 모드 해제 등 */
  onSent?: () => void;
}

export function ForwardFlow({ businessId, sourceConversationId, messages, onClose, onSent }: Props) {
  const { t } = useTranslation('qtalk');
  const navigate = useNavigate();
  const open = !!messages;
  const [convs, setConvs] = useState<qtalkApi.ApiConversation[] | null>(null);
  const [picked, setPicked] = useState<qtalkApi.ApiConversation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ convId: number } | null>(null);

  const forwardable = useMemo(() => (messages || []).filter((m) => m.forwardable), [messages]);
  const total = messages?.length || 0;

  // 창을 열 때마다 목록을 새로 읽는다 — 보관 방·지금 방·PlanQ 안내방은 뺀다
  useEffect(() => {
    if (!open || !businessId) return;
    let cancelled = false;
    setConvs(null); setPicked(null); setErr(null);
    qtalkApi.listBusinessConversations(businessId)
      .then((list) => {
        if (cancelled) return;
        setConvs(list.filter((c) => c.status !== 'archived' && !c.archived_at && c.id !== sourceConversationId && c.channel_type !== 'platform'));
      })
      .catch(() => { if (!cancelled) setConvs([]); });
    return () => { cancelled = true; };
  }, [open, businessId, sourceConversationId]);

  // 한 줄 알림은 잠시 뒤 스스로 걷힌다
  useEffect(() => {
    if (!notice) return;
    const h = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(h);
  }, [notice]);

  const send = async () => {
    if (!businessId || !sourceConversationId || !picked || busy || forwardable.length === 0) return;
    setBusy(true); setErr(null);
    try {
      await qtalkApi.forwardMessages(businessId, sourceConversationId, forwardable.map((m) => m.id), picked.id);
      setNotice({ convId: picked.id });
      onClose();
      onSent?.();
    } catch (e) {
      const code = (e as Error).message;
      setErr(code === 'not_forwardable' ? t('forward.err.notForwardable', '전달할 수 없는 메시지가 섞여 있어요')
        : code === 'attachment_restricted' ? t('forward.err.attachment', '보안등급이 걸린 첨부는 전달할 수 없어요. 파일 첨부로 직접 붙여 주세요')
          : code === 'conversation_archived' ? t('forward.err.archived', '보관된 대화방에는 전달할 수 없어요')
            : t('forward.err.failed', '전달하지 못했어요. 다시 시도해 주세요'));
    } finally { setBusy(false); }
  };

  const clientRoom = !!picked && (picked.channel_type === 'customer' || !!picked.client_id || !!picked.Client);

  return (
    <>
      <StandardModal open={open} onClose={onClose} title={t('forward.title', '어느 대화방으로 전달할까요?')} size="md"
        footer={(
          <>
            <ModalActionButton onClick={onClose}>{t('common.cancel', '취소')}</ModalActionButton>
            <ModalActionButton variant="primary" data-testid="forward-send" disabled={!picked || busy || forwardable.length === 0} onClick={() => void send()}>
              {picked ? t('forward.send', { room: conversationLabel(picked), defaultValue: '‘{{room}}’에 전달' }) : t('chat.action.forward', '전달')}
            </ModalActionButton>
          </>
        )}>
        <StandardModal.Body>
          <div data-testid="forward-picker">
            <CountLine>{t('forward.count', { n: forwardable.length, defaultValue: '메시지 {{n}}개' })}</CountLine>
            {forwardable.length < total && (
              <PartialLine data-testid="forward-partial">{t('forward.partial', { n: total, m: forwardable.length, defaultValue: '{{n}}개 중 {{m}}개만 전달됩니다 (카드·지운 메시지 제외)' })}</PartialLine>
            )}
          </div>
          <ConversationPicker convs={convs} selectedId={picked?.id ?? null} disabled={busy} testIdPrefix="forward"
            onPick={(c) => { setPicked((cur) => (cur?.id === c.id ? null : c)); setErr(null); }}
            searchPlaceholder={t('forward.search', '대화방·고객 이름으로 찾기') as string}
            emptyText={t('forward.empty', '전달할 수 있는 대화방이 없습니다') as string} />
          {clientRoom && <ClientLine data-testid="forward-client-room">{t('forward.clientRoom', '고객이 보는 방입니다')}</ClientLine>}
          {err && <ErrLine role="alert" data-testid="forward-error">{err}</ErrLine>}
        </StandardModal.Body>
      </StandardModal>
      {notice && createPortal(
        <Notice role="status" data-testid="forward-done">
          <span>{t('forward.done', '전달했어요')}</span>
          <NoticeBtn type="button" data-testid="forward-go-room" onClick={() => { const id = notice.convId; setNotice(null); navigate(`/talk/${id}`); }}>
            {t('forward.goRoom', '방으로 이동')}
          </NoticeBtn>
        </Notice>,
        document.body,
      )}
    </>
  );
}

const LabelLine = styled.div`
  display: flex; align-items: center; gap: 4px; margin: 2px 0 4px;
  font-size: 0.75rem; color: #64748B; font-weight: 500;
  svg { flex-shrink: 0; }
`;
const CountLine = styled.div`font-size: 0.8125rem; font-weight: 600; color: #0F172A;`;
const PartialLine = styled.div`margin-top: 4px; font-size: 0.75rem; color: #92400E;`;
const ClientLine = styled.div`
  font-size: 0.8125rem; color: #9A3412; background: #FFF7ED; border: 1px solid #FED7AA;
  border-radius: 8px; padding: 8px 12px;
`;
const ErrLine = styled.div`font-size: 0.8125rem; color: #B91C1C; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 10px 12px;`;
const Notice = styled.div`
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(24px + env(safe-area-inset-bottom, 0px)); z-index: 1200;
  display: flex; align-items: center; gap: 12px; max-width: calc(100vw - 32px);
  padding: 10px 12px 10px 16px; border-radius: 10px;
  background: #0F172A; color: #FFFFFF; font-size: 0.875rem; box-shadow: 0 8px 24px rgba(15,23,42,0.25);
`;
const NoticeBtn = styled.button`
  flex-shrink: 0; min-height: 32px; padding: 0 10px; border-radius: 8px; cursor: pointer;
  background: transparent; border: 1px solid rgba(255,255,255,0.4); color: #5EEAD4; font-size: 0.8125rem; font-weight: 600;
`;
