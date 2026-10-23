# PlanQ 프로젝트 가이드라인

## 프로젝트 개요

**PlanQ** — B2B SaaS 업무 전용 고객 채팅 + 실행 구조 통합 OS
- 브랜드: Plan + Cue(실행 신호) + Queue(업무 정리)
- 슬로건 — 메인 "일을 일답게 하다, PlanQ" / 서브 "일이 일이되지 않게, PlanQ"
  (구 버전 "요청은 Queue로, 실행은 Cue로" 는 **폐기**. 정본은 memory `project_brand_concept`)
- 핵심 기능: Q Talk(대화), Q Task(할일), Q Note(음성/요약), Q File(자료), Q Bill(청구)

### 역할 체계
| 역할 | 설명 |
|------|------|
| Platform Admin | 플랫폼 전체 관리 |
| Business Owner | 사업자 — 구독 + 고객/팀/청구 관리 |
| Business Member | 사업자 소속 직원 |
| Client | 고객 — 초대 기반, 웹 링크 클릭으로 즉시 접속 |

### 개발팀
| 이름 | 역할 | 설명 |
|------|------|------|
| Irene | CEO / 기획자 | 요구사항 정의, 기능 승인, 최종 의사결정 |
| lua | Project Manager | 개발 진행 관리, 서버 접속 및 코드 수정, 배포 관리 |

**협업 규칙:**
- 같은 파일 동시 수정 시 충돌 가능 → 작업 전 `git pull`로 동기화
- 대규모 기능은 Irene 승인 후 진행
- 버그 수정/소규모 작업은 lua 판단으로 바로 진행 가능

### AI 협업 역할 분리

PlanQ에서 Claude Code와 Codex를 함께 사용할 때의 공통 프로토콜은
`docs/AI_COLLABORATION_PROTOCOL.md`를 따른다.

| 주체 | 책임 | 제한 |
|------|------|------|
| Fable | 공용 기준(`~/dev-server/FABLE.md`)의 일 — 설계·되돌리기 어려운 변경의 검증·계산·핵심 UX·검증 설계·원인 판정·큰 결정 권고 | 조사·실측·구현·기계로 갈리는 확인은 하지 않는다(작업 모델 몫) |
| Opus | 조사·실측 · Fable이 정한 설계의 핵심 구현 · 기계로 갈리는 자체 검증 | 설계 밖의 아키텍처·주요 클래스/서비스/DB 변경을 임의로 시작하지 않음 |
| Codex | 명확한 단순·반복 작업, 지정 명령 실행, 장시간 검사 대기, 자기 변경 검증 | 기존 코드 조사·기획·설계·아키텍처 결정·주요 클래스/서비스/DB 변경을 스스로 시작하지 않음 |

- Claude Code와 Codex는 자동 위임·연결하지 않는다.
- 한 번에 한 AI만 편집한다. 사용자가 Codex를 쓰는 세션에서는 Codex가 자기 작업을 직접 검증한다.
- 작업 전후 `git status`와 `git diff`를 확인하고, 다른 AI의 미커밋 변경을 덮어쓰지 않는다.
- 모호하거나 선택지가 있는 Codex 작업은 임의 결정하지 않고 사용자에게 구체적인 지시를 요청한다.
- 기록에는 실제 주체를 `[Claude Code]`, `[Opus]`, `[Codex]`, `[공동 검토]`로 표시한다.

---

## 작업 워크플로우 (최우선 규칙)

### 흐름 (UI-First → 즉시 실 API 연결)
**요구사항 정리 → 화면/UX 설계 → 기술 설계 → UI 구현 → 백엔드 연결 → 검증**

### 🚫 mock 데이터 절대 금지 (최상위 원칙)

**production 소스 코드 어디에도 mock 데이터를 남기지 않는다. 모든 화면은 실 API 데이터로 작동해야 한다.**

- `mockXxx`, `dummyData`, 하드코딩된 배열/객체로 화면 채우기 — 전부 금지
- "다음 sprint에서 실 API 연결" 같은 미루기 금지 — 작업이 끝나기 전에 반드시 실 API 교체
- 검증 단계에서 mock 잔존 1건이라도 있으면 = **검증 실패**. "완료" 보고 금지
- mock.ts 같은 모의 데이터 파일을 만들지 않는다. 필요하면 `__tests__/fixtures/` 안에 테스트 전용으로만
- 새 기능 개발 = 첫 커밋부터 실 API 호출. UI 검증과 백엔드 연결을 분리하지 않는다

### UI-First 원칙 (mock 없이)

화면/UX 합의는 **와이어프레임 텍스트 / Figma / 설계 문서** 단계에서 끝낸다. 코드에 들어가는 순간 실 API.

1. **와이어 단계**: 텍스트 와이어로 레이아웃·정보 위계 합의 (코드 X)
2. **승인 후 구현**: 처음부터 실 API 호출 + 로딩/에러/빈 상태 + i18n
3. **빌드 후 시연**: `https://dev.planq.kr/[경로]` 안내 → 실 데이터로 작동
4. **피드백 반영**: 디자인/인터랙션 조정 (실 API 그대로 유지)

### 규칙
- 이전 단계 산출물을 반드시 참조한 후 다음 단계 진행
- 각 단계 완료 시 핵심 요약을 보여주고 승인 확인
- Irene이 수정 지시하면 해당 단계에서 반영 후 재확인
- **구현 중 설계에 없는 것을 임의로 추가하지 않는다**
- **구현 완료 후 반드시 검증 단계를 실행한다 (절대 생략 금지)**
- 예외: 단순 버그 수정/텍스트 변경 (소 규모 작업은 바로 진행)

### 검증 단계 (필수)

**검증 없이 "완료"라고 보고하는 것은 금지된다.**
**코드 수준 확인만으로 "완료"라고 하는 것도 금지. 실제 API 호출로 데이터 흐름을 증명해야 한다.**

1. **빌드 확인**: 프론트엔드 빌드 성공 + dev 서버 반영
2. **API 실동작 테스트** (실제 호출):
   - 로그인 → 토큰 획득
   - 핵심 API 실제 호출 (GET/POST/PUT/DELETE)
   - 저장 → 조회 → 값 일치 확인
   - 정상 케이스 + 경계 케이스 최소 1개씩
3. **프론트엔드 렌더링 확인**: 변경 페이지 정상 서빙 확인
4. **요구사항 대조**: 원래 요청 항목별 ✅/❌ 표시
5. **검증 결과 보고**: 실제 API 호출 결과 포함

**API 테스트 패턴**:
```bash
cd /opt/planq/dev-backend
node test-xxx.js    # Login → API 호출 → 검증
rm test-xxx.js      # 반드시 삭제
```

### 규모별 자동 조절
| 규모 | 기준 | 워크플로우 |
|------|------|-----------|
| 소 | 버그 수정, 텍스트 변경 | 바로 구현 → 검증 |
| 중 | 기능 추가/수정 (2~5 파일) | 기술 설계 요약 → 승인 → 구현 → 검증 |
| 대 | 신규 시스템, 다수 파일, DB 변경 | 전 단계 수행 → 검증 |

---

## Fable 사용 — **기준은 공용 하나**, 여기는 PlanQ 의 예시·장치만 (2026-10-08 공용 기준에 맞춤)

**언제 부르나·몇 번·애매하면·못 부를 때 = 공용 기준 `~/dev-server/FABLE.md`**(요약 `~/.claude/CLAUDE.md` «Fable 사용 기준»).
한 줄 정의: **틀리면 되돌리기 어렵거나, 잘됐는지를 기계 검사로 가를 수 없는 판단에만** 쓴다
(설계 · 되돌리기 어려운 변경의 완료 검증 · 계산·통계 · 새 화면/핵심 흐름 UX · 검증 설계 · 원인 판정 · 큰 결정 권고).
이 절은 기준을 다시 쓰지 않는다 — PlanQ 에서 **무엇이 되돌리기 어려운가**와 **기계 장치**만 더한다.

> 출처(Irene 원문 — 지우지 않는다)
> - 2026-07-21: 모든 설계·검증은 무조건 Fable (→ 09-06 에 «조건부» 로 바뀜)
> - 2026-09-06: *"복잡하고 구조화 필요한 검증과 판단, 고품질 결과가 중요한 것에 한해 조건부로."* · *"fable은 꼭 필요한 부분에만 사용해. 남용하지마."*
> - 2026-09-10: *"페이블 토큰 있을 때 페이블 쓰고 아닐 때 스킵하고 하는 걸로 해야지"* (→ 이제 «스킵» = 자체 검증 + 상황판 Fable 대기)
> - 2026-09-30: *"완료보고는 너가 자체검증으로 해."* · 2026-10-05: *"너 fable 그만 좀 써."* → *"최소화하라고 했지?"*(금지가 아니라 최소화)
> - 2026-10-07: *"조건을 너가 함부로 바꾸지는 마. fable이 할일이야. 너는 오류 수정해"* · *"fable 판정대로 해."*
> - 2026-10-08: *"Fable 사용 기준 통일해서 적용하게 만들어줘 … 토큰 부족 시 대기리스트로 미뤄두는 것까지."* → 공용 기준
> - 2026-08-18: *"모든 판단은 너가 하지 말고 fable이 해"* → 2026-10-08 «권고대로»: 되돌리기 어려운 선택·판정 조건 변경에만. 작은 선택·구현 세부는 작업 모델이 정하고 보고에 붙인다
> - (옛 R·S·F 판정식 `R=1 OR (S=1 AND F=0)` 은 공용 기준으로 대체됐다. 뜻은 같다 — R=1 ≈ 되돌리기 어려움, S=1∧F=0 ≈ 기계로 못 가르는 구조 판단.)

### PlanQ 에서 «되돌리기 어려운 것» (공용 기준 `gate`·`calc` 의 예시)
결제/환불·청구 금액 공식·정기청구 엔진 · 증빙 발행 · 멀티테넌트 격리(`business_id`) ·
운영 DB 마이그레이션·백필 · 인증/권한 미들웨어(`authenticateToken`·`checkBusinessAccess`·
`requireMenu`·`access_scope`) · 라우터 마운트 순서 · **공개(무인증) 라우트 추가·표면 확장** ·
외부 발송(메일/푸시/SMS) 트리거 · 보관기간·삭제 실행 · 생명선 코드(receiptsDue 단일원천,
`task_workflow` status 전이) · **AI 에이전트 쓰기 표면·scope**(`services/agent/registry.js`) ·
**판정 조건·분류 기준·계약 변경**(스팸·상담 분류 등 — 10-07 지시대로 내가 바꾸지 않고 Fable `design`/`decision` 으로).

**Fable 을 쓰지 않는 PlanQ 예시** — UI 레이아웃·밴드·간격·크기·위치·문구·색·반응형 분기 · 드로어/팝오버 열닫힘·정렬·필터·토글 ·
동작 불변 리팩터링 · i18n 추가 · 로그·에러 문구 노출 · 단일 라우트 버그 수정. UI 를 어떻게 매일 기계로 재는지는 `docs/qa/UI_VERIFICATION_SYSTEM.md`.

### 자체 검증일 때 지켜야 할 최소선 (PlanQ 에서 겪은 것)
- **축을 좁히면 자체 검증이 거짓말이 된다** — 데스크탑만 재고 폰을 안 재서 회귀 3건을 놓쳤다.
  화면이면 **폰·태블릿·데스크탑**을 다 잰다.
- **크기만 재지 말고 "보이는가" 를 잰다** — rect 가 176×24 인데 부모 높이 0 + `overflow:hidden`
  이라 **한 픽셀도 안 그려진** 사례. 조상 클리핑 + `elementFromPoint` + 스크린샷.
- **검사기를 고쳤으면 양성 대조군으로 증명한다** — 버그 조건을 되살렸을 때 판정이 뒤집히는지.
  안 그러면 빨간불을 끈 것일 뿐이다.
- 쪼개 올리기가 소모의 주범이었다 — 2026-08-20 팝아웃 핀 하루 8회 · 2026-09-06 상세 헤더 3회.

### 기계 장치 — 게이트 훅 · 마커 · 대기
- **부르는 문** `/fable-검증` (`.claude/commands/fable-검증.md`) — Fable 에 사실(원문·커밋 범위·설계 문서·자체 검증 숫자)을 넘기고
  `VERDICT: PASS|FAIL` 을 받는다. PASS 면 마커 `.claude/.fable-gate.json` `by:"fable"`.
- **Stop 훅** `.claude/hooks/fable-gate-stop.sh` — 지문 경로(`fable-gate-paths.sh` 단일 정본)에 미커밋 변경 **또는 마지막 통과 이후 소스 커밋**이
  있으면 그 상태로 **한 번** 멈춰 묻는다. 공용 기준상 Fable 대상이 아니면(화면·작은 버그) 자체 검증 숫자를 보고하고 다시 끝내면 된다(같은 지문엔 다시 안 막는다).
- **못 부를 때(한도·과부하)** — 공용 기준 5절 그대로: 자체 검증 숫자 · **상황판 Fable 대기**(`/api/fable-wait`) · 작업기록 «### 나중에 — Fable 대기» ·
  보고 첫 줄 `🕓 나중에 — Fable 대기: …` · **운영 배포는 Fable 통과 뒤로**(설계가 막혔으면 구현 시작 안 함).
  단 **Irene 이 `/배포` 를 직접 지시하면 그것이 승인**이다 — 배포하고 보고에 대기 항목을 적는다(2026-10-08 «권고대로», `/배포` 0-B단계).
  PlanQ 장치: 마커를 `by:"unavailable"` 로 남긴다(그 지문에 한해 훅 통과, «검증됨» 과 구별). 판정을 받으면 `{"room":…,"done":true}`.
- **`docs/FABLE_GATE_QUEUE.md` 는 기록 보관소**다 — 새 대기는 상황판에 올린다(2026-10-08 부터). Fable 판정 결과(PASS/FAIL·비차단 지적)는
  계속 그 파일 맨 위에 남긴다.

### 게이트가 조용해지는 두 가지 구멍 — 둘 다 막았다

2026-09-10 실측: **게이트가 6일간 한 번도 안 울린 채 운영 배포 2회**(v1.48.17·v1.48.18)가 나갔다.
원인이 둘이었고 둘 다 "장치는 있는데 작동하지 않는" 모양이었다 —
memory `feedback_unwired_guard_is_no_guard` 와 같은 계열이다.

| 구멍 | 무슨 일이 났나 | 막은 방법 |
|---|---|---|
| **커밋하면 침묵** | 훅이 *미커밋 변경*만 봤다. 작업을 끝내고 커밋하는 순간 조용해진다. 2026-09-07 에도 같은 방식으로 "게이트를 커밋 뒤에 돌려 조용히 초록으로 넘기고 운영에 두 번 배포" 했는데 그때 안 고쳐 재발했다 | 훅이 **마지막 통과 이후의 소스 커밋**도 센다. **커밋은 검증이 아니다** |
| **임시 스킵이 영구화** | `.fable-gate-skip` 을 2026-08-23 에 임시로 켰다가 **18일간 잊었다.** 그동안 자동 차단 0회 | **24시간 자동 만료**. 무기한 스위치를 두지 않는다 |

### 이 저장소의 검사 도구 (Fable·자체 검증이 같이 쓴다 — 체크리스트로 내려보내지 않는다)
- 범위: `git diff` / 마지막 마커 커밋 이후 `git log` (설계 외 변경 0)
- 가드: `node scripts/health-check.js` · `npm run build`(EXIT 0 + `error TS` 0) · `node scripts/guard-invariants.js` · `node scripts/e2e/run.js --suite tenant`
- 실호출: 실제 HTTP(포트 3003) login → CUD → 재조회 일치 · 권한별 403 · 운영 옛 데이터 1건
- 배포 안전성: 마이그레이션 멱등 · 배포 슬롯 등록 · 청크 해시 · 롤백 경로

## 시험 역할 — «확인할 곳» 을 그 역할로 열기 (dev-login, 2026-10-12)

> Irene 2026-10-11: *"해당 역할 테스트로 로그인해서 보낼 수 없어? 정확히 같은 페이지·데이터도 넣어서 같은 내용"*
> 계약 정본 `~/dev-server/kit/DEV-LOGIN.md`. 서버 `routes/auth_dev_login.js`(개발 .env `DEV_LOGIN_SECRET` + `NODE_ENV=development` 일 때만 마운트) · 화면 `/dev-login`.

역할 화면을 보고할 때는 «확인할 곳» 줄 끝에 `[as=<역할키> ws=<워크스페이스 id>]` 를 붙인다 — 상황판이 «시험 계정으로 열기» 버튼을 붙인다.
예: `- https://dev.planq.kr/tasks?task=12 — 할 일 3개 [as=owner ws=6]`

| 역할키 | 시험 계정 | 보이는 것 | 범위 |
|---|---|---|---|
| `owner` | owner@test.planq.kr (김오너) | 워크스페이스 대표 — 전 메뉴·설정·청구 | `ws` = 6 (PlanQ 테스트 워크스페이스) · 7 (브랜드 파트너스) |
| `member` | member1@test.planq.kr (이디자) | 멤버 — 업무·대화·문서(대표 전용 제외) | `ws` = 6 |
| `member2` | member2@test.planq.kr (박개발) | 두 번째 멤버(담당자·컨펌자 주고받기) | `ws` = 6 |
| `client` | client@test.planq.kr (최고객) | 고객 — 자기 프로젝트·대화·문서만 | `ws` = 6 |
| `admin` | admin@test.planq.kr | 플랫폼 관리자(`/admin/*`) — 워크스페이스 없음 | 없음 (`ws` 를 주면 거절) |

- **범위 생략 = ws 6.** 시험 계정은 시험 워크스페이스(slug `planq-test`·`brand-partners-test`)에만 들어간다 — dev 에서 member1·2 가
  «워프로랩»(ws 3)에도 멤버라 멤버십만 보면 그 화면이 열린다. 다른 워크스페이스를 쓰려면 `routes/auth_dev_login.js` 의 두 목록을 같이 고친다.
- **그 줄이 보여 주는 시험 데이터는 지우지 않는다** — 이름 앞에 `[확인용]`. 7일 지난 `[확인용]` 은 /개발완료 7단계
  `node scripts/cleanup-check-data.js --apply` 가 치운다(새 cron 없음, 개발 DB 에서만 돈다). 실데이터·실고객 위에 만들지 않는다.
- 토큰은 **보통 로그인과 같은 것**(`issueLoginSession` 한 벌) — 대리 로그인(impersonate) 토큰이 아니다(그건 워크스페이스 전환이 막힌다).
- **운영 `.env` 에 `DEV_LOGIN_SECRET` 을 넣지 않는다** — 배포 스크립트 사전 점검이 있으면 멈춘다.

## 상황판이 주는 일 — 묶음 배정 · 정찰 방 (2026-10-12, 서버 방 요청 · Fable 설계 판정 D)
- **묶음 배정** — 상황판이 작은 일 최대 3건을 한 방에 준다. 커밋은 **일별**, «확인할 곳» 도 일별로 쓴다. 하다가 커지는 일은 `front:true` 로 대기열 앞에 되돌린다(묶음 안에서 끌어안지 않는다).
- **정찰 방 = 읽기 전용** — 첫 메시지 첫 줄이 «[상황판 정찰 방 — 읽기 전용]» 인 방은 조사만 하고 `.claude/plans/q<번호>.md` 만 쓴다(커밋 안 함, `.gitignore`). 막는 것은 훅 `.claude/hooks/scout-guard.sh`(판정 `scout-detect.sh` 한 곳 · 정찰 방이면 Fable 게이트·자동저장 Stop 훅도 바로 끝). **고치는 방은 계획 파일을 받으면 조사 때 HEAD 이후 바뀐 것부터 확인**한다(`git log <계획의 HEAD>..HEAD`) — 계획은 그 시점의 사실이다.

---

## 영역별 규칙 — `.claude/rules/` (2026-10-23 · 토큰 절약으로 나눔)

이 파일에는 **모든 일에 걸리는 규칙만** 둔다. 화면·기능·영역별 «박제» 규칙은 `.claude/rules/<이름>.md` 로 옮겼다(문장은 그대로).
각 파일 머리말 `paths:` 에 적힌 경로의 파일을 **Read/Write 하거나 cat 으로 열면 그 규칙이 자동으로 실린다.** Grep 만으로는 실리지 않는다 —
**그 영역을 고치기 전에는 고칠 파일을 Read 로 연다**(그래야 규칙이 같이 들어온다). 경로 밖 일(설계 문서·스크립트)에서 그 영역을 다루면 아래 표의 파일을 직접 Read 한다.
규칙을 새로 박제할 때도 영역 규칙이면 그 파일에, 모든 일에 걸리면 여기에 쓴다. 새 영역이면 파일을 만들고 이 표에 한 줄 더한다.

| 파일 | 내용 |
|---|---|
| `ai-agent.md` | AI 에이전트(ChatGPT·Claude) 연동 |
| `auth.md` | 인증 — 외부 로그인(구글·애플)·refresh 토큰 |
| `backend-routes.md` | 백엔드 라우트 — pagination·중복 선언·복사(복제) 계약 |
| `badges.md` | 숫자 배지 계약 — 확인 필요 = 메뉴 배지 합 |
| `billing.md` | 체험·선결제·체험 중 환불 |
| `calendar.md` | 캘린더·상담 예약 |
| `db-schema.md` | DB 테이블 목록·스키마 이력 |
| `dev-status.md` | 플랫폼 운영 — 배포별 개발 현황(dev_status_reports) |
| `guest-links.md` | 게스트 링크(guest_links) |
| `leave.md` | 휴가 종류(leave_types) |
| `native-app.md` | 네이티브 앱(Capacitor) — 딥링크·오프라인 화면 |
| `ops-backend.md` | 운영 안정성 — 서버 쪽(비용 한도·외부 발송·알림 트리거·푸시) |
| `ops-frontend.md` | 운영 안정성 — 화면 쪽(자동 새로고침·SW·청크 복구·측정) |
| `org-feedback.md` | 조직(팀장)·문의·피드백 승인 |
| `payroll.md` | 급여·계약 |
| `project-tabs.md` | 프로젝트 상세 탭 본문 껍데기 |
| `qbill.md` | Q Bill — 재무 권한 |
| `qdocs.md` | Q docs — 댓글·서명·설문 |
| `qfile.md` | 파일 저장·첨부·Q file 트리 |
| `qmail.md` | Q mail — 메일 계정·폴더·배지·분류 기준·알림 계약 |
| `qnote.md` | Q Note — STT 과금·사적 공간 |
| `qsale.md` | Q sale — 고객 축·상담 기록·사람 아이콘 |
| `qtask.md` | Q Task — 상태·승인완료·필드 권한·진행률 |
| `realtime.md` | 실시간 데이터 반영·채팅 알림 검증 |
| `security-detail.md` | 보안 — 응답 비밀값·공유·참조·권한 회수 상세 |
| `seo-landing.md` | 랜딩 SEO·방문 집계 |
| `social.md` | SNS 발송(플랫폼 마케팅 도구) |
| `status-values.md` | 상태값 규약 — 알 수 없는 값은 보이게 |
| `tab-scope.md` | 탭 범위 계약 |
| `trash.md` | 휴지통 |
| `ui-components.md` | 화면 — 기존 것을 찾아 쓴다·껍데기 공유·액션 버튼 |
| `ui-forms.md` | 화면 — 자동저장·입력 초안 |
| `ui-layout.md` | 화면 레이아웃 — PageShell·패널 헤더·두 밴드·반응형·모바일 입력·메뉴 |
| `ui-overlays.md` | 화면 — 새 탭·드로어·모달·상단 기준선·검사 하니스 요건 |
| `wiki.md` | Q위키(help_*) |
| `workspace.md` | 워크스페이스 단일 정본 계약 |

DB 테이블 구조는 `.claude/rules/db-schema.md`(모델·마이그레이션을 열면 실린다) 와 `dev-backend/models/` · `docs/DATABASE_ERD.md`.

---

## 개발 환경

### 경로
| 구분 | 경로 |
|------|------|
| 프로젝트 루트 | `/opt/planq/` |
| 백엔드 | `/opt/planq/dev-backend/` |
| 프론트엔드 소스 | `/opt/planq/dev-frontend/` |
| 프론트엔드 빌드 | `/opt/planq/dev-frontend-build/` |
| Q Note (Python) | `/opt/planq/q-note/` |

### 서버
| 구분 | 값 |
|------|-----|
| 개발서버 IP | 87.106.11.184 |
| 개발 도메인 | dev.planq.kr |
| 백엔드 포트 | 3003 |
| Q Note 포트 | 8000 |
| DB | planq_dev_db / planq_admin |
| PM2 | planq-dev-backend, planq-qnote |

### 같은 서버의 다른 서비스 (절대 건드리지 말 것)
| 항목 | 값 |
|------|-----|
| PurpleHere POS 백엔드 | `/var/www/dev-backend` (port 3001) |
| PurpleHere POS 프론트엔드 | `/var/www/dev-frontend-build` |
| POS DB | purple_dev_db / dev_admin |
| POS PM2 | dev-backend |
| POS 도메인 | dev.purplehere.com |

---

## 빌드 & 반영

### 빌드 실행 규칙 (절대 준수)
- **반드시 `run_in_background: true`로 실행** (포그라운드 시 Claude Code가 not responding됨)
- **빌드 실행 후 "빌드 진행 중입니다" 안내** → 완료 알림 오면 결과 보고
- **이전 빌드가 실행 중이면 kill 후 새 빌드 시작**
- **운영 배포가 도는 동안은 빌드·Fable 검증·브라우저 시험을 띄우지 않는다** (2026-10-23) — 겹치면 배포 빌드가 메모리 보호에 죽는다(10-22 세 번).
  `npm run build` 의 prebuild 와 e2e 러너가 `scripts/deploy-busy.sh` 로 배포가 끝날 때까지 기다린다(우회 금지). 절차 `.claude/commands/배포.md` 2단계.

```bash
# 프론트엔드 빌드
cd /opt/planq/dev-frontend && npm run build

# 백엔드 변경 시
pm2 restart planq-dev-backend

# DB 스키마 변경 시
cd /opt/planq/dev-backend && node sync-database.js
pm2 restart planq-dev-backend
```

---

## 배포 규칙

- **Irene이 "배포" 명령을 하지 않으면 절대 배포하지 않음**
- 빌드 완료 후 자동 배포 금지
- 운영서버 배포 스크립트는 별도 작성 예정

---

## 기술 스택

| 영역 | 스택 |
|------|------|
| Frontend | React + TypeScript + Vite + styled-components |
| Backend | Node.js + Express + Sequelize (MySQL 8.0) + Socket.IO |
| Q Note | Python + FastAPI (별도 프로세스) |
| 인증 | JWT (Access 15분 + Refresh 7일) |
| 이메일 | Nodemailer |
| 프로세스 | PM2 |

---

## 코딩 가이드

### API 응답 형식 (표준)
```javascript
// 성공
res.json({ success: true, data: result });
res.json({ success: true, data: result, message: '선택적 메시지' });

// 성공 (목록 — pagination)
res.json({ success: true, data: [...], pagination: { total, limit, page, offset, has_more } });

// 실패
res.status(400).json({ success: false, message: 'Error description' });
```

### 파일 크기 기준
- 라우트 파일: 500줄 이상이면 기능별 분리 검토
- 컴포넌트 파일: 800줄 이상이면 하위 컴포넌트 분리 검토

### 백엔드 엔트리 포인트
- PM2 실행 파일: `server.js`만 사용

### 코드 스타일
- 들여쓰기: 2 spaces
- 세미콜론: 사용
- 문자열: 작은따옴표
- async/await 사용 (콜백/then 금지)
- 에러 처리: try/catch + 공통 에러 핸들러
- Sequelize 모델: `class X extends Model`, `X.init({...}, { sequelize, tableName, timestamps, underscored: true })`
- 라우트: `express.Router()`, `successResponse/errorResponse` 헬퍼 사용
- snake_case: DB 컬럼, API 응답 필드
- camelCase: JavaScript 변수, 함수

---

## 보안

### 인증
- JWT (Authorization: Bearer {token})
- Access Token: 15분, Refresh Token: 7일 (HttpOnly Cookie)
- bcryptjs salt rounds: 12

### 인증/인가 미들웨어
| 미들웨어 | 용도 |
|----------|------|
| `authenticateToken` | JWT 토큰 검증 |
| `requireRole(...)` | 플랫폼 역할 확인 |
| `checkBusinessAccess` | 해당 비즈니스 접근 권한 확인 |

### API별 미들웨어 적용
| API 유형 | 필수 미들웨어 |
|----------|-------------|
| 공개 (로그인, 회원가입) | 없음 |
| 사용자 본인 데이터 | authenticateToken |
| 비즈니스 데이터 | authenticateToken + checkBusinessAccess |
| 플랫폼 관리 | authenticateToken + requireRole('platform_admin') |

### 보안 미들웨어 (middleware/security.js)
- Helmet: 보안 헤더
- CORS: dev.planq.kr, planq.kr만 허용
- Rate Limit: 로그인 실패 8회/15분(IP) + 계정당 30회/시간, 회원가입 3회/1시간(IP), 일반 100회/분 (2026-10-23 실측 정정 — 옛 «5회/15분» 은 낡은 값)
  - ★ 살아 있는 초대 링크 가입은 IP 몫을 쓰지 않고 **토큰당 5회/1시간**으로 센다(2026-10-09 — 한 사무실 4번째 팀원이 막혔다).
    판정은 **수락과 같은 술어**(존재·미만료·미연결 + 멤버 초대면 `plan.can('add_member')`) — 넓으면 한도로 수락 못 하는 토큰이 «영구 열쇠» 가 된다(Fable 1차 FAIL 실측).
- SSRF 방어: URL 파라미터 검사, 내부 IP 차단
- SQL Injection 패턴 감지: 추가 방어층
- CSP: Content Security Policy
- 보안 헤더: XSS-Protection, X-Frame-Options, Referrer-Policy, Cache-Control

### 멀티테넌트 격리
- 모든 쿼리에 `WHERE business_id = ?` 필수
- JOIN 시에도 business_id 조건 유지
- Client는 자기 대화방/할일/파일만 접근

### 외부 발송은 **확인을 받는다** (2026-09-13, Irene 지시 "확인을 받아")

고객·외부에 **메일이 나가는 버튼**은 누르는 즉시 보내지 않는다. `ConfirmDialog` 로 묻고,
**보낼 주소를 문구에 적는다** — "정말?" 만 묻는 창은 확인이 아니다(어디로 가는지 모르면 확인할 수 없다).
보낼 주소가 없으면 버튼을 **비활성 + 이유**로 둔다. 눌리게 두고 서버가 400 으로 거절하면
사용자에게는 "아무 일도 안 일어남" 이다(실제로 [초대 재발송] 이 그 상태였다).
현재 적용: 고객 초대(Q sale 패널) · 초대 재발송(고객 상세). **미적용: 멤버 초대 · 프로젝트 고객 초대**
(queue 19 판단 2 — 규칙화할지 Fable 판정 대기).

### 체크리스트
- 사용자 입력 검증 필수
- business_id 파라미터 신뢰 금지 → checkBusinessAccess로 소유권 확인
- 민감한 데이터 로깅 금지 (비밀번호, 토큰)

---

## 운영 정책

- 메시지 삭제: 마스킹 (is_deleted=true, 원본은 DB 유지, UI에서 "삭제된 메시지")
  - **원문을 지우는 것은 서버 책임** — `utils/deletedMessage.js` `maskDeletedMessages()` 단일 지점.
    조회 라우트는 이 함수를 부른다(직접 필드를 비우지 말 것). 2026-09-02 실사례:
    `content` 만 비운 코드가 **`translations`(번역 캐시는 원문 언어 사본을 함께 갖는다)·`ai_sources` 로
    본문을 그대로 내보냈다.** 화면에 안 보인다고 안 나간 것이 아니다.
  - **지울 것을 열거하지 말고 남길 것만 남긴다(화이트리스트).** 열거 방식은 컬럼이 늘 때마다 조용히 샌다.
  - **마스킹은 표시명(applyMemberDisplayName·applyGuestDisplayName)을 다 적용한 뒤에 부른다.**
    게스트 이름은 `meta.guest.name` 에서 오므로 `meta` 를 먼저 지우면 그림자 User 이름
    (= 고객 표시명)으로 떨어져 **링크 받은 제3자가 고객 본인처럼 보인다**(#259 회귀).
  - **고객(Client)·게스트에게는 자리도 보이지 않는다** — `routes/guest.js` `visibleToGuest` 와 같은 술어.
    지운 것을 지웠다고 알리는 것은 우리 쪽 사정이다.
- 메시지 수정: 허용 (is_edited=true, edited_at 기록, UI에서 "(수정됨)")
- 할일 마감 지연: 빨간 뱃지, 마감 연장은 담당자 이상
- 감사 로그: 모든 CUD 작업 AuditLog에 기록 (old_value/new_value JSON)

---

## 설계 문서

| 문서 | 경로 |
|------|------|
| 시스템 아키텍처 | `docs/SYSTEM_ARCHITECTURE.md` |
| ERD 데이터베이스 | `docs/DATABASE_ERD.md` |
| 정보구조 (IA) | `docs/INFORMATION_ARCHITECTURE.md` |
| API 설계 | `docs/API_DESIGN.md` |
| 기능 정의서 | `docs/FEATURE_SPECIFICATION.md` |
| 보안 설계 | `docs/SECURITY_DESIGN.md` |
| 개발 로드맵 + 프롬프트 | `docs/DEVELOPMENT_ROADMAP.md` |
| **Q Bill·서명·결제 통합 설계 (2026-04-26)** | `docs/Q_BILL_SIGNATURE_DESIGN.md` |
| UI 디자인 가이드 | `dev-frontend/UI_DESIGN_GUIDE.md` |
| 색상 가이드 | `dev-frontend/COLOR_GUIDE.md` |

---

## Git

- 저장소: `git@github-planq:ireneceo/planq.git`
- SSH Host: `github-planq` (id_ed25519 키 사용)
- 기본 브랜치: main

---

## 다국어 (i18n — 필수)

PlanQ는 **한국어/영어 두 언어를 동시 지원**한다. 모든 사용자 노출 문자열은 처음부터 ko/en 양쪽을 작성해야 한다.

### 규칙
- **사용자에게 보이는 모든 문자열은 하드코딩 금지** — `useTranslation('<네임스페이스>')` + `t('key')` 사용
- **기획 단계에서부터 ko/en 문구를 함께 정의** — 설계 문서에 영어 텍스트 없는 항목은 미완으로 간주
- 새 페이지/기능 개발 시: **JSON(ko/en) 작성 → 컴포넌트에서 `t()` 사용** 순서
- 인라인 HTML 태그가 포함된 문구는 `<Trans i18nKey="..." components={{ 1: <strong /> }} />` 사용
- 동적 값은 `{{name}}` 보간: `t('register.hello', { name })`
- 제외: 코드 주석, 개발용 로그, 언어별 예시 문장(예: 음성 등록용 한국어 샘플)

### 네임스페이스 구조
- `common` — 공통 버튼/상태/메시지/역할
- `auth` — 로그인/회원가입
- `layout` — 사이드바 메뉴/사용자 영역
- `profile` — 내 프로필
- `qnote` — Q note 페이지 + 회의 시작 모달
- (신규 기능 추가 시: `qtalk`, `qtask`, `qcalendar`, `qdocs`, `qfile`, `qbill`, `dashboard` …)

### 파일 위치
- ko: `dev-frontend/public/locales/ko/<namespace>.json`
- en: `dev-frontend/public/locales/en/<namespace>.json`
- 설정: `dev-frontend/src/i18n.ts` (`ns` 배열에 신규 네임스페이스 등록 필수)

### 검사

**정본은 가드 스크립트다. 아래 명령으로만 판정한다.**

```bash
# 한국어 하드코딩 래칫 + ko/en 키 패리티 + i18n.ts ns 등록
node scripts/guard-invariants.js --category=i18n
node scripts/guard-invariants.js --category=parity
```

래칫이라 **기존 부채는 동결, 증가만 실패**한다. 실패하면 신규 위반을 i18n 으로 전환하고,
의도적으로 부채를 줄인 경우에만 `--update-baseline` 으로 조인다.
(단독 `--category=X --update-baseline` 은 **다른 카테고리 베이스라인을 파괴**한 전례가 있다 — 전체 실행으로 갱신할 것.)

제외 규칙(가드 내장): `t()` 폴백·`i18nKey`·`defaultValue`·`console.*`·주석(`//`, `/*`, `*`, JSX `{/*`).
memory `feedback_i18n_tdefault_not_hardcoding` — **t() 기본값은 하드코딩이 아니다.**

**한 파일만 눈으로 훑을 때의 보조 grep** (가드보다 시끄럽다 — `t()` 폴백까지 잡힌다):

```bash
grep -rEn "'[^']*[가-힣][^']*'|\"[^\"]*[가-힣][^\"]*\"" dev-frontend/src --include='*.tsx' --include='*.ts' \
  | grep -v -E '//|/\*|\*/|^\s*\*' | grep -v '/locales/'
```

> ⚠️ **옛 문서의 역참조 grep(`(['\"\`])…\1`)은 쓰지 말 것 — 거짓 통과한다.**
> 이 서버 `grep` 은 ugrep 이라 **역참조가 동작하지 않아 저장소 전체에 대해 항상 0건**을 반환한다.
> 2026-07-28 반증: 실제 하드코딩(`title="저장되었습니다"`)을 심고 세 명령을 돌린 결과 —
> 옛 grep **0건(못 잡음)** / 가드 스크립트 **FAIL(426 vs base 426, 잡음)** / 위 보조 grep **1건(잡음)**.
> 같은 정규식이 가드 스크립트(JavaScript) 안에서는 정상 동작하므로 가드 자체는 건전하다.

---

## 절대 금지 사항

- 운영서버 직접 코드 수정/배포
- POS 관련 파일/DB/PM2 건드리기
- alert(), toast.success(), window.confirm(), window.prompt() 사용
- **mock 데이터 일체** — `mockXxx`, dummy 배열/객체, 하드코딩 시드 데이터 모두 금지. 모든 데이터는 DB에서 API로 (자세한 정책: 위 "🚫 mock 데이터 절대 금지" 섹션)
- 샘플/가짜 데이터로 화면 채우기 — production 소스에 잔존 시 검증 실패
- API 테스트 시 기존 계정 비밀번호 변경 금지
- **프론트엔드 문자열 하드코딩 (한국어/영어 모두)** → 반드시 `t()` 사용
