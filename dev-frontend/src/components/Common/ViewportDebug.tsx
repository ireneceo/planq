// 임시 진단 — iOS standalone PWA 채팅 입력 버그용 viewport 실측 오버레이.
//   특정 사용자(Irene)에게만 노출. body 로 portal(앱이 밀려도 항상 보이게). 원인 파악 후 제거.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';

function snap() {
  const vv = window.visualViewport;
  const scroller = document.querySelector('[data-msglist]') as HTMLElement | null;
  return {
    iH: window.innerHeight,
    vvH: vv ? Math.round(vv.height) : -1,
    off: vv ? Math.round(vv.offsetTop) : -1,
    sY: Math.round(window.scrollY),
    kb: document.body.getAttribute('data-keyboard-up') || '0',
    vvh: (getComputedStyle(document.documentElement).getPropertyValue('--vvh').trim() || '(none)'),
    act: (document.activeElement?.tagName || '').toLowerCase(),
    listTop: scroller ? Math.round(scroller.scrollTop) : -1,
  };
}

const ViewportDebug: React.FC = () => {
  const [live, setLive] = useState(snap());
  const [focusSnap, setFocusSnap] = useState<string>('(입력란 탭하면 기록)');
  const focusTimers = useRef<number[]>([]);

  useEffect(() => {
    const vv = window.visualViewport;
    const upd = () => setLive(snap());
    const onFocusIn = () => {
      // 포커스 직후 키보드가 올라오는 동안 0/150/400ms 스냅샷을 한 줄로 박제
      focusTimers.current.forEach((t) => window.clearTimeout(t));
      const grab: string[] = [];
      const take = (ms: number) => window.setTimeout(() => {
        const s = snap();
        grab.push(`${ms}: vvH${s.vvH} off${s.off} sY${s.sY} kb${s.kb} top${s.listTop}`);
        setFocusSnap(grab.join('  |  '));
      }, ms);
      focusTimers.current = [take(0), take(150), take(400), take(800)];
    };
    upd();
    vv?.addEventListener('resize', upd);
    vv?.addEventListener('scroll', upd);
    window.addEventListener('scroll', upd, { passive: true });
    window.addEventListener('focusin', () => { upd(); onFocusIn(); });
    window.addEventListener('focusout', upd);
    const iv = window.setInterval(upd, 250);
    return () => {
      vv?.removeEventListener('resize', upd);
      vv?.removeEventListener('scroll', upd);
      window.removeEventListener('scroll', upd);
      window.removeEventListener('focusout', upd);
      window.clearInterval(iv);
      focusTimers.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return createPortal(
    <Box>
      <b>live</b> iH{live.iH} vvH{live.vvH} off{live.off} sY{live.sY} kb{live.kb} act:{live.act} top{live.listTop} vvh:{live.vvh}
      <br /><b>@focus</b> {focusSnap}
    </Box>,
    document.body,
  );
};

const Box = styled.div`
  position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
  background: rgba(0,0,0,0.85); color: #22ff66;
  font: 10.5px/1.5 ui-monospace, monospace; padding: 3px 6px;
  pointer-events: none; text-align: left; letter-spacing: -0.3px;
  b { color: #ffcc00; }
`;

export default ViewportDebug;
