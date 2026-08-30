// hooks/useDetailResource.ts — 상세 로드 상태기계 (2026-08-30, Fable 판정 커밋2)
//
// 왜: 상세를 못 불러오는 **모든** 경우가 지금은 같은 침묵으로 떨어진다.
//   404(삭제됨) · 403(다른 워크스페이스) · 429(rate-limit) · 500 · 네트워크 순단이
//   전부 `if (j.success)` 의 else 없음 + `catch { /* ignore */ }` 로 사라진다.
//   그래서 사용자에게는 전부 똑같이 **"눌렀는데 아무 일도 안 일어났다"** 로 보인다
//   (Irene: "여러 상황에서 상세가 제대로 딱 딱 안열리는 경우가 너무 많아").
//
// ★ apiFetch 는 throw 하지 않는다 — 실패해도 Response 를 준다
//   (memory feedback_apifetch_no_throw_silent_save). 그래서 **r.status 를 반드시 본다.**
//   폭주 차단(circuit) 도 503 Response 로 돌아오므로 error 로 잡힌다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../contexts/AuthContext';

export type DetailStatus = 'idle' | 'loading' | 'ready' | 'not_found' | 'forbidden' | 'error';

type Options<T> = {
  /** null 이면 아무것도 하지 않는다(상세 닫힘) */
  id: number | null;
  /** id 로 만드는 API 경로 */
  url: (id: number) => string;
  /** 성공 시 부수효과 — 읽음 표시·워크플로 로드 등은 화면에 남긴다 */
  onSuccess?: (data: T) => void;
  enabled?: boolean;
};

export function useDetailResource<T>({ id, url, onSuccess, enabled = true }: Options<T>) {
  const [status, setStatus] = useState<DetailStatus>('idle');
  const [data, setData] = useState<T | null>(null);
  const [nonce, setNonce] = useState(0);
  const successRef = useRef(onSuccess);
  successRef.current = onSuccess;

  useEffect(() => {
    if (!enabled || id == null) { setStatus('idle'); setData(null); return; }
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        const r = await apiFetch(url(id));
        if (cancelled) return;
        if (r.status === 404) { setStatus('not_found'); setData(null); return; }
        if (r.status === 403) { setStatus('forbidden'); setData(null); return; }
        if (!r.ok) { setStatus('error'); setData(null); return; }
        const j = await r.json().catch(() => null);
        if (cancelled) return;
        // success:false 는 서버가 이유를 준 실패다 — 성공으로 읽지 않는다.
        if (!j || j.success === false) { setStatus('error'); setData(null); return; }
        const payload = (j.data ?? j) as T;
        setData(payload);
        setStatus('ready');
        successRef.current?.(payload);
      } catch {
        // 네트워크 순단·JSON 파싱 실패 — 조용히 삼키지 않는다
        if (!cancelled) { setStatus('error'); setData(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [id, url, enabled, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { status, data, retry };
}
