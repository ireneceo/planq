# 메일 분류 기준 고도화 — 답변 필요 넓히기 · 기준 공개 · 학습 확대 · Q sale 같은 방식 (설계 판정)

> 작성: Fable 설계 판정, 2026-10-15. **권고가 곧 결정이다** — Irene 에게 다시 묻지 않고 그대로 구현한다.
> 입력: 정찰 계획 `.claude/plans/qmv7ly27u.md` · 지난 점검 `docs/MAIL_TRIAGE_AUDIT_2026-10-11.md`(Fable A·B·C) ·
> `docs/SALES_INTAKE_DESIGN.md`(#449·#450) · CLAUDE.md «상담에 무엇이 들어오는가는 관계로 가른다» · «Q mail 폴더·배지 계약».
> 근거 숫자는 전부 **dev DB 읽기 전용 실측**(planq_dev_db, 2026-10-15 — 운영과 같은 메일 계정이 동기화된다. 사업장 3·5, 스레드 6,500여 건).
>
> Irene 원문(2026-10-15):
> *"이런 메일이 왔었는데 내가 미싱했어. 너가 답변필요에 안 넣어줘서. [Aspiration 학교 자동응답] 메일 답변필요는 자동메일이 아닌데 상대가 어떤 안내 및 요청, 문의를 하면 무조건 가야 해. 자동메일이어도 주문이 들어왔다. 답변이나 문의가 왔다 같은 안내는 무조건 답변필요에 가야 해. 그리고 확인권장에는 스팸이어도 소통이 필요한 경우나 중요한 내용으로 판단되는 우리 업무랑 관련깊은 일, 또 답변필요로 보내기 애매하지만 중요한 거 등 제대로 나열해 줘야 해. 이에 대한 상세 조건들을 모두 설정에 나오게 하고 우리끼리 가지고 있지 말고 투명하게 공개하자. 그리고 그에 대해 학습하며 업데이트 하는 걸 안내하고 싫으면 삭제하고 추가도 할 수 있게 하자. 이건 이메일도 그렇고 Q sales 리스트도 그렇게 하자. 고도화 작업 해줘."*

---

## 0. 결론 (10줄)

1. **놓친 메일의 원인은 하나다** — 자동응답(`Auto-Submitted: auto-replied`)에 붙은 `Precedence: bulk` 를 **광고**로 읽어 «자동·마케팅» 폴더에 묻었다. 자동응답은 광고가 아니라 **접수 확인**이다 → 새 기준 `auto_ack` 로 **확인 권장**에 올린다(①).
2. **«상대 행동 도착 알림»** 을 새 기준으로 만든다 — 새 주문·새 문의·새 메시지·답변 도착. 발송 방식(자동)과 무관하게 **답변 필요**. dev 실측 23건 전부 진짜(With Min 주문 8 · K-BIZ Hub 문의 9 · tidio 티켓 4 · 와디즈 답변 도착 2), 오탐 0. 단 **우리 시스템(PlanQ)이 보낸 알림은 제외**(148건 — 앱 안에서 이미 알린다. 2026-10-02 «답변 필요 116건 중 93건이 자기 알림» 의 교훈).
3. **역할 주소(`helpdesk@`·`mail@`)의 안내는 10-02 결정 그대로 확인 권장**(④). 뒤집으면 dev 에서 **950건**이 답변 필요로 올라가고, «강한 요청 문장» 으로 좁혀도 220건 중 진짜는 세무사 2건뿐이다. Irene 이 놓친 메일은 이 축이 아니라 ①·② 로 잡힌다. 역할 주소를 꼭 받아야 하는 곳(세무사 등)은 **학습(답변 필요로 2회) 또는 규칙**이 길이다.
4. **«우리 업무 관련»·«스팸 구제» 는 관계(주소)로만** — 고객·멤버·우리가 답한 주소가 스팸 판정이면 확인 권장(`spam_rescue`). 이름·업종 키워드 매칭은 넣지 않는다(개인 주소 모양의 스팸 30건은 전부 콜드메일 — 모양으로 구제하면 스팸이 되살아난다). LLM 0 유지.
5. **기준 카탈로그 한 벌** — `services/mailCriteriaCatalog.js` 가 기준 id·폴더·끌 수 있는지·정규식을 들고, **판정 엔진과 설정 화면이 같은 목록을 읽는다.** 설명 문구는 id → i18n 키(ko/en). 내장 기준 끄기는 `businesses.permissions.mail_criteria.off[]`(새 표 0, `sales_intake` 와 같은 자리). **왜 이 폴더에 왔나** 는 새 컬럼 `email_threads.triage_criterion` 하나가 말한다(적중 수·행 표시·되돌리기의 근거).
6. 끄는 사람은 **owner/admin**, 보는 사람은 Q mail 읽기 권한 전원. 사용자 규칙(주소·문구) 추가·삭제는 종전대로 멤버(qmail write).
7. **학습 확대** — «답변 필요로» 2회 → 그 주소 `always_reply`, 새 액션 «확인 권장으로» 2회 → `review`. 반대 신호가 오면 즉시 해제(답장 ↔ 답변 불필요 와 같은 원리). 안내는 토스트가 아니라 **그 폴더 머리의 한 줄**(«방금 학습했어요 · 설정에서 보기 · 되돌리기») + 설정의 «학습된 규칙» 목록.
8. **Q sale 도 같은 카탈로그 부품**으로 — 상담 유입 기준 6개를 공개하고, `replied`·`personal` 두 개만 끌 수 있고, 추가는 **주소·도메인만**(`sales_intake.domains.always/never`). 키워드 규칙·자동 학습은 넣지 않는다(09-16·17 결정 유지).
9. 운영 적용은 **승격 전용 재판정**(자동·마케팅 → 확인 권장 · 확인 권장/자동 → 답변 필요는 `inbound_action` 만) + 읽기 전용 시뮬 먼저. 확인완료·답변 완료·규칙·담당 지정·손으로 올린 건은 건드리지 않는다. 스키마는 컬럼 1개(`triage_criterion`) 멱등 마이그레이션, 배포 슬롯.
10. 범위 밖: 기준별 **목적지 바꾸기**(답변 필요↔확인 권장) · 고객/프로젝트 **이름** 매칭 · Q sale 자동 학습 · 자동응답을 **원 스레드에 붙이기**(threading) · 사람 메일의 역할 주소 재판정.

---

## 1. 실측 — 무엇이 어디에 있었나 (dev, 읽기 전용)

### 1.1 신고 메일 (Aspiration 자동응답)

| msg | thread | 방향 | 보낸 사람 | 헤더 | 저장 판정 |
|---|---|---|---|---|---|
| 9577 | 8909 | 보냄 | irene@gitconsulting.group | — | (우리가 보낸 원 메일) |
| **9576** | **8908** | 받음 | studenthelpdesk+canned.response@ | `Auto-Submitted: auto-replied` · `Precedence: bulk` · **In-Reply-To 없음** | triage=`marketing` · 자동·마케팅 폴더 ← **신고의 그 메일** |
| 9592 | 8909 | 받음 | studenthelpdesk@ (사람) | — | 답변 필요(①회신) → Irene 답장 → `replied` |
| 9653 | 8909 | 받음 | +canned.response@ | 같은 자동응답 | 스레드에 붙었으나 폴더 변화 없음 |

- 코드 경로: `emailTriage.js isMarketing` 이 `precedence bulk` → marketing 확정 → `isAutomated` 를 안 탄다 → 내용 승격(`BUSINESS_RELEVANT`)도 automated 전용이라 못 탄다 → 어디에도 안 올라옴.
- dev 전체에서 `auto-replied` 헤더가 붙은 받은 메일은 **Aspiration 자동응답 7스레드 + 반송(DSN) 2스레드**뿐 — 작고 안전한 집합이다.
- 자동응답 9576 은 In-Reply-To·References 가 없어 원 스레드(8909)에 못 붙었다. 이건 분류가 아니라 **스레딩** 문제 — 범위 밖(§8).

### 1.2 분포 (열린 스레드)

| 축 | 수 | 뜻 |
|---|---|---|
| 사람 메일인데 요청·질문이 뚜렷하지 않음(`human/uncertain/unclear_intent`) | **1,017** | 그중 역할 주소 **950** · 개인 주소 38 · 발송전용 29 |
| 위 950 중 «강한 요청 문장» 포함 | 220 | help@irenewp.com(우리 시스템) 다수 · 삼성생명 자동이체 · 홈택스 · 뉴스레터 테스트 · **진짜 요청은 세무사(jisungtax 2·zenithtax 1)** |
| 위 950 중 «아는 회사 도메인»(고객·멤버·우리가 보낸 도메인, 자기 도메인 제외) | **2** | 도메인 관계 기준은 효과 0 — 넣지 않는다 |
| 스팸 204 중 아는 상대(고객·멤버·우리가 보낸 주소) | 4 | 전부 help@wor-pro.com(우리 시스템이 보낸 WP 알림) — 구제 대상이 맞다 |
| 스팸 204 중 **개인 주소 모양** | 30 | 전부 콜드메일(gitex·컨설팅·«I rebuilt your site») — **모양으로 구제하면 스팸이 되살아난다** |
| 스팸 204 중 메일 서버 스팸 점수(X-Spam-*) 있는 것 | **0** | 지금 스팸은 전부 자체 키워드 룰 판정 — 약하다. 구제는 관계로만 |
| 「상대 행동 도착」 정규식 적중(열린 스레드) | 23 (4묶음) | With Min 새 주문 8 · K-BIZ Hub 폼 문의 9 · tidio 새 티켓 4 · 와디즈 «답변이 도착했어요» 2 — **오탐 0**. 우리 시스템 발신 148 제외 · 구매자 알림(«your order…») 9 제외 |
| 고객 회사명·프로젝트명이 자동·마케팅 제목에 들어간 것 | 0 | dev 고객·프로젝트는 시험 데이터라 **판단 근거가 못 된다** — 그래서 이 축은 미룬다(§8) |

### 1.3 지금 있는 부품 (새로 만들지 않는다)

| 부품 | 위치 | 이번에 하는 일 |
|---|---|---|
| 판정 단일 원천 | `services/emailTriage.js` (`triageInbound`·`retriageStored`·`needsReply`) | 정규식 상수를 **카탈로그로 옮기고** 끄기(off)를 받는다 |
| 사용자 규칙(학습) | `models/MailSenderRule.js` · `services/mailSenderRules.js` · `routes/mail_rules.js` | 학습 신호 2개 추가 · 반대 신호 해제 |
| 설정 화면 | `pages/Settings/MailRulesSection.tsx`(4줄 요약 :157~169) | 요약을 **카탈로그 목록**으로 바꾼다 |
| Q sale 기준 | `services/saleMailCriteria.js` · `contactRelation.js` · `salesIntake.js` · `components/Permissions/SalesIntakeSection.tsx` | 이유 5개를 카탈로그로 공개 · 끄기 2개 · 도메인 추가 |
| 재판정 | `scripts/retriage-mail.js --promote-only` | 승격 축 하나 더(`inbound_action` → 답변 필요) |
| 카나리 | `scripts/e2e/canary-mail-triage.js`(실 mailparser) · `canary-sale-criteria.js` · `canary-maillabel.js` | 새 기준 양성·음성 대조군 추가 |

---

## 2. 결정 ① ~ ⑤ (정찰 §6)

### ① 자동응답(«메일 잘 받았습니다») — **확인 권장**, 기준 `auto_ack`(«접수 확인»)

- 왜 답변 필요가 아닌가: 답장할 상대가 없다. 답변 필요는 «확실히 답해야 하는 것» 이라는 폴더 계약(CLAUDE.md)을 지킨다. 답변 필요에 두면 사람이 «답변 불필요» 로 내리는 수고가 생기고, 두 번 내리면 그 주소가 `no_reply` 로 학습돼 **다음 자동응답은 아예 안 보인다** — 더 나쁜 결과다.
- 왜 자동·마케팅이 아닌가: «상대가 내 메일을 받았다» 는 사실은 **봐야 하는 정보**다(Irene 이 놓쳤다고 신고한 것이 이것이다). 확인 권장이 바로 «답장할 상대는 없지만 봐야 하는 것» 의 자리다.
- 판정: `Auto-Submitted: auto-replied` · `X-Autoreply`/`X-Autorespond` 헤더 **또는** 제목 `automatic reply|auto-?reply|out of office|자동\s*(응답|회신)|부재중` **또는**(triage 가 human 이 아닐 때만) 본문 앞 600자 `we have received your (e-?mail|message|enquiry|inquiry|request)|thank you for (reaching out|contacting|your (e-?mail|message|enquiry|inquiry|request))|문의(가|를)?\s*(접수|잘 받았)|메일(을|이)\s*잘 받았|접수되었습니다|제출해 주셔서 감사`.
  - 사람 메일(human)에는 본문 패턴을 쓰지 않는다 — 사람이 «Thank you for contacting us, …» 로 시작하는 진짜 답장을 자동응답으로 내리면 안 된다. 사람 메일은 `needsReply` 가 먼저다(지금 순서 그대로).
  - 반송(`isBounce`)은 제외 — DSN 도 `auto-replied` 를 단다.
- `isMarketing` 수정: `Precedence: bulk|list|junk` 는 **`Auto-Submitted` 가 없을 때만** 광고 증거다. 자동응답이면 automated 로 떨어뜨린다(10-11 Fable A 가 ESP 헤더를 옮긴 것과 같은 논리).
- 시뮬 기대값: 8908·7808·7468·3475 → 확인 권장(`auto_ack`) · Apple «지원 요청을 제출해 주셔서 감사합니다»(5599·5600, 지금 자동함) → 확인 권장. 답변 필요로 가는 것 0.

### ② «우리 업무와 관련 깊음» 의 근거 — **주소 관계만. 이름·업종·Q info 는 보지 않는다. LLM 0 유지**

- 근거 후보를 재 봤다: 고객·프로젝트 **이름** 매칭은 dev 에서 판단할 수 없다(시험 이름뿐, 적중 0). 운영 이름은 «MIN»·«K-DINE» 처럼 짧은 브랜드가 많아 **광고 제목에 걸리기 쉽다**. «아는 회사 도메인» 은 자기 도메인을 빼면 적중 2 — 효과가 없다. 워크스페이스 업종 칸은 없다.
- 그래서 «관련 깊음» 은 이미 있는 **주소 관계**(고객·멤버·우리가 답한 주소 = `isKnownContact`)와 **사용자가 선언한 규칙**(주소·도메인·문구)으로만 판정한다. 이름 매칭은 운영 이름으로 읽기 전용 시뮬을 돌려 **오탐이 0 일 때만** 다음 사이클에 넣는다(§8).
- 확인 권장의 «나열» 은 기준 카탈로그(§3)가 한다 — 사용자가 설정에서 어떤 조건이 확인 권장을 만드는지 전부 읽을 수 있다. 이것이 «제대로 나열해 줘야 해» 의 답이다.

### ③ 스팸 구제 — **아는 상대(고객·멤버·우리가 답한 주소)만 확인 권장으로**, 기준 `spam_rescue`

- 스팸 판정이어도 `isKnownContact` 가 참이면 `status='uncertain'`·`uncertain_reason='spam_rescue'`·triage 는 `spam` 그대로(폴더는 확인 권장, 스팸 뱃지는 남긴다 — 왜 왔는지 보인다).
- **개인 주소 모양·이름 매치·문구로는 구제하지 않는다** — 개인 주소 모양 스팸 30건 전부 콜드메일. 09-17 «확인완료 48건 부활» 과 같은 사고가 난다.
- 사용자 규칙 `review`·`always_reply` 는 이미 스팸을 올린다(`applyRules`) — 그대로.
- 자기 주소(ownEmails)는 아는 상대로 치지 않는다(우리가 우리에게 보낸 테스트가 구제되면 안 된다). dev 의 4건은 help@wor-pro.com 이 **다른 사업장(5)의 연결 계정이 아닌 경우**만 구제된다 — 시뮬에서 수를 확인한다.

### ④ 역할 주소의 «안내» — **10-02 결정 유지(확인 권장). 뒤집지 않는다**

- 원문 «자동메일이 아닌데 상대가 어떤 안내 및 요청, 문의를 하면 무조건» 을 역할 주소에 그대로 적용하면 dev 950건이 답변 필요로 올라간다 — 삼성생명 자동이체 결과·홈택스 통지·은행 명세·뉴스레터·TestFlight. 헤더가 없어 사람 메일로 보이는 **자동 통지**가 대부분이다. 「강한 요청 문장」 으로 좁혀도 220건 중 진짜는 3건. 뒤집으면 답변 필요가 확인 권장이 된다.
- Irene 이 놓친 것은 **역할 주소의 사람 메일이 아니다**: 그 학교의 사람 답장(9592)은 ①회신으로 답변 필요에 들어갔고 Irene 이 답장했다. 놓친 것은 **자동응답**(결정 ①) 이다.
- 그래도 역할 주소에서 오는 «꼭 받아야 하는 사람 메일»(세무사 `mail@jisungtax.com` «[요청] 부가가치세 자료 요청» 등)은 있다. 길은 둘: **학습**(그 주소를 «답변 필요로» 2회 → `always_reply`, §5) · **규칙**(도메인 `jisungtax.com` → 항상 답변 필요). 설정 화면의 `direct_request` 기준 설명에 이 길을 적는다(«역할 주소(info@·help@)는 확인 권장으로 — 꼭 받아야 하는 곳은 2번 올리면 배웁니다»).
- 단 ②번 결정의 **상대 행동 도착 알림**(`inbound_action`)은 역할 주소·자동 발신이어도 답변 필요다(With Min `help@withmin.info` 새 주문이 바로 그 모양). 이것이 원문 «자동메일이어도 주문이 들어왔다·답변이나 문의가 왔다는 안내는 무조건 답변필요» 의 구현이다.

### ⑤ 내장 기준 끄기 권한 — **owner/admin**(워크스페이스 관리자 포함). 보기는 Q mail 읽기 권한 전원

- 내장 기준 하나를 끄면 **워크스페이스 전원의 폴더**(개인 계정 포함)가 바뀐다 — 워크스페이스 정책이다. 사용자 규칙(주소·문구 하나)은 좁은 추가라 종전대로 멤버(qmail write)가 한다.
- 판정 함수 하나: `middleware/access_scope.getUserScope` 의 `isOwner || isAdmin || isPlatformAdmin`. 화면도 같은 값(`business_role in owner/admin`).
- Q sale 카탈로그는 그 카드가 이미 쓰는 `assertEntryAdmin`(owner) 그대로 — 한 카드에 두 판정을 두지 않는다.

---

## 3. 기준 카탈로그 — 엔진과 화면이 같은 목록을 읽는다

### 3.1 파일과 모양

`dev-backend/services/mailCriteriaCatalog.js` (새 파일, 정규식 상수가 **여기로 이사**한다 — emailTriage 는 카탈로그를 읽어 판정)

```js
// 한 항목
{ id: 'inbound_action', folder: 'reply',            // reply | review | demote | spam
  lockable: false,                                  // true = 끌 수 없음(보이기만)
  order: 40,                                        // 엔진 적용 순서 = 화면 순서 (아래 §3.3)
  test: ({ subject, body, headers, fromEmail, ctx }) => boolean,   // 판정 함수(정규식·헤더)
  examples: ['[With Min]: New order #3171', 'New message from "K-BIZ Hub"'],  // 화면 예시(언어 무관 실제 모양)
}
// 설명 문구는 코드에 없다 — i18n 키 qmail:criteria.<id>.{title,desc,hint} (ko/en 둘 다, 패리티 가드)
```

- `listCatalog()` → 전체 배열(화면용 메타: id·folder·lockable·order·examples). `activeCatalog(off[])` → 엔진용(꺼진 것 제외).
- **끄기 저장**: `businesses.permissions.mail_criteria = { off: ['auto_ack', …] }`. 모양은 `services/mailCriteria.js normalizeMailCriteria()` 한 함수(모르는 id·`lockable` id 는 버린다 — fail-closed, `salesIntake.normalizeIntake` 와 같은 방식). 읽기는 30초 캐시(수집 cron 이 메일마다 Business 를 읽지 않게), 저장 라우트가 `invalidate(biz)`.
- **왜 이 폴더에 왔나**: `email_threads.triage_criterion VARCHAR(40) NULL` — 폴더를 **결정한** 기준 id(답변 필요·확인 권장·자동·마케팅·스팸 전부). `threadFieldsForInbound` 와 재판정이 쓴다. 사용자 규칙이 결정했으면 `rule`(기존 `rule_id` 가 어느 규칙인지 말한다), 사람이 손으로 올렸으면 `manual`.
  - 기존 `uncertain_reason` 은 **그대로 둔다**(화면 칩·폴더 라벨·`billing/quote/review` 스팸 사유가 읽는다). 새 확인 권장 기준은 지금처럼 `uncertain_reason = 기준 id` 도 같이 쓴다. 두 칸이 겹치는 것은 알고 두는 것이다 — `triage_criterion` 은 **모든 폴더**를 말하고 `uncertain_reason` 은 확인 권장만 말한다. 다음 사이클에 칩이 `triage_criterion` 을 읽게 되면 `uncertain_reason` 의 기준 id 쓰기는 멈춘다(지금 지우지 않는다).
  - 적중 수 = `SELECT triage_criterion, COUNT(*) … WHERE business_id=? AND last_message_at >= 30일 전 GROUP BY` — 카운터 컬럼 없음(`mail_sender_rules.hit_count` 처럼 매 메일 UPDATE 하지 않는다).
- **새 표는 만들지 않는다.** `mail_sender_rules` 에 `pattern_type='builtin'` 을 끼우는 것도 하지 않는다(verdict ENUM 에 «끔» 이 없고, 규칙 삭제=복구 계약과 섞인다).

### 3.2 카탈로그 전체 (화면에 이 순서·이 묶음으로 보인다)

**답변 필요** — 사람이 답해야 하는 것
| id | 기준 (일상어) | 끄기 | 비고 |
|---|---|---|---|
| `thread_reply` | 우리가 보낸 메일에 온 회신 | 잠김 | 발신자가 자기 도메인으로 지어낸 회신 헤더는 제외(기존) |
| `known_contact` | 아는 상대(고객·멤버·전에 우리가 답장한 주소)가 직접 쓴 메일 | 잠김 | 대량·자동 발송은 관계보다 먼저 걸러진다(기존) |
| `inbound_action` **신규** | **상대의 행동이 도착했다는 알림** — 새 주문·새 문의·새 메시지·새 예약·답변 도착(«문의하신 내용에 답변이 도착», «New order #», «New message from», «You have a new ticket») | 가능 | 자동 발송이어도 올린다. **제목만** 본다. 제외: 우리 시스템 발신(`isFromOurPlatform`) · 구매자 알림(`transactional_notice`가 먼저) · 반송 · `(광고)` · 스팸 |
| `direct_request` | 모르는 상대 — 우리 주소로 직접 왔고 **개인 주소**이고 요청·질문이 있을 때 | 가능 | 역할 주소(info@·help@)는 확인 권장으로. 화면 힌트: «꼭 받아야 하는 곳은 «답변 필요로» 를 2번 누르면 배웁니다» |
| `rule_always_reply` | 내가 만든/학습된 «항상 답변 필요» 규칙 | (규칙 목록으로 링크) | |

**확인 권장** — 답장할 상대는 없지만 봐야 하는 것
| id | 기준 | 끄기 | 비고 |
|---|---|---|---|
| `automated_relevant` | 자동 발송이지만 내용이 업무 — 결제·입금·증빙·보고서·서명·계약·발송 실패·가입/등록을 끝내라는 안내 | 가능 | 기존 `BUSINESS_RELEVANT` |
| `platform_notice` **분리** | PlanQ(우리 시스템)가 보낸 알림 | 가능 | 지금은 `automated_relevant` 안에 섞여 있다(`isFromOurPlatform`). 앱 안에서 이미 알리므로 끄고 싶은 사람이 있다 — 그래서 가른다 |
| `security_code` | 로그인·인증 코드 · 비밀번호 재설정 · 새 기기 로그인 · 보안 알림 | 가능 | 기존 |
| `critical_notice` | 결제 실패·연체·계정 보류·정보 유출·빌드 실패·예약 문의 같은 꼭 봐야 하는 통지 | 가능 | 기존(제목만) |
| `auto_ack` **신규** | 자동응답·접수 확인(«메일 잘 받았습니다», 부재중) | 가능 | 결정 ① |
| `spam_rescue` **신규** | 스팸 판정이지만 **아는 상대** | 가능 | 결정 ③. 스팸 뱃지는 남는다 |
| `unclear_intent` | 사람 메일인데 요청·질문이 뚜렷하지 않음(역할 주소 포함) | 잠김 | 답변 필요에서 떨어진 사람 메일의 착지점 — 끄면 갈 곳이 없다 |
| `rule_review` | 내가 만든/학습된 «확인 권장» 규칙 | (링크) | |

**자동·마케팅** — 봐도 할 일이 없는 것
| id | 기준 | 끄기 | 비고 |
|---|---|---|---|
| `ad_prefix` | 제목 맨 앞 `(광고)` 법정 표기 | 잠김 | |
| `bulk_headers` | 수신거부·List-Id·Precedence bulk 헤더(대량 발송) | 잠김 | **자동응답(`Auto-Submitted`)이면 여기 안 걸린다**(결정 ①) |
| `bulk_body` | 본문에 수신거부 링크 | 가능 | |
| `automated_sender` | 발송 전용 주소(noreply·알림)·발송 대행 헤더·Auto-Submitted·소셜 알림 | 잠김 | 끄면 영수증이 답변 필요로 간다(10-11 실측 2건) |
| `transactional_notice` | **내가 산** 주문·배송·결제 확인(«your order», «배송이 시작») | 가능 | 셀러 입장 알림(새 주문)은 `inbound_action` 이 먼저 집는다 |
| `self_sender` | 우리가 보낸 메일이 우리 받은함으로 돌아온 것 | 잠김 | |
| `bounce` | 반송(메일이 안 갔다) | 잠김 | 내용 승격으로 확인 권장에 간다(기존) |

**스팸** — `spam_filter`(스팸 점수) 잠김. 사용자 규칙 `spam`·학습(스팸으로 2회) 은 규칙 목록.

### 3.3 엔진 적용 순서 (= 카탈로그 `order`, 바뀐 자리만)

```
spam_filter → [spam_rescue: 아는 상대면 확인 권장]            ← 신규(스팸 뒤, 나머지 앞)
ad_prefix / bulk_headers(auto-replied 제외) / bulk_body → marketing
automated_sender(+Auto-Submitted) → automated
human 이면 thread_reply · known_contact 먼저(관계 — 2026-10-22 Fable D1)            ← 보안 기준보다 앞
security_code / critical_notice (triage 무관, 기존)
inbound_action (triage 무관, human 이면 needsReply 보다 먼저 — 역할 주소여도 올린다)   ← 신규
auto_ack (triage ≠ human)                                                              ← 신규
automated_relevant · platform_notice (automated 만)
human → needsReply(thread_reply → 성격 필터 → known_contact → direct_request) → 아니면 unclear_intent
```

- 수집(`triageInbound`)과 재판정(`retriageStored`, 헤더 있음)이 **같은 문**인 구조는 그대로. 헤더 없는 옛 메일(`headersComplete=false`)은 지금처럼 저장된 triage 를 믿고 `inbound_action`·`auto_ack`(제목)·`spam_rescue` 만 더 본다.
- **PlanQ 알림 판정은 표식 헤더 `X-PlanQ-Notice`** (2026-10-22 Fable D5, `emailService.sendEmail` 이 단다). 표식 전 옛 메일만 SMTP_FROM 정확 주소(+ 헤더가 있으면 `X-Auto-Response-Suppress`)로 본다. 발신 도메인 일치는 폐지 — 같은 주소를 쓰는 POS·Plesk 알림이 platform_notice 로 확인 권장을 덮고, 그 도메인의 사람이 다른 워크스페이스에서 «우리가 보낸 것» 으로 강등됐다.
- **새 계정 첫 가져오기 뒤 한 번** `mailRetriage.promoteBackfillReplies` — 읽기만 들어온 스레드 중 마지막 받은 메일이 14일 안·마지막이 우리 답장 아님·지금 판정 답변 필요인 것만 올린다(Fable D3). 운영 일회 실행 `scripts/promote-backfill-replies.js --account= --base=`.
- 꺼진 기준은 `activeCatalog(off)` 에서 빠지므로 **그 분기가 없는 것처럼** 돈다. 끄기 → 소급은 §6.

### 3.4 API

| 메서드 | 경로 | 권한 | 하는 일 |
|---|---|---|---|
| GET | `/api/businesses/:biz/mail-criteria` | qmail read | 카탈로그 전체 + `enabled` + 30일 적중 수 + 최근 학습 규칙 3개 |
| PUT | `/api/businesses/:biz/mail-criteria/:id` `{enabled}` | owner/admin | 저장(`normalizeMailCriteria`) → 캐시 무효화 → **소급**(§6.1, `applyRuleToExisting` 과 같은 제외 기준) → 바뀐 건수 응답 → `mail:updated {bulk:true}` 방송 → 감사 `mail_criteria.update` |
| POST | `/api/businesses/:biz/mail-criteria/:id/preview` | qmail read | 저장하지 않고 «끄면/켜면 지금 받은 메일 N건이 어디로 옮겨지는지» 세어 준다(규칙 미리보기와 같은 계약 — 수백 건이 옮겨진 뒤 아는 것은 확인이 아니다) |
| POST | `/api/businesses/:biz/email-threads/:id/mark-review` **신규** | qmail read | «확인 권장으로» — `status='uncertain'`·`uncertain_reason='manual'`·`triage_criterion='manual'`·reply_needed false. 학습 신호(§5). 폴더 정의가 uncertain 을 포함하므로 바로 보인다 |

### 3.5 화면

- **메일 분류 기준** = `MailRulesSection` 의 4줄 요약(:157~169) 자리를 카탈로그 목록으로 바꾼다 — 폴더별 묶음(답변 필요 / 확인 권장 / 자동·마케팅 / 스팸), 각 기준 한 줄 설명 + 예시 1~2개(접기) + 적중 수(«30일 N건») + 스위치(`AutoSaveField type="toggle"`, 잠김은 스위치 대신 «기본» 글자). 끄기 전에 미리보기 수를 같은 줄에 보여 주고(«끄면 12건이 자동·마케팅으로 옮겨집니다») ConfirmDialog 로 묻는다 — 0건이면 묻지 않는다.
  - 머리에 **학습 안내 한 단락**: «PlanQ 는 여러분이 누르는 것을 보고 배웁니다 — 같은 보낸 사람을 두 번 «답변 불필요» 하면 답장 안 해도 되는 곳으로, 두 번 «답변 필요로» 올리면 항상 답변 필요로, 두 번 «확인 권장으로» 올리면 확인 권장으로. 배운 규칙은 아래 목록에 전부 보이고 언제든 지울 수 있습니다. 규칙을 지우면 원래대로 돌아갑니다.» (`feedback_rules_must_be_explained_briefly` — 더 길게 쓰지 않는다)
  - 기준 목록이 400줄을 넘기므로 `pages/Settings/MailCriteriaList.tsx` 로 뺀다. **Q sale 카드가 같은 컴포넌트를 쓴다**(`items`·`canEdit`·`onToggle` props).
  - 규칙 추가 폼·규칙 목록은 그대로. 학습된 규칙 행의 근거 문구에 `mark_reply_x2`·`mark_review_x2` 를 추가.
- **Q mail 목록/상세**: 자동·마케팅 폴더 행에 «확인 권장으로» 버튼(«답변 필요로» 옆, 같은 톤·같은 자리). 상태 뱃지와 행위 버튼은 **글자가 다르다**(«확인 권장» vs «확인 권장으로» — 09-17 계약).
- **폴더 머리 한 줄(학습 안내)**: 답변 필요·확인 권장 폴더 머리에 «방금 «x@y» 를 답변 필요로 학습했어요 · 설정에서 보기 · 되돌리기»(되돌리기 = 그 규칙 DELETE, 기존 복구 경로). 세션 동안 또는 ✕ 까지 남는다. 토스트 아님.
- **확인할 곳**: https://dev.planq.kr/business/settings/mail-accounts (메일 분류 기준·학습 안내) · https://dev.planq.kr/business/settings/permissions (상담 유입 기준) · https://dev.planq.kr/mail (자동·마케팅 폴더 «확인 권장으로», 폴더 머리 학습 줄).

---

## 4. 새 범주 정의 (정규식은 **제목만**, 보안 코드·꼭 봐야 하는 통지와 같은 원칙)

### 4.1 `inbound_action` — 상대 행동 도착 알림 (→ 답변 필요)

- 영어: `\bnew (order|orders|message|messages|inquiry|enquiry|lead|booking|reservation|request|review|comment|submission|form (entry|submission)|contact|application|appointment|quote request|question|chat|ticket|reply|response)\b` · `\byou have (a |an |\d+ )?new\b` · `\b(has|have) (replied|responded) to (you|your)\b` · `\breplied to your\b` · `\bsent you a (message|request|quote|inquiry|enquiry)\b` · `\bcontact form\b` · `\bform submission\b` · `\byou (have )?received (a |an )?(new )?(order|inquiry|enquiry|message|booking)\b` · `\border (received|placed) by\b`
- 한국어: `새(로운)?\s*(주문|문의|예약|메시지|메세지|신청|리뷰|후기|댓글|상담|견적\s*요청)` · `(문의|예약|신청|주문|상담|견적|리뷰|후기)(이|가)?\s*(접수|등록|도착|들어왔)` · `답변이\s*(등록|도착|달렸)` · `문의하신 내용에 답변` · `회신이?\s*도착` · `님이\s*(답변|회신|메시지|댓글|문의)`
- 적용: triage 무관(automated·marketing·human). **먼저 거르는 것**: `isFromOurPlatform`(PlanQ 알림 148건 — 앱 안에서 알린다) · `isTransactionalNotice`(구매자 알림 «your order…has been delivered») · `isBounce` · `hasAdPrefix` · 스팸.
- 결과: `reply_needed=true` · `reply_needed_reason='inbound'` · `triage_criterion='inbound_action'` · status open. 자동 발신이어도 **답변 필요 폴더**(폴더 정의는 `reply_needed=1 ∧ status∈open/uncertain` 이라 triage 를 바꾸지 않아도 보인다).
- 받고 싶지 않은 알림은 그 주소에 «답변 불필요» 2회(기존 학습) 또는 이 기준 끄기.
- PurpleHere 의 «New Inquiry:» 는 우리 시스템 발신이라 제외된다 — 받고 싶으면 문구 규칙 `New Inquiry:` → 항상 답변 필요(기존 기능). 기준 설명에 이 예를 적는다.

### 4.2 내가 산 주문 ↔ 우리에게 들어온 주문

| 모양 | 뜻 | 기준 |
|---|---|---|
| «Your order #… has been delivered/shipped/confirmed», «주문하신 내역», «배송이 시작» | 내가 **산** 것 | `transactional_notice`(자동·마케팅) — 먼저 판정 |
| «New order #…», «새 주문», «주문이 들어왔습니다», «You received a new order», «Order placed by» | 우리에게 **들어온** 것 | `inbound_action`(답변 필요) |
| 둘 다 아닌 «Order Confirmed: PO-…»(우리 시스템) | 우리 시스템 발신 | `platform_notice`(확인 권장) |

`TRANSACTIONAL_NOTICE` 의 `'주문(이)? (완료|접수|확인)'` 은 «주문이 접수» 가 셀러 알림과 겹친다 → `주문(이|을)?\s*(완료|확인)` 으로 좁히고 «접수» 는 `inbound_action` 쪽(`주문이 접수`)에 둔다. 양성 대조: With Min 8건 → 답변 필요 / Shopee «Your order … delivered» → 자동·마케팅 그대로.

### 4.3 `auto_ack` — 결정 ① 그대로(§2①).

### 4.4 확인 권장 재정의 (화면 문구)

«확인 권장 = 답장할 상대는 없지만 **한 번은 봐야 하는 것**. ① 자동 발송이지만 내용이 업무(결제·증빙·보고서·서명·가입 완료 요청) ② 우리 시스템 알림 ③ 로그인·인증·보안 알림 ④ 결제 실패·연체·계정 보류 같은 꼭 봐야 하는 통지 ⑤ 자동응답·접수 확인 ⑥ **스팸 판정이지만 아는 상대** ⑦ 사람이 보냈는데 요청·질문이 뚜렷하지 않은 것(역할 주소 포함) ⑧ 내가 만든 «확인 권장» 규칙.» — 이 8줄이 카탈로그 확인 권장 묶음과 **1:1** 이다(설명과 코드가 갈라지지 않게 화면은 카탈로그를 그린다, 글을 따로 쓰지 않는다).

---

## 5. 학습 확대

| 신호 | 몇 회 | 만드는 규칙 | 범위 | 즉시 해제되는 반대 규칙 |
|---|---|---|---|---|
| «답변 불필요»(dismiss) | 2 (기존) | 주소 `no_reply` | 주소 → 같은 도메인 3개면 도메인 승격(기존) | `always_reply`·`review`(그 주소) |
| «스팸으로» | 2 (기존) | 도메인 `spam` | 도메인 | — |
| **«답변 필요로»**(mark-reply-needed) | **2** | 주소 `always_reply` (`evidence.signal='mark_reply_x2'`) | **주소만**(도메인 승격 없음 — 역할 주소가 많은 회사 도메인 전체를 답변 필요로 만들면 950건 문제가 돌아온다) | `no_reply`·`marketing`·`spam`(그 주소/도메인) — `onReplySent` 와 같은 복구 경로 |
| **«확인 권장으로»**(mark-review, 신규) | **2** | 주소 `review` (`mark_review_x2`) | 주소만 | `no_reply`·`marketing`(그 주소) |
| 답장 보냄 | 1 (기존) | — | — | `no_reply`·`marketing`·`spam` |

- 세는 법: 그 주소의 스레드 중 `reply_needed_reason='manual'`(답변 필요로) · `uncertain_reason='manual'`(확인 권장으로) 수 — dismiss 가 `reply_needed_reason='dismissed'` 를 세는 것과 같은 방식. 벌크 액션은 배우지 않는다(기존).
- 규칙이 생기면 **소급**(`applyRuleToExisting`) — 그 주소의 열린 스레드가 같이 옮겨진다(사람이 판단한 것은 제외, 기존 기준).
- 안내 문구 방향(ko 기준, en 동시 작성):
  - 1/2 진행: 응답 `progress:1` → 폴더 머리 줄 «이 보낸 사람을 한 번 더 «답변 필요로» 올리면 앞으로 자동으로 답변 필요에 둡니다.»
  - 학습됨: «앞으로 «x@y» 메일은 답변 필요에 둡니다 · 설정에서 보기 · 되돌리기»
  - 설정 «학습된 규칙» 근거 문구: «"답변 필요로" 를 2번 올려서 학습됨» / «"확인 권장으로" 를 2번 올려서 학습됨»
- 해제 방법 셋: 설정에서 규칙 삭제(기존 복구) · 폴더 머리 줄 «되돌리기»(같은 DELETE) · 반대 행동 2회(위 표).

---

## 6. 기존 판정 재판정 · 운영 적용

### 6.1 끄기/켜기의 소급 (설정에서)

- 대상 = `threadsMatchingRule` 과 **같은 제외**(archived 제외 · `reply_needed_reason ∉ {dismissed, handled, rule, replied, holding, manual}` · 담당 지정 제외 · `uncertain_reason='manual'` 제외) ∧ `triage_criterion = 그 id`(끌 때) 또는 재판정으로 그 id 가 되는 것(켤 때, 상한 1,000 — 넘으면 «1,000건까지 옮겼어요, 나머지는 새 메일부터» 라고 화면이 말한다. 상한에 닿는 경우 «아직 안 된 것» 술어로 다음 호출이 이어진다 — 09-17 BULK 교훈).
- 끌 때는 **그 기준 없이 다시 판정**해 착지 폴더를 쓴다(`retriageStored` 재사용). «끄면 사라진다» 가 아니라 «끄면 다음 기준이 정한 자리로 간다».
- 사람이 손으로 만든 상태(`manual`·dismissed·handled·규칙·담당)는 어떤 소급에도 안 바뀐다 — 10-11 과 같은 원칙.

### 6.2 운영 재판정 스크립트 (`scripts/retriage-mail.js`)

- `--promote-only` 를 유지하고 **승격 축을 하나 더** 받는다: `--promote-reply-criterion=inbound_action` — 자동·마케팅/확인 권장 → **답변 필요** 로 올라가는 행은 `triage_criterion='inbound_action'` 일 때만 쓴다. 다른 이유로 답변 필요가 켜지는 행(옛 드리프트)은 쓰지 않는다.
- 강등 0 · 답변 필요 해제 0(종전 `--promote-only` 계약). 스팸 → 확인 권장(`spam_rescue`)은 대상에 스팸을 **읽기만** 더해 시뮬 목록에 보이게 하고, 적용은 건수가 10 미만이고 전수 육안 뒤에만.
- 운영 절차: ① 운영 읽기 전용 시뮬(`--list`, 전체 플립 표 저장) ② 승격 목록 **전수 육안**(운영 메일함은 dev 와 같은 계정이라 dev 표와 대조) ③ `--promote-only --promote-reply-criterion=inbound_action --apply` ④ 원복 사본(before-apply.json, 10-11 과 같은 자리).
- 운영 SSH 읽기가 이 방에서 거부되면 §7 의 시뮬은 **Irene 할 일**(상황판 `/api/todos`, `terminal` 명령 그대로)로 올리고 적용은 그 뒤.

### 6.3 스키마 · 설정

- `scripts/migrate-mail-criteria.js`(멱등): `ALTER TABLE email_threads ADD COLUMN triage_criterion VARCHAR(40) NULL` + 인덱스 `(business_id, triage_criterion)`. 백필 없음(NULL = 옛 판정, 적중 수에서 «기준 모름» 으로 센다). 배포 슬롯 등록(`deploy-planq.sh`), **코드 배포 전** 실행(모델이 SELECT 한다).
- 롤백: additive 컬럼 — 코드만 되돌리고 컬럼은 남긴다(모델 선언을 되돌리면 sync 가 DROP 한다 — `migrate-feedback-kind.js` 주석과 같은 경고를 적는다).
- `businesses.permissions.mail_criteria`·`sales_intake.domains` — JSON, 스키마 변경 0. 운영 기본값 = 전부 켜짐 · 도메인 목록 빔.

---

## 7. Q sale 상담 기준 — 같은 카탈로그 부품

### 7.1 공개 목록 (`SalesIntakeSection` 카드 안, 모드 토글 아래)

| id | 기준 | 끄기 | 모드 |
|---|---|---|---|
| `promoted` | 사람이 [상담으로 보내기] 한 메일·채팅 | 잠김 | 둘 다 |
| `replied` | 우리가 한 번이라도 답한 스레드 | 가능 | auto 에서 상담 / manual 에서 「문의 후보」 |
| `personal` | 개인 주소(무료메일 개인 계정 · 회사 도메인의 이름 두 토막 이상)에서 온 사람 메일 | 가능 | 〃 |
| `domain_always` **신규** | 내가 «늘 상담» 으로 등록한 주소·도메인 | (목록) | **둘 다 상담**(사람의 선언 = 올리기와 같은 뜻) |
| `handled_no_reply` | 확인완료했는데 우리가 답하지 않은 것 → 들이지 않음 | 잠김 | 09-17 Fable 차단 그대로 |
| `no_relationship` | 관계 증거 없음 → 들이지 않음 / `automated_sender` 발송 전용 주소 → 어디에도 | 잠김 | |
| `domain_never` **신규** | 내가 «상담 아님» 으로 등록한 주소·도메인 | (목록) | 둘 다 제외(단 `promoted` 는 위) |

- 저장: `businesses.permissions.sales_intake = { mail: 'manual'|'auto', off: ['personal'], domains: { always: ['acme.com', 'kim@x.co.kr'], never: [...] } }` — `normalizeIntake` 가 모양을 정한다(주소/도메인 형식만 통과, 각 50개 상한, 무료메일 **도메인**은 always 에 못 넣는다 — gmail.com 전체가 상담이 된다).
- 판정은 `mailThreadVerdict` 한 곳에 `off`·`domains` 인자를 더한다 — `saleInbox.classifyMailThreads` 가 그대로 부른다(목록·집계·Q mail 「문의」태그 한 벌 유지). 이유 코드 `domain_rule`·`excluded_by_rule` 추가 → 상담 행 이유 칩 ko/en.
- **키워드 규칙은 넣지 않는다**(09-16 결정 — 두 번 샜다). **자동 학습도 넣지 않는다** — 올리기 2회로 도메인을 «늘 상담» 으로 만들면 웹폼 릴레이(`noreply@wix.com`)가 그 자리에 걸린다(#449 D5). 대신 상담 행 ⋯ 에 «이 도메인은 늘 상담으로」 한 번 누르면 `domains.always` 에 들어간다(사람의 선언).
- 권한: 카드 전체가 `assertEntryAdmin`(owner) — 기존 그대로.
- Q sale 설명 머리 한 줄: «상담 목록은 메일 폴더와 다른 질문에 답합니다 — 메일 폴더는 «지금 내 차례인가», 상담은 «영업 관계인가». 그래서 답장한 메일이 폴더에선 빠지고 상담엔 남습니다.»(#450 의 «왜 서로 달라» 를 화면이 말한다)

### 7.2 Q sale 쪽 소급

- 상담 목록은 **원본에서 파생**(표 없음) — 끄기·도메인 추가 즉시 다음 조회에 반영. `mailInquiryTag.invalidate(biz)` 만 부른다. 재판정 스크립트 불필요.

---

## 8. 범위 밖 (미룬다 — 이유와 조건)

| 항목 | 이유 | 다시 보는 조건 |
|---|---|---|
| 기준별 **목적지 바꾸기**(auto_ack 를 답변 필요로 등) | 엔진 순서가 폴더 간 우선순위를 전제한다 — 목적지가 바뀌면 순서 표가 사용자마다 달라져 검증 상태 공간이 폭발한다. 지금은 **켬/끔 + 규칙 추가**로 같은 결과를 낸다 | Irene 이 특정 기준의 자리를 바꿔 달라고 하면 그 기준만 `folder` 선택지로 |
| 고객·프로젝트 **이름** 매칭(«우리 업무 관련») | dev 는 시험 이름뿐이라 오탐을 잴 수 없다(§1.2) | 운영 이름으로 읽기 전용 시뮬 → 오탐 0 이면 `name_match`(확인 권장) 기준 추가 |
| 자동응답을 **원 스레드에 붙이기**(In-Reply-To 없는 auto-ack) | 분류가 아니라 스레딩(`emailImapCron` 매칭)이다. 제목+참여자 매칭을 넓히면 다른 스레드가 섞인다 | 별도 설계 |
| 역할 주소 사람 메일을 답변 필요로 | 결정 ④ — 950건 실측 | 학습·규칙으로 충분하지 않다는 신고가 다시 오면 «아는 회사 도메인» 기준을 운영 시뮬로 재평가 |
| Q sale 자동 학습 · 키워드 규칙 | 09-16·17 결정 유지, 릴레이 주소 함정 | — |
| `uncertain_reason` 를 `triage_criterion` 으로 합치기 | 화면 칩·폴더·스팸 사유가 읽는다. 이번엔 쓰기만 두 칸 | 칩이 `triage_criterion` 을 읽게 바꾼 뒤 |
| 메일 서버 스팸 점수가 전무한 문제(자체 룰만, §1.2) | 다른 일(수집 헤더·IMAP 제공자) | 스팸 오탐 신고 때 |

---

## 9. 구현 순서 (단계별 커밋, 각 단계 끝에 자체 검증 숫자)

1. **카탈로그 뼈대** — `services/mailCriteriaCatalog.js` 로 정규식 이사(동작 불변 리팩터링) · `services/mailCriteria.js normalizeMailCriteria`+캐시 · `email_threads.triage_criterion` 모델/마이그레이션 · `threadFieldsForInbound`·재판정이 기준 id 를 쓴다. **검증: 전수 시뮬 플립 0**(옮기기 전/후 같은 판정) · 카나리 `--suite mail` 그대로 통과.
2. **새 기준 3개 + 수정 2개** — `auto_ack`(isMarketing 의 bulk 예외 포함) · `inbound_action` · `spam_rescue` · `platform_notice` 분리 · `TRANSACTIONAL_NOTICE` «주문 접수» 좁힘. **검증: §10 플립 표.**
3. **끄기** — 라우트 GET/PUT/preview · 소급(§6.1) · 권한(owner/admin) · 감사. **검증: 끄면 빠지고 켜면 돌아오는 양방향 + 미리보기 수 = 실제 옮긴 수.**
4. **학습 확대** — `mailSenderRules.onMarkReplyNeeded`·`onMarkReview` · 반대 규칙 해제 · `mark-review` 라우트 · 폴더 머리 한 줄. **검증: 1회 → progress, 2회 → 규칙 + 소급, 반대 규칙 삭제 확인, 벌크는 안 배움.**
5. **화면** — `MailCriteriaList.tsx`(공용) · `MailRulesSection` 교체 · Q mail «확인 권장으로» 버튼 · i18n ko/en(`qmail:criteria.*`, `settings:salesIntake.criteria.*`). **검증: 3폭(390·768·1440) · 가드 i18n/parity/autosave.**
6. **Q sale** — `mailThreadVerdict(off, domains)` · `normalizeIntake` 확장 · 카드에 목록·도메인 입력 · 이유 칩 2개. **검증: `--suite salecriteria` 확장 + 집계=목록.**
7. **재판정 스크립트 축 추가** + dev 적용(`--promote-only --promote-reply-criterion=inbound_action --apply`) · 운영 시뮬은 Irene 할 일로.
8. 문서: CLAUDE.md «Q mail 폴더·배지 계약» 에 ⑦ «기준은 카탈로그 한 벌 — 설명을 따로 쓰지 않는다» 한 줄 · `MAIL_TRIAGE_AUDIT` 머리에 이 문서 링크.

---

## 10. 완료 검증 기준 (이게 다 초록이어야 «완료»)

### 10.1 판정 — dev 전수 시뮬 플립 표 (열린 스레드 전부, before/after)

| 전이 | 허용 | 기대(dev) |
|---|---|---|
| 자동·마케팅 → 확인 권장 (`auto_ack`) | 승격 | Aspiration 4(8908·7808·7468·3475) + Apple 접수 2(5599·5600) 안팎. 목록 **전수 육안** |
| 자동·마케팅/확인 권장 → 답변 필요 (`inbound_action`) | 승격 | **23건 ±** — With Min 8 · K-BIZ Hub 9 · tidio 4 · 와디즈 2. 우리 시스템 발신 0건 포함 |
| 스팸 → 확인 권장 (`spam_rescue`) | 승격 | ≤ 4(help@wor-pro.com 계열) — 자기 주소 제외 뒤 수를 적는다 |
| 답변 필요 → 다른 폴더 | **0** | 강등 0 |
| 확인 권장 → 자동·마케팅 | **0** | |
| 사람 메일(human) 판정 변화 | `inbound_action` 외 **0** | 결정 ④ 유지의 증명 |
| 그 외 모든 전이 | 0 | 카탈로그 이사(1단계)가 동작 불변임의 증명 |

### 10.2 양성·음성 대조군 (`canary-mail-triage.js` 에 실 mailparser 헤더로 추가)

양성(올라와야 한다):
- `Auto-Submitted: auto-replied` + `Precedence: bulk` + «We have received your email» → 확인 권장 `auto_ack`(**marketing 아님**)
- 제목 «Automatic reply: …» 헤더 없음, noreply 발신 → 확인 권장 `auto_ack`
- `help@withmin.info` «[With Min]: New order #3171», 헤더 없음 → **답변 필요** `inbound_action`
- `no-reply@notifications.tidio.com` + List-Unsubscribe + «You have a new ticket 10050» → 답변 필요(marketing 이어도)
- `info@wadiz.kr` «[와디즈] 문의하신 내용에 답변이 도착했어요.» → 답변 필요
- 스팸 점수 6 + 발신자 = 고객 주소(픽스처 Client) → 확인 권장 `spam_rescue`, triage spam 유지
- 10-11 대조군 7건(8523·4093·338·5309·5827·4436·3874) 여전히 확인 권장

음성(올라오면 안 된다):
- `help@irenewp.com`(SMTP_FROM) «[워프로랩] Q Talk · 새 메시지 · …» → 확인 권장 `platform_notice`(답변 필요 **아님**)
- `info@mail.shopee.com.my` «Your order #… has been delivered» → 자동·마케팅(`transactional_notice`)
- `(광고) 새 주문 이벤트!` → 자동·마케팅(`ad_prefix` 가 `inbound_action` 보다 먼저)
- `mailer-daemon@` DSN(`auto-replied`) → `auto_ack` 아님(반송 경로 그대로)
- 사람 메일 «Thank you for contacting us, here is the enrollment letter…» 회신(In-Reply-To 우리 ID) → **답변 필요**(`auto_ack` 본문 패턴이 사람 메일에 안 걸림)
- 역할 주소 `mail@jisungtax.com` «[요청] 부가가치세 자료 요청», 헤더 없음, 관계 없음 → 확인 권장 `unclear_intent`(결정 ④) · 같은 주소 «답변 필요로» 2회 뒤 → 규칙 `always_reply` 생성 + 그 스레드 답변 필요
- 개인 주소 모양 콜드메일(스팸 점수 6) → 스팸 그대로(`spam_rescue` 아님)

끄기 양방향: `inbound_action` 끄기 → With Min 8건이 확인 권장으로 돌아감(미리보기 수 = 실제 수) → 켜기 → 답변 필요 복귀. `lockable` 기준 PUT → 400. 멤버(qmail write, admin 아님) PUT → 403. 미리보기 응답과 적용 결과가 같은 건수.

학습: 같은 주소 «답변 필요로» 1회 → `progress:1`·규칙 0 / 2회 → 규칙 1(`mark_reply_x2`)·그 주소 열린 스레드 소급·기존 `no_reply` 규칙 삭제 / 벌크 dismiss 10건 → 규칙 0. «확인 권장으로» 같은 틀.

### 10.3 Q sale (`canary-sale-criteria.js` 확장)
- `off:['personal']` → auto 모드에서 개인 주소 메일이 후보로 · 되돌리면 상담 · 집계 = 목록(한 함수).
- `domains.always:['acme.com']` → manual 모드에서도 그 도메인 메일이 상담(`domain_rule`) · `never` → 제외(단 promoted 는 상담).
- `always` 에 `gmail.com` → 400.

### 10.4 화면 (3폭 390 · 768 · 1440 — 좁게 재면 거짓 초록)
- 설정 › 메일 계정 › 분류 기준: 카탈로그 4묶음·기준 수 = 카탈로그 길이(서버 GET 과 DOM 행 수 일치) · 잠김 항목 스위치 없음 · 스위치 토글 → PUT **정확히 1건**(AutoSaveField 계약) · 끄기 전 ConfirmDialog 에 미리보기 건수 · 학습 안내 단락 ko/en.
- Q mail 자동·마케팅 폴더 행: «확인 권장으로» 버튼이 보이고(`elementFromPoint`) 누르면 그 행이 확인 권장 폴더로 이동 + 자동·마케팅 수 −1·확인 권장 수 +1(배지 계약). 2회째 → 폴더 머리 학습 줄이 **그려진다**(rect>0 · 가려지지 않음) · «되돌리기» → 규칙 삭제 + 줄 사라짐.
- 설정 › 권한 › 상담 유입: 기준 목록 + 도메인 입력 · owner 아님이면 읽기 전용.
- 가드: `node scripts/guard-invariants.js`(전체 — i18n·parity·autosave·drawerwidth) · `node scripts/health-check.js` · `npm run build` EXIT 0.

### 10.5 운영 적용 전
- 운영 읽기 전용 시뮬 표(§6.2 ①) — 승격 목록 전수 육안, 강등 0, 답변 필요 승격은 `inbound_action` 만. Irene 할 일로 올렸으면 그 결과가 들어온 뒤에 적용.
- 마이그레이션 멱등 2회 실행 OK · 배포 슬롯 등록 확인.

---

*이 문서는 설계 판정이다. 구현하면서 숫자가 달라지면(플립 수·대조군) 표를 고치되, 결정 ①~⑤ 를 바꾸려면 Fable `decision` 으로 다시 올린다.*
