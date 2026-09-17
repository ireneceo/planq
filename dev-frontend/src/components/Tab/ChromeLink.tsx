// components/Tab/ChromeLink.tsx — ⑥ chrome 용 링크 (react-router Link 대체)
//
// chrome(사이드바 등)은 router-less zone 에 놓이므로 RR <Link> 를 못 쓴다. 대신 실제 <a href>를 렌더하되
// 무수식 좌클릭만 가로채 tabStore.openOrFocus 로 탭 전환. 미들클릭·⌘/Ctrl 클릭은 브라우저 기본(새 창/탭) 유지.
// styled(Link) 자리엔 styled(ChromeLink) 로 그대로 치환 가능(className/ref 포워딩).
import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { tabStore } from '../../stores/tabStore';

interface Props extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  /** 보던 탭을 덮지 않고 새 탭에서 연다(같은 화면이 열려 있으면 그 탭으로).
   *  알림·새 소식처럼 **하던 일 위에 얹히는** 진입점에서 켠다. */
  newTab?: boolean;
}

const ChromeLink = forwardRef<HTMLAnchorElement, Props>(function ChromeLink({ to, onClick, newTab, children, ...rest }, ref) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // 브라우저 기본에 양보
    e.preventDefault();

    // ★ **«같은 메뉴를 다시 누르면 그 메뉴 처음으로»** (2026-09-17, Irene #E).
    //   판정은 **여기**서 한다 — `navigateActive` 안에 두었더니 그 함수를 공유하는
    //   **알림 토스트·푸시 딥링크·검색 결과·Cue·뒤로가기**까지 쿼리를 잃었다.
    //   업무 목록을 보는 중에 업무 알림을 누르면 «아무 일도 안 일어남» 이 됐다
    //   (Fable 12차 차단1 실측 — 운영에 나갔던 회귀).
    //   ChromeLink 는 **사이드바 메뉴 클릭**이라는 의도를 아는 유일한 자리다.
    //   ★ 그리고 **목적지에 쿼리가 있으면 절대 건드리지 않는다** — 그건 딥링크지 메뉴가 아니다.
    if (!newTab && !to.includes('?')) {
      const here = (typeof window !== 'undefined' ? window.location.pathname : '').split('?')[0];
      if (here && here === to) {
        // URL 로 열린 상세·드로어는 쿼리가 빠지면서 닫히고, URL 에 없는 화면 상태(업무 추가 폼 등)는
        // 이 신호를 받아 접는다(hooks/useMenuReset).
        try { window.dispatchEvent(new CustomEvent('pq:menu-reset', { detail: { path: to } })); } catch { /* SSR */ }
      }
    }

    // 기본은 현재 탭 경로 변경(새 탭 X). ⌘/Ctrl 클릭 시 위에서 브라우저 새 탭에 양보.
    if (newTab) tabStore.openInNewTab(to);
    else tabStore.navigateActive(to);
  };
  return <a href={to} ref={ref} onClick={handle} {...rest}>{children}</a>;
});

export default ChromeLink;
