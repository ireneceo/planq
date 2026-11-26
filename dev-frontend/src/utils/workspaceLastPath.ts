/**
 * 워크스페이스별 «마지막에 보던 화면» (2026-11-26, Irene «각각 워크스페이스에서 보던 마지막 메뉴에 들어가 있는 상태로 이동해야지»).
 * - 기록: MainLayout 이 경로가 바뀔 때마다 지금 워크스페이스 키에 남긴다(워크스페이스 메뉴 화면만 — 관리자·프로필·팝아웃 제외).
 * - 읽기: WorkspaceSwitcher 가 전환할 때 새 워크스페이스의 값을 `workspaceSwitchLanding(…, remembered)` 에 넘긴다.
 * - 사람 뜻 값이라 `scopedStorage`(계정 접두) — 한 기기에 계정이 여럿이어도 앞 계정 경로를 물려받지 않는다.
 * - 이 기기(브라우저)에만 남는다. 서버 정본이 아니다 — 없으면 종전 착지로 떨어질 뿐이다.
 */
import { scopedStorage } from '../services/accounts';
import { isWorkspaceMenuPath } from '../config/navMenus';

const KEY = 'planq:ws-last-path';
const MAX_LEN = 500;

function readMap(): Record<string, string> {
  try {
    const raw = scopedStorage.get(KEY);
    const j = raw ? JSON.parse(raw) : null;
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch { return {}; }
}

export function rememberWorkspacePath(businessId: number | null | undefined, path: string): void {
  const id = Number(businessId);
  if (!id || !path || !path.startsWith('/') || path.length > MAX_LEN) return;
  if (!isWorkspaceMenuPath(path)) return;
  const map = readMap();
  if (map[String(id)] === path) return;
  map[String(id)] = path;
  scopedStorage.set(KEY, JSON.stringify(map));
}

export function lastWorkspacePath(businessId: number | null | undefined): string | null {
  const id = Number(businessId);
  if (!id) return null;
  const v = readMap()[String(id)];
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : null;
}
