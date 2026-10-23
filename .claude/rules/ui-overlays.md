---
paths:
  - "dev-frontend/src/**"
  - "dev-frontend/UI_DESIGN_GUIDE.md"
  - "scripts/e2e/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 화면 — 새 탭·드로어·모달·상단 기준선·검사 하니스 요건

## UI 규칙 — 하던 일 위에 얹히는 진입점은 새 탭 (2026-08-28 박제)

**알림·새 소식처럼 헤더 아이콘에서 여는 드롭다운의 항목은 `tabStore.openInNewTab(path)` 로 연다.**
`navigateActive` 는 보던 탭을 덮어써서, 글 쓰던 중 알림 하나 눌렀다가 그 화면을 잃는다
(Irene: "드롭다운에서 갑자기 탭 내용 바뀌면 하던 일 문제될 것 같아").

- 같은 화면이 이미 열려 있으면 **새로 만들지 않고 그 탭으로** 간다 (탭 무한 증식 방지)
- 미러 모드(단일 탭·모바일)는 탭 개념이 없으므로 종전대로 이동
- `<ChromeLink to=… newTab>` 로도 같은 동작. 사이드바 메뉴 같은 **주 내비게이션은 종전대로**(새 탭 X)

**드롭다운 껍데기는 `components/Common/dropdownShell.ts` 에서 가져다 쓴다.**
각자 styled 를 다시 선언하면 반드시 갈라진다 — 알림과 새 소식이 서로를 베껴 만들어져
아이콘 유무·안읽음 표시 위치·빈 상태 여백·목록 폭이 전부 달랐고, **전체보기 페이지는
링크 없는 알림을 눌러도 아무 일이 없는 기능 결손**까지 있었다.

**팝아웃 도구는 `RightDock.launchDockTool(tool)` 단일 진입점.**
`openDockTool` 은 이름과 달리 **모바일 in-app 폴백 전용**이라 그것만 부르면 데스크탑에서
아무 일도 안 일어난다(실측).

---

## UI 규칙 — 드로어 접근성 (신규 코드 필수)

모든 드로어·모달은 아래 훅을 반드시 사용한다. 프리미티브 `DetailDrawer` 는 이미 내장.

```tsx
import { useBodyScrollLock } from 'hooks/useBodyScrollLock';
import { useFocusTrap } from 'hooks/useFocusTrap';
import { useEscapeStack } from 'hooks/useEscapeStack';

const ref = useRef<HTMLElement>(null);
useEscapeStack(open, onClose);           // 중첩 모달 안전한 Esc (최상단만 닫힘)
useFocusTrap(ref, open);                 // Tab 순회 + 복귀
useBodyScrollLock(open);                 // ★ **가운데 모달에만.** 우측 곁패널에는 쓰지 않는다 (아래)
// 드로어 루트: ref + role="dialog" + aria-modal="true" + aria-label
```

### ★ 배경 스크롤 — **가운데 모달만 잠근다** (2026-09-13 계약 변경)

> Irene: *"우측패널들 열려있어도 좌측에 나오는 화면은 스크롤 반응하게 해. 고정할 필요 있어?
> 어둡게 했으면 됐지. 리스트들이든 뭐든 스크롤 반응은 막지마."*

| 종류 | 배경 스크롤 | 이유 |
|---|---|---|
| **우측 곁패널** (`DetailDrawer`) | **잠그지 않는다** | 목록을 보면서 패널을 함께 보는 것이 이 패널의 용도다. 잠그면 "옆 목록에서 다음 것을 찾는" 동선이 끊긴다 |
| **가운데 모달** (`UI/Modal`·`StandardModal`) | 잠근다 | 전면을 덮는 창은 뒤가 움직이면 안 된다. 2026-09-13 에 고친 접근성을 되돌리지 않는다 |

- **막는 것이 두 겹이라 하나만 풀면 여전히 안 움직인다.** ①`useBodyScrollLock`(문서 잠금) ②**백드롭이 덮고 있다** —
  휠은 백드롭의 스크롤 조상(= body)을 찾으므로 실제 목록(`overflow:auto` 인 안쪽 div)은 한 픽셀도 안 움직인다.
  그래서 `DetailDrawer` 가 백드롭이 받은 휠·터치를 **밑의 스크롤 컨테이너로 넘긴다**(`usePassThroughScroll`).
  `elementsFromPoint` 로 자기 자신과 `[data-pq-drawer-panel]` 을 건너뛰고 첫 스크롤 컨테이너를 굴린다.
- **React 의 `onWheel`/`onTouchMove` 는 passive 라 `preventDefault` 가 통하지 않는다** — 그대로 두면
  우리가 굴린 만큼 문서도 같이 굴러 **두 번 움직인다.** 직접 `addEventListener(…, { passive: false })` 로 붙인다.
- 백드롭의 **클릭(=닫기)은 그대로**다. 포털로 뜨는 팝오버·모달은 백드롭보다 위에 그려져 자기 클릭을 직접 받는다.
- 검증은 "패널 연 상태에서 뒤 목록 `scrollTop` 이 실제로 변하는가"(음성 대조군 = 닫힌 상태) · 폰·태블릿·데스크탑 3폭.

**키보드 단축키 표준:** 우측 패널 토글은 `⌘/` (mac) · `Ctrl+\` (win). Q Task · Q Talk 에 구현됨.

### 뒤로 가기 = 패널 닫기 (2026-09-29 박제 — 운영 #437)
> Irene: *"확인필요에서 업무 누르면 닫지도 못하고 뒤로도 못가고 … 다른 우측패널도 다 동일해야 할 듯 해. 헬프도."*

- **폰(미러 모드)** — `hooks/useBackToClose(open, onClose)` 가 패널이 열릴 때 같은 주소로 히스토리 한 칸을 쌓고,
  뒤로 가면 닫고, X 로 닫으면 칸을 스스로 걷는다. `DetailDrawer`·`TaskDetailDrawer`·`CueHelpDrawer`·`usePanelStack`·
  Q Talk/Q mail 작업대 오버레이에 붙어 있다. **새 오버레이 패널도 이 훅 한 줄**을 붙인다.
- **탭 모드(폭 550↑ — 태블릿·데스크탑)** — 훅은 비킨다. 히스토리 주인은 `components/Tab/UrlMirror` **하나**다:
  탭 안 이동은 push, 단 replace 가 **바로 전 칸 주소로 돌아가는 것**(= 닫기)이면 `history.back()`(칸 번호 `pqIdx`·`trail`).
  `TabAppShell` 은 같은 주소를 다시 쓸 때 `pqIdx` 를 보존한다 — 통째로 덮으면 X 로 닫은 업무가 뒤로 가기에 다시 열린다.
- ★ 둘이 같이 쌓으면 엇갈린다 — 탭 안 효과는 브라우저 타이머보다도 늦게 돌아 훅이 창 주소를 믿을 수 없다(실측).
- 회귀: `--suite mobilepanels`(3폭 ①·①b).

> ★ **"프리미티브는 이미 내장" 을 믿지 말 것 (2026-09-13).** 가운데 모달의 공용 껍데기
> `components/UI/Modal.tsx` 에는 **세 훅이 하나도 없었고 `role="dialog"`·`aria-modal` 도 없었다.**
> `ConfirmDialog` 를 비롯해 **15곳**이 그 상태였다 — Esc 로 닫히지 않고, 열린 동안 배경이 스크롤되고,
> Tab 이 뒤 화면으로 샜다. 그리고 §17 의 `[aria-modal="true"]` 스코핑이 불가능해
> **검사 하니스가 "확인창이 떴는가" 를 아예 못 쟀다**(그래서 이 결함이 오래 안 보였다).
> — 훅은 **early return 위**에 둔다. `if (!isOpen) return null` 아래에 두면 닫힐 때 훅 수가 달라져
>   React 가 깨진다. `open` 인자로 끄고 켠다.
> — 공용 껍데기를 고치면 쓰는 곳 전부가 같이 고쳐진다. 화면마다 붙이지 말고 **껍데기를 고친다.**

## UI 규칙 — 떠 있는 패널의 **상단 기준선** (2026-09-06 박제)

**"위에서 얼마" 를 각 컴포넌트가 정하지 않는다.** 기준선은 토큰 하나다.

| 토큰/조각 | 뜻 | 쓰는 곳 |
|---|---|---|
| `--pq-chrome-bottom` | **상단 크롬이 끝나는 y** (탭 모드=탭바 아래 / 좁은 폭 미러 모드=모바일 헤더 아래 / 그 외 0) | 크롬과 **함께** 보여야 하는 곁패널 |
| `belowChrome` (`theme/layout.ts`) | 위 토큰을 쓰는 css 조각 | 〃 |
| `belowTabs` (`theme/layout.ts`) | 탭바 아래(`--chrome-top`). 미러 모드에선 0 | 전면으로 덮는 상세 드로어 |

- ★ **상세 패널은 모든 폭에서 상단 크롬 바로 아래에 선다 — 폰도 PlanQ 앱 머리줄을 남긴다** (2026-10-17, Irene: *"상세에서도 플랜큐 헤더 그대로 나오고 서브 타이틀 아래로 내려가야지. 모바일에서."*).
  10-05 «폰은 앱 헤더를 덮는 전면» 을 되돌렸다(아이폰은 -webkit-overflow-scrolling 탓에 그동안 덮지 못하다가 10-17 배포로 처음 덮여 «헤더가 없어졌다» 로 신고됐다).
  우측 상세·곁패널(DetailDrawer·업무 상세·문서 기록·작업대 오버레이·Q talk 우측·도움말)은 `--pq-panel-top`(`theme/layout.panelTop`) 한 토큰 — 지금 값 = `--pq-chrome-bottom`. 기준을 또 바꾸면 index.css 그 한 줄만.
  회귀 `--suite mobilechrome`(드로어 상단 = 크롬 하단 · 폰에서 앱 머리줄이 보이는가 elementFromPoint).
- **모드 분기는 CSS 가 한다** (`html.pq-tabmode` + `@media (max-width:1024px)`).
  JS 상수를 인라인 `style` 로 넘기면 미디어쿼리가 못 덮는다 — 2026-09-06 하루에 두 번 겪었다
  (탭바 `leftOffset` 이 사이드바 폭만큼 밀렸고, `--chrome-top` 이 40 고정이라 상태바 24px 만큼 어긋났다).
- **우측 상세/편집은 `components/Common/DetailDrawer` 를 쓴다.** 18개 화면이 이미 쓰고 있어
  기준선 수정 한 번이 전부에 먹는다. 직접 그리면 갈라진다 — 실측으로 오버레이 101개 중
  우측 패널 **8곳**이 `top:0` / `56px` / `--pq-mobile-chrome` / `16px` 로 제각각이었다.
- **위로 뜨는 창(가운데 모달·시트·어두운 막·전체 화면 창)도 폰에서는 앱 머리줄을 가리지 않는다** (2026-10-18, Irene: *"최상위 헤더를 팝업들도 모바일에서 열릴 땐 가리면 안돼. 같은 정렬이고 레이아웃이어야지."*) —
  `inset:0`/`top:0` 대신 `inset: var(--pq-popup-top, 0px) 0 0`(조각 `theme/layout.popupTop`). 값은 index.css 한 곳: 미러 모드(앱 머리줄이 있는 화면, `html.pq-main-shell`) = `--pq-chrome-bottom`, 탭 모드·팝아웃·공개 화면 = 0(탭 모드 데스크탑은 종전처럼 전면).
  창 머리의 상태바 여백은 `--pq-popup-safe-pad`(머리줄 아래면 0). 열린 햄버거 메뉴는 창들보다 위(10060). `belowTabs` 도 같은 날 `--pq-panel-top` 으로 맞췄다(폰에서 Q task 우측 패널이 머리줄 뒤로 깔렸다).
  가드 `--category=popuptop`(z>99 + 화면 맨 위 고정 = 실패, 이유 붙은 허용 목록만 예외 — 투명 바깥클릭 막·이미지 보기·공개 화면·약관 재동의). 팝오버/드롭다운은 앵커가 다르다.
- 재발은 가드가 막는다: `node scripts/guard-invariants.js --category=overlaytop`
  (`position:fixed` + `right:0` 인 styled 의 `top` 이 토큰이 아니면 실패).
- 실브라우저 회귀: `node scripts/e2e/run.js --suite tabletchrome` (9 뷰포트 + **네이티브 상태바 모사**).
  ★ 브라우저는 `--pq-safe-top` 이 0 이라 이 계열 버그가 **재현되지 않는다** — 모사 패스 없이 재면 초록이 거짓말한다.

> Irene 2026-09-06: *"이거 기준점 자체를 헤더 끝나는 위치에 맞추면 어떤 디바이스든 어떤 사이즈든
> 잘 맞지 않을까?"* — 맞다. 그리고 *"다른 우측패널들도 다 체크해야 해? 컴포넌트 기본은 없어?"* —
> **하나씩 확인하는 것은 답이 아니다.** 계약 하나 + 가드.

### 앱 페이지의 **높이**도 같은 계약이다 — `100vh` 를 쓰지 않는다 (2026-09-15 박제)

> Irene: *"문서 메뉴에서 상단이 스크롤 따라 자꾸 들어가. 서브헤더는 고정이어야 하잖아."*
> 이어서 *"다른 모든 곳도 체크해."*

앱 페이지는 **이미 올바른 높이로 잡힌 탭 스크롤 슬롯**(`MainLayout` 의 `PageScroll`) 안에 들어간다.
거기서 `height: 100vh` 를 쓰면 크롬(탭바·모바일 헤더·상태바)을 모르는 채 뷰포트 전체를 주장해
**슬롯을 크롬 높이만큼 넘는다.** 넘친 만큼 **바깥이 스크롤**하고, 그러면 그 페이지의
**좌측 머리줄과 우측 밴드가 통째로 위로 올라간다** — 패널이 자기 안에서 스크롤하지 못한다.

- **정본은 `components/Layout/PanelLayout.tsx` 의 `panelShellHeight`** (`height:100%; min-height:0`).
  값을 다시 적지 말고 **그 토큰을 쓴다.** Q Talk·Q mail·Q Task·Q Note 가 이미 쓰고 있었고
  **Q docs 만 이탈**해 있었다(2026-09-15 실측: 슬롯 770 ← 내용 900 · 986 ← 1112 · 682 ← 788).
- **크롬 높이를 페이지가 빼지 않는다.** `calc(100vh - 56px)` 는 **이중 차감**이다 —
  미러 모드에서 `MainLayout` 이 이미 `padding-top: var(--pq-mobile-chrome, 56px)` 를 준다
  (그 토큰 주석에도 *"-56px 불필요"* 라고 적혀 있다). 기기마다 거짓이 되는 숫자다.
- **예외는 팝아웃 창뿐** — `QTaskStandalonePage`·`QTalkStandalonePage` 는 상단 크롬이 없다.
- ★ **`--suite sticky` 는 이 계열을 구조적으로 못 잡는다.** 그 검사기는 computed `position:sticky`
  인 요소만 훑는데, 좌측 머리줄은 sticky 가 아니고 우측 밴드는 데스크탑에서 `static` 이라
  **훑을 대상이 0건**이었다 — 아무 말 없이 초록이었다. 선언이 아니라 **결과(y)** 를 재야 한다.
- 회귀: `node scripts/e2e/run.js --suite docsheader` (Q docs 3폭 · 양성 대조군 2) ·
  **`--suite headerdrift`** (전 앱 라우트 × 3폭 머리줄 드리프트).
- **머리줄은 휴리스틱으로 찾지 않는다** — 확정 손잡이 `page-header`(PageShell) ·
  `panel-header`(PanelHeader 및 이를 상속해 쓰는 곳). 휴리스틱으로 찾았더니 **알림 권한 배너**를
  머리줄로 집었다(2026-09-15). 손잡이가 없는 화면은 **미측정으로 보고**한다 — 통과로 세지 않는다.

---

## UI 규칙 — 반응형 상세 드로어 (신규 코드 필수)

우측 상세/편집 드로어는 **공통 프리미티브 `components/Common/DetailDrawer.tsx`** 를 사용한다. 기존 커스텀 드로어도 아래 반응형 CSS 를 반드시 적용.

- **≥1025px:** **480px 고정** — 폭은 `DetailDrawer` 하나가 정한다. `width` prop 은 **없다**
- **641~1024px:** `width: min(560px, 90vw)`
- **≤640px:** `width: 100vw` 풀스크린, border-left·box-shadow 제거, `padding-bottom: env(safe-area-inset-bottom)`

**폰(≤640)에서는 버튼 줄(취소·저장)을 화면에 고정하지 않는다** (2026-10-22, Irene: *"일정 추가할 때 모바일에서 푸터가 이상하게 높게 나오고 아래 뚫려서 뒤 내용 … 모바일에서는 모든 고정푸터 다 고정 안해야 하는 거 아니야?"*) —
껍데기(DetailDrawer Panel · StandardModal 전면 Dialog · 전면 자체 모달)가 **본문+버튼 줄을 한 상자로** 굴리고, 머리(뒤로·제목·닫기)만 위에 붙는다. 버튼 줄은 내용 끝(짧으면 바닥).
키보드가 뜰 때 고정 줄이 키보드 위 — 화면 가운데 — 에 떠서 입력·날짜 고르기를 덮던 것이다. 껍데기 아래 틈(보이는 높이 < 화면)은 흰색으로 잇는다(그림자).
자체 모달은 `components/Common/modalShell.phoneSheetFlow(Header, Body)` 한 줄(폰 media 안, 함수로 감싸서). `DrawerFooter` 는 폰에서 `position: static`. 태블릿·데스크탑은 종전대로 바닥 고정.
터치 기기에서는 열자마자 입력칸에 커서를 넣지 않는다(일정 추가 — 키보드가 바로 올라와 폼 절반을 덮는다, `enterSends()` 로 가른다).

공통 규칙:
- **배경 스크롤은 잠그지 않는다** (2026-09-13) — 우측 곁패널은 목록과 **함께** 보는 것이 용도다.
  `useBodyScrollLock` 은 가운데 모달의 것이다. 위 "배경 스크롤" 절 참조
- **폭을 호출부가 정하지 않는다** (2026-09-13) — Irene: *"솔루션 우측패널들 가로 사이즈가 왜 달라?
  다 똑같이 통일해야 하는 거 아니야?"* 실측 **19곳이 420·440·460·480·520·560 여섯 가지**였다.
  ★ `theme/panelWidth.ts` 의 `OVERLAY_DRAWER.default` 주석에는 이미 "구 460/480/520/560 난립 →
  480 수렴" 이라고 적혀 있었다 — **토큰은 있었는데 아무도 안 썼다**(공용 컴포넌트가 있다 ≠ 강제된다).
  그래서 `width` prop 자체를 없앴다. 다른 폭이 정말 필요하면 **프리미티브에 변형을 정의**하고 이유를 적는다.
  재발은 가드가 막는다: `node scripts/guard-invariants.js --category=drawerwidth`
- Esc 닫기 + 백드롭 클릭 닫기 + 재클릭 토글 기본
- 폰에서 리사이즈 핸들 `@media (max-width: 1024px) { display: none; }`
- 터치 타겟 폰에서 최소 40×40

```tsx
import DetailDrawer from 'components/Common/DetailDrawer';
<DetailDrawer open={!!selected} onClose={close} width={440} ariaLabel="일정 상세">
  <DetailDrawer.Header onClose={close}>...</DetailDrawer.Header>
  <DetailDrawer.Body>...</DetailDrawer.Body>
  <DetailDrawer.Footer>...</DetailDrawer.Footer>
</DetailDrawer>
```

적용처: EventDrawer(신규) · TaskDetailDrawer · ClientsPage Drawer. 이후 신규 상세/편집 드로어는 반드시 DetailDrawer 사용.

17. **검사 하니스 자동화 요건 (사이클 N+? 박제, 2026-07-09)** — 운영 피드백 42건이 기존 검증 다 통과했는데 유출(특히 모바일 키보드 가림) → `scripts/e2e/` Puppeteer 하니스(health-check 동급 게이트, `node scripts/e2e/run.js --suite mobile,crosscut,l1`)로 자동 검출. 신규 코드는 처음부터 아래 준수:
    - **인터랙티브 요소에 `data-testid` 부여 필수** — 모달/드로어 오프너·FAB·폼 제출 버튼. 네이밍 `{화면}-{동작}`(예: `bill-new-invoice`, `dock-create-task`, `clients-invite-open`). selector 취약성(텍스트/위치 휴리스틱) 제거 → 하니스 opener 안정.
    - **모달/드로어 루트에 `aria-modal="true"`** — 하니스가 `[aria-modal="true"]` 로만 모달 스코핑(배경 입력 노이즈 차단). 비모달 배너에 `role="dialog"` 금지(→ `complementary`) — 스코핑 오염.
    - **모바일 키보드 가림 회귀 방지** — 키보드 업 시 인플로우 배너(push/install prompt 등)가 세로공간을 잠식하면 `overflow:hidden` 고정크롬(패널 하단 입력줄)이 뷰포트 밖으로 침몰, `ensureFocusedVisible` 이 구제 불가. `body[data-keyboard-up='1']` 계약으로 `@media(max-width:768px)` 게이트하에 억제. (max-width:768px 게이트 필수 — flag 는 세로축소만으로도 켜져 데스크탑 회귀).
    - **하니스 시뮬 함정 2가지** — ①CDP `setDeviceMetricsOverride` 에 `screenOrientation` 넣지 말 것 ②판정 후 `clearDeviceMetricsOverride` 쓰지 말 것(puppeteer viewport 까지 제거 → 데스크탑 환경 오탐). 상세·오탐 사례: `docs/qa/FEEDBACK_REGRESSIONS.md`, 설계 `docs/qa/INSPECTION_PLAYBOOK.md`.

---

