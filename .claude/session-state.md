# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-09-11 08:55 UTC (Opus 5, 1M)
**작업 상태:** ✅ 완료 — **운영 배포 `85261888`** (08:42 UTC, v1.48.21 유지) · /저장 · /개발완료
**Git:** HEAD `85261888` 이후 문서 커밋(개발완료) · 게이트 마커 = 85261888 by fable

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
**운영 배포 ① `4aa971ef` (06:06)** — 모바일 채팅 바닥 고정(#409·#410) · 알림 탭 키보드 안 띄움 · AI 일정 수정 서버 안정화 · 업무 날짜 이력/알림 · 메일 자동연결 다중 프로젝트 · 확인필요/관리자 탭 격리

**운영 배포 ② `85261888` (08:42)** — 커밋 2개, Fable PASS ×2
- `a276a321` 워크스페이스 단일 정본 단계 0~2 — 정본 자가치유 · 서버 추측 제거(+가드 wsscope) · 전 창 전파(`WorkspaceSyncGuard` App 루트, 카나리 wssync) · Q Note/도크 이름·메뉴
- `85261888` 같은 날 신고 8건 — ①메일 답변필요(Gmail 자기참조 오판·영어 관용구) ②채팅 알림 점프 ③전환기 숫자 제거 ④외부컨펌 리스트업(`reviewStage` 단일 술어 + 칩) ⑤다른 워크스페이스 상세·탭 섞임(`DetailFallback other_workspace` 6화면 · tabStore) ⑥새 소식 개별 읽음(`whats_new_reads` 신규) ⑦Q Talk 빈 방 문구 ⑧검색 강조 + 왜 걸렸는지(~30화면)

**검증:** Fable 격리 매트릭스(비소속자 403 · 고객 계정 누수 0 · 다른 워크스페이스 상세 8/8) · health 41/41 · guard 45/46 EXIT 0 · e2e ✅99/❌0 · tenant 0 · 실브라우저 21/21 · Q위키 커버리지 EXIT 0
**배포 검증:** DEPLOY_EXIT 0 · planq.kr health/200 · PM2 online · `whats_new_reads` 존재 · 백업 `/opt/planq/backups/20260911_083633`

**문서:** DEVELOPMENT_PLAN.md(히스토리) · CLAUDE.md(워크스페이스 단일 정본 계약 + 술어 단일 원천 3종) · UI_DESIGN_GUIDE.md(0-B other_workspace · 0-B-2 검색 강조) · WORKSPACE_SCOPE_DESIGN.md · WORK_FLOW_DESIGN.md §5 · TASK_HOLD_EXTERNAL_REVIEW_DESIGN.md §4 · DRAFT_PERSISTENCE_DESIGN.md(초안)
**Memory:** `feedback_two_render_trees_global_mount` · `feedback_freemail_message_id_not_sender_domain` · `feedback_fix_structure_not_screen`

---

### 다음 할 일 (Irene 2026-09-11: "지금 남은 거 다음 섹션에서 할테니 제대로 저장해")
> Irene 강조: "워크스페이스별로 데이터 새는 것, 채팅사용 불편한 거, 팝아웃이 워크스페이스별로 안바뀌는 거 — 운영상 문제가 커" · "절대 데이터 새면 안돼"

**A. 워크스페이스 격리 마무리 (최우선)**
1. **Q7 알림(종) 목록 = 현재 워크스페이스만** + 플랫폼 공지 — 결정 완료(`docs/WORKSPACE_SCOPE_DESIGN.md` Q7), 미구현. 지금은 같은 사람의 다른 워크스페이스 알림이 섞인다
2. **Q6 미적용 상세 6곳** — 캘린더 `?event=` · Q Mail `?thread=` · Q info `?doc=` · Q File `?file=` · 청구서 `?invoice=` · 고객 `?client=` → `DetailFallback status="other_workspace"`
3. **단계 3~5** — apiFetch `X-Workspace-Id` 관찰 → 409 `workspace_stale`(목록·집계만) → 추측 폴백 제거(wsscope 베이스 11: cue.js 2 · tasks.js 4 · task_templates 2 · posts · task_priority · task_tags · dashboard/today-review 합산 모드 · cue resolveBusinessId)
4. **통합검색 표 셀 secret 칸 매칭** — secret 값으로 검색하면 표 문서가 뜬다(값 미노출). `routes/search.js` 표 분기에 KB valHits(#334) 같은 secret-only 제외 — **필수**
5. `today-review` · `projects/workspace/:id/all-tasks` 비소속 200 빈 응답 → 403 통일
6. q-note JWT `businessId` 클레임 없음 → Q Note L3/L4 공유 불통(`q-note/middleware/auth.py:22`, `services/authTokens.js:70`)
7. 발견만: ChromeOverlays 에 PairCodePrompt 없음 · 탭 모드 설치 배너 2개

**B. 입력·화면**
8. **입력 임시저장 구조화** — `docs/DRAFT_PERSISTENCE_DESIGN.md` (AutoSaveField 언마운트 flush → useDraftText 정본·키 user+biz+entity → 업무상세 6입력 → 민감 입력 차단·가드·e2e). R=1·S=1 → 설계부터 Fable
9. **도크 Q note [메모 | 음성메모] 탭** — QNotePage 녹음 엔진 공용 훅 추출
10. 검색 강조 잔여 — AttachmentField 기존 파일 선택 · PostsPage 템플릿 검색 · 위키 발췌 · Q Task 폰 프로젝트 칸
11. AI 일정 수정 화면(`pages/QProject/ScheduleEditModal.tsx`) — 서버 운영 반영됨
12. `pages/Guest/GuestChatPanel.tsx` 채팅 바닥 고정 계약 미적용
13. `whats_new_reads.user_id` FK 없음(무해)

**C. 사람 차례 (Irene)**
14. **iOS 앱 재빌드**(Codemagic `ios-testflight`) — 키보드 위 ▲▼✓ 줄 제거는 앱 번들에만
15. 운영 피드백 #409·#410 답글 · 실기기 채팅 확인
16. 판단 대기 — 관리자 모드 알림 벨 범위 전환 · PublicSignPage 이메일 선노출 · 보고서 공유 링크 무만료
17. 운영 메일 자동연결 백필 · 백로그(프로젝트 주요 이슈 자동화 · #407 · #381/#382 · Finance 고정비 UI)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
