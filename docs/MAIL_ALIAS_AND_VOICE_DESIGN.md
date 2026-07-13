# 발신 별칭(Send-as) + 음성 입력 — 기능 설계

> 2026-07-13 · Irene 요청: ① Gmail 처럼 여러 도메인 주소로 보내기 ② 우측 하단 퀵버튼에 마이크(모바일 우선)

---

## A. 발신 별칭 (Send-as alias)

### A-1. 문제

지금 PlanQ 는 **메일 계정 = 발신 주소** 다. `services/emailSend.js` 가 `from` 을 `account.email` 로 고정한다.
그런데 실제 업무는 한 메일함(예: Gmail `help@irenewp.com`)으로 **여러 도메인 주소**를 받고, 답장할 때
**받은 그 주소로** 보낸다. Gmail·Outlook·Superhuman 이 다 하는 "Send mail as" 다.

### A-2. 사실 확인 (SMTP 관점)

- SMTP 는 `MAIL FROM`(봉투)과 헤더 `From:` 을 구분한다. Gmail SMTP 로 보낼 때 헤더 `From:` 을 다른
  주소로 쓰려면 **Gmail 계정에 그 주소가 "다른 주소로 메일 보내기"로 등록·인증돼 있어야** 한다
  (Gmail 설정 → 계정 → 다른 주소로 메일 보내기). 등록 안 된 주소를 쓰면 Gmail 이 `From:` 을 계정
  주소로 되돌리거나 발송을 거부한다.
- 자체 SMTP(회사 메일서버)는 보통 도메인 소유 주소면 그대로 허용한다.
- **따라서 PlanQ 는 "별칭을 등록해 두고 고르는 것"까지 책임지고, 그 주소로 보낼 권한 자체는
  메일 제공자(Gmail 등)에서 인증돼 있어야 한다.** 화면에 이 사실을 명시한다 (거짓 약속 금지).

### A-3. 데이터 모델

```
email_account_aliases
  id, business_id, account_id (FK email_accounts, CASCADE)
  email          VARCHAR(200)   -- 보내는 주소 (예: hello@worprolab.com)
  display_name   VARCHAR(100)   -- 이 주소로 보낼 때 표시 이름 (없으면 계정/워크스페이스 기준)
  signature_html TEXT NULL      -- 이 주소 전용 서명 (NULL 이면 계정 서명 사용)
  is_default     BOOLEAN        -- 새 메일 작성 시 기본 선택
  UNIQUE(account_id, email)
```

서명을 별칭 단위로 둔 이유: 도메인이 다르면 브랜드가 다르다. 다른 브랜드 주소로 보내면서 같은
서명이 붙으면 사고다. NULL 이면 계정 서명으로 폴백 — 대부분은 계정 서명 하나로 충분하다.

### A-4. 발신 주소 결정 규칙 (단일 원천: `services/emailSend.js`)

우선순위:
1. 호출부가 명시한 `fromAliasId` — **그 별칭이 이 계정 소유인지 서버가 재검증**한다 (클라이언트 신뢰 금지)
2. **답장**이면 그 메일이 온 주소 — 받은 메시지의 `to_emails` ∩ (계정 주소 + 별칭들) 중 첫 번째.
   "받은 주소로 답한다" 는 사용자가 기대하는 기본값이다
3. 계정의 기본 별칭 (`is_default`)
4. 계정 주소 (`account.email`)

표시 이름은 별칭 `display_name` → 계정 `display_name` → 워크스페이스 발신 이름 순.
서명은 별칭 `signature_html` → 계정 `signature_html` 순 (`appendSignature` 가 결정).

### A-5. API

```
GET    /api/businesses/:bizId/email-accounts/:id/aliases
POST   /api/businesses/:bizId/email-accounts/:id/aliases     { email, display_name?, signature_html?, is_default? }
PUT    /api/businesses/:bizId/email-accounts/:id/aliases/:aliasId
DELETE /api/businesses/:bizId/email-accounts/:id/aliases/:aliasId
```
권한: 계정 편집 권한과 동일(회사 공용 = admin, 개인 계정 = 본인). 이메일 형식 검증 필수.

발송 라우트(`reply`, `compose`, `forward`)는 body 에 `from_alias_id?` 를 받는다.

### A-6. 화면

- **설정 → 메일 계정**: 계정 카드 안에 "보내는 주소" 목록 — 추가/삭제/기본 지정, 주소별 서명.
  안내 한 줄: *"Gmail 로 보내려면 그 주소가 Gmail 의 '다른 주소로 메일 보내기'에 등록돼 있어야 합니다."*
- **메일 작성/답장 컴포저**: 상단에 **보내는 사람 셀렉트** (계정 주소 + 별칭). 답장은 받은 주소가 기본 선택.
  주소가 하나뿐이면 셀렉트를 숨긴다 (없는 선택지를 보여주지 않는다).

---

## B. 음성 입력 — 우측 하단 퀵버튼(RightDock)

### B-1. 위치와 이유

Irene: *"우측 하단 채팅 퀵버튼에 마이크. 보통 모바일에서 쓰지 않을까."* 맞다 — 음성은 **이동 중·
손이 바쁠 때** 쓴다. 그 상황에서 사용자는 특정 화면(Q Task, Q Mail)에 있지 않다. 그래서 **어느
화면에서나 떠 있는 RightDock** 이 정확한 자리다. 작업대(우측 패널)에 넣자던 앞선 안은 폐기.

RightDock 메뉴 최상단에 **"말로 추가"** 를 넣는다 (기존: 업무·메일·일정 만들기 / Q Talk·Q Note·Q helper).

### B-2. 흐름

```
마이크 탭 → 녹음(최대 30초, 파형 + 남은 시간) → 정지
  → POST /api/voice/capture (audio/webm)
      ① STT (Deepgram prerecorded, ko/en 자동)
      ② 의도 분류 + 구조화 (LLM 1회, JSON): kind = task | event | memo | mail
  → 미리보기 카드 (사람이 확인·수정) → 확인 → 기존 생성 경로로 저장
```

**자동 저장하지 않는다.** 잘못 들은 말이 그대로 업무가 되면 신뢰가 무너진다. 항상 미리보기.

### B-3. 의도별 착지점 (전부 기존 경로 재사용 — 새 저장 로직 없음)

| 말 | kind | 착지 |
|---|---|---|
| "루아님께 경쟁사 비교표 이번 주까지 요청해줘" | task | `POST /api/tasks/ai-create` → 미리보기 → `/confirm` (담당자 지정·요청 업무 이미 지원) |
| "다음 주 화요일 3시 아이린앤컴퍼니 미팅" | event | `POST /api/calendar/events` (미리보기 후) |
| "이 고객 예산이 빠듯하다더라" | memo | 개인 메모(L1) 또는 열려 있는 대화·메일의 메모 |
| "견적 보내드리겠다고 답장해줘" | mail | Q Mail 답장 컴포저에 초안 채워 열기 (발송은 사람이) |

컨텍스트 인식: 지금 보고 있는 화면이 대화/메일이면 그 컨텍스트를 함께 넘긴다(작업대 리스트에 바로
붙도록 — `GET /api/tasks/context` 와 같은 스코프).

### B-4. STT 선택

- **Deepgram prerecorded API (권장)** — Q Note 가 이미 Deepgram 을 쓴다(실시간 WS). 짧은 발화는
  prerecorded REST 로 충분하고 더 싸다. 언어 일관성·한국어 정확도 검증됨.
- 대안(브라우저 Web Speech API)은 무료지만 iOS/Safari 지원이 들쭉날쭉해 **모바일 우선** 이라는 전제와 충돌.
- 키: `DEEPGRAM_API_KEY` — 현재 `q-note/.env` 에만 있다. Node 백엔드 `.env` 에도 추가 필요(운영 포함).

### B-5. 비용·안전 가드 (처음부터)

- 발화 **30초 캡** (프론트 강제 정지 + 백엔드 파일 크기·길이 캡)
- **per-user rate-limit** — `middleware/costGuard.js`: 분당 5회 / 일 100회
- **플랜 게이트** — `plan.can('use_cue')`, 사용량은 cue_usage 에 `voice_capture` 로 기록
- 오디오는 **저장하지 않는다** (전사 후 즉시 폐기). 개인정보 최소 수집
- 실패(무음·인식 불가)는 조용히 "다시 말해 주세요" — 빈 업무를 만들지 않는다

### B-6. 접근성·모바일

- 마이크 권한 거부 시: 안내 + 텍스트 입력으로 폴백(같은 시트에서 타이핑)
- 녹음 중 화면 이탈/전화 수신 → `visibilitychange` 시 자동 정지 + 그때까지 전사
- 버튼 터치 타겟 44×44, 녹음 중 상태는 색만이 아니라 텍스트로도("녹음 중 12초")

---

## C. 작업 순서

1. **A-1 별칭 백엔드** — 모델 + CRUD + `emailSend` 발신 주소/서명 결정 단일화 + 발송 라우트 `from_alias_id`
2. **A-2 별칭 프론트** — 설정 화면(주소 목록·서명), 컴포저 보내는 사람 셀렉트(답장 시 받은 주소 기본)
3. **B-1 음성 백엔드** — `POST /api/voice/capture` (STT + 의도 분류), 가드 3종
4. **B-2 음성 프론트** — RightDock "말로 추가" + 녹음 시트 + 의도별 미리보기 카드

각 단계 끝에 실호출 검증 + 브라우저 확인. B 는 `DEEPGRAM_API_KEY` 를 Node `.env` 에 넣은 뒤 진행.
