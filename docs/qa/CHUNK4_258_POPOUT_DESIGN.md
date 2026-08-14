# 청크 4 — #258 팝아웃 재구조화 설계안 (Fable 설계 게이트 **APPROVE WITH CHANGES** 반영본)

> 2026-08-13. 스파이크 실측 완료 + Fable 판정 반영. 아래 §9 가 **구현의 정본**이다.

---

## 9. Fable 판정 반영 (2026-08-13) — 구현 정본

판정: **APPROVE WITH CHANGES**. 방향(도크 핀 = 메인 탭 소유) 승인, 변경 8건 필수.

### 9-1. 치명 2건 — 초안이 덮고 있던 지뢰

**C-1. 핀 컨트롤러를 `RightDock` 에 두지 말 것 → App 레벨 싱글턴.**
`RightDock.tsx:47-50,72` 는 공개 표면·`/memo` 경로·비멤버 조건에서 `return null` 로 **언마운트**된다.
컨트롤러(pipRef·폴링·BroadcastChannel 리스너)가 도크 안에 살면 메인 탭이 그 경로로 이동하는 순간
PiP 가 **고아**가 된다(살아는 있는데 해제 요청 수신자·폴링·pin-ack 응답자가 없다).
→ 진입 **버튼만** 도크에, **소유 상태는 App 레벨 싱글턴**에.

**C-2. `releasePip`/`onPipGone` 의 홀더 시대 부작용을 명문으로 제거.**
`pinHost.ts:166` `window.resizeTo(width,height)` · `:177` `window.close()` 는 소유자가 팝아웃 창일 때의 코드다.
소유자가 메인 탭이 되면 해제 시 **사용자의 메인 브라우저 창을 520×780 으로 리사이즈**하고,
PiP 소멸 시 **메인 탭을 닫으려** 시도한다. 초안 §2-3 의 "구조 동일, 수신자만 바뀜" 서술이 이 지뢰를 덮었다.
→ 메인 탭 소유 경로에서는 resize/close/홀더 변신 **전부 제거**.

### 9-2. 필수 4건

**C-3. 절단면 보강** — §7 목록을 아래로 대체한다.
- **추가**: `pages/QTask/QTaskStandalonePage.tsx` · `pages/QTalk/QTalkStandalonePage.tsx` ·
  `pages/QNote/NoteCaptureStandalonePage.tsx` · `pages/Help/HelpStandalonePage.tsx`
  — 4곳 전부 `usePinHost` + `PinHolderView` + `PopoutPinButton` 을 배선한다. 홀더 제거 = 4곳 수정.
- **추가**: `public/locales/{ko,en}/common.json` — 도크 핀 진입·복원 칩 문자열의 ns 는 `common` 이다(qtask 아님).
- **추가**: App 레벨 컨트롤러 신규 파일(C-1).
- **삭제**: `dev-backend/routes/tasks.js` — **불필요 확정**. my-week 는 이미
  `{ model: Project, attributes: ['id','name'] }` 를 include 한다(`routes/tasks.js:121`).
  **이 청크는 백엔드 무변경으로 완결된다.**

**C-4. 정직한 문구** — F5 만 쓰면 부정직하다. **메인 탭 닫기·로그아웃·풀 네비게이션도 핀을 죽인다.**
홀더 방식은 메인 탭을 완전히 닫아도 살았다는 사실을 함께 적는다.

**C-5. 퀵애드 기본값의 정합 원천** (§4 를 이것으로 대체)
- 이번 주 탭 `planned_week_start` — **클라이언트 계산 금지.** `/my-week` 응답의 `week` 필드
  (백엔드가 워크스페이스 tz 로 계산한 monday, `routes/tasks.js:177`)를 **그대로** 쓴다.
  `weekTaskSet.js:45` 술어가 **정확 일치**라, 브라우저 tz 로 만든 monday 가 어긋나면 "추가 즉시 사라짐" 재발.
- 오늘 탭 `due_date` — "워크스페이스 tz" 가 아니라 **뷰 자신의 `todayStr`**(TaskPopoutView:165-169).
  탭 술어(`inTodaySet` ②)의 입력과 **같은 값**이어야 게이트 통과가 보장된다.
- broadcast — **확인 완료**(추가 아님): `taskActions.createTask` 가 `task:new` + `inbox:refresh` emit
  (`task_actions.js:446-449`), 팝아웃 리스너 기존 존재(TaskPopoutView:291-295). §16 충족.

**C-6. 퀵애드 상세 3건** — ① `e.nativeEvent.isComposing` 가드(한국어 IME 조합 확정 Enter 이중 발화 차단)
② 성공 후 입력값 클리어 + **focus 유지**(연속 입력 = "메모장" 수용 기준의 핵심) ③ 빈/공백 제목 차단 + trim.

### 9-3. G 결정 (Irene 이 원문에서 Fable 에 위임 → 확정)

운영 실측: `tasks.priority` **없음**, `priority_order` 보유 업무 **전 운영 19건**,
business 1 에 중복 5그룹(1×5, 2×4, 3×3, 4×4, 5×3) 실재.

- **(a) 우선순위 칩 = 이번 주 탭에서만 유지. 오늘 탭에서는 숨긴다(토글 버튼 포함).**
  `priority_order` 의 의미의 고향은 주간 랭킹이다. 오늘 탭 디폴트인 태그 그룹 보기에서는
  칩 번호와 행 순서가 항상 어긋나며, 오늘 ⊆ 이번 주라 관리는 탭 1회 전환으로 충분하다.
  #250 요구("우선순위 관리도 여기서")는 이번 주 탭에서 그대로 존속하므로 과거 요구와 충돌 없음.
- **(b) 드래그앤드롭 = 이번 청크 제외. `priority_order` 위에서는 비권장.**
  값 보유가 19건뿐이라 자유 순서를 지원하려면 이번 주 집합 **전체에 값을 강제 부여**해야 하고,
  그것이 곧 범용 우선순위 승격(이전 판정과 정면 충돌)이다. 그룹 보기 위의 드래그는 의미도 붕괴한다
  (태그 그룹 간 이동 = 태그 변경인가?). 화면 보기를 입력으로 DB 를 재작성하는 것은
  memory `feedback_display_input_must_not_be_filtered` 가 박제한 사고 계열이다.
  진짜 수요가 재확인되면 **별도 개인 정렬 컬럼**(user-scope, priority_order 무관)으로 독립 설계.
- **Enter 단독 저장 = 정당한 예외로 승인** — UI_DESIGN_GUIDE 1.8 의 금지 근거가 "멀티필드 폼"이라
  단일 필드 퀵애드에는 성립하지 않는다. 단 C-6 3조건 부과.

### 9-4. 권고 2건

- **C-7.** 태그 0개 워크스페이스에서 오늘 탭 디폴트(태그별)가 전 행을 "태그 없음" 단일 그룹으로 덮는 소음 →
  `hasAnyTag === false` 면 **그룹 헤더 억제**(현 SortToggle 노출 조건과 같은 원칙).
- **C-8.** 스코프 명시 — ① 도크 핀 진입이 4개 도구 전부인지 qtask 만인지 + 도크 UI 확정
  ② qnote 녹음 확인 흐름(`PopoutPinButton.isRecording`)의 거취(신설계 핀은 창 변신이 아니라 새 인스턴스 생성).

### 9-5. 스파이크 재검증 (Fable 반증 결과)

계측 **건전** 판정 — `spike.js` 실행 플래그에 `--disable-popup-blocking` **없음**(과거 거짓양성 원인 부재 확인),
CDP trusted click 으로 진짜 activation 소비, 심장박동 소스가 단 1개라 오염 불가, 양성(10·7)·음성(0) 대조 존재.
**잔여 공백 1건**: 신고자 실환경은 macOS Chrome **PWA standalone**(`client_env.standalone: true`)인데
스파이크는 일반 탭이었다 → **구현 검증에 PWA standalone 항목 추가**(블로커 아님).

### 9-6. 구현 순서 (위험 오름차순, 각 단계 독립 배포 가능)

1. **보기 칩(C·D) + 우선순위 칩 정리(G-a) + 제목 교정** — 순수 뷰 로직, 백엔드 0, 핀과 무관. ← **착수**
2. **퀵애드(E)** — 기존 라우트·broadcast 재사용 확인 완료. C-5 게이트 스윕 검증 동반.
3. **Q Task 이동 버튼(F)** — BroadcastChannel navigate, 소규모.
4. **핀 재구조화(A) — 마지막.** 4개 도구 공용 인프라 재작성 + App 레벨 컨트롤러 + 프로토콜 이동으로
   파급 반경 최대. 1~3 이 안정된 뒤 착수해야 검증 실패의 귀책이 분리된다.

god-file: TaskPopoutView 650줄 → `ViewChips`·`QuickAddRow` 절출을 **1단계부터** 시작(주석 깎기 금지).

### 9-7. C-8 스코프 확정 (4단계 구현 시점, 2026-08-14)

권고로 남아 있던 열린 질문 2건을 아래로 확정한다.

- **① 진입 범위 = 4개 도구 전부.** 도크 "열기" 그룹의 각 행에 고정 버튼을 **형제**로 둔다
  (열기=새 창 / 고정=PiP — 결과가 다르므로 한 버튼에 겹치지 않는다). 행을 `div` 로 바꾼 이유는
  button-in-button 이 HTML 상 무효라 브라우저가 클릭 타깃을 임의로 접기 때문이다.
  모바일은 `supportsPin()` 이 false → 고정 버튼 자체가 없다(창 개념이 없다).
  잃어버린 핀은 `sessionStorage['planq:pin:last']` 근거로 **복원 칩 1개**로만 되돌린다.
- **② 녹음 확인(`isRecording`)은 해제 방향에만 남긴다.** 신설계의 핀은 창 변신이 아니라
  **새 인스턴스 생성**이라, 고정을 켜는 것은 이미 녹음 중인 팝아웃 창을 건드리지 않는다(확인 불필요).
  반대로 PiP **안에서** 해제하면 그 인스턴스가 닫히며 마이크가 죽으므로 확인을 유지한다.
- **해제의 정의 = 그 도구가 닫힌다.** 일반 창으로 되돌리지 않는다 — 되돌리려면 `window.open` 이
  필요한데 그 제스처의 출처가 PiP 안 iframe 이라 메인 탭에는 activation 이 없다(§2-1 물리).
  도크에서 1클릭으로 다시 열 수 있으므로, 창을 몰래 띄우는 쪽보다 이 절단면이 정직하다.
- **Q Talk 핀은 대화 문맥을 물려받지 않는다.** 소유자가 메인 탭이라 팝아웃 창의 `?conv=` 를 알 수 없다 →
  항상 기본 `/talk-popout`. (옛 홀더 방식은 자기 창의 URL 을 그대로 실었다.)

---

> 아래는 초안 원문(§0~§8). §9 와 충돌하면 **§9 가 이긴다.**

---

## 0. 원문 재독 — 요약본이 잘라먹은 것

`feedback_items#258` (2026-08-10 12:08, user 1, page_url `/talk?conv=10`, PWA standalone 440×720) 원문에는
"핀 홀더 창" 외에 **다섯 가지 요구가 더** 들어 있다. session-state 요약은 첫 항목만 남겼다.

| # | 원문 요구 | 현재 상태 |
|---|---|---|
| A | "항상 위 창에서 보고 있습니다 이런 창이 하나 더 열려있는데 왜 있어야 해? 이 핀해제를 실제 팝아웃에 나오게 하면 되는 거 아니야?" | ❌ 홀더 창 존재 (`PinHolderView`) |
| B | "오늘 내업무랑 이번 주 내 업무를 여기 팝아웃에서 탭으로 2개" | ✅ 완료 (`5ad38c8` 배포) |
| C | "업무 태그를 제대로 리스트에 나오게 하고, **오늘의 내 업무에서는 태그별 보기를 디폴트로**, 프로젝트별 보기, 마감일별 보기 필터를 클릭하면 바뀌게" | ⚠️ 태그순 정렬은 있으나 **디폴트 아님**, 프로젝트별·마감일별 **없음** |
| D | "이번 주 내 업무 탭에서는 마감일순을 디폴트로 (기존 Q task와 같으면 돼)" | ⚠️ 현재 디폴트는 `priority_order → due → title` 사슬 |
| E | "이 팝아웃에서는 업무를 바로 바로 추가할 수 있어야 해. 입력해서." | ❌ 없음 |
| F | "Q task로 가는 버튼이 상단에 있어야 하지 않아?" | ❌ 없음 |
| G | "우선순위는 어떻게 해야할지 모르겠는데 **fable이 판단해**" · "드래그 드롭으로 순서를 마음대로 이동하면 좋을 것 같긴 한데 필터로 정돈해야 하는 것 같기도" | 🔵 Fable 판단 요청 (원문 명시 위임) |

마지막 줄: **"메모장 할일목록을 쓰는 사람들이 불편하지 않아야 해."** — 이 문장이 수용 기준이다.

부수 발견: `Head` 의 `HeadTitle` 이 `'이번 주 내 업무'` 고정이라 **오늘 탭에서 제목이 거짓말**을 한다
(memory `feedback_new_behavior_makes_copy_lie`).

---

## 1. 스파이크 실측 (2026-08-13, Chrome 147 headful/xvfb, localhost secure context)

하니스: `scratchpad/pip-spike/{server.js,spike.js}`. 생존 판정은 **PiP 안 문서가 BroadcastChannel 심장박동을
계속 쏘는가**로만 했다 — 메인 탭의 `documentPictureInPicture.window` 참조는 reload 후 어차피 사라져 증거가 못 된다.

| 스파이크 | 결과 | 실측 근거 |
|---|---|---|
| S0 | PiP API 존재, **메인 탭 클릭으로 PiP 열기 성공** | `PIP_OPENED`, 심장박동 10건 수신 |
| **S1** 메인 SPA 네비 중 생존 | ✅ **생존** | `history.pushState` 후 심장박동 7건 계속 · 참조 생존 |
| **S2** 메인 F5 | ❌ **사망** | reload 후 심장박동 **0건** |
| **S3** PiP 안 `window.open` | ✅ **가능** | 페이지수 4→5, `OPENED=true` |

**탐지기 유효성**: 같은 계측이 살아있을 때 10·7건, 죽었을 때 0건을 냈다 — 양·음성 대조가 한 실행 안에 있다
(memory `feedback_guard_must_be_falsified`).

**S1 PASS → 청크 진행 조건 충족.** (S1 FAIL 이 중단 조건이었다.)

---

## 2. A — 핀 재구조화 (홀더 창 제거)

### 2-1. 채택안: 도크에서 핀 진입, **메인 탭이 PiP 를 소유**

```
[현재]  도크 → window.open(팝아웃 창) → 팝아웃 헤더의 핀 → 팝아웃이 자기 PiP 를 열고
        자신은 360×132 홀더로 축소  ⇒ 창이 2개 (사용자 호소)

[변경]  도크 → 핀 버튼 → 메인 탭이 requestWindow() → PiP 안 iframe = /task-popout
        ⇒ 창이 1개. 홀더 없음. 해제 버튼은 PiP 안 헤더에 있다(원문 요구 그대로).
```

근거: S1 로 "소유 창이 SPA 네비를 해도 PiP 가 산다"가 확정됐다. 메인 탭은 SPA 라 라우팅은 pushState 이므로
사용자가 PlanQ 안을 돌아다니는 동안 핀은 유지된다.

### 2-2. S2(F5 사망)의 처리 — 정직한 절단면

메인 탭 F5 = PiP 사망은 **브라우저 물리**라 코드로 못 막는다. 대신:

1. **자동 reload 는 이미 막혀 있다** — `BuildVersionGuard.isReloadSafe()` 가
   `body.dataset.pipActive === '1'` 이면 false 를 반환한다(`pinHost.markPipActive` 가 세운다).
   도크 핀에서도 **메인 탭 body 에** 같은 플래그를 세우면 신규 빌드 자동 갱신이 핀을 죽이지 않는다.
   → 이 플래그 세팅은 이번 구현의 **필수 항목**이다(빠지면 배포마다 사용자 핀이 사라진다).
2. **수동 F5 는 사용자 자신의 행위** — 사라지는 것이 놀랍지 않도록, 다시 켤 길을 즉시 준다:
   `sessionStorage['planq:pin:last'] = tool` 를 남기고, 메인 탭 로드 시 그 값이 있으면
   **도크 핀 버튼에 "복원" 상태 표시**(칩 1개, 클릭 1회로 재핀). 자동 재열기는 불가능하다 —
   `requestWindow` 는 사용자 제스처를 요구한다. **자동 복원을 약속하는 문구를 쓰지 말 것.**
3. ErrorBoundary 의 chunk reload 도 같은 경로다 — 청크 미스매치는 reload 가 유일한 복구라
   여기서는 핀 보존보다 앱 생존이 우선. 예외로 둔다(문서에 명시).

### 2-3. 기존 팝아웃 창 경로

팝아웃 창(별도 창) 자체는 **유지**한다 — "옆에 두고 쓴다"는 별개 수요다. 다만
**팝아웃 창 헤더의 핀 버튼과 `PinHolderView` 는 제거**한다. 핀은 도크에서만 진입한다.
(두 진입점이 공존하면 "PiP 는 브라우저 전역 1개" 축출 프로토콜을 두 벌 유지해야 한다.)

- `utils/pinHost.ts` — `mode: 'holder'` 분기와 `HOLDER_W/H`, `unpin-request` 왕복 제거.
  PiP 안 iframe(`pip-content`)의 해제는 BroadcastChannel 로 **메인 탭**에 요청한다(구조 동일, 수신자만 바뀜).
- `components/Common/PinHolderView.tsx` — 삭제.
- 축출 선공지(`pin-intent`/`pin-ack`)는 **유지** — 다른 브라우저 도구가 PiP 를 뺏는 상황은 그대로다.

---

## 3. C·D — 보기 기준 (원문의 "필터")

원문은 **정렬이 아니라 "보기"** 를 말한다. 세 가지를 한 줄 칩으로 놓는다.

| 탭 | 디폴트 | 선택지 |
|---|---|---|
| 오늘 | **태그별** (원문 명시) | 태그별 · 프로젝트별 · 마감일별 |
| 이번 주 | **마감일별** (원문 "기존 Q task와 같으면 돼") | 태그별 · 프로젝트별 · 마감일별 |

- 태그별/프로젝트별 = **그룹 헤더 + 그룹 안 기존 사슬** (태그별은 이미 구현된 `byTagRule` 재사용,
  대표 태그 = 사전순 최소는 그대로).
- 마감일별 = `due_date` null-last 오름차순 + 기존 tie-break. **메인 QTaskPage 와 같은 비교자를 쓴다**
  (memory `feedback_display_input_must_not_be_filtered` 의 tie-break 명시 원칙).
- 선택은 `localStorage['planq:taskPopout:view:{tab}']` 에 **탭별로** 기억한다.
- 프로젝트명은 `/my-week` 응답에 이미 실려 오는지 확인 필요 — 없으면 **백엔드에서 같이 실어 보낸다**
  (프론트 N+1 조회 금지). 없는 업무는 "프로젝트 없음" 그룹 맨 뒤.

⚠️ **주의**: 필터는 "보기 기준"일 뿐, **정본 집합을 바꾸지 않는다**. 오늘 탭의 소속 판정(`inTodaySet`)은
그대로다 — 보기 전환으로 업무가 사라지면 안 된다.

---

## 4. E — 인라인 업무 추가

리스트 **상단 고정 한 줄 입력**(placeholder "할 일 입력 후 Enter"). 메모장 감각이 수용 기준이므로 마찰 최소.

- Enter = 추가. 제목만 필수. 나머지는 탭 문맥에서 파생:
  - 오늘 탭 → `due_date = 오늘`(워크스페이스 tz), `planned_week_start = 이번 주`
  - 이번 주 탭 → `due_date` 없음, `planned_week_start = 이번 주`
  - 담당자 = 나 (my-week 는 "내 업무"다)
- ★ **생성 기본값 게이트 전수 확인** — memory `feedback_new_tab_needs_gate_sweep`: 오늘 탭에서 추가한
  업무가 즉시 사라지는 회귀가 이미 한 번 났다. 추가 직후 **그 탭의 술어를 통과하는지** 실브라우저로 검증한다.
- 중복 제출 가드 필수(`submitting` + disabled). Enter 단독 저장은 **이 입력에 한해 허용**한다 —
  UI_DESIGN_GUIDE 1.8 의 "Enter 단독 저장 금지"는 다필드 폼 대상이고, 여기는 단일 필드 퀵애드다.
  **← 이 예외 판단이 맞는지 Fable 확인 요망.**
- 생성은 **기존 라우트 그대로**(신규 라우트 금지). 실시간 16번 체크리스트: `task:new` broadcast 는
  기존 라우트가 이미 하는지 확인, 없으면 추가.

---

## 5. F — 상단 Q Task 이동 버튼

헤더 우측에 텍스트 버튼 1개. 클릭 시:
- **PiP/팝아웃 안**이면 `window.opener` 가 없거나 끊겼을 수 있으므로 **메인 탭에 BroadcastChannel 로 요청**
  (`{type:'navigate', to:'/tasks'}`) → 메인 탭이 `navigate('/tasks')` + `window.focus()`.
  메인 탭이 없으면 `window.open('/tasks','_blank')` 폴백.
  ★ memory `feedback_window_open_noopener_null` — `noopener` 로 열면 핸들이 항상 null 이라
  "실패" 로 오판하지 말 것.
- 동시에 `HeadTitle` 을 **탭에 따라** 바꾼다: 오늘 탭 → "오늘 내 업무" / 이번 주 → "이번 주 내 업무".

---

## 6. G — 우선순위·드래그앤드롭: Fable 판단 요청

원문이 명시적으로 Fable 에 위임했다. 판단에 필요한 사실:

- `tasks.priority` **컬럼은 없다**. `priority_order` 는 **주간 랭킹 전용**이며 DB 에 중복값(1,1,2,3,3,8)이 실재한다.
- 팝아웃은 이미 `priority_order` 칩을 그리고, 태그순 모드에서는 칩 번호와 행 순서가 어긋난다(주석에 "정상"으로 명시).
- 이전 라운드 Fable 판정: **`priority_order` 를 범용 우선순위로 승격하는 것은 비권장**.
- 드래그앤드롭 순서는 `priority_order` 를 쓰기측으로 건드리는 일이라, 승격 여부와 한 몸이다.

**질문**: (a) 팝아웃에서 우선순위 칩을 유지할 것인가 / 오늘 탭에서는 숨길 것인가?
(b) 드래그앤드롭을 이번 청크에 넣을 것인가, 별건으로 뺄 것인가? (원문도 "필터로 정돈해야 하는 것 같기도"로 미확정)

---

## 7. 절단면 (이 diff 가 건드리는 파일 예정 목록)

```
dev-frontend/src/utils/pinHost.ts                       (홀더 모드 제거, 소유자=메인 탭)
dev-frontend/src/components/Common/PinHolderView.tsx    (삭제)
dev-frontend/src/components/Common/RightDock.tsx        (핀 진입 추가)
dev-frontend/src/components/Common/PopoutPinButton.tsx  (호출부 정리)
dev-frontend/src/components/QTask/TaskPopoutView.tsx    (보기 칩·퀵애드·Q Task 버튼·제목)
dev-frontend/src/components/Common/BuildVersionGuard.tsx(pipActive 플래그 경로 확인 — 변경 없을 수 있음)
dev-frontend/public/locales/{ko,en}/qtask.json          (신규 문자열 ko/en)
dev-backend/routes/tasks.js                             (my-week 응답에 project 정보 — 필요 시에만)
```

god-file 래칫: `TaskPopoutView.tsx` 650줄 → 퀵애드·보기 칩이 들어가면 800줄 경계에 근접.
**하위 컴포넌트 절출을 처음부터 계획**한다(주석 깎기로 통과시키지 않는다).

---

## 8. 검증 계획 (구현 후 Fable 게이트)

1. 실브라우저(headful/xvfb): 도크 핀 → PiP 1개만 뜸(홀더 0개) · SPA 네비 후 생존 · 해제 버튼이 PiP 안에 있음
2. 자동 reload 억제: `body.dataset.pipActive === '1'` 상태에서 `isReloadSafe()` false 반증
3. 퀵애드: 오늘 탭 추가 → **즉시 그 탭에 남아 있는가**(사라짐 회귀 반증) + DB `due_date`/`planned_week_start`/`assignee_id` 실측
4. 보기 전환: 세 기준 전환 시 **행 개수 불변**(정본 집합 불변 증명)
5. 실시간 16번: 2탭(A 추가 / B 관찰) 즉시 반영
6. 가드 3축 + i18n 하드코딩 래칫 + 빌드 EXIT 별도 파일 박제
7. 검증 데이터 전량 원복 + 잔여 0 증명
