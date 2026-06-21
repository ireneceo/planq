// D4 #62 확장 — 보안등급 공통 헬퍼 (file / post / document / kb_document 공유)
//   visibility(누가 보나) 와 직교 축 = 민감도/취급 제한.
//   general      = 외부공유·드라이브 OK
//   internal     = 외부공유 차단 (워크스페이스 내부 전용)
//   confidential = 외부공유 차단 + 일괄 export 는 관리자(owner/admin)만
// 프론트 단일 출처: components/Common/SecurityLevelBadge.tsx
const SECURITY_LEVELS = ['general', 'internal', 'confidential'];

// 유효한 보안등급 값인가
function isValidLevel(level) {
  return SECURITY_LEVELS.includes(level);
}

// 외부 공유(share_token) 발급을 차단해야 하는가? (general 외 전부 차단)
//   security_level 컬럼이 없는 엔티티(task/calendar_event 등) 는 undefined → false (영향 없음).
function blocksExternalShare(entity) {
  const lv = entity && entity.security_level;
  return !!lv && lv !== 'general';
}

module.exports = { SECURITY_LEVELS, isValidLevel, blocksExternalShare };
