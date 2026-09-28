// 메시지 이모지 리액션 (#138) — **달린 반응 칩만**. 추가는 메시지 도구줄 → ReactionPickerPopover (2026-09-28).
//   여기 있던 «추가» 버튼·펼침 줄은 폰에서 늘 보이고 탭 도구줄과 겹치며, 펼치면 말풍선 폭을 밀었다.
//   ChatPanel 이 이미 3,600줄이라 여기로 분리 (god-file 래칫).
//   실시간: ChatPanel 이 socket 'message:reaction' 을 받아 messages state 를 갱신하면 자동 반영.
import { useState } from 'react';
import styled from 'styled-components';
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

  if (!grouped.length) return null;   // 빈 줄을 남기지 않는다
  return (
    <Row>
      {grouped.map((g) => (
        <Chip key={g.emoji} type="button" $mine={g.mine} onClick={(e) => { e.stopPropagation(); toggle(g.emoji); }} disabled={busy}>
          <span>{g.emoji}</span>
          <Count>{g.count}</Count>
        </Chip>
      ))}

    </Row>
  );
}

const Row = styled.div`
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 4px;
`;
const Chip = styled.button<{ $mine: boolean }>`
  display: inline-flex; align-items: center; gap: 4px;
  height: 24px; padding: 0 8px; border-radius: 999px; cursor: pointer;
  font-size: 0.75rem; line-height: 1;
  background: ${(p) => (p.$mine ? '#F0FDFA' : '#F1F5F9')};
  border: 1px solid ${(p) => (p.$mine ? '#5EEAD4' : '#E2E8F0')};
  color: ${(p) => (p.$mine ? '#0F766E' : '#475569')};
  transition: background .12s, border-color .12s;
  &:hover:not(:disabled) { background: ${(p) => (p.$mine ? '#CCFBF1' : '#E2E8F0')}; }
  &:disabled { opacity: .6; cursor: default; }
`;
const Count = styled.span`font-weight: 600; font-size: 0.6875rem;`;
