// 운영 #48 — task 삭제 실패(주로 403 권한) 백엔드 메시지를 사용자 친화 문구로 매핑.
// routes/tasks.js DELETE /by-business 의 403 사유 3종을 i18n 키로 변환.
// 키(rowAction.*)는 qtask.json(ko/en)에 존재 → 단일 인자 t(key) 로 조회.
import { apiFetch } from '../contexts/AuthContext';

type TLike = (key: string) => unknown;

export function friendlyDeleteError(backendMsg: unknown, t: TLike): string {
  const m = typeof backendMsg === 'string' ? backendMsg : '';
  if (m.includes('has activity')) return t('rowAction.errHasActivity') as string;
  if (m.includes('forbidden')) return t('rowAction.errForbidden') as string;
  return t('rowAction.errGeneric') as string;
}

/** 업무 삭제 요청 한 벌 — 목록 두 곳(Q task·프로젝트 업무)이 같이 쓴다.
 *  반복 업무는 scope 로 «이 업무만(single) / 이 업무와 이후 모두(future)» 를 싣는다(2026-10-27). */
export async function deleteTaskRequest(
  bizId: number | string, taskId: number, t: TLike, scope?: 'single' | 'future',
): Promise<{ ok: boolean; message?: string }> {
  const r = await apiFetch(`/api/tasks/by-business/${bizId}/${taskId}${scope ? `?series_scope=${scope}` : ''}`, { method: 'DELETE' });
  if (r.ok) return { ok: true };
  const j = await r.json().catch(() => ({}));
  return { ok: false, message: friendlyDeleteError(j?.message, t) };
}
