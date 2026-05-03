// 단일 audit helper 모듈 — services/auditService.js 로 통합 (2026-05-03).
//
// 기존 호출처 (cue_orchestrator, conversations, signatures) 의 import 경로 호환을 위해
// 얇은 re-export 만 유지. 신규 코드는 services/auditService 의 logAudit (req 자동 추출)
// 또는 createAuditLog 직접 사용.
//
// 차이 (이전 → 이후):
//   - await createAuditLog(...) — 동작 동일. 내부에서 setImmediate fire-and-forget 으로 변경 → 메인 흐름 차단 X
//   - sensitive 키 (password/token/otp/api_key) 자동 마스킹 추가
//   - metadata 옵션 → new_value 에 합쳐 저장

const { createAuditLog } = require('../services/auditService');

module.exports = { createAuditLog };
