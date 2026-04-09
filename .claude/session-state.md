## 현재 작업 상태
**마지막 업데이트:** 2026-04-09
**작업 상태:** 완료

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- Q Note 구조 변경 확정: 배치(Whisper) → 실시간(Deepgram WebSocket) 전환
- Q Note 설계 문서화: FEATURE_SPECIFICATION.md Phase 8 전면 재작성
- DEVELOPMENT_ROADMAP.md Phase 8 프롬프트 재작성 (B-1~B-6)
- DEVELOPMENT_PLAN.md Phase 8 작업 목록 교체

### 다음 할 일
- B-1: Q Note FastAPI 구조 + Deepgram WebSocket 프록시 + 실시간 STT
  - 프로젝트 구조 (routers, services, middleware)
  - SQLite DB 설정 (sessions, utterances, documents 등)
  - JWT 인증 미들웨어 (PlanQ 백엔드 SECRET_KEY 공유)
  - Deepgram WebSocket 프록시 구현
  - `.env` 설정 (DEEPGRAM_API_KEY, OPENAI_API_KEY, JWT_SECRET)
- **필요 API 키: Deepgram + OpenAI (Irene에게 확인)**

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
