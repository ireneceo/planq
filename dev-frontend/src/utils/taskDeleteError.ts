// 운영 #48 — task 삭제 실패(주로 403 권한) 백엔드 메시지를 사용자 친화 문구로 매핑.
// routes/tasks.js DELETE /by-business 의 403 사유 3종을 i18n 키로 변환.
import type { TFunction } from 'i18next';

export function friendlyDeleteError(backendMsg: unknown, t: TFunction): string {
  const m = typeof backendMsg === 'string' ? backendMsg : '';
  if (m.includes('has activity')) {
    return t('rowAction.errHasActivity', '다른 사람이 참여한 업무라 삭제할 수 없어요. 워크스페이스 소유자에게 요청하세요.') as string;
  }
  if (m.includes('forbidden')) {
    return t('rowAction.errForbidden', '삭제 권한이 없어요. 워크스페이스 소유자·관리자 또는 작성자만 삭제할 수 있어요.') as string;
  }
  return t('rowAction.errGeneric', '삭제할 수 없습니다.') as string;
}
