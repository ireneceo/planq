# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-09-11 13:25 UTC (Opus 5, 1M)
**작업 상태:** ✅ 완료 — **운영 배포 `1aa8f4c7`** (13:19 UTC, v1.48.21 유지) · Fable PASS · /저장 · /개발완료
**Git:** HEAD `1aa8f4c7` (소스 미커밋 0) · 게이트 마커 = `33c870f9` by fable · 운영 백업 `/opt/planq/backups/20260911_131359`

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션 — 워크스페이스 격리 2차)
**커밋 `33c870f9`** — Fable PASS · 운영 배포 `1aa8f4c7`
1. **통합검색 secret 칸 매칭 제외** — 표 셀 검색이 values JSON 통째 LIKE 후보를 그대로 결과로 써 비밀 칸 값·칸 id 로도 표가 떴다.
   `routes/search.js matchesNonSecretCell` 한 판정을 표 셀·Q info 항목 값이 같이 쓴다. 판정은 SQL 보다 넓어지지 않게(원자 = JSON 표기, 공백만 제거).
2. **Q7 알림(종) = 현재 워크스페이스 + 플랫폼 공지** — `routes/notifications.js notificationScope`(인자 없음 = 플랫폼 공지만 · 비소속 403 · read-all 소켓에 범위) ·
   `hooks/useNotifications.ts`(범위 한 곳) · `NotificationToaster.tsx`(남의 워크스페이스 알림 토스트 안 함)
3. **Q6 상세 7곳** — 캘린더·메일·Q info·파일·청구서·고객은 URL 에 현재 워크스페이스를 넣어 불러 **새지 않고 404**(= 침묵/"찾을 수 없음")였다.
   신규 `GET /api/entity-workspace/:kind/:id`(`routes/entity_workspace.js` — 멤버 이상일 때 business_id 만, 메일은 접근 가능 계정만, 그 외 전부 404) ·
   `utils/workspaceMatch.findOtherWorkspaceOf` · 신규 `hooks/useDirectDetail.ts` · 신규 `components/Common/DetailFallbackDrawer.tsx`.
   자료정리 뷰어(`/docs/brief/:id`)는 **남의 글을 실제로 그리고 있었다** → `isOtherWorkspace`. 캘린더 범위 밖 일정·필터 밖 청구서도 id 로 직접 열린다.
   `QCalendarPage` god-file 래칫 → URL 헬퍼 `calendarUrl.ts` 분리(베이스라인 조정 없음). i18n common `detail.ariaLabel`.
4. 카나리 `canary-detail-open.js` — "내 다른 워크스페이스" 7화면 × 폰·태블릿·데스크탑 + 없는 id + 현재 워크스페이스 음성 대조군(active_business_id 73↔5 원복)

**검증:** Fable PASS(①~④) · 실HTTP 21/21(검색·알림) · 15/15(entity-workspace) · e2e detailopen·tenant·wssync 실패 0(3폭 21/21) · health 41/41 · guard EXIT 0 · build EXIT 0/error TS 0
**배포 검증:** DEPLOY_EXIT 0 · planq.kr health 200 · PM2 online · 운영 `/api/entity-workspace` 무인증 401 · 새 코드 도달 확인 · 개발 현황 id=80
**문서:** CLAUDE.md(워크스페이스 계약 4·7) · UI_DESIGN_GUIDE.md 0-B · WORKSPACE_SCOPE_DESIGN.md(단계 6 2차) · docs/dev-status/next.json

**같은 날 앞선 배포:** `4aa971ef`(06:06, 모바일 채팅 바닥 고정) · `85261888`(08:42, 워크스페이스 단일 정본 단계 0~2 + 신고 8건)

---

### 다음 할 일
> Irene 강조: "워크스페이스별로 데이터 새는 것, 채팅사용 불편한 거, 팝아웃이 워크스페이스별로 안바뀌는 거 — 운영상 문제가 커" · "절대 데이터 새면 안돼"

**A. 워크스페이스 격리 마무리**
1. **단계 3~5** — apiFetch `X-Workspace-Id` 관찰 → 409 `workspace_stale`(목록·집계만) → 추측 폴백 제거(wsscope 베이스 11: cue.js 2 · tasks.js 4 · task_templates 2 · posts · task_priority · task_tags · dashboard/today-review 합산 모드 · cue resolveBusinessId)
2. `today-review` · `projects/workspace/:id/all-tasks` 비소속 200 빈 응답 → 403 통일
3. q-note JWT `businessId` 클레임 없음 → Q Note L3/L4 공유 불통(`q-note/middleware/auth.py:22`, `services/authTokens.js:70`)
4. 소켓 `onWorkspaceSocket` 헬퍼(설계 C7) · ClientTimelinePage 폴백 없음(URL 범위라 누수는 아님)
5. 발견만: ChromeOverlays 에 PairCodePrompt 없음 · 탭 모드 설치 배너 2개

**B. 입력·화면**
6. **입력 임시저장 구조화** — `docs/DRAFT_PERSISTENCE_DESIGN.md` (R=1·S=1 → 설계부터 Fable)
7. **도크 Q note [메모 | 음성메모] 탭** — QNotePage 녹음 엔진 공용 훅 추출
8. 검색 강조 잔여 — AttachmentField 기존 파일 선택 · PostsPage 템플릿 검색 · 위키 발췌 · Q Task 폰 프로젝트 칸
9. AI 일정 수정 화면(`pages/QProject/ScheduleEditModal.tsx`)
10. `pages/Guest/GuestChatPanel.tsx` 채팅 바닥 고정 계약 미적용
11. `whats_new_reads.user_id` FK 없음(무해) · 따옴표 들어간 표 셀 값 검색 불가(기존, JSON 이스케이프)

**C. 사람 차례 (Irene)**
12. **iOS 앱 재빌드**(Codemagic `ios-testflight`) — 키보드 위 ▲▼✓ 줄 제거는 앱 번들에만
13. 운영 피드백 #409·#410 답글(답글 없어 장부 done 0건) · 실기기 채팅 확인
14. 판단 대기 — **platform_admin 이 비소속 워크스페이스에도 알림 범위·entity-workspace 판정이 열리는 것**(Fable 경고, assertWorkspaceAccess 기존 계약) · 관리자 모드 알림 벨 범위 · PublicSignPage 이메일 선노출 · 보고서 공유 링크 무만료
15. 운영 메일 자동연결 백필 · 백로그(프로젝트 주요 이슈 자동화 · #407 · #381/#382 · Finance 고정비 UI)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
