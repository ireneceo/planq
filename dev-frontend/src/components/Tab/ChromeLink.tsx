// components/Tab/ChromeLink.tsx — ⑥ chrome 용 링크 (react-router Link 대체)
//
// chrome(사이드바 등)은 router-less zone 에 놓이므로 RR <Link> 를 못 쓴다. 대신 실제 <a href>를 렌더하되
// 무수식 좌클릭만 가로채 tabStore.openOrFocus 로 탭 전환. 미들클릭·⌘/Ctrl 클릭은 브라우저 기본(새 창/탭) 유지.
// styled(Link) 자리엔 styled(ChromeLink) 로 그대로 치환 가능(className/ref 포워딩).
import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { tabStore } from '../../stores/tabStore';

interface Props extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
}

const ChromeLink = forwardRef<HTMLAnchorElement, Props>(function ChromeLink({ to, onClick, children, ...rest }, ref) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // 브라우저 기본에 양보
    e.preventDefault();
    tabStore.openOrFocus(to);
  };
  return <a href={to} ref={ref} onClick={handle} {...rest}>{children}</a>;
});

export default ChromeLink;
