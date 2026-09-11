# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-09-11 14:15 UTC (Opus 5, 1M)
**작업 상태:** ✅ 완료 — **워크스페이스 단일 정본 단계 3~5** · Fable PASS · **운영 배포 `e6f2aab0`**(14:05 UTC, v1.48.21 유지, 백업 `/opt/planq/backups/20260911_140457`) · /저장 · /개발완료
**Git:** 코드 `01d3c207` + dev-status `e6f2aab0` 푸시 · 게이트 마커 = `01d3c207` by fable · dev 백업 `/opt/planq/backups/dev-daily/20260911`

### 진행 중인 작업
- 없음 (관찰만: 운영 로그 `pm2 logs planq-prod-backend | grep wsctx` — 1시간 요약의 `legacy` 소진 추이)

### 완료된 작업 (이번 세션)
**1. 워크스페이스 격리 2차** `33c870f9` — Fable PASS · 운영 `1aa8f4c7`
- 검색 secret 칸 매칭 제외 · Q7 알림 종 = 현재 워크스페이스 + 플랫폼 공지 · Q6 상세 7곳(`/api/entity-workspace` · `useDirectDetail` · `DetailFallbackDrawer` · 자료정리 뷰어 누수)

**2. Q위키 워크스페이스 안내** `de408c61` — Fable PASS · 운영 `ccaa8efe` + 운영 seed

**3. 워크스페이스 단일 정본 단계 3~5** `01d3c207` — Fable PASS · 운영 `e6f2aab0`
- C2 `X-Workspace-Id` — `contexts/AuthContext.tsx`(모듈 변수 `requestWorkspaceId` 를 `setUser` 래퍼에서 렌더 전 미러 · apiFetch 첫 요청/401 재시도 · apiUpload · 같은 출처만 · 409 → `planq:workspace-stale`)
- C3 신규 `dev-backend/middleware/workspaceContext.js` — `observe` · `requestScope(req, 명시값, {legacy})` · `staleResponse` · `[wsctx] summary/stale/mismatch/legacy` 로그
- C5 추측 11곳 + 합산 3곳 → `requestScope` (tasks my-week/month/year/backlog · task_templates · task_priority · task_tags · posts editor-image · cue · dashboard/todo · today-review · me/external-connections)
- `WorkspaceSyncGuard` ④ stale 리스너 · CORS `X-Workspace-Id` · 가드 wsscope `workspaceCanonical` 규칙 + 베이스라인 11→0 · 카나리 wssync ⑥
- **설계 이탈:** 관찰 1~2일 대기 대신 헤더 없는 요청(옛 번들)만 종전 동작 — Fable 이 "옛 번들 종전 바이트 동일" 로 안전 판정
- 검증: Fable probe 104 · 실HTTP 23/23 · e2e wssync(⑥)·inboxcount·tenant·detailopen·scopetabs 실패 0 · guard EXIT 0(양성 대조군) · health 41/41 · build EXIT 0
- **운영 실측:** 내부 관리자 계정 읽기 요청 — 헤더 없음 200 · 헤더==정본 200 · 헤더≠정본 409 `workspace_stale` · `[wsctx] legacy`·`stale` 로그 기록 확인

---

### 다음 할 일
**A. 워크스페이스 (마무리)**
1. **운영 `[wsctx] summary` 의 `legacy` 가 0 이 되면** `middleware/workspaceContext.js` requestScope ④ 분기 + `cue.js resolveBusinessId` 첫 멤버십 폴백 삭제 (1~2일 관찰)
2. Q3 `workspace_mismatch` 409 — `mismatch` 로그로 교차 조회 화면 분류 후
3. Q5 보류 중 읽기 정지 · `onWorkspaceSocket`(C7) · internal user-project-ids
4. `today-review` · `projects/workspace/:id/all-tasks` 비소속 200 빈 응답 → 403 통일
5. q-note JWT `businessId` 클레임 → Q Note L3/L4 공유 불통(`q-note/middleware/auth.py:22`, `services/authTokens.js:70`)
6. Fable 경고: cue/help qhelper 모드 stale 검사 없음(데이터 미주입) · PostsPage.tsx:2519 raw fetch 헤더 없음 · editor-image 409/403 시 업로드 파일 디스크 잔존(기존)

**B. 입력·화면**
7. **입력 임시저장 구조화** — `docs/DRAFT_PERSISTENCE_DESIGN.md` (R=1·S=1 → 설계부터 Fable)
8. 도크 Q note [메모 | 음성메모] 탭 · 검색 강조 잔여 · AI 일정 수정 화면 · GuestChatPanel 바닥 고정

**C. 사람 차례 (Irene)**
9. iOS 앱 재빌드(Codemagic `ios-testflight`) · 운영 피드백 #409·#410 답글
10. 판단 대기 — platform_admin 비소속 워크스페이스 알림 범위 · 관리자 모드 알림 벨 범위 · PublicSignPage 이메일 선노출 · 보고서 공유 링크 무만료

### 주요 변경사항
- 서버는 범위 인자 없는 요청을 추측으로 채우지 않는다 — 창이 옛 워크스페이스면 409, 창은 따라간다
- 스키마 변경 없음 · 공개 표면 변경 없음

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
