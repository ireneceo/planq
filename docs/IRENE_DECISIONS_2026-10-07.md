# Irene 결정 대기 8건 — 2026-10-07 Fable B 판정 기반

> 원문: 아래 «부록 — Fable B 판정 원문»(2026-10-07, 이전 세션 기록에만 있던 것을 옮겼다).
> B 판정 1(다른 기기 보는 중 푸시 생략)·6(유예 잠김)·3 중 create_event 칸은 **이미 구현·배포**됐다(행 15·37·39).
> 아래 8건은 **Irene 이 정해야 진행되는 것**이다. 답은 번호와 기호로 주면 된다 (예: «1-가, 2-권고, 3 전부 권고대로»).

| # | 정할 것 | 선택지 | 권고 (Fable) | 답이 오면 할 일 |
|---|---|---|---|---|
| 1 | **Kate·Aidan(K-DINE) 이 같은 회사인가** + 고객 채널 원칙 | 가) 같은 회사 → 고객 행 하나로 합치고 채널 하나 · 나) 다른 회사 → **고객별 채널**(프로젝트×고객) · 다) 지금처럼 한 방 공유 | 다른 회사면 **나)**. 다)는 권하지 않음 — 지금 Kate 의 청구서 카드가 Aidan 에게도 보인다(청구 카드는 프로젝트 첫 고객 채널로 간다) | 가) 고객 행 병합(운영 데이터 — 지시 받고) · 나) `project_channel`·`clientOnboarding`·`invoiceDelivery`·채널 시드 한 함수로 + 백필 + health-check → Fable 게이트 |
| 2 | **프로젝트 복사본의 고객 연결** — 복사 라우트는 고객 연결만 가져오고 `contact_user_id` 는 비워 두는데, 백필 스크립트가 나중에 채운다(= 복사본도 고객에게 보이게 된다) | 가) 복사 즉시 고객에게도 보이게(복사 라우트가 직접 채움) · 나) 복사본은 고객에게 안 보이게(백필이 복사본을 건너뜀, 고객 연결은 사람이 다시) | **나)** 를 권함(제 판단 — 복사는 보통 «새 건 준비» 라 고객이 미리 보면 곤란. Fable 은 결정을 Irene 에게 넘김) | 둘 중 하나로 복사 라우트 또는 백필 한 곳 수정 + clientlink 검사 |
| 3 | **AI(ChatGPT·Claude) 쓰기 도구 보강** | ① 프로젝트 만들기 v1 에 **기존 고객 연결** 포함? ② 새 권한 `projects:write` 따로? ③ AI 가 **태그를 새로 만들** 수 있게? ④ AI 가 만든 메모 기본 공개 범위 L1(본인만) 유지? | ① 포함(기존 고객만, 확인 창에 이름 표시) ② 따로(동의 화면에 «프로젝트를 만든다» 가 보이게 — 이미 연결한 앱은 다시 연결해야 생김) ③ **아니오**(오타마다 태그가 늘어남, 있는 태그만) ④ L1 유지 | 프로젝트 생성을 행동 계층으로 옮기고 `create_project`(확인 2단계)·`create_memo`·`create_knowledge_item`·태그·예상시간 → Fable 게이트 |
| 4 | **메일 보낸편지함·스팸함 가져오기** | ① 순서 ② 스팸 보관 기간 ③ 스팸함 처음 가져오기 범위 | ① **보낸편지함 먼저**(다른 앱에서 보낸 답장이 PlanQ 에 안 보이는 것·«아는 상대» 판정이 같이 풀림) ② 30일 뒤 자동 삭제 ③ 최근 14일부터 | 설계 1쪽 → Fable → 구현(폴더별 위치 기록 표 신설, 업체 쪽은 읽기만) |
| 5 | **Cue 질문 분석 + 옛 질문 기록 보관기간** | ① 주제 통계(누가 물었는지 없이)는 기본 켜짐? ② 질문 원문 30일 보관은 기본 꺼짐(동의한 곳만)? 아예 안 함? ③ 지금 기한 없이 쌓이는 질문 기록(`help_question_logs`, 운영 9건)을 **90일 보관**으로 소급 삭제 | ① 켜짐 ② 꺼짐·동의한 곳만 ③ 소급 적용(지금은 방침에 없는 무기한 보관) | 방침(legal.json) 2곳 + 재동의 · 분류·가명처리·보관 cron → Fable 게이트. ③만 먼저 해도 된다 |
| 6 | **구글 캘린더 여러 개 중 고르기** — 권한 1개(«캘린더 목록 읽기») 추가 필요 | 가) 아직 안 낸 **구글 OAuth 심사에 이 권한을 넣어서** 제출(제출 전에 기능·방침 배포) · 나) 심사는 지금 권한대로 먼저, 이 기능은 나중(그때 재심사·기존 사용자 재동의) · 다) 캘린더 ID 손으로 붙여넣기 | **가)** — 제출 전인 지금이 가장 싸다. 1차는 **개인 캘린더만** | 권한 이름을 구글 콘솔에서 확인 → `primary` 14곳을 한 함수로 → 연결 화면에 선택 → 방침 한 구절 |
| 7 | **AI 연결 겹침** | ① Claude 는 주소가 하나라 **개인·조직 Claude 계정을 같은 워크스페이스에 붙이면 서로 끊는다** — 받아들일지 ② 운영에 이미 겹쳐 있는 ChatGPT 연결 2건(grant 3·4) 정리 | ① 받아들임(같은 사람이 같은 워크스페이스에 두 계정을 쓰는 경우가 드묾 — 생기면 그때 «앱 계정별» 구분 추가) ② 연결 목록에서 Irene 이 안 쓰는 쪽을 [끊기] (운영 데이터라 제가 지우지 않음) | ① 변경 없음 · ② Irene 이 화면에서 처리하거나 «지워» 지시 |
| 8 | **#462 일정 알림 선택**(김미정) | 가) 구글처럼 — 등록 창에 «참석자에게 알림 보내기»(기본 켜짐) + 한 줄 메시지, 시간 바꿔 저장할 때 «변경 알림을 보낼까요?»(받을 사람 표시) · 나) 지금 그대로 | **가)** (제 판단 — 외부 발송은 «확인을 받는다» 규칙과 같은 방향. 고객 참석자 알림 여부는 이번에 같이 정하지 않음) | 등록·수정 화면 + 서버 발송 조건 → Fable 게이트(외부 발송 조건) · #462 답글 |

## 우선순위 (Fable)
1(고객 가시성 결함) → 3·2 → 4 → 6(심사 제출과 묶음) → 5. 8 은 화면 작업 위주라 답이 오면 바로.

---

## 부록 — Fable B 판정 원문 (2026-10-07)

# Fable 판정 — 8안건 (2026-10-07, 코드·운영 DB 직독, 코드 수정 없음)

읽은 것: CLAUDE.md · `docs/FABLE_GATE_QUEUE.md` 행 15·17·22·23 · `routes/notifications.js` · `server.js` 소켓 · `services/push_service.js` · `routes/projects.js` POST / · `services/agent/registry.js` + `tools/tasks.js` · `services/actions/{task,event}_actions.js` · `services/emailImapCron.js` · `models/EmailAccount.js` · `services/mailFolders.js` · `routes/cue.js` + `models/HelpQuestionLog.js` · `services/plan.js` · `services/trial.js` · `services/billing.js` · `services/clientOnboarding.js` · `services/project_channel.js` · `services/invoiceDelivery.js` · `services/personalCalendar.js` · `services/personalOauth.js` · `services/googleScopes.js` · `legal.json` · 운영 DB(businesses·subscriptions·email_accounts·conversations·project_clients·push_subscriptions·email_threads·external_connections·help_question_logs).

---

## 1) 행 15 — 같은 계정이 다른 기기에서 보고 있으면 채팅 푸시 생략

**권고**: 구현한다. 술어는 **«같은 방을 보고 있는 소켓이 있는가»** 하나로 좁힌다 — «어디서든 활성» 은 쓰지 않는다.
- 생략 조건 = 그 userId 의 소켓이 `conv:${id}` 방에 있고(`io.sockets.adapter.rooms`) **그 소켓이 90초 내 `presence:visible` 를 보냈다**(클라 `services/socket.ts` 한 곳에서 `visibilitychange`+`focus`+입력/스크롤 throttle 로 emit, hidden 이면 `presence:hidden`). 둘 다 참일 때만 생략. 신호가 없으면(옛 번들·앱 백그라운드·재시작 직후 메모리 비어 있음) **보낸다**(fail-open — 외부 발송 조건은 «놓침» 쪽 실패가 더 비싸다).
- 범위: chat 의 `eventKind in ('message','mention')` 만. 다른 event_kind 는 무변경. mention 도 같은 방을 보고 있으면 소음이라 생략(방을 안 보고 있으면 종전대로 push).
- 인앱 토스터·`notification:new`·inbox 행은 그대로(다른 기기 소켓이 받는다). 배지: iOS 뱃지는 push payload 가 세우므로 생략된 기기의 뱃지가 다음 push 까지 낡는다 — 1차에서는 **감수**(활성 기기가 읽으면 `user:N` 방으로 읽음이 전파돼 열면 맞는다). 무음 push 로 뱃지만 보내는 것은 2차.
- 생략은 **PushLog 에 `status:'skipped', error_message:'viewer_active'`** 로 남긴다 — 운영에서 «몇 건 생략했나» 를 셀 수 있어야 한다(지금 skipped 는 `no_subs`·`no_apns_key` 뿐).

**이유**: 신고 원문이 «같은 아이디가 다른 디바이스에서 **대화중**» — 같은 방 술어로 정확히 덮인다. «어디서든 활성» 은 데스크탑 탭이 보이기만 해도(자리 비움) 폰 push 가 사라지는 역방향 신고를 만든다. 운영 실측: push 구독 1,478 중 활성 15, 사용자 1·3 이 각 3기기 — 다기기 사용자는 실제로 둘뿐이라 좁은 술어로 충분하다.

**확인한 전제**: ③ PM2 `ecosystem.config.js` instances:1·fork → 프로세스 메모리로 충분. cluster 로 바꾸면 Redis adapter 가 필요하니 서버 시작 시 `instances===1` 아니면 presence 를 끄는 가드 한 줄. 재시작 = 메모리 빈 상태 = 보낸다(안전). ④ 네이티브 앱 백그라운드: WKWebView 가 JS 를 멈추면 socket.io ping 이 끊겨 ≤45초(기본 pingInterval 25+pingTimeout 20) 안에 서버가 disconnect 로 본다 + `presence:visible` 신호가 90초를 넘기면 어차피 생략 조건이 깨진다 → 오판 창은 최대 90초. ⑥ 설정 토글 불필요(Slack 도 없다 — 기존 `notification_prefs` push 토글이 이미 있다).

**범위**: `server.js`(socket.data.visibleAt + `presence:*` 핸들러) · `routes/notifications.js` push 분기 앞에 `isViewingConversation(userId, convId)`(services/presence.js 신설, 한 함수) — 호출부는 `routes/conversations.js` 가 `entityType:'conversation'` 을 이미 넘기므로 notify 안에서 판정 · `services/socket.ts` presence emit · PushLog skipped 사유. 스키마 0.

**검증(⑦)**: 브라우저 컨텍스트 2개(신원 분리) + 두 번째 기기 구독: (a) A 가 방을 열고 visible → B 발송 → PushLog `skipped/viewer_active` (b) A hidden → sent (c) A 가 다른 방 → sent (d) mention 동일 (e) presence 없는 옛 번들 모사(emit 제거) → sent (f) 소켓 강제 종료 후 → sent (g) 양성 대조군: 술어를 `true` 로 → 전부 skipped. 인앱 토스터는 종전 4시나리오 그대로.

**Irene 결정**: 없음(구현 가능). 단 «mention 도 같은 방이면 생략» 이 싫으면 한 줄로 말해 달라(기본은 생략).

---

## 2) 행 17 — AI 도구 «프로젝트 만들기»

**권고**: `create_project` **MEDIUM(확인 2단계)** 로 넣는다. v1 입력: `name` · `description?` · `kind(client|internal)` · `project_type?` · `start_date?/end_date?` · `stage_template?` · `client_ids?`(**이미 있는 고객만**, id) · `member_user_ids?`(**이미 멤버인 사람만**) · 채널은 라우트 기본값(내부 + kind=client 면 고객 채널). **제외**: 고객 신규 생성·초대 메일, 멤버 초대, 프로젝트 복사, 상태 변경.

**이유**: 라우트 `POST /api/projects`(routes/projects.js:255~) 가 이미 `plan.can('create_project')`·멤버 검증·stage 시드·감사·`project:new` 방송을 한다 — 행동 계층으로 **그대로 옮기면** AI 와 화면이 같은 함수를 쓴다(가드 `actionlayer` 요구). 고객 연결은 HIGH 가 아니다 — 외부 발송이 없고 화면이 하는 것과 같다. 다만 계정 있는 고객은 연결 즉시 프로젝트·고객 채널이 보인다(행 18·22 의 `linkClientToProjects`/`joinProjectCustomerChannels`) = **가시성 확대** → 그래서 MEDIUM 이고, **미리보기에 연결될 고객·멤버 이름을 적는다**(이름 없는 확인은 확인이 아니다). 요금제 한도는 `plan.can` 거절을 미리보기 단계에서 먼저 본다(거절될 요청에 토큰을 내주지 않는다 — M2-b 규칙).

**범위**: `services/actions/project_actions.createProject(actor, params, {transaction})` 신설(라우트 본문 이전, 라우트는 호출만) · registry 1개 + `tools/projects.js` preview/handler · scope `projects:write` **신설**(기존 grant 는 재연결 — 행 16 결정과 같음) · 감사 `agent.create_project` + `project.create` 행에 `via` · 가드 `agentsurface` 통과(도메인 모델 직접 쓰기 0). 다건 생성은 정책 §7(10분 5건) 그대로. 스키마 0.

**Irene 결정**: ① `client_ids` 연결을 v1 에 넣을지(권고: 넣되 기존 고객만·미리보기에 이름) ② `projects:write` 를 별도 scope 로 둘지 `tasks:write` 에 얹을지(권고: 별도 — 동의 화면에서 «프로젝트를 만든다» 가 보여야 한다).

---

## 3) AI 쓰기 도구 보강 범위

먼저 사실 정정 — **`create_task` 에 `due_date`·`start_date` 는 이미 있다**(registry L61, `tools/tasks.js:207` 검증까지). **`create_event` 에 `end_at` 도 이미 있다**(필수). 실제 빈 것은 아래다.

**권고 — LOW(그대로 추가, 알림 없음·단건)**:
| 도구 | 추가 입력 | 재사용 |
|---|---|---|
| `create_task` | `tag_names?`(워크스페이스에 **있는** 태그 이름만, 없으면 VALIDATION 으로 목록 안내 — 태그 생성은 안 함) · `estimated_hours?`(담당자=본인일 때만 — §5.7) | `TaskTag`/`TaskTagLink` · `task_actions.createTask` params 확장 |
| `create_event` | `reminder_minutes?` · `task_id?`(`eventTaskLink.resolveTaskLink` 이미 action layer 에 있음) · `meeting_url?`(수동 링크, provider manual) | `event_actions.createEvent` 가 이미 받는다 — **registry 스키마만** 연다 |
| `create_memo`(신설) | `title` · `body`(Markdown) · `project_id?` · `client_id?` | q-note `create_session(input_type:'text')` 을 **내부 키 경로**(`/api/sessions/internal/*`, `x-internal-api-key` — `qnoteOwnership.js` 와 같은 통로)로 호출. 기본 L1(본인만) |
| `create_knowledge_item`(신설, Q info) | `title` · `body` · `category` · `scope?/project_id?/client_id?` · `fields?`(secret 칸 제외) | `routes/kb.js:286` 본문을 `services/actions/kb_actions.createDocument` 로 이전(임베딩·cue_usage·감사 포함). scope 는 M3 선례대로 **`docs:write`** 에 두고 메뉴 `qinfo` write 를 본다 |

**권고 — MEDIUM(확인 2단계, 사람에게 알림이 간다)**:
| 도구 | 왜 MEDIUM |
|---|---|
| `create_task.reviewer_user_ids?` → 별도 `add_task_reviewers` | `task_actions.addReviewer` 가 컨펌자에게 알림·확인필요 버킷을 만든다 |
| `invite_event_attendees(event_id, attendees[])` + `auto_create_meeting?` | 참석자(멤버·고객)에게 알림/메일(.ics) — 설계 §6.3 «참석자 지정은 MEDIUM» 그대로. Meet 은 **그 멤버 본인** 구글 연동 쓰기 scope 가 있을 때만, 없으면 `meetWarning` 으로 «일정은 저장됨» 을 알린다(`event_actions` 가 이미 그렇게 한다) |

**이유**: 쓰기 도구 하나에 «알림이 가는 인자» 를 섞으면 risk 가 인자에 따라 달라져 registry 의 `MEDIUM=preview 필수` 검사가 뜻을 잃는다 → **알림 없는 것은 LOW 도구의 인자, 알림 있는 것은 별도 MEDIUM 도구**. 모두 행동 계층 한 함수(`createTask`·`createEvent`·`addReviewer`)를 재사용하므로 화면과 규칙이 갈라지지 않는다.

**범위**: registry 4~6개 · `tools/*.js` · `kb_actions`(라우트 이전) · q-note 내부 생성 엔드포인트 1개 · 설계서 §6.3 표 갱신. `docs:write`·`notes:write`·`schedule:write` 묶음은 그대로라 **재연결 불필요**(새 scope 없음). 스키마 0.

**Irene 결정**: ① 태그를 AI 가 **새로 만들 수** 있게 할지(권고: 아니오 — 이름 오타마다 태그가 늘어난다) ② 메모 생성 기본 공개 범위 L1 유지로 충분한지.

---

## 4) 행 23 — 업체 스팸함·보낸편지함 동기화

**운영 실측**: 계정 4개 전부 `imap_folder='INBOX'`, 커서 `imap_last_uid` **계정당 1개**(폴더별 아님). Gmail 3(비번 2·OAuth 1) · 네이버 1. 스레드 4,127 중 spam 2 — 업체 스팸함은 한 번도 안 들어왔다.

**권고**: **보낸편지함 먼저, 스팸함은 뒤**. 둘 다 «읽기 전용 미러»(업체 쪽 이동·삭제·플래그 변경 0).
- **폴더 이름은 하드코딩하지 않는다** — `getBoxes()` 의 SPECIAL-USE 속성(`\Sent`·`\Junk`)으로 찾고, 없을 때만 이름 후보(Gmail `[Gmail]/Sent Mail`·`[Gmail]/Spam`, 네이버는 속성이 없으면 이름 후보 표로)로 폴백. 찾은 이름은 `email_accounts` 에 저장해 화면에 보여준다(«이 계정의 보낸편지함: …»).
- **커서를 폴더별로** — `email_account_folders(account_id, folder, role sent|spam, last_uid)` 신설(멱등 스크립트, 배포 슬롯). `imap_last_uid` 는 INBOX 커서로 남긴다.
- **보낸편지함**: `direction:'outbound'` 로 저장, 읽음·알림 없음·답변필요 끔(행 28 `isOwnSentCopy` 와 같은 처리). PlanQ 가 SMTP 로 보낸 것은 Gmail 이 Sent 에 자동 복사하므로 **`message_id` 로 dedup 필수**(인덱스 있음 `email_messages_message_id`) — 안 하면 모든 발송이 두 번 보인다. 이것이 행 27 의 «무료메일 사용자는 아는 상대를 못 잡는다» 를 푼다(우리가 답한 스레드가 생긴다).
- **스팸함**: `status:'spam'` 으로 저장(기존 스팸 탭 술어 `status='spam'` 그대로). 확인필요·상담(`saleMailCriteria`)·알림·자동추출·FAQ 클러스터 **전부 제외**(status spam 은 이미 제외된다 — `mailFolders.js` 확인). [스팸 아님] = 로컬 `status→open` + **업체 쪽은 건드리지 않음**(사용자가 Gmail 에서도 풀어야 한다고 화면이 말한다). Gmail 30일 자동 삭제는 따라가지 않는다 — 우리 쪽 spam 은 **30일 뒤 자동 영구삭제**(같은 보존 기간, 휴지통 안 거침). 첨부는 **저장하지 않는다**(스팸 첨부가 File 로 들어가 쿼터·검색을 오염시킨다).
- **개인 메일 격리**: `owner_user_id` 가 이미 폴더와 무관하게 계정 단위로 막는다(`accessibleAccountIds`). 새 폴더도 같은 계정 행이라 추가 규칙 없음 — 단 보낸편지함은 **개인 계정 소유자만** 본다(회사 공용 계정의 Sent 는 멤버 전원).
- **비용**: 3분 tick 에 폴더 2개 추가 = 계정당 IMAP SELECT 2회(바이트는 UID 증분만). 초기 백필은 Sent 30일·Spam 14일로 cap. 네이버는 동시 연결 제한이 있어 **같은 연결에서 순차 SELECT**(연결을 늘리지 않는다).

**이유**: 스팸함 동기화는 «비어 있는 탭을 채우는» 가치뿐이지만, 보낸편지함은 **관계 판정(행 27)·답변필요 끄기(행 28)** 의 증거원이라 제품 가치가 크다. 둘 다 같은 폴더별 커서 구조 위에 올라간다.

**범위**: `emailImapCron.js`(폴더 루프·역할별 저장 규칙) · 모델 1 + 마이그레이션 · `email_accounts` 설정 화면에 폴더 표시 · spam 30일 삭제 cron · 설계 문서 1장. S=1 이라 **구현 전 설계 1쪽을 Fable 게이트**.

**Irene 결정**: ① 보낸편지함을 먼저 하고 스팸함을 뒤로 미루는 순서 동의 ② 스팸 미러 보존 30일 ③ 스팸함 백필을 처음부터(14일) 할지 «오늘부터» 만 할지.

---

## 5) Cue 질문 분석(주제화) — 개인정보 설계

**지금 상태**: `help_question_logs` 가 **원문 1,000자 + user_id + business_id** 를 **무기한** 저장한다(qhelper·public 만, 운영 9건). 워크스페이스 모드(데이터 질문) 는 저장 안 함. 방침 `legal.json` 에 «질문 로그» 항목 없음(OpenAI 전송 문구만).

**권고**: **원문을 분석 원장에 넣지 않는다.** 두 단계로 나눈다.
1. **수집**: 질문 응답 직후 서버에서 **주제 라벨(기능 분류 enum ≤40종)·의도(howto/data/bug/feature_gap)·답변 성공 여부·모드·플랜 등급·언어** 만 `cue_question_topics` 에 적는다. `user_id`·`business_id` 는 **저장하지 않고** 일 단위 비밀 해시(랜딩 방문 집계 `landing_visitors` 와 같은 방식)로 «서로 다른 워크스페이스 수» 만 센다. 라벨링은 기존 LLM 호출의 출력에 분류 칸을 **같이** 받는다(추가 호출 0 — AI 최소 사용).
2. **원문**: 분류 실패분만 별도 `cue_question_raw` 에 **가명처리 후**(고객·멤버 표시명·이메일·전화·금액·URL 치환 — `utils/searchCells`/멤버 이름 사전) **30일** 보관 → 사람이 라벨을 보강 → 삭제. 워크스페이스 모드 질문은 **원문 보관 대상에서 제외**(고객사 데이터가 섞인다 — B2B 에서 우리는 그 데이터의 수탁자다).
- 접근: platform_admin 전용 화면, 텍스트만 렌더(저장형 XSS), 내보내기 없음.
- 동의: 워크스페이스 설정에 **«제품 개선을 위한 질문 주제 분석»** 스위치(기본 ON·opt-out) — 주제 통계만이면 PIPA §28-2 가명처리·통계 목적으로 opt-out 으로 족하지만, **원문 30일 보관은 방침에 항목·목적·기간을 적어야** 한다(`legal.json` 수집항목·보관기간 2곳 + `privacy_version` 올림 → 재동의 모달).
- **기존 `help_question_logs` 에도 같은 보존기간(90일)을 소급**한다 — 지금이 방침 밖 무기한 저장이다. 이게 당장 고칠 1건.

**이유**: 기능 보완 근거로 필요한 것은 «무엇을 많이 묻는가» 이지 «누가 무엇을 물었는가» 가 아니다. 원문을 쌓는 순간 고객사 이름·금액이 우리 분석 원장에 들어오고, 방침 188행 «AI 학습 데이터로 활용하지 않는다» 와 나란히 설명해야 하는 부담이 생긴다.

**범위**: 모델 2 + 마이그레이션 · 분류 칸 프롬프트 · 가명처리 함수(테스트 포함) · 보존 cron · 설정 스위치 · 관리자 화면 · 방침 2곳. R=1(방침·보관) → 구현 후 Fable 게이트.

**Irene 결정**: ① 기본 ON(opt-out) 인가 OFF(opt-in) 인가(권고: 주제 통계는 ON, 원문 30일 보관은 **OFF 기본·opt-in**) ② 원문 보관을 아예 안 할지(라벨 정확도 vs 부담).

---

## 6) 체험 종료 유예 7일에 모든 기능이 막힘

**확인(버그 맞음)**: `plan.js:93` `active = (!expired || inGrace) && ['active','trialing'].includes(status)`. `trial.js` 가 D+14 에 `subscription_status:'past_due'` + `grace_ends_at` 을 쓰므로 **status 검사에서 떨어져 유예 중 전부 `subscription_inactive`**. 운영 실측: business 10 «irene 의 워크스페이스» 가 지금 그 상태(trial 10-06 종료 · grace 10-13 · past_due) = 잠김. 유료 갱신도 같은 길(`billing.js` cron active→past_due→grace). 2026-06-10 수리는 `expired` 축만 고쳤고 `status` 축은 그대로였다 — memory 의 «올바른 식» 자체가 이 구멍을 갖고 있다.

**권고**: `active` 를 **상태표 하나**로 바꾼다.
```
status 'active'|'trialing'                 → 사용 가능
status 'past_due'|'grace' 이고 grace_ends_at > now → 사용 가능(유예)
status 'canceled'|'demoted' 또는 grace 지남 → 잠금
plan 'free'                                 → 항상 사용 가능(한도 내)
```
`inGrace` 판정을 `expired` 와 묶지 말고 `grace_ends_at` 단독으로 본다(체험은 `plan_expires_at` 이 null 이라 `expired` 가 영원히 false 다). 잠금은 D+21 `canceled` 전이(`trial.js` 3단계)가 담당하므로 **유예 중 막을 근거가 없다**. 화면 문구 «결제하지 않으면 잠금됩니다»(미래형) 는 그대로 맞게 된다 — 지금은 문구가 거짓이다.

**이유·위험**: R=1(결제 게이트). 넓히는 방향이지만 넓어지는 집합은 «유예 기간 7일 안의 워크스페이스» 뿐이고, 그 기간은 설계상 사용 가능이 맞다(`billing.js` 주석 «결제 대기 버퍼»). 회귀 검사: health-check 에 `can('upload_file')` 을 ①past_due+grace 미래 → ok ②past_due+grace 과거 → inactive ③canceled → inactive ④trialing → ok 네 줄 양·음성 대조군으로 추가. 캐시 `invalidateBusinessCache` 는 이미 전이마다 부른다.

**범위**: `services/plan.js` 한 함수 + health-check 4검사. 스키마 0. 운영은 배포 즉시 business 10 이 풀린다(데이터 수정 불필요).

**Irene 결정**: 없음 — 고친다. (유예 중 «읽기만» 으로 좁히고 싶으면 그건 별도 결정이지만 권고하지 않는다 — 결제 페이지로 가는 동선 외 모든 기능이 같은 `can()` 을 지난다.)

---

## 7) 한 프로젝트에 고객사 둘 — 고객 채널 공유 vs 고객별

**운영 실측**: K-DINE(프로젝트 6) 고객 채널은 **하나**(conv 18, `client_id=7` Kate 소유) 이고 참여자에 Kate(9)·Aidan(13) 둘 다 `client`. 모델상 `conversations.client_id` 가 **단수**라 채널은 구조적으로 «한 고객» 의 것이고, Aidan 은 거기에 얹힌 상태다. `invoiceDelivery.deliverChat` 은 **프로젝트의 첫 고객 채널**에 청구서 카드를 넣는다 → **Kate 의 청구서가 Aidan 에게 보인다**(지금 코드로 실제 그렇다). 게스트 링크도 방 단위.

**권고**: **고객(client)별 채널**이 맞다. 원칙 = «고객 채널의 축은 `project × client`, `client_id` 는 비워두지 않는다».
- 서로 다른 회사의 고객이 한 방을 쓰면 상대 회사의 요청·청구·첨부가 보인다 — 멀티테넌트 격리를 **우리 고객의 고객** 층에서 깨는 것이다. 같은 회사의 담당자 둘이면 **한 client 행에 contact 둘**이 맞는 구조이지 client 행 둘이 아니다(지금 Kate·Aidan 은 `company_name` 둘 다 null — 어느 쪽인지 데이터로는 모른다).
- 구현: `ensureProjectCustomerChannel(project, userId)` → `(project, clientId, userId)` 로 축을 바꾸고 `joinProjectCustomerChannels`(행 22)·초대 수락(행 18)·`invoiceDelivery`·guest_link 발급·프로젝트 생성 채널 시드가 **같은 함수**를 쓴다. 기존 `client_id=null` 인 프로젝트 고객 채널(운영 7 중 4) 은 그 프로젝트의 고객이 1명이면 그 client_id 를 백필, 2명 이상이면 첫 고객에게 붙이고 나머지는 새 방(참여 이력 보존 — 옛 방에서 빼지 않고 **새 메시지만** 새 방으로). 멤버 쪽 화면은 프로젝트 안에 «고객 채널 N개» 로 보인다.
- 역방향(공유 유지)을 택하면 `invoiceDelivery` 를 `client_id` 우선으로 고치고 채널에 «여러 고객사가 보는 방» 표시를 해야 하는데, 그래도 고객끼리 서로의 메시지를 본다 — 권하지 않는다.

**범위**: `project_channel.js` · `clientOnboarding.js` 2함수 · `invoiceDelivery.js` · `routes/projects.js` 채널 시드 · 백필 스크립트(멱등, 배포 슬롯) · health-check clientlink 에 «고객 채널의 client_id ≠ 참여 고객» 검출 추가. R=1(고객 가시성·백필) → 구현 후 Fable 게이트.

**Irene 결정**: ① Kate·Aidan 이 **같은 회사**인가(같으면 client 행을 합치는 게 정답이고 채널은 하나) ② 고객별 채널로 가는 원칙 승인.

---

## 8) 구글 캘린더 여러 개 중 고르기

**확인**: 개인·워크스페이스 모두 `calendarId:'primary'` 하드코딩(`personalCalendar.js` 7곳 · `google_calendar.js` 5곳 · orphan cleanup 2곳). 개인 scope `calendar.events`. 운영 개인 연결 2건(모두 calendar scope). `external_connections.metadata` JSON 이 있어 저장 칸은 이미 있다. OAuth 검증은 memory 기준 **미제출**(2026-08-10 이후 갱신 없음).

**권고**: **scope 하나 추가 — `calendar.calendarlist.readonly`**(목록 읽기 전용 세분 scope) + `external_connections.metadata.calendar_id`(기본 `'primary'`). 연결 화면에서 목록을 받아 고르게 하고, 선택이 없으면 primary. `calendar.events` 는 **id 를 알면 어느 캘린더에도** 읽기·쓰기가 되므로 쓰기 scope 는 그대로다.
- **심사 영향**: 세분 캘린더 scope 는 `calendar.events` 와 같은 **sensitive 티어**(restricted 아님 — CASA 없음). 검증이 **아직 미제출**이므로 **지금 묶어 넣으면 제출 1회**로 끝난다. 승인 뒤에 더하면 그 scope 만 재검증(증분)이고 기존 사용자는 재동의. 그래서 **제출 전인 지금이 가장 싸다**. `calendar.readonly`(전체 읽기) 는 쓰지 않는다 — 목록만 필요한데 모든 캘린더 본문 읽기까지 묶인다.
- 방침 `legal.json:37` 에 «구독 캘린더 목록(읽기)» 한 구절 추가(`privacy_version` 은 M3 에서 올린 것과 같은 배포에 묶으면 재동의 1회).
- 옛 연결(목록 scope 없음)은 `hasRequired` 로 감지해 «캘린더 선택은 재연결 후» 로 안내(지금 `hasCalendarWrite` 재동의 안내와 같은 모양).
- scope 를 못 늘리는 경우의 대안은 «캘린더 ID 를 손으로 붙여넣기»(events scope 로 바로 검증 가능) — 동작은 하지만 사용자가 ID 를 찾아야 해 권하지 않는다. 다만 **심사 지연 동안의 폴백**으로는 쓸 수 있다.
- ★ 세분 scope 이름(`…/auth/calendar.calendarlist.readonly`)은 2024년 이후 공개된 것으로 알고 있다 — 구현 전에 콘솔 scope 목록에서 **한 번 실제로 확인**한다(없으면 `calendar.readonly` 로 가되 방침 문구가 넓어진다).

**범위**: `personalOauth.js` scope 1 · `googleScopes.js` REQUIRED/OR 목록 · `personalCalendar.js`·`google_calendar.js`·`calendarOrphanCleanup.js` 의 `'primary'` 를 `calendarIdOf(conn)` 한 함수로(14곳) · 연결 화면 셀렉트 + `metadata.calendar_id` 저장 · 방침 1구절. 워크스페이스 연동(Meet 발급)은 별도 토큰이라 **같은 함수**를 쓰되 기본 primary 유지.

**Irene 결정**: ① OAuth 검증 제출을 **이 scope 를 넣어서** 하는 것(= 제출 전에 이 기능을 배포·방침 갱신) ② 워크스페이스 캘린더(오너 토큰)도 고르게 할지(권고: 1차는 개인만).

---

## 우선순위(내 판단)
6(한 줄 버그·운영 1개 워크스페이스가 지금 잠김) → 1(신고 재현 중) → 7(가시성 결함 — 청구서가 남의 고객에게) → 3·2(AI 보강, 같은 라운드) → 4(설계 1쪽 먼저) → 8(검증 제출과 묶음) → 5(방침 변경 동반).
