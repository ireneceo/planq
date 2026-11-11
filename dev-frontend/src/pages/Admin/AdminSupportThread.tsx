// PlanQ 안내방 — 한 워크스페이스 방의 대화 + PlanQ 팀 답 쓰기 (2026-11-06 떼어 냄)
// 안내방 받은편지함(/admin/support)과 신규 고객 팔로업(/admin/followup)이 **같은 이 부품**을 쓴다 — 베끼면 갈라진다.
// ★ /api/admin/support/* 만 부른다(워크스페이스 대화 라우트 금지 — docs/PLANQ_GUIDE_ROOM_DESIGN.md §2).
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
import { PrimaryBtn, SecondaryBtn } from './adminModalKit';
import { openSupportRoom, sendSupportMessage, type SupportRoomDetail, type SupportMessage } from '../../services/admin';
import { isEnterAction } from '../../utils/imeKey';

/** 방 하나 읽기 — businessId 가 바뀌면 다시 읽는다. reload 는 소켓·탭 복귀에서 부른다. */
export function useSupportRoom(businessId: number | null) {
  const [room, setRoom] = useState<SupportRoomDetail | null>(null);
  const [roomError, setRoomError] = useState(false);
  const idRef = useRef(businessId);
  idRef.current = businessId;
  const reload = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    try {
      const r = await openSupportRoom(id);
      if (idRef.current === id) { setRoom(r); setRoomError(false); }
    } catch { if (idRef.current === id) setRoomError(true); }
  }, []);
  useEffect(() => { setRoom(null); setRoomError(false); if (businessId) void reload(); }, [businessId, reload]);
  return { room, roomError, reload };
}

export function SupportThread({ room, roomError }: { room: SupportRoomDetail | null; roomError: boolean }) {
  const { t, i18n } = useTranslation('admin');
  const { formatDateTime } = useTimeFormat();
  const endRef = useRef<HTMLDivElement>(null);
  // 방을 열거나 새 글이 오면 맨 아래로
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [room?.messages.length]);

  const senderLabel = (m: SupportMessage) => {
    if (m.is_ai) return t('support.cue', 'Cue');
    const s = m.sender;
    return (s?.name_localized?.[i18n.language] || s?.name || '').trim() || t('support.unknown', '알 수 없음');
  };
  const bodyOf = (m: SupportMessage) => {
    if (m.is_deleted) return t('support.deleted', '삭제된 메시지');
    if (m.meta?.support_notice) return t(`support.notice.${m.meta.support_notice}`, m.content);
    return m.content;
  };

  if (roomError) return <ErrorText>{t('support.roomFailed', '안내방을 열지 못했어요')}</ErrorText>;
  if (!room) return <Pad><Dim>{t('support.loading', '불러오는 중…')}</Dim></Pad>;
  return (
    <Thread data-testid="admin-support-thread">
      {room.messages.length === 0 && <Dim>{t('support.noMessages', '아직 대화가 없어요')}</Dim>}
      {room.messages.map((m) => {
        const staff = !!m.meta?.platform_staff;
        return (
          <Bubble key={m.id} $kind={m.is_ai ? 'cue' : staff ? 'staff' : 'member'}>
            <BubbleHead>
              <strong>{senderLabel(m)}</strong>
              <Dim>{formatDateTime(m.created_at)}</Dim>
            </BubbleHead>
            <BubbleBody>{bodyOf(m)}</BubbleBody>
          </Bubble>
        );
      })}
      <div ref={endRef} />
    </Thread>
  );
}

export interface ComposerInsert { text: string; ruleKey: string | null; nonce: number }

/**
 * 답 쓰기 — 초안은 방마다 남는다(admin-support-reply). insert 가 바뀌면 입력칸을 그 글로 채운다(팔로업 «도울 일» 초안).
 * 못 채운 {{…}} 가 남아 있으면 보내지 않는다.
 */
export function SupportComposer({ businessId, room, insert, onSent, onClose }: {
  businessId: number | null;
  room: SupportRoomDetail | null;
  insert?: ComposerInsert | null;
  onSent?: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation('admin');
  const draft = useDraftText(useDraftKey('admin-support-reply', businessId, 'platform'));
  const [ruleKey, setRuleKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const setText = draft.setText;

  // 방이 바뀌면 규칙 표시는 버린다(글 자체는 방마다 따로 남는다)
  useEffect(() => { setRuleKey(null); setSendError(false); }, [businessId]);
  useEffect(() => {
    if (!insert) return;
    setText(insert.text);
    setRuleKey(insert.ruleKey);
    window.setTimeout(() => boxRef.current?.focus(), 0);
  }, [insert, setText]);

  const text = draft.text;
  const unfilled = /\{\{\w+\}\}/.test(text);
  const canSend = !!businessId && !sending && !!text.trim() && !unfilled;
  const send = async () => {
    if (!canSend || !businessId) return;
    setSending(true); setSendError(false);
    try {
      await sendSupportMessage(businessId, text.trim(), ruleKey);
      draft.clear();
      setRuleKey(null);
      await onSent?.();
    } catch { setSendError(true); }
    finally { setSending(false); }
  };

  return (
    <Composer>
      {room && typeof room.participants === 'number' && (
        <Recipients data-testid="admin-support-recipients">
          {t('support.recipients', {
            name: room.business_name || `#${room.business_id}`, count: room.participants,
            defaultValue: '{{name}} 안내방 · {{count}}명에게 앱 알림이 갑니다',
          })}
        </Recipients>
      )}
      <ReplyBox
        ref={boxRef}
        value={text}
        onChange={(e) => { setText(e.target.value); if (!e.target.value.trim()) setRuleKey(null); }}
        rows={4}
        placeholder={t('support.replyPh', 'PlanQ 팀으로 답하기 — 보내면 워크스페이스 사람들에게 알림이 갑니다 (Ctrl/⌘ + Enter)') as string}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && isEnterAction(e)) { e.preventDefault(); void send(); } }}
        data-testid="admin-support-reply"
        data-draft-kind="admin-support-reply"
      />
      {unfilled && <ErrorText>{t('support.unfilled', '초안에 채우지 못한 자리(괄호 두 겹)가 남아 있어요. 고친 뒤 보낼 수 있어요.')}</ErrorText>}
      {sendError && <ErrorText>{t('support.sendFailed', '보내지 못했어요. 다시 시도해 주세요.')}</ErrorText>}
      <ComposerRow>
        <Dim>{t('support.muteHint', '보내면 4시간 동안 Cue 는 이 방에서 답하지 않습니다.')}</Dim>
        <ComposerBtns>
          <SecondaryBtn type="button" onClick={onClose}>{t('support.close', '닫기')}</SecondaryBtn>
          <PrimaryBtn type="button" onClick={() => void send()} disabled={!canSend} data-testid="admin-support-send">
            {sending ? t('support.sending', '보내는 중…') : t('support.send', 'PlanQ 팀으로 보내기')}
          </PrimaryBtn>
        </ComposerBtns>
      </ComposerRow>
    </Composer>
  );
}

const Dim = styled.span`color: #94A3B8; font-size: 0.75rem;`;
const Pad = styled.div`padding: 16px 20px;`;
const ErrorText = styled.div`font-size: 0.8125rem; color: #DC2626; padding: 4px 0;`;
const Thread = styled.div`display: flex; flex-direction: column; gap: 10px; padding: 16px 20px;`;
const Bubble = styled.div<{ $kind: 'cue' | 'staff' | 'member' }>`
  max-width: 88%; padding: 10px 12px; border-radius: 10px;
  align-self: ${(p) => (p.$kind === 'member' ? 'flex-start' : 'flex-end')};
  background: ${(p) => (p.$kind === 'staff' ? '#F0FDFA' : p.$kind === 'cue' ? '#FFF1F2' : '#F8FAFC')};
  border: 1px solid ${(p) => (p.$kind === 'staff' ? '#99F6E4' : p.$kind === 'cue' ? '#FECDD3' : '#E2E8F0')};
`;
const BubbleHead = styled.div`display: flex; gap: 8px; align-items: baseline; font-size: 0.75rem; color: #334155; margin-bottom: 4px;`;
const BubbleBody = styled.div`font-size: 0.8125rem; color: #0F172A; white-space: pre-wrap; word-break: break-word;`;
const Composer = styled.div`display: flex; flex-direction: column; gap: 8px; width: 100%;`;
const Recipients = styled.div`font-size: 0.75rem; color: #0F766E; font-weight: 600;`;
const ReplyBox = styled.textarea`
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 72px; padding: 10px 12px;
  border: 1px solid #CBD5E1; border-radius: 8px; font: inherit; font-size: 0.8125rem;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const ComposerRow = styled.div`display: flex; align-items: center; gap: 8px; justify-content: space-between; flex-wrap: wrap;`;
const ComposerBtns = styled.div`display: flex; gap: 8px; margin-left: auto;`;
