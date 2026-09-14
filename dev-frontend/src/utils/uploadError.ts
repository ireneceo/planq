// 업로드 실패를 **사람이 읽는 문장**으로 바꾼다. (2026-09-14)
//
// Irene: *"파일 업로드할 때 실패가 뜨는데 왜 뜨는지 설명도 없어."*
//   실제로 화면은 사유 코드(`needs_drive_for_large_file` 등)를 상태에 담아 두고는
//   **그리지 않고** "실패 / 업로드하지 못했습니다" 만 보여 줬다. 사유는 이미 손에 있었다.
//
// 규칙
//  · 문장은 **왜 안 됐는지 + 다음에 뭘 하면 되는지** 를 같이 말한다. 이유만 말하면 막다른 길이다.
//  · 서버가 이미 사람 문장을 준 경우(플랜 한도 안내 등)는 **그것을 그대로** 쓴다 —
//    여기서 다시 쓰면 서버 문구와 갈라진다.
//  · 모르는 코드는 삼키지 않고 **코드를 괄호로 남긴다.** 지원 문의 때 유일한 단서다.
import type { TFunction } from 'i18next';
import { formatBytes } from '../services/files';

/** 코드처럼 생겼는가 — 소문자·숫자·밑줄만. 서버가 준 한국어/영어 문장과 구별한다. */
const looksLikeCode = (s: string) => /^[a-z0-9_]+$/.test(s);

export function uploadErrorText(message: string | undefined, t: TFunction, limitBytes?: number): string {
  const code = String(message || '').trim();
  const lim = limitBytes && limitBytes > 0 ? formatBytes(limitBytes) : '';

  switch (code) {
    case 'needs_drive_for_large_file':
      return t('common:upload.err.needsDrive', '{{limit}} 보다 큰 파일이에요. Google Drive 를 연결하면 큰 파일도 그대로 올라갑니다 (설정 > 파일·외부 연동).', { limit: lim || t('common:upload.err.theLimit', '허용 용량') }) as string;
    case 'needs_context_for_large_file':
      return t('common:upload.err.needsContext', '{{limit}} 보다 큰 파일이에요. 프로젝트나 대화에 올리면 연결해 둔 Google Drive 로 저장됩니다.', { limit: lim || t('common:upload.err.theLimit', '허용 용량') }) as string;
    case 'file_size_exceeded':
    case 'upload_failed_413':
      return lim
        ? (t('common:upload.err.tooLargeWithLimit', '파일 하나에 올릴 수 있는 최대 크기({{limit}})를 넘었습니다.', { limit: lim }) as string)
        : (t('common:upload.err.tooLarge', '파일 하나에 올릴 수 있는 최대 크기를 넘었습니다.') as string);
    case 'storage_quota_exceeded':
      return t('common:upload.err.quota', '워크스페이스 저장 공간이 가득 찼습니다. 설정 > 파일·외부 연동에서 정리하거나 용량을 늘려 주세요.') as string;
    case 'network_failed':
      return t('common:upload.err.network', '연결이 끊겨 올리지 못했습니다. 다시 시도해 주세요.') as string;
    case 'upload_failed_401':
    case 'upload_failed_403':
      return t('common:upload.err.forbidden', '이 위치에 파일을 올릴 권한이 없습니다.') as string;
    case 'no_file':
      return t('common:upload.err.noFile', '파일이 비어 있습니다.') as string;
    default:
      break;
  }
  // 서버가 준 사람 문장은 그대로 — 우리가 다시 쓰면 서버와 갈라진다.
  if (code && !looksLikeCode(code)) return code;
  // 정말 모르는 코드: 일반 문장 + 코드(지원 문의 단서)
  return code
    ? (t('common:upload.err.unknownWithCode', '올리지 못했습니다. ({{code}})', { code }) as string)
    : (t('common:upload.err.unknown', '올리지 못했습니다.') as string);
}
