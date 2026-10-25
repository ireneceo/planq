// components/Common/focusShell.tsx — «크게 보기·집중 편집» 공용 껍데기 (2026-10-25)
//
// Irene: "프로젝트>문서>편집에 가면 상단에 보이는게 너무 많아 … 편집화면을 전체로 하는 기능 …
//         다른 곳도 이런 방식으로 같이 좋게 활용할 UI/UX" → «권고대로»(메일 본문 크게 보기와 모양을 맞춘다).
//
// 메일 본문 크게 보기(MailBodyFullscreen)가 먼저 있던 모양이다 — 어두운 막 + 가운데 흰 판(폰은 꽉 찬 화면).
// 그 값을 여기로 옮겨 둘이 같이 쓴다. 베끼면 한쪽만 고쳐진다(.claude/rules/ui-components.md «껍데기는 빼서 같이 쓴다»).
//   · 막은 앱 머리줄 아래(--pq-popup-top)에서 시작한다 — 폰에서 PlanQ 머리줄을 가리지 않는다(가드 popuptop).
//   · 닫는 문은 Esc 와 뒤로 가기 둘 다 — useFocusShellExit 한 줄.
// 새로 «크게 보기/집중 편집» 을 붙이는 화면은 이 조각과 FocusModeIcon 을 쓴다.
import { useEffect } from 'react';
import { css } from 'styled-components';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useBackToClose } from '../../hooks/useBackToClose';

/** 어두운 막 — 화면 전체(앱 머리줄 아래부터). z-index 는 쓰는 곳이 정한다(메일 1200 · 문서 편집 900). */
export const focusBackdropCss = css`
  position: fixed; inset: var(--pq-popup-top, 0px) 0 0;
  background: rgba(15, 23, 42, 0.55);
`;

/** 흰 판 — 둥근 모서리·그림자. 폰·좁은 태블릿(≤768)은 꽉 찬 화면이라 모서리·그림자를 뺀다. */
export const focusSurfaceCss = css`
  background: #fff; border-radius: 14px; overflow: hidden;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28);
  @media (max-width: 768px) {
    border-radius: 0; box-shadow: none;
    /* 막이 앱 머리줄 아래에서 시작하므로 상태바는 그 머리줄이 이미 비웠다 — 탭 모드 등 머리줄이 없을 때만 값이 있다. */
    padding-top: var(--pq-popup-safe-pad, 0px);
    padding-bottom: var(--pq-safe-bottom, 0px);
  }
`;

/** 여닫는 문 — Esc(가장 위 창만) · 폰 뒤로 가기. 열린 동안 body[data-focus-shell='1'] —
 *  떠 있는 홍보 카드(앱 설치 z 8500)처럼 이 판보다 위에 앉는 것이 비켜서는 신호다. */
export function useFocusShellExit(open: boolean, onClose: () => void): void {
  useEscapeStack(open, onClose);
  useBackToClose(open, onClose);
  useEffect(() => {
    if (!open) return;
    document.body.dataset.focusShell = '1';
    return () => { delete document.body.dataset.focusShell; };
  }, [open]);
}

/** 크게 보기 켜기(바깥 화살표) / 끄기(안쪽 화살표) 아이콘. */
export function FocusModeIcon({ on, size = 16 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {on ? (
        <>
          <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
          <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
        </>
      ) : (
        <>
          <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
        </>
      )}
    </svg>
  );
}
