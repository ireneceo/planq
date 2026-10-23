---
paths:
  - "dev-backend/routes/email*.js"
  - "dev-backend/routes/mail_*.js"
  - "dev-backend/services/email*"
  - "dev-backend/services/mail*"
  - "dev-backend/scripts/*mail*"
  - "dev-frontend/src/pages/QMail/**"
  - "dev-frontend/src/components/Mail/**"
  - "dev-frontend/src/pages/Settings/*Mail*"
  - "dev-frontend/src/pages/Settings/Email*"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# Q mail — 메일 계정·폴더·배지·분류 기준·알림 계약

> **메일 계정은 받기와 보내기를 둘 다 잰다.** 연결·수정·[연결 테스트]가 IMAP 만 봐서, 보내기 아이디가 한 글자로
> 저장된 운영 네이버 계정이 «연결됨» 인 채 모든 발송이 535 였다. `services/email_credentials.verifySmtpCredentials` 는
> 발송(`emailSend.buildTransport`)과 **같은 규칙**(호스트 추정·포트·아이디 대체)으로 로그인만 한다 — 검사와 실제가 다르면
> 검사가 초록이어도 발송은 실패한다.

> **Q mail 폴더·배지 계약 (2026-09-17 박제)**
>
> ① **사람이 명시적으로 건 표시는 «확인 완료» 로 지워지지 않는다.** `following`·`assigned` 폴더는
>   `status != 'spam'` 하나만 본다(`services/mailFolders.js`, **두 폴더가 한 줄을 공유한다**).
>   Irene: *"내가 팔로우 해놨던 메일리스트가 없어졌어."* — 데이터는 멀쩡했고 폴더 조건이 `archived` 를
>   걸러 냈다(운영 실측 3건 전부, 2건은 **같은 초**에 = [모두 확인완료] 한 번). 팔로우·담당은 «내가 계속
>   보겠다/맡는다» 이고 확인완료는 «지금 처리했다» 다 — **다른 축**이다. 끄는 문은 팔로우 해제·담당 해제 하나.
>   한쪽만 고치면 같은 판정이 두 벌이 되어 다음 신고가 «담당 목록이 없어졌어» 로 똑같이 온다.
>
> ② **같은 글자를 상태와 행위에 같이 쓰지 않는다.** 빨간 「답변 필요」(뱃지 = 사실)와 회색 버튼
>   (= 눌러서 만들어라)의 글자가 같아 목록이 «같은 표시가 두 번» 으로 읽혔다. **상태는 명사, 행위는 동사**
>   (「답변 필요로 표시」). 한 행에 둘이 같이 뜨지 않아도 **목록 전체가 한 장면**이다.
>
> ③ **배지는 자기 축을 말한다.** 「답변 필요 50」·「확인 권장 3051」은 그 폴더 건수인데 「전체 3475」만
>   **미읽음**이다(`tabBadge('all') → allUnread`). `title`·`aria-label` 은 **터치 기기에서 안 뜬다** —
>   폰까지 닿게 하려면 **보이는 글자**가 필요하다. 그래서 그 탭의 **일괄 버튼에 건수**를 적는다
>   (「모두 읽음 (3475)」). 숫자·색·크기·자리는 건드리지 않는다(memory `feedback_fix_the_number_not_the_look`).
>
> ④ **버튼이 수를 적는 순간 그 수는 약속이 된다.** 라벨·확인 문구·실제 처리량이 **모두 같아야** 한다.
>   2026-09-17 실측 — 라벨 3475 / 확인 3522(`folderCounts` 를 읽는 다른 공식) / 실행 **499**
>   (`resolveBulkTargetIds` 의 `limit:500` 이 조용히 잘랐다). 「모두 읽음」이 모두가 아니었던 것은
>   **문구가 생기기 전부터의 결함**이고, 사용자에게는 "눌렀는데 안 없어진다" 로 보인다.
>   → 캡 제거(`BULK_CHUNK` 500씩 끝까지) · 상한 `BULK_MAX` 에 닿으면 `capped` 로 **화면이 말한다** ·
>     계정 필터(`account_id`)를 실행에도 싣되 **접근 가능한 계정 안에서만 좁힌다**(넓히면 권한 우회다).
>
> ⑤ **일괄 처리는 «id 를 거를 때» 범위를 건다.** 사용자가 준 `thread_ids` 를 그대로 쓰면 주 테이블의
>   `UPDATE … WHERE id IN (…) AND business_id = ?` 는 0건으로 막혀도 **딸린 테이블**
>   (`email_messages … WHERE thread_id IN (…)`)에는 막을 것이 없다. 2026-09-17 실측 —
>   **`200 {"updated":0}` 이라고 답하면서 남의 워크스페이스 메시지 3행이 읽음으로 바뀌었다**
>   (남의 사적 계정 스레드 16행도 같은 방식). 응답에 흔적이 없어 오래 안 보였다.
>   → `resolveBulkTargetIds` **한 곳**에서 `business_id` + 접근 가능 계정으로 **SELECT 를 통과한 id 만**
>     돌려주고, 그 뒤로는 주 테이블도 딸린 테이블도 그 id 만 쓴다.
>   → `body.account_id` 처럼 **좁히는 인자**는 접근 가능 집합 안에서만 교집합을 낸다 — 넣은 값을 그대로
>     쓰면 좁히는 인자가 **넓히는 문**이 된다.
>   → 상한(`BULK_MAX`)에 닿는 경우, 후보 SELECT 에 **«아직 안 된 것» 술어**를 걸지 않으면 매번 같은
>     첫 N개를 다시 집어 `updated:0` 이 되고 "다시 누르면 이어서" 가 거짓말이 된다(실측 `1000 → 0`).
>   memory `feedback_bulk_scope_on_ids_not_only_rows`.
>
> ⑥ **답장 발신 주소 = «받은 주소»** — `services/mailIdentity.receivedAddressesOf`(마지막 inbound 의 **To 다음 Cc**) 한 함수를
>   답장 발송·미리보기가 같이 쓰고, `emailSend.resolveSender ②` 가 그 순서로 **처음 나오는 우리 주소**(별칭·계정 본주소)를 고른다.
>   답장 화면 자동 선택도 같은 규칙. 미등록 주소로는 보낼 수 없다 → 화면이 «별칭으로 등록» 을 안내한다(2026-10-01).
>
> ⑦ **분류 기준은 카탈로그 한 벌이다** (2026-10-15, Irene *"상세 조건들을 모두 설정에 나오게 하고 … 투명하게 공개하자"*) —
>   `services/mailCriteriaCatalog.js` 가 기준 id·폴더·끌 수 있는지·**찾는 말**을 들고, 판정 엔진(emailTriage)과 설정 화면
>   (`GET /mail-criteria` → `MailCriteriaSection`·공용 `components/Common/CriteriaList`)이 **같은 목록**을 읽는다. 설명을 따로 쓰지 않는다
>   (설명은 id → i18n `qmail:criteria.<id>`). 폴더를 정한 기준은 `email_threads.triage_criterion` 에 남는다.
>   끄기는 `businesses.permissions.mail_criteria.off` (owner/admin) — 미리보기·소급은 `services/mailRetriage.criterionImpact` **한 함수**(미리보기 수 = 옮긴 수).
>   새 기준: `inbound_action`(새 주문·문의·답변 도착 → 자동이어도 **답변 필요**) · `auto_ack`(자동응답·접수 확인 → 확인 권장 —
>   `Precedence: bulk` 는 `Auto-Submitted` 가 없을 때만 광고 증거) · `spam_rescue`(스팸이지만 아는 상대 → 확인 권장) · `platform_notice`(PlanQ 알림 분리).
>   역할 주소(info@·help@)의 안내는 **확인 권장 유지**(Fable 결정 ④ — 뒤집으면 dev 950건) — 꼭 받을 곳은 «답변 필요로» 2회 학습·규칙.
>   학습 확대: «답변 필요로» 2회 → 주소 `always_reply` · «확인 권장으로»(`POST …/mark-review`) 2회 → 주소 `review` · 반대 규칙은 갈아 끼운다.
>   Q sale 도 같은 목록 컴포넌트 — `sales_intake.off`(replied·personal) · `domains.always/never`(키워드·자동 학습 없음).
>   설계 `docs/MAIL_CRITERIA_DESIGN.md` · 운영 `migrate-mail-criteria.js`(배포 슬롯) · 옛 메일은 `retriage-mail.js --promote-only --promote-reply-criterion=inbound_action`(+ `--fill-criterion`) 수동.
>
> ⑧ **메일 알림 범위는 «메일함 기본값 + 사람별 덮어쓰기»** (2026-10-22, Irene *"회사 건 받고 개인 거 안 받거나 … 반대도"* · Fable 설계) —
>   `email_account_notify_prefs`(사람 × 메일함, `off|reply_only|recommended|all`, **행 없음 = 메일함 기본값** — ENUM 에 default 없음).
>   판정은 `services/mailNotify` 한 곳: 수신자 집합(개인=주인·회사=활성 멤버)은 그대로 두고 **좁히기만** 한다 · `off` 는 답변 필요도 끈다 ·
>   전원 거절이면 시간당 캡을 쓰기 **전에** 끝 · 중복 표시(`seenRecently`)는 **실제로 알릴 사람만** 찍는다(끈 메일함이 켠 메일함 알림을 «중복» 으로 버리던 순서).
>   본인 설정 API `routes/email_account_notify.js`(GET my-notify · PUT :id/my-notify, 볼 수 있는 메일함만 — 남의 개인 계정 404) · 화면 설정 > 알림 «메일 주소별 알림».
>   채널 매트릭스(mail × 채널)와는 독립 축. 운영 `migrate-mail-notify-per-user.js`(배포 슬롯, 코드보다 먼저). 설계 `docs/MAIL_NOTIFY_PER_ADDRESS_DESIGN.md`.
>
> 회귀: `node scripts/e2e/run.js --suite maillabel` (16검사 — 폴더 술어 · i18n 원천 ko/en · 실화면 문구 ·
> 배지 축 · **폰(375) 가시 단서** · 누르기 전후 수 일치).
> ★ **빌드된 locales 는 `gzip_static`** 이다 — 대조군으로 문구를 되돌릴 때 평문 `.json` 만 바꾸면
>   브라우저는 옛 `.json.gz` 를 받아 **아무 변화가 없다.** 둘을 같이 바꾼다(이것 때문에 "검사기가
>   빨간불을 못 켠다" 로 잘못 결론 낼 뻔했다 — 적용이 안 됐던 것이다).

