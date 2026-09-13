/**
 * DetailDrawer — 우측 상세/편집 드로어 공통 프리미티브
 *
 * 반응형 정책:
 *  - 데스크탑 (≥1025px): 지정한 width (default 440px) 사이드 드로어
 *  - 태블릿 (641~1024px): 90vw, 최대 560px
 *  - 폰 (≤640px): 100vw 풀스크린 오버레이 (border-radius 제거)
 *
 * 기본 동작:
 *  - Backdrop 클릭 닫기, Esc 닫기 (props 로 비활성 가능)
 *  - **뒤 화면 스크롤은 막지 않는다** (2026-09-13 계약 변경 — 아래 참조)
 *  - 열림 시 슬라이드 인 애니메이션
 *
 * ★ 2026-09-13 — 우측 곁패널은 **뒤 화면 스크롤을 잠그지 않는다.**
 *   Irene: *"우측패널들 열려있어도 좌측에 나오는 화면은 스크롤 반응하게 해. 고정할 필요 있어?
 *   어둡게 했으면 됐지. 리스트들이든 뭐든 스크롤 반응은 막지마."*
 *   목록을 보면서 패널을 함께 보는 것이 이 패널의 용도다 — 잠그면 "옆 목록에서 다음 것을 찾는" 동선이 끊긴다.
 *
 *   막는 것이 **두 겹**이었다. 하나만 풀면 여전히 안 움직인다:
 *     ① `useBodyScrollLock` — 문서 스크롤을 잠갔다 (제거)
 *     ② 백드롭이 화면을 **덮고 있다** — 휠은 백드롭의 스크롤 조상(= body)을 찾으므로,
 *        패널 안이 아닌 실제 목록(overflow:auto 인 안쪽 div)은 한 픽셀도 안 움직인다.
 *        그래서 백드롭이 받은 휠·터치를 **밑에 있는 스크롤 가능한 요소로 넘긴다.**
 *   백드롭의 클릭(=닫기)은 그대로 둔다 — 포털로 뜨는 팝오버·모달은 백드롭보다 위에 그려져
 *   자기 클릭을 직접 받으므로 영향이 없다.
 *
 *   ★ 가운데 모달(components/UI/Modal)은 이 변경에서 **제외**다 — 전면을 덮는 창은 뒤가 움직이면 안 된다.
 *
 * 사용 예:
 *   <DetailDrawer open={!!selected} onClose={close} width={440} ariaLabel="일정 상세">
 *     <DetailDrawer.Header onClose={close}>
 *       <Title>제목</Title>
 *     </DetailDrawer.Header>
 *     <DetailDrawer.Body>...</DetailDrawer.Body>
 *     <DetailDrawer.Footer>...</DetailDrawer.Footer>
 *   </DetailDrawer>
 */
import React, { useEffect, useRef } from 'react';
import styled, { keyframes } from 'styled-components';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { mediaPhone } from '../../theme/breakpoints';

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  width?: number;                 // 데스크탑 폭 (default 440)
  ariaLabel?: string;
  closeOnBackdrop?: boolean;      // default true
  closeOnEsc?: boolean;           // default true
  children: React.ReactNode;
}

const DetailDrawerRoot: React.FC<DetailDrawerProps> = ({
  open, onClose, width = 480, ariaLabel,
  closeOnBackdrop = true, closeOnEsc = true,
  children,
}) => {
  const panelRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  useEscapeStack(open && closeOnEsc, onClose);
  useFocusTrap(panelRef, open);
  // 백드롭이 먹은 스크롤을 **밑으로 넘긴다** (위 머리말 ②)
  usePassThroughScroll(backdropRef, open);

  if (!open) return null;

  return (
    <>
      <Backdrop ref={backdropRef} onClick={closeOnBackdrop ? onClose : undefined} />
      <Panel
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        /* 스크롤 통과가 **패널 자신을 굴리지 않게** 하는 표식 (usePassThroughScroll) */
        data-pq-drawer-panel=""
        $width={width}
      >
        {children}
      </Panel>
    </>
  );
};

// ─── 서브 컴포넌트 ───
interface HeaderProps {
  onClose: () => void;
  children: React.ReactNode;
}
const Header: React.FC<HeaderProps> = ({ onClose, children }) => (
  <HeaderWrap>
    {/* ★ 2026-08-25 (Irene: "일정에서 상세 들어가면 뒤로가기 화살표도 안나와")
        폰에서 이 드로어는 전체화면이라 "닫기 X" 가 아니라 **뒤로가기**로 읽힌다.
        다른 화면(PanelBackButton)과 같은 자리·같은 모양으로 좌측 상단에 둔다.
        공용 프리미티브에 넣었으므로 일정·업무·고객 상세가 한 번에 통일된다. */}
    <BackBtn onClick={onClose} aria-label="back">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </BackBtn>
    <HeaderContent>{children}</HeaderContent>
    <CloseBtn onClick={onClose} aria-label="close">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </CloseBtn>
  </HeaderWrap>
);

const Body = styled.div`
  flex: 1; overflow-y: auto; overflow-x: hidden;
  /* ★ 패널 **안**을 끝까지 굴렸을 때 그 힘이 뒤 화면으로 넘어가지 않게(scroll chaining).
     배경 잠금을 푼 뒤로는 이것이 없으면 패널 목록 끝에서 뒤 화면이 딸려 움직인다 —
     폰에서는 드로어가 전체화면이라 **보이지도 않는 채** 뒤 스크롤 위치가 바뀐다.
     뒤 화면을 **일부러** 굴리는 것(백드롭 위에서)은 그대로 된다. */
  overscroll-behavior: contain;
  padding: 18px;
  display: flex; flex-direction: column; gap: 18px;
  /* iOS safe-area 하단 여유 */
  padding-bottom: calc(18px + var(--pq-safe-bottom, 0px));
`;

const Footer = styled.div`
  padding: 12px 18px; border-top: 1px solid #E2E8F0;
  display: flex; justify-content: flex-end; gap: 8px; align-items: center;
  padding-bottom: calc(12px + var(--pq-safe-bottom, 0px));
`;

type DetailDrawerType = React.FC<DetailDrawerProps> & {
  Header: React.FC<HeaderProps>;
  Body: typeof Body;
  Footer: typeof Footer;
};
const DetailDrawer = DetailDrawerRoot as DetailDrawerType;
DetailDrawer.Header = Header;
DetailDrawer.Body = Body;
DetailDrawer.Footer = Footer;

export default DetailDrawer;

// ─── styled ───
const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`;
const slideInRight = keyframes`
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
`;

/** 좌표 (x,y) 밑에서 **실제로 스크롤될 수 있는** 첫 요소를 찾아 굴린다.
 *
 *  ★ 백드롭 자신과 드로어 패널은 건너뛴다. `elementsFromPoint` 는 위에서부터 주므로
 *    목록 행 → 목록 → 패널 셸 순으로 내려가며 처음 만나는 스크롤 컨테이너가 정답이다.
 *  ★ 조상 중에 스크롤 컨테이너가 없으면 문서가 받게 둔다(false 를 돌려 기본 동작 유지) —
 *    좁은 폭에서는 패널이 아니라 **바깥 셸이 스크롤**하는 화면이 있다.
 */
function scrollBeneath(x: number, y: number, dx: number, dy: number, skip: Element[]): boolean {
  const stack = document.elementsFromPoint(x, y);
  for (const el of stack) {
    if (skip.some((s) => s === el || s.contains(el))) continue;
    if (!(el instanceof HTMLElement)) continue;
    const st = window.getComputedStyle(el);
    const canY = /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight;
    const canX = /(auto|scroll)/.test(st.overflowX) && el.scrollWidth > el.clientWidth;
    if (canY || canX) {
      el.scrollBy({ top: canY ? dy : 0, left: canX ? dx : 0, behavior: 'instant' as ScrollBehavior });
      return true;
    }
  }
  return false;
}

/** 백드롭이 받은 휠·터치를 밑으로 넘긴다.
 *  ★ React 의 onWheel/onTouchMove 는 **passive** 로 붙어 preventDefault 가 통하지 않는다 —
 *    그대로 두면 우리가 굴린 만큼 문서도 같이 굴러 두 번 움직인다. 그래서 직접 붙인다. */
function usePassThroughScroll(ref: React.RefObject<HTMLDivElement | null>, open: boolean) {
  useEffect(() => {
    const node = ref.current;
    if (!open || !node) return undefined;
    const skip = () => [node, ...Array.from(document.querySelectorAll('[data-pq-drawer-panel]'))];
    const onWheel = (e: WheelEvent) => {
      if (scrollBeneath(e.clientX, e.clientY, e.deltaX, e.deltaY, skip())) e.preventDefault();
    };
    let lastY = 0; let lastX = 0;
    const onTouchStart = (e: TouchEvent) => {
      const tch = e.touches[0]; if (!tch) return;
      lastY = tch.clientY; lastX = tch.clientX;
    };
    const onTouchMove = (e: TouchEvent) => {
      const tch = e.touches[0]; if (!tch) return;
      const dy = lastY - tch.clientY; const dx = lastX - tch.clientX;
      lastY = tch.clientY; lastX = tch.clientX;
      if (scrollBeneath(tch.clientX, tch.clientY, dx, dy, skip())) e.preventDefault();
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
    };
  }, [ref, open]);
}

const Backdrop = styled.div`
  /* --chrome-top: 멀티탭 스트립 높이(MainLayout 이 세팅). 탭바는 브라우저 크롬이라 덮지 않는다(#199).
     탭모드가 아니면 0 이라 기존 동작과 동일. */
  position: fixed; top: var(--chrome-top, 0px); left: 0; right: 0; bottom: 0;
  background: rgba(15, 23, 42, 0.08);
  /* RightDock FAB(z-index 120) 위로 — 드로어 열리면 우하단 퀵메뉴가 드로어를 뚫고 나오지 않게.
     위계: 페이지크롬(99·100) < FAB(120) < 드로어(125·130) < 센터모달(1000+). */
  z-index: 125;
  animation: ${fadeIn} 0.22s ease-out;
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;

// 공통 드로어 폭 규칙 — 항상 왼쪽 56px strip 남겨 햄버거 패턴처럼 바깥 탭 = 닫기
// 모바일 키보드 대응(#79): 높이를 bottom:0(레이아웃 뷰포트) 대신 --vvh(visual viewport)에 바운드.
//   키보드가 올라오면 --vvh 가 줄어 Panel 이 같이 줄고 → Body(flex:1) 스크롤 + Footer(액션바)가
//   항상 키보드 위에 유지된다. 데스크탑은 --vvh = 전체 높이라 무변경.
const Panel = styled.aside<{ $width: number }>`
  /* --vv-top: iOS 가 키보드를 올리며 visual viewport 를 밀어낸 양(main.tsx 가 sync).
     이걸 안 더하면 fixed 패널이 화면 위로 밀려 **헤더와 제목이 잘려 나간다**.
     키보드 없음/데스크탑 = 0 → 기존과 동일. */
  position: fixed; top: calc(var(--chrome-top, 0px) + var(--vv-top, 0px)); right: 0;
  height: calc(var(--vvh, 100dvh) - var(--chrome-top, 0px));
  z-index: 130;
  background: #fff;
  display: flex; flex-direction: column;
  border-left: 1px solid #E2E8F0;
  box-shadow: -16px 0 40px rgba(15, 23, 42, 0.14);
  animation: ${slideInRight} 0.28s cubic-bezier(0.22, 1, 0.36, 1);
  width: min(${({ $width }) => $width}px, calc(100vw - 56px));
  /* ≤640px — 문서화된 계약(파일 상단 §)대로 100vw 풀스크린. 여태 min(width,100vw-56)만 있어
     폰에서도 56px 조각이 남아 뒤 화면이 비쳤다(새 일정 드로어 왼쪽 달력 노출). 풀스크린이면
     좌측 border·그림자도 불필요, 하단 safe-area 확보. DetailDrawer 쓰는 모든 드로어에 일괄 적용. */
  /* ★ 운영 #266 — 여기에 padding-bottom: var(--pq-safe-bottom, 0px) 를 두지 말 것.
     Body(L~90)와 Footer(L~96), 그리고 공용 DrawerFooter 가 **각자** safe-area 를 이미 보정한다.
     Panel 에도 주면 iPhone 에서 푸터 아래에 34px 짜리 빈 흰 띠가 한 겹 더 생긴다
     (Irene: "하단에 푸터부분이 너무 넓어. 여백이 많아"). 하단 보정은 안쪽 요소가 책임진다. */
  ${mediaPhone} {
    width: 100vw;
    border-left: none;
    box-shadow: none;
  }
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;

const HeaderWrap = styled.div`
  display: flex; align-items: flex-start; gap: 10px;
  padding: 16px 18px 14px;
  border-bottom: 1px solid #E2E8F0;
  flex-shrink: 0;
  /* iOS safe-area 상단 여유 — 상태바 영역 */
  padding-top: calc(16px + var(--pq-safe-top, 0px));
`;

const HeaderContent = styled.div` flex: 1; min-width: 0; `;

const BackBtn = styled.button`
  /* 데스크탑에는 옆에 목록이 그대로 보이므로 필요 없다 — 폰·태블릿에서만. */
  display: none;
  @media (max-width: 1024px) {
    display: inline-flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; margin-left: -6px;
    border: none; background: transparent; color: #475569;
    border-radius: 8px; cursor: pointer; flex-shrink: 0;
    &:hover { background: #F1F5F9; color: #0F172A; }
    &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
  }
  @media (max-width: 640px) { width: 44px; height: 44px; }
`;

const CloseBtn = styled.button`
  /* touch-target-44: 폰 터치 타깃 (theme/tokens CONTROL.touchMin). 데스크탑 크기는 그대로. */
  @media (max-width: 640px) { min-width: 44px; min-height: 44px; }

  width: 34px; height: 34px; border: none; background: transparent;
  color: #64748B; border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  &:hover { background: #F1F5F9; color: #0F172A; }
  /* 폰에서 터치 타겟 확대 */
  @media (max-width: 640px) {
    width: 40px; height: 40px;
  }
`;
