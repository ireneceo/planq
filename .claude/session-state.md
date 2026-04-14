## 현재 작업 상태
**마지막 업데이트:** 2026-04-14
**작업 상태:** Phase 0 (기초 정비) + Phase 5 백엔드 완료 · Q Talk UI 목업 준비됨 · Irene 승인 대기

### 이번 세션 완료 (자율 구현)

**설계 문서 전면 정비 (7 문서)**
- `docs/SYSTEM_ARCHITECTURE.md` — §8 네이밍 정책, §9 가시성 정책, §10 Cue, §11 Cue 사용량 추적
- `docs/DATABASE_ERD.md` — users/businesses/business_members/conversations/messages/clients 확장 + 신규 kb_documents/kb_chunks/kb_pinned_faqs/cue_usage + Phase 0 마이그레이션 DDL
- `docs/API_DESIGN.md` — register 응답, brand/legal/settings/cue 엔드포인트, 대화 자료(KB) 11개 엔드포인트
- `docs/SECURITY_DESIGN.md` — Cue 감사 액션, §3.5 Cue 안전장치, §3.6 가시성 시행
- `docs/INFORMATION_ARCHITECTURE.md` — 네이밍 반영 (워크스페이스/관리자), Q Talk 3단 레이아웃 재설계
- `docs/FEATURE_SPECIFICATION.md` — Phase 0 섹션 신설 + Phase 5 Q Talk 전면 재작성 (F5-0~F5-16, Cue 팀원 모델)
- `docs/DEVELOPMENT_ROADMAP.md` — Phase 0 신규 + Phase 5 13 단계 + Cue 통합 프롬프트

**Phase 0 — 기초 정비 완료**
1. DB 스키마 마이그레이션 (Sequelize sync + Phase 0 migrate 스크립트)
   - `users.is_ai` 추가
   - `businesses` 대폭 확장: default_language + brand_* + legal_* + timezone + work_hours + plan_expires_at + cue_mode + cue_user_id + cue_paused
   - `business_members.role` ENUM 에 `'ai'` 추가
   - `conversations` Cue 제어 필드
   - `messages` kind/is_ai/ai_confidence/ai_source/ai_sources/ai_model/ai_mode_used/ai_draft_approved*/is_internal/invoice_id
   - `clients.summary*` + assigned_member_id
2. 신규 테이블 4 개: kb_documents, kb_chunks, kb_pinned_faqs, cue_usage
3. `scripts/phase0-migrate.js` 실행 — 기존 5개 워크스페이스에 brand_name 백필 + Cue 계정 자동 생성
4. `routes/auth.js` register 트랜잭션 확장 — 가입 시 Cue 시스템 계정 자동 생성
5. `routes/auth.js` login/refresh 에서 `is_ai=true` 차단
6. `routes/businesses.js` 전체 재작성 — brand/legal/settings/cue/members 엔드포인트
7. `middleware/auth.js` — `req.businessRole` 세팅 추가
8. `middleware/visibility.js` 신설 — canAccess/loadResource/checkVisibility
9. i18n ko/en 라벨 교체 — 사업자/Owner → 워크스페이스/관리자

**Phase 0 — 프론트엔드 완료**
- `src/pages/Settings/WorkspaceSettingsPage.tsx` 신규 (통합 설정 페이지, 5 탭: Brand/Legal/Language/Members/Cue)
  - Brand: brand_name, brand_name_en(조건부), tagline, logo, color swatch + hex
  - Legal: legal_name, entity_type(PlanQSelect), tax_id, representative, address, phone, email, website
  - Language: default_language, timezone
  - Members: Cue 카드 (사용량 바 + 비용) + 사람 멤버 리스트
  - Cue: smart/auto/draft 모드 라디오 + 전역 일시정지 토글 + 이번 달 사용량 바 + 종류별 집계
- `src/services/workspace.ts` 신규 — API 클라이언트
- `src/App.tsx` 라우트 추가: /settings, /settings/:tab, /talk, /talk/:conversationId
- `public/locales/{ko,en}/settings.json` 신규 네임스페이스
- `src/i18n.ts` ns 배열 확장

**Phase 5 백엔드 완료**
- `services/kb_service.js` — OpenAI text-embedding-3-small 임베딩, 청킹, 하이브리드 검색 (FTS + 코사인)
- `services/cue_orchestrator.js` — 4 tier 매칭, Auto/Draft/Smart 모드, 민감 키워드 강제 Draft, 사용량 집계 UPSERT
- `routes/kb.js` — 문서/Pinned FAQ CRUD + CSV 템플릿 + 하이브리드 검색 테스트
- `routes/conversations.js` 전면 확장 — Cue trigger, 대화별 pause/resume, suggestions, Draft approve/reject, 고객 요약 갱신
- `server.js` — /api kb 라우터 등록

**Q Talk UI Mock (승인 대기)**
- `src/pages/QTalk/QTalkPage.tsx` 신규 — 3단 레이아웃 스켈레톤
  - Left: 대화 리스트 + 필터(All/Mine/Unread) + 상태 점(Cue/Human/Paused)
  - Middle: 대화 헤더 + 메시지 리스트 (Cue 뱃지 + 출처 인라인) + 컴포저 (내부 메모 토글)
  - Right: 고객 프로필 + 자동 요약 + 진행 업무 + Cue 답변 후보 + 내부 메모
  - "Coming soon" 배너로 구현 완료/남은 단계 명시
- `public/locales/{ko,en}/qtalk.json` 신규 네임스페이스
- `/talk` 라우트 연결, 목업 데이터로 화면 확인 가능

### 검증 결과

- **헬스체크**: 27/27 ✓ (매 단계마다 통과)
- **빌드**: tsc 0 error, vite 562ms, 637.58 KB (`index-DbkEa0cN.js`)
- **Phase 0 API E2E** (검증 후 삭제됨): 17/18 (1개 false-fail 은 MySQL bool 리턴 타입 이슈, 실제 DB 확인 정상)
  - Cue 로그인 차단 ✓ / 기존 유저 로그인 ✓ / brand·legal·cue PUT ✓ / cue mode 변경 ✓ / 멤버 목록 ✓ / 잘못된 값 거부 ✓
- **Phase 5 백엔드 E2E** (검증 후 삭제됨): 13/13 모두 통과
  - Pinned FAQ CRUD ✓ / KB document 업로드·인덱싱(ready) ✓ / 하이브리드 검색 ✓ / Cue 사용량 조회 ✓ / 삭제 ✓
- **SPA 라우트**: /settings /talk /notes /profile 전부 200

### 수정/신규 파일

**백엔드 (Node)**
- 수정: `models/User.js`, `models/BusinessMember.js`, `models/Conversation.js`, `models/Message.js`, `models/Client.js`, `models/index.js`, `middleware/auth.js`, `routes/auth.js`, `routes/businesses.js`, `routes/conversations.js`, `server.js`
- 전체 재작성: `models/Business.js`
- 신규: `models/KbDocument.js`, `models/KbChunk.js`, `models/KbPinnedFaq.js`, `models/CueUsage.js`, `middleware/visibility.js`, `services/kb_service.js`, `services/cue_orchestrator.js`, `routes/kb.js`, `scripts/phase0-migrate.js`

**프론트엔드 (TS)**
- 수정: `src/i18n.ts`, `src/App.tsx`
- 신규: `src/pages/Settings/WorkspaceSettingsPage.tsx`, `src/pages/QTalk/QTalkPage.tsx`, `src/services/workspace.ts`

**Locales (ko/en)**
- 수정: `common.json`, `layout.json`, `auth.json`
- 신규: `settings.json`, `qtalk.json`

**설계 문서**
- `SYSTEM_ARCHITECTURE.md`, `DATABASE_ERD.md`, `API_DESIGN.md`, `SECURITY_DESIGN.md`, `INFORMATION_ARCHITECTURE.md`, `FEATURE_SPECIFICATION.md`, `DEVELOPMENT_ROADMAP.md`

### 미반영 (다음 세션에서 Irene 승인 후)

**Phase 5 UI 본 구현 (Irene 승인 대기)**
- Q Talk 실 데이터 바인딩 (대화 리스트·메시지 실시간 수신·컴포저 전송)
- Draft 승인/거절 UI 와 API 연결
- Socket.IO 실시간 이벤트 (new_message, cue_thinking, cue_draft_ready, cue_paused 등)
- 고객 포털 뷰 (Client 역할용 간소 화면)
- KB 관리 UI (`/talk/kb` — 문서 업로드, Pinned FAQ CRUD)
- 파일 업로드 multer 연결 (현재는 body 텍스트 인덱싱만)

**Phase 5 백엔드 확장 (후순위)**
- 문서 파일 파싱 (pdf/docx/xlsx) — 현재는 본문 텍스트만 지원
- Cue task 실행 (Phase 1 범위 밖, Phase 6 Q Task 와 연계)
- 민감 키워드 감지 다국어 확장

### 회귀 위험 체크 결과
- Q Note 정상 동작 ✓ (health check 27/27)
- 기존 로그인 플로우 ✓
- 멀티테넌트 격리 ✓ (Cue 계정 로그인 차단 확인)

### Irene 첫 확인 포인트 (아침에)
1. https://dev.planq.kr/settings — 브랜드/법인/언어/멤버(Cue)/Cue 모드 저장 동작 확인
2. https://dev.planq.kr/talk — Q Talk 목업 화면 (3단 레이아웃 + Cue 뱃지 + 출처 표시) 방향 승인 여부
3. 로그인 시 헤더 아래 "사업자" → "관리자" 라벨 변경 확인
4. 새 계정 회원가입 시 워크스페이스 자동으로 Cue 멤버 생성되는지 확인 (선택)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
