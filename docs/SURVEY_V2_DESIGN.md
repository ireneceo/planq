# 설문 v2 설계 — 질문지 · 발행(회차) · 자동 규칙

> 설계: [Fable] 2026-10-12 · 상태: **설계 — Irene 승인 전 구현 안 함**
> 정찰: `.claude/plans/qmv40iump.md`(HEAD ed936de1 → 설계 시점 827b9df8, 설문 관련 코드 변경 없음 확인)
> 앞선 설계: `docs/SURVEY_DESIGN.md`(#460, 2026-10-07 표의 «응답 받기» 문) · `docs/SURVEY_SYSTEM_DESIGN.md`(2026-05-11 독립 3표안, 미구현)
>
> Irene(2026-10-12): *"설문 기능이 어디에 어떻게 있어? 문서 작성할 때 문서/표/설문 이렇게 할 수 없어? 표처럼 설명을 위에 넣고 설문 추가하게. … 표에 통계가 붙은게 뭐야? 이게 설문이야? … 설문을 반복적으로 보내야 하는 경우들이 있는데 이걸 해야 하면 문서와 분리해야 해? 설문을 제대로 생성해서 반복 발행, 기준에 따라 자동발행 … 프로젝트 완료 후 리뷰 자동발행되고, 신규 고객들에게 자동리뷰 받고, 정기적으로 고객들에게 만족도 조사도 받을 수 있고."*

---

## 0. 한 줄

**설문은 Q docs 의 세 번째 종류(문서 / 표 / 설문)가 된다.** 질문지는 문서에 남고(설명 = 문서 본문, 문항 = 표 칸, 응답 = 표 줄),
«**누구에게 언제 보냈나**»(발행·회차)와 «**언제 자동으로 보낼까**»(규칙)만 새 표로 분리한다.
반복 발행이 필요하다고 문서와 분리할 이유는 없다 — **반복되는 것은 문서가 아니라 회차**다. 질문지 하나로 회차를 여러 번 낸다.

---

## 1. 지금 어떻게 돼 있나 (사실 — Irene 질문에 대한 답)

| 질문 | 지금 (코드 기준) | 왜 헷갈리나 |
|---|---|---|
| 설문이 어디에? | Q docs 에서 **표**를 만들고, 표 위 도구줄의 작은 버튼 «설문으로 받기» 를 눌러 켠다(`PostTableGrid.tsx:338`, 서랍 `SurveyDrawer.tsx`). 「새 문서」에는 빈 문서 / 표 / 템플릿만 있다(`PostsPage.tsx:1576-1587`) | **설문이라는 시작점이 없다.** 표를 먼저 만들어야 한다는 것을 알 수 없다 |
| «표에 통계가 붙은 것» 이 설문? | 표 도구줄의 «표 \| 통계» 알약 토글(`PostTableGrid.tsx:333-336`). **설문을 켜지 않은 모든 표**에도 뜬다. 내용은 칸별 집계(선택지 비율·숫자 평균·글 목록) | 설문과 무관한 표에 «통계» 가 붙어 있어 «이게 설문이냐» 로 읽힌다 |
| 설문 종류(문항 종류)가 제대로 없다 | 표 칸 종류를 그대로 쓴다 — text·longtext·number·date·datetime·checkbox·url·email·phone·select·multi_select(`qtable.ts:6-11`). **별점·0~10 척도·예/아니오가 없다.** 첨부·행 합계 칸도 질문지에서 걸러지지 않는다(`services/survey.js:12` 는 secret 만 뺌) | 칸 종류 이름이 «데이터 칸» 말투(URL·전화·행 합계)라 설문 만드는 사람에게 안 읽힌다 |
| 설명을 위에 | 표에는 «+ 표 설명 추가»(문서 본문)가 있지만 **응답 화면에는 안 나간다.** 응답 화면 안내문은 서랍 안 «안내문»(`survey_settings.intro`) 따로 | 같은 «설명» 이 두 벌 |
| 반복·자동 발행 | **없다.** 링크 하나(열쇠 하나)·마감일·정원뿐. 받는 사람·보낸 기록·회차·누가 응답했는지 전부 없다(응답은 익명 1줄) | 반복 발행을 표현할 자리가 없다 |

- dev DB: 표 36개 중 설문을 켠 것 **0개**(운영 미확인 — 구현 전에 `SELECT COUNT(*) FROM q_records WHERE survey_token IS NOT NULL` 1회).
- 이미 잘 돼 있는 것(그대로 쓴다): 쓰기만 되는 열쇠·매 요청 한 함수 판정(`resolveSurveyToken`)·토큰 기준 레이트리밋·꿀단지·보안등급 차단·응답 알림·실시간 신호·`stripRecordSecrets`.

---

## 2. 구조 결정 (핵심 — 되돌리기 어려움)

### 2.1 설문 = Q docs `kind='survey'` (독립 메뉴·독립 표 아님)

```
posts (kind='survey')  ── 제목 · 본문(= 응답 화면 맨 위 설명) · 공개범위 · 보안등급 · 프로젝트 연결
   └─ q_records          ── 문항(columns) · 공개 링크 열쇠(survey_token) · 설정(survey_settings)
        └─ q_record_rows ── 응답 1건 = 1줄  (+ survey_issue_id · survey_recipient_id)

survey_rules      ── «언제 자동으로 회차를 만들까» (프로젝트 완료 N일 뒤 / 신규 고객 N일 뒤 / 분기마다)
survey_issues     ── «회차» — 수동이든 자동이든 한 번 보낸 묶음 (상태·마감·누가 승인·언제 보냄)
survey_recipients ── 회차의 받는 사람 1명 = 1줄 — 개인 열쇠(token)·보냄/열람/응답 시각
```

**왜 분리하지 않나**
- 응답을 **표로 보고·고치고·내보내고·통계 내는** 기능이 이미 표에 있다. 독립 `surveys` 3표(옛 설계)로 가면 응답 격자·CSV·셀 편집·실시간·휴지통을 한 번 더 만든다(CLAUDE.md «새로 만들지 않는다»).
- 공개 범위(L1~L4)·보안등급·프로젝트 연결·휴지통·복사·템플릿이 **문서의 것**이라 설문도 공짜로 받는다.
- Irene 의 그림 «문서/표/설문» 그대로다 — 사용자 눈에 설문은 **문서의 한 종류**다.

**왜 발행·규칙은 분리하나**
- «누구에게 보냈고 누가 답했나» 는 질문지의 속성이 아니라 **사건**이다. 표 칸이나 JSON 에 밀어 넣으면 회차·응답률·재발송·중복 방지(멱등)를 셀 자리가 없다.
- 규칙은 **cron 이 읽는 원장**이다. 표 하나에 몇 줄짜리라 가볍고, 끄고 켜고 이력을 남기기 쉽다.

### 2.2 기존 것과의 호환 (옛 열쇠는 그대로 산다)
- `q_records.survey_token`(공개 링크, 누구나·여러 번) 은 **그대로** — v2 에서는 이것을 «공개 링크» 라고 부른다. `resolveSurveyToken` 은 `kind IN ('table','survey')` 를 받는다(지금은 `'table'` 만, `services/survey.js:59`).
- 표에서 설문을 켠 문서가 있으면 그대로 동작하되 화면이 **«설문으로 전환»** 한 줄을 띄운다(kind table→survey, 같은 `q_record` — 데이터 이동 없음).
- `survey_settings.title/intro` 는 레거시 읽기 전용 폴백. `kind='survey'` 는 **제목 = 문서 제목, 설명 = 문서 본문** 하나만 쓴다(두 벌 해소).

### 2.3 스키마 변경 (멱등 스크립트 `dev-backend/scripts/migrate-survey-v2.js`, **코드 배포 전** 배포 슬롯)

| 대상 | 변경 | 비고 |
|---|---|---|
| `posts.kind` | ENUM 끝에 `'survey'` append | 옛 값 순서 불변 |
| `q_record_rows` | `survey_issue_id INT NULL` · `survey_recipient_id INT NULL` + 인덱스(`survey_issue_id`) | NULL = 손으로 넣은 줄 / 공개 링크 응답 / 익명 응답 |
| 새 표 `survey_rules` | §3.1 | Phase 2 에서 만들어도 되지만 스크립트는 한 번에 둔다(두 번 배포 슬롯 피함) |
| 새 표 `survey_issues` | §3.2 | |
| 새 표 `survey_recipients` | §3.3 | |
| `clients.survey_opt_out_at DATETIME NULL` | «더 받지 않기» | Phase 2 |
| `config/plans.js limits.survey_sends_monthly` | 코드만 | §7.4 |

알림 `event_kind 'survey'` 는 이미 양쪽 ENUM 에 있다(#460) — **ENUM 추가 없음.** 감사는 AuditLog action 문자열(`survey.issue_send` 등)로 가른다.

---

## 3. 데이터 상세

### 3.1 `survey_rules` — 자동 규칙 (Phase 2)
| 컬럼 | 뜻 |
|---|---|
| `id` · `business_id` · `q_record_id`(질문지) · `created_by` | 격리 축은 `business_id`. 질문지의 `business_id` 와 같아야 생성된다 |
| `trigger` ENUM(`project_closed`,`client_joined`,`schedule`) | 프로젝트 완료 / 신규 고객 / 정기 |
| `delay_days` INT 기본 3 | 사건 N일 뒤(정기는 기간 시작 N일 뒤, 기본 1) |
| `schedule_every` ENUM(`monthly`,`quarterly`,`half_yearly`,`yearly`) NULL | 정기만 |
| `audience` ENUM(`subject`,`active_clients`,`clients_with_active_project`) | 그 사건의 고객 / 활성 고객 전원 / 진행 중 프로젝트가 있는 고객만 |
| `send_mode` ENUM(`review`,`auto`) 기본 `review` | 확인 후 발송 / 자동 발송(**대표·admin 만 바꿀 수 있다** — 정기청구 `auto_invoice_mode` 와 같은 선) |
| `min_interval_days` INT 기본 90 | 같은 고객에게 **워크스페이스의 어떤 설문이든** 이 기간 안에 보냈으면 건너뜀(설문 피로) |
| `enabled` BOOL · `enabled_at` DATETIME | **enabled_at 이전 사건은 세지 않는다**(규칙을 켠 날 지난 1년치 완료 프로젝트에 메일이 쏟아지지 않게) |
| `last_run_at` · timestamps | |

### 3.2 `survey_issues` — 회차
| 컬럼 | 뜻 |
|---|---|
| `id` · `business_id` · `q_record_id` · `rule_id` NULL | 수동 = rule NULL |
| `origin` ENUM(`manual`,`rule`) | |
| `subject_type` ENUM(`project`,`client`,`period`) NULL · `subject_id` INT NULL · `period_key` VARCHAR(16) NULL | 무엇 때문에 났나(프로젝트 12 / 고객 7 / 2026-Q4) |
| `idempotency_key` VARCHAR(120) **UNIQUE** | `rule:{rid}:project:{pid}` · `rule:{rid}:client:{cid}` · `rule:{rid}:period:2026-Q4` · 수동 `manual:{uuid}`. **DB 가 두 번째를 거부한다**(`recurring_invoice.js:98-150` 와 같은 방식) |
| `status` ENUM(`pending_review`,`sent`,`skipped`,`expired`,`failed`,`blocked_quota`) | 확인 대기 / 보냄 / 사람이 건너뜀 / 14일 안에 확인 안 해 만료 / 전원 실패 / 요금제 한도 |
| `title` VARCHAR(200) · `message` TEXT NULL · `closes_at` NULL | 메일 제목·짧은 글·응답 마감 스냅샷 |
| `created_by` NULL · `approved_by` NULL · `approved_at` · `sent_at` · timestamps | cron 이 만든 것은 created_by NULL |

### 3.3 `survey_recipients` — 받는 사람
| 컬럼 | 뜻 |
|---|---|
| `id` · `issue_id` · `business_id` · `client_id` NULL | 직접 적은 이메일은 client NULL |
| `email` VARCHAR(254) · `display_name` VARCHAR(100) NULL | 보낸 시점 스냅샷(고객 정보가 바뀌어도 «그때 누구에게» 가 남는다) |
| `token` VARCHAR(64) **UNIQUE** | 개인 열쇠. 32바이트 base64url. 정확히 같을 때만(대소문자 무시 collation 함정 — 지금 코드와 같은 비교) |
| `status` ENUM(`queued`,`sent`,`failed`,`responded`) · `sent_at` · `opened_at` · `responded_at` · `reminded_at` | |
| `email_log_id` NULL | EmailLog 와 연결(재발송·실패 사유) |
| 인덱스 | (`issue_id`) · (`client_id`,`created_at`) — 최소 간격 판정용 · (`business_id`,`sent_at`) — 월 한도 집계 |

### 3.4 `q_records.survey_settings` JSON 에 더하는 키
`anonymous`(기본 false) · `thanks`(제출 뒤 문구, 선택) · `public_link_enabled`(공개 링크 켬 — 열쇠 유무와 같은 뜻, 화면 표시용). `required`·`hidden`·`help`·`closes_at`·`max_responses`·`owner_id` 는 그대로.

---

## 4. 문항 종류 (설문 말투) — 칸 종류와의 대응

표 칸 종류 셋을 **새로 더한다**(표에서도 쓸 수 있다 — 별점·척도·예/아니오는 표에도 유용). 그 외는 **이름만** 설문 말투로 바꿔 보여 준다.

| 설문 화면 이름 (ko / en) | 칸 종류 | 응답 값 | 통계 |
|---|---|---|---|
| 단답 / Short answer | `text` | 글 ≤500 | 최근 20개 목록 + 응답 수 |
| 장문 / Paragraph | `longtext` | 글 ≤5000 | 〃 |
| 객관식 (하나) / Multiple choice | `select` | 선택지 중 하나 | 선택지별 건수·비율(분모 = 답한 사람) |
| 체크박스 (여럿) / Checkboxes | `multi_select` | 선택지 부분집합 | 선택지별 건수·비율(분모 = 답한 사람 — 합은 100% 넘는 게 정상, 화면에 그 말을 적는다) |
| **예 / 아니오** · Yes / No | **`yesno`(신설)** | `true`/`false`, 미응답 = 없음 | 예 비율 |
| **별점 (1~5)** · Rating 1–5 | **`rating`(신설)** | 정수 1~5 | 평균(소수 1자리) + 1~5 분포 |
| **척도 (0~10, 추천지수 NPS)** · Scale 0–10 (NPS) | **`scale`(신설)** | 정수 0~10 | 평균 + 0~10 분포 + **NPS** |
| 숫자 / Number | `number` | 유한수 | 평균·최소·최대 |
| 날짜 / Date | `date` | YYYY-MM-DD | 날짜별 건수 |
| 이메일 / Email · 전화 / Phone | `email` · `phone` | 형식 검증 | 목록 |

- **질문지에서 숨기는 칸 종류**(`SKIP_TYPES` 확장): `secret` · `attach` · `row_sum`·`row_avg`·`row_min`·`row_max` · `url` · `datetime` · `checkbox`(표의 «체크» 칸은 «동의해야 함» 뜻이라 설문의 예/아니오와 다르다 — 설문 문항 고르기에서는 안 보이고, 표에서는 그대로).
  ★ 지금은 `attach` 칸이 질문지에 **그대로 나간다**(공개 화면 `default` 분기 = 텍스트 입력) — 버그. v2 에서 같이 막는다.
- 체크박스(`checkbox`) 의 «필수 = 반드시 체크» 규칙은 그대로 둔다(동의 칸 용도). `yesno` 의 필수 = «예든 아니오든 답했다».
- 새 세 종류는 표 격자 셀 편집기도 받는다(별 5개 · 0~10 알약 · 예/아니오 토글) — `PostTableGrid.tsx` 칸 종류 목록(`:47` 근처) + 셀 편집기 + 통계.

### 4.1 통계 공식 (calc — 정본은 서버 `services/surveyStats.js` 한 파일, 화면은 숫자를 다시 셈하지 않는다)

| 항목 | 공식 | 반올림 | 0건일 때 |
|---|---|---|---|
| 평균(별점·척도·숫자) | Σ값 / 답한 수 | 소수 1자리(별점·척도) · 2자리(숫자, 지금과 같음) | `null`(«–» 로 표시, 0 이 아니다) |
| 분포 | 값별 건수(별점 1~5 · 척도 0~10 — 0건인 값도 키를 둔다) | 건수 + 비율(정수 %) | 전부 0 |
| **NPS** | 추천(9~10) 비율 − 비추천(0~6) 비율. 비율의 분모 = **그 문항에 답한 수**(전체 줄 수 아님). 중립(7~8)은 양쪽 어디에도 안 들어간다 | 정수, 반올림(소수 .5 는 올림). 화면은 부호를 붙인다(`+30` / `0` / `−12`) | `null` — **0 과 구별한다**(0 은 «추천 = 비추천» 이라는 결과다) |
| 예/아니오 | 예 건수 / 답한 수 | 정수 % | `null` |
| 응답률(회차) | 응답한 받는 사람 수 / 보낸 받는 사람 수(`status IN sent,responded`) | 정수 % | 보낸 사람 0 이면 `null` |

**검산 1 — 척도(NPS) 10명**: 답 = 10, 9, 9, 8, 7, 6, 10, 3, 9, 8
- 추천(9~10) = {10, 9, 9, 10, 9} → 5명 = 50% · 비추천(0~6) = {6, 3} → 2명 = 20% · 중립(7~8) = {8, 7, 8} → 3명
- **NPS = 50 − 20 = +30** · 평균 = 79 / 10 = **7.9** · 분포 10:2 · 9:3 · 8:2 · 7:1 · 6:1 · 3:1 · 나머지 0

**검산 2 — 별점 7명**: 답 = 5, 4, 4, 5, 3, 5, 2
- 평균 = 28 / 7 = **4.0** · 분포 5:3(43%) · 4:2(29%) · 3:1(14%) · 2:1(14%) · 1:0(0%)
- 경계: 척도 4명 답 = 10, 10, 0, 0 → 추천 50% − 비추천 50% = **NPS 0**(«null» 이 아니라 0). 척도 답 0명 → NPS **null**.

### 4.2 통계 범위 거르기
`GET /api/records/:id/survey-stats?issue_id=&rule_id=&from=&to=` — 전체 / 이 회차만 / 이 규칙의 회차들만 / 기간. 화면은 통계 탭 위 칩 한 줄. 분모는 항상 **거른 집합 안에서 그 문항에 답한 수**.

---

## 5. 발행 — 보내기(수동) · 개인 열쇠 · 재응답 · 익명

### 5.1 수동 보내기 (Phase 1)
```
[보내기] → StandardModal «설문 보내기»
  받는 사람   : 고객 검색(멀티 선택 — 이메일 있는 고객만 뜬다) · [프로젝트 고르기 → 그 프로젝트 고객 채움] · 직접 이메일 추가
  메일 글     : 제목 자동 «[워크스페이스] 설문 — 문서 제목» (고칠 수 있음) · 짧은 메시지(선택, 500자)
  응답 마감   : 날짜(선택, 기본 14일 뒤)
  [보내기 · N명]  ← 이메일 없는 고객이 섞이면 «이메일 없음 — 보낼 수 없음» 으로 회색 표시, N 에서 빠진다
→ ConfirmDialog «다음 주소로 보냅니다» — 주소 전부를 스크롤 상자에 적는다(«정말?» 만 묻지 않는다, CLAUDE.md «외부 발송은 확인»)
→ POST /api/surveys/:recordId/issues { client_ids, emails, message, closes_at }  — 201 { issue }
```
- 서버: 회차 1건 + 받는 사람 N줄(개인 열쇠 N개) 만들고 **순차 발송**(한 사람 실패가 다음을 막지 않는다 · 실패는 `status='failed'` + EmailLog 사유, 발행 탭에서 [다시 보내기]).
- 받는 이메일 정하는 함수는 **하나**: 신규 `services/clientContact.js primaryEmailOf(client, projectClient?)` = `User(user_id).email` → `clients.invite_email` → `project_clients.contact_email`. (`tax_invoice_email`·`billing_contact_email` 은 회계 주소라 쓰지 않는다. 지금 이 폴백 사슬이 6곳에 손으로 흩어져 있다 — `saleInbox.js:681`·`project_actions.js:136` 등. 설문부터 한 함수로.)
- 메일: `services/emailService.js sendSurveyInviteEmail({to, surveyTitle, workspaceName, message, respondUrl, closesAt, fromName, replyTo, businessId, recipientId})` — `emailWrap` 재사용, 발신 표시는 청구서 메일과 같이 `businesses.mail_from_name/mail_reply_to`. **EmailLog 1건/수신자**(`template='survey_invite'`, `related_entity_type='survey_recipient'`).
- 사용자 한도: `costGuard.perUserDaily('survey-send', { perMin: 5, perDay: 200 })` + 요금제 월 한도(§7.4). 한 회차 받는 사람 상한 500.
- 권한: 보내기 = `canManageSurvey`(지금 켜기 술어 그대로 — 멤버 이상 ∧ `canEditPost`). 고객(client) 역할은 서버·화면 같은 술어로 막는다.

### 5.2 개인 열쇠 · 재응답 · 익명
| 항목 | 규칙 |
|---|---|
| 응답 주소 | **같은 공개 화면** `/public/survey/:token`. `resolveSurveyToken` 이 `survey_recipients.token` 을 먼저 찾고, 없으면 `q_records.survey_token`(공개 링크). 두 종류의 토큰 길이·문자 집합이 같아 외부에서 가를 수 없다 |
| 개인 열쇠로 할 수 있는 것 | 질문지 읽기(이때 `opened_at` 찍음) · 응답 **1건** 쓰기. 두 번째 제출은 410 `already_responded`(화면: «이미 응답하셨어요. 감사합니다.»). 공개 링크는 지금처럼 여러 번 가능 |
| 회차 마감 | `issues.closes_at` 지나면 410 `survey_closed`(개인 열쇠) — 질문지의 `settings.closes_at`·정원·하드캡 판정은 그대로 그 위에 겹친다 |
| 응답 줄에 남는 것 | `survey_issue_id`(회차) · `survey_recipient_id`(받는 사람) → 응답 탭에 «받은 날 · 회차 · 응답자 이름» 시스템 칸으로 보인다(값은 칸이 아니라 조인 — `values` 를 늘리지 않는다) |
| **익명**(`survey_settings.anonymous=true`) | 줄에 `survey_recipient_id` 를 **안 쓴다**(회차는 남긴다 — 응답률·회차 통계는 셀 수 있다). 받는 사람 줄의 `responded_at` 은 찍는다(«답했다» 는 알지만 «무엇을» 은 못 잇는다). 화면이 분명히 말한다: «익명 설문은 누가 어떤 답을 했는지 연결하지 않아요. 받는 사람이 1명인 회차(프로젝트 리뷰)는 익명이 의미가 없어요.» |
| 기본값 | **이름 붙임(식별).** 리뷰·만족도는 «누가 불만인가» 를 알아야 후속 조치가 된다. 익명은 설문별 스위치(켜면 **그 이후 회차**부터 — 이미 들어온 줄은 바꾸지 않는다) |
| 공개 화면이 보여 주는 것 | 제목 · 설명(문서 본문, 공개 문서 페이지와 **같은 정제 함수**로 HTML) · 워크스페이스 이름 · 문항 · 마감 · 개인 열쇠이면 «{{이름}}님» 인사(익명이면 안 보임). **응답 수·다른 응답·숫자 id·프로젝트 내부 정보 없음**(지금 계약 그대로) |
| 관리 화면에 개인 링크를 보여 주나 | **안 보여 준다.** 담당자가 개인 링크를 쥐면 «고객인 척 응답» 이 된다. 할 수 있는 것은 [다시 보내기]·[이 사람 회수(링크 죽이기)]. 공개 링크만 복사 가능 |

### 5.3 자동 발행 메일 — 바로 보낼까, 확인 후 보낼까 (권고: **확인 후 발송이 기본**, 규칙별로 대표가 «자동» 으로 바꿀 수 있다)
- CLAUDE.md «외부 발송은 확인을 받는다 — 보낼 주소를 문구에 적는다» 와 정기청구 선례(`auto_invoice_mode: 'auto' | 'draft_review'`, 바꾸는 것은 owner 만)를 그대로 따른다.
- `review`: cron 이 회차를 `pending_review` 로 만들고 **확인필요**(대시보드 `GET /api/dashboard/todo`) 에 «설문 보내기 확인 — 프로젝트 X 리뷰 · a@b.com 외 1명» 카드를 올린다(§8.3). [보내기] 를 누르면 그 자리에서 주소를 보고 확인 → 발송. **14일 안에 확인하지 않으면 `expired`**(두 달 지난 프로젝트에 리뷰 메일이 나가는 일을 막는다).
- `auto`: cron 이 바로 보낸다. 규칙 편집 화면에서 «자동 발송» 은 대표·admin 에게만 켜지고, 켤 때 ConfirmDialog 가 «이 규칙은 사람 확인 없이 고객에게 메일을 보냅니다» 를 묻는다. 기본값은 어디서도 auto 가 아니다(fail-closed).
- 확인하는 사람 = **한 명**(규칙 만든 사람, 떠났으면 대표) — 배지 «한 업무 = 한 버킷» 규칙. 회차는 `approved_by` 에 남는다.

---

## 6. 자동 발행 — 트리거는 «훅» 이 아니라 «원장» 을 읽는다 (Phase 2)

### 6.1 왜 쓰기 훅을 걸지 않나 (정찰 계획과 다른 결정)
정찰은 «프로젝트 완료 라우트에 훅» 을 권했다. 실측하니 **쓰는 문이 하나가 아니다**:
- 프로젝트 «완료» 는 `status='completed'` 가 아니라 **`'closed'`** 다(ENUM `active/paused/closed`, `models/Project.js:13`). `PUT /api/projects/:id`(`routes/projects.js:734`)와 **`DELETE /api/projects/:id`(삭제 버튼, `:938`)** 둘 다 `closed` 로 바꾼다. 삭제한 프로젝트에 «리뷰 부탁» 메일이 나가면 안 된다.
- 신규 고객이 «계정이 붙는 순간»(`accepted_at`) 은 세 곳이다 — `services/invites.js:136·156·208` · `routes/projects.js:3718`.
훅을 세 곳에 심으면 하나는 반드시 빠진다(`feedback_new_door_must_reuse_sibling_checks`). 그래서 **cron 이 사실을 읽는다**:

| 트리거 | cron 이 읽는 원장 | 사건 시각 | 왜 이 원장 |
|---|---|---|---|
| `project_closed` | `project_status_history` where `to_status='closed'` | `history.created_at` | PUT 만 이력을 쓴다(`projects.js:862`). **삭제(DELETE)는 이력이 없어 자연히 제외**된다. 프로젝트가 지금도 `closed` 인지(다시 열었으면 제외)·`kind='client'` 인지 같이 본다 |
| `client_joined` | `clients.accepted_at` (status `active`) | `accepted_at` | 네 쓰기 경로가 전부 이 컬럼을 찍는다. «생성» 이 아니라 «계정이 붙은 뒤» 라 받을 이메일이 확실하다 |
| `schedule` | 달력 | 기간 시작 + `delay_days` | 기간 키 `2026-10` / `2026-Q4` / `2026-H2` / `2026` |

조건은 모두 `사건 시각 ≥ rule.enabled_at` ∧ `사건 시각 + delay_days ≤ 지금` ∧ `business_id` 일치.
★ 뒤에 누가 PUT 밖에서 `closed` 를 쓰면서 이력을 안 남기면 리뷰가 **안 나간다**(조용한 쪽이 «메일 안 감» 이라 안전). `ProjectStatusHistory.create` 가 try/catch 로 경고만 남기는 것(`projects.js:874`)도 같은 방향이다.

### 6.2 cron 한 개 — `services/surveyRuleCron.js`
- `node-cron` **매시 10분**(`10 * * * *`). 규칙마다 워크스페이스 `businesses.timezone` 기준 **현지 09시대**에만 회차를 만든다(한밤중 메일 금지). 겹침 방지 플래그(`calendarReverseSyncCron.js` 와 같은 «앞 회차 돌고 있으면 건너뜀»).
- 멱등: 회차 `idempotency_key` UNIQUE — `findOne` 뒤 `create` 가 경합하면 **DB 가 두 번째를 거부**하고 조용히 넘어간다(`recurring_invoice.js:140-150` 패턴). 두 번 돌려도 1건.
- 받는 사람 고르기(규칙 `audience`): `subject` = 그 프로젝트의 고객들(`project_clients`→`clients`) / 그 고객 · `active_clients` = `clients.status='active'` ∧ 이메일 있음 ∧ `survey_opt_out_at IS NULL` · `clients_with_active_project` = 위 + 진행 중 프로젝트 1개 이상. 이메일은 `primaryEmailOf` **한 함수**.
- 건너뜀(회차 `skipped` 또는 받는 사람 0명 → 회차 안 만듦): 받을 이메일 없음 · `min_interval_days` 안에 이 고객에게 보낸 설문 있음(워크스페이스 전체) · 옵트아웃 · 질문지 문서가 휴지통·미게시·보안등급 일반 아님 · 요금제 한도 초과(→ `blocked_quota` + 대표 알림 하루 1회).
- `review` 모드 → `pending_review` + 확인자 앱 알림(`event_kind 'survey'`, 링크 = 문서 발행 탭) · `auto` 모드 → 즉시 발송(§5.1 과 같은 함수 `services/surveyIssue.sendIssue`). **cron 과 수동이 같은 보내기 함수**를 쓴다 — 두 벌이면 갈라진다.
- `pending_review` 14일 → `expired`. `closes_at` 3일 전 미응답자에게 리마인더 1회(`reminded_at`) — Phase 2 후반, 규칙 토글 «리마인더 보내기»(기본 끔).
- 결과는 `[surveyRuleCron] summary {made, sent, pending, skipped, blocked}` 한 줄 로그.

### 6.3 규칙 템플릿 3개 (화면 «+ 자동 규칙» 의 선택지 — 값은 고칠 수 있다)
| 템플릿 | trigger | delay | audience | send_mode |
|---|---|---|---|---|
| 프로젝트 완료 리뷰 / Project completion review | `project_closed` | 3일 | `subject` | `review` |
| 신규 고객 첫인상 / New client first impression | `client_joined` | 7일 | `subject` | `review` |
| 정기 만족도 / Periodic satisfaction | `schedule` quarterly | 기간 시작 1일 뒤 | `active_clients` | `review` |

---

## 7. 보안 · 격리 · 비용

| 항목 | 규칙 |
|---|---|
| 무인증 표면 | 지금 `routes/survey_public.js` 두 라우트에 **같은 레이트리밋**(주 키 토큰, IP 보조) 그대로. 개인 열쇠도 같은 판정 함수 `resolveSurveyToken` 한 곳. 모르는/죽은/회수된 토큰 = 404 한 가지. Phase 2 `POST /api/survey/:token/opt-out`(개인 열쇠만, 공개 링크 토큰은 404) |
| 응답 읽기 공개 경로 | **없다**(지금과 같다). 개인 열쇠로도 자기 응답을 다시 못 본다(«이미 응답» 만) |
| 비밀값 | `survey_recipients.token`·`q_records.survey_token` 은 **어느 목록·상세·회차 응답에도 안 실린다.** 회차·받는 사람 API 는 `has_responded/sent_at/opened_at/status` 만. 공개 링크 토큰만 지금처럼 `GET /api/records/:id/survey`(관리자)에서. `health-check --category=secrets` 에 2건 추가(회차 목록 원문에 토큰 0 · 응답 행에 토큰 0) + «쓸 필드는 그대로 온다» 대조군 |
| 멀티테넌트 | 모든 표에 `business_id`. 회차 생성 시 `client_ids` 전부 같은 `business_id` 인지 확인(하나라도 다르면 400, 조용히 빼지 않는다). cron 은 규칙의 `business_id` 로만 고객·프로젝트를 찾는다. 다른 워크스페이스 고객에게 0건 — 검증 항목 |
| 고객(client) 역할 | 설문 만들기·보내기·회차 보기 전부 서버 `canManageSurvey` + 화면 `hasBiz('owner','member')` 같은 술어. 고객이 볼 수 있는 설문 문서(L2 프로젝트 문서 등)에서도 응답 탭·발행 탭은 그리지 않는다 — 응답은 문서를 볼 수 있는 사람이 보는 지금 규칙상 **고객이 프로젝트 문서로 다른 고객 응답을 볼 수 있다** → `kind='survey'` 의 응답 줄·통계는 **멤버 이상만**(`survey-stats`·`rows` 조회에 멤버 술어 추가). 질문지(문항)는 고객도 본다 |
| 보안등급 | 켜기·보내기·cron 모두 `blocksExternalShare` — 기밀·내부 문서는 밖으로 못 나간다(지금 규칙). 등급을 올리면 공개 링크 열쇠 NULL(#460 수정 1) + **열린 회차의 개인 열쇠도 전부 회수**(`revoked_at` 대신 `status='failed'` 가 아니라 받는 사람 삭제가 아님 — `token=NULL` 로 비운다) |
| 휴지통·삭제 | 문서가 휴지통이면 공개·개인 열쇠 모두 404(지금과 같음) · 규칙은 `enabled=false` 로 내린다. 복원하면 규칙은 꺼진 채다(사람이 다시 켠다) |
| 복사(복제) | «내용만, 이력은 두고 온다» 계약 — 설문 복사 = 문항(칸)·설명·설정 복사, **응답 줄·회차·받는 사람·열쇠·규칙은 안 따라간다**. 제목 꼬리 `' (복사)'` |
| 메일 | 모든 발송 EmailLog(운영 안정성 #6) · 발신자 표시 = 워크스페이스 메일 설정 · 바닥글 «이 설문은 {{ws}} 와의 거래 관련 안내입니다» + Phase 2 «더 받지 않기» |
| 요금제(§7.4) | `limits.survey_sends_monthly`(받는 사람 1명 = 1건) — 수동·자동 공통, `plan.can('send_survey', { count })` 한 술어 |

### 7.4 요금제 한도 제안 (숫자는 Irene 결정 — §11)
starter 20 / basic 100 / pro 500 / business 2,000 / enterprise 무제한. 자동 규칙은 basic 이상(starter 는 수동만). 한도에 닿으면 수동은 409 `quota_exceeded`(화면이 «이달 N건 남음» 을 보내기 모달에 먼저 적는다), 자동은 `blocked_quota`.

---

## 8. 화면 (UX 설계 1회)

### 8.1 시작점 — «새 문서 ▾» 와 좌측 종류 필터
```
[새 문서 ▾]
  빈 문서        빈 본문으로 즉시 시작
  표             계정·자산 등 행/열 데이터
  설문           질문을 만들고 고객에게 보내 응답을 모아요        ← 추가
  템플릿에서 시작  견적·NDA·계약·SOW·회의록 양식

좌측 목록:  전체 · 표 · 설문 · (분류…)                          ← «설문» 필터 추가 (posts ?kind=survey)
목록 행 아이콘: 📄 문서 · 📊 표 · 📋 설문(KindIcon 에 한 종류 추가)
```
«설문» 을 고르면 `PostAiModal` 의 `mode='survey'`: 제목 + **시작 질문 세트** 4개 중 하나(빈 설문 / 프로젝트 완료 리뷰 / 신규 고객 첫인상 / 정기 만족도) → 문항(칸)을 시드한 `q_record` + `kind='survey'` 문서를 만들고 편집 화면으로.

**시작 질문 세트(ko / en — 시드 칸 이름·종류)**
| 세트 | 문항 |
|---|---|
| 프로젝트 완료 리뷰 / Project completion review | ① 이번 프로젝트 전체 만족도 / Overall satisfaction with this project — 별점 ② 저희를 지인에게 추천할 의향 / How likely are you to recommend us — 척도 0~10 ③ 가장 좋았던 점 / What went well — 장문 ④ 아쉬웠던 점 / What could be better — 장문 ⑤ 다음에도 함께할 의향 / Would you work with us again — 예/아니오 |
| 신규 고객 첫인상 / New client first impression | ① 시작 과정이 매끄러웠나요 / Was onboarding smooth — 별점 ② 기대와 다른 점 / Anything different from what you expected — 장문 ③ 가장 먼저 해결되길 바라는 것 / What should we address first — 단답 ④ 추천 의향 / Likelihood to recommend — 척도 |
| 정기 만족도 / Periodic satisfaction | ① 최근 3개월 서비스 만족도 / Satisfaction over the last 3 months — 별점 ② 소통 속도 / Responsiveness — 별점 ③ 결과물 품질 / Quality of deliverables — 별점 ④ 추천 의향 / Likelihood to recommend — 척도 ⑤ 하고 싶은 말 / Anything else — 장문 |

### 8.2 설문 상세 — 두 밴드 + 네 탭 (데스크탑 1440)
```
┌ 밴드1 60px ──────────────────────────────────────────────────────────────── ⋯ ┐
│ ← 2026 4분기 고객 만족도                                                        │
├ 밴드2 57px ───────────────────────────────────────────────────────────────────┤
│ [질문지] [응답 12] [통계] [발행]   📋 설문 · 팀 공개 · 2026-10-12 김오너     [보내기] [응답 화면 보기] │
├──────────────────────────────────────────────────────────────────────────────┤
│ 질문지 탭                                                                       │
│ ┌ 설명 (응답자에게 맨 위에 보여요) ─────────────────────────────────────────┐   │
│ │ 안녕하세요, 지난 분기 저희 서비스가 어땠는지 3분만 들려주세요. …  (문서 본문 편집기)│   │
│ └─────────────────────────────────────────────────────────────────────────┘   │
│ ┌ 1. 최근 3개월 서비스 만족도                                 [별점 1~5 ▾] [필수 ●] ⋮ ┐ │
│ │    ☆ ☆ ☆ ☆ ☆   (응답자가 보는 모양 그대로)                                    │ │
│ │    문항 설명(선택): 1 = 매우 불만 · 5 = 매우 만족                               │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│ ┌ 2. 저희를 추천할 의향                                  [척도 0~10 (NPS) ▾] [필수 ●] ⋮ ┐ │
│ │    0 1 2 3 4 5 6 7 8 9 10                                                        │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│ ┌ 3. 가장 좋았던 점                                            [장문 ▾] [필수 ○] ⋮ ┐ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│ [+ 문항 추가 ▾]  단답 · 장문 · 객관식 · 체크박스 · 예/아니오 · 별점 · 척도 · 숫자 · 날짜 · 이메일 · 전화 │
│ ─ 설정 ─  익명 응답 ○   제출 뒤 문구 [감사합니다 …]   응답 마감 [날짜]   최대 응답 수 [   ]      │
└──────────────────────────────────────────────────────────────────────────────┘
```
- 문항 카드 = 표 칸 하나(이름 = 질문, 종류 = 칸 종류, `order` = 순서, 필수·설명 = `survey_settings`). **문항 카드가 곧 미리보기**다 — 응답자 입력 모양을 그대로 그린다(별·알약·라디오). [응답 화면 보기] 는 공개 링크가 켜져 있으면 그 주소, 아니면 인증 미리보기(`GET /api/surveys/:recordId/preview` — 공개 GET 과 같은 모양을 돌려주고 `PublicSurveyPage` 가 `previewData` 로 그린다, 제출 버튼 비활성 «미리보기»).
- 모든 입력은 AutoSaveField(질문 글·종류·필수·설명·설정). ⋮ = 위로/아래로/복제/삭제(응답이 있는 칸 삭제는 ConfirmDialog — 그 칸의 응답 값도 사라진다고 적는다).
- **응답 탭** = `PostTableGrid`(지금 격자) + 시스템 칸 3개 앞에 고정: 받은 날 · 회차 · 응답자(익명/공개 링크 = «익명»). 손으로 줄 추가·셀 수정은 지금 표 규칙 그대로(테스트 응답 넣기 용도). CSV 내보내기는 표의 것.
- **통계 탭** = `SurveyStats` + 위에 범위 칩(전체 / 회차 ▾ / 기간) + 별점 카드(평균 큰 숫자 + 1~5 가로막대) + 척도 카드(**NPS +30** 큰 숫자 · 추천/중립/비추천 3색 띠 · 0~10 막대 · 평균).
- **발행 탭**
```
┌ 공개 링크 ──────────────────────────────────┐  ┌ 자동 규칙 (Phase 2) ──────────── [+ 규칙] ┐
│ ● 받는 중 · https://…/public/survey/abc…   │  │ ● 프로젝트 완료 3일 뒤 → 그 프로젝트 고객 · 확인 후 │
│ [복사] [응답 화면 보기] [링크 닫기]           │  │ ○ 분기마다 1일 → 활성 고객 전원 · 확인 후 (꺼짐)  │
│ 누구나 로그인 없이 · 여러 번 응답 가능          │  └───────────────────────────────────────┘
└───────────────────────────────────────────┘
회차                                                              [보내기]
┌ 2026-10-12  수동 · 12명   보냄 12 · 열람 9 · 응답 7 (58%)   마감 10-26   [다시 보내기(미응답 5)] ┐
│ 2026-10-05  규칙 «프로젝트 완료 리뷰» · 브랜드 리뉴얼 · 1명  응답 1 (100%)                        │
│ 2026-10-01  규칙 «프로젝트 완료 리뷰» · 홈페이지 개편 · 확인 대기 ─ a@b.com  [보내기] [건너뛰기]  │
└──────────────────────────────────────────────────────────────────────────────────────┘
회차 행을 펼치면 받는 사람 목록: 이름 · 이메일 · 보냄/열람/응답 시각 · [다시 보내기] [회수]   (개인 링크는 보이지 않는다)
```
- 규칙 편집 = `DetailDrawer`(우측 480): 템플릿 고르기 → 언제(N일 뒤 / 주기) → 누구에게 → 보내기 방식(확인 후 · 자동[대표만]) → 같은 고객 최소 간격(기본 90일) → 켜기 스위치. 전부 AutoSaveField, 켜기만 ConfirmDialog(auto 일 때 문구 §5.3).

### 8.3 확인필요 카드 (Phase 2)
`collectSurveyIssues`(`routes/dashboard.js`, `?business_id=` 범위 그대로) → 항목 `type:'survey'`, verb `send_survey`(`todo.verb.send_survey` ko «설문 보내기 확인» / en «Confirm survey send»), 받는 사람 = 규칙 만든 사람(떠났으면 대표) **한 명 한 버킷**. 카드: «프로젝트 완료 리뷰 — 홈페이지 개편 · 최고객 (client@…)» [보내기] [건너뛰기] — [보내기] 는 ConfirmDialog 에 주소를 적는다. 배지 합 계약(total ⊇ 부분) 지킨다.

### 8.4 일반 표에서 사라지는 것
- 표(`kind='table'`)의 «표 | 통계» 토글과 «설문으로 받기» 버튼을 **뺀다.** 설문 기능은 설문 종류에만 있다(Irene 결정 §11-2, 권고 «뺀다»).
- 표에서 설문을 켜 둔 기존 문서: 격자 위에 한 줄 «이 표는 설문으로 응답을 받고 있어요 → [설문으로 전환]»(kind 변경, 데이터 그대로). 전환 전까지 옛 링크는 계속 동작한다.
- 편집 모드의 «문서 | 표» 전환(`PostsPage.tsx:2073-2081`)에 «설문» 을 더한다. 표 ↔ 설문은 같은 `q_record` 라 자유, 문서 → 설문은 표와 같은 시드, 설문 → 문서는 표 → 문서와 같은 확인(응답이 있으면 ConfirmDialog).

### 8.5 공개 응답 화면 (폰 390 — 폰 우선)
```
┌──────────────────────────────┐
│ 브랜드 파트너스                 │  ← PublicPageShell (지금 그대로)
│ 2026 4분기 고객 만족도          │
│ 최고객님, 안녕하세요. 3분만 …   │  ← 설명 = 문서 본문(HTML 정제) · 개인 열쇠·식별일 때만 «OO님»
│ 마감 10-26                     │
│ 1. 최근 3개월 서비스 만족도 *    │
│ 1 = 매우 불만 · 5 = 매우 만족    │
│  ☆    ☆    ☆    ☆    ☆        │  ← 별 하나 44px 터치
│ 2. 저희를 추천할 의향 *          │
│ [0][1][2][3][4][5][6][7][8][9][10] │  ← 알약 11개, 두 줄로 감김 허용(min 36px)
│ 전혀 아니다        매우 그렇다    │
│ 3. 가장 좋았던 점                │
│ [                 ]            │
│ 5. 다음에도 함께할 의향 *        │
│ ( 예 )  ( 아니오 )              │
│ [ 응답 보내기 ]                 │
│ 응답은 브랜드 파트너스에 전달됩니다 │
└──────────────────────────────┘
제출 뒤: «응답이 전달되었습니다. 감사합니다.» (+ settings.thanks) — 개인 열쇠면 «응답 하나 더 보내기» 없음
이미 응답한 개인 열쇠로 다시 열면: «이미 응답하셨어요. 감사합니다.»
```
키보드 올라올 때 규칙(`body[data-keyboard-up]`)·`ensureFocusedVisible` 은 공개 껍데기가 이미 따른다 — 새 입력(별·알약)은 버튼이라 해당 없음.

### 8.6 설문 상세 — 폰 (390)
밴드1 56px(제목 + ⋯) / 밴드2: 탭 네 개가 가로 스크롤, 액션([보내기]·[응답 화면 보기])은 메타 아래로 감김(≤640 규칙). 문항 카드는 종류 셀렉트·필수 토글이 질문 아래 줄로 내려온다. 응답 탭의 격자는 가로 스크롤(표 지금 그대로). 발행 탭 회차 행은 2줄 카드(날짜·출처 / 보냄·응답·응답률). 전부 `DetailDrawer`·`StandardModal` 표준이라 폰 전면 규칙을 그대로 받는다.

### 8.7 새 문구 (ko / en — 네임스페이스 `qdocs` 는 시작점·탭·편집기, `qtable` 은 문항 종류·통계·공개 화면)
| 키 | ko | en |
|---|---|---|
| qdocs `newDropdown.surveyLabel` / `surveyDesc` | 설문 / 질문을 만들고 고객에게 보내 응답을 모아요 | Survey / Build questions, send to clients, collect answers |
| qdocs `kind.survey` · `filter.surveys` | 설문 · 설문 | Survey · Surveys |
| qdocs `survey.tab.questions/responses/stats/publish` | 질문지 · 응답 · 통계 · 발행 | Questions · Responses · Stats · Publish |
| qdocs `survey.descriptionLabel` / `descriptionPh` | 설명 (응답자에게 맨 위에 보여요) / 왜 이 설문을 보내는지 한두 문장 | Description (shown to respondents first) / One or two lines on why you're asking |
| qdocs `survey.addQuestion` · `survey.questionPh` · `survey.helpPh` | 문항 추가 · 질문을 적어 주세요 · 문항 설명(선택) | Add question · Type your question · Help text (optional) |
| qdocs `survey.anonymous` · `survey.anonymousHint` | 익명 응답 · 누가 어떤 답을 했는지 연결하지 않아요. 받는 사람이 1명인 회차에는 의미가 없어요. | Anonymous responses · Answers aren't linked to who sent them. Pointless when a round has one recipient. |
| qdocs `survey.thanks` | 제출 뒤 문구 | Thank-you message |
| qdocs `survey.send` · `survey.sendN` · `survey.sendConfirmTitle` · `survey.sendConfirmMsg` | 보내기 · 보내기 · {{n}}명 · 다음 주소로 설문을 보낼까요? · 받는 사람은 로그인 없이 이 설문에 한 번 응답할 수 있어요. | Send · Send to {{n}} · Send this survey to these addresses? · Each recipient can answer once without signing in. |
| qdocs `survey.noEmail` | 이메일 없음 — 보낼 수 없어요 | No email — can't send |
| qdocs `survey.publicLink` · `survey.publicLinkHint` | 공개 링크 · 누구나 로그인 없이, 여러 번 응답할 수 있어요 | Public link · Anyone can answer, more than once, without signing in |
| qdocs `survey.rounds` · `survey.round.manual` · `survey.round.rule` · `survey.round.pending` · `survey.round.rate` | 회차 · 수동 · 규칙 «{{name}}» · 확인 대기 · 응답 {{n}} ({{pct}}%) | Rounds · Manual · Rule "{{name}}" · Awaiting confirmation · {{n}} responses ({{pct}}%) |
| qdocs `survey.resend` · `survey.resendMissing` · `survey.revoke` · `survey.skip` | 다시 보내기 · 다시 보내기 (미응답 {{n}}) · 회수 · 건너뛰기 | Resend · Resend to {{n}} unanswered · Revoke · Skip |
| qdocs `survey.rules` · `survey.rule.add` · `survey.rule.when` · `survey.rule.who` · `survey.rule.mode` · `survey.rule.modeReview` · `survey.rule.modeAuto` · `survey.rule.interval` | 자동 규칙 · 규칙 추가 · 언제 · 누구에게 · 보내기 방식 · 확인 후 발송 · 자동 발송 (대표만) · 같은 고객 최소 간격(일) | Auto rules · Add rule · When · To whom · Sending · Confirm before sending · Send automatically (owner only) · Min. days between surveys to the same client |
| qdocs `survey.rule.autoConfirm` | 이 규칙은 사람 확인 없이 고객에게 메일을 보냅니다. 켤까요? | This rule emails clients without anyone confirming. Turn it on? |
| qdocs `survey.convertBanner` · `survey.convert` | 이 표는 설문으로 응답을 받고 있어요. · 설문으로 전환 | This table is collecting survey responses. · Convert to survey |
| qtable `colType.yesno/rating/scale` | 예/아니오 · 별점 (1~5) · 척도 (0~10) | Yes / No · Rating (1–5) · Scale (0–10) |
| qtable `qType.*`(설문 말투) | 단답 · 장문 · 객관식 (하나) · 체크박스 (여럿) · 예/아니오 · 별점 (1~5) · 척도 (0~10, 추천지수) · 숫자 · 날짜 · 이메일 · 전화 | Short answer · Paragraph · Multiple choice · Checkboxes · Yes / No · Rating (1–5) · Scale (0–10, NPS) · Number · Date · Email · Phone |
| qtable `stats.nps` · `stats.promoters` · `stats.passives` · `stats.detractors` · `stats.multiHint` | 추천지수 (NPS) · 추천 (9~10) · 중립 (7~8) · 비추천 (0~6) · 여러 개를 고를 수 있어 합이 100% 를 넘을 수 있어요 | NPS · Promoters (9–10) · Passives (7–8) · Detractors (0–6) · Multiple picks allowed — totals can exceed 100% |
| qtable `stats.scope.all/round/period` | 전체 · 회차 · 기간 | All · Round · Period |
| qtable `survey.public.hello` · `alreadyResponded` · `preview` · `scaleLow` · `scaleHigh` · `yes` · `no` | {{name}}님, · 이미 응답하셨어요. 감사합니다. · 미리보기 — 제출되지 않아요 · 전혀 아니다 · 매우 그렇다 · 예 · 아니오 | Hi {{name}}, · You've already answered. Thank you. · Preview — nothing is submitted · Not at all · Very much · Yes · No |
| common `todo.verb.send_survey` | 설문 보내기 확인 | Confirm survey send |
| qtable `survey.public.err.already_responded` | 이미 응답한 링크예요. | This link has already been used to answer. |

---

## 9. 단계 나누기

### Phase 1 — «설문» 이 보이고, 만들고, 골라서 보낸다
**바뀌는 것**: 시작점·종류·네 탭 화면 · 문항 종류 3개(별점·척도·예/아니오) + 설문 말투 · 설명 = 본문 · 수동 보내기(개인 열쇠·EmailLog·확인창) · 회차/받는 사람 표 · 통계(NPS·범위) · 일반 표에서 통계·설문 버튼 제거 · 복사 계약.

| 영역 | 파일 |
|---|---|
| 모델·스키마 | `models/Post.js`(kind ENUM) · `models/QRecordRow.js`(+2 컬럼) · 신규 `models/SurveyIssue.js`·`SurveyRecipient.js`·`SurveyRule.js`(표만 만들고 Phase 2 까지 안 읽음) · `models/index.js` 연관 · `scripts/migrate-survey-v2.js`(멱등, 배포 슬롯 등록) |
| 판정·계산 | `services/survey.js`(questionsOf 설문 말투·SKIP_TYPES 확장·validateAnswers 3종·resolveSurveyToken 개인 열쇠+kind 2종+already_responded) · 신규 `services/surveyStats.js`(statsOf 이동 + 별점·척도·NPS·범위 — **calc 정본**) · 신규 `services/surveyIssue.js`(회차 생성·보내기·재발송·회수 — cron 도 이걸 부른다) · 신규 `services/clientContact.js`(`primaryEmailOf`) · `services/emailService.js`(`sendSurveyInviteEmail`) · `services/posts.js`(canEditPost 그대로) |
| 라우트 | `routes/survey_public.js`(개인 열쇠·opened_at·description_html·410 already_responded) · 신규 `routes/survey_manage.js` → `/api/surveys/:recordId/{issues,issues/:id/resend,recipients/:id/revoke,preview,candidates}`(records.js 가 498줄이라 새 파일 — `duproute` 가드 통과, 마운트 순서 기록) · `routes/records.js`(`survey-stats` 범위 인자 · 멤버 술어 · `stripRecordSecrets` 유지) · `routes/posts.js`(kind 허용 목록 3곳 `:257·:478-520` + `services/actions/post_actions.js:70` · kind 변경 table↔survey · 복사 `:546-576` 설문 분기) · `config/plans.js`(`survey_sends_monthly`) · `services/planEngine`(`can('send_survey')`) |
| 화면 | `services/qtable.ts`(3 타입·회차 API·통계 타입) · `services/docs.ts`(`DocKind`·`KIND_LABELS`) · `services/posts.ts`(docKind) · `components/Docs/KindIcon.tsx` · `PostsPage.tsx`(새 문서 항목·좌측 필터·kind=survey 네 탭·kind 전환 3종·표에서 토글 제거·전환 배너) · `PostAiModal.tsx`(mode 'survey' + 질문 세트 시드) · 신규 `components/Docs/Survey/SurveyEditor.tsx`(문항 카드) · `SurveyPublishTab.tsx`(공개 링크·회차·보내기 — `SurveyDrawer.tsx` 내용 흡수 뒤 삭제) · `SurveySendModal.tsx` · `SurveyStats.tsx`(별점·NPS 카드·범위 칩) · `PostTableGrid.tsx`(3 타입 셀 편집기·시스템 칸·SurveyBar 제거) · `pages/Public/PublicSurveyPage.tsx`(설명 HTML·별·알약·예/아니오·인사·이미 응답·미리보기) · `locales/{ko,en}/{qdocs,qtable}.json` |
| 검사 | `scripts/health-check.js --category=secrets` +2 · `scripts/e2e/canary-survey.js`(`--suite survey`) · 가드 전체(`guard-invariants.js` i18n·parity·autosave·drawerwidth·duproute·savemerge) |

**Phase 1 검증 (실호출 3003 · 3폭 · 양성 대조군)**
1. `npm run build` EXIT 0 · `error TS` 0 · 가드 전체 · `health-check --category=secrets`(회차 목록·응답 행 원문에 토큰 0 + `has_responded` 는 그대로 옴).
2. 실호출: owner 로그인 → `POST /api/posts {kind:'survey'}` → 칸에 rating·scale·yesno 추가 → `POST /api/surveys/:rid/issues {client_ids:[시험 고객], closes_at}` 201 · EmailLog 1행(`survey_invite`) · 받는 사람 `status='sent'` → 개인 열쇠 `GET /api/survey/:tok` 200(opened_at 찍힘, 응답에 다른 응답·id 없음) → `POST responses` 201 → 줄에 `survey_issue_id`·`survey_recipient_id` 있음 → **같은 열쇠 재제출 410 already_responded** → 통계 `GET survey-stats?issue_id=` 의 평균·NPS 가 §4.1 검산 1·2 와 일치(검산 값을 그대로 넣어 재현).
3. 거절: 고객 역할로 issues POST 403 · 다른 워크스페이스 `client_ids` 400 · 이메일 없는 고객 400(조용히 빠지지 않음) · 보안등급 internal 문서 보내기 409 · 익명 켠 뒤 응답 → 줄의 `survey_recipient_id` NULL **그리고** 받는 사람 `responded_at` 찍힘 · 공개 링크 토큰으로 두 번 응답 둘 다 201(회귀 없음) · 옛 표-설문(`kind='table'`) 공개 링크 그대로 200.
4. 화면 3폭(390·768·1440): 새 문서 › 설문 → 편집 → 보내기 모달 → 확인창에 주소가 **보이는가**(좌표+`elementFromPoint`) → 공개 화면 별·알약 44px 터치 → 제출 → 응답 탭에 줄·이름 · 통계 탭 NPS 카드. 일반 표에 «통계» 토글이 **없는가**(음성 대조군: 설문에는 있는가).
5. 양성 대조군: `resolveSurveyToken` 의 kind 조건을 `'table'` 로 되돌리면 설문 개인 열쇠 404 로 뒤집히는가 · NPS 분모를 전체 줄 수로 바꾸면 검산 1 이 틀리는가.

### Phase 2 — 자동 규칙 · cron · 확인필요 · 옵트아웃 · 리마인더
| 영역 | 파일 |
|---|---|
| 서버 | 신규 `services/surveyRuleCron.js`(§6.2) · `server.js` 등록(다른 cron 과 같은 자리) · `routes/survey_manage.js` 규칙 CRUD(`/rules`, `send_mode='auto'` 는 owner/admin 만) · `routes/dashboard.js collectSurveyIssues` + `todo.verb.send_survey` ko/en · `routes/survey_public.js opt-out` · `models/Client.js survey_opt_out_at` · 메일 바닥글 «더 받지 않기» · 리마인더(`reminded_at`) |
| 화면 | `SurveyPublishTab.tsx` 규칙 섹션 + 신규 `SurveyRuleDrawer.tsx`(DetailDrawer) · 확인필요 카드(`TodoPage`/대시보드 `type:'survey'`) · 회차 «확인 대기» 행의 [보내기][건너뛰기] |
| 검사 | `scripts/e2e/canary-survey-auto.js`(`--suite surveyauto`) · `--suite inboxcount` 회귀(배지 합) |

**Phase 2 검증**
1. 규칙 «프로젝트 완료 리뷰» 켬(`enabled_at` = 지금) → 시험 프로젝트 `PUT status:'closed'` → `surveyRuleCron.run(now + 3일)` 1회 → 회차 `pending_review` 1건 + 확인자 알림 1건 + 확인필요 `total` +1(배지 = 목록) → **두 번 돌려도 1건** → [보내기] → EmailLog 1행 → 상태 `sent`.
2. 음성 대조군: 규칙 끔 → 0건 · `DELETE /api/projects/:id`(삭제 = closed 지만 이력 없음) → 0건 · `enabled_at` 이전에 닫힌 프로젝트 → 0건 · 다시 열어 `active` 로 되돌린 프로젝트 → 0건 · `kind='internal'` 프로젝트 → 0건 · 다른 워크스페이스 고객 → 0건 · 90일 안에 보낸 고객 → `skipped` · 옵트아웃 고객 → 제외.
3. 신규 고객: 시험 고객 초대 수락(`accepted_at`) → 7일 뒤 cron → 1건 · 수락 전(`accepted_at NULL`) → 0건.
4. 정기: `schedule quarterly` → 기간 키 `2026-Q4` 회차 1건, 같은 분기 두 번째 실행 0건, 다음 분기 1건.
5. `send_mode='auto'` 를 멤버가 PUT → 403 · owner → 200 + 확인창 문구가 화면에 보임 · auto 규칙은 cron 이 바로 `sent`.
6. 요금제 한도 초과 → `blocked_quota` + 대표 알림 하루 1회(두 번 돌려도 알림 1건).
7. `pending_review` 를 15일 뒤로 두고 cron → `expired`, 메일 0.

---

## 10. 안 하는 것 (이번 설계 밖)
SMS 발송 · 분기(조건) 문항 · 행렬 문항 · 파일 첨부 문항 · Q Talk 카드로 보내기 · 부분 저장 · 응답자가 결과 보기 · 멤버(내부) 대상 설문의 로그인 응답(공개 링크로 가능하다) · AI 에이전트 도구(쓰기 표면 확장은 별도 `design`).

---

## 11. Irene 이 정할 것 (3개 — 권고 붙임)

1. **자동 발행 메일을 바로 보낼까요, 사람이 확인한 뒤 보낼까요?**
   권고: **기본 «확인 후 발송»**(확인필요에 뜨고 [보내기] 한 번 — 주소가 보인다) + 규칙별로 **대표만** «자동 발송» 으로 바꿀 수 있게. 공용 규칙(외부 발송은 확인)·정기청구 선례와 같고, 켜고 싶은 팀은 켤 수 있다. 결과: 기본값에서는 리뷰 요청이 사람 손을 한 번 거친다(최대 14일 안에 안 누르면 사라진다).
2. **일반 표에서 «표 | 통계» 토글과 «설문으로 받기» 버튼을 뺄까요?**
   권고: **뺀다.** 설문 기능은 «설문» 종류에만 둔다. 표의 숫자 합계·평균은 이미 칸 바닥 집계(`aggregate`)가 한다. 기존에 표에서 설문을 켠 문서는 «설문으로 전환» 한 번(데이터 그대로). 결과: 표를 쓰는 사람에게 설문 흔적이 안 보인다.
3. **요금제별 월 설문 발송 한도(받는 사람 1명 = 1건)를 어떻게 둘까요?**
   권고: starter 20 / basic 100 / pro 500 / business 2,000 / enterprise 무제한, 자동 규칙은 basic 이상. 메일 비용·스팸 평판을 지키는 선이고 넘으면 «이달 N건 남음» 을 보내기 전에 보여 준다. 숫자는 `config/plans.js` 한 곳이라 뒤에 바꿔도 된다.

(익명 기본값 = 식별, 트리거를 원장 읽기로, 설문을 문서 종류로 두는 것 — 이 셋은 Fable 결정으로 둔다. 이유는 §2·§5.2·§6.1.)
