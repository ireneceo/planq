/**
 * 외부 연결 응답 직렬화 — 라우트에서 분리 (라우팅 ≠ 직렬화).
 *
 * sanitize      : 토큰·비밀번호를 절대 응답에 싣지 않는다. 보유 여부만 boolean 으로.
 * adaptLegacy*  : 옛 저장소(business_cloud_tokens / email_accounts)를 ExternalConnection 모양으로
 *                 맞춰 한 목록에 섞어 보여주기 위한 어댑터. 통합 뷰가 두 벌 스키마를 몰라도 되게 한다.
 */
const personalCalendar = require('./personalCalendar');

// 응답 sanitize — 비밀번호/토큰 hash 노출 차단
function sanitize(row) {
  const j = row.toJSON ? row.toJSON() : row;
  // ★ 보유 여부는 **지우기 전에** 캡처한다 — delete 뒤에 `!!j.access_token_encrypted` 를 읽으면
  //   언제나 false 라, 이 계약(보유 여부만 boolean 으로)이 3필드 모두 거짓말을 하고 있었다(2026-07-31 수정).
  const hasAccessToken = !!j.access_token_encrypted;
  const hasRefreshToken = !!j.refresh_token_encrypted;
  const hasPassword = !!j.password_encrypted;
  delete j.access_token_encrypted;
  delete j.refresh_token_encrypted;
  delete j.password_encrypted;
  return {
    ...j,
    has_access_token: hasAccessToken,
    has_refresh_token: hasRefreshToken,
    has_password: hasPassword,
    // 캘린더 쓰기 가능 여부 — 옛 연결은 calendar.readonly 로 동의해둔 상태라 false.
    //   화면이 "다시 연결" 을 안내하는 근거. 읽기 overlay 는 그대로 두므로 강제 해제는 하지 않는다.
    can_write_calendar: j.provider === 'google_calendar' ? personalCalendar.hasCalendarWrite(j) : null,
    sync_enabled: j.sync_enabled !== false,
  };
}

// 옛 BusinessCloudToken → ExternalConnection-like shape
function adaptLegacyCloudToken(row) {
  const providerMap = { gdrive: 'google_drive', gcal: 'google_calendar' };
  return {
    id: `legacy-cloud-${row.id}`,
    owner_scope: 'workspace',
    business_id: row.business_id,
    user_id: null,
    provider: providerMap[row.provider] || row.provider,
    auth_type: 'oauth',
    account_email: row.account_email,
    account_name: null,
    is_active: true,
    is_default: true,
    last_sync_at: null,
    scope: row.scope,
    metadata: { root_folder_id: row.root_folder_id, connected_by: row.connected_by },
    created_at: row.connected_at,
    updated_at: row.updated_at || row.connected_at,
    _legacy_source: 'business_cloud_tokens',
  };
}

// 옛 EmailAccount → ExternalConnection-like
function adaptLegacyEmailAccount(row) {
  const providerMap = { google_oauth: 'gmail', password: 'gmail', microsoft_oauth: 'outlook' };
  return {
    id: `legacy-email-${row.id}`,
    owner_scope: 'workspace',  // 옛 EmailAccount 는 항상 workspace
    business_id: row.business_id,
    user_id: null,
    provider: providerMap[row.auth_type] || 'gmail',
    auth_type: row.auth_type === 'google_oauth' ? 'oauth' : 'password',
    account_email: row.email,
    account_name: row.display_name,
    imap_host: row.imap_host,
    imap_port: row.imap_port,
    smtp_host: row.smtp_host,
    smtp_port: row.smtp_port,
    is_active: row.is_active,
    is_default: row.is_default,
    last_sync_at: row.last_sync_at,
    last_sync_error: row.last_sync_error,
    fail_count: row.fail_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    _legacy_source: 'email_accounts',
  };
}


module.exports = { sanitize, adaptLegacyCloudToken, adaptLegacyEmailAccount };
