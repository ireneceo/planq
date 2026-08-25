# PlanQ UI 레이아웃 정본 (2026-08-25)

> 왜 만들었나: "메뉴마다 레이아웃·버튼·글자가 다 다르다"(Irene). 실측해 보니 사실이었다.
> 좁은 화면에서 그 차이가 전부 드러나 **기능까지 달라 보인다**(어떤 화면은 뒤로가기가 되고
> 어떤 화면은 안 됨). 이 문서가 규격의 단일 원천이고, 코드 원천은 `dev-frontend/src/theme/tokens.ts` 다.

## 실측된 부채 (2026-08-25 기준, 가드가 동결)

| 항목 | 실제 |
|---|---|
| 페이지 헤더 구현 | `PageShell` 44곳 · `PanelHeader` 2곳 · **자체 제작 38개 선언** |
| 컨트롤 높이 | 토큰(36/40/44) 밖 하드코딩 **749곳** |
| 11px 이하 글자 | **1,069곳** |
| 폰 대응 없는 고정 최소폭 | 0곳 (전수 정리 완료) |

## 규격

### 컨트롤
`theme/tokens.CONTROL` — sm 36 / md 40 / lg 44. 폰 터치 타깃 최소 44.
버튼은 `components/Common/ActionButton` 을 쓴다(3톤 × 3사이즈). 새 styled 버튼을 만들지 않는다.

### 헤더
- 단일 컬럼 페이지 → `components/Layout/PageShell` (데스크탑 60 / 폰 56, **한 줄 유지**)
- 패널 화면 → `components/Layout/PanelHeader` (같은 높이 계약 — 좌우 밑줄이 수평으로 이어진다)
- 헤더는 한 줄이다. 좁아지면 **제목이 말줄임**되고 액션은 그대로 오른쪽에 남는다.

### 리스트 행
`components/Common/ListRow` — 제목 14/15px·600, 보조 12.5px, 구분선 `#F1F5F9`,
폰에서 최소 높이 44. 값은 `tokens.LIST_ROW` 에서만 바꾼다.

### 2·3단 레이아웃 (단일 계약)
`hooks/usePanelStack` 이 **무엇을 보여줄지** 정한다.

| 폭 | 동작 |
|---|---|
| ≥1280 | 목록 + 상세 + 보조 **3단 동시** |
| ≥1025 | 목록 + 상세 **2단** (보조는 접힘, 핸들로 토글) |
| ≤1024 | **드릴다운** — 한 번에 하나. 목록은 항상 **전체폭**. 상세·보조에는 **표준 뒤로가기** |

뒤로가기는 `PanelHeader onBack` 또는 `PanelBackButton` 으로만 만든다(자체 제작 금지).

### 표형 리스트
폰에서는 비필수 열을 `$hideBelow` 로 숨기고, 고정 최소폭(`min-width: 520px` 등)에는
반드시 `@media (max-width: 640px) { min-width: 0; }` 를 둔다. 안 그러면 375px 화면 밖으로 나간다.

### 배너
화면에 떠서 콘텐츠를 덮지 않는다. 폰에서는 **콘텐츠 흐름 안**에 둔다.
같은 성격의 배너를 둘 이상 동시에 띄우지 않는다(설치 안내 ↔ 알림 안내는 상호 배타).

## 가드
`node scripts/guard-invariants.js --category=uispec` — 위 4항목 래칫.
**기존 부채는 동결, 증가만 실패**한다. 부채를 줄였으면 전체 실행 후 `--update-baseline` 으로 조인다.

## 이관 상태
- [x] 표형 리스트 고정 최소폭 전수(Q Task 3 · 프로젝트 7)
- [x] 배너 중복 제거 + 흐름 안으로
- [x] 뒤로가기 표준(PanelHeader/PanelBackButton) — Q Note·Q Mail 적용
- [ ] 자체 헤더 38개 → PageShell/PanelHeader
- [ ] 버튼 749곳 → ActionButton
- [ ] 리스트 → ListRow
