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
import styled, { css } from 'styled-components';
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

/** 띄운 판 — 화면 가운데 1100px(폰·좁은 태블릿은 꽉 참). 그 자리의 상자를 그대로 띄울 때(편집기를 옮기지 않을 때) 쓴다. */
export const focusFloatingCss = css`
  ${focusSurfaceCss}
  position: fixed;
  top: calc(var(--pq-popup-top, 0px) + 24px); bottom: 24px;
  left: 0; right: 0; margin: 0 auto;
  width: min(1100px, calc(100% - 48px));
  display: flex; flex-direction: column;
  @media (max-width: 768px) {
    top: var(--pq-popup-top, 0px); bottom: 0; width: 100%;
  }
`;

/* 판 머리 — 메일 본문 크게 보기에서 옮겨 왔다(값 그대로). 폰·태블릿(≤1024)은 ‹ 뒤로 하나, 데스크탑은 ✕. */
export const FocusHead = styled.div`
  display: flex; align-items: center; gap: 12px;
  min-height: 60px; padding: 14px 20px;
  background: #fff; border-bottom: 1px solid #e2e8f0;
`;
export const FocusHeadText = styled.div` flex: 1; min-width: 0; `;
export const FocusHeadTitle = styled.div`
  font-size: 1rem; font-weight: 700; letter-spacing: -0.2px; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
export const FocusHeadSub = styled.div`
  margin-top: 2px; font-size: 0.75rem; color: #64748B;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
export const FocusCloseBtn = styled.button`
  /* touch-target-44: 폰 터치 타깃 (theme/tokens CONTROL.touchMin). 데스크탑 크기는 그대로. */
  @media (max-width: 640px) { min-width: 44px; min-height: 44px; }

  flex-shrink: 0; width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 8px;
  color: #64748B; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
  @media (max-width: 1024px) { display: none; }
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
