// 캐시 자동 갱신 — 5분마다 /api/build-version polling.
// 새 빌드 감지 시 다음 navigation 시점에 hard reload (사용자 폼 입력 중 끊기지 않음).
// 2026-05-05 도입. Notion/Linear 패턴.
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const POLL_MS = 5 * 60 * 1000;  // 5분

const BuildVersionGuard: React.FC = () => {
  const location = useLocation();
  const initialRef = useRef<string | null>(null);
  const latestRef = useRef<string | null>(null);
  const pendingReloadRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    const fetchVersion = async () => {
      try {
        const r = await fetch('/api/build-version', { cache: 'no-store' });
        const j = await r.json();
        if (!mounted || !j?.success) return;
        const v: string | null = j.data?.version || null;
        if (!v) return;
        if (initialRef.current == null) {
          initialRef.current = v;
        }
        latestRef.current = v;
        if (initialRef.current !== latestRef.current) {
          pendingReloadRef.current = true;
        }
      } catch { /* noop — network 일시 오류는 무시 */ }
    };
    fetchVersion();
    const id = setInterval(fetchVersion, POLL_MS);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (pendingReloadRef.current) {
      // 새 빌드 감지 + navigation 발생 시점 → hard reload (캐시 무시)
      window.location.reload();
    }
  }, [location.pathname]);

  return null;
};

export default BuildVersionGuard;
