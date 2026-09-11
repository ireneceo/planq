# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-09-11 (Opus 5, 1M)
**작업 상태:** 모바일 채팅 수리 완료 — **Fable VERDICT: PASS (2026-09-11, 묶음 A~E)** · **미커밋**

### Fable 판정 (2026-09-11) — 마지막 PASS `bcf41f49` 이후 12커밋 + 미커밋 채팅 diff
- A 격리 `a8ae55a6` **PASS** — 실HTTP 13/13(양성 대조군 포함) · admintabs/scopetabs/inboxcount 실패 0
- B AI 일정 수정 서버 **PASS** — 실HTTP 38/38 + 소켓 2/2 (preview 무변경 · 격리 · client 403 · revert 전 필드 원복 · 마이그 멱등)
- C 메일 자동연결 **PASS** — 18/18 (이전 FAIL 3건 닫힘 · 백필 멱등 · 운영 백필 미실행 확인)
- D 공개화면 **PASS** — 375/768/1440 실측(center 420 고정 · sticky 툴바 전폭 · 폰 여백 16)
- E 채팅 **PASS** (범위·Swift 모양·가드/빌드) — 단 suites EXIT=1 은 cwd 탓(.env 미로드) → dev-backend 에서 재실행 필요 지적
- ★ **Fable 경고 4건 (판정 밖 — 다음 할 일에 올림)**
  1. 일정 수정 설계 §5.1 미구현 — `routes/tasks.js` PUT 이 `updateSchedule` 을 안 부른다. PUT 은 `start_date` 단독 변경에 이력 없음(술어 두 벌)
  2. `routes/schedule_edit.js:181-191` apply 가 `before` 와 **현재 DB 값을 대조하지 않는다** → 미리보기 뒤 남이 바꾼 날짜를 덮는다. 전건 실패여도 `applied_at` 을 찍는다
  3. `docs/AI_SCHEDULE_EDIT_DESIGN.md:8` "미승인·미구현" 낡음 · `decorate()` weekendAdjusted(101-106) 죽은 코드
  4. `services/mailLink.js:45-60 matchByProjectInvite` — 같은 주소가 프로젝트 2개에 초대돼 있으면 "여럿이면 안 건다" 규칙을 우회해 첫 행에 붙인다(sticky). 운영 해당 0건, dev 4건

### 완료된 작업 (이번 세션, 미커밋)
- **운영 #409 · #410 + Irene 채팅 요청** — `dev-frontend/src/pages/QTalk/ChatPanel.tsx`
  - #409 타이핑 중 가림: `fitTextarea` 가 `height:auto` 로 접었다 펴며 scrollTop 을 깎았고, RO 는 scrollHeight 만 비교해 못 봤다 → 고정 중이면 바닥 유지 + RO 키에 clientHeight
  - #410 딱딱 안 올라감: 따라가기가 `sentinel.scrollIntoView({smooth})` — 전송 1회에 smooth 6 · 목록 scrollIntoView 14회(옛 빌드 실측) → 목록만 즉시(`scrollTop = scrollHeight`), smooth 는 "↓" 버튼만
  - 알림 → 바닥 + 키보드 안 열기: 판정을 폭(≤640) → **터치 기기**(`(hover:none) and (pointer:coarse)` || 앱). 쥔 포커스 해제 · `planq:navigate` 청취 · 앱이 뒤로 갈 때 포커스 해제. 데스크탑은 종전대로 자동 포커스
  - 키보드 up 폰: 입력란 최대 = 가시높이 28% (caret 카나리가 잡은 10px 넘침 — MAIN 291 > 281)
  - `isTouchDevice` 두 벌 → 모듈 하나
- **iOS 키보드 위 ▲▼✓ 줄** — `dev-frontend/ios/App/App/AppDelegate.swift` 에 `WKContentView.inputAccessoryView → nil`.
  ★ `@capacitor/keyboard` 는 쓰지 않는다 — load 때 WKWebView 키보드 옵저버를 떼어내 visualViewport 가 안 줄고 `--vvh` 가 멈춘다.
  **앱 재빌드 필요**(Codemagic `ios-testflight` 수동 트리거 — 자동 트리거 없음). Swift 는 여기서 컴파일 불가 → 빌드 성공·실기기 미확인
- **카나리 `canary-chat-bottom` ⑤~⑩ 신설** — 옛 빌드 양성 대조군: 타이핑 가림 4회·태블릿 자동포커스·알림탭 실패 → 새 빌드 25/25.
  ★ 프레임 기록은 옛 코드도 초록(헤드리스는 smooth 를 한 프레임에 끝냄) → **기전(smooth·scrollIntoView 호출 수)** 을 같이 판정
- 게이트(자체): build EXIT 0 · error TS 0 · guard-invariants 44/45 EXIT 0 · health-check 41/41 · e2e caret/mobile/hangulime 실패 0 · tenant 0
- memory: `feedback_headless_hides_smooth_scroll_jank` 신설 · MEMORY.md 압축(342 링크 보존, 도메인 섹션 → `index_domains.md`)

### 다음 할 일 (우선순위 순)
0. **Fable 재검 후 남은 경고 3건 (Irene 판단)** — W1 시작일만 바꿔도 알림 제목·이력 라벨이 "마감일 변경"(이번 변경이 만든 문구 거짓 — "일정 변경" 권고) · W2 기존 결함: PUT `due_date:''` → 500 `Invalid date`(routes/tasks.js:1169) · W3 기존: PUT 은 완료 업무 날짜 편집 허용, updateSchedule 은 거절
1. **Fable 경고 4건 수리 — ✅ Fable VERDICT: PASS (2026-09-11, 113 검사)** (Irene: "고쳐. 안정적인 서비스 기준으로.")
   - `routes/schedule_edit.js` apply/revert: 조건부 UPDATE 선점(동시 1회) · 업무별 지금값 대조(`changed_since_preview`/`changed_since_apply` 건너뜀) · 아무것도 안 바뀌면 선점 해제 409(`nothing_applied`/`nothing_reverted`) · `items[].result` 원장 기록(되돌리기는 적용된 것만) · 알림 **받는 사람당 요약 1통**(`task_schedule_bulk_changed`, notifyTitle ko/en) · 죽은 코드 제거
   - `services/actions/task_actions.js` `logScheduleChange`/`notifyScheduleChange` 신설 · `updateSchedule({notify})`
   - `routes/tasks.js` PUT: 일정 변경을 **값으로** 판정(dateOnlyOf) → 같은 두 함수 호출. 시작일만 바뀌어도 이력·알림(담당자+의뢰자, 본인 제외)
   - `services/mailLink.js` 초대 주소가 프로젝트 여럿 → 프로젝트 비움, 고객 여럿 → 초대 판정 안 함
   - `docs/AI_SCHEDULE_EDIT_DESIGN.md` 상태 머리 갱신
   - 자체검증: 실HTTP **17/17**(원복 잔여 0) · health 41/41 · guard 44/45 EXIT 0
2. 커밋 → Irene "배포" 지시 시 운영 배포 → 운영 `feedback_items` #409·#410 done (배포 직후 같은 세션에서)
3. **iOS 앱 재빌드 + 실기기 확인** — ▲▼✓ 줄 사라짐 · 키보드 올라올 때 입력란 위치 정상 · 알림 탭 시 키보드 안 뜸
4. `pages/Guest/GuestChatPanel.tsx` — 같은 계열(`bottomRef.scrollIntoView` 따라가기, 타이핑 추적 없음). 이번엔 손대지 않음
5. AI 일정 수정 UI(`pages/QProject/ScheduleEditModal.tsx`) — 서버는 Fable 묶음 B 판정 후. 설계 문서 머리 "미승인·미구현" 은 낡음
6. 권한 막힘 2건(운영 메일 자동연결 백필 · 릴리즈노트 v1.48.21 발행) · Irene 판단 3건(관리자 모드 알림 벨 · PublicSignPage 이메일 선노출 · 보고서 공유 링크 무만료)
7. 백로그 — 프로젝트 "주요 이슈" 자동화 · #407 · #381/#382 Q sale · Finance 고정비 입력 UI

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
