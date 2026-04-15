## 현재 작업 상태
**마지막 업데이트:** 2026-04-15
**작업 상태:** 세션 종료 — Q Talk 실데이터 연결 청크 1~2 완료, 청크 3~7 대기

### 진행 중인 작업
- 없음 (세션 종료)

### 완료된 작업 (이번 세션)

**Q Note 안정화**
- 동시 녹음 방지 시스템 (recorder lock) — DB 컬럼 + acquire/heartbeat/release API + 프론트 keepalive fetch unload 핸들러
- i18n ko/en 문구 + fallback defaultValue
- stale 타임아웃 12s, heartbeat 5s, 다른 탭 폴링 4s

**테스트 인프라**
- 테스트 계정 5종: admin/owner/member1/member2/client @test.planq.kr (모두 Test1234!)
- 로그인 rate limit 화이트리스트 (dev 테스트 이메일만)
- 로그인 페이지 dev 퀵로그인 패널 (dev.planq.kr/localhost 에서만)
- Irene 계정에 3 역할 × 3 워크스페이스 매핑 (워프로랩 owner / 테스트 member / 파트너스 client)

**워크스페이스 스위처**
- `users.active_business_id` 컬럼 + `/api/auth/me` workspaces[] 배열 + `POST /api/auth/switch-workspace`
- 사이드바 상단 dark-teal WorkspaceSwitcher 컴포넌트 (LanguageSelector 와 통일된 디자인)
- LetterAvatar 공용 컴포넌트 (중성 회색 그라데이션 + active/cue variant)

**Q Talk 전면 재설계 + 설계 문서 5개 갱신**
- F5-0 ~ F5-24 Phase 5 전면 재작성 (FEATURE_SPECIFICATION.md)
- 사이트맵/3단 레이아웃/권한 매트릭스 갱신 (INFORMATION_ARCHITECTURE.md)
- 신규 6 테이블 + 확장 DDL (DATABASE_ERD.md 섹션 6)
- Q Talk API 엔드포인트 명세 (API_DESIGN.md 섹션 11.5)
- Q Talk 권한 매트릭스 (SECURITY_DESIGN.md 섹션 3.7)
- F5-2b 초대 링크 미가입/기가입 분기 명시

**Q Talk 청크 1: 프로젝트 CRUD 실데이터**
- DB 마이그레이션: projects / project_members / project_clients / project_notes / project_issues / task_candidates 신규 + conversations/messages/tasks 확장 + business_members.default_role
- Sequelize 모델 6개 신규 + associations
- `/api/projects/*` CRUD + `/api/projects/:id/conversations|tasks|notes|issues|task-candidates` + `/api/projects/conversations/:id/messages`
- 시드 스크립트: 5 프로젝트 (테스트 워크스페이스 3 + 워프로랩 2), 각 프로젝트마다 채널 2 + 메시지 9 + 업무 5 + 메모 4 + 이슈 4 + 후보 2, client@test 를 contact_user_id 로 연결
- 프론트 `services/qtalk.ts` + QTalkPage 전면 재작성 (실 API 기반 병렬 fetch)
- NewProjectModal 에서 실 워크스페이스 멤버 listBusinessMembers fetch

**Q Talk 청크 2: 메시지 전송 + 채널 설정**
- `POST /api/projects/conversations/:id/messages` (reply_to, Socket.IO broadcast)
- `PATCH /api/projects/conversations/:id` (display_name, auto_extract_enabled)
- 프론트 sendMessage/updateConversation 서비스 + QTalkPage 핸들러 실 API 연결
- 권한 필터 엄격 (고객은 customer 채널만 전송, 채널 설정 변경은 멤버만)

**Q Talk UI 컴포넌트 (청크 1 이전 Mock 단계에서 만든 것, 실 API 연결 완료)**
- 3단 레이아웃 + 좌/우 접기/펼치기 + 5 섹션 아코디언
- 채팅 flat list (프로젝트 서브라벨)
- 채팅 이름 인라인 편집
- 프로젝트 생성 모달
- 메시지 흐름 + Cue 답변 대기 카드 (쓰기는 청크 4)
- 우측 탭: 업무 후보 / 주요 이슈 / 내 할 일 / 프로젝트 업무 / 메모 / 정보

### 검증 결과 (이번 세션 누적)
- **헬스체크**: 27/27 ✓ (매 단계 통과)
- **빌드**: tsc 0 error, 최종 번들 `index-BsrszKEA.js` 703KB
- **Recorder Lock E2E**: 8/8 ✓
- **워크스페이스 스위처 E2E**: 14/14 ✓
- **청크 1 CRUD E2E**: 16/16 ✓
- **청크 1 읽기 API E2E**: 13/13 ✓
- **청크 1 전수 회귀**: 29/29 ✓ (owner/member1/client 3 역할)
- **청크 2 E2E**: 16/16 ✓ (메시지 전송 + 채널 설정)
- **SPA 라우트**: /talk /notes /settings /dashboard /login 전부 200

### 다음 할 일 (다음 세션 시작점)

**Q Talk 청크 3 — 업무 후보 자동 추출 (우선 진행)**
- Cue 오케스트레이터 확장 (`services/cue_orchestrator.js` 또는 신규 `task_extractor.js`)
- 커서 기반 LLM 호출 (last_extracted_message_id 이후 메시지만)
- LLM 반환 후 결정론적 후처리 (역할 매핑 → 담당자 자동 배정, 실패 시 default_assignee fallback)
- `POST /api/projects/conversations/:id/task-candidates/extract` — 수동 트리거
- `POST /api/task-candidates/:id/register` — 등록 (→ tasks insert)
- `POST /api/task-candidates/:id/merge-into/:taskId` — 기존 업무에 내용 추가
- `POST /api/task-candidates/:id/reject`
- 프론트 RightPanel candidates 섹션에 실 API 연결
- E2E 청크 3 검증

**Q Talk 청크 4 — 메모/이슈/업무 쓰기 API**
- POST/PUT/DELETE project_notes (가시성 필터)
- POST/PUT/DELETE project_issues
- POST/PUT tasks 상태 전환
- 프론트 RightPanel 해당 섹션 쓰기 연결

**Q Talk 청크 5 — Q Task 페이지 실데이터**
- tasks 전체 조회 / 필터 / 상태 전환 UI
- `/tasks` 라우트 placeholder 제거

**Q Talk 청크 6 — Socket.IO 이벤트 브로드캐스트**
- message:new / cue:draft_* / candidates:created / note:new / project:updated
- 프론트 실시간 UI 반영
- 재접속 로직

**Q Talk 청크 7 — 9단계 전수 최종 검증**

**부가 작업 (시간 나면)**
- Team Settings `/settings/workspace` Members 탭 default_role 편집 UI
- 채팅 검색 인라인 뷰 전환
- 고객 초대 랜딩 페이지 (미가입/기가입 분기)

### Irene 화면 확인 필요 (다음 세션 시작 시)
1. owner@test.planq.kr → /talk → 3 프로젝트 실데이터 로드 + 메시지·업무·메모·이슈·후보 표시
2. client@test.planq.kr → /talk → 브랜드 리뉴얼 + 패키지 디자인 2개만, internal 숨김, Cue 답변 대기 숨김
3. irene → 워크스페이스 스위처로 3 워크스페이스 전환
4. 메시지 전송 실제 작동 (청크 2)
5. 채널 이름 인라인 편집 저장 확인
6. 자동 추출 토글 작동 확인

### 이번 세션의 새 메모리
- `feedback_qtalk_chat_first.md` — Q Talk 네비게이션은 채팅 중심
- `feedback_chunked_verification.md` — 청크 단위 E2E 검증 원칙
- `feedback_ai_minimal_usage.md` — AI 최소 사용 (기존 데이터로 가능한 건 쿼리로 해결)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
