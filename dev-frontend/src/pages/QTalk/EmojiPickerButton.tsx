// 채팅 입력창 이모지 (#380) — "채팅하는 채팅창에 이모티콘 보낼 수 있게 해야할 것 같아."
//   ★ 메시지에 **다는** 리액션(#138 MessageReactions)과는 다른 기능이다. 이건 **보내는** 쪽 —
//     본문에 문자로 삽입한다. 그래서 백엔드·스키마 변경이 없다(이모지는 그냥 텍스트다).
//   ChatPanel 이 이미 3,600줄이라 여기로 분리한다 (god-file 래칫 — MessageReactions 와 같은 이유).
import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

// 업무용 채팅에서 실제로 쓰이는 것 위주. 리액션 8종(REACTION_EMOJIS)을 앞에 두어
// "달던 것과 같은 것을 보낼 수 있다" 는 인상을 준다.
const CHAT_EMOJIS = [
  '👍', '❤️', '😂', '🎉', '👀', '🙏', '✅', '🔥',
  '😊', '😅', '😍', '🤔', '😢', '😮', '😴', '🙌',
  '👋', '👏', '💪', '🤝', '💡', '⚠️', '❓', '❗',
  '📌', '📅', '📎', '📝', '⏰', '🚀', '💰', '☕',
];

interface Props {
  /** 커서 위치에 삽입한다 — 호출측이 textarea 를 소유하므로 삽입도 거기서 한다. */
  onPick: (emoji: string) => void;
  disabled?: boolean;
}

export default function EmojiPickerButton({ onPick, disabled }: Props) {
  const { t } = useTranslation('qtalk');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 바깥 클릭 · Esc 로 닫기. (모달이 아니라 팝오버라 useEscapeStack 스택에는 올리지 않는다 —
  //  드로어/모달 위에 떠도 이 팝오버만 먼저 닫혀야 한다.)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <Wrap ref={wrapRef}>
      <Btn
        type="button"
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        title={t('chat.input.emoji', { defaultValue: '이모지' }) as string}
        aria-label={t('chat.input.emoji', { defaultValue: '이모지' }) as string}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          <line x1="9" y1="9" x2="9.01" y2="9" />
          <line x1="15" y1="9" x2="15.01" y2="9" />
        </svg>
      </Btn>
      {open && (
        <Pop role="menu" aria-label={t('chat.input.emoji', { defaultValue: '이모지' }) as string}>
          {CHAT_EMOJIS.map((e) => (
            <Cell
              key={e}
              type="button"
              role="menuitem"
              onClick={() => { onPick(e); setOpen(false); }}
              title={e}
            >
              {e}
            </Cell>
          ))}
        </Pop>
      )}
    </Wrap>
  );
}

const Wrap = styled.div`
  position: relative;
  display: flex;
  align-items: flex-end;
`;

// 첨부 버튼과 같은 규격 (36×36 최소 터치 타겟 — 반응형 원칙 2)
const Btn = styled.button`
  width: 36px;
  height: 36px;
  /* 운영 #398 — 첨부·전송은 모바일에서 44px 인데 이것만 36px 이라 셋이 어긋나 보였다
     (Irene: "결론은 정돈이 안되어 보여"). 같은 줄에 서는 버튼은 같은 규칙을 쓴다. */
  @media (max-width: 1024px) { width: 44px; height: 44px; }
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  border-radius: 8px;
  flex-shrink: 0;
  &:hover:not(:disabled) { background: #f1f5f9; color: #334155; }
  &:disabled { opacity: 0.5; cursor: default; }
  &:focus-visible { outline: 2px solid #F43F5E; outline-offset: 2px; }
`;

const Pop = styled.div`
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 30;
  display: grid;
  grid-template-columns: repeat(8, 36px);
  gap: 2px;
  padding: 8px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);

  @media (max-width: 640px) {
    grid-template-columns: repeat(8, 1fr);
    width: min(320px, calc(100vw - 32px));
  }
`;

// 36×36 — 최소 터치 타겟(CLAUDE.md 반응형 원칙 2) 이자 컨트롤 높이 토큰(36/40/44).
const Cell = styled.button`
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  font-size: 1.125rem;
  line-height: 1;
  cursor: pointer;
  border-radius: 6px;
  &:hover { background: #f1f5f9; }
  &:focus-visible { outline: 2px solid #F43F5E; outline-offset: -2px; }

  @media (max-width: 640px) { width: 100%; height: 36px; }
`;
