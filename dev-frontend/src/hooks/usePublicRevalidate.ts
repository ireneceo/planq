// hooks/usePublicRevalidate — **공개(무인증) 페이지가 다시 읽는 한 벌**
//
// Irene 2026-09-13: *"문서를 수정했는데도 링크에서 이전 내용으로 나와.
//   수정한 내용 실시간으로 반영되게 해줘."*
//
// ★ 서버는 신선했다 — `/api/posts/public/:token` 은 `no-store` 이고 OG 도 DB 직독이다.
//   멈춰 있던 것은 **화면**이다. 공개 페이지 12개가 전부 mount 때 한 번 읽고 그걸로 끝이었다.
//   링크를 열어 둔 채 원본을 고치면, 보는 사람은 새로고침하기 전까지 옛 내용을 본다.
//
// ★ 공개 페이지는 **소켓을 못 쓴다** — socket.io 연결이 JWT 를 요구한다(무인증 뷰어에겐 없다).
//   그래서 로그인 화면의 계약(socket + visibility)을 그대로 가져올 수 없고, 여기서는
//   **보일 때만 도는 폴링 + 복귀 시 재조회** 가 같은 일을 한다.
//
// ★ 숨어 있을 때는 돌지 않는다. 링크를 열어 둔 탭이 종일 서버를 두드리면 안 된다
//   (공개 라우트는 인증이 없어 rate-limit 만이 방어선이다).
// ★ `enabled={false}` 로 **멈출 수 있어야 한다** — 서명 OTP 입력·캔버스 서명처럼
//   사용자가 작업 중인 화면에서 갱신이 끼어들면 입력이 날아간다(입력 초안 계약과 같은 이유).
import { useEffect, useRef } from 'react';

const DEFAULT_INTERVAL_MS = 60_000;

export function usePublicRevalidate(
  reload: () => void | Promise<void>,
  opts: { enabled?: boolean; intervalMs?: number } = {},
) {
  const { enabled = true, intervalMs = DEFAULT_INTERVAL_MS } = opts;
  // 최신 콜백을 ref 로 — 화면이 매 렌더 새 함수를 만들어도 타이머를 다시 걸지 않는다
  const fn = useRef(reload);
  fn.current = reload;

  useEffect(() => {
    if (!enabled) return undefined;
    let timer: number | null = null;
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null; } };
    const start = () => {
      stop();
      if (document.visibilityState === 'hidden') return;
      timer = window.setInterval(() => { void fn.current(); }, intervalMs);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') { void fn.current(); start(); }
      else stop();
    };
    // ★ focus 와 visibilitychange 를 **둘 다** 듣는다 — 모바일에서 focus 가 안 오는 경우가 있고,
    //   데스크탑에서 다른 창을 쓰다 돌아오면 visibilitychange 가 안 온다.
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    start();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      stop();
    };
  }, [enabled, intervalMs]);
}

export default usePublicRevalidate;
