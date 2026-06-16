// 운영 #48 — task 삭제 실패(주로 403 권한) 백엔드 메시지를 사용자 친화 문구로 매핑.
// routes/tasks.js DELETE /by-business 의 403 사유 3종을 i18n 키로 변환.
// 키(rowAction.*)는 qtask.json(ko/en)에 존재 → 단일 인자 t(key) 로 조회.
type TLike = (key: string) => unknown;

export function friendlyDeleteError(backendMsg: unknown, t: TLike): string {
  const m = typeof backendMsg === 'string' ? backendMsg : '';
  if (m.includes('has activity')) return t('rowAction.errHasActivity') as string;
  if (m.includes('forbidden')) return t('rowAction.errForbidden') as string;
  return t('rowAction.errGeneric') as string;
}
