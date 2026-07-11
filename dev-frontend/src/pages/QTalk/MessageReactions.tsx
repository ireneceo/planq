// 메시지 이모지 리액션 (#138) — 칩 목록 + 추가 버튼.
//   ChatPanel 이 이미 3,600줄이라 여기로 분리 (god-file 래칫).
//   실시간: ChatPanel 이 socket 'message:reaction' 을 받아 messages state 를 갱신하면 자동 반영.
import { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { toggleMessageReaction, REACTION_EMOJIS } from '../../services/qtalk';

interface Props {
  businessId: number;
  messageId: number;
  /** 백엔드가 메시지에 동봉한 원시 리액션 (user_id + emoji) */
  reactions?: { id: number; user_id: number; emoji: string }[];
  myUserId: number;
  /** 낙관적 갱신 — 서버 응답 전에 화면 먼저 반영 */
  onChanged?: (messageId: number, next: { id: number; user_id: number; emoji: string }[]) => void;
}

export default function MessageReactions({ businessId, messageId, reactions, myUserId, onChanged }: Props) {
  const { t } = useTranslation('qtalk');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const list = reactions || [];
  const grouped = REACTION_EMOJIS
    .map((emoji) => {
      const rows = list.filter((r) => r.emoji === emoji);
      return { emoji, count: rows.length, mine: rows.some((r) => r.user_id === myUserId) };
    })
    .filter((g) => g.count > 0);

  const toggle = async (emoji: string) => {
    if (busy) return;
    setBusy(true);
    setPickerOpen(false);
    // 낙관적 갱신 — 눌렀는데 아무 반응 없는 시간을 없앤다
    const mineHas = list.some((r) => r.emoji === emoji && r.user_id === myUserId);
    const optimistic = mineHas
      ? list.filter((r) => !(r.emoji === emoji && r.user_id === myUserId))
      : [...list, { id: -Date.now(), user_id: myUserId, emoji }];
    onChanged?.(messageId, optimistic);
    try {
      await toggleMessageReaction(businessId, messageId, emoji);
    } catch {
      onChanged?.(messageId, list);   // 실패 시 되돌린다
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row>
      {grouped.map((g) => (
        <Chip key={g.emoji} type="button" $mine={g.mine} onClick={() => toggle(g.emoji)} disabled={busy}>
          <span>{g.emoji}</span>
          <Count>{g.count}</Count>
        </Chip>
      ))}

      {pickerOpen ? (
        <Picker>
          {REACTION_EMOJIS.map((e) => (
            <PickBtn key={e} type="button" onClick={() => toggle(e)} disabled={busy} aria-label={e}>{e}</PickBtn>
          ))}
          <PickBtn type="button" onClick={() => setPickerOpen(false)} aria-label={t('reaction.close', { defaultValue: '닫기' }) as string}>×</PickBtn>
        </Picker>
      ) : (
        <AddBtn
          type="button"
          onClick={() => setPickerOpen(true)}
          title={t('reaction.add', { defaultValue: '반응 남기기' }) as string}
          aria-label={t('reaction.add', { defaultValue: '반응 남기기' }) as string}
          $hasAny={grouped.length > 0}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01M15 9h.01" />
          </svg>
        </AddBtn>
      )}
    </Row>
  );
}

const Row = styled.div`
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 4px;
`;
const Chip = styled.button<{ $mine: boolean }>`
  display: inline-flex; align-items: center; gap: 4px;
  height: 24px; padding: 0 8px; border-radius: 999px; cursor: pointer;
  font-size: 12px; line-height: 1;
  background: ${(p) => (p.$mine ? '#F0FDFA' : '#F1F5F9')};
  border: 1px solid ${(p) => (p.$mine ? '#5EEAD4' : '#E2E8F0')};
  color: ${(p) => (p.$mine ? '#0F766E' : '#475569')};
  transition: background .12s, border-color .12s;
  &:hover:not(:disabled) { background: ${(p) => (p.$mine ? '#CCFBF1' : '#E2E8F0')}; }
  &:disabled { opacity: .6; cursor: default; }
`;
const Count = styled.span`font-weight: 600; font-size: 11px;`;
const AddBtn = styled.button<{ $hasAny: boolean }>`
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border-radius: 999px; cursor: pointer;
  background: #fff; border: 1px solid #E2E8F0; color: #94A3B8;
  opacity: ${(p) => (p.$hasAny ? 1 : 0)};
  transition: opacity .12s, color .12s, border-color .12s;
  /* 데스크탑은 메시지에 hover 할 때만, 터치 기기는 항상 노출 */
  [data-message-row]:hover & { opacity: 1; }
  &:hover { color: #0F766E; border-color: #99F6E4; }
  &:focus-visible { opacity: 1; outline: 2px solid #14B8A6; outline-offset: 1px; }
  @media (hover: none), (max-width: 1024px) { opacity: 1; }
`;
const Picker = styled.div`
  display: inline-flex; align-items: center; gap: 2px;
  padding: 3px 5px; border-radius: 999px;
  background: #fff; border: 1px solid #E2E8F0; box-shadow: 0 4px 12px rgba(15,23,42,.08);
`;
const PickBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; border: none; background: none;
  font-size: 15px; line-height: 1; cursor: pointer; border-radius: 6px; color: #64748B;
  &:hover:not(:disabled) { background: #F1F5F9; }
  &:disabled { opacity: .6; cursor: default; }
`;
