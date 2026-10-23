// 창끼리 «한 곳에서 처리한 알림» 을 나눈다 — 새 버전 안내줄 · 약관 재동의 창 (2026-10-22)
//
// Irene: "새버전이 와서 새로고침하거나 약관 재동의 팝업이 뜨는 건 메인 창에서 했으면 팝업에서도 없어져야 하는 거 아니야?
//         왜 모든 팝업을 각각 해야 없어져?"
//
// 두 알림 모두 창마다 따로 떠 있고 다른 창에 알릴 수단이 없었다. 워크스페이스 전환(services/workspaceSync)과 같은 모양 —
// 같은 브라우저의 창(메인·팝아웃)은 BroadcastChannel 하나로 잇는다.
//
// ★ 받는 쪽 판정은 멱등이어야 한다 — 새로 연 채널 객체로 보내면 같은 창의 수신 객체에도 배달된다(자기 수신).
//   · build:loaded   — 새 번들로 부팅한 창이 보낸다. 받은 창은 «내 버전과 다를 때만» 옛 번들로 본다.
//   · build:dismissed — [×] 나중에. 같은 새 버전을 감지한 창들의 안내줄을 같이 내린다.
//   · terms:accepted — 재동의 완료. 같은 사람의 창만 사용자 정보를 다시 읽는다(사칭 창이 같은 브라우저에 있다).

export const WINDOW_SYNC_CHANNEL = 'planq:window-sync';

export type WindowSyncMsg =
  | { type: 'build:loaded'; version: string }
  | { type: 'build:dismissed'; version: string }
  | { type: 'terms:accepted'; user_id: number };

export function postWindowSync(msg: WindowSyncMsg): void {
  try {
    const ch = new BroadcastChannel(WINDOW_SYNC_CHANNEL);
    ch.postMessage(msg);
    ch.close();
  } catch { /* BroadcastChannel 미지원 — 각 창이 종전대로 스스로 처리한다 */ }
}

export function onWindowSync(handler: (msg: WindowSyncMsg) => void): () => void {
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(WINDOW_SYNC_CHANNEL);
    ch.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m && typeof m === 'object' && typeof m.type === 'string') handler(m as WindowSyncMsg);
    };
  } catch { ch = null; }
  return () => { try { ch?.close(); } catch { /* noop */ } };
}
