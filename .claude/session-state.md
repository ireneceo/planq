# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-06 (Opus, 노트북 세션 — 배포 완료, 미배포 0)
**작업 상태:** 이번 세션 큰 흐름 완료. B4 잔여 + 내부/고객 구분 3-Layer 운영 라이브.

### ✅ 이번 세션 완료·배포 (2026-07-06 노트북)
- **배포1 (라이브):** #114 업무 라벨 뷰어관점 분기 · #115 AI업무추가 "요청 내용"→"추가할 업무"(promptLabel/Hint ko/en 신규) · 랜딩 기능명 capitalize 제거 · 로그인 구글버튼 '심사 중' 안내
- **배포2 (라이브, B4):** **#112 수정요청 첨부**(revision 라우트 revision_comment_id 반환 + TaskDetailDrawer 첨부 피커, context='comment' 재사용, E2E 8/8) · **#100 오버커밋 경고**(남은예측>가용 시 칩 amber+초과분) · **#120 그룹별 업무추가**(ProjectTaskList 그룹 헤더 인라인 추가 + **백엔드 POST /api/tasks workstream_id 무시 잠재버그 수정**, E2E 4/4)
- **배포3 (라이브): 내부 vs 고객 프로젝트 구분 3-Layer** (commit `0f8eb6c`, 운영 마이그레이션 선행) — 설계 `docs/INTERNAL_VS_CLIENT_PROJECT_ANALYSIS.md`
  - L1: `Project.kind ENUM('client','internal')` + 멱등 백필(`scripts/migrate-project-kind.js`). 운영 internal 6/client 3
  - L2: Insights `고객|내부|전체` 세그먼트 토글(overview/profit/team/finance) + ProfitTab 내부 투자 뷰 + 프로젝트 편집·생성 '내부 프로젝트' 토글
  - L3: `services/stats.js` 수익성·negative_margin·매출배분=kind='client'만, 내부는 internal_investment 별도, new_clients=Client.kind='customer'만, team revenue_share 분모 고객시간 한정
  - 검증: 세그먼트 E2E + 운영 실데이터 6/6(biz1 internal 6, 수익성 오탐 제거, internal_investment 166.8h/834만원)

### ✅ B3 캘린더 + 세션 코드리뷰 (2026-07-06 후속, 운영 배포)
- **#104 나만보기 공개링크 L1 누출 차단**(Fable 게이트) + **#102 시간칸 클릭 생성 prefill** 배포(ecd888d)
- **#119 기간표시순서** — 드로어 기간 표시는 코드상 전부 start→end 올바름. Irene 화면 실문구 대기(미착수)
- **세션 코드리뷰(3 finder×verify) 버그 6건 수정·배포(f7c6176):**
  - A internal_investment client 뷰 0 → 전체조회 kind분리 · B POST workstream 크로스테넌트 → business 검증
  - C/D 세그먼트 토글 profit 전용화(overview/team 혼합KPI 제거, overview active_projects 전사복원)
  - **E 캘린더 L2(팀비공개) 옛 공개링크 노출 → 공유·공개GET·회수 L1+L2 확장**(중요 보안)
  - F 반복 회차수정 vlevel/target 미복사→L2/L4 확대 fix · G NewProjectModal isInternal 리셋
  - 리뷰 fix E2E 8/8 + Fix B 2/2. 운영 미노출 예방적.

### 남은 후속 (내부/고객 구분)
- QTalk RightPanel 내부배지가 아직 client_company 휴리스틱(`RightPanel.tsx:533`) — `project.kind`로 교체 가능(선택)
- NewProjectModal/QTalkPage `project_type`가 QTalk 생성경로에서 미전달(별개 잠재버그, kind는 전달됨)
- laborCost 시간당 50000원 하드코딩(`stats.js:523`) — hourly_rate 컬럼 추후

### 이번 세션 완료·배포 (Fable 계획)
- **하니스 v1 + 카나리 크롤 + 비주얼 감사** (`scripts/e2e/`). SPA 네비로 전 라우트 크롤(auth rotation/rate-limit 회피). data-testid 시딩 시작(task-add-btn).
- **B0 완료(검증):** #108 정기청구 검토요청 Q Bill 배지·확인필요 노출 + #92 정기발송 기준 표시 — 실데이터 검증(billCount·recurring). 이미 fix된 상태였음.
- **#98 수정·배포(f8350e6):** 프로젝트 멤버 선택자 계정명→워크스페이스 표시명. `/api/businesses/:id/members`가 user.display_name 내려줌.
- **/files 업로더 표시명 누출 수정(992d6b1)**, 배너/네이티브·지연업무·그래프 가용시간·단축키·FAB 등 앞서 배포.

### 운영 피드백 처리 누계: done 10 + reviewing 2 (전체 121 중 79 기존done)
- **이번 세션 done:** #87 #91 #92 #98 #101 #103 #108 #111
- **reviewing:** #79(모바일키보드) #106(L1완료·Drive/공유 진행)
- **남은 ~32건 미해결.**

### 다음 할 일 (Fable 8배치 순서)
- **B2 모바일 완성도:** #79·#86·#116·#118(팝아웃/우측패널 업무추가 키보드)·#110·#113. **선행: 하니스 data-testid ~20개 시딩**(현재 task-add-btn 1개) + mobile-keyboard 스위트에 opener 연결.
- **B3 캘린더:** #102 시간칸클릭 prefill·#119 기간표시순서·**#104 나만보기 일정 공개링크 L1 오염(Fable 게이트)**.
- **~~B4 업무UX~~ ✅ 완료·배포** (#114·#115·#112·#100·#120 전부 라이브)
- **B5 폴리시:** ~~#71(공지배너 랜딩/팝아웃 노출차단 — 5f8111c 이미 배포)~~·#84(Q위키 팝아웃 FAB 이미배포)·#89·#96. **B6 이미지:** #97·#121·#63(zip 이미 배포). **B7 프로젝트:** #95(채팅방토글 이미배포)·#99. **B8 Cue:** #90(notify 이미배포)·#117.
  - ⚠ 다수가 이미 배포 완료 상태(리스트 정리 누락). 착수 전 `git log --all | grep #NN` 로 완료여부 먼저 확인. 남은 진짜 미해결: #89·#96·#99·#117(설명 필요) + #119(드로어 기간표시 실문구 필요)
- **(c) 외부트랙 — Irene 몫:** **Google OAuth 4건(#72·#88·#107·#109) = Google Cloud Console 검증 제출** / #85 보고서 SCR 설계 승인 / #60 PushLog 확인 후 기기안내 / #81 Cue 실작업 스코프 결정.

### Fable UX-마찰 검출 판단 (구축 계획, 미착수)
- 부분 검출 가능: 셀 수 있는 마찰(터치타겟<44px·목표까지 클릭수·필수필드·빈상태 CTA·엔지니어링 용어)=자동 게이트, "많은가/헷갈리는가"=자동 갤러리+사람 5분 판정.
- **설계:** visual-audit 확장(터치타겟·빈상태·용어 3지표, 반나절) + `friction-audit.js` 신규(골든플로우 4개: 고객초대·업무추가·일정추가·청구서발행, 클릭수·단계 회귀만 게이트). testid ~20개 선행.
- window.confirm "4파일 잔존"은 **Fable 오탐**(실제 0건, 주석뿐) — 검증 완료, 조치 불필요.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
