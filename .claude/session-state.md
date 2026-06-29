# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-29 (실시간 운영 피드백 마라톤 — /개발완료)
**작업 상태:** 완료 · **미배포 0건** (운영 7배치 전부 배포 완료)

### 진행 중인 작업
- 없음

### 완료된 작업 (2026-06-29 세션) — 전부 운영 라이브
- **QTask 이번주 패널 중복카운트 fix** — sent 버킷 조건 반전(pending 컨펌자=요청자 중복). 패널 4→3=리스트. deploy `20260629_043957`
- **주간 진척 그래프 = 번업 확정** — 0→상승+월요일앞 시작앵커+실제>가용 빨강·초과마커. 박제 feedback_weekly_progress_graph_burnup. `_051607`
- **Q Bill 이벤트 타임라인 (신규)** — services/billEvents.js + invoices.js 9라우트 계측(고객열람·부분결제 신규) + GET /timeline + InvoiceDetailDrawer 활동 타임라인. E2E 15/16. `_051607`
- **청구서 목록 열람/미열람 뱃지** — viewed_at 기반. (d2f085f)
- **🔴 채팅 과거 사라짐 fix** — historyLoaded 플래그(socket 1건이 히스토리 로드 막던 회귀) + conversations.js GET 최신200(옛 오래된200). 박제 feedback_chat_history_socket_blocks_load. `f89696b`
- **🔴 로그인 차단 fix** — 일반 API 리미터 100→600/분 + 인증 user별 버킷 + login skipSuccessful. 박제 feedback_api_ratelimit_authed_spa. `0bb3c76`
- **메일 미리보기 content-first** — emailWrap 프리헤더 슬로건→실제내용(16템플릿). `58ad3ee`
- **캔버스 정리 + 데이터 출처 표시(신규 SourceHint)** — 풀폭·주요만보기·토글통일·진행률/D-day ⓘ. 가짜데이터 전수감사 0건. 프로젝트 문서탭 풀레이아웃+📌고정복원, ProjectPostsTab 제거. `520b2e9`

### 함정 박제 (이번 세션 신규 memory)
- feedback_weekly_progress_graph_burnup — 주간 진척 그래프는 번업(번다운 재제안 금지)
- feedback_chat_history_socket_blocks_load — 채팅 히스토리 로드는 별도 플래그(메시지 배열 존재≠로드완료), 페이지네이션 최신N개 우선
- feedback_api_ratelimit_authed_spa — 전역 리미터 user별 버킷+상향, login skipSuccessful

### 다음 할 일 (이번 세션 미완·확인/결정 대기)
- **★ 프로젝트 문서 탭 카드형** — Irene 확정: **파일 탭 구조 그대로**(좌측 220px 카테고리 패널 + 상단 필터/검색 + 카드 그리드). 현재는 풀폭 행 리스트 + 📌 고정(중간상태). DocsTab(Split 220px+FilesArea+Grid) 베껴서 PostsPage project 스코프 browse 레이아웃 재구성. 카드 클릭→풀폭 보기/편집+"←목록". 표 기능 유지. (PostsPage.tsx browse 분기 추가)
- **캔버스 일정 기본세팅** — 날짜 없으면 D+9130 대신 안내(빈상태) + 막대 진행 마커 + 시작/마감일: **자동추론 vs 입력유도 결정 필요(Irene)**
- **출처 표시 UX 2차** — 보고서 KPI("이 기간")·Insights("지난 30일") ⓘ 확장 + AI 생성 배지(executive_summary·dashboard insights — 생성출처 플래그 백엔드 추가 필요)
- **탭 이름** — "캔버스 → 개요?" (Irene 브랜드 결정)
- **메일 content-first 2차** — 푸시/인앱 title 핵심 우선(이전 합의)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
