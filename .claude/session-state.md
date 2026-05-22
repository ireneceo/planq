# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-22
**작업 상태:** 완료
**운영 라이브 버전:** v1.16.2 (commit `7d7accc`, N+32~N+37 9 commit)
**미라이브 commit:** 10 (N+38 + /검증 PlanQ 특수 박제) — 다음 세션 `/배포`

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션 — N+32~N+38)

**N+32~N+37 (v1.16.2 라이브 완료, commit 7d7accc):**
- N+32 Focus 옵션 A 통합 동기 + "내 업무 설정" 메뉴 분리
- N+33 Q Talk 채팅 진입 마지막 메시지 회귀 fix (2.5초 force-stick)
- N+34 Drawer 작성자 표시 + description 라벨 동적 + tasks.js displayName
- N+35 MemoPopup→QNote window CustomEvent + 인박스 안전망
- N+36 "반려"→"건너뛰기" + 옵션 D 후보 만료 (30일 hide / 90일 delete)
- N+37 주간 진척 그래프 actual 미입력 시 추정

**N+38 (10 commit 미라이브):**
- CLAUDE.md 16번 박제 — 실시간 데이터 반영 강제 (4 요소 체크리스트)
- 실시간 동기화 7 영역 적용 — Q docs/Q file/Q Calendar/Q info/Q Bill/Q Project notes·issues/Clients
- workspace 주간보고 정리 — 수동 박제 버튼 + AutoToggle 제거 (banner 만)
- /검증 skill PlanQ 특수 5 항목 박제 — 멀티테넌트/Socket/Q Note/Visibility권한/hydration
- v1.16.1 → v1.16.2 패치

### 다음 할 일 (다음 사이클)

1. **운영 push** — 10 commit 미라이브 (다음 세션 시작 시 /배포)
2. **PWA useVisibilityRefresh 안전망** — N+38 에서 추가한 7 페이지에 hook
3. **실시간 동기화 보강** — posts 11 mutation 보강 / files move·visibility / kb pinned FAQ / QProjectDetailPage / DashboardPage listener
4. **ProfilePage grid 정리** — 빈 열 차단, 기능 묶음 단위 통일 (1938 라인 큰 작업, 회귀 risk)
5. **i18n ko/en 키 정합** — N+32~N+38 신규 키 (`nav.myWorkSettings`, `bar.disabledTitle`, `detail.descriptionSelf/Request`, `right.candidates.showOld/hideOld`, `candidateModal.skip` 등 다수)
6. **Playwright MCP e2e 도입** — /검증 10단계 통합 (`--e2e` 옵션). 셋업 1~2일. PlanQ + purplehere 둘 다 적용. LLM auto-fix 는 selector 한정만, 비즈니스 로직 자동 수정 금지
7. **나머지 task GET 라우트 displayName** — my-week / my-month / my-year / backlog
8. **다른 라우트 displayName 전수** — dashboard.js / stats.js / calendar.js / docs.js / records.js

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

`/개발시작` 명령 시 위 "다음 할 일" 섹션이 가장 먼저 안내됩니다.
