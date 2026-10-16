// 옛 «설정 > 고객» 주소를 Q sale 로 넘긴다 — 2026-10-16 고객 화면을 Q sale 하나로 합쳤다(docs/CLIENT_SCREENS_MERGE_DESIGN.md).
//   북마크·옛 알림·메일 «고객으로 저장»·온보딩 링크가 죽은 주소가 되지 않게 **쿼리까지** 옮긴다:
//     /business/clients[?client=N][&new=1&email=&name=][&q=]  → /sale?tab=clients[...같은 값]
//     /business/clients/:id/timeline[?channels=email,chat]      → /sale/:id[?channel=email]
import { Navigate, useLocation, useParams } from 'react-router-dom';

const KEEP = ['client', 'new', 'email', 'name', 'q'];

export function legacyClientsTarget(pathname: string, search: string): string {
  const sp = new URLSearchParams(search);
  const m = pathname.match(/^\/business\/clients\/(\d+)\/timeline\/?$/);
  if (m) {
    const ch = (sp.get('channels') || sp.get('channel') || '').split(',').map((s) => s.trim()).filter(Boolean)[0];
    return `/sale/${m[1]}${ch ? `?channel=${encodeURIComponent(ch)}` : ''}`;
  }
  const out = new URLSearchParams({ tab: 'clients' });
  for (const k of KEEP) { const v = sp.get(k); if (v) out.set(k, v); }
  return `/sale?${out.toString()}`;
}

export default function LegacyClientsRedirect() {
  const loc = useLocation();
  useParams(); // 경로 변수는 위 정규식이 읽는다(라우트 두 개가 같은 컴포넌트를 쓴다)
  return <Navigate to={legacyClientsTarget(loc.pathname, loc.search)} replace />;
}
