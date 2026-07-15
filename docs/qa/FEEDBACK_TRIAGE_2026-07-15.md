# PlanQ 운영 피드백 전수 트리아지 (2026-07-15)

운영 미해결 피드백 **45건**(pending 43 + reviewing 2 / 총 181건 중) 전수 분석. Fable 트리아지 + 코드 대조. 근거는 파일:라인. 다음 사이클 구현 가이드.

## A. 총정리 (영역별)

| 영역 | 건수 | 핵심 |
|------|------|------|
| 이미 해결·배포됨(v1.47.0) | 13 | #139~#151 대다수 — 제출 시점이 07-14 수정 이전 |
| 🔴 모바일 Q Mail 흰 화면 | 4 (#173/174/159/178) | 단일 근본원인 — MailPage 메인 컬럼 ≤1024px `display:none` |
| 모바일 반응형 레이아웃 | 9 | 프로젝트 탭 세로줄바꿈·KPI 1열·달력 잘림·드로어 닫기 가림·키보드 여백 |
| Q Mail 로직/AI | 5 (#180/179/164/154/153) | 뱃지 카운트 불일치·AI 요약 무반응·답장 언어·일괄버튼 |
| 신규/추가 기능 | 8 | OG 미리보기·피드백 메타·음성입력·프로젝트 헤더 등 |
| 구조/기획 판단 | 4 (#166/167/162/163) | 진척 문구·개요vs상세·환경정보 |
| 검토중 | 2 (#126 캘린더양방향·#81 Cue실행) | OAuth 대기 / 전이툴 배포됨 |

### ★ /help-popout 23건 클러스터 = page_url 오기록 버그
공통 버그 아님. 도움말 팝아웃의 Q helper 드로어에서 피드백 제출 시 `CueHelpDrawer.tsx:346`이 **팝아웃 창 자신의 location(`/help-popout`)**을 page_url로 전송(부모 화면 URL 캡처 코드 없음). 23건은 실제로 Q Mail·프로젝트·캘린더·통계 등 **서로 다른 화면의 독립 피드백**이 전부 `/help-popout`으로 오기록된 것. 이것이 곧 **#162의 실체**. 이 중 13건은 이미 해결·배포됨.

## B. 실행 목록 — 수정 (임팩트 순)

| #id | 요지 | 규모 | 근거 | 구현 방향 | 게이트 |
|-----|------|------|------|-----------|--------|
| 173/174/159/178 | 🔴 모바일 Q Mail 전체 흰 화면 | 소→중 | `MailPage.tsx:1408` `$hideTablet`→`PanelLayout.tsx:102` `≤1024px{display:none}` + `data-panel-main` 부재. 대조군 `QNotePage.tsx:2198` | `$hideTablet` 제거 + `data-panel-main` 추가(QNote 패턴). 우측은 이미 overlay | — |
| 181 | 우측 패널 열려도 FAB가 버튼 가림 | 소 | `RightDock.tsx:184` overlay-open만 숨김. add 드로어 `QTaskPage.tsx:2703` `useBodyScrollLock` 미호출 | lock 조건에 `(addingTask && !addInline)` 추가 | — |
| 176/177/160 | 프로젝트 탭 세로 줄바꿈+좌우 흔들림 | 소 | `QProjectDetailPage.styles.ts:50-57` TabBar nowrap/overflow-x/flex-shrink 전무 | TabBar `overflow-x:auto`, Tab `white-space:nowrap;flex:0 0 auto` | — |
| 171/172 | 확인필요 드로어 [닫기] 헤더에 가림 | 소 | `TaskDetailDrawer.tsx:1946` z-index:40 < MobileHeader `MainLayout.tsx:544` z-index:99. safe-area 미반영 | z-index 120 + `top:calc(56px+env(safe-area-inset-top))` + 헤더 sticky | — |
| 180 | Q Mail 뱃지 25 vs 리스트 14 불일치 | 소→중 | 뱃지=`dashboard.js:956-975` 전 워크스페이스 합산 / 리스트=`email_threads.js:131-138` 현재만 | 현재 워크스페이스로 통일 권장. **Irene 정책확인** | ⚠️ business_id |
| 153 | AI 답장 영어메일에 한글 생성 | 소 | `email_threads.js:886` language=ko 고정, 프론트 미전송 | 최근 수신본문 한글감지를 default보다 우선 | — |
| 169 | KPI 카드 모바일 1열(2열 요청) | 소 | `Insights/components.tsx:53` 560px 1fr. 프로젝트개요 bespoke `ProjectCanvas.tsx:260` | 공용 KpiGrid 560px `repeat(2,minmax(0,1fr))` | — |
| 170 | 통계 하위메뉴 제목 동일해보임+모바일 필터깨짐 | 소→중 | 제목 실제 다름이나 `PageShell.tsx:111` ellipsis로 접두어가 폭차지. 모바일 2뎁스 nav `MainLayout.tsx:306` display:none | 모바일 접두어 제거+탭명만, 탭전환 세그먼트 노출 | — |
| 175 | 모바일 /tasks 기간 팝오버 달력 잘림 | 소 | `CalendarPicker.tsx:226` 2달 600px+, mediaPhone 없음 | mediaPhone 세로 2달 또는 1달만 | — |
| 161 | 모바일 새일정 키보드 위 흰 여백 | 소→중 | `NewEventModal.tsx:394,399` --vvh 높이제한만·top:70 고정 | 바텀시트 전환+푸터 sticky+keyboard-up 계약 | — |
| 165 | Q Talk 리스트에서도 FAB 숨김+nav 복귀안됨 | 소 | `RightDock.tsx:72` onTalk pathname만. 활성방=`?conv=` 쿼리 | onTalk을 `search.has('conv')`로 축소+nav 재클릭 conv 제거 | — |
| 179 | 메일 요약/추출 무반응(영어) | 소 | 백엔드 정상. 프론트 `MailContextPanel.tsx:206` `if(j.success)` else 없음→조용히 죽음 | 실패 분기 추가. 런타임 last_error/OPENAI 확인(**미확인**) | — |
| 164 | 미리보기 영어조각+이메일주소 노출 | 소 | 주소폴백 `MailPage.tsx:1301` (name null시). preview=원문slice `emailImapCron.js:364` | name없을때 도메인/축약. 'Verb??' 실물확인(**미확인**) | — |
| 166 | 주간 진척 주중에도 '목표 미달' 오안내 | 소 | `QTaskPage.tsx:1370` SPI<0.85. 주초 미달판정 가능 | 주초 유예/임계완화. 문구 후 Irene 컨펌 | — |

## C. 실행 목록 — 신규/추가 기능

| #id | 요지 | 규모 | 근거 | 구현 방향 | 게이트 |
|-----|------|------|------|-----------|--------|
| 162 | 피드백 디바이스/환경/팝아웃 수집(+page_url버그) | 소→중 | `feedback.js:48` UA수집됨. 팝아웃 버그 `CueHelpDrawer.tsx:346` | `HelpStandalonePage`가 `window.opener.location` 캡처. FeedbackItem에 client_env/is_popout 컬럼 | ⚠️ 마이그레이션 |
| 154 | Q Mail 일괄 확인완료/답변불필요 | 중 | 개별만 `email_threads.js:380·498` | `POST /bulk-dismiss {thread_ids[]}` + 체크박스 UI | — |
| 155 | '말로 추가' 인식실패+즉시녹음안됨 | 소→중 | `VoiceCaptureSheet.tsx:36` idle오픈+재클릭. `:90` webm강제(iOS미지원) | 오픈시 자동 start()+isTypeSupported로 webm↔mp4 | — |
| 152 | 공유링크 소셜 미리보기(OG) 루트고정 | 중→대 | `index.html:34` 정적OG. 공개share SSR 0건 | 크롤러UA 감지→per-엔티티 OG 주입(부분SSR)/nginx 봇분기 | — |
| 163 | 모바일 캘린더 필터/오늘시작/월전환 접근성 | 중 | `QCalendarPage.tsx:457` actions 모바일서 묻힘. agenda 월초시작 | 모바일 필터/뷰바 상시노출, agenda 오늘기준 | — |
| 167 | 개요=보기전용/상세=수정 구조반전 요청 | 중 | **현재 정반대**(개요=편집 `ProjectCanvas.tsx:211`, 상세=읽기 a740deb #148) | **a740deb와 충돌 — Irene 확정 필요** | — |

## D. 제외

**이미 해결·배포됨(v1.47.0):** #147·148·150·151·149(대부분)·140·145·143·142·141·139·146·156·144 → **close 대상**.

**검토중:** #126(캘린더 양방향 — OAuth 승인 선행) · #81(Cue 실행 — 전이툴 배포됨, 재검증 후 close).

**미확인(런타임/실물):** #179 last_error·OPENAI 실측 · #164 'Verb??' 실물메일.

## E. 추천 착수 순서

1. **🔴 최우선 — 모바일 앱 정상화(소·즉효):** #173/174/159/178 흰화면(단독 최우선) + 묶음 #181 FAB·#171/172 드로어닫기·#165 Q Talk FAB/nav (z-index/오버레이 계약)
2. **모바일 반응형 배치(한 사이클):** #176/177/160 탭·#169 KPI·#170 통계·#175 달력·#161 키보드 (공통 --vvh/breakpoints 수렴)
3. **Q Mail 로직·AI(한 사이클):** #153 언어·#179 무반응·#164 주소·#154 일괄·#180 뱃지(정책확인)
4. **기획 판단(Irene 컨펌 선행):** #167 구조반전·#166 진척문구·#163 캘린더 · #162 피드백환경(조기착수 권장 — 향후 트리아지 품질↑)
5. **독립 기능:** #155 음성입력·#152 OG미리보기

**Fable 게이트 대상:** #180(business_id 격리)·#162(DB 마이그레이션)만. 나머지는 `/검증`으로 충분.
