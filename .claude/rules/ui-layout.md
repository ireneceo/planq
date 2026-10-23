---
paths:
  - "dev-frontend/src/**"
  - "dev-frontend/UI_DESIGN_GUIDE.md"
  - "scripts/e2e/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 화면 레이아웃 — PageShell·패널 헤더·두 밴드·반응형·모바일 입력·메뉴

## 페이지 레이아웃 표준 (필수)

모든 페이지는 아래 **2가지 레이아웃 중 하나**를 사용한다. 공통 컴포넌트 안에 표준 스타일이 잠겨있으므로 **신규 페이지는 반드시 이 둘 중 하나로 구현**한다.

### 1) 단일 컬럼 페이지 — `PageShell`

설정·프로필·목록(고객/업무/문서 등) 페이지에 사용.

```tsx
import PageShell from 'components/Layout/PageShell';

<PageShell
  title={t('page.title')}
  count={items.length}                 // 선택 — 제목 옆 카운트 배지
  actions={<><SearchInput/><InviteBtn/></>}  // 선택 — 헤더 우측
>
  {/* 본문 */}
</PageShell>
```

표준값(건드리지 말 것):
- 헤더 `min-height: 60px`, `padding: 14px 20px`, `background: #fff`, `border-bottom: #e2e8f0`
- 제목 `18px / 700 / -0.2px`
- 배경 `#f8fafc`, Body padding 20px

### 2) 멀티 컬럼(패널) 페이지 — `PanelHeader`

Q Talk / Q Note / Q Task 같은 3컬럼 레이아웃에서 각 패널 상단에 사용. **모든 패널의 헤더 `min-height: 60px`** 로 좌우 border-bottom 이 수평 연결된다.

```tsx
import PanelHeader, { PanelTitle, PanelSubTitle, PanelMetaTitle } from 'components/Layout/PanelHeader';

<PanelHeader><PanelTitle>Q talk</PanelTitle></PanelHeader>       // 앱 타이틀 (18px)
<PanelHeader><PanelSubTitle>{chat.name}</PanelSubTitle></PanelHeader>  // 선택된 항목명 (16px)
<PanelHeader><PanelMetaTitle>프로젝트 작업대</PanelMetaTitle></PanelHeader>  // 보조 섹션 (13px)
```

### 3) 상세 화면은 **두 밴드**로 끝낸다 (2026-09-06 박제 — 전 화면 공통)

상세(detail) 화면의 제목 위쪽 크롬은 **항상 밴드 2개**다. 셋째 밴드를 만들지 않는다.

| 밴드 | 컴포넌트 | 왼쪽 | 오른쪽 |
|---|---|---|---|
| 1 · 60px | `PanelHeader` (`PanelHeaderBar`) | 제목 (**자르지 않는다**) | **⋯ 하나만** (`OverflowMenu`) |
| 2 · 57px | `DetailMetaBar` + `DetailMetaLeft`/`Right` | 메타·상태 칩 (작성자·날짜·분류·담당·라벨) | 자주 쓰는 액션 **3개 이내** |

```tsx
import PanelHeader, { PanelSubTitle, DetailMetaBar, DetailMetaLeft, DetailMetaRight }
  from 'components/Layout/PanelHeader';

<PanelHeader onBack={...}>
  <TitleSlot><PanelSubTitle>{title}</PanelSubTitle></TitleSlot>
  <ActionSlot><OverflowMenu label={t('actions.more')} items={menuItems} /></ActionSlot>
</PanelHeader>
<DetailMetaBar>
  <DetailMetaLeft>{/* 칩·메타 */}</DetailMetaLeft>
  <DetailMetaRight>{/* 액션 3개 이내 */}</DetailMetaRight>
</DetailMetaBar>
```

**규격은 절대 각자 쓰지 않는다.** 밴드1 은 `PanelHeaderBar`, 밴드2 는 `DetailMetaBar` 를
**상속**한다(`styled(PanelHeaderBar)`). 손으로 다시 쓰면 반드시 갈라진다 — 2026-09-06 실측:

| 화면 | 무엇이 갈라져 있었나 |
|---|---|
| Q Note 음성 세션 (`MainHeader`) | 표준을 **베낀 복사본**. 2026-08-25(폰 `column` 폐기)·08-30(높이 하한) 두 수리를 못 받아 폰에서 밑줄이 어긋났다. 접기 손잡이가 셋째 자식이라 `:last-child` 계약을 가로채 **액션 칸이 `flex-shrink` 를 잃고 있었다** |
| Q Note 메모 (`MemoView`) | 제목·저장상태·분류/태그를 헤더 **안에 세로 3줄**로 쌓아 60px 계약을 넘겼다 |
| Q Note 리스트 (`SidebarHeader`) | `min-height:60px` + 안쪽 32px 버튼 → **61px**. 우측 상세는 `height:60px` → 60px. 좌우 회색 선이 **1px** 어긋났다 |

> Irene 2026-09-06: *"노트는 틀어지네. 모든 상세 헤더영역 다 검토해줘."*

**예외(Irene 지시 2026-10-23)**: Q mail 상세 밴드1 은 ⋯ 앞에 **첨부 메뉴(클립)** 를 둔다(`pages/QMail/MailAttachmentsMenu` — 첨부 0개면 안 보임, 액션 칸 안).

**밴드1 안에는 자식을 정확히 둘(제목 칸 / 액션 칸)만 둔다.** 셋째를 넣으면 `:last-child`
계약이 그쪽으로 옮겨가 액션 칸이 줄어든다 — `position:absolute` 인 장식이라도 선택자에는
걸린다. 그런 것은 밴드 **밖**(감싸는 `position:relative` 요소)에 둔다.

**밴드2 좌측은 `flex-wrap` 하지 않는다** — 라벨이 늘 때마다 밴드가 두 줄, 세 줄이 되면
"2밴드" 계약이 데이터에 따라 조용히 깨진다. 넘치면 가로로 흘린다(`overflow-x`).

**값이 붙은 메타(담당자·라벨)는 `components/Common/ChipPopover.tsx`** — 값은 칩으로 보이고
고치는 컨트롤은 누를 때만 꺼낸다. 셀렉트를 툴바에 그대로 세우면 150px 를 상시 먹는다.

> ⚠️ **팝오버 안에 `PlanQSelect` 를 넣지 말 것.** 그 컴포넌트는 메뉴를 `document.body` 로
> **포털**한다(`PlanQSelect.tsx:309`). 팝오버의 바깥클릭 판정에는 포털된 옵션이 "바깥" 이라
> **선택되기 전에 닫힌다** — 눌러도 아무 일이 없는 컨트롤이 된다
> (memory `feedback_ui_control_sends_nothing`). 목록 버튼으로 직접 그린다.

**보기·편집 두 모드를 같이** 바꾼다 — 한쪽만 밴드 수가 다르면 모드를 오갈 때 가로 실선이 튄다.
폰(≤640px)에서는 액션 묶음이 메타 아래로 감기게 둔다.

**두 밴드는 함께 붙인다 — 한 묶음으로 감싸고, 밴드2 에 `top` 숫자를 주지 않는다** (2026-09-13 박제).
> Irene: *"헤더가 q docs에서 위로 자꾸 올라가. 서브헤더까지 고정이 되어야지."*

좁은 폭(≤900px)에서는 패널이 아니라 **바깥 컨테이너가 스크롤**하는 화면이 있다. 그러면 제목 밴드는
물론 메타 밴드까지 올라가 **지금 이 자료로 무엇을 할 수 있는지**(분류·공유·주요 액션)가 사라진다.

- **밴드1+밴드2 를 한 요소로 감싸 그 묶음에만 `position: sticky`** 를 준다(`PostsPage.tsx` `StickyBands`).
  밴드2 에 `top: 60px` 같은 숫자를 주는 방식은 **폰에서 거짓이 된다** — `PanelHeaderBar` 는 ≤640px 에서
  `height: auto`(하한 56px)라 제목이 길면 밴드1 이 자라고, 그 순간 밴드2 가 겹친다. 묶음으로 감싸면
  높이 계산이 **아예 없다.**
- **보기·편집 두 모드 모두** 감싼다. 편집 밴드2(`MetaRow`)는 wrap 을 허용하므로 폰에서 두 줄이 될 수 있다 —
  그래서 더욱 숫자를 쓰면 안 된다.
- 검사 대상에 `data-testid` 를 준다(§17). 휴리스틱 selector 로 밴드를 찾으면 좌측 리스트 행을 집는다.
- ★ **짧은 문서로 재면 거짓 결과가 난다** — 본문이 짧으면 패널이 스크롤되지 않고 바깥 셸이 스크롤해
  밴드가 같이 올라간다. 2026-09-13 에 이 때문에 "고쳤는데도 안 된다" 로 한 바퀴 돌았다.
  **긴 문서 픽스처**로 재고, `position:static` 양성 대조군으로 판정이 뒤집히는지 확인한다.

**아이콘 전용 버튼을 늘리는 것은 자리를 먹으면서 뜻은 안 알려주는 최악의 조합**이다.
메뉴로 접으면 자리를 돌려주고 글자 라벨이 붙어 오히려 읽힌다.

#### 실측 (1440px, 2026-09-06)

| 화면 | 본문 시작 y (전 → 후) | 밴드1 밑줄 좌/우 |
|---|---|---|
| Q Mail 상세 | **197 → 117** (액션·라벨이 3줄로 감겼다) | 190 / 190 ✅ |
| Q docs 상세 (보기) | 157 → **117** (메타줄이 본문 안에 있어 스크롤과 함께 사라지던 것도 밴드로) | 190 / 190 ✅ |
| Q docs 상세 (편집) | → **117** (보기와 같은 y) | 190 / 190 ✅ |
| Q Note 메모 상세 | 헤더 3줄 → **2밴드** | 190 / 190 ✅ (전 191/190) |

적용처: `pages/QMail/MailPage.tsx` · `components/Docs/PostsPage.tsx` ·
`pages/QNote/{QNotePage,MemoView}.tsx`. 신규 상세 화면도 이 구조를 쓴다.

> **좌측 리스트도 같이 맞춘다 (2026-09-06 해소).** Q Mail 폴더 탭 줄이 43px 이라 밴드2(57)와
> 14px 어긋나 있었다 → `FolderTabs` 에 `@media (min-width: 1025px) { min-height: 57px }`.
> Q Note 좌측 검색줄도 61 → 57(`padding-bottom` 12→8). 실측 **좌 247 / 우 247** 일치.
> ★ **폰·태블릿에는 주지 않는다** — 패널이 하나씩만 보여 이을 상대가 없고, 메일은 그 자리를
> 키우면 2026-09-03 에 고친 "상단이 화면의 48%"(#406) 가 그대로 돌아온다.

### 금지
- 페이지 루트에 직접 `<Page>`/`<Header>` styled 컴포넌트 선언 금지
- 헤더 높이·padding·제목 폰트 커스터마이즈 금지 (일관성)
- 헤더 **안에** 여러 줄(제목+부제) 쌓기 금지 — 부제/메타는 제목 옆 인라인으로 배치.
  액션이 많아 줄이 필요하면 위 3) 처럼 헤더 **밖(아래)** 으로 내린다
- 상세 헤더에 아이콘 전용 버튼 4개 이상 나열 금지 → OverflowMenu

---

## 반응형 기본 원칙 (신규 코드 작성 시)

본격 반응형 스프린트는 기능 완성 후 진행 예정이지만, **신규 컴포넌트는 아래 3원칙을 지켜 작성**해야 나중 리팩토링 비용이 줄어든다.

1. **고정 px 폭 지양** — `width: 420px` 대신 `max-width`, `flex`, `minmax()` 사용. 불가피하게 고정이 필요하면 `dev-frontend/src/theme/breakpoints.ts` 의 미디어쿼리 토큰으로 모바일 축소 규칙을 같이 작성.
2. **아이콘 버튼 최소 36×36** — 하단 44까지 확장 가능하도록 여백 확보. 현재 타겟은 36, Phase 5 에서 44 로 일괄 상향.
3. **인라인 `style={{ width: '...' }}` 금지** — styled-components 또는 props 로 관리. 미디어쿼리가 끼어들 틈을 남겨둘 것.

토큰:
```ts
import { mediaPhone, mediaTablet, BP } from 'theme/breakpoints';
// phone: <=640 / tablet: <=1024 / desktop: >=1025
```

## 모바일 입력은 **누르기 전·중·후**를 잰다 (2026-09-30 박제)

> Irene: *"입력란 누르면 전후 확인하면서 입력하는데 문제 없게 … 모바일 기능으로 확장되어서 레이아웃 안돌아가는 말도 안되는 현상이 다른 곳에 없는지."*

- **«보이는 아래 끝» 은 키보드만이 아니다** — `main.tsx ensureFocusedVisible` 은 키보드 위 · 스크롤 상자 아래 경계 ·
  입력을 덮은 sticky/fixed 줄(모달 [취소][저장])의 위 끝 중 **가장 위**를 기준으로 스크롤한다. 화면(vvh) 안에 있어도
  하단 버튼 줄 뒤면 안 보이는 것이다(청구서 발행·업무 추가 실측).
- **입력 중에는 부가 카드·정보 밴드를 접는다** — `@media (max-width:768px) { body[data-keyboard-up='1'] & { display:none } }`.
  360px 채팅에서 «고객 링크 보내기» 카드가 남아 메시지 영역이 32px 이었다. 키보드를 내리면 돌아와야 한다(검사가 잰다).
- **눌렀다 떼기(blur)만으로 저장하지 않는다** — 칸에 처음 보여준 값(`input.defaultValue`)과 같으면 건너뛴다
  (`utils/hours.sameHours`). 안 그러면 반복 업무 «어디까지 반영» 창이 까닭 없이 뜨고 실제 시간 자동 누적이 멈춘다.
- **폰 밴드1 은 목록·상세 모두 56px** — 액션 칸·뒤로 버튼은 터치 44px 을 유지하되 줄 높이에는 34px 만 차지한다
  (`PanelHeaderBar` 폰 규칙). 제목이 두 줄이면 제목이 밴드를 키운다(정상).
- 회귀: `node scripts/e2e/run.js --suite mobilesweep` — 27화면 × 폰 390/360: 상단 헤더 통일 · 크롬 비율 ·
  입력 중(가림·헤더 밑·덮개·내용 영역 ≥96px) · 입력 후 복원(키보드 표식·헤더·높이·문서 스크롤) · blur 저장 0건.
  양성 대조군 2개(안 돌아간 키보드 표식 + blur 저장 심기 / sticky 머리줄 심기)가 먼저 뒤집혀야 판정을 믿는다.
- **구형 WebView 폴리필** — `public/legacy-polyfill.js`(classic script, 모듈보다 먼저). 번들 라이브러리가 쓰는 ES2022
  (`Object.hasOwn` 등)가 앱 안 브라우저(Chrome 90)에서 화면을 통째로 죽였다(운영 크래시 2026-09-18).

## 사이드바 «메뉴 편집» — 칸 안의 메뉴는 배열 항목이다 (2026-10-16)

> Irene: *"메뉴를 … 자기가 선택한 순서대로 커스텀하고 가려두고 전체보기 기능이 있게 … 원하면 사용하는 거야."*

- «기능»·«개인» 칸은 `components/Layout/EditableNavSection` 이 그린다 — MainLayout 은 메뉴 한 줄을 `{ key, label, count, active, node }` 로 넘긴다.
  **이 두 칸에 메뉴를 더하면 그 배열에 항목으로 넣는다**(key = navMenus 키 · count = 그 메뉴 배지 값 — 숨겼을 때 «더보기» 합계에 쓴다).
- 저장은 사람 × 워크스페이스 `business_members.nav_prefs`(검증 `services/navPrefs.js`, 계산 `config/navPrefs.ts`). 새 메뉴는 «보이는 끝» 에 붙는다.
- **숨김은 권한이 아니다** — `visibleNavMenus`(검색·탭 +)는 이 값을 모른다. 대시보드·확인 필요·관리·설정 칸은 편집하지 않는다.

## UI 규칙 — 리스트 재클릭 토글

**"선택된 항목을 다시 클릭하면 선택 해제"** — 리스트/드로어/탭 모두 공통.

- Q Talk 대화방, Q Note 세션, Q Task 업무 드로어, Q Project 업무 드로어, Q Task 리스트 행, 카드 — 모두 동일 패턴 적용
- 구현 원칙: 선택 핸들러 진입부에서 `active === clickedId` 검사 후 해제
- URL 싱크된 상세(drawer) 도 같이: `closeDetail()` 호출해 `?task=` 파라미터 제거
- 장기적으로 신규 리스트/상세 컴포넌트 추가 시 이 규칙을 먼저 적용

```ts
const handleSelect = (id) => {
  if (activeId === id) { setActiveId(null); return; } // 토글 해제
  setActiveId(id);
};
```

