# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-15
**작업 상태:** 완료 — 사이클 N+16 운영 라이브 + 더보기 메뉴 portal hotfix (v1.11.0)
**버전:** v1.11.0 (운영 라이브, commit `36362fc` + hotfix `efb890f`)

### 완료된 작업 (이번 세션)

**N+15 — Q Talk UX 통합 (commit `669a0c5`, v1.10.0):**
진입 로딩 점프 fix / 캐시 + skeleton / 모바일 키보드 / 읽음 표시 / WhatsApp 한 줄 preview / 발신자 popover / 옵티미스틱 메시지 / floating ↓ / Pin·Menu 상시 노출

**N+16-A 코드 블록 + 드래프트 자동저장:**
- `@tiptap/extension-code-block-lowlight` + `lowlight` (common 30+ 언어)
- 신규 CodeBlockNodeView (회색 박스 + syntax + 언어 selector + 복사 버튼)
- 신규 useLocalDraft hook (500ms debounce, 7일 TTL)
- ProjectPostsTab 드래프트 자동 복원 + 주황 배너

**N+16-B GDrive/Calendar 보강:**
- buildCallbackHtml 헬퍼 통합 (postMessage 즉시 + auto-close + COOP fallback)
- gcal scope 에 openid email + id_token JWT 파싱

**N+16-C 알림 매트릭스 전수조사:**
- ENUM 에 comment_mention 추가 (DB ALTER 적용)
- message UI 노출 (옛 누락 → 이메일 OFF 안 적용되던 회귀 fix)
- chat @멘션 vs 댓글 @멘션 분리
- Toaster prefs chat 채널 검사 (옛 주석만, 실 코드 누락 회귀)

**N+16-D 아바타 클릭 → 프로필 popover**

**N+16-E 메시지 액션 + 핀 공지 + GDrive 이미지 fix:**
- DB: messages.pinned_at + pinned_by_user_id
- 5 라우트 (PUT/DELETE message + POST/DELETE pin + GET pinned)
- ChatPanel hover toolbar + 인라인 수정 + 묶음 선택 + PinnedBar
- GDrive 이미지 회귀 fix (/raw 가 storage_provider 분기 → Drive API 서버 프록시)

**N+16-F hotfix — 더보기 메뉴 portal:**
- ⋮ 메뉴가 InputBar 뒤로 가던 회귀 fix
- createPortal + fixed + 버튼 rect 좌표 + 하단 공간 부족 시 위로 flip
- z-index 2400 / 페이드 애니메이션 / Esc 닫기

### 변경 통계 (이번 세션 누적)
- N+15: 12 files, 1,113 insertions
- N+16: 27 files, 1,790 insertions
- N+16-F hotfix: 1 file, 70 insertions

### 운영 적용
- v1.10.0 라이브: 2026-05-15 05:19 (N+15)
- v1.11.0 정식: 2026-05-15 08:09 (N+16, commit `36362fc`)
- N+16-F hotfix: 2026-05-15 08:25 (frontend rsync + nginx reload, commit `efb890f`)
- 백업: /opt/planq/backups/20260515_080732 (on prod)

### 검증 결과
- 헬스체크 28/28 PASS
- API 15/15 PASS
- 빌드 923ms TS 0
- 페이지 5/5 200

### 진행 중인 작업
- 없음

### 다음 할 일 (실제 코드 상태 기준 ★)

**★1 Q Note 메모 기능** (음성/텍스트 통합 + ⌘M Quick Capture FAB)
- `docs/QNOTE_CAPTURE_DESIGN.md` 설계 박제 있음
- input_type ENUM, 회의↔메모 동시 사용, 번역 선택 토글, AI 분기 모달
- 현재: 미구현. StartMeetingModal 에 `kind:'memo'` 옵션만 있음

**★2 Q docs 재구조화 + 자료정리(Brief)** (3 commit 순차)
- 받은 서명을 인박스로 / Q docs 페이지는 문서만 / 자료정리는 AI 탭 확장

**★3 Insights MVP 3탭**
- /insights 통계/분석. 관찰→진단→처방 3층
- Weekly Review 데이터가 input (cron 이미 작동 중 → 데이터 쌓이는 중)

**차순위 (작은 청크):**
- Q Note L4 share_token UI (백엔드만 완료)
- Post.visibility 마이그레이션 (internal/public → L1-L4)
- SaaS readiness 후속 (checkBusinessAccess 통일 + cue_usage rate-limit + pagination)

**디바이스 실 검증 (Irene 직접):**
- N+15/N+16 운영 실 확인 — 진입 점프 0 / 메시지 액션 hover / 핀 공지 / 이미지 fix (GDrive 연결 시)
- Google Meet 실 OAuth 검증 (N+13 미완)

### stale 메모리 정정 (이번 세션 발견)
다음 항목은 메모리 plan 에 있었으나 **이미 구현 완료**:
- Q Task 정기업무 (RRULE) — `tasks.recurrence_rule` + `utils/recurrence` 적용 완료
- Weekly Review — `WeeklyReview` 모델 + `weeklyReviewCron` + `WeeklyReviewTab` + "이번 주 마무리" FinalizeBtn 완료

다음 세션에서 메모리 plan 갱신 권장.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
