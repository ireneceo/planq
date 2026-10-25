// components/Common/FocusBlock.tsx — 쓰는 칸 «크게 쓰기» (2026-10-25)
//
// Irene: 문서 편집 «전체 화면으로 쓰기» 뒤 «다른 곳도 이런 방식으로» → «네»(업무 설명·결과물 · Q note 메모 · 메일 답장).
// 좁은 패널(업무 우측 480px · 메일 상세 아래 답장 칸) 안에서 긴 글을 쓰기 답답한 자리에, 그 칸만 화면 가운데 큰 판으로 띄운다.
//
// ★ 편집기를 옮기지 않는다 — 포털로 빼면 다시 마운트돼 커서·실행 취소 기록·글자 조합이 끊긴다. 감싼 상자를 그대로 띄운다
//   (자식 자리 순서를 바꾸지 않는다: 막·머리는 켜졌을 때만 그 자리에 들어오고, 편집기 자리는 늘 같은 칸이다).
// ★ 켜고 끄는 버튼은 누를 때 편집기 포커스를 뺏지 않는다(onMouseDown preventDefault) — 떠나기(blur)가 곧 저장·반복 업무
//   «어디까지 반영» 물음인 칸이 있다(.claude/rules/ui-forms.md). 켜고 끄는 것은 떠나는 것이 아니다.
// 모양·문(Esc·뒤로 가기)·앱 설치 카드 비킴은 공용 focusShell — 메일 본문 크게 보기·문서 전체 화면과 같다.
import { useCallback, useState, type MouseEvent, type ReactNode } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { PanelBackButton } from '../Layout/PanelHeader';
import {
  focusBackdropCss, focusFloatingCss, useFocusShellExit, FocusModeIcon,
  FocusHead, FocusHeadText, FocusHeadTitle, FocusCloseBtn,
} from './focusShell';

// 앱 크롬·곁패널(≤130) 위, 그 안에서 여는 창(모달 1000~·메뉴 10000) 아래. 문서 전체 화면과 같은 층.
const FOCUS_Z = 900;

export function useFocusBlock() {
  const [on, setOn] = useState(false);
  const exit = useCallback(() => setOn(false), []);
  const toggle = useCallback(() => setOn((v) => !v), []);
  useFocusShellExit(on, exit);
  return { on, toggle, exit };
}

export function FocusBlockToggle({ on, onToggle, testId }: { on: boolean; onToggle: () => void; testId?: string }) {
  const { t } = useTranslation('common');
  const label = (on
    ? t('focusBlock.exit', { defaultValue: '크게 쓰기 끝내기' })
    : t('focusBlock.enter', { defaultValue: '크게 쓰기' })) as string;
  return (
    <ToggleBtn type="button" data-testid={testId} aria-pressed={on} title={label} aria-label={label}
      onMouseDown={(e) => e.preventDefault()} onClick={onToggle}>
      <FocusModeIcon on={on} />
    </ToggleBtn>
  );
}

export default function FocusBlock({ on, onExit, title, testId, children }: {
  on: boolean; onExit: () => void; title: string; testId?: string; children: ReactNode;
}) {
  const { t } = useTranslation('common');
  const close = t('focusBlock.exit', { defaultValue: '크게 쓰기 끝내기' }) as string;
  return (
    <>
      {on && <Backdrop data-testid={testId ? `${testId}-backdrop` : undefined} onMouseDown={onExit} />}
      <Frame $on={on} data-testid={on ? testId : undefined} role={on ? 'dialog' : undefined} aria-label={on ? title : undefined}>
        {on && (
          <FocusHead>
            <PanelBackButton onClick={onExit} label={close} />
            <FocusHeadText><FocusHeadTitle>{title}</FocusHeadTitle></FocusHeadText>
            <FocusCloseBtn type="button" onMouseDown={(e) => e.preventDefault()} onClick={onExit} aria-label={close} title={close}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </FocusCloseBtn>
          </FocusHead>
        )}
        <Inner $on={on} onMouseDown={on ? focusEditorEnd : undefined}>{children}</Inner>
      </Frame>
    </>
  );
}

// 판의 빈 곳(글 아래 여백)을 누르면 편집기 끝에 커서 — 편집기 높이는 글 길이만큼이라 아래 빈 판을 눌러도 아무 일이 없었다(2026-10-25 실측: 메모 22px · 답장 180px).
//   글·버튼·입력·링크를 누른 것은 그대로 둔다.
function focusEditorEnd(e: MouseEvent<HTMLDivElement>) {
  const target = e.target as HTMLElement;
  const pm = e.currentTarget.querySelector<HTMLElement>('.ProseMirror[contenteditable="true"]');
  if (!pm || pm.contains(target) || target.closest('button, input, textarea, select, a, [role="menu"], [role="listbox"]')) return;
  e.preventDefault();
  pm.focus();
  const range = document.createRange();
  range.selectNodeContents(pm);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

const Backdrop = styled.div`
  ${focusBackdropCss}
  z-index: ${FOCUS_Z};
`;
const Frame = styled.div<{ $on: boolean }>`
  ${(p) => (p.$on ? focusFloatingCss : '')}
  ${(p) => (p.$on ? `z-index: ${FOCUS_Z + 1};` : '')}
`;
// 켜졌을 때 판 안에서 스크롤 — 편집기 칸이 남는 높이를 다 쓴다(짧은 글도 판 바닥까지 눌러 쓸 수 있게).
const Inner = styled.div<{ $on: boolean }>`
  ${(p) => (p.$on ? `
    flex: 1; min-height: 0; overflow-y: auto; padding: 20px 24px;
    display: flex; flex-direction: column;
    & > * { flex: 1 0 auto; }
    @media (max-width: 768px) { padding: 12px; }
  ` : '')}
`;
const ToggleBtn = styled.button`
  flex-shrink: 0; margin-left: auto;
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; padding: 0;
  border: none; border-radius: 6px; background: transparent; color: #64748B; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 1px; }
  @media (max-width: 640px) { width: 40px; height: 40px; }
`;
