# 메일 분류 대점검 — 2026-10-11

> 후속(2026-10-15): 분류 기준 공개·끄기·새 기준(inbound_action·auto_ack·spam_rescue) — `docs/MAIL_CRITERIA_DESIGN.md`.

> Irene: *"이런 중요한 메일이 확인권장에도 답변필요에도 안들어와서 미씽했어. 메일 분류조건 다시 대점검 철저히 해줘."*
> 놓친 메일: `gfmsupport@rgtech.com.my` «GFM B2B PORTAL - Online Sign Up» (Partner Code G4049 · GIT CONSULTING 파트너 가입 안내, dev thread 8523)
> 판정 코드: `dev-backend/services/emailTriage.js` (수집 `triageInbound` · 재판정 `retriageStored` 같은 문)

## 1. 그 메일이 빠진 이유 (실측)

| 단계 | 값 |
|---|---|
| 헤더 | `x-sg-eid`(SendGrid) 하나. List-Unsubscribe·List-Id·Precedence 없음 |
| `isMarketing` | **true** — ESP 헤더 5종(`x-mailgun-sid`·`x-sg-eid`·`x-campaign`·`feedback-id`·`x-csa-complaints`)을 «대량 발송» 증거로 본다 |
| 결과 | triage=`marketing` · status=`open` → **«자동·마케팅» 폴더**. 확인 권장·답변 필요 어디에도 없음 |
| 본문 | `body_text` NULL (HTML 전용 메일) → 판정에 본문이 **빈 문자열**로 들어갔다 |

## 2. 같은 계열 구멍 3개 (dev 동기화 메일함 6,289스레드 전수 시뮬 — 사업장 3·5, 운영과 같은 계정)

### 구멍 A — ESP 헤더 = 광고로 본다
SendGrid·Mailgun·Feedback-ID 는 **보낸 도구**의 표식이다. 영수증·청구서·계정 경고 같은 **거래 메일에도 똑같이** 붙는다.
이 헤더만으로 광고 판정된 스레드 중 실제로 묻혀 있던 것(일부):
- `[Action needed] Your Claude API access is turned off` (anthropic)
- Google Workspace 청구서 · Stripe 세금계산서·웹훅 장애 · IONOS 청구서·«Security Incident Related to Your IONOS Server»
- 시프티 카드 결제 청구 · 센트비 송금/입금 요청 · Billplz 입금 영수증 · 쿠팡 주문 확인
- **GFM B2B 파트너 가입 (이번 신고)**

### 구멍 B — HTML 전용 메일은 본문을 안 본다
받은 메일 **8,199통 중 2,304통(28%)** 이 `body_text` NULL. 수집(`parsed.text`)·재판정(`msg.body_text`) 둘 다 HTML 을 텍스트로 바꾸지 않고 넘겨
업무 신호·요청 문장·보안 코드·대량 본문 판정이 **제목만으로** 돌았다. (`emailBodyClean.htmlToText` 가 이미 있다.)

### 구멍 C — 수신거부 헤더가 붙은 «꼭 봐야 하는» 거래 메일
대형 발송사는 거래 메일에도 List-Unsubscribe 를 단다 → marketing → 내용 승격이 **보안 코드(security_code) 하나뿐**.
여전히 광고함에 갇힌 것: Stripe «likely-fraudulent payment blocked»·«Unrecognized device» · 넷플릭스 결제 실패·계정 보류 ·
시프티 카드 결제 실패 · Time Fibre «Payment Overdue» · Shopee «Action Required: Tax e-Invoice» · Tally 정보 유출 ·
Google Admin «security risks» · Codemagic «Build FAILED» · Airbnb 예약 문의·예약 요청(수십 건).

## 3. 제안 (Opus) — Fable 설계 판정 대상

| # | 바꾸는 것 | 시뮬 결과 (현재 → 제안, 열린 스레드 기준) |
|---|---|---|
| A | ESP 헤더 5종 = **marketing 이 아니라 automated** (`isMarketing` 에서 빼고 `isAutomated` 로) — 그러면 기존 «자동이어도 내용이 업무면 확인 권장»(`BUSINESS_RELEVANT`) 길을 탄다 | 자동·마케팅 → 확인 권장 **273** (위 목록). 답변 필요로 가는 것 **0** |
| B | 판정 본문 = `body_text ‖ htmlToText(body_html)` — 수집·재판정 **같은 함수** | A 와 합쳐 +1. 단독 +5. 오탐 1: Grab 프로모션 «Verify your identity» → security_code |
| A' | `BUSINESS_RELEVANT` 에 가입·등록 완료 요청: `complete (the|your) … (process|registration|sign up|application|onboarding|verification)` · `(online|registration|application) form` | GFM 메일이 «확인 권장(automated_relevant)» 으로 (A 만으로는 자동함에 남는다 — gfmsupport@ 는 사람 주소 판정 실패, 본문에 기존 업무 단어 없음) |
| C | 새 술어 `CRITICAL_NOTICE` — **triage 와 무관하게**(스팸·제목 `(광고)` 제외) 확인 권장. 보안 코드와 같은 자리. 결제 실패/거절·연체/미납/overdue·사기 결제 차단·action required/조치 필요·계정 보류/정지/잠금·정보 유출·낯선 기기 로그인·security incident/risk·예약/숙박 문의·요청·build failed | 자동·마케팅 → 확인 권장 **47**, 육안 전수 **오탐 0** |

**합계: 자동·마케팅 → 확인 권장 약 320건 · 답변 필요 승격 0 · 강등 0.** (dev 열린 스레드 6,289 중)

### 정하지 않은 것 (Fable 에게)
1. A 로 확인 권장에 오는 273건 중 Grab 주간 리포트(매주)·Roblox 영수증 같은 **반복 거래 알림**이 확인 권장을 채운다. 이는 기존 정책(«돈이 움직인 알림은 자동이어도 본다», 2026-07 Irene)의 결과다 — 그대로 둘지, `receipt`·`report is ready` 를 약하게 둘지.
2. C 를 subject+본문 앞 1500자로 볼지 제목만으로 볼지(본문은 HTML 푸터 상투구 위험).
3. 운영 적용 범위 — 새 메일만 / `scripts/retriage-mail.js` 로 열린 스레드 재판정(이미 «확인 완료»·규칙·담당 지정은 안 건드림).

## 4. 검증 계획
- dev 전수 before/after 플립: `해제→답변필요` 0 · 강등 0 · 승격 목록 육안 전수.
- 양성 대조: G4049 메일(8523) · Claude API 차단(4093) · Stripe 사기 차단(338) → 확인 권장.
- 음성 대조: `(광고)` 제목 · 순수 뉴스레터(List-Unsubscribe + 업무 단어 없음) → 자동·마케팅 그대로.
- 운영: 읽기 전용 시뮬(운영 SSH 읽기가 이 방에서 권한 거부 — Irene 허락 필요).

## 5. Fable 판정 (2026-10-11) · 구현 · 검증 [Opus]

**판정**: A 채택(V4 — ESP 헤더는 빼기만 하지 말고 **automated** 로. 빼기만 하면 영수증 2건이 답변 필요로 오승격) · B 채택(`triageBodyOf` 한 함수) ·
A' 채택 · C 수정 채택(**제목만** · 제외는 `hasAdPrefix`+스팸 · `critical_notice` · 새 로그인 패턴은 SECURITY_CODE 로 · payout·credit note 등은 BUSINESS_RELEVANT 로) ·
반복 거래 알림(adaptispay 160건)은 기준이 아니라 **발신자 규칙** 몫 · 운영 재판정은 **승격 전용**(`--promote-only`).

**구현**: `services/emailTriage.js` — `hasEspHeader`(isAutomated 로) · `triageBodyOf`(HTML 인용 잘라냄) · `CRITICAL_NOTICE`/`isCriticalNotice`(두 경로) ·
BUSINESS_RELEVANT·SECURITY_CODE 추가 · 사람 메일은 답변 필요 판정이 먼저(C 는 확인 권장 사유 라벨만). 호출부 `emailImapCron`·`retriage-mail.js`·`mailSpamRelease`.
`retriage-mail.js --promote-only`(자동·마케팅 → 확인 권장 행만 씀). 라벨 ko/en `uncertain.critical_notice`·`security_code`.

**검증(dev 실코드)**
- 전수 6,160 열린 스레드: 자동·마케팅 → 확인 권장 **357** · →답변 필요 **0** · 답변 필요→ **0** · 확인 권장→자동·마케팅 **0**. 새 항목 육안 전수 — 오탐 1(Grab 프로모 «Verify your identity», Fable 허용).
- 양성 7건(8523·4093·338·5309·5827·4436·3874) 전부 확인 권장. 카나리 `--suite mail` 23/23(새 7: GFM 형태 · 수신거부+결제 실패 · `(광고)`+action required 음성 · 뉴스레터 음성 · 아는 상대 HTML 답장 유지 · 헤더 없는 경로 C·보안).
- 대조군: C 술어를 끄면 critical_notice 115 → 0, 338 이 광고함으로 돌아감.
- 반증으로 버린 것: 평문 인용 줄(`>`)을 대량 판정에서 빼기 → WordPress 플러그인 심사 «자동 접수 확인» 6건 오승격. 되돌림.
- dev 적용: `--promote-only --apply` 388건(전부 승격). 원복 사본 `~/.claude/jobs/534adfe0/tmp/before-apply.json`.

**남은 구멍(기록만)**: 아는 상대의 **평문** 답장이 인용한 수신거부 링크로 답변 필요에서 빠짐(기존) · 7415 «Hi sir do you need kitchen staff» 오승격(기존) ·
발신자 규칙(`mailSenderRules`)의 본문 키워드는 아직 HTML 전용 메일 본문을 못 본다 · 운영 읽기 전용 시뮬 미실시(이 방 운영 읽기 권한 거부).
