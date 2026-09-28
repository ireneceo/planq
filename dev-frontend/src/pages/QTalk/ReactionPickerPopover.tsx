// 메시지 반응(이모지) 고르기 — **떠 있는 팝오버** (2026-09-28).
//
// Irene: *"모바일에서만 채팅마다 이모티콘 넣을 수 있게 나오는데 왜 모바일에만 나와? 다른 메뉴랑 누르는게
//   겹쳐서 제대로 누를 수가 없어. 게다가 눌러서 이모티콘 나오면 왜 글자가 왼쪽으로 쏠려?"*
//   여태는 반응 버튼이 메시지 아래 줄에 따로 있었다(폰에선 늘 보임 · 탭 도구줄과 같은 자리) 그리고
//   고르는 줄이 그 **흐름 안에** 펼쳐져 말풍선 폭을 밀었다. 슬랙·카카오톡·왓츠앱과 같게 —
//   반응은 메시지 도구줄의 한 칸이고, 고르는 줄은 메시지 **위(자리 없으면 아래)에 겹쳐** 뜬다.
//   본문을 밀지 않으므로 레이아웃이 움직이지 않는다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { toggleMessageReaction, REACTION_EMOJIS } from '../../services/qtalk';

interface Props {
  anchorEl: HTMLElement;
  businessId: number;
  messageId: number;
  reactions?: { user_id: number; emoji: string }[];
  myUserId: number;
  onClose: () => void;
}

const GAP = 6;
const MARGIN = 8;

export default function ReactionPickerPopover({ anchorEl, businessId, messageId, reactions, myUserId, onClose }: Props) {
  const { t } = useTranslation('qtalk');
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // 위치는 그려 본 뒤 실제 크기로 정한다(추정값으로 두면 폭이 다른 언어·기기에서 화면 밖으로 샌다).
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const a = anchorEl.getBoundingClientRect();
    // 세로 기준은 **메시지 전체**다 — 폰은 도구줄이 메시지 아래쪽에 떠서, 버튼 위에 띄우면
    //   그 메시지 글자를 덮는다. 메시지 위 → 안 되면 아래 → 둘 다 안 되면(아주 긴 메시지) 버튼 기준.
    const row = (anchorEl.closest('[data-msg-id]') as HTMLElement | null)?.getBoundingClientRect() || a;
    const w = el.offsetWidth; const h = el.offsetHeight;
    const vw = window.innerWidth; const vh = window.visualViewport?.height || window.innerHeight;
    const aboveRow = row.top - GAP - h;
    const belowRow = row.bottom + GAP;
    const top = aboveRow >= MARGIN ? aboveRow
      : belowRow + h <= vh - MARGIN ? belowRow
        : Math.max(MARGIN, Math.min(vh - h - MARGIN, a.top - GAP - h));
    const left = Math.min(vw - w - MARGIN, Math.max(MARGIN, a.right - w));
    setPos({ top, left });
  }, [anchorEl]);

  // 바깥 누름·Esc·스크롤·크기 변경이면 닫는다 — 떠 있는 것이 제자리를 잃은 채 남지 않게.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const tg = e.target as Node;
      if (ref.current?.contains(tg) || anchorEl.contains(tg)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onMove = (e: Event) => { if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return; onClose(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [anchorEl, onClose]);

  const pick = async (emoji: string) => {
    if (busy) return;
    setBusy(true);
    try { await toggleMessageReaction(businessId, messageId, emoji); }
    catch { /* 실시간 갱신(message:reaction)이 상태를 맞춘다 — 실패면 칩이 안 생긴다 */ }
    finally { setBusy(false); onClose(); }
  };

  const mine = new Set((reactions || []).filter((r) => r.user_id === myUserId).map((r) => r.emoji));

  return createPortal(
    <Bar
      ref={ref}
      role="menu"
      aria-label={t('reaction.add', { defaultValue: '반응 남기기' }) as string}
      data-testid="chat-reaction-picker"
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
      onClick={(e) => e.stopPropagation()}
    >
      {REACTION_EMOJIS.map((e) => (
        <Pick key={e} type="button" role="menuitem" $mine={mine.has(e)} onClick={() => pick(e)} disabled={busy} aria-label={e}>{e}</Pick>
      ))}
    </Bar>,
    document.body,
  );
}

const Bar = styled.div`
  position: fixed;
  z-index: var(--pq-z-modal);
  display: flex; align-items: center; gap: 2px;
  padding: 4px 6px; border-radius: 999px;
  background: #fff; border: 1px solid #E2E8F0;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.14);
`;
const Pick = styled.button<{ $mine: boolean }>`
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; padding: 0; border: none; border-radius: 999px;
  background: ${(p) => (p.$mine ? '#F0FDFA' : 'transparent')};
  font-size: 1.125rem; line-height: 1; cursor: pointer;
  &:hover:not(:disabled) { background: #F1F5F9; }
  &:disabled { opacity: .6; cursor: default; }
  /* 터치 — 손가락 목표 40px */
  @media (hover: none) { width: 40px; height: 40px; font-size: 1.25rem; }
`;
