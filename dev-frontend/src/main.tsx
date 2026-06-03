import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './i18n'
import './index.css'
import App from './App.tsx'
import { bindPermissionSync } from './services/push.ts'

// Service Worker 등록 — Push 알림 + Share Target POST + PWA install 모두 SW 필요.
// updateViaCache:'none' — 브라우저가 sw.js 자체를 캐시하지 않게 강제 (옛 SW 잔류 방지).
// 새 SW 가 install 되면 activate 단계에서 모든 client 자동 navigate (옛 chunk 잔재 정리).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
      // 30분 주기 update 체크 — 새 SW 발견 시 install→activate 자동 진행
      setInterval(() => { reg.update().catch(() => {}); }, 30 * 60 * 1000);
    }).catch(() => { /* silent */ });
  });
}

// 알림 권한 동기화 — focus 복귀 시 OS 권한 OFF 면 backend 의 좀비 endpoint 자동 정리
bindPermissionSync();

// N+31 — 글로벌 viewport sync. visualViewport.height 를 --vvh CSS var 로 즉시 sync.
// 옛 코드는 ChatPanel useEffect 안에서만 sync 했음 → 첫 paint race + 다른 페이지에서 --vvh 부재.
// 글로벌로 옮겨 모든 페이지가 진입 직후부터 정확한 viewport 사용. iOS PWA standalone 의
// 100dvh 지연 회귀 + body(정적 layout viewport) 와 자식(동적 vvh) 불일치 차단.
if (typeof window !== 'undefined' && window.visualViewport) {
  const vv = window.visualViewport;
  const update = () => {
    const isUp = vv.height < window.innerHeight * 0.70;
    if (isUp) document.body.setAttribute('data-keyboard-up', '1');
    else document.body.removeAttribute('data-keyboard-up');
    document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
  };
  update();
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  window.addEventListener('orientationchange', update);
  // focusin/focusout — textarea/input focus 가 visualViewport.resize 보다 늦게 fire 되는 iOS 케이스 보정
  window.addEventListener('focusin', () => requestAnimationFrame(update));
  window.addEventListener('focusout', () => requestAnimationFrame(update));
}

// (제거) UpdateBanner 시스템 — version.json 폴링 + Socket build_id broadcast + 자동 reload.
// 사이클 N+3 에서 회귀 발생 (cache-bust query 무한 누적 + 빌드 잦은 dev 환경에서 banner 짜증) →
// 시스템 통째 제거. 새 빌드는 사용자 일반 reload 시 nginx HTML no-cache + SW updateViaCache:'none'
// 으로 충분히 받음. SW activate 가 옛 client 자동 정리.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
