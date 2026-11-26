# 회사별 맞춤 설정 · 고객사 서버 설치 — 코드 검토 (2026-11-26)

> Irene 요청(방 1bd7dfcd): 기획안을 그대로 하지 말고 검토 → Fable 검토 → 지금 어떻게 적용·반영 가능한지.
> 조사 [Opus] (HEAD a6994ffb, 코드 변경 0) · 판정 [Fable · decision]. 이전 설계: `docs/ONPREM_DESIGN.md`(2026-09-24).
> «추정» 표시 = 저장소에서 확인할 수 없는 것.

## 두 가지 핵심 질문의 답
1. **지금 회사마다 업무 단계를 설정할 수 있나 — 절반.** 양식(Q docs 표·설문)과 업무 묶음(프로젝트 템플릿)·메뉴 권한은 회사가 직접 바꾼다. **업무 상태 10가지와 그 전이 규칙은 코드에 고정**(`models/Task.js:78` ENUM · `services/taskTransition.js canEnterStatus`), 자동 승인자 규칙도 없다.
2. **중앙과 끊겨도 고객 서버에서 접수·업무·첨부가 되나 — 코드상 된다, 실측은 안 했다.** 중앙 확인(라이선스·버전 체크) 코드가 0건이고, 접수·업무·첨부·채팅은 그 서버의 DB·디스크·실시간 연결만 쓴다. 단서: 바깥 고객이 접수하려면 서버가 외부에 열려 있어야 함 · 메일은 고객 메일 서버 연결 필요 · 지금 코드면 14일 뒤 무료 강등·500MB 제한이 걸림 · 웹만(앱·푸시·회의 받아쓰기·구글 로그인 안 됨).

## A. 기존 SaaS 에서 회사별 업무시스템

| 항목 | 현재 상태 | 코드 근거 | 필요한 변경 | 선행·작업량 |
|---|---|---|---|---|
| 회사 단위·데이터 분리(API) | 구현됨 | `models/Business.js` · `middleware/access_scope.js attachWorkspaceScope`(:1139) · 공개 범위 L1~L4 · `middleware/menu_permission.js` | 정적 검사 잔여 17건 정리 | S, 2~3일 |
| 검색 | 구현됨 | `services/searchScope.js`(사람·AI 같은 함수) · `services/searchGates.js` | 없음 | — |
| 첨부·내려받기 | 구현됨 | `routes/files.js:1599` + `canDownloadFile` · S3 서명 URL · 공개 링크 토큰·만료 | 없음 | — |
| 알림 | 구현됨 | `services/notifyRecipient.js` · `notifyMenuGate.js` · 소켓 방 재검증(`server.js:154,234`) | 없음 | — |
| 내보내기 | 구현됨 | `routes/export.js:155,178`(회사 전체는 관리자) | 없음 | — |
| 격리 검사 장치 | 구현됨 | `scripts/guard-invariants.js` tenant · `scripts/e2e/canary-tenant*.js` | 없음 | — |
| 접수 양식(설문) | 부분 구현 | Q docs 표 열 12타입(`models/QRecord.js`) · 설문 공개(`routes/survey_public.js`) | **응답 → 사건·업무 자동 생성** 없음(기존 기능 잇기) | M, 1~2주 |
| 공개 문의 폼 | 필드 고정 | `models/WorkspaceInquiry.js:22`(이름·메일·전화·회사·내용) | 설문 열 정의 재사용 | M, 4~6일 |
| 업무·고객 사용자 정의 필드 | 미구현 | Task·Client 에 칸 없음 | 정의 표·값·화면·필터(신규) | L, 2~3주 |
| 업무 상태 | 미구현(고정 10개) | `models/Task.js:78` · `taskTransition.js` · `reviewStage.js` | **바꾸지 않는다**(아래 단계 층) | — |
| 업무 유형별 처리 단계 | 부분 구현 | 프로젝트 템플릿 `TaskTemplate*`(업무·역할·선후관계) · `ProjectStage`(견적·계약·청구 중심) | 회사별 «처리 단계» 층 신규(Fable 안 b) | L, 3~5주(추정) · 설계 먼저 |
| 컨펌자(승인자) | 부분 구현 | `models/TaskReviewer.js` 업무마다 수동 · 전원/1인 정책 | 템플릿·유형별 기본 컨펌자 규칙 | M, 1주 안팎 |
| 열람 권한 | 구현됨 | L1~L4 + 특정 멤버 · 메뉴 권한 · 역할 owner/admin/member 고정 | 역할 묶음은 나중 | M |
| 회사명·로고(앱 안) | 부분 구현 | `Business.brand_name/brand_logo_url/brand_color` · 로고는 전환기만 · 색 미적용 | 색 테마 | S, 2~3일 |
| 로그인 화면 | 미구현 | `pages/Login/LoginPage.tsx` PlanQ 고정 | `/w/:slug` 로 들어오면 회사 이름·로고 | S~M, 3~4일 |
| 고객사 도메인(옵션) | 미구현 | Host 판정 0 · nginx planq.kr 고정 | 소유 확인·자동 인증서·도메인→회사·쿠키/OAuth/딥링크 | L, 2~3주 · 선행: 주소 하드코딩 정리·인증서 인프라 결정 |
| 알림 발신명(옵션) | 이름만 구현 | `services/workspaceSender.js`(이름) · 주소 noreply@planq.kr 고정 · 멤버 알림은 PlanQ 이름 | 회사 메일 주소 발송 = 회사 SMTP(신규, 도달률 책임) | M, 1~1.5주 · 외부 발송이라 Fable 대상 |

## B. 고객사 서버 한 곳 설치

| 항목 | 현재 상태 | 코드 근거 | 필요한 변경 | 선행·작업량 |
|---|---|---|---|---|
| 프로세스 구성 | 부분 구현 | `dev-backend/ecosystem.config.js`(백엔드·Q Note) · `scripts/prod-ecosystem.config.js` 낡음(3002 vs 실제 3004) | 설치용 하나로, 포트·경로 env | S, 1일 |
| 백그라운드 작업 | 구현됨(프로세스 안) | `server.js:740-950` cron(결제·체험·정기청구·IMAP·Drive…) · Redis 없음 | 설치판 스위치로 결제·체험·SEO cron 끄기 | M, 2일 |
| DB·마이그레이션 | 부분 구현 | `sync-database.js` alter:true(고객 DB 금지) · `scripts/deploy-planq.sh` 인라인 migrate 145개 · 적용 기록 표 없음 | 순서 있는 원장 + 적용 기록 + 빈 DB 설치 검증 | L, 1~1.5주 · 되돌리기 어려움(Fable) |
| 파일 저장소 | 부분 구현 | 로컬 `uploads`(경로 env 없음) · `s3Storage.assertSafeEndpoint` 가 https·사설 IP 차단 → 사내 MinIO 불가 | UPLOAD_DIR env · 설치판에서 사설 주소 허용 | S, 1~2일 |
| 컨테이너·설치기 | 미구현 | Dockerfile·설치 스크립트 0 · Chrome(puppeteer)·torch·pdftoppm 필요 | Docker 이미지 3종 + compose 또는 설치 스크립트 | L, 1주+ |
| 로그인 | 구현됨 | 이메일·비밀번호 로컬 · Google/Apple 선택 | 설치판에서 소셜 버튼 숨김 | S |
| 메일 | 구현됨(고객 서버 가능) | SMTP_* env · 워크스페이스 IMAP/SMTP · 기본 주소 `help@planq.kr` 고정(`emailService.js:87`) | 주소·브랜드 env/DB | S |
| AI(Cue) | 끊기면 저하 | `services/llm.js` 한 곳 · `OPENAI_API_BASE` 교체 가능 · 실패 시 대체 응답 | 고객 사내 LLM 연결 검증(OpenAI 호환일 때 — 추정) | M |
| 회의 받아쓰기(Q Note) | 끊기면 멈춤 | `q-note/services/deepgram_service.py` 고정 · 데이터는 SQLite | 끄기 스위치 / 나중에 STT 어댑터 | M |
| 앱 푸시 | 끊기면 멈춤 | PlanQ FCM/APNs 키 · 웹 푸시(VAPID)는 자체 발급 가능 | 중앙 중계 또는 키 제공 결정 | M~L |
| 결제·플랜 | SaaS 가정 | 14일 체험→무료·500MB(`trial.js`·`config/plans.js`) · 면제 분기 `services/plan.js` | 설치판 스위치 + 라이선스 파일 | M, 2~3일(+라이선스 1주) |
| 외부 연결 기타 | 끊기면 저하 | 카카오·구글 지도 · Google Fonts(`index.html`) · 마케팅 태그 | 폰트 동봉·태그 끄기 | S |
| 로그 수집 | 해당 없음 | Sentry 등 없음, PM2 로그 | 진단 묶음(ONPREM_DESIGN §3.4) | M |
| 주소 하드코딩 | 부분 구현 | 백엔드 `planq.kr` 146줄(9월 116) · **`APP_URL \|\| 'https://dev.planq.kr'` 65곳** · 고정: `ogMeta.js` · `notification_link.js:68` · `followupRules.js:32` | 모두 APP_URL 로 · 없으면 기동 거부 · 증가 방지 검사 | M, 2~3일 · **지금 SaaS 에도 위험** |
| CORS·쿠키·CSP | 구현됨 | `ALLOWED_ORIGINS` env · 쿠키 domain 없음 | 사내망 http 접속 시 secure 쿠키 확인(추정) | S |
| 사내망·VPN 웹 | 가능 | 프론트 상대경로 `/api` · 소켓 `window.location.origin` | 정리만 | S |
| 폰·태블릿 앱 | 빌드 때 고정 | `capacitor.config.ts` server.url · 유니버설 링크 도메인 고정 | 서버 고르는 화면 또는 고객별 빌드 | L, 1~2주 (첫 파일럿 제외) |
| 데스크탑 앱 | 빌드 때 고정 | `desktop/src/main.js:20-28` origin.json · 자동 업데이트도 그 주소 | 고객별 빌드 또는 주소 설정 | M, 2~3일 |
| 첫 관리자·가입 정책 | 미구현 | 관리자 지정은 `scripts/create-test-accounts.js` 뿐 | 첫 관리자·워크스페이스 만들기 + 공개 가입 막기 | S~M, 1~2일 |
| 업데이트·롤백 | 부분 구현 | `deploy-planq.sh` 우리 운영 서버 전용 · 롤백은 문서만 · 점검 모드 `middleware/maintenance.js` 있음 | 고객 서버용 update(백업→교체→마이그레이션→헬스→실패 시 자동 되돌림) | M~L, 4~6일 |
| 백업·복구 | 부분 구현 | 운영 스크립트는 DB 만 | DB + uploads + qnote.db + .env 함께, 복구 리허설 | M, 2~3일 |
| SaaS 와 같은 코드 | 가능 | env 위주 · `PLATFORM_*` env 있음 · 상위 «설치판» 스위치 없음 | 스위치 하나로 묶어 끄기 + 설치판 버전 가지 | M |

## Fable 판정 (decision, 2026-11-26)
- **순서는 맞다.** 고칠 것: «운영 중 고객이 흐름을 바꾼다» 는 지금 절반만 참 — 팔 때 그 선을 말한다. 설치형은 «검토만» 이 아니라 작은 일 하나를 지금 한다.
- **A 지금 팔 수 있는 범위(개발 0, 설정 서비스)**: 사건 종류별 프로젝트 템플릿 · Q docs 표 설문 접수(사건 만들기는 사람이 템플릿으로) · 메뉴 권한 · 업무별 컨펌자 수동 · 메일 발신 이름 · 공개 회사 페이지.
  **팔면 안 되는 말**: 단계 이름 마음대로 · 접수되면 자동 업무 생성 · 자동 승인자 · 우리 회사 주소/로그인 화면/우리 메일 주소로 발송.
- **단계 설계 = (b)** 업무 상태 10개는 그대로, 그 위에 회사별 «처리 단계» 층(사건이 현재 단계를 가짐 · 단계마다 템플릿 업무 묶음 · 지운 단계의 사건은 «없어진 단계» 로 보임). (a) 이름 바꾸기는 사건 단계를 못 담고, (c) 맞춤 상태는 컨펌·배지·통계·AI 생명선을 다시 쓰는 일이라 하지 않는다. 기존 ProjectStage 와 합칠지는 설계에서.
- **A 만드는 순서**: ① 접수 응답 → 사건·업무 자동 생성(1~2주) ② 처리 단계 층(첫 유료 고객 요구 듣고 설계) ③ 자동 컨펌자 ④ 로그인 화면 브랜딩 ⑤ 사용자 정의 필드 ⑥ 회사 메일 주소 발송 ⑦ 고객사 도메인(맨 뒤).
- **B 0단계는 일부만 지금**: 첫째 **APP_URL 폴백 65곳 + 증가 방지 검사**(지금 SaaS 사고 위험 · 며칠 · 기계 판정 · 브랜딩·도메인의 바탕). 둘째 마이그레이션 원장화(별도 설계·검증). 감사 로그·기능 스위치는 대기(민감 정보 고객 계약 시 감사 로그 앞당김). 9월 «넷 다 지금» 권고는 거둔다.
- **B 유료 파일럿 전 참이어야 할 것**: ① 인터넷 끊은 시험 서버에서 로그인→접수→업무→첨부 올리고 받기→재시작 후 유지 실측 ② 설치판 스위치(체험·강등·결제 꺼짐·공개 가입 막힘·첫 관리자) ③ 링크·메일이 고객 주소·고객 메일 서버로 ④ 첨부 포함 백업 + 복구 리허설 ⑤ 업데이트 원장 + 라이선스 파일 ⑥ 계약서에 «웹 전용·빠지는 기능» + 서명된 의향서.
  작업량: «한 번 돌아가게» 15~20일 · 돈 받는 파일럿 6주 안팎 · 정식 상품 8~10주(9월 유지). 문의가 오면 전용 클라우드(우리가 운영)를 먼저 제안.
- **데스크탑 앱**: 지금 고객 전체에 다운로드 안내하지 않는다(무서명 1.1.0 = «알 수 없는 게시자» 경고 · 1.2.0 설치본 없음). 오늘 안내할 것은 PWA 설치. 친한 고객 1~2곳만 경고를 미리 설명하고 시험판 직접 링크 허용.
- VERDICT: 지금은 기존 기능으로 «설정 서비스» 를 팔고, 개발은 ①접수→자동 생성 ②상태는 그대로 둔 처리 단계 층(b), 설치형은 «주소 하드코딩 65곳 + 증가 방지 검사» 하나만 지금, 나머지는 의향서 뒤, 데스크탑 앱은 서명 전까지 PWA 로 안내.
