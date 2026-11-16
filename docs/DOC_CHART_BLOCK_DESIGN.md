# 문서 차트 블록 설계 (Q docs) — 2026-11-16

> Irene: *"문서에 html로 작성하는 기능도 넣을까? 그래프들 못 넣어서 답답해.... 판단 좀 해줘."*
> 판단(방 6c4e928d): HTML 자유 입력은 넣지 않고 **데이터만 저장하는 차트 블록** → Irene «권고대로 진행해 줘» (2026-11-16).
> 정찰 근거: `.claude/plans/qmwirvqfg.md`. 상태: **Fable 설계 판정 DESIGN: FIX(2026-11-16) → 8건 반영(아래 8절) — 재판정 없이 구현 허용**.

## 1. 기능 정의
| 항목 | 내용 |
|---|---|
| 목적 | 문서 안에 막대·선·영역·원 그래프를 넣는다. 실행 코드 없이, 숫자·글자만 저장한다 |
| 사용자 | 문서를 쓰는 멤버 이상(편집 권한 = 기존 `canEditPost` 그대로). 보는 사람은 본문을 볼 수 있는 모든 사람(고객·게스트·공유 링크·서명자) |
| 유스케이스 | ① 편집기 도구줄 [차트] → 차트 창(종류·제목·데이터 표 입력, 엑셀 붙여넣기) → 삽입 ② 표 위 메뉴 [이 표로 차트] → 표 값으로 창이 채워진 채 열림 ③ 차트 클릭 → [차트 고치기] |
| 성공 기준 | 같은 차트가 편집기·보기·게스트/공유·PDF·서명본(고정본)·워드 내려받기 6곳에서 보인다(워드는 데이터 표로 대체). 스크립트 0, 새 공개 라우트 0, DB 변경 0 |
| 비범위 | AI 앱(ChatGPT·Claude)이 차트를 만드는 도구 문법(나중 — 1단계 표 변환 위에 붙일 수 있음) · 업무 칸(RichEditor) · Q note 메모 · 축 범위·색 직접 지정 · 쌓은 막대 · 두 번째 축 · 마우스 올리면 값 보이기 |

## 2. API — 없음
새 엔드포인트 없음. 차트는 `posts.content_json` 안의 노드다(저장·권한·공유·이력·복사·서명 고정본은 기존 경로 그대로 따라간다).
서버 변경은 렌더 3곳: `services/pdfTemplates.js nodeToHtml`(PDF·서명본·공유 서명 화면) · `services/docxService.js blockXml`(워드: 제목 + 데이터 표) · `routes/posts.js extractText`(검색·미리보기: 제목·항목·계열 이름).

## 3. DB — 변경 없음
노드 모양(TipTap JSON):
```json
{ "type": "pqChart", "attrs": { "chart": {
  "v": 1, "kind": "bar|line|area|pie", "title": "월별 매출",
  "labels": ["1월","2월","3월"],
  "series": [ { "name": "2026", "values": [120, 98.5, null] } ],
  "unit": "만원"
} } }
```
- 한도(정규화 함수가 깎는다 — 거절하지 않고 자른다): labels ≤ 50 · series ≤ 8 (pie 는 첫 계열만) · title ≤ 120자 · 이름/항목 ≤ 40자 · unit ≤ 12자 · 값은 유한수 또는 null(빈 칸).
- **정규화 `normalizeChart(raw)` 한 함수** — 모르는 kind → bar · 배열 아님 → 빈 배열 · 값 문자열 «1,234» → 1234 · 그 밖 → null. 편집기 저장·렌더 모두 이 함수를 지난 값만 쓴다.

## 4. 그림 = 하나의 함수 · 정적 SVG 를 그림 파일로
**`dev-backend/utils/chartSvg.js` 한 벌**(의존성 없는 순수 JS) — `normalizeChart` · `chartSvg(chart) → SVG 문자열` · `chartHtml(chart) → 넣을 HTML 조각` · `chartSummary(chart) → 대체 글`.
- 서버는 `require`, 화면은 `components/Docs/chartData.ts` 한 곳에서 `import chartApi from '…/dev-backend/utils/chartSvg.js'`(타입 `chartSvg.d.ts` 옆에). Vite 8 이 CJS 를 기본 내보내기로 푼다(빌드 산출물로 확인). 배포 사본은 저장소 전체라 빌드에서 보인다.
  두 벌을 만들지 않는 이유: PDF·서명본(서버)과 화면이 다른 그림을 그리면 «서명한 화면 ≠ PDF».
- 출력 HTML: `<div class="pq-chart" data-pq-chart="<JSON 이스케이프>"><img src="data:image/svg+xml;base64,…" alt="<요약>" style="width:100%"></div>`
  - **SVG 를 `<img>` 로만 싣는다** — 브라우저는 그림으로 연 SVG 안의 스크립트·외부 주소를 실행·로드하지 않는다. 정화기(`sanitizeHtml.ts`)는 이미 `img` · `data:image/` · `style width:%` 를 허용 → **허용 목록 변경 0**(svg 태그를 정화기에 넣지 않는다).
  - SVG 안 글자는 전부 XML 이스케이프 · 숫자는 서식 함수만 · 색은 고정 팔레트 8색(사용자 색 없음) · `viewBox="0 0 640 360"` 폭 100% 로 줄어든다(폰·PDF 같은 비율) · 글꼴 `font-family` 시스템 글꼴(외부 글꼴 로드 없음 — 그림 SVG 는 웹 글꼴을 못 씀).
  - `data-pq-chart` 는 편집기가 HTML → 노드로 되읽을 때만 쓴다(AI 재작성 base_html 왕복·붙여넣기). 정화기가 보기 화면에서 지워도 그림은 남는다.
  - `alt` = 제목 + «항목 N개 · 계열: …» — 화면 낭독기·이미지 꺼짐 대비.
- 그래프 규칙: 막대(묶음 막대, 0 기준선) · 선/영역(null 은 끊음) · 원(첫 계열, 음수·0 제외, 합 0 이면 «데이터 없음») · 축 눈금 «깔끔한 숫자»(1·2·5×10ⁿ) 5칸 · 음수 허용(막대·선) · 범례(계열 2개 이상 또는 원) · 항목 이름이 많으면 기울이지 않고 건너 표시(n>12 → 간격).

## 5. 화면(UI)
| 곳 | 무엇 |
|---|---|
| `components/Docs/ChartBlock.ts` (새) | TipTap Node `pqChart` — atom·block·draggable. `renderHTML` = `chartHtml` 조각(보기/게스트 generateHTML 이 같은 것을 낸다) · `parseHTML` = `div[data-pq-chart]` · NodeView(편집기): 같은 그림 + 선택되면 [차트 고치기] 버튼 |
| `components/Docs/ChartEditorModal.tsx` (새) | `StandardModal` — 종류(4 알약 `segmentedToggle`) · 제목 · 단위 · 데이터 표(첫 열 = 항목, 머리줄 = 계열 이름, 행·열 +/−) · [엑셀에서 붙여넣기] = 칸에 붙여넣으면 TSV 를 표로 펼침 · 아래 미리보기(같은 chartSvg) · [넣기]/[저장] |
| `PostEditor.tsx` | 확장 목록에 `ChartBlock` · 도구줄 넣기 묶음에 [차트] 버튼(`data-testid="doc-insert-chart"`) |
| `TableBubbleMenu.tsx` | [이 표로 차트] — 표 첫 행 = 계열 이름, 첫 열 = 항목, 나머지 칸 숫자 → 창을 채워 열기(표는 그대로 두고 표 아래에 차트 삽입) |
| `utils/postContentHtml.ts` | EXTENSIONS 에 `ChartBlock` (빠지면 보기·게스트에서 차트가 통째로 사라진다 — 서명란과 같은 계열) |
| i18n | `qdocs` ko/en `editor.chart.*` |
| 반응형 | 그림은 폭 100%(viewBox 비율 유지) · 창은 StandardModal 폰 전면 규칙 · 데이터 표는 창 안 가로 스크롤 |

## 6. 검증 계획
- 단위: `chartSvg` 사례 — 4종 × (정상 · 빈 데이터 · null 섞임 · 음수 · 큰 수 · 항목 50개 · 계열 9개(→8) · `<script>`·`"`·`&` 들어간 제목/이름(이스케이프 확인)) · 정규화 깎기.
- 같은 그림 증명: 같은 content_json → 화면 generateHTML 의 img src == 서버 pdfTemplates img src (문자열 일치).
- 실호출: dev 문서에 차트 노드 저장 → 재조회 일치 · 공유 링크(무로그인) · PDF(`pdftotext` 대체 글 아님 → 이미지 존재 + 한글 글꼴 렌더 스크린샷) · 서명 요청 고정본 · 워드 내려받기(표로 대체) · 복사(`duplicate`) 따라감.
- 화면 3폭(폰 375·태블릿 820·데스크탑 1440): 편집기 삽입·고치기·보기·게스트 · 표 → 차트.
- 가드: `npm run build` · `guard-invariants`(i18n·parity 등) · `--suite signature` 회귀.

## 7. Fable 에 묻는 것
1. 그림을 `<img src="data:image/svg+xml">` 로 싣는 것(정화기 변경 0) vs 인라인 `<svg>`(정화기 SVG 허용 확장) — 보안·PDF·서명 고정본 관점.
2. 한 파일(UMD, `dev-backend/utils/chartSvg.js`)을 화면 빌드가 가져오는 방식이 맞는가, 아니면 다른 공유 위치.
3. 서명 고정본: 차트 그리는 함수가 나중에 바뀌면 같은 고정본의 그림이 달라진다(데이터는 같음). 허용할지(표·글꼴과 같은 지위로 보고 허용 권고), `v` 로 묶을지.
4. 비범위·한도·검증 계획에 빠진 것.

## 8. Fable 설계 판정 반영 (DESIGN: FIX → 반영)
| # | 지적 | 반영 |
|---|---|---|
| 1 | AI 고쳐쓰기 base_html 에 base64 그림이 실려 24,000자 한도를 먹는다 | `postContentToHtml`(서버로 가는 HTML) = 그림 없는 `<div data-pq-chart>` 조각만(`stripChartImages`). 화면 넣기는 `postContentToSafeHtml`(그림 포함). AI 프롬프트에 «차트 조각은 그대로» 한 줄(`routes/docs.js`). 재생성 뒤 차트 수가 줄면 알림(`editor.chart.aiDropped`). 문서 템플릿 저장도 같은 조각 |
| 2 | 인코딩·숫자 서식이 화면/서버에서 갈라질 수 있다 | base64 = 파일 안 순수 JS UTF-8 인코더(`btoa`·`Buffer` 안 씀) · 숫자 = `toFixed` + 직접 천 단위(`Intl` 안 씀). 검사: 15 퍼즈 사례에서 Buffer 결과와 문자열 일치 |
| 3 | 공용 파일 안 사용자 글자 i18n | SVG·대체 글에 언어 낱말 없음(빈 데이터 «—», 원 나머지 «+N», 요약 = 제목·항목·계열 이름만). 창·버튼 글자는 `qdocs editor.chart.*` ko/en |
| 4 | 공용 파일 가져오기 조건 | `chartSvg.d.ts` + 기본 내보내기 import(globalThis 길 안 씀) · `npm run build` 산출물로 증명 · **배포**: 일반 배포는 늘 화면을 다시 빌드한다. `--skip-build`(서버만) 배포에 `chartSvg.js` 변경이 끼면 `scripts/deploy-planq.sh` 가 멈춘다 |
| 5 | 절대 throw 금지 | `normalizeChart`·`chartSvg` 안쪽 try/catch(실패 = 빈 그림) · 문자열은 먼저 자른다 · 서버 `nodeToHtml`·`blockXml` 호출부 try/catch(그 차트만 빈 자리) |
| 6 | 옛 화면(배포 전 번들) | **실측**: 옛 번들은 차트 문서를 보기·편집 모두 **빈 본문**으로 그린다. 그대로 저장하면 차트·본문이 지워진다 → 새 화면 `updatePost` 가 `editor_nodes:['pqChart']` 를 싣고, 서버 `PUT /api/posts/:id` 는 보호 노드가 든 문서에 그 표시 없이 본문을 쓰면 409 `editor_outdated`(새로고침 안내). 새 보호 노드는 `GUARDED_NODES`(서버)·`EDITOR_NODES`(화면) 둘 다 더한다 |
| 7 | 빠진 소비처 | `extractText`(검색)·`extractBlockText`(공유 본문·AI 읽기)에 `chartText`(제목·항목·값) · `survey_public` 50,000자 자르기 전에 넘치면 차트를 대체 글로 · 문서 AI 고쳐쓰기(`docAiEdit`)는 글 블록만 바꾸므로 차트 노드 보존(검증) · 에이전트 `get_document` 는 `content_text` 로 차트 값을 읽는다 |
| 8 | 서명 고정본 그림 안정성 | `v` = 데이터 모양 버전. **뜻이 바뀌는 그림 변경**(0 기준선·축 범위·원 제외 규칙·반올림)은 `v` 를 올리고 옛 `v` 분기를 남긴다. 모양만 바뀌는 변경(색·간격·글꼴)은 자유. 모르는 `v` 는 그리지 않고 대체 글만 |

비차단 반영: 9 SVG 글꼴 맨 앞 Noto CJK KR(개발 PDF 한글 확인 · 운영은 배포 뒤 PDF 1장) · 11 `width/height` 함께 · 12 선 그래프 계열별 점 모양(●■▲◆), 원 퍼센트 표시 · 13 원은 큰 순 7개 + 나머지 «+N» 한 조각, 대체 글 300자 · 14 복사는 content_json 통째(따라감), 붙여넣기 `data-pq-chart` 는 `parseHTML` 에서 `normalizeChart` 를 지난다.
안 한 것: 12 «값 표시» 토글(다음 단계 후보) · 15 «편집기 노드 ⊆ 서버 case» 가드(다음 단계 후보).
