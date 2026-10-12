// OAuth 연동 팝업의 «끝났다» 신호를 받는 한 벌 (2026-10-12).
//
//   보내는 쪽은 서버 마지막 화면 하나(dev-backend utils/oauthPopupPage + /api/oauth/popup-done.js)다.
//   그 화면은 세 길로 동시에 쏜다 — opener.postMessage · BroadcastChannel('planq:oauth') · localStorage 'planq:oauth:done'.
//   구글을 거친 팝업은 COOP 로 opener 가 끊기는 브라우저가 있어 postMessage 만 들으면 영영 못 받는다
//   (내 외부 연동 화면이 그랬다 — «캘린더 고르고 나서 화면이 안 바뀐다»). 받는 곳마다 듣는 길이 달라
//   이 훅으로 모았다. 같은 신호가 여러 길로 오므로 한 번으로 합친다.
//   네이티브 앱은 팝업 대신 시스템 브라우저 → 앱 복귀 이벤트(planq:oauth-connected / -dismissed, NativeBridge).
import { useEffect, useRef } from 'react';

export type OauthDoneType = 'personal:connected' | 'gcal:connected' | 'gdrive:connected';
export interface OauthDonePayload { type: OauthDoneType; ok: boolean; provider?: string | null; native?: boolean }

const CHANNEL = 'planq:oauth';
const STORAGE_KEY = 'planq:oauth:done';
const STALE_MS = 2 * 60 * 1000;   // 저장소에 남은 옛 신호(다른 탭이 몇 시간 전에 쓴 것)는 무시

export function useOauthPopupDone(opts: {
  types: OauthDoneType[];
  onDone: (p: OauthDonePayload) => void;
  /** 네이티브 시스템 브라우저가 닫힘(성공·취소 공통) — 스피너만 내릴 때 */
  onDismiss?: () => void;
  /** false 면 듣지 않는다(예: 버튼을 누른 동안만 듣기) */
  enabled?: boolean;
}) {
  const { enabled = true } = opts;
  const ref = useRef(opts);
  ref.current = opts;
  const typesKey = opts.types.join(',');

  useEffect(() => {
    if (!enabled) return undefined;
    const seen = new Set<string>();
    const accept = (raw: unknown) => {
      const d = raw as { type?: string; ok?: boolean; provider?: string | null; ts?: number } | null;
      if (!d || typeof d.type !== 'string') return;
      if (!ref.current.types.includes(d.type as OauthDoneType)) return;
      const ts = typeof d.ts === 'number' ? d.ts : 0;
      if (ts && Date.now() - ts > STALE_MS) return;
      const key = `${d.type}:${ts}:${d.ok ? 1 : 0}`;
      if (seen.has(key)) return;
      seen.add(key);
      ref.current.onDone({ type: d.type as OauthDoneType, ok: !!d.ok, provider: d.provider ?? null });
    };
    const onMsg = (e: MessageEvent) => { if (e.origin === window.location.origin) accept(e.data); };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try { accept(JSON.parse(e.newValue)); } catch { /* 손상된 값 무시 */ }
    };
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = (e) => accept(e.data);
    } catch { bc = null; }
    // 네이티브 앱 복귀 — 어느 연동인지 싣지 않으므로 이 화면이 기다리던 첫 종류로 본다.
    const onNative = () => ref.current.onDone({ type: ref.current.types[0], ok: true, native: true });
    const onDismiss = () => ref.current.onDismiss?.();
    window.addEventListener('message', onMsg);
    window.addEventListener('storage', onStorage);
    window.addEventListener('planq:oauth-connected', onNative);
    window.addEventListener('planq:oauth-dismissed', onDismiss);
    return () => {
      window.removeEventListener('message', onMsg);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('planq:oauth-connected', onNative);
      window.removeEventListener('planq:oauth-dismissed', onDismiss);
      try { bc?.close(); } catch { /* 이미 닫힘 */ }
    };
  }, [enabled, typesKey]);
}
