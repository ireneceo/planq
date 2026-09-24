# PlanQ 온프렘(고객 서버 설치) 서비스 — 기획·설계

> 작성 2026-09-24 · [Fable] · Irene 지시:
> *"우리가 고객 서버에 플랜큐를 세팅해주고 업데이트만 보내주면서 고객이 계속 사용할 수 있을까?
> 대기업들이나 정부기업은 이런 클라우드 서비스 안쓰려고 해서"* → *"서버 자체를 고객이 자기가 관리할건데?"*
>
> 모델: **고객 소유 서버에 우리가 설치 → 이후 운영은 고객 → 업데이트는 우리가 보낸다.**
> «전용 클라우드»(우리가 운영하는 단일 테넌트)는 이 문서의 대상이 아니다(§7 에서 한 번만 비교한다).
>
> 표기: 「사실」은 `파일:행` 근거를 단다. 「추측」은 그렇게 적는다. 없는 것은 「없음(grep 0건)」.
> 코드는 한 줄도 바꾸지 않았다(Q file 작업이 같은 저장소에서 진행 중).

---

## 0. 한 줄 결론

**지금은 팔지 않는다. 다만 «계약 없이도 SaaS 에 이득인 4가지»(§4 0단계)는 지금 한다.**
첫 고객은 서명된 LOI(또는 구체 RFP) 가 들어온 뒤 §4 1단계를 8~10주로 잡는다.
AI 를 뺀 PlanQ 는 **«협업 OS» 로는 팔리지만 «PlanQ» 로는 안 팔린다** — 그래서 온프렘판의 AI 는
«없음» 이 아니라 **«고객 사내 LLM 연결(OpenAI 호환 엔드포인트)»** 로 판다(§2.3).

---

## 1. 상품 정의 — 무엇을 파는가

**셋을 따로 판다. 하나로 뭉치면 «구축비 한 번 내고 영원히 쓰는» 계약이 된다.**

| 상품 | 내용 | 과금 |
|---|---|---|
| ① **소프트웨어 사용권** | 서명된 라이선스 파일(§3.2). 좌석 수·기능·기간을 담는다 | **연 단위** 구독 |
| ② **초기 구축 서비스** | 설치 번들 반입·설치·초기 설정·관리자 교육·인수 검사 | 1회 구축비 |
| ③ **연간 유지보수** | 업데이트 번들 제공(§3.3)·진단 번들 기반 원격 지원(§3.4)·보안 패치 | ①의 비율(§6) |

### 계약서에 쓸 수 있는 경계 문장

**우리(워프로랩)가 하는 것**
- 설치 번들(컨테이너 이미지·설정 템플릿·설치 스크립트)과 설치 가이드를 제공하고, 최초 1회 설치를 고객 인프라에서 수행한다.
- 유지보수 기간 동안 업데이트 번들을 분기 1회 이상 제공하고, 보안 결함은 인지 후 10영업일 이내 패치 번들을 제공한다.
- 고객이 제출한 **진단 번들**(§3.4)을 근거로 결함을 분석·수정한다. 원격 접속은 하지 않는다(고객이 별도 서면으로 허용한 경우만 예외).
- 지원 대상 버전은 **현재 배포 버전과 그 직전 메이저(N-1)** 이다. 그보다 오래된 버전의 결함은 업데이트 적용을 먼저 요구한다.

**고객이 하는 것**
- 서버·OS·네트워크·TLS 인증서·DNS·방화벽·백업 저장소를 준비하고 운영한다(사양은 설치 가이드 §A 에 명시).
- 업데이트 번들의 반입 심사·적용 시점 결정·적용 실행·적용 전 백업을 수행한다(스크립트는 우리가 제공).
- 데이터베이스·파일 저장소의 **정기 백업과 복구 훈련**을 수행한다. 데이터 유실은 백업 부재 시 우리 책임 밖이다.
- 플랫폼 관리자 계정을 보유하고 사용자·워크스페이스를 관리한다.

**둘 다 아닌 것 (계약서에 명시적으로 «제외»)**
- 고객 사내 시스템(SSO IdP·메일 서버·LLM/STT 서버·오브젝트 스토리지) 자체의 장애.
- 고객이 코드를 수정한 뒤 생긴 결함(수정 즉시 지원 종료 — 라이선스 조항).
- 운영체제·미들웨어 취약점.

---

## 2. 온프렘판의 기능 범위

### 2.1 판정 기준
- **폐쇄망을 기본 전제**로 한다(정부·대기업 — 인터넷 아웃바운드 없음). 아웃바운드가 열린 고객은 «옵션 ON» 이지 다른 제품이 아니다.
- 「빠진다」 = 서버가 외부 호스트에 닿아야만 동작하는 것. 실측 아웃바운드 호스트(소스만, node_modules 제외):
  `www.googleapis.com`(19) · `mail.google.com` · `appleid.apple.com` · `fcm.googleapis.com` · `api.push.apple.com` ·
  `api.openai.com` · `api.deepgram.com`(REST+WSS, `q-note/services/deepgram_service.py:12`) · `fonts.googleapis.com`.

### 2.2 표 — 남는 것 / 빠지는 것 / 화면이 말해야 하는 것

| 영역 | 온프렘 기본 | 근거 | 화면이 말하는 것(빠질 때) |
|---|---|---|---|
| Q Talk 대화·파일·실시간 | **남는다** | socket.io 자체, 외부 의존 0 | — |
| Q Task 전체(워크플로·컨펌·반복) | **남는다** | 외부 의존 0 | — |
| Q docs·표·서명(내부 서명·공개 서명 링크) | **남는다** | `signature_internal.js`·`signedDocument.js` 자체 | 공개 서명 링크는 «사내망에서만 열립니다» |
| Q File(로컬 저장) | **남는다** | `File.storage_provider ENUM('planq','gdrive','s3')` `models/File.js:62` — S3 호환(MinIO) 경로 이미 있음 | — |
| Q Bill 청구서·PDF·회차·증빙 마킹 | **남는다** | PDF 는 로컬 puppeteer `services/pdfService.js:23` | 결제 링크(Stripe)는 «이 설치에서는 지원하지 않습니다» |
| Q Mail(IMAP/SMTP) | **남는다(사내 메일서버)** | 계정별 host 가 DB 컬럼 `models/EmailAccount.js:37,45` | Gmail OAuth 버튼 숨김 |
| 캘린더(내부 일정·RSVP) | **남는다** | — | Google 캘린더 동기화 토글 숨김 |
| 조직·출퇴근·휴가·인사이트·보고서 | **남는다** | — | AI 서술 요약(`reportNarrative.js`)만 «AI 연결 안 됨» |
| Q info·KB 검색 | **남는다(FTS 만)** | `kb_service.js:5` "OPENAI_API_KEY 없을 때는 FTS only" | 검색창 아래 «의미 검색 꺼짐 — 키워드 검색만» |
| 감사 로그·데이터 내보내기·API 토큰·MCP 읽기 서버 | **남는다** | `routes/export.js` · `routes/api_tokens.js` · `mcp/server.js` | — |
| 알림(인앱·메일) | **남는다** | — | — |
| **Cue·AI 전부**(요약·번역·업무추출·AI 문서·시간예측·자료정리) | **옵션 — 고객 LLM 연결 시 ON** | 게이트웨이 **한 곳** `services/llm.js:17` `OPENAI_API_BASE`, 모델은 `LLM_MODEL_<PURPOSE>` env(`:132`) → OpenAI 호환 사내 엔드포인트(vLLM·Azure OpenAI·HyperCLOVA 호환 게이트웨이)면 **코드 무변경**. Q Note 도 `openai` SDK 라 `OPENAI_BASE_URL` 로 따라온다(`q-note/services/llm_service.py:23-25`) | ★ **지금은 화면이 아무 말도 안 한다** — `cue.js:159` 는 «점검 중입니다» 라는 **거짓 문구**, `translation_service.js:163` 은 조용히 `fallback:true`, 프론트에 `llm_disabled` 처리 **0건(grep)**. 온프렘 전에 «이 설치에는 AI 가 연결되지 않았습니다 — 관리자에게 문의» 로 바꿔야 한다 |
| **Q Note STT(실시간·업로드)** | **빠진다** | Deepgram URL 고정 `deepgram_service.py:12`·`deepgram_prerecorded.py:23`, 제공자 추상화 없음(whisper grep 0건) | 녹음 버튼 비활성 + «음성 인식 엔진이 연결되지 않았습니다». 메모·문서 업로드·답변 찾기(LLM 연결 시)는 남는다 |
| Q Note 화자 식별 | 남는다 | `resemblyzer/pretrained.pt` 가 venv 안에 동봉(다운로드 없음) | — |
| Google 연동(Drive·Calendar·Gmail·로그인)·Apple 로그인 | **빠진다** | 전부 외부 OAuth | 설정 «파일·외부 연동» 화면에서 항목 자체를 숨긴다(비활성 버튼 X) |
| 웹푸시·네이티브 푸시 | **빠진다(폐쇄망)** | FCM/APNs 는 인터넷. VAPID 미설정 시 이미 비활성 `push_service.js:40` | 알림 설정에서 푸시 열 숨김 + «브라우저 푸시는 이 설치에서 지원하지 않습니다» |
| 게스트 링크(무로그인) | **기본 OFF** | 사내망에서만 열려 «외부 고객에게 링크» 라는 뜻이 사라진다 | 버튼 숨김. 고객이 켜면(옵션) 그대로 |
| 랜딩·요금제·블로그·Q위키 공개·SEO 생성·방문 집계 | **빠진다** | `server.js:601,626` 부팅 때 SEO 산출 — 온프렘에선 돌면 안 된다 | `/` 는 바로 로그인으로 |
| 플랜·결제·체험·애드온·Stripe·PortOne | **빠진다 → 라이선스로 대체(§3.2)** | `plan.can()` 단일 술어 `services/plan.js:256` | 설정 > 플랜 화면 자체를 «라이선스» 화면으로 교체 |
| 앱스토어 앱(iOS/Android) | **빠진다** | `capacitor.config.ts:10` server.url 고정 — 고객마다 다른 주소로 스토어 앱을 낼 수 없다 | PWA 설치 안내로 대체 |
| Q위키 스크린샷 자동 캡처 | 빠진다 | `wikiScreenshot.js` 가 planq.kr 을 연다 | 관리자 전용 — 화면 문구 불필요 |

### 2.3 ★ AI 를 뺀 PlanQ 가 팔리는가 — 판단

**«협업 OS» 로는 팔린다. «PlanQ» 로는 안 팔린다.**

- 남는 것만 세어도 Q Talk·Task·docs·File·Bill·Mail·캘린더·조직·감사 — 그룹웨어 한 벌이다. AI 를 부르는 라우트는
  `cue.js`·`kb.js`·`task_estimations.js`·`voice.js` 넷 + 메일/문서/보고서 안의 AI 버튼이다(`docs/AI_FEATURE_AUDIT.md` A~E 22항목).
  구조적으로 AI 는 **얹힌 층**이지 뼈대가 아니다. 이건 좋은 소식이다.
- 그러나 우리가 랜딩·요금제에서 파는 차별점은 Cue(AI 팀원)·Q Note 회의 요약이다. 그것을 빼면 대기업·정부 담당자는
  **이미 있는 그룹웨어(사내 메신저·전자결재)와 가격으로 비교**한다. 거기서 이길 근거가 없다. (추측 — 실제 RFP 를 본 적이 없다.)
- **그래서 결론은 «AI 없음» 이 아니라 «AI 는 고객 것을 쓴다»** 다. 대기업·정부는 2026년 현재 사내 LLM(자체 vLLM·국산 LLM 온프렘·
  Azure OpenAI 국내 리전) 을 갖추는 추세(추측)이고, 우리 LLM 층은 이미 **엔드포인트 하나 갈아끼우면 된다**(`llm.js:17`).
  세일즈 문장: *"PlanQ 는 귀사의 LLM 을 씁니다. 데이터가 귀사 밖으로 나가지 않습니다."* — 이것이 온프렘에서 오히려 강점이 된다.
- **Q Note 만은 STT 가 곧 제품이다.** STT 없는 Q Note 는 메모장이고 그건 팔 수 없다. Deepgram 은 self-hosted 제품을 판다
  (엔터프라이즈 계약 — 추측, 가격 미확인) — 고객이 그것을 사거나, 우리가 **STT 어댑터**(§4 2단계)를 만들어 사내 whisper/국산 STT 를
  붙일 때만 Q Note 를 판다. 그 전엔 **견적서에서 Q Note 를 뺀다.** 넣고 «회의 요약 됩니다» 하면 «녹음 버튼 눌러도 아무 일 없음» 신고가 된다.

---

## 3. 아키텍처 결정 4가지

### 3.1 ⒜ 배포 형태 — **Docker Compose. 네이티브 설치는 별도 견적.**

**근거(사실)**
- 폐쇄망에서는 `npm ci`·`pip install` 자체가 안 된다. 그런데 우리 의존성은 설치 시점에 바이너리를 **내려받는다**:
  puppeteer 크롬 `~/.cache/puppeteer` **1.9GB**, `sharp` 네이티브(`node_modules/@img/sharp-linux-x64`), torch CPU 휠(`q-note/requirements.txt` 주석 — 별도 index-url).
  실측 크기: `node_modules` 500MB · `q-note/venv` 1.5GB · 프론트 빌드 12MB.
- 런타임 버전이 **우리 안에서도 어긋나 있다** — 절차서는 Node 18 / Python 3.10(`scripts/PROD_SETUP_BRIEF.md:9`), dev 실서버는 Node **20.20** / Python **3.12.3**.
  고객 IT 에게 «맞춰 주세요» 라고 할 매트릭스가 우리에게 없다. 이미지로 박으면 그 문제가 사라진다.
- 저장소에 Docker 파일 **없음(find 0건)**. 즉 이미지화는 신규 작업이다(1단계 최대 항목).

**구성(제안)**
```
planq-backend   (Node 20, server.js + mcp/server.js 선택)      ← 이미지
planq-qnote     (Python 3.12 + torch CPU + resemblyzer 가중치)  ← 이미지 (STT 어댑터는 env 로)
planq-web       (nginx + 프론트 빌드, TLS 종단은 고객 LB 또는 여기)  ← 이미지
mysql 8         (고객이 자기 DB 를 쓰면 이 서비스만 뺀다 — 정부기관은 DB 를 자기 것으로 쓰려 한다)
minio           (선택 — storage_provider='s3' 경로 재사용, 없으면 로컬 볼륨)
```
볼륨 셋: `mysql-data` · `uploads`(`/uploads/{business_id}/{yyyy-mm}`) · `qnote-data`(**SQLite** `q-note/data/qnote.db` — Q Note 원장은 MySQL 이 아니다 `q-note/services/database.py:4`).
**★ 백업 대상이 셋**이다. 지금 백업 스크립트는 `mysqldump` 하나뿐(`scripts/backup-planq-prod-db.sh:34`) — 온프렘 백업 스크립트는 셋을 한 번에 묶는다.

**네이티브 설치를 완전히 닫지 않는 이유** — 일부 정부기관·금융권은 컨테이너 런타임 반입을 막는다(추측, 사례 다수 보고됨).
그 경우 «오프라인 tarball(node_modules·venv·크롬 동봉) + systemd» 로 가되 **구축비를 2배**로 받는다. 검증 매트릭스가 두 배가 된다.

### 3.2 ⒝ 라이선스 — **서명 파일, 오프라인 검증, 만료 시 «읽기 전용» 강등**

**현재 상태(사실)** — `license`·`activation` 코드 **0건(grep)**. 플랜 한도는 전부 `businesses`/`subscriptions` 컬럼에서 나오고(`services/plan.js:38-45`),
온프렘에서는 고객이 그 DB 의 주인이므로 **아무 한도도 없다 = 좌석 계약이 성립하지 않는다.**

**설계**
- 파일: `license.json` + 분리 서명(Ed25519). **우리 개인키로 서명, 공개키는 코드에 상수로 내장.** 폐쇄망이라 온라인 활성화 없음.
- 담는 것: `license_id` · `customer` · `issued_at` · `expires_at` · `seats`(사용자 수 상한) · `workspaces_max` · `features{ai, stt, sso, guest_link, push}` ·
  `grace_days`(기본 30) · `support_until`(유지보수 종료 — 만료와 별개, 업데이트 번들 적용 가능 여부를 가른다).
- **검증 지점은 한 곳** — `services/plan.js getBusinessPlan()` 의 면제 분기(`:52-71`)와 같은 자리. `ONPREM_MODE=1` 이면 subscriptions 를 보지 않고
  라이선스를 «플랜» 으로 돌려준다. 그러면 `plan.can()` 을 쓰는 모든 게이트(업로드·멤버·Cue)가 **무변경**으로 따라온다.
  `docs/BILLING_EXEMPTION_DESIGN.md` 불변식 1·2 와 같은 논리 — 라우트마다 따로 판정하면 반드시 갈라진다.
- **좌석 판정**: `users` 활성 계정 수 ≤ `seats`. 초과하면 **새 초대만** 막는다(기존 사용자 로그인은 막지 않는다).
- **만료 시 무슨 일이 일어나는가** — 삭제·잠금 **금지**. 정부·대기업 계약에서 «데이터 인질» 조항은 그 자체로 탈락 사유다.
  1. `expires_at` 도달 → 관리자 배너 «라이선스가 N일 전 만료 — 유예 30일».
  2. 유예 종료 → **읽기 전용**: 로그인·조회·검색·**데이터 내보내기(`routes/export.js`)** 는 되고, 쓰기(POST/PUT/PATCH/DELETE)는 403 `license_expired`.
     화면은 모든 저장 버튼에 같은 문구를 단다. 내보내기를 열어 두는 것이 «인질이 아니다» 의 증명이다.
  3. 새 라이선스 파일을 올리면 즉시 복귀(재시작 불필요 — 파일 mtime 폴링 또는 관리자 화면 업로드).
- **시계 되돌리기 방어**: 서버가 본 최대 시각을 DB `platform_settings.license_last_seen_at` 에 단조 기록. 현재 시각이 그보다 24h 이상 뒤면 **경고 로그 + 관리자 배너**만. 막지 않는다(오탐이 곧 서비스 중단이다).
- 라이선스에 **고객 데이터는 한 글자도** 들어가지 않는다. 우리 쪽 원장은 `license_id` 하나면 된다.

### 3.3 ⒞ 업데이트 전달 — **pull 도 push 도 아니다. «우리가 만든 서명 번들을 고객이 반입한다».**

폐쇄망에서는 서버가 우리에게 못 오고(pull 불가) 우리도 서버에 못 간다(push 불가 — 지금 배포는 `deploy-planq.sh:31` 이 우리 운영 호스트로 rsync 다).
남는 길은 **파일 반입**뿐이고, 정부·대기업은 어차피 반입 심사(망연계·USB 반입 절차)를 거친다. 이것을 제품의 일부로 만든다.

**번들 내용** `planq-update-<version>.tar` = 이미지 3개(tar) + `migrations/`(순서 목록) + `RELEASE_NOTES.md`(ko/en) + `manifest.json`(버전·체크섬·**최소 이전 버전**) + 서명.

**적용 스크립트 `planq-update apply <bundle>`** — 순서를 우리 배포 스크립트에서 그대로 가져온다:
1. 서명·체크섬·`min_from_version` 검사(건너뛰기 금지 — N-1 지원 정책과 같은 줄).
2. **사전 백업**(`deploy-planq.sh create_backup` `:209-234` 와 같은 내용 — .env·DB dump·uploads 는 스냅샷 아님 — 이걸 셋으로 확장).
3. 점검 모드 ON — 이미 있다 `middleware/maintenance.js`(platform_admin 외 503).
4. 이미지 교체 → **마이그레이션 실행** → 헬스체크(§3.4 의 로컬 검사) → 점검 모드 OFF.
5. 어느 단계든 실패하면 이미지 태그 되돌리기 + DB dump 복원 **자동**. 사람이 «롤백은 코드만» 을 기억할 필요가 없게.

**★ 전제 — 마이그레이션 원장이 없다.** 지금 마이그레이션은 `deploy-planq.sh:271-490` 에 **인라인으로 하드코딩**돼 있다(`migrate-*.js` 48개를 줄마다 호출).
이것은 번들에 못 실린다. 그리고 `sync-database.js` 는 `alter:true`(`:37`) 다 — **고객 DB 에 절대 돌리지 않는다**(memory `feedback_sync_drops_columns_not_in_model`: 모델 밖 컬럼을 DROP 한다).
→ 0단계에서 `dev-backend/migrations/NNNN-*.js` + `schema_migrations` 적용 기록 테이블로 옮긴다. **SaaS 배포도 같은 원장을 쓴다** — 그래야 dev 에서 검증한 순서가 곧 고객 순서다.
검증은 이미 있는 `scripts/dump-schema.js` + `schema-snapshot.json`(136 테이블) 으로 «적용 후 스키마 == 기대 스키마» 를 기계가 판정한다.

**릴리스 주기** — SaaS 는 하루 여러 번 배포하지만 온프렘은 **분기 1회 + 보안 패치**로 잡는다. 고객이 반입 심사를 매번 하기 때문이다.
그래서 온프렘판은 **버전 브랜치**(`onprem/2026.4`)를 따고 거기에만 체리픽한다. main 을 그대로 주면 «오늘 dev 에 넣은 것» 이 고객에게 간다.

### 3.4 ⒟ 진단·지원 — **원격 접속 없이. 진단 번들 + 로컬 헬스체크.**

**설계 근거(오늘 실사례)** — 운영 신고를 추적하려고 운영 DB 를 직독했는데 `file_folders` 감사 로그가 **0건**이라 파일 `updated_at` 으로 역추적했다.
고객 서버였다면 **답을 못 했다.** 온프렘의 전제는 «원장이 스스로 말한다» 이고, 그 원장을 **비밀 없이** 반출할 수 있어야 한다.

**진단 번들 `planq-support-bundle`** (고객이 실행 → zip → 우리에게 전달)

| 담는 것 | 왜 |
|---|---|
| 버전·커밋·라이선스 id·이미지 다이제스트 | «어느 코드인가» 부터 |
| 컨테이너 상태·재시작 횟수·리소스(CPU/메모리/디스크) | `prod-diagnose.sh` 의 1~3절이 이미 이것 |
| 최근 7일 앱 로그 — **비밀 마스킹 후**(토큰·비밀번호·이메일 주소·본문) | 스택트레이스가 곧 답이다 |
| 로컬 헬스체크 결과(§아래) | 기계 판정 |
| **스키마 스냅샷**(`dump-schema.js`) — 기대 스냅샷과의 diff | dev↔고객 스키마 어긋남은 dev 검증을 전부 통과한다(memory `feedback_dev_cannot_reproduce_prod_schema`) |
| 테이블별 row count · 워크스페이스 수 · 사용자 수 | 규모 |
| **감사 로그 메타만** — `action`·`target_type`·`target_id`·`user_id`·`created_at`. **`old_value`/`new_value` 제외** | 오늘 사례 — «누가 언제 어느 폴더를 지웠나» 는 메타로 답이 나온다. 값은 고객 데이터다 |
| 설정 **키 목록**(값 제외) + 기능 스위치 상태 | «푸시 꺼짐» 이 설정인지 고장인지 |

**절대 담지 않는 것** — `.env` 값 · DB 덤프 · 메시지/문서/파일 본문 · 메일 본문·주소 · 첨부 · 사용자 PII(이름·이메일·IP) · 라이선스 파일 자체.
번들 생성 스크립트는 **화이트리스트**로 만든다(memory `feedback_mask_by_whitelist_not_denylist`) — 담을 것을 열거하지 «뺄 것» 을 열거하지 않는다.

**로컬 헬스체크** — `scripts/health-check.js`(45항목·15카테고리)를 그대로 줄 수 없다: 로그인 계정 `health-check@planq.kr` 을 **만든다**(`:92-97`) — 고객 DB 에 테스트 워크스페이스가 생긴다.
온프렘용은 **무인증·읽기 전용** 부분집합(infra·frontend·realtime·retention·secrets)만 떼어 `--onprem` 모드로 돌린다.

**지원 채널** — 이메일 + 진단 번들. 화상 지원은 «고객이 화면을 공유» 하는 형태만. 우리가 접속하는 원격 데스크탑은 계약 기본에서 뺀다(§6 «받지 말아야 할 조건»).

---

## 4. 단계 계획

### 0단계 — **계약 없이 지금 한다** (SaaS 운영에도 이득이라서)

| # | 작업 | «끝났다» 판정 |
|---|---|---|
| 0-1 | **마이그레이션 원장화** — `deploy-planq.sh:271-490` 인라인 호출을 `migrations/` + `schema_migrations` 로. SaaS 배포도 이걸 쓴다 | 새 dev DB 에 `migrations` 만 돌려 `dump-schema.js` 결과 == `schema-snapshot.json`. `sync-database.js` 를 배포에서 제거 |
| 0-2 | **감사 로그 구멍 메우기**(§5.1) — 로그인·메시지 삭제·조직·출퇴근·외부연결 등 | §5.1 표의 파일 전부 감사 호출 ≥ 1 + 가드 `--category=audit`(mutating route 에 감사 호출 없으면 래칫 실패) |
| 0-3 | **기능 스위치 + 화면 문구** — `GET /api/platform/capabilities {ai, stt, google, push, guest_link, billing, landing}` 한 곳. 화면은 이것만 읽는다. 각 기능의 «꺼짐» 문구 ko/en | 키를 하나씩 빼고 로그인해 그 기능의 버튼이 **숨거나 이유를 말하는지** 3폭에서 실측. `cue.js:159` «점검 중» 거짓 문구 제거 |
| 0-4 | **도메인·브랜드 하드코딩 제거** — 백엔드 `planq.kr` 116곳(`invoices.js` 13·`emailService.js` 11·`ogMeta.js` 11·`security.js` 6…), 프론트 15파일. `APP_URL`/`PLATFORM_*` env 는 이미 있다(`.env.production.example`) — **쓰는 곳이 안 쓸 뿐** | `grep -rn "planq\.kr" dev-backend --include=*.js \| grep -v node_modules \| grep -v scripts` == 0. `ALLOWED_ORIGINS`·CSP `security.js:134-139` 가 env 에서 나온다 |

0단계는 **Fable 게이트 R=1** 항목(마이그레이션 원장·감사 로그)이다 — 각각 한 번씩 올린다.

### 1단계 — **첫 LOI/RFP 이후** (8~10주 · lua + AI · 추정)

| # | 작업 | «끝났다» 판정 |
|---|---|---|
| 1-1 | 라이선스(§3.2) — 발급 CLI(우리) · 검증 서비스 · 관리자 화면 «라이선스» · 읽기전용 강등 | 만료 파일로 부팅 → 조회 200·쓰기 403 `license_expired`·내보내기 200. 새 파일 업로드 → 즉시 쓰기 200. **시계를 뒤로 돌린 대조군**은 경고만 |
| 1-2 | Docker 이미지 3종 + compose + 볼륨 + 오프라인 번들 스크립트 | **인터넷 끊은 VM** 에 번들만 넣어 설치 → 로그인 → Q Talk 메시지 왕복. 이미지 총 크기 실측 기록 |
| 1-3 | 설치 스크립트 `planq-install` + **고객 IT 용** 설치 가이드(ko/en) — 절차서 `PROD_SETUP_BRIEF.md` 를 «운영서버 Claude» 수신자에서 사람 수신자로 다시 쓴다. 첫 관리자 계정 생성 CLI(지금은 `create-test-accounts.js` 뿐 — 테스트 계정 스크립트라 줄 수 없다) | lua 가 아닌 사람(Irene)이 가이드만 보고 VM 에 설치 성공 |
| 1-4 | 업데이트 번들 + `planq-update apply`(§3.3) + 자동 롤백 | v(N)→v(N+1) 적용 성공 · **일부러 깨뜨린 마이그레이션**으로 자동 롤백 → v(N) 헬스 초록 |
| 1-5 | 진단 번들 + 온프렘 헬스체크(§3.4) | 번들 zip 을 열어 **이메일 주소·토큰·본문 0건**(정규식 대조군) · 감사 메타 포함 |
| 1-6 | 온프렘 백업/복구 스크립트(MySQL + uploads + qnote.db 셋) + 복구 리허설 문서 | 백업 → 빈 VM 복구 → 파일 열림·회의 메모 열림 |
| 1-7 | 온프렘 브랜치 `onprem/YYYY.Q` + 릴리스 노트 관례 | 첫 태그 |

### 2단계 — **계약 조건에 따라** (계약서에 «별도 견적» 으로)

| # | 작업 | 언제 |
|---|---|---|
| 2-1 | **SSO** — OIDC 먼저(Keycloak·Azure AD·Okta 가 다 된다), SAML 은 요구 시. LDAP 은 받지 않는다(비밀번호를 우리가 만진다). ★ 지금 없다(grep: saml/oidc/ldap 0건 — 히트는 전부 Google 파일). 그런데 **요금제 카탈로그는 이미 `enterprise.features.sso: true`** 라고 말한다(`config/plans.js:170`) — 팔기 전에 카탈로그를 고치거나 만들거나 둘 중 하나 | 대기업·정부는 거의 필수(추측 — 다수 RFP 관행). 첫 계약에 들어올 확률 높음 |
| 2-2 | **STT 어댑터** — `q-note/services/deepgram_*` 뒤에 provider 인터페이스(스트리밍·사전녹음 둘). 구현체: Deepgram self-hosted / whisper 서버 / 고객 STT | Q Note 를 견적에 넣는 순간 |
| 2-3 | LLM 연결 검증 키트 — 고객 엔드포인트에 `LLM_MODEL_*` 매핑 + 스모크 테스트(`llm.js` purpose 25종 중 필수 5종) | AI 옵션 계약 시 |
| 2-4 | 네이티브(비컨테이너) 설치 tarball | 컨테이너 반입 불가 고객 |
| 2-5 | 고객 S3 호환 스토리지 연결 검증(MinIO·NCP Object Storage) — `s3Storage.js` 경로 실측 | 파일 용량이 큰 고객 |

---

## 5. 팔기 전 반드시 메워야 할 구멍 (전수 — grep 근거)

### 5.1 감사 로그 — «원격 진단이 가능한 원장» 이 아직 아니다
집계: 라우트 파일 중 **변경 라우트가 있는데 감사 호출이 0건**인 파일 **30개**(두 헬퍼 `services/auditService.js` `logAudit/writeAudit` · `middleware/audit.js` `createAuditLog` 모두 포함해 셈).
온프렘에서 문제가 되는 순서로:

| 파일 | 변경 라우트 수 | 왜 문제인가 |
|---|---|---|
| `routes/auth.js` | 11 (감사 1 — `user.deletion_recover` 뿐 `:1103`) | **로그인 성공·실패가 감사 원장에 없다.** `users.last_login_at`(`models/User.js:99`) 과 `refresh_tokens.user_agent/ip_address`(`:32-33`) 로 흔적은 있지만 «누가 언제 어디서 실패했나» 는 없다. 정부·대기업 보안 감사 1번 항목이다 |
| `routes/conversations.js` | 메시지 **삭제** `:947` 감사 0 (수정 `:925` 은 있음) | 마스킹 삭제라 원문은 남지만 «누가 지웠나» 가 없다 |
| `routes/org.js` | 7 / 0 | 부서·팀·팀장 변경 — 조직 원장 |
| `routes/attendance.js` | 9 / 0 | 출퇴근 정정 — 노무 분쟁 원장 |
| `routes/external_connections.js`·`calendar_sync.js`·`mail_aliases.js`·`mail_rules.js` | 5·3·6·3 / 0 | 외부 연결·발신 별칭 — 보안 감사 대상 |
| `routes/push.js`·`notifications.js`·`task_attachments.js`·`message_attachments.js`·`share.js`·`invites.js`·`guest.js` | 각 1~5 / 0 | 첨부·공유·초대 — «누가 무엇을 내보냈나» |
| `routes/project_process.js`·`admin_wiki.js`·`qnote_bridge.js` 등 나머지 | — | 낮음 |
| `routes/projects.js` 48/4 · `email_threads.js` 37/2 · `tasks.js` 16/3 · `task_workflow.js` 15/1 | 비율 낮음 | task_workflow 는 `task_status_history` 별도 원장이 있어 일부 대체. projects·email_threads 는 확인 필요 |

**★ 더 나쁜 것 — 감사 로그가 지워진다.** `services/retentionPurge.js` 가 플랜의 `audit_log_retention_days`(free 30·starter 90 `config/plans.js:31,63`)로 **purge 한다**.
온프렘 라이선스는 `audit_log_retention_days: Infinity`(또는 고객 정책값)여야 한다. 라이선스가 플랜 자리를 대신하면(§3.2) 그 값도 라이선스가 준다.

가드: `node scripts/guard-invariants.js --category=audit` 신설 — mutating route 에 감사 호출이 없으면 래칫. 예외는 `// audit-exempt: <이유>`(autosave 가드와 같은 모양).

### 5.2 스키마 적용 방식
`sync-database.js` `alter:true`(`:37`) — 고객 DB 금지(§3.3). 마이그레이션 48개가 `deploy-planq.sh` 안에만 있다.

### 5.3 하드코딩
- `planq.kr` 백엔드 116곳·프론트 15파일(§4 0-4). `VAPID_SUBJECT=mailto:help@planq.kr` 은 `generate-prod-secrets.sh:31`.
- 타임존 `Asia/Seoul` **81곳**(cron·집계). 한국 고객이면 당장 문제는 없지만 env 하나로 모은다.
- 폰트 `fonts.googleapis.com`(`index.template.html:21-30`) — 폐쇄망에서 폰트가 안 떠 **전 화면 폴백 폰트**. 폰트 파일을 번들에 동봉한다.
- `security.js:134-139` CSP 에 `apis.google.com`·`fonts.gstatic.com` 고정, `connect-src https:` 전체 허용 — 온프렘은 `'self'` 로 조인다.

### 5.4 설치 절차서·시드
- `PROD_SETUP_BRIEF.md` 수신자가 «운영서버 Claude» 이고 «dev 서버 Claude 에 붙여넣으세요» 로 끝난다(`:244`). 입력 항목에 **우리 계좌**(`PLANQ_BILLING_BANK_*` `:69-71`)와 **우리 OpenAI·Deepgram 키**(`:72-73`)가 있다 — 고객에게 못 준다. (당신의 판단 3가지 전부 확인됨.)
- 첫 플랫폼 관리자 생성 스크립트 **없음** — `scripts/create-test-accounts.js` 만 있고 `admin@test.planq.kr` 을 만든다.
- 시드: `seed-wiki-content.js`(Q위키)·`setup-wiki-schema.js`·`platform_settings` 첫 행 — 설치 스크립트가 순서대로 돌려야 한다. 지금은 사람이 기억한다.

### 5.5 킬스위치·기본값
- `EMAIL_SENDING_ENABLED` 기본 **켜짐**(`emailSend.js:295`) — 온프렘 설치 직후 테스트 중 실제 사용자에게 메일이 나간다. 온프렘 기본은 **꺼짐 + 관리자가 SMTP 검증 후 켜기**.
- `FEATURE_DOC_CONFIRM`·`CUE_TOOLS_ENABLED`·`QMAIL_FORWARD_ENABLED` — 흩어진 env 스위치 3개. §4 0-3 의 capabilities 한 곳으로 모은다.

### 5.6 헬스체크 부작용
`scripts/health-check.js:92-97` 테스트 계정·워크스페이스를 만든다. 고객 DB 에 «Health Check Biz» 가 생긴다(§3.4).

### 5.7 카탈로그가 이미 거짓말한다
`config/plans.js:145-175` enterprise: `sso: true`·`sla: '99.9'`·`support: 'dedicated_manager'`. SSO 구현 0건, SLA 계약서 없음. 온프렘 견적서에 이 카탈로그를 그대로 쓰면 **계약 위반으로 시작**한다.

### 5.8 앱
스토어 앱은 `server.url` 고정(`capacitor.config.ts:10`) — 온프렘 고객은 못 쓴다. 견적서에 «모바일은 PWA» 로 명시. 푸시 없는 PWA 라는 것도 명시.

### 5.9 백업 범위
`backup-planq-prod-db.sh` 는 MySQL 만. uploads(dev 188MB)·`qnote.db`(dev 4.3MB) 는 안 잡는다. 온프렘 스크립트는 셋(§3.1).

### 5.10 우리가 못 보는 것 — 규모
운영 규모(워크스페이스·사용자·DB 크기)는 이 세션에서 **미측정**(운영 읽기 권한 거부). dev 실측: 29 워크스페이스·206 사용자·DB 355MB·audit_logs 9,592행·files 4,955행. 사양 권고(§부록)는 이 숫자 기준 추정이다.

---

## 6. 가격·계약 구조 제안

> 아래 숫자는 **업계 관행 기반 추측**이다. 첫 RFP 의 예산 항목을 보고 조정한다.

| 항목 | 제안 | 근거 |
|---|---|---|
| ① 사용권(연) | 좌석당 연 단가 × 좌석. SaaS Pro 연가 대비 **1.5~2배**(운영·인프라 비용이 고객 몫이지만 지원 원가가 SaaS 보다 높다) | 온프렘은 고객마다 환경이 달라 지원 1건 원가가 SaaS 의 몇 배다 |
| ② 구축비 | 1회 · 사용권 연액의 **50~100%** (네이티브 설치는 ×2) · 현장 2일 + 원격 3일 포함 | 1단계 산출물이 있어도 첫 3곳은 매번 새 문제가 난다 |
| ③ 유지보수(연) | 사용권 연액의 **20~25%** — 업데이트 번들 분기 1회 + 보안 패치 + 이메일 지원 5×8(KST) + 진단 번들 응답 2영업일 | 소프트웨어 유지보수 관행 18~25% |
| AI 옵션 | 사용권에 **+20~30%** (고객 LLM 연결 검증·모델 매핑·스모크 키트) | LLM 자체 비용은 고객 |
| STT 옵션(Q Note) | 어댑터 개발 후에만 — 별도 견적 | §2.3 |
| SSO 옵션 | 별도 견적(OIDC 표준가, SAML 가산) | §4 2-1 |
| 지원 버전 | **N-1** (현재 온프렘 릴리스 + 직전). N-2 는 «업데이트 후 지원» | 검증 매트릭스 상한 |

**받지 말아야 할 조건**
- **영구 라이선스**(perpetual) — 유지보수 없이 영원히 쓰는 계약. 2년 뒤 옛 버전 결함 지원 요구가 온다. 받아야 한다면 «유지보수 미갱신 시 업데이트·지원 없음» 을 라이선스 파일 `support_until` 로 기계가 지키게 한다.
- **소스코드 무상 에스크로 / 소스 납품** — 정부 과제는 요구한다. 받으면 «에스크로 기관 예치, 폐업·지원 중단 시에만 공개» 로 좁힌다. 소스 직접 납품은 거절.
- **24×7 SLA·상주·응답 1시간** — 인력이 1명이다. 5×8 + 2영업일 이상은 지금 못 지킨다.
- **원격 접속 기본 제공** — 진단 번들이 기본, 원격은 고객 서면 허용 + 세션별 감사(`admin.js impersonate` 와 같은 원리).
- **고객 인프라·DB·백업 장애 책임** — §1 경계 문장 그대로.
- **커스텀 기능 무상 포함** — «귀사 전용 결재선» 류. 별도 개발 견적 + 온프렘 브랜치에서만 유지(main 오염 금지).
- **AI 품질 보증** — 고객 LLM 을 쓰는 이상 답변 품질은 보증 대상이 아니다. «연결·동작» 만 보증한다.
- **동시 2곳 이상 구축** — 1단계가 끝나기 전엔 한 번에 한 고객.

---

## 7. 권고

**지금(운영 고객 소수 · 개발 인력 lua 1명 + AI) 온프렘을 시작하지 않는다. 조건부로 준비한다.**

근거
1. 코드에 라이선스가 0건이고 마이그레이션 원장이 없다. 이 둘이 없는 온프렘은 «구축비 받고 6개월 뒤 업데이트를 못 보내는 제품» 이 된다.
2. 지원 원가가 SaaS 와 다르다 — 오늘 운영 DB 직독 한 번으로 풀린 문제가 고객 서버에서는 **진단 번들 왕복 2~3회**다. 1명이 SaaS 운영과 온프렘 지원을 같이 못 한다.
3. 아직 «AI 없이도 사겠다» 는 고객이 한 명도 없다. §2.3 의 판단은 추측이다 — RFP 한 장이 이 문서의 절반을 바꾼다.

**그래도 지금 하는 것 (§4 0단계 — SaaS 에도 그대로 이득)**
- 마이그레이션 원장화 · 감사 로그 구멍 메우기 + 가드 · 기능 스위치/화면 문구 · 도메인 하드코딩 제거.
- 이 넷은 온프렘이 안 와도 운영 안정성과 감사 대응(개인정보·보안 점검)에 필요하다.

**시작 조건 (하나라도 충족되면 1단계 착수)**
- 서명된 LOI 또는 예산이 적힌 RFP 1건 — «온프렘이면 산다» 가 문서로 있을 것.
- 혹은 전용 클라우드(우리 운영·단일 테넌트·국내 리전)로 **먼저 계약이 성사된 고객이 «다음 단계는 온프렘»** 이라고 말할 것.

**세일즈에서의 순서** — 대기업·정부 문의가 오면 ①전용 클라우드(우리 운영, VPC 격리, 국내 리전, 고객 LLM 연결 가능)를 먼저 제안한다.
Irene 이 이미 «별건으로 이해했다» 고 한 그것이다 — 온프렘의 구멍(§5) 대부분이 전용 클라우드에서는 **구멍이 아니다**(우리가 DB 를 본다).
②«진짜 온프렘» 만 되는 고객에게 이 문서의 ①②③ 상품과 §6 조건으로 견적한다. 그때 1단계를 시작한다.

---

## 부록 A. 고객 서버 최소 사양 (추정 — §5.10 참고)

| 구분 | 최소 | 권고(사용자 ≤300) |
|---|---|---|
| CPU / RAM | 4 vCPU / 8GB | 8 vCPU / 16GB (Q Note STT·화자식별 torch 가 2GB `prod-ecosystem.config.js max_memory_restart '2G'`) |
| 디스크 | 50GB + 파일 저장소 | 이미지 ~4GB(추정: node_modules 0.5 + 크롬 1.9 + venv 1.5) + DB + uploads |
| OS | Ubuntu 22.04/24.04 LTS · Docker 24+ · Compose v2 | RHEL 계열은 검증 후(네이티브 설치 항목) |
| 네트워크 | 인바운드 443 · 아웃바운드 **없음** | 사내 SMTP/IMAP · 사내 LLM/STT 엔드포인트만 |

## 부록 B. 이 문서가 검증한 «먼저 조사한 사실» 대조

| 주장 | 판정 |
|---|---|
| 절차서 수신자가 «운영서버 Claude» | **맞다** `PROD_SETUP_BRIEF.md:3,244` |
| `planq.kr`·`VAPID_SUBJECT` 하드코딩 | **맞다** — 백엔드 116곳·프론트 15파일·`generate-prod-secrets.sh:31` |
| 입력 항목에 우리 계좌·OpenAI·Deepgram 키 | **맞다** `PROD_SETUP_BRIEF.md:69-73` |
| 라이선스 0건 | **맞다**(grep) |
| 플랜 판정 `plan.can()` 단일 술어 | **맞다** `services/plan.js:256` — 그리고 면제 분기 `:52-71` 이 라이선스가 들어갈 자리다 |
| SSO 없음 | **맞다** — 단 카탈로그는 `sso: true`(`plans.js:170`) — 추가 발견 |
| `prod-diagnose.sh` 가 7할 | **후하다** — 53줄, 환경 진단만. 앱 로그·스키마·감사 메타가 없어 **3할**로 본다 |
| 폐쇄망에서 꺼야 할 목록 | **맞다** + 추가: 랜딩 SEO 부팅 생성 `server.js:601,626`, 스토어 앱, Q위키 캡처, 폰트 CDN |
| AI 를 뺀 판단 | «없음» 이 아니라 «고객 LLM 연결» 로 — `llm.js:17` `OPENAI_API_BASE` 가 이미 있어 코드 무변경. STT 만 어댑터 신규 |
