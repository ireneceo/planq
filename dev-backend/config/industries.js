// 워크스페이스 업종 — 새로 만들 때 필수(2026-11-16 · App Store 3.1.1 대응 «사업자에게만 판매», Fable 판단 B안).
//   화면 목록은 dev-frontend/src/config/industries.ts — 두 곳의 코드 목록이 같아야 한다(서버가 모르는 값은 거절).
//   이름 글자는 화면 i18n(welcome.json industries.*) — 서버는 코드만 저장한다.
const INDUSTRY_CODES = [
  'agency', 'design', 'it', 'consulting', 'professional', 'education',
  'media', 'commerce', 'manufacturing', 'construction', 'health', 'other',
];
const isIndustryCode = (v) => INDUSTRY_CODES.includes(String(v || ''));
module.exports = { INDUSTRY_CODES, isIndustryCode };
