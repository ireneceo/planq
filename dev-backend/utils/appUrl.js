// 서비스 주소(메일·알림·공유 링크의 앞부분) — 한 곳에서만 정한다 (2026-11-26, docs/CUSTOM_WORKSPACE_ONPREM_REVIEW_2026-11-26.md)
// 옛 코드는 65곳에서 `process.env.APP_URL || 'https://dev.planq.kr'` 로 따로 폴백했다 —
// 설정(APP_URL)이 빠지면 운영 고객 메일 링크가 조용히 개발서버로 갔다.
// 이제: APP_URL 이 있으면 그것(끝 / 제거). 없으면 운영(NODE_ENV=production)은 공개 주소 + 경고 로그 한 번, 개발은 개발서버.
// 새 코드는 'https://dev.planq.kr' 를 직접 쓰지 말고 이 함수를 쓴다 — 검사 guard-invariants --category=appurl.
const DEV_FALLBACK = 'https://dev.planq.kr';
const PROD_FALLBACK = 'https://planq.kr';
let warned = false;

function appUrl() {
  const v = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (v) return v;
  if (process.env.NODE_ENV === 'production') {
    if (!warned) {
      warned = true;
      console.error('[appUrl] APP_URL 설정이 없다 — 링크를 https://planq.kr 로 만든다. .env 에 APP_URL 을 넣을 것');
    }
    return PROD_FALLBACK;
  }
  return DEV_FALLBACK;
}

module.exports = { appUrl };
