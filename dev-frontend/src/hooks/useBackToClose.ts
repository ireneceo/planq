import { useEffect, useRef } from 'react';

// ─── 뒤로 가기 = 패널 닫기 (폰·태블릿) ──────────────────────────────────────
// 2026-09-29 운영 #437 (Irene: "모바일에서 확인필요에서 업무 누르면 닫지도 못하고 뒤로도 못가고 …
//   이거 그냥 업무해도 나왔다가 뒤로가면 다시 확인필요 나오면 되는 거 아니야? 다른 우측패널도
//   다 동일해야 할 듯 해. 헬프도.")
//
// 폰에서 우측패널은 전체화면이라 사용자에게는 **새 화면**이다. 그런데 화면 상태(useState)로만 열면
// 히스토리에 흔적이 없어서, 뒤로 가기(iOS 스와이프·안드로이드 뒤로 버튼·브라우저)가 패널이 아니라
// **그 밑의 페이지를 떠난다**(실측: 확인필요 → 업무 → 뒤로 = /dashboard).
//
// 그래서 패널이 열리는 순간 **같은 주소로 히스토리 한 칸**을 쌓고, 그 칸이 빠지면(뒤로) 패널을 닫는다.
//
// ★ 주소로 여는 패널(`?task=` 등)은 건드리지 않는다. 그것은 열 때 이미 한 칸이 쌓였고, 뒤로 가면
//   주소가 바뀌어 스스로 닫힌다. 거기에 칸을 또 쌓으면 뒤로를 두 번 눌러야 닫힌다.
//   판정: 패널이 열리기 직전(NAV_WINDOW_MS)에 **칸을 쌓는** 주소 이동(pushState)이 있었는가.
//   있었으면 = 주소 이동과 함께 열렸다 = 주소가 이미 히스토리를 맡는다.
//   (라우터 키로 재면 조건부로 마운트되는 패널 — `{id && <Drawer/>}` — 은 "열리기 전" 이 없어 못 잰다.)
// ★ 닫기 버튼(X·돌아가기·백드롭·Esc)으로 닫으면 쌓아 둔 칸을 **스스로 걷는다**(history.back).
//   안 걷으면 뒤로를 한 번 더 눌러야 페이지를 떠나는 "먹통 뒤로" 가 된다.
// ★ 탭 모드(데스크탑·태블릿)에서는 쓰지 않는다 — 탭 모드의 히스토리는 tabStore·UrlMirror 가 맡는다.
// ★ 라우터 상태(idx·key)는 **보존**한 채 표식만 더한다 — 안 그러면 라우터가 자기 위치를 잃는다.

const MARK = '__pqOverlay';
const MOBILE_Q = '(max-width: 1024px)';

type Entry = { token: number; close: () => void };
const stack: Entry[] = [];
let seq = 0;

function currentMark(): number | null {
  const s = window.history.state as Record<string, unknown> | null;
  const v = s && s[MARK];
  return typeof v === 'number' ? v : null;
}

// 마지막 «칸을 쌓는» 주소 이동 시각 — 라우터가 부르는 pushState 를 한 번 감싸 잰다(우리 표식 칸은 빼고).
const NAV_WINDOW_MS = 700;
let lastNavAt = 0;
let ownPush = false;
// 마지막 «덮어쓰기» 이동 — 어디서 어디로 갔는가. 주소를 replace 로 바꿔 여는 패널(Q task `?task=`)을 알아본다.
let lastReplace: { at: number; from: string; to: string } | null = null;
if (typeof window !== 'undefined' && window.history) {
  const origPush = window.history.pushState.bind(window.history);
  window.history.pushState = (...args: Parameters<History['pushState']>) => {
    if (!ownPush) lastNavAt = Date.now();
    return origPush(...args);
  };
  const origReplace = window.history.replaceState.bind(window.history);
  window.history.replaceState = (...args: Parameters<History['replaceState']>) => {
    if (ownPush) return origReplace(...args);
    const from = window.location.href;
    // 열린 패널의 칸을 라우터가 덮어쓰면(닫으며 `?task=` 를 지우는 replace 등) 표식을 **잇는다** —
    //   표식이 사라지면 그 칸이 우리 것인지 몰라 걷지 못하고, 뒤로를 한 번 더 눌러야 떠나게 된다.
    const cur = currentMark();
    let [state, unused, url] = args;
    if (cur !== null && stack.some((e) => e.token === cur)) {
      const st = (state && typeof state === 'object') ? state as Record<string, unknown> : {};
      if (st[MARK] === undefined) state = { ...st, [MARK]: cur };
    }
    const r = origReplace(state, unused, url);
    if (window.location.href !== from) lastReplace = { at: Date.now(), from, to: window.location.href };
    return r;
  };
}

// 버튼으로 닫으며 우리가 부른 back() 이 도착할 칸에 **씌울 주소**.
//   주소를 바꿔 여는 패널(`?task=`)은 닫을 때 라우터가 표식 칸의 주소를 «닫힌 주소» 로 덮어쓴다.
//   그런데 걷어 내려가 닿는 아래 칸은 여전히 «열린 주소» 일 수 있다(처음부터 `?task=` 로 들어온 경우).
//   거기 닿으면 화면이 주소를 읽어 **패널이 다시 열린다.** 그래서 닿기 직전에 닫힌 주소로 바꿔 둔다.
let pendingFixUrl: string | null = null;

const attachOnce = (() => {
  let attached = false;
  return () => {
    if (attached || typeof window === 'undefined') return;
    attached = true;
    // ★ capture — 창(window)이 대상일 때 capture 리스너가 먼저 돈다. 라우터가 주소를 읽기 **전에**
    //   위 «씌울 주소» 를 적용해야 라우터가 옛 주소(`?task=`)로 한 번 그렸다가 되돌아가지 않는다.
    window.addEventListener('popstate', () => {
      if (pendingFixUrl) {
        const url = pendingFixUrl; pendingFixUrl = null;
        ownPush = true;
        try { window.history.replaceState(window.history.state, '', url); } finally { ownPush = false; }
        return; // 우리가 부른 back — 이미 스택에서 뺐다
      }
      // 뒤로 가서 **맨 위 패널의 칸**을 벗어났으면 그 패널을 닫는다(한 번에 하나 — 중첩은 하나씩).
      const top = stack[stack.length - 1];
      if (!top) return;
      if (currentMark() === top.token) return;
      stack.pop();
      // 닫기는 라우터가 이 이동을 다 반영한 **뒤에** — 닫으며 주소를 바꾸는 패널이 라우터와 엇갈리지 않게.
      setTimeout(() => top.close(), 0);
    }, true);
  };
})();

export function useBackToClose(active: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;
    if (!window.matchMedia || !window.matchMedia(MOBILE_Q).matches) return undefined;
    // 탭 모드(태블릿 가로·세로 포함)는 브라우저 히스토리를 tabStore·UrlMirror 가 맡는다 — 탭 안 이동마다
    //   칸을 쌓고 뒤로를 탭 안으로 되돌린다. 거기에 우리가 칸을 또 쌓으면 둘이 엇갈려, X 로 닫은 업무가
    //   뒤로 가기에 **다시 열렸다**(768 실측). 폭이 아니라 모드로 가른다.
    if (document.documentElement.classList.contains('pq-tabmode')) return undefined;
    // 주소 이동과 함께 열렸다 → 주소가 이미 뒤로를 맡는다.
    if (Date.now() - lastNavAt < NAV_WINDOW_MS) return undefined;

    attachOnce();
    const entry: Entry = { token: ++seq, close: () => closeRef.current() };
    const base = (window.history.state && typeof window.history.state === 'object') ? window.history.state : {};
    const here = window.location.href;
    ownPush = true;
    try {
      // 주소를 **덮어써서** 연 패널(Q task `?task=`) — 아래 칸이 이미 «열린 주소» 라서, 그대로 두면
      //   뒤로 가서 그 칸에 닿는 순간 패널이 **다시 열린다.** 아래 칸을 열기 전 주소로 되돌려 둔다.
      //   (라우터는 모른다 — 돌아왔을 때 popstate 가 주는 주소로 다시 그리므로 문제가 없다.)
      const lr = lastReplace;
      if (lr && Date.now() - lr.at < NAV_WINDOW_MS && lr.to === here && lr.from !== here) {
        window.history.replaceState(base, '', lr.from);
      }
      window.history.pushState({ ...base, [MARK]: entry.token }, '', here);
    } finally { ownPush = false; }
    stack.push(entry);

    return () => {
      const idx = stack.findIndex((x) => x.token === entry.token);
      if (idx < 0) return; // 뒤로 가기로 이미 닫혔다 — 칸도 이미 빠졌다
      stack.splice(idx, 1);
      // 버튼으로 닫았다 — 쌓아 둔 칸이 아직 현재 위치면 걷는다.
      // (그 사이 다른 페이지로 이동했으면 현재 위치가 다른 칸이다 — 건드리지 않는다.)
      if (currentMark() === entry.token) {
        // 닫으며 주소가 바뀌었으면(`?task=` 제거) 내려가 닿는 칸에도 그 주소를 씌운다.
        if (window.location.href !== here) pendingFixUrl = window.location.href;
        window.history.back();
      }
    };
  }, [active]);
}
