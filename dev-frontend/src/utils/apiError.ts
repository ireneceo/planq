// API 에러 메시지 → 사용자 언어 매핑 (사이클 N+17)
//
// 정책:
//   - backend 가 영어 message (snake_case code 또는 영어 sentence) 반환
//   - frontend 가 err.message 그대로 표시하면 영어 노출 → UX 망함
//   - 이 helper 가 모든 catch 분기에서 message → 사용자 언어 텍스트 매핑
//
// 사용:
//   import { mapApiError } from 'utils/apiError';
//   import { useTranslation } from 'react-i18next';
//
//   const { t } = useTranslation('errors');
//   try { ... } catch (e) {
//     setError(mapApiError(e, t));
//   }
//
// backend 가 새 error code 추가 시 → public/locales/{ko,en}/errors.json 에 키만 추가.
// 매핑 못 찾으면 generic 메시지 (사용자 언어).

import type { TFunction } from 'i18next';

// snake_case code 또는 영어 sentence → i18n key 매핑 테이블
// 새 backend 메시지 추가 시 여기 + ko/en/errors.json 양쪽 갱신.
const ERROR_CODE_MAP: Record<string, string> = {
  // 인증
  'Invalid email or password': 'invalid_credentials',
  'Email and password required': 'email_password_required',
  'Refresh token required': 'refresh_required',
  'Invalid refresh token': 'refresh_invalid',
  'Refresh token reuse detected': 'refresh_invalid',
  'Invalid or expired refresh token': 'refresh_expired',
  'Account suspended': 'account_suspended',
  'Invalid user': 'invalid_user',
  'Expired refresh token': 'refresh_expired',

  // 일반 권한/대상
  'forbidden': 'forbidden',
  'owner_only': 'owner_only',
  'not_found': 'not_found',
  'Not authenticated': 'unauthenticated',
  'unauthenticated': 'unauthenticated',
  'Not logged in': 'unauthenticated',
  'No workspace': 'no_workspace',

  // 입력 검증
  'business_id required': 'business_id_required',
  'name_required': 'name_required',
  'email_required': 'email_required',
  'valid_email_required': 'invalid_email',
  'message_required': 'message_required',
  'message_too_long': 'message_too_long',
  'endpoint_required': 'endpoint_required',

  // push
  'push_disabled_no_vapid': 'push_unavailable',
  'invalid_subscription': 'push_invalid_subscription',
  'invalid_p256dh': 'push_invalid_subscription',
  'invalid_auth': 'push_invalid_subscription',
  'invalid_endpoint_host': 'push_invalid_endpoint',

  // 비즈니스
  'Business not found': 'business_not_found',
  'Invalid plan code': 'invalid_plan',
  'Invalid trial_ends_at': 'invalid_trial_date',

  // Q Note
  'cannot_change_while_recording': 'qnote_recording_lock',
  'project_id_required_for_L2': 'qnote_project_required',
  'not_a_project_member': 'qnote_not_project_member',
  'external_consent_required': 'qnote_external_consent_required',
  'recording_owner_only': 'qnote_recording_lock',
  'invalid_link_target: session not found': 'qnote_link_target_invalid',
  'invalid_link_target: not your session': 'qnote_link_target_invalid',
  'invalid_link_target: must be voice session': 'qnote_link_voice_only',

  // rate-limit
  'Too many login attempts, please try again later': 'rate_limit_login',
  'Too many requests': 'rate_limit_generic',

  // 일반
  'invalid_or_expired_invite': 'invite_expired',
  'Accept failed': 'invite_accept_failed',
};

// HTTP 패턴 매핑 (e.g. "HTTP 500", "HTTP 503")
function mapByPattern(msg: string): string | null {
  if (/^HTTP 5\d\d/.test(msg)) return 'server_error';
  if (/^HTTP 4\d\d/.test(msg)) return 'client_error';
  if (/network|fetch failed|NetworkError|Failed to fetch/i.test(msg)) return 'network_error';
  if (/timeout/i.test(msg)) return 'timeout';
  if (/^Unknown capture mode/.test(msg)) return 'unknown_capture_mode';
  if (/^AudioContext not supported/.test(msg)) return 'audio_not_supported';
  return null;
}

/**
 * API error → 사용자 언어 메시지.
 * @param err catch 한 error (Error 객체 또는 string 또는 unknown)
 * @param t  useTranslation('errors').t — 메시지 lookup 용
 */
export function mapApiError(err: unknown, t: TFunction): string {
  let msg = '';
  if (err instanceof Error) msg = err.message;
  else if (typeof err === 'string') msg = err;
  else msg = '';

  if (!msg) return t('generic') as string;

  // 1. exact match (snake_case code 또는 영어 sentence)
  const exactKey = ERROR_CODE_MAP[msg];
  if (exactKey) {
    const v = t(exactKey, { defaultValue: '' }) as string;
    if (v) return v;
  }

  // 2. 직접 key 시도 (backend 가 이미 snake_case code 일 때)
  const directV = t(msg, { defaultValue: '' }) as string;
  if (directV) return directV;

  // 3. 패턴 매칭 (HTTP status / network / timeout)
  const pkey = mapByPattern(msg);
  if (pkey) {
    const v = t(pkey, { defaultValue: '' }) as string;
    if (v) return v;
  }

  // 4. 최후 — generic + 원본 message (디버그 정보 보존)
  return `${t('generic')}${msg ? ' (' + msg + ')' : ''}` as string;
}
