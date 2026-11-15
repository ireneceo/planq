// 워크스페이스 업종 코드 — 서버 dev-backend/config/industries.js 와 같은 목록(서버가 모르는 값은 거절한다).
//   새 워크스페이스를 만들 때 필수(2026-11-16 · App Store 3.1.1 «사업자에게만 판매»). 이름은 welcome.json industries.*
export const INDUSTRY_CODES = [
  'agency', 'design', 'it', 'consulting', 'professional', 'education',
  'media', 'commerce', 'manufacturing', 'construction', 'health', 'other',
] as const;
export type IndustryCode = typeof INDUSTRY_CODES[number];
