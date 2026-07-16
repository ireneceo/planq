import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import App from './App.tsx'
import { bindPermissionSync } from './services/push.ts'
import { isNativeApp } from './services/native'

// Service Worker 등록 — Push 알림 + Share Target POST + PWA install 모두 SW 필요.
// updateViaCache:'none' — 브라우저가 sw.js 자체를 캐시하지 않게 강제 (옛 SW 잔류 방지).
// 새 SW 가 install 되면 activate 단계에서 모든 client 자동 navigate (옛 chunk 잔재 정리).
// 네이티브 앱(Capacitor)에서는 SW 를 등록하지 않는다: iOS WKWebView 는 SW 미지원이라 자연 skip
// 되지만 Android WebView 는 SW 를 지원하므로 명시 가드 필요(MOBILE_APP_DESIGN §6.6). 네이티브는
// 웹 푸시 대신 APNs/FCM(Phase 2) 을 쓰고, 빌드 갱신은 remote URL 로 자동 반영된다.
if (!isNativeApp() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
      // 30분 주기 update 체크 — 새 SW 발견 시 install→activate 자동 진행
      setInterval(() => { reg.update().catch(() => {}); }, 30 * 60 * 1000);
    }).catch(() => { /* silent */ });
  });
}

// 알림 권한 동기화 — focus 복귀 시 OS 권한 OFF 면 backend 의 좀비 endpoint 자동 정리.
// 웹 푸시 전용 로직이라 네이티브 앱에서는 skip (네이티브 푸시는 Phase 2 nativePush 가 담당).
if (!isNativeApp()) {
  bindPermissionSync();
}

// 네이티브 앱 부트스트랩 — 상태바 스타일(흰 배경 + 어두운 글자). 웹/PWA 에는 영향 0.
if (isNativeApp()) {
  import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
    StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  }).catch(() => {});
}

// N+31 — 글로벌 viewport sync. visualViewport.height 를 --vvh CSS var 로 즉시 sync.
// 옛 코드는 ChatPanel useEffect 안에서만 sync 했음 → 첫 paint race + 다른 페이지에서 --vvh 부재.
// 글로벌로 옮겨 모든 페이지가 진입 직후부터 정확한 viewport 사용. iOS PWA standalone 의
// 100dvh 지연 회귀 + body(정적 layout viewport) 와 자식(동적 vvh) 불일치 차단.
if (typeof window !== 'undefined' && window.visualViewport) {
  const vv = window.visualViewport;
  const mq = window.matchMedia('(max-width: 768px)');
  // 키보드 판정 안정 기준 높이. iOS PWA standalone 은 키보드 up 시 innerHeight 자체가
  // 줄어드는 경우가 있어 (실측 VVDIAG: iH 793→417) live innerHeight 로 isUp 판정하면
  // 오판. orientation/툴바 복귀로만 갱신되는 최대값을 기준으로 사용.
  let fullH = window.innerHeight;
  const update = () => {
    if (window.innerHeight > fullH) fullH = window.innerHeight;
    const isUp = vv.height < fullH * 0.70;
    if (isUp) document.body.setAttribute('data-keyboard-up', '1');
    else document.body.removeAttribute('data-keyboard-up');
    document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
    // 키보드 높이 — fixed 바닥바/FAB 가 필요 시 이만큼 리프트하는 데 사용.
    document.documentElement.style.setProperty('--keyboard-height', `${Math.max(0, fullH - vv.height)}px`);
    // iOS PWA standalone phantom scroll 차단 (근본 fix). 입력란 focus 시 iOS 가
    // document 를 키보드 높이만큼 스크롤 (실측 VVDIAG: 깨진 focus 는 window.scrollY/
    // visualViewport.offsetTop=376, 정상 focus 는 0). position:fixed body 가 이를
    // 못 되돌려 콘텐츠가 위로 밀리고 아래 흰 여백 → 강제로 0 정렬해 고정 레이아웃을
    // visual viewport 에 맞춤. 모바일 고정 레이아웃에서만 (데스크탑 정상 스크롤 보호).
    // 단, 앱 셸(pq-app-shell)에서만 — 랜딩/회원가입/공개 페이지는 body 스크롤이
    // 정상 동작이라 scrollTo(0,0) 가 사용자 스크롤을 위로 튕겨내면 안 됨.
    if (mq.matches && document.documentElement.classList.contains('pq-app-shell')
        && (window.scrollY !== 0 || vv.offsetTop !== 0)) {
      window.scrollTo(0, 0);
    }
  };
  update();
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  window.addEventListener('orientationchange', () => { fullH = window.innerHeight; requestAnimationFrame(update); });
  // focusin/focusout — textarea/input focus 가 visualViewport.resize 보다 늦게 fire 되는 iOS 케이스 보정
  // #79 — 모바일에서 focus 된 입력이 키보드에 가리지 않게, 스크롤 컨테이너(모달 body 등) 안에서
  //   가운데로 올린다. 모달은 대부분 --vvh 로 바운드돼 있어(StandardModal/NewEventModal 등) scrollIntoView
  //   가 window 가 아닌 그 컨테이너를 스크롤 → 입력이 키보드 위 가시영역으로. 키보드 애니메이션(~320ms)
  //   + --vvh 갱신 후 실행. 편집 가능한 필드만, 모바일만 (데스크탑 불필요 스크롤 방지).
  // #79/#111 — focus 된 입력(또는 contentEditable 캐럿)이 키보드에 "가려졌을 때만" 최소 스크롤.
  //   옛 코드는 focus 마다 scrollIntoView({block:'center'}) 로 화면을 홱 당겨(#111 "문서편집이 자꾸
  //   아래로 내려감", 표 열추가 시 점프) UX 를 해쳤다. 이제 (a) 가시영역(vv.height) 밖일 때만,
  //   (b) contentEditable 은 요소가 아닌 캐럿(selection) rect 기준, (c) 넘친 만큼만 스크롤한다.
  const findScrollParent = (node: HTMLElement | null): HTMLElement | null => {
    let el = node?.parentElement || null;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return null;
  };
  const ensureFocusedVisible = () => {
    if (!mq.matches) return;
    const el = document.activeElement as HTMLElement | null;
    if (!el) return;
    const tag = el.tagName;
    const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    if (!editable) return;
    setTimeout(() => {
      try {
        if (document.activeElement !== el) return;
        // 기준 rect: contentEditable 은 캐럿, 그 외는 요소.
        let rect = el.getBoundingClientRect();
        if (el.isContentEditable) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const rects = sel.getRangeAt(0).getClientRects();
            if (rects.length) rect = rects[rects.length - 1];
          }
        }
        const margin = 24;
        const visibleBottom = vv.height;               // offsetTop 0 강제라 상단=0, 하단=vv.height
        if (rect.bottom > visibleBottom - margin) {
          // 키보드에 가려짐 — 넘친 만큼만 스크롤 컨테이너를 내린다(과도한 center 점프 방지).
          const delta = rect.bottom - (visibleBottom - margin);
          const scroller = findScrollParent(el);
          if (scroller) scroller.scrollTop += delta;
          else if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
        }
        // 이미 보이면 아무것도 안 함 (#111 자동 스크롤 방지).
      } catch { /* noop */ }
    }, 320);
  };
  window.addEventListener('focusin', () => { requestAnimationFrame(update); ensureFocusedVisible(); });
  window.addEventListener('focusout', () => requestAnimationFrame(update));
}

// (제거) UpdateBanner 시스템 — version.json 폴링 + Socket build_id broadcast + 자동 reload.
// 사이클 N+3 에서 회귀 발생 (cache-bust query 무한 누적 + 빌드 잦은 dev 환경에서 banner 짜증) →
// 시스템 통째 제거. 새 빌드는 사용자 일반 reload 시 nginx HTML no-cache + SW updateViaCache:'none'
// 으로 충분히 받음. SW activate 가 옛 client 자동 정리.

// ⑥ 멀티탭 — BrowserRouter 는 App 내부 ModeGate 가 shell 경로에서만 감싼다(tree-swap 은 router-less zone).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
