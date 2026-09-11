# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-09-11 15:35 UTC (Opus 5, 1M)
**작업 상태:** 🔄 진행중 — **입력 임시저장 구조화 설계 v2** Fable 재게이트 대기 (구현 전)
**Git:** HEAD `64a327f7` 푸시됨 · 게이트 마커 = `64a327f7` by fable · 미커밋 소스 0
**운영:** 마지막 배포 `e6f2aab0`(14:05 UTC) — **`64a327f7`(Q Note 권한·403 통일·템플릿 저장)은 미배포**

### 진행 중인 작업 — 입력 임시저장 구조화 (Irene "해" — 권장 순서 5번)
- 설계 `docs/DRAFT_PERSISTENCE_DESIGN.md` **v2** — v1 Fable 설계 게이트 FAIL(치명 T1 · 중요 M1~M9 · 경미 m1~m7) 전부 반영, 재게이트 진행 중
- 핵심: **T1** `useDraftText` flush 가 dirty 판정 없이 쓰고 빈 값이면 삭제 → keep-alive 탭·팝아웃의 같은 키 인스턴스가 남의 초안을 지운다 → dirty 규칙 · non-dirty 재읽기
- 라운드 1 순서: dirty 규칙 → `useDraftKey`+`draftKinds` 등록제·이관 6키·사칭 null·kind 별 TTL → 로그인/로그아웃/부팅 청소 → AutoSaveField pending·체인·`key={entityId}` 가드 · 메일 closeCompose(reason) · Q Note 메모 · 업무 설명/결과물 pagehide keepalive → 업무 상세 6입력 → 가드(커버리지·양성 대조군)·카나리 ①~⑧·toggles
- 다음: 재게이트 PASS → 라운드 1 구현 · FAIL → 설계 반영

### 완료된 작업 (이번 세션)
1. **워크스페이스 격리 2차** `33c870f9` — 검색 secret 칸 · Q7 알림 종 · Q6 상세 7곳 — Fable PASS · 운영 `1aa8f4c7`
2. **Q위키 워크스페이스 안내** `de408c61` — 운영 `ccaa8efe`
3. **워크스페이스 단계 3~5** `01d3c207` — X-Workspace-Id · requestScope · 409 workspace_stale · 추측 11곳+합산 3곳 제거 — Fable PASS · 운영 `e6f2aab0` · 운영 실측(헤더 없음 200 / 같음 200 / 다름 409)
4. **Q Note 권한·격리** `64a327f7` — Fable PASS(재검증, 1차 FAIL 2건 수리) · **미배포**
   - L3/L4 공유가 실제로 열림(토큰에 없는 businessId 클레임 비교 → Node internal business-membership)
   - `_load_session_or_403` 기본값 write(생성자만), 읽기 GET 4곳만 `access='read'`
   - 세션 목록 shared/all 소속 확인(기존 누수 — 비소속·고객·해제 멤버에게 L3 세션·share_token 노출) · 토큰 필드 제거
   - internal project-membership·user-project-ids 해제 멤버 제외(L2)
   - all-tasks·today-review 403 통일 · PostsPage 템플릿 저장(localStorage 빈 토큰 401) → apiFetch
   - ★ 배포 시 `planq-prod-qnote` 재시작 필수 · 운영 q-note `.env` 와 Node `.env` 의 INTERNAL_API_KEY 일치 확인(불일치면 L3 공유·shared 목록이 비소유자 전원 403 — "생성은 되는데 공유가 안 열림")

### 다음 할 일
**A. 지금 흐름**
1. 입력 임시저장 설계 재게이트 → 라운드 1 구현 → Fable 게이트
2. `64a327f7` 배포(Irene 지시 시) — 배포 후 운영 `business-membership` internal 호출 `{member:true}` + L3 세션 멤버 GET 200 실측
3. Fable 비차단 경고: QNotePage `FindAnswerBtn` 이 비소유자에게 보임(누르면 403) → 읽기 모드 숨김 — 임시저장 라운드 1 에 묶기

**B. 워크스페이스 — 운영 관찰 뒤**
4. `[wsctx] summary` legacy 0 → 옛 번들 분기 삭제 · Q3 mismatch 409 · Q5 보류 중 읽기 정지 · onWorkspaceSocket(C7)
5. today-review 소속 0 사용자 헤더-only 요청 200 빈 응답(no_canonical 합산) · list_sessions scope=mine 소속 미검사(본인 행만, 설계 판단)

**C. 입력·화면**
6. 도크 Q note [메모 | 음성메모] 탭 · 검색 강조 잔여 · AI 일정 수정 화면 · GuestChatPanel 바닥 고정 · PairCodePrompt/설치 배너 2개

**D. Irene 차례**
7. iOS 앱 재빌드 · #409·#410 답글 · 판단: platform_admin 비소속 알림 범위 · 관리자 모드 알림 벨 · PublicSignPage 이메일 선노출 · 보고서 공유 링크 무만료 · 운영 메일 백필·백로그

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
