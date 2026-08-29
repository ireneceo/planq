// services/googleScopes.js — Google OAuth 승인 스코프 판정 단일 원천.
//
// 왜 이 모듈이 있는가
//   구글 동의 화면은 **항목별 체크박스**다. 사용자가 캘린더/Drive/메일 항목을 체크하지 않아도
//   code 는 정상 발급된다. 그 토큰을 그대로 저장하면 화면에는 "연동 완료" 로 뜨지만
//   이후 모든 호출이 403 으로 죽는다 — 2026-07-27 운영 사고(워크스페이스 gcal 이
//   `userinfo.email openid` 만 받아 저장됐고, 나흘 뒤 `insufficient authentication scopes`
//   가 뜰 때까지 아무도 몰랐다).
//
//   더 나빴던 것은 개인 연동·워크스페이스 gdrive 의 저장 코드였다:
//     scope: tokens.scope || scopeList      ← scopeList = 우리가 "요청한" 목록
//   구글이 scope 를 안 돌려주면 **승인받지도 않은 스코프를 승인 기록으로 위조**했다.
//   권한 판정 함수는 그 거짓말을 읽고 "가능" 이라 답했다. 요청 목록은 승인 기록이 아니다.
//
// 불변식 (깨뜨리지 말 것)
//   1. `scope` / `oauth_scope` 컬럼은 **OAuth 콜백에서만** 기록한다.
//      토큰 갱신(`on('tokens')`) 경로는 access/refresh/expiry 만 쓴다 — scope 를 건드리면
//      재발급 응답에 scope 가 없을 때 멀쩡한 연결이 권한 부족으로 오판된다.
//   2. 판정은 **membership(포함 검사)** 이다. 동등 비교 금지.
//      `include_granted_scopes: true` 때문에 토큰 응답의 scope 는 이 client 에 사용자가
//      여태 승인한 **합집합**으로 온다 — 동등 비교하면 정상 사용자가 반려된다.
//   3. 승인 여부는 저장된 scope 문자열에서 **읽기 시점에 파생**한다. 별도 상태 컬럼을 두지 않는다.

// provider 별 "이게 없으면 그 기능이 아예 안 되는" 스코프.
//   배열 안은 OR — 하나라도 있으면 충족(캘린더는 events 든 full 이든 쓰기가 된다).
const REQUIRED_SCOPES = {
  // 개인 연동 (external_connections)
  google_calendar: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar'],
  google_drive: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
  gmail: ['https://mail.google.com/'],
  // 워크스페이스 연동 (business_cloud_tokens) — provider 이름이 다르다
  gcal: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar'],
  // ★ OR 목록이다 — 하나라도 있으면 충족. 그래서 full `drive` 를 **추가**하는 것은 안전하다
  //   (drive.file 사용자는 그대로 통과 · full 만 승인한 사용자도 통과).
  //   Fable 이 경고한 것은 이 배열을 full 로 **교체**하는 것이었다 — 그러면 기존 연동이 전부 죽는다.
  //   "전체 권한이 있는가" 는 별도 술어 hasDriveFull() 로 본다(인제스트 활성 판정).
  gdrive: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
};

const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

// Drive **전체** 권한 (Restricted). `drive.file`(앱이 만든 것만)과 **다른 원소**다.
//   ★ REQUIRED_SCOPES.gdrive 에 이걸 넣으면 안 된다 — 넣는 순간 기존 drive.file 연동 전부가
//     "권한 부족" 으로 오판된다(hasRequired 는 OR 이지만, 반대로 이 술어를 필수로 승격하면 그렇게 된다).
//     그래서 **별도 술어**로 둔다. 역방향 인제스트(v2)에서만 쓴다.
const DRIVE_FULL_SCOPE = 'https://www.googleapis.com/auth/drive';

// ★ 새 동의를 **요청하면 안 되는** provider (2026-08-19, Irene 결정).
//   Google OAuth 검증을 캘린더만으로 제출하기로 하면서 Cloud Console 에서
//   `https://mail.google.com/`(RESTRICTED)를 뺀다. Console 에 없는 scope 로 동의 화면을 띄우면
//   사용자는 "액세스 차단됨: 승인되지 않은 요청" 만 보고 원인을 알 수 없다.
//   ★ 기존 연결은 건드리지 않는다 — 이미 받은 토큰의 갱신·수신은 그대로 동작한다.
//     막는 것은 **새 동의 요청(initiate)** 뿐이다. 대체 경로는 앱 비밀번호(IMAP/SMTP) 연결.
const OAUTH_CONSENT_DISABLED = new Set(['gmail']);

/** 이 provider 로 새 동의 화면을 띄워도 되는가. 막힌 것이면 true. */
function isConsentDisabled(provider) {
  return OAUTH_CONSENT_DISABLED.has(String(provider || ''));
}

// 사용자에게 보여줄 이름 — Google 동의 화면의 실제 항목을 가리켜야 사용자가 찾을 수 있다.
//   "scope" · "403" 같은 개발 용어는 화면에 절대 노출하지 않는다.
const PROVIDER_LABELS = {
  google_calendar: { ko: '캘린더', en: 'Calendar' },
  gcal: { ko: '캘린더', en: 'Calendar' },
  google_drive: { ko: 'Drive 파일', en: 'Drive files' },
  gdrive: { ko: 'Drive 파일', en: 'Drive files' },
  gmail: { ko: '메일', en: 'Mail' },
};

/** 승인 스코프 문자열 → 배열. null/undefined/빈 문자열은 빈 배열(= 아무것도 승인 안 됨). */
function parseGranted(scopeStr) {
  return String(scopeStr || '').split(/\s+/).filter(Boolean);
}

/**
 * 이 provider 를 쓰기에 충분한 권한이 승인됐는가.
 * scopeStr 이 비면 무조건 false — "모르겠으면 없는 것으로 친다"(fail-closed).
 */
function hasRequired(provider, scopeStr) {
  const required = REQUIRED_SCOPES[provider];
  if (!required) return false;          // 모르는 provider 도 fail-closed
  const granted = parseGranted(scopeStr);
  return required.some((s) => granted.includes(s));
}

/**
 * 캘린더를 **읽기라도** 되는가.
 * 이 술어가 필요한 이유: 쓰기 불가 연결은 두 종류이고 안내 문구가 달라야 한다.
 *   (a) 옛 calendar.readonly 연결 — 읽기 overlay 는 실제로 동작 중. "읽기 전용" 이 참말
 *   (b) 캘린더 승인이 아예 없음 — 읽기도 403. 여기에 "읽기 전용" 이라 쓰면 거짓 안내다
 */
function hasCalendarReadOnly(scopeStr) {
  return parseGranted(scopeStr).includes(CALENDAR_READONLY_SCOPE);
}

/**
 * Drive 전체 권한이 승인됐는가 — 사용자가 Drive 에 **직접 올린 파일**까지 볼 수 있는가.
 *   이것이 false 면 인제스트는 **정상 대기** 상태다(고장이 아니다).
 *   심사 통과만으로는 켜지지 않는다 — scope 는 OAuth 콜백에서만 기록되므로
 *   사용자가 다시 동의해야 이 값이 참이 된다.
 */
function hasDriveFull(scopeStr) {
  return parseGranted(scopeStr).includes(DRIVE_FULL_SCOPE);
}

/** 화면에 보여줄 권한 상태 — 저장된 scope 에서 읽기 시점 파생. */
function permissionStatus(provider, scopeStr) {
  if (hasRequired(provider, scopeStr)) return 'ok';
  const isCalendar = provider === 'google_calendar' || provider === 'gcal';
  if (isCalendar && hasCalendarReadOnly(scopeStr)) return 'read_only';
  return 'insufficient';
}

function providerLabel(provider, lang = 'ko') {
  const l = PROVIDER_LABELS[provider];
  if (!l) return provider;
  return l[lang] || l.ko;
}

module.exports = {
  REQUIRED_SCOPES,
  CALENDAR_READONLY_SCOPE,
  DRIVE_FULL_SCOPE,
  OAUTH_CONSENT_DISABLED,
  isConsentDisabled,
  parseGranted,
  hasRequired,
  hasCalendarReadOnly,
  hasDriveFull,
  permissionStatus,
  providerLabel,
};
