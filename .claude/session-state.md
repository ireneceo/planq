# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-15
**작업 상태:** 완료 — 사이클 N+16 운영 라이브 (v1.11.0)
**버전:** v1.11.0 (운영 라이브, commit `36362fc`)

### 완료된 작업 (이번 세션 — 사이클 N+15 + N+16-A~E 통합)

**N+15** Q Talk UX 통합 (v1.10.0, commit `669a0c5`):
- 진입 로딩 점프 fix + localStorage 캐시 + LeftPanel skeleton + ChatPanel 메시지 skeleton
- 모바일 키보드: form wrap + visualViewport keyboard-up 감지 + 전송 후 focus 복원
- 메시지 읽음 표시 (read_by_count + other_count + socket 'conversation:read')
- 채팅 리스트 WhatsApp 한 줄 last_message_preview + 실시간 동기화 (옵티미스틱)
- 발신자 클릭 → UserInfoPopover (BusinessMember + Client 통합)
- 메시지 옵티미스틱 local insertion (tempId 음수)
- 우측 하단 floating ↓ 버튼 + pending 새 메시지 뱃지
- PinBtn/MenuBtn 항상 표시 (hover-only 폐지)

**N+16-A** Q docs 코드 블록 + 드래프트 자동저장:
- @tiptap/extension-code-block-lowlight + lowlight common 30+ 언어팩
- CodeBlockNodeView: 회색 배경 + atom-one-dark syntax + 언어 selector (button+popover) + 복사 버튼
- useLocalDraft hook (localStorage debounce 500ms, 7일 TTL) + ProjectPostsTab 드래프트 자동 복원 + 주황 배너

**N+16-B** Google Drive/Calendar 닫기 + 이메일 fix:
- buildCallbackHtml 헬퍼 통합 (gdrive+gcal)
- postMessage 즉시 + 800ms auto-close + 1.5s fallback 안내 (COOP 차단 회피)
- gcal scope 에 openid email 추가 + id_token JWT email claim 파싱

**N+16-C** 알림 매트릭스 전수조사:
- notification_prefs ENUM 에 comment_mention 추가 (DB ALTER)
- message event UI 노출 (옛 누락 → 이메일 OFF 적용 안 되던 회귀 fix)
- mention 분리: 채팅 @멘션 vs 업무/문서 댓글 멘션
- NotificationToaster prefs matrix fetch + chat channel 검사 (옛 주석만 있고 누락된 회귀)
- 옵티미스틱 useUnreadTotal debounce 200→50ms

**N+16-D** 채팅 아바타 클릭 → 프로필 popover (이메일·직책·소속·회사·전화)

**N+16-E** 메시지 액션 + 핀 공지 + GDrive 이미지 fix:
- DB: messages.pinned_at + pinned_by_user_id
- routes: PUT/DELETE message + POST/DELETE pin + GET pinned (5 라우트)
- ChatPanel: hover toolbar (복사/수정/핀/⋮) + 인라인 수정 + 묶음 선택 + PinnedBar
- (수정됨) / 삭제된 메시지 placeholder / 핀 좌측 노란 띠 / 선택 좌측 teal 띠
- GDrive 이미지 회귀 fix: /raw 가 storage_provider 분기 → Drive API 서버 프록시 stream
- gdrive.js 신규 helper: getFileMeta, getFileStream

### 변경 통계 (이번 세션 누적)

- N+15: 12 files, 1,113 insertions, 130 deletions (commit `669a0c5`)
- N+16: 27 files, 1,790 insertions, 77 deletions (commit `36362fc`)

### 운영 적용

- v1.10.0 라이브: 2026-05-15 05:19 (N+15)
- v1.11.0 라이브: 2026-05-15 08:09 (N+16, commit `36362fc`)
- 백업: /opt/planq/backups/20260515_080732 (on prod)
- 헬스: planq.kr/api/health 200 / planq-prod-backend·planq-prod-qnote online

### 검증 결과

- 헬스체크 28/28 PASS
- API 15/15 PASS (send/edit/edit empty/pin/멱등/list/필드/unpin/delete/edit-deleted/GET제외/타인edit/not_found/raw)
- 빌드 900ms TS 0
- 페이지 5/5 200

### 진행 중인 작업
- 없음

### 다음 할 일 (사용자 메모리 plan 기준 ★ 우선순위)

**★1 Q Note 메모 기능** (음성/텍스트 통합 + Quick Capture)
- `docs/QNOTE_CAPTURE_DESIGN.md` 설계 박제 있음
- `input_type` ENUM, ⌘M FAB, 회의↔메모 동시 사용, 번역 선택 토글, AI 분기 모달
- 현재 상태: 미구현. StartMeetingModal 에 `kind: 'memo'` 옵션만 있음

**★2 Q docs 재구조화 + 자료정리(Brief)** (3 commit 순차)
- `project_qdocs_restructure_brief_plan` — 받은 서명 인박스로 / Q docs 페이지는 문서만 / 자료정리는 AI 탭 확장

**★3 Insights MVP 3탭**
- `project_insights_design` — `/insights` 통계/분석. 관찰→진단→처방 3층
- Weekly Review 의 데이터가 input — 이미 cron 작동 중 → 데이터 쌓이는 중

**차순위 (작은 청크):**
- Q Note L4 share_token UI (백엔드만 완료)
- Post.visibility 마이그레이션 (internal/public → L1-L4)
- SaaS readiness 후속 (checkBusinessAccess 통일 + cue_usage rate-limit + pagination)

**디바이스 실 검증 (Irene 직접):**
- N+15/N+16 운영 실 확인 — 진입 점프 0, 메시지 액션 hover, 핀 공지, 이미지 fix (GDrive 연결 시)
- Google Meet 실 OAuth 검증 (N+13 미완)

### stale 메모리 정정 (이번 세션 발견)

다음 항목은 메모리 plan 에 있었으나 **이미 구현 완료**:
- Q Task 정기업무 (RRULE) — `tasks.recurrence_rule` + `utils/recurrence` 적용 완료
- Weekly Review (주간 보고) — `WeeklyReview` 모델 + `weeklyReviewCron` + `WeeklyReviewTab` + `FinalizeBtn` "이번 주 마무리" 적용 완료

다음 세션에서 메모리 정리 권장.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
