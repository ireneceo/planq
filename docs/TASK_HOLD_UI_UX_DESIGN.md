# #206 보류·외부컨펌 UI/UX 확정 설계 — 표면 전수 조사 기반

- 작성: Fable UI/UX 설계 게이트 (2026-07-26)
- 전제: 백엔드·전이 규칙은 구현 완료(커밋 `e180352`, 기능설계 `docs/TASK_HOLD_EXTERNAL_REVIEW_DESIGN.md`). 이 문서는 **화면 표면 전수 조사 결과와 UI/UX 확정안**이며, Opus 는 §5 절단면만 구현한다.
- 조사 방법: 프론트 전 표면 실코드 열람 (추측 0). 파일:라인은 2026-07-26 실측.

---

## 0. 핵심 판정 요약

현재 구현은 **Q Task 3표면(리스트·칸반·드로어)만 대응**된 상태다. 상태가 보이는 표면은 실측 **19곳**이고, 그중 **7곳이 깨져 있거나(raw 코드 노출·오표기) 신규 상태를 아예 모른다.** 특히:

1. **공개 공유 페이지(PublicTaskPage)에 외부 고객에게 `on_hold` 영문 코드가 그대로 노출** — 외부 노출 결함, 최우선.
2. **워크스페이스 주간보고 blockers 가 보류를 "수정요청" 빨간 칩으로 오표기** — 2분기 else 함정.
3. **전역 검색 결과에 raw status 노출**, QTalk/QMail 우측 패널 dot 은 보류가 회색(=미진행과 동일).
4. **체크박스 완료 토글이 보류를 우회** — R1(진행률 자동완료)은 막았는데 체크박스 경로가 열려 있음.
5. **"업무가 사라졌다" 회귀** — 보류하면 주간 목록·주간 칸반에서 소실되는데 어디로 갔는지 알려주는 장치가 0.

---

## 1. 표면 전수 인벤토리 (현재 → 문제 → 확정 변경)

| # | 표면 | 파일 (dev-frontend/src/) | 현재 | 문제 | 확정 변경 |
|---|------|------|------|------|------|
| S1 | Q Task 리스트 행 | `pages/QTask/QTaskPage.tsx:1751-1765` | StatusPill(taskLabel 경유) 정상 표시 | 보류 사유가 어디에도 안 보임. 진행바 teal 유지 | StatusPill `title`=hold_reason. on_hold 시 진행바 fill `#94A3B8`. 상태 pill 에 아이콘 병행 (§2-1) |
| S2 | Q Task 칸반 | `QTaskPage.tsx:2154-2291` | 컬럼 추가됨. mine/week 는 external 만 | external 컬럼이 revision 뒤(파이프라인 어긋남). 보류 카드에 사유 없음 | 컬럼 순서: `in_progress` 바로 뒤 `external_review`. on_hold 카드에 사유 1줄(ellipsis). mine/week 에 on_hold 컬럼 **비추가 유지** — 대신 S6 힌트 |
| S3 | 상태 필터 | `QTaskPage.tsx:1530-1536` | STATUS_CODES 파생, isClearable(="전체") | 죽은 `done_feedback` 이 옵션에 노출 | 옵션 제외 목록 += `done_feedback`. "전체" 규칙은 isClearable+placeholder 로 이미 충족 |
| S4 | 상태 드롭다운 3곳 | `utils/taskLabel.ts:94-107` | on_hold 항상 포함 | completed/canceled 업무에도 보류 옵션 노출 → 백엔드 400 | statusOptionsFor: status 가 completed/canceled 면 on_hold 제외 (진입 매트릭스 미러) |
| S5 | 업무 상세 드로어 | `components/QTask/TaskDetailDrawer.tsx:1438-1489` | HoldBanner 가 메타 섹션들 **아래**(반복설정 뒤) | "왜 멈췄나"가 스크롤 아래. 사유 사후 수정 불가. 되돌리기와 경로 충돌 | 배너를 제목/Meta 직하로 이동. 배너 안 사유 인라인 편집(AutoSave). on_hold/external 중 RevertRow 숨김. §2-3/2-4 |
| S6 | 주간 탭 소실 안내 | `QTaskPage.tsx:1003, 1891, 2218` | 보류 시 목록·칸반에서 무통보 소실 | **"내 업무가 사라졌다" 회귀 위험 — 실측 장치 0** | ChipRow 에 보류 칩(내 담당 on_hold N>0 시) + 빈 목록 전용 EmptyState. 클릭 → 전체 탭+보류 필터. §2-7 |
| S7 | 프로젝트 업무 리스트 | `pages/QProject/ProjectTaskList.tsx:275,282,396-413` | 드롭다운 정상. 지연 뱃지 유지 | 진행바 teal 유지. status 변경 시 `focus:refresh` 미발송(위젯 30s stale) | sliderColor += on_hold `#94A3B8`. saveField status 시 `focus:refresh` dispatch. 지연 뱃지는 **유지가 설계**(보류≠마감연장) |
| S8 | 체크박스 완료 토글 3곳 | `QTaskPage.tsx:960-963` · `ProjectTaskList.tsx:322` · `pages/QTalk/QTalkPage.tsx:1367-1370` | on_hold 업무 체크 → completed/in_progress 직행 시도 | **보류 우회 구멍** (R1 계열 — 백엔드가 거절해도 UI 가 유도) | on_hold/external_review 시 체크박스 disabled + title "보류 해제 후 완료 처리" (i18n) |
| S9 | QTalk 대화 임베드 업무 카드 | `pages/QTalk/ChatPanel.tsx:1467-1490` | 제목+due 만. `TaskCardMeta.status` 수신만 하고 미렌더 | 보류 업무 카드가 살아있는 업무와 동일 | 카드에 상태 pill 추가(STATUS_COLOR + observer 라벨, 전 상태) |
| S10 | QTalk/QMail 우측 컨텍스트 업무 | `components/Workbench/ContextTaskList.tsx:48-56,142` | 자체 STATUS_TONE dot — 신규 2값 없음 | **회색 폴백 = not_started 와 동일** (2표면: QTalk RightPanel, QMail MailContextPanel) | STATUS_TONE += on_hold `#EA580C` / external_review `#0EA5E9` + dot title=상태 라벨 |
| S11 | 전역 검색 | `components/Common/GlobalSearchModal.tsx:89,175` | `sub: x.status` raw 출력 | **`on_hold` snake_case 노출** (기존 상태도 동일 결함) | `t('qtask:status.${s}.observer', s)` 로 라벨화 (전 상태 일괄 수리) |
| S12 | 알림 토스터 | `components/Common/NotificationToaster.tsx:394-446` | task:updated 분기 completed/reviewing/revision 3개뿐 | 보류/외부컨펌/해제 전이 시 실시간 토스트 무반응 (§13 계열) | 분기 3종 추가 + `common.json` toaster 키 (§4). DB 알림·push 는 백엔드 완료 상태 |
| S13 | 공개 공유 페이지 | `pages/Public/PublicTaskPage.tsx:42-56` | 자체 STATUS_TONE/LABEL 맵 — 신규 2값 없음 | **외부 고객에게 raw `on_hold` 노출** | 맵 2값 추가 + `common.json` `public.task.status.*` ko/en |
| S14 | 워크스페이스 주간보고 blockers | `components/QTask/WeeklyReviewWorkspaceView.tsx:192,361-363,514-518` + `services/weeklyReview.ts:200` | waiting 아니면 전부 "수정요청" 빨간 칩 | **보류가 "수정요청"으로 오표기** | blockerStatusLabel → `qtask:status.*.observer` 폴백 구조로 재작성, BlockerChip 색 맵 += on_hold(orange). `BlockerStatus` 타입 += 'on_hold' |
| S15 | 개인 주간보고 blockers | `components/QTask/WeeklyReviewView.tsx:251-260` | `{b.blocked_status}` raw 출력 | `on_hold` 코드 노출 | 상태 라벨 i18n 조회로 교체. 업무 테이블(L363-378)은 이미 정상 |
| S16 | 보고서 본문 | `components/QTask/report/ReportContent.tsx:25` | STATUS_COLOR dot — 정상 작동 | 없음 | **무변경** |
| S17 | Insights 업무 탭 | `pages/Insights/tabs/TasksTab.tsx` + `services/insights.ts:66-68` | funnel 타입만 있고 **렌더 코드 전무**. 상세 테이블에 status 컬럼 없음 | 절단면 #18 이 사실상 미구현(타입만) | 상세 테이블에 status 컬럼 추가(라벨+색, CSV 와 화면 일치). **funnel 시각화 신설은 별도 건으로 이관** — 죽은 필드 렌더는 #206 스코프 아님 |
| S18 | Focus 위젯/바 | `components/Focus/FocusWidget.tsx` · `TaskFocusBar.tsx:130` | 보류 전이 → 세션 stop → 위젯 idle 복귀. 바는 in_progress 외 미표시 | 설명 없는 소멸이지만 **세션 종료가 진실** — 드로어 배너가 사유 채널 | **무변경 확정.** 위젯에 hold 인지 결합은 과결합. `focus:refresh` 미발송 경로만 수리(S7) |
| S19 | 캘린더 / 대시보드 / TodoPage | `pages/QCalendar/*` · `pages/Dashboard/*` · `pages/Todo/*` | 캘린더: `_task_status` 소비 0, 마감일 그대로 표시. 대시보드/Todo: status 표면 자체 없음, 백엔드가 인박스에서 on_hold 제외(`routes/dashboard.js:112` 완료) | — | **무변경 확정.** 캘린더 잔류 = "보류는 마감 연장이 아니다" 정책과 일관(마감 사실은 유지). 대시보드 제외는 백엔드 검증 항목 |

---

## 2. 12 쟁점 확정 결론

### 2-1. 상태 뱃지 시각 언어 — 색 유지 + **아이콘 병행 확정**

- **색 판정**: `on_hold #FFEDD5/#9A3412` 는 COLOR_GUIDE 의 "오늘 마감"(#FFF7ED/#9A3412)·"높음 우선순위"와 같은 orange 계열이지만 **다른 뱃지 슬롯**(상태 pill vs 마감 chip)이라 충돌 아님. reviewing amber(#FEF3C7/#92400E)와는 색각 이상 사용자에게 근접 — **색만으로는 불합격.** `external_review #E0F2FE/#075985` 는 Info 100/800 재사용이라 가이드 정합.
- **확정**: 신규 2상태 뱃지에만 **10px SVG 아이콘 병행** — on_hold = Feather `pause`(세로 2바), external_review = Feather `arrow-up-right`(밖으로 나감). `components/Common/Icons.tsx` 에 `StatusGlyph({ code, size })` 신설 (code 가 2값 외면 null). "정상 파이프라인이 아닌 상태만 아이콘을 단다"는 규칙 자체가 시그널이 된다. 이모지 금지 준수.
- 적용처: 드로어 StatusBadge · 리스트 StatusPill(QTask/QProject) · 칸반 카드의 KanbanStatusText 앞. 칸반 **컬럼 헤더는 아이콘 없음**(제목+색으로 충분, 노이즈 방지).
- **COLOR_GUIDE.md §3 표에 2행 등록** (on_hold `#FFEDD5/#9A3412` 오렌지, external_review `#E0F2FE/#075985` 스카이) + 배너 보더 `#FDBA74`/`#7DD3FC` 명기. "정의된 색만 사용" 규칙 정합 회복.

### 2-2. 상태 조합 규칙

| 조합 | 확정 | 근거 |
|------|------|------|
| 보류 + 마감 지남 | **지연 뱃지 유지** (리스트 DelayBadge·칸반 KanbanDelayBadge·프로젝트 리스트 모두) | 보류는 마감 연장이 아니다(기능설계 §4). 연장은 명시적 due 변경으로 |
| 보류 + 진행률 | **fill 색만 `#94A3B8` 탈색, 값·편집 유지** | completed 와 같은 문법(ProjectTaskList sliderColor 선례). 정보 은폐 없이 "지금 안 굴러감"만 전달 |
| 외부컨펌 + 진행률 | teal 유지 | 활성 상태 — 담당 책임 잔류 |
| 외부컨펌 + 컨펌자 존재 | 컨펌자 섹션 그대로, R 라운드 뱃지는 reviewing/revision 전용 유지 | 외부컨펌은 라운드가 아님 |
| 뱃지 상한 | 한 행 최대 = 상태 pill 1 + 지연 뱃지 1 (+이름 chip 1). **사유는 뱃지화 금지** — pill title/카드 1줄/배너로만 | 뱃지 인플레 차단 |

### 2-3. 드로어 정보 위계

- **배너 위치 이동 확정**: 현재 반복설정 섹션 뒤(L1438) → **제목/Meta 블록 직하, description 섹션 앞.** "왜 멈췄나"는 첫 화면에서 보여야 한다 (CarriedBanner 와 같은 상단 정보 대역).
- **제목 옆 상태 뱃지와 중복 아님** — 뱃지 = 압축 상태(전 상태 공통 문법), 배너 = 사유 + 해제 액션. 역할 분리 유지.
- **[보류 해제]는 배너 안이 맞다** — 해제는 배너가 설명하는 상태의 유일한 출구. 액션 카드는 담당자/컨펌자 워크플로 전용으로 유지.
- **[보류]/[외부컨펌] 진입 버튼은 현 위치(워크플로 액션 대역) 유지** — 진입은 액션이므로 액션 존, 상태는 상단. 
- **되돌리기(RevertRow)**: on_hold/external_review 중 **숨김**. 되돌리기 경로는 hold 필드 초기화를 보장하지 않아 resume 과 이중 경로가 된다 — 출구는 배너 [해제] 단일화.
- 사유 길이: max 500 + `word-break` 로 전체 표시 (말줄임 없음 — 상한이 이미 짧다).

### 2-4. 보류 사유 입력 UX

- 드로어 인라인 입력(선택) 유지, **리스트 드롭다운 무사유 보류 허용 유지** — 빠른 경로의 비대칭은 의도. 단 **사후 보완 경로 신설**: on_hold 중 배너의 사유 영역이 **AutoSaveField(input, debounce 2s) 인라인 편집** — 사유 없이 보류한 업무에 나중에 사유를 달거나 수정 가능. 성공 ✓ 뱃지만(자동저장 표준).
- 백엔드 소요: PUT 이 `hold_reason` 을 수용해야 함(현재 이탈 시 초기화만 존재). `FIELD_RULES.hold_reason` = status 와 동일 집합, **task.status==='on_hold' 또는 이번 요청이 on_hold 진입일 때만 반영.** 사유 수정은 TaskStatusHistory 재기록 안 함(이력은 보류 시점 스냅샷, 현재값만 갱신).
- [보류 확정] 버튼은 ActionPrimary 유지 — 폼의 저장 액션(3톤 규칙의 "확인/저장"). 진입 버튼 [보류]/[외부컨펌]의 Secondary 는 유지.

### 2-5. 칸반 컬럼

- **드래그 앤 드롭 없음 실측** (`draggable` 0건) — 이동 쟁점 해당 없음. 향후 DnD 도입 시 on_hold 컬럼 드롭 = 사유 없는 보류, external 컬럼 드롭은 in_progress 발이 아니면 거절 토스트 — 원칙만 박제.
- 컬럼 순서 확정: `… in_progress → external_review → reviewing → revision → on_hold → completed` (외부컨펌은 "진행중에서 밖으로 나간" 상태 — 진행중 바로 뒤). 현재 3곳 모두 external 이 revision 뒤 → 이동.
- mine/week 뷰 on_hold 컬럼 **비추가 유지**(주간 무대 퇴장 원칙과 정합) — 소실 안내는 S6 장치가 담당.
- 빈 컬럼 숨김(visibleCols) 유지. on_hold 카드에 사유 1줄(11px, `#9A3412`, ellipsis) 추가.

### 2-6. 필터·검색

- 상태 필터 STATUS_CODES 파생 유지 — 신규 상태 자동 포함이 맞다. 단 제외 목록 += `done_feedback`(죽은 상태). "전체" = isClearable + "All status" placeholder 로 이미 충족.
- **"보류만 보기" 전용 진입점 비신설** — 필터 드롭다운 + 칸반 보류 컬럼 + S6 칩(클릭 시 전체 탭+보류 필터 자동 세팅)으로 3경로 확보. 별도 버튼은 클러터.
- 전역 검색 라벨화(S11)는 전 상태 일괄 수리.

### 2-7. 빈 상태·소실 안내 (핵심 회귀 방지)

- **보류 칩**: 주간 탭 ChipRow 에 내 담당 `on_hold` N>0 일 때만 오렌지 톤 칩 `보류 {{n}}` (pause 아이콘 + 클릭 가능). 클릭 → `setTab('all')` + `setStatusFilter('on_hold')`. 리스트·칸반 공통(FilterBar 는 공유).
- **전용 빈 상태**: 주간 목록/칸반 결과 0건 && 내 on_hold N>0 이면 기본 "업무를 시작해 보세요" 대신 — 제목 "이번 주 활성 업무가 없어요", 설명 "보류 중인 업무 {{n}}건은 전체 탭에 있어요", CTA "보류 업무 보기"(같은 이동). 기본 빈 상태 문구가 보류 사용자에게 거짓말("업무가 없다")하는 것을 차단.
- external_review 는 주간 잔류라 소실 안내 불필요.

### 2-8. 모바일 (≤640)

- 드로어는 `--vvh` 바운드 + `--chrome-top` 계약 기구현(`TaskDetailDrawer.tsx:2036-2044`) — 키보드 업 시 드로어가 줄어 입력 가림 없음. 배너가 상단 이동(2-3)하므로 폰에서도 첫 화면에 보임.
- 배너: `flex-wrap` 기구현 — 좁은 폭에서 [해제] 버튼이 아랫줄로 자연 낙하. 해제/보류/외부컨펌 버튼은 ActionButton(sm 36/md 40) — 터치 타겟 규칙 충족.
- 사유 인라인 입력: RevisionInput 재사용(폭 100%) + AutoSave 뱃지는 input 우측 내부(표준 위치).
- 보류 칩: ChipRow 는 wrap — 추가 칩이 줄바꿈으로 수용. 칩 높이 그대로(정보 요소, 44 타겟 의무 아님)나 탭 영역 padding ≥ 8px 확보.
- 드로어 ≤640 풀스크린 규칙(100vw): 현 드로어는 `min(w, 100vw-56px)` — **기존 관찰 사항이며 #206 에서 건드리지 않음**(반응형 일괄 스프린트 대상, memory `feedback_responsive_strategy`).

### 2-9. i18n 최종 문구 — §4 표. 핵심 결정:

- ko 유지: "보류중" / "외부컨펌중" / 버튼 "보류"·"외부컨펌"(상태명 버튼은 기존 드롭다운 문법과 동일).
- **en `External confirm` → `External review` 로 정정.** 기능설계에서 내부 reviewing 라벨과의 충돌 우려로 기각했으나, 실측 en 라벨은 "In review / Review needed / Review sent" — "External review" 는 접두 External 로 명확히 구분되고 "External confirm" 보다 자연스러운 영어다. 실측 대조 후 재판정.
- 진입 버튼 en: "Put on hold" / "Send for external review" ("Submit for review" 와 동사 문법 통일).

### 2-10. 접근성

- **HoldBanner 에 `role="status"`** (polite live region) — 보류/해제 전이 시 스크린리더 자동 안내. §17 규칙 정합: 비모달 배너에 `role="dialog"` 금지 — status 사용.
- 아이콘 SVG 전부 `aria-hidden="true"`(라벨 텍스트가 항상 병행되므로).
- 드로어 3훅(useBodyScrollLock/useFocusTrap/useEscapeStack) + `role="dialog" aria-modal="true"` — **기구현 확인(PASS)** (`TaskDetailDrawer.tsx:174-176, 853`).
- 상태 뱃지 버튼(드롭다운 오프너)에 `aria-haspopup="listbox"` + `aria-expanded` 추가.
- [보류 확정] 후 포커스는 배너 [보류 해제] 버튼으로 이동(작업 연속성) — `ref.focus()` 1줄.

### 2-11. 하니스 계약 (data-testid)

기존: `task-hold` `task-hold-confirm` `task-resume` `task-external` `task-external-resume` (드로어). 추가 확정:

| testid | 위치 |
|--------|------|
| `task-hold-banner` | 드로어 HoldBanner 루트 (하니스 상태 판정 앵커) |
| `task-hold-reason` | 배너 사유 AutoSave input + 진입 폼 input 공통 |
| `qtask-hold-chip` | 주간 탭 보류 칩 |
| `qtask-hold-empty-cta` | 보류 전용 EmptyState CTA |

`aria-modal` 은 드로어 기구현. 네이밍 `{화면}-{동작}` 준수(드로어=task-, 페이지=qtask-).

### 2-12. bespoke 판정

- `HoldBanner`/`HoldBannerText` — **합격.** 같은 파일의 CarriedBanner·TimeAutoHint 와 동일한 인라인 배너 문법이고, 공용 배너 프리미티브는 부재(만들지 않는다 — 1회용 추상화 금지). 버튼은 이미 공용 ActionButton alias(ActionSecondary/ActionPrimary) 사용 — 대체 불필요.
- `HoldActionRow` — 단순 flex row, 합격.
- 신규로 만들 것도 기존 것을 베낀다: 보류 칩 = 기존 Chip variant, 빈 상태 = 기존 EmptyState props, 사유 편집 = AutoSaveField + RevisionInput, 아이콘 = Icons.tsx 등록. **신규 styled 는 칸반 사유 1줄(KanbanHoldReason) 하나만 허용.**

---

## 3. 텍스트 와이어프레임

### 3-1. 드로어 — 보류 상태 (데스크탑 440px)

```
┌─ TaskFocusBar (in_progress 아님 → 미표시) ─────────────┐
│ [이월 배너 — 해당 시]                                    │
│ 홈페이지 리뉴얼 시안 B                          [✎]     │
│ (‖ 보류중 ▾) (프로젝트명) (요청자 chip) 2026-07-20      │   ← 뱃지에 pause 아이콘
│ ┌────────────────────────────────────────────────────┐ │
│ │ ‖ 보류 중                          [보류 해제]      │ │  ← role="status", orange
│ │ 사유: [고객 예산 재승인 대기________________] ✓     │ │  ← AutoSave input(권한자만)
│ └────────────────────────────────────────────────────┘ │
│ 의뢰 내용 …                                             │
│ (중략 — 메타/반복 섹션)                                  │
│ (되돌리기 — 보류 중 숨김)                                │
│ 액션 카드 — submit/complete 버튼 없음 (가드)             │
└────────────────────────────────────────────────────────┘
```

외부컨펌 상태: 배너 sky 톤, `↗ 외부 컨펌 대기 중`, 버튼 [작업 재개], 사유 입력 없음(외부컨펌은 사유 개념 없음).

### 3-2. 리스트 행 (보류 + 마감 지남)

```
│ 프로젝트A │ 홈페이지 리뉴얼 시안 B  [지연 D+3] │ 담당:영희 │ (‖ 보류중) │ 4h │ 2.5h │ ▓▓▓░░ 60% (회색) │ 07/20 │
                                                              ↑ title=사유          ↑ fill #94A3B8
```

### 3-3. 칸반 (전체/워크스페이스 탭)

```
미진행 | 업무요청 | 진행대기 | 진행중 | 외부컨펌중 | 확인진행중 | 수정요청 | 보류 | 완료
                                        (sky)                            (orange)
보류 컬럼 카드:
┌──────────────────────┐
│ [지연]        (우상단)│
│ 홈페이지 리뉴얼 시안 B │
│ 관찰자 · ‖ 보류중     │
│ 고객 예산 재승인 대기… │  ← 사유 1줄 ellipsis, #9A3412
│ 07/20   ▓▓▓░░ (회색) │
└──────────────────────┘
```

### 3-4. 주간 탭 — 소실 안내 (리스트/칸반 공통 FilterBar)

```
[검색][상태▾][완료 가리기] (12개)(남은 9h/가용 20h)(실제 6.5h)(‖ 보류 2)  [AI][+ 업무 추가]
                                                        ↑ 클릭 → 전체 탭 + 보류 필터
주간 목록이 0건 && 보류 N>0:
┌────────────────────────────────┐
│        (아이콘)                 │
│   이번 주 활성 업무가 없어요      │
│   보류 중인 업무 2건은 전체 탭에  │
│   있어요                        │
│      [보류 업무 보기]            │
└────────────────────────────────┘
```

### 3-5. 모바일 ≤640 (드로어)

```
┌──────────────── 100vw-56px, --vvh 높이 ─┐
│ 제목                                     │
│ (‖ 보류중) (chips wrap)                  │
│ ┌─────────────────────────────────────┐ │
│ │ ‖ 보류 중                            │ │
│ │ [사유 input 100%          ]  ✓      │ │
│ │              [보류 해제] (아랫줄 wrap)│ │
│ └─────────────────────────────────────┘ │
│ …                                       │
└─────────────────────────────────────────┘
키보드 업 → --vvh 축소로 입력 항상 가시 (기구현 계약)
```

---

## 4. i18n 확정 키·문구 (ko/en)

### qtask.json — 변경/추가만

| 키 | ko | en | 비고 |
|----|----|----|------|
| `status.on_hold.*` (4관점) | 보류중 | On hold | 유지 |
| `status.external_review.*` (4관점) | 외부컨펌중 | **External review** | en 정정 (§2-9) |
| `columnGroup.on_hold` | 보류 | On hold | 유지 |
| `columnGroup.external_review` | 외부컨펌중 | **External review** | en 정정 |
| `hold.action` | 보류 | **Put on hold** | en 정정 |
| `hold.resume` | 보류 해제 | Resume | 유지 |
| `hold.externalAction` | 외부컨펌 | **Send for external review** | en 정정 |
| `hold.externalResume` | 작업 재개 | Resume work | 유지 |
| `hold.reasonPlaceholder` | 보류 사유 (선택) | Reason (optional) | 유지 — 배너 편집 input 공용 |
| `hold.confirm` | 보류 확정 | Confirm hold | 유지 |
| `hold.banner` | 보류 중 | On hold | 유지 |
| `hold.bannerWithReason` | *(폐지)* | *(폐지)* | 배너가 사유 input 을 갖게 되어 합성 문구 불필요 — 키 삭제 |
| `hold.externalBanner` | 외부 컨펌 대기 중 | **Awaiting external confirmation** | en 정정 |
| `hold.completeBlocked` (신규) | 보류 해제 후 완료 처리할 수 있어요 | Resume the task before completing | 체크박스 title |
| `weekHold.chip` (신규) | 보류 {{n}} | On hold {{n}} | 주간 칩 |
| `weekHold.emptyTitle` (신규) | 이번 주 활성 업무가 없어요 | No active tasks this week | |
| `weekHold.emptyDesc` (신규) | 보류 중인 업무 {{n}}건은 전체 탭에 있어요 | {{n}} on-hold task(s) are in the All tab | |
| `weekHold.emptyCta` (신규) | 보류 업무 보기 | View on-hold tasks | |

### common.json — 추가

| 키 | ko | en | 사용처 |
|----|----|----|------|
| `toaster.taskOnHold` | 업무가 보류되었습니다 | Task put on hold | NotificationToaster |
| `toaster.taskExternalReview` | 외부 컨펌 대기로 전환되었습니다 | Task sent for external review | 〃 |
| `toaster.taskResumed` | 보류가 해제되었습니다 | Task resumed | 〃 (외부컨펌 종료 포함) |
| `public.task.status.on_hold` | 보류중 | On hold | PublicTaskPage |
| `public.task.status.external_review` | 외부컨펌중 | External review | 〃 |

주의: 드로어 타임라인의 en 라벨은 위 hold.* 키를 파생 사용하므로 자동 정정됨. 백엔드 알림 문구(한국어 하드코딩)는 **전 알림 공통의 구조 문제로 이번 스코프 밖** — 별도 건.

---

## 5. 구현 절단면 (Opus 범위 — 이 밖 수정 시 게이트 FAIL)

### 프론트엔드

| # | 파일 | 변경 요지 |
|---|------|-----------|
| F1 | `utils/taskLabel.ts` | statusOptionsFor: completed/canceled 에서 on_hold 제외 |
| F2 | `components/Common/Icons.tsx` | `StatusGlyph({code,size})` — pause / arrow-up-right, 그 외 null, aria-hidden |
| F3 | `components/QTask/TaskDetailDrawer.tsx` | 배너 상단 이동 + `role="status"` + `data-testid="task-hold-banner"` · 배너 사유 AutoSaveField(input, `task-hold-reason`, PUT hold_reason) · bannerWithReason 제거 · RevertRow 를 on_hold/external 중 숨김 · CarriedBanner active 배열 += external_review(L962) · 타임라인 `from_status==='external_review'` → hold.externalResume 라벨 분기 추가 · StatusBadge/StatusGlyph + aria-haspopup/aria-expanded · 해제 후 포커스 이동 |
| F4 | `pages/QTask/QTaskPage.tsx` | 칸반 3곳 external_review 를 in_progress 뒤로 · on_hold 카드 사유 1줄(KanbanHoldReason 신규 styled 1개) · StatusPill title=hold_reason · 진행바 on_hold 회색 · 상태 필터 done_feedback 제외 · toggleComplete on_hold/external 가드(disabled+title) · 보류 칩(`qtask-hold-chip`) + 전용 EmptyState(`qtask-hold-empty-cta`) — 클릭 시 tab='all'+statusFilter='on_hold' |
| F5 | `pages/QProject/ProjectTaskList.tsx` | sliderColor += on_hold 회색 · 체크박스 가드 · saveField(status) 시 `focus:refresh` dispatch · StatusPill 에 StatusGlyph |
| F6 | `pages/QProject/TasksTab.tsx` | status 변경 시 `focus:refresh` dispatch (드롭다운 저장 경로) |
| F7 | `pages/QTalk/QTalkPage.tsx` | 임베드 카드 체크 토글 on_hold/external 가드 |
| F8 | `pages/QTalk/ChatPanel.tsx` | 임베드 업무 카드에 상태 pill(STATUS_COLOR+observer 라벨, 전 상태) |
| F9 | `components/Workbench/ContextTaskList.tsx` | STATUS_TONE += on_hold `#EA580C`·external_review `#0EA5E9` + dot title=상태 라벨 |
| F10 | `components/Common/GlobalSearchModal.tsx` | task sub = `qtask:status.${s}.observer` 라벨화 |
| F11 | `components/Common/NotificationToaster.tsx` | task:updated 분기 on_hold/external_review/해제 3종 + toaster 키 |
| F12 | `pages/Public/PublicTaskPage.tsx` | STATUS_TONE/LABEL 2값 + common 키 |
| F13 | `components/QTask/WeeklyReviewWorkspaceView.tsx` + `services/weeklyReview.ts` | blockerStatusLabel 재작성(qtask observer 폴백) + BlockerChip on_hold 색 + BlockerStatus 타입 |
| F14 | `components/QTask/WeeklyReviewView.tsx` | blocked_status 라벨화(L251-260) |
| F15 | `pages/Insights/tabs/TasksTab.tsx` | 상세 테이블 status 컬럼(라벨+색) — CSV 와 일치 |
| F16 | `locales/{ko,en}/qtask.json` · `common.json` | §4 전량 |
| F17 | `dev-frontend/COLOR_GUIDE.md` | §3 표 2행 + 배너 보더 색 등록 |

### 백엔드 (1건만)

| # | 파일 | 변경 요지 |
|---|------|-----------|
| B1 | `routes/tasks.js` | PUT `hold_reason` 수용 — destructure + `FIELD_RULES.hold_reason`(status 와 동일 집합) + **on_hold 중이거나 이번 요청이 on_hold 진입일 때만 반영**, 그 외 무시. history 재기록 없음 |

### 건드리지 않는다 (수정 diff 발견 시 FAIL)

- `services/taskActualHours.js` · `focusSync.js` · Focus 위젯 로직(`FocusWidget.tsx`/`TaskFocusBar.tsx`) — 무변경이 설계
- 캘린더 전 파일 (보류 업무 잔류 = 정책) · 대시보드/TodoPage (status 표면 없음 — 백엔드 제외 검증만)
- 드로어 폭/풀스크린 반응형 규칙 (일괄 스프린트 대상) · Insights funnel 시각화 신설 (별도 건) · 백엔드 알림 문구 i18n 구조 (별도 건) · done_feedback 제거 · 전이 규칙/권한/액션 계층 본체

---

## 6. 회귀 위험

| # | 위험 | 방어/검증 |
|---|------|-----------|
| V1 | **소실 체감** — 보류 후 주간 목록·칸반에서 사라짐 | S6 칩+빈상태. 검증: 내 업무 보류 → 주간 탭에서 칩 `보류 1` 표시 + 클릭 시 전체 탭 필터 착지 |
| V2 | 체크박스 우회 — on_hold 체크 → completed 시도 | 3곳 가드. 반증: 가드 제거 상태에서 백엔드 400 확인 후 가드 복원(fail-closed 확인) |
| V3 | 사유 AutoSave 가 on_hold 아닐 때 hold_reason 저장 | B1 조건부 반영 + 반증: in_progress 업무에 PUT hold_reason → 무시(재조회 null) |
| V4 | bannerWithReason 키 삭제로 잔존 참조 crash | grep `bannerWithReason` 0건 확인 |
| V5 | 칸반 컬럼 순서 변경으로 하니스/e2e selector 어긋남 | 컬럼 key 불변(순서만) — e2e 는 key 기반 확인 |
| V6 | GlobalSearch/블로커 라벨화가 qtask ns 미로드 화면에서 키 노출 | fallback 문자열 인자 필수(`t(k, code)`) |
| V7 | 외부컨펌 en 라벨 변경(qtask 3키) 스냅샷/문서 불일치 | 기능설계 문서 §5 와 차이 — 본 문서가 우선(실측 재판정 명기) |
| V8 | 토스터 분기 추가가 기존 3분기 동작 회귀 | 2탭 실측: completed 토스트 기존 동작 + on_hold 토스트 신규 동작 |

---

## 7. 구현 게이트 PASS 조건 (Fable 재검증 항목)

1. `npm run build` EXIT 0 + i18n 하드코딩 grep 0 + health-check 통과.
2. 실HTTP: on_hold 업무에 PUT `hold_reason` → 재조회 일치 / in_progress 업무엔 무시 / member(비권한) 403.
3. 2탭 실측: A 가 보류 → B 드로어 배너 즉시(≤1s) + 토스터 표시. B 주간 탭 목록에서 소실 + 칩 `보류 N` 증가.
4. 공유 링크(PublicTaskPage)·전역 검색·워크스페이스 주간보고 blockers 에서 raw `on_hold` 문자열 0건 (한/영 양쪽).
5. 체크박스 3곳 — on_hold 업무에서 disabled 실측.
6. 드로어: 배너가 첫 뷰포트(스크롤 0)에서 보임(≤640 포함) · role="status" · data-testid 4종 존재.
7. diff 범위 = §5 절단면과 정확히 일치 (범위 외 변경 0).
