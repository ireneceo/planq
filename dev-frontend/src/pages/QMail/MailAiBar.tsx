// 메일 AI 요청 바 — 답장·새 메일이 같이 쓴다. (2026-10-12)
//
// Irene: *"AI 입력란은 별표랑 빨간라인 있는 디자인이 통일 아니야?"* ·
//   *"초안 다시 생성할 때 내 글을 입력하는게 어딘지 애매해 … 엔터를 치면 넘어가야 할 것 같아.
//    다시 버튼을 누르게 하는 게 위치를 서로 다른 곳에 있는 걸 더 문제되게 해."*
//
// 그래서 ①모양은 Q task·Q sale 과 같은 Cue 바 껍데기(`components/Common/cueBarShell`)를 그대로 쓰고
// (값을 바꾸지 않는다 — 베끼면 갈라진다) ②입력과 실행이 **한 줄**이다: Enter 또는 바 안의 화살표.
// 예전엔 회색 입력칸은 본문 아래, [AI 초안 다시 생성] 은 맨 아래 버튼 줄에 있어 둘이 떨어져 있었다.
// 표시 전용 — 무엇을 보낼지(초안 유무·빈 요청 규칙)는 부르는 쪽이 정한다.
import { useLayoutEffect, useRef } from 'react';
import { BarRow, Sparkle, Field, SendBtn } from '../../components/Common/cueBarShell';
import { isEnterAction } from '../../utils/imeKey';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  disabled?: boolean;
  /** 빈 값이어도 화살표를 누를 수 있는가(답장 첫 초안 = 비우면 알아서 작성) */
  allowEmpty?: boolean;
  placeholder: string;
  ariaLabel: string;
  sendLabel: string;
  inputRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
  testId?: string;
}

export default function MailAiBar({
  value, onChange, onSubmit, busy, disabled, allowEmpty, placeholder, ariaLabel, sendLabel, inputRef, testId,
}: Props) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const setRef = (el: HTMLTextAreaElement | null) => {
    localRef.current = el;
    if (inputRef) inputRef.current = el;
  };
  // 줄이 늘면 칸도 같이 — 높이는 입력이 정한다(최대는 껍데기의 max-height).
  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const canSend = !busy && !disabled && (allowEmpty || !!value.trim());
  return (
    <BarRow $active={!!value || busy} data-testid={testId}>
      <Sparkle aria-hidden>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z" /></svg>
      </Sparkle>
      {/* draft-exempt: AI 에게 주는 한 줄 요청 — 보내는 즉시 비우고, 결과는 본문(답장 초안 자동저장)에 남는다 */}
      <Field
        ref={setRef}
        rows={1}
        value={value}
        disabled={busy || disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter = 보내기(한글 조합 중 Enter 는 확정이라 isEnterAction 이 거른다) · Shift+Enter = 줄바꿈 ·
          // ⌘/Ctrl+Enter 는 메일 보내기라 여기서 가로채지 않는다(작성창 onKeyDown 이 받는다).
          if (isEnterAction(e) && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            if (canSend) onSubmit();
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      <SendBtn type="button" onClick={onSubmit} disabled={!canSend} aria-label={sendLabel} title={sendLabel}>
        {busy ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M12 3a9 9 0 1 0 9 9">
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
            </path>
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
        )}
      </SendBtn>
    </BarRow>
  );
}
