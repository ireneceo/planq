# PlanQ 안내방 · 워크스페이스 여정 — 설계 (Fable 판정)

- 기획: `docs/PLANQ_GUIDE_ROOM_PLAN.md` (Irene 결정 5개 확정 2026-10-30 «권고대로 진행해 줘»)
- Fable 설계 판정 2026-10-30: **VERDICT: DESIGN-FIX** — 아래가 정본. 기획서와 다르면 이 문서를 따른다.
- 이 문서는 Fable 원문을 그대로 옮긴 것이다(작업 모델이 고치지 않는다). 구현 기록은 맨 아래 «구현» 절에 덧붙인다.

## 실측 근거 (기획서와 다른 점 포함)
- `access_scope.canAccessConversation`·`conversationListWhere`·소켓 `canJoinConversation` 모두 **platform_admin 은 모든 대화방 통과**(복구·감사 목적, 설계 유지). 기획서 2절 «다른 Q talk 방은 지금처럼 못 본다» 는 **API 수준에서 거짓**(화면 경로만 없음).
- 안내방을 `conversations` 에 넣으면 `channel_type` 을 안 읽고 `business_id` 로만 세는 곳이 오염된다: `services/plan.js:237` 요금제 사용량(대화 수 한도), `services/onboarding.js` `start_conversation`, `services/adoptionStages.js` `team_chat`. «channel_type 읽는 23+9 파일 전수» 는 이 셋을 못 잡는다 — 배제 방법을 바꿔야 한다.
- Cue 자동답변 트리거(`routes/projects.js:1740`)는 `channel_type==='customer'` 일 때만 → 안내방은 구조상 안전. 고객 가시성은 participant/client_id 로만 → 고객 참여자 행만 막으면 안전. 게스트 링크·통계(`stats.js:390`)·고객 온보딩도 customer 한정 → 안전.
- 메시지 쓰기 라우트가 둘(`projects.js:1518` 화면이 쓰는 것, `conversations.js:747` 옛 것). 트리거를 라우트에 심으면 한쪽이 빠진다.
- `conversations.js:1237 DELETE` 는 workspace owner 가 어떤 방이든 지운다 → 안내방 삭제 차단 필요.
- `/help` qhelper 처리는 `routes/cue.js` 190~447 인라인 258줄 → 서비스로 떼어야 안내방이 같은 두뇌를 쓴다.

## 1. 엔진 — 1안(conversations + channel_type 'platform') 채택, 배제 장치는 아래로
근거: 위험한 길(워크스페이스 Cue 자동답변·고객 화면·게스트 링크)은 이미 `customer` 한정이라 새는 길이 없고, 2안의 핵심 장점(관리자가 다른 방을 못 봄)은 platform_admin 전역 통과 때문에 지금도 성립하지 않아 2안이 그 장점을 주지 못한다. 2안은 ChatPanel/실시간/읽음/첨부/번역/삭제 마스킹/멘션을 다시 짓는다.
- **상태 표 `support_rooms`**: `business_id UNIQUE · conversation_id · human_requested_at · cue_muted_until · nudges_off_at · admin_last_read_at · created_at`. 방 생성·관리자 받은편지함·«사람에게 묻기»·«그만 받기» 가 전부 이 표를 본다(businesses 에 칸 추가 안 함).
- **술어 한 곳 `access_scope.js`**: `PLATFORM_CHANNEL='platform'` · `isPlatformConversation(conv)` · SQL 조각 `notPlatformConversation = { channel_type: {[Op.ne]:'platform'} }`. **`PRIVATE_CHANNELS` 에 'platform' 추가** → 목록·참여자만·`convBroadcast.emitConvWide`·`exportSerializers.notPrivateConversation` 이 코드 변경 없이 따라온다.
- 멤버 발견: `GET /api/support-room?business_id` → `{conversation_id, joined, unread}`, LeftPanel 맨 위 고정 칸. 멤버는 [들어가기] → `POST /api/support-room/join`(`convParticipants.joinParticipant(..,'member')`). owner/admin 은 방 생성 때 + 승격 때 자동 참여.
- 생성: `services/supportRoom.ensureRoom(businessId)` — 워크스페이스 생성(`routes/businesses.js:118`·`auth.js:423` 근처) + 첫 `GET /api/support-room` 때 lazy. 운영 일괄 쓰기 없음.
- 배제 적용(필수): `plan.js` 대화 수 · `onboarding.js` start_conversation · `adoptionStages.js` team_chat(`c.channel_type <> 'platform'`) · `searchScope.js` convWhere(참여자만 유지) · `agent/tools/sources.js` · `cue.js:275` 워크스페이스 Cue 문맥 · `conversations.js` DELETE·archive·participants(client 추가 거절·방 삭제 409 `platform_room`) · 프론트 9파일(ENUM 분기 전수).
- **조용한 누락을 소리나게**: 가드 `guard-invariants --category=platformroom` — `dev-backend/{routes,services}` 에서 `Conversation.(count|findAll|findOne|findAndCountAll)` 또는 `FROM conversations` 를 쓰는 파일은 `notPlatformConversation`/`isPlatformConversation`/`PRIVATE_CHANNELS` 참조 또는 `// platformroom-exempt: 이유` 가 있어야 통과(HARD). 양성 대조군 필수. 동적 검사 `e2e --suite platformroom`.

## 2. 플랫폼 관리자 출입
- 전역 통과는 그대로 두되(별도 결정 사안), 관리자 화면은 **`/api/admin/support/*` 만**: `requireRole('platform_admin')` + `assertPlatformRoom(conv)`(아니면 404). 프론트 Admin 폴더에서 `/api/projects/conversations` 호출 0 — 가드 grep.
- 메시지 저장은 공용 `services/chatPost.postMessage` 경로 — 두 라우트와 관리자 라우트가 같은 함수, 안내방 후처리는 그 안의 `supportRoom.afterMessage(conv,msg,actor)` 한 훅.
- 귀속: sender_id=관리자, 서버가 `meta.platform_staff=true`(요청 본문 무시). 화면 «PlanQ 팀 · 이름». 관리자는 participant 행을 만들지 않는다(읽음 분모 밖 · «PlanQ 팀» 가상 참여자 표시 · 타이핑 표시 없음).
- 감사: `support.admin_read`(방 열 때 1회/세션) · `support.admin_send` · `support.nudge_send`.
- 관리자 발언 뒤 `cue_muted_until = now+4h`.

## 3. 발자국
- `usage_footprints(user_id, business_id, menu_key VARCHAR(40), first_at, last_at, visits INT, PK(user_id,business_id,menu_key))`. `usage_daily(business_id, date, menu_key, users, visits)` 는 밤 크론(`workspaceAlive`) — 2단계 후반.
- menu_key 정본 = `middleware/menu_permission.js:36` 메뉴 목록 + `settings.<하위>` 상수 `FOOTPRINT_KEYS`(서버 한 파일, 프론트는 라우트→키 매핑 1곳). 목록 밖 키는 버리고 카운터만(400 아님).
- `POST /api/usage/footprint {business_id, keys[]}` — `attachWorkspaceScope({memberOnly:true})` · `perUserLimiter` 분 4회 · keys ≤20 · 화면 30초 배치.
- 보존: 멤버 해제·워크스페이스 purge 때 삭제, daily 400일. 처리방침 ko/en «접속 기록» → «접속 기록·서비스 이용 기록(열어 본 메뉴)» — 운영 반영 전 필수.

## 4. 막힘 신호·제안 메시지
- `support_nudges(id, business_id, rule_key, cycle INT default 0, state ENUM('draft','sent','skipped','expired'), due_at, sent_at, sent_by NULL=auto, message_id, acted_at, acted_within_h, UNIQUE(business_id,rule_key,cycle))`.
- 규칙 = `services/supportNudgeRules.js` 한 벌: `{key, condition(ctx), acted(ctx), template_key, cta, mode:'review'|'auto', repeat_days}`. ctx 는 onboarding/adoptionStages/footprints/RefreshToken 에서만.
- 크론 매시: `aliveBusinessWhere` → `nudges_off_at IS NULL` → condition → draft. 보내기 직전 다시 condition·하루 1건(현지 자정 기준)·조용시간(현지 09–18 월–금, 아니면 연기)·방 존재 → 실패면 expired/연기. Cue 발신 `meta.nudge_id`, 알림은 배지만(소켓 `message:new` 만).
- «행동함» = `acted(ctx)` 가 sent 후 72시간 안에 처음 참이 된 시각(+24/+72h 재평가). 효과 = 규칙별 sent 중 acted_within_h≤72 비율.
- review→auto 전환은 규칙 상수 `mode` 변경(코드). 관리자 화면 토글은 켬/끔만.

## 5. 요청/질문 가르기
- qhelper 답변 호출의 구조 출력 `intent ∈ {question, request, other}` + `confidence`. 카드: `request` ∧ conf≥0.7 → «요청으로 남길까요?» · `question` ∧ (answered=false ∨ «도움 안 됐어요») → «문의로 남길까요?». 그 외 없음.
- 사용자가 눌러야 저장, 카드에 [요청으로]·[문의로] 둘 다(제안 쪽 강조). 저장 = 기존 `POST /api/feedback`(kind, title=Cue 60자 요약, body=원문, `source='support_room'`, `source_message_id`). `source_message_id UNIQUE`. 분류 실패여도 메시지 메뉴 «피드백/문의로 남기기» 수동 경로 항상.

## 6. 피드백 다리
- `feedback_items`: `source ENUM('widget','support_room') NOT NULL DEFAULT 'widget'`, `source_message_id BIGINT NULL UNIQUE`. `help_question_logs.mode` 에 `'support_room'`.
- `feedbackRespond.respondToFeedback` 끝에 `supportRoom.postFeedbackLine(item)` — source='support_room' 일 때만 `kind:'system'` 메시지(`meta.{feedback_id,status}`, 제목·번호만). notify 안 부름 — 푸시는 기존 하나.
- **FIX**: «기존 피드백 창에서 쓴 것도 안내방에 줄 남김» 은 뺀다 — 멤버 개인 피드백 제목이 대표·다른 참여자에게 공개된다.

## 7. 1단계 «여정» 탭 — 새 표 0
`GET /api/admin/businesses/:id/journey` (새 파일 `routes/admin_journey.js`):
- 멤버별 단계: `adoptionStages.getAdoptionStages({businessId,userId,role})`(사람 멤버 최대 50) · 개인 설정 4종: onboarding me 묶음 계산을 `personalSetup(userId,bizId)` 로 내보내 재사용 · 마지막 접속: `users.last_login_at` 과 `MAX(refresh_tokens.last_used_at)` 큰 값.
- 워크스페이스: `EmailAccount(is_active)` 수 + `last_sync_error` 유무 · `trial_ends_at` · `created_at` · 플랜.
- 시간줄(시각만): `MIN(created_at)` of tasks · messages(platform 제외) · business_members.joined_at(owner 제외) · clients(`billableClientWhere`) · invoices · calendar_events · files · posts · email_accounts.
- 막힘 신호: 무접속 ≥5일 · 체험 D≤3 · 사람 멤버 0 · 메일 `last_sync_error` · 단계 정체.
- 누수 금지: 제목·본문·파일명·대화명 0. 이름은 `applyMemberDisplayName`. health-check secrets 에 음성 대조군 1건.

## 8. 마이그레이션·검증
- ENUM 추가 2건은 `migrate-feedback-kind.js` 패턴(멱등·exit 1). 새 표 4개·`feedback_items` 칸 2개는 같은 스크립트 — `scripts/deploy-planq.sh` 마이그 슬롯, 코드 배포 전. 롤백은 코드만.
- 증명할 것(`e2e --suite platformroom` + health-check):
  ① owner 안내방 질문 → Cue 답 · `cue_usage` 워크스페이스 행 불변 · help 로그 mode=support_room 1건
  ② admin 답 → owner 소켓 1초 · `meta.platform_staff=true` · 감사 2행 · admin 이 다른 방 id 를 `/api/admin/support/*` 로 열면 404
  ③ member1 목록에 없음 → join → 보임 · client 403 · client 참여자 추가 409 · owner DELETE 409
  ④ 양성/음성 쌍: 같은 문구를 안내방·일반 내부 방에 — 검색·내보내기·`plan.getUsage.conversations`·onboarding·adoption·AI 앱 `search_all`·고객 홈 — 일반은 잡히고 안내방은 0
  ⑤ 가드 양성 대조군 · 프론트 'platform' 분기 전수
  ⑥ 제안: draft 1 → 보내기 → 재발송 0 · 둘째 규칙 당일 차단 · 조용시간 연기 · nudges_off 뒤 draft 0
  ⑦ 다리: [남기기] → 행 1 · 재클릭 중복 0 · 관리자 답 → 방 system 줄 1 · PushLog 1

## 구현 단계별 완료 조건
1. 여정 탭: 새 표 0 · 응답에 제목류 0(음성 대조군) · owner 앱 세션·메일 연결 만들면 값 바뀜 · `/admin/businesses/6` 여정 [as=admin].
2. 발자국: Q task·Q mail 열면 행 2 · 미등록 키 무시 · 분 4회 초과 429 · tenant 스위트 · legal.json ko/en.
3. 안내방: ①②③④⑤ · 가드 `platformroom` HARD · qhelper 서비스 분리 후 `/api/cue/help` 회귀 동일.
4. 다리: ⑦ · `/mine` MINE_FIELDS 에 source 포함, source_message_id 미포함.
5. 제안: ⑥ · 규칙 8개 i18n 패리티 · cronalive 통과 · 효과 비율 1건 실측.
6. 보완 목록: `wikiQuestionCluster` 가 support_room 을 읽음 · 메뉴×위키 글 유무 1행 실측.

## 비차단 지적
- platform_admin 전역 대화 통과는 문장만 고치고 그대로 — 좁히려면 별도 결정, 복구·감사 영향 조사 먼저.
- Cue 발신자는 `business.cue_user_id` 재사용 + `ai_mode_used:'qhelper'`. `cue_paused` 는 안내방에 적용 안 함.
- 안내방 Cue 상한: 사용자 10/분 · 워크스페이스 150/일(그 방 is_ai 메시지 수).
- 관리자 표시명은 `users.name`(PlanQ 팀 — 표시명 규칙 예외, 주석 명시).
- «확인 필요»(`/admin/inbox`) 연결은 `notifyPlatformAdmins` 재사용.
- 기획 5절 `businesses.support_nudges_off_at` → `support_rooms.nudges_off_at`.

---

## 구현

### 1단계 — 관리자 «여정» (2026-10-30 · 방 d12c74b3 · [Opus] · Fable 미검증(자체 검증) — 읽기 전용 관리자 화면, 새 표·권한 변경 0)
- 서버 `routes/admin_journey.js` `GET /api/admin/businesses/:id/journey`(platform_admin 전용, server.js 에서 /api/admin 아래 마운트) ·
  `services/onboarding.personalSetup(userId, bizId)` 를 빼서 카드와 같이 씀(동작 불변).
- 응답: summary(대표 단계·마지막 접속·앱/알림/캘린더/AI 앱 «한 명이라도»·메일 계정/오류·체험 남은 날) · members(최대 50, 표시명) · timeline(시각만) · signals.
  대표 = `businesses.owner_id`. 첫 대화는 `channel_type <> 'platform'`(3단계 대비).
- 막힘 신호 기준(코드 상수): 무접속 ≥5일 · 체험 ≤3일 · 혼자 사용(가입 ≥3일) · 메일 동기화 오류 · 대표가 1단계인 채 가입 ≥7일.
- 화면 `pages/Admin/AdminBusinessJourney.tsx` — 워크스페이스 상세 드로어 맨 위 «여정» 칸. 집계라 소켓 대신 화면 복귀 때 다시 읽음.
- 검증: 실HTTP — admin 200 · owner 403 · 없는 id 404 · 잘못된 id 400 · 업무·대화방·문서·파일 이름 403개 중 응답 원문에 0(양성 대조 1) ·
  member2 iOS 앱 세션 만들면 install_app false→true·마지막 접속 갱신 → 지우면 false · 화면 3폭 18/18(보임·실데이터·막힘 신호·가로 넘침 0·키 노출 0) ·
  build EXIT 0·error TS 0 · guard 82/83(문서 신선도 기존) · health-check 실패 1(clientlink #503 — 다른 방 시험 데이터, 이번 것 아님).
- 남은 단계: 2 발자국 → 3 안내방 → 4 피드백 다리 → 5 제안 메시지 → 6 보완 목록(위 «구현 단계별 완료 조건»).
