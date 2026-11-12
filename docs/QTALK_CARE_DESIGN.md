# Q talk «문의 응대 상태 · 담당자» (D) — Fable 설계 `DESIGN: READY` (2026-11-12 · HEAD c03946c7)

> Irene: *"채널톡 쓰는 고객사가 우리 거 같이 쓸건데 … 불편한 채팅영역 기능 없는지 체크해줘."* → D «권고대로 진행해 줘»
> (권고: 고객 문의가 여럿 쌓이면 «누가 맡았고 끝났는지» 가 필요 — 다만 «우리는 채팅툴이 아니다» 와 맞춰 업무와 이어지게).
> 점검 문서 `docs/QTALK_CHANNELTALK_CHECK_2026-11-12.md`. 아래는 Fable 설계 원문을 옮긴 것.

## 결정 요약
| 물음 | 결정 |
|---|---|
| 상태 | `open` 응대 중 / `hold` 보류 / `resolved` 해결. **보관(active/archived)과 다른 축** — 해결해도 목록에 남는다 |
| 저장 | 새 테이블 `conversation_care`(방당 0~1행). `conversations` 에 칸을 더하지 않는다 — 대화 객체를 `toJSON()` 통째로 내보내는 곳이 여럿이고 고객도 같은 문을 써서 칸을 더하면 고객 응답으로 샌다(fail-closed) |
| 행 없음 | «문의 없음» — 표시 없음. 고객 쪽 첫 글이 행을 만든다 |
| 고객이 다시 쓰면 | 해결·보류 → 자동 `open`(보관 방이면 기존 재활성과 같이). 직원 글·Cue·내부 메모는 상태를 안 바꾼다 |
| 담당자 | **한 명.** 기본값은 행이 처음 생길 때 한 번: `Client.assigned_member_id` 가 활성 멤버 ∧ 이미 그 방 참여자면 그 사람, 아니면 미배정. 기본값으로는 참여자를 늘리지 않는다 |
| 담당 = 참여자 | 사람이 배정하면 `joinParticipant` 로 참여자가 된다(아니면 알림 못 받고 member 는 방을 못 본다) |
| 누가 바꾸나 | 그 방을 볼 수 있는 직원(`canAccessConversation` ∧ 고객 아님). 고객·게스트에게는 상태·담당이 **전혀 안 나간다** |
| 적용 범위 | `channel_type='customer'` 만(`client_id` 없는 고객 방이 dev 52개 중 19개). 내부·그룹·안내방 409 |
| 목록 | [전체 \| 안 읽음 N \| **답할 문의 N**] — 답할 문의 = `open ∧ (담당=나 ∨ 미배정)`. 행에 상태·담당 |
| 배지 | 사이드바 Q talk 배지 그대로. 확인 필요에 «내가 담당인 응대 중 문의(읽었어도)» 한 방 = 한 건 |
| 알림 | 남에게 배정할 때만 앱 안·푸시 1통(메일 없음). 고객에게 나가는 것 0 |
| 업무 연결 | 상태 팝오버에 «이 대화의 진행 중 업무 N건 · 해결해도 업무는 그대로». 자동 업무 생성은 2차 |
| AI 앱 | `services/agent/registry.js` 건드리지 않음 |

## DB
```sql
CREATE TABLE IF NOT EXISTS conversation_care (
  conversation_id   INT NOT NULL PRIMARY KEY,
  business_id       INT NOT NULL,
  state             ENUM('open','hold','resolved') NOT NULL DEFAULT 'open',
  state_changed_at  DATETIME NOT NULL,
  state_changed_by  INT NULL,        -- NULL = 자동(고객 글)
  assignee_user_id  INT NULL,
  assigned_at       DATETIME NULL,
  assigned_by       INT NULL,        -- NULL = 기본값
  created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
  KEY idx_care_biz_state_assignee (business_id, state, assignee_user_id),
  CONSTRAINT fk_care_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```
- 모델 `models/ConversationCare.js`. `models/index.js` 에 연관을 걸지 않는다 — 조회는 `services/convCare` 만.
- 영구 삭제 라우트가 딸린 행을 손으로 지우는지 확인, FK cascade 가 먹는지 dev 1건으로 잰다.
- 마이그레이션 `dev-backend/scripts/migrate-conversation-care.js`: 배포 슬롯 등록, 코드보다 먼저, 멱등(`CREATE TABLE IF NOT EXISTS` + `INSERT IGNORE`).
- 백필(한 번): 살아 있는 고객 방(`status='active' AND archived_at IS NULL`, 지운 워크스페이스 제외) 중 **고객에게 보이는 마지막 메시지**(`clientVisibleSql`, `MAX(id)`)를 고객 쪽(참여 role `client` 또는 `users.is_guest=1`)이 썼고 30일 이내인 방만 `open`. 담당은 기본값 규칙. 나머지 방은 행 없음. 출력 «만든 행 / 담당 채운 수 / 미배정 수». 롤백은 코드만.
- 문서: `.claude/rules/db-schema.md`, `docs/DATABASE_ERD.md` 한 줄.

## 서버 — `services/convCare.js` 단일 원천(이 파일 밖에서 ConversationCare 를 쓰지 않는다)
- `isCareRoom(conv)` — `channel_type === 'customer'`.
- `onCustomerMessage(conv, { io })` — 고객 쪽 글 저장 **뒤**, best-effort. 행 없음 → open + 기본 담당 / hold·resolved → open(by NULL) / open → 아무것도. 원자적 upsert, **바뀌었을 때만** 방송. 부르는 곳 3문: conversations.js 메시지 POST(`req.scope.isClient`), projects.js 메시지 POST(그 문의 isClient), `createGuestMessage`(항상) — 같은 헬퍼 한 줄.
- `setCare(conv, actor, { state?, assignee_user_id? })` — 검증 → 쓰기 → 감사 → 방송 → 알림. 배정 대상 = 그 워크스페이스 활성 사람 멤버(removed_at NULL, AI·고객·게스트 불가) 아니면 400 `invalid_assignee`. 비참여자면 `convParticipants.joinParticipant(conv.id, uid, 'member')` + `conversation:participants` 신호 + 감사(`via:'care_assign'`) — 참여자 추가 판정은 `POST …/participants` 와 같게. `null` = 해제. 상태·담당은 서로 안 건드림. 감사 `conversation.care_state` / `conversation.care_assign`.
- `careFor(convIds, businessId)` → Map(state, state_changed_at, assignee_user_id, assignee{id,name}) — 이름은 워크스페이스 표시명.
- `myOpenInquiryIds(convIds, userId, { includeUnassigned })`.
- `clearAssignee(businessId, userId, { to })`.
- 정리 훅: 멤버 제거(`routes/businesses.js:1346` 옆) NULL · 인수인계(`memberHandover` 195 옆) 인수자(+참여) · 참여자 내보내기(`DELETE …/participants/:userId`) 그 사람이 담당이면 NULL + 방송.

## API — 새 파일 `routes/conversation_care.js`(`/api/conversations` 에 마운트, guest_admin 옆)
- `PUT /api/conversations/:businessId/:id/care` — authenticateToken + attachWorkspaceScope(). body `{ state?, assignee_user_id? }`(하나 이상). 응답 `{ conversation_id, state, state_changed_at, assignee_user_id, assignee, open_task_count }`.
  판정 순서: 방 없음·business 다름 404 → 고객이거나 멤버 이상 아님 403 → canAccessConversation 실패 404 → `!isCareRoom` 409 `not_customer_room` → 보관 방 409 `conversation_archived` → 값 틀림 400.
- 읽기: `GET /api/conversations/:businessId`(목록)·`GET /:businessId/:id`(상세)에 **`!req.scope.isClient` 일 때만** `care`(목록은 careFor 일괄, 없으면 null). 상세에 `open_task_count`(tasks.conversation_id = id, 열린 업무 — 기존 술어 헬퍼). projects.js 대화 응답에는 안 붙인다 — 화면이 id 로 합친다.
- 실시간 `conversation:care` `{ conversation_id, care }` 를 **`emitConvWide` 로만**(`conv:`·`business:` 금지). 화면 QTalkPage 가 병합.
- 알림: 남에게 배정할 때만 `notifyMany` 1통 — `eventKind:'mention'`, `titleSpec:{ feature:'chat', action:'chat_assigned', subject:'<배정한 사람> · <방 이름>' }`, `skipChannels:['email']`, 본문 없음, link `/talk?conv=<id>`. 카탈로그 `chat_assigned` ko/en.
- 확인 필요(`routes/dashboard.js collectChats`, 단계 4): 같은 convIds 안에서 `open ∧ assignee=나 ∧ 안읽음 0` 을 같은 id `chat-<cid>` 로 더한다(한 방 = 한 건). `verb:'chat_open_inquiry'`, priority state_changed_at 24h↑ urgent / 3h↑ today / week. 미배정은 넣지 않음. COLLECT_LIMIT 은 합친 뒤 한 번.

## 화면 (직원만 — 고객·게스트 화면 변화 0)
- 새 파일 `pages/QTalk/CareChips.tsx`(칩 2개 + 팝오버) · `pages/QTalk/careList.ts`(`isMyOpenInquiry(conv, myId)`). ChatPanel 은 밴드2 삽입 몇 줄. LeftPanel 800줄 넘으면 세그먼트를 `LeftFilter.tsx` 로. 타입 `care?: { state: string; … } | null`(모르는 값은 글자 그대로 회색 칩).
- 밴드2(«고객» 칩 바로 뒤, 줄바꿈 금지): `[고객] [● 응대 중 ▾] [담당 이디자 ▾]  최고객 ›  소속: …`. 행 없음: `[응대 상태 정하기 ▾]` `[담당 없음 ▾]`.
- 상태 팝오버(ChipPopover, PlanQSelect 금지): 응대 중/보류/해결 + (open_task_count>0) «이 대화의 진행 중 업무 N건 · 해결해도 업무는 그대로 남아요» + «고객이 다시 글을 쓰면 «응대 중» 으로 돌아와요».
- 담당 팝오버: [내가 맡기] · 기존 «사람 고르기» 목록 재사용 · 담당 없음 · «담당자는 이 대화의 참여자가 돼요».
- 낙관 갱신 → 실패면 되돌리고 `!`. 성공 토스트 금지. testid `chat-care-state`, `chat-care-assignee`, `chat-care-state-opt-<값>`. 내부·안내방·고객 사용자에게는 렌더 안 함. 보관 방은 읽기 전용.
- 좌측: [전체 | 안 읽음 N | 답할 문의 N] — 라벨 숫자 = 걸렀을 때 행 수(같은 함수), 지금 연 방은 남김, 빈 상태 «답할 문의가 없어요». 행에 [보류]/[해결] 태그, open 은 담당 이름/«미배정». 폰에서 세그먼트 3칸 한 줄인지 잰다(넘치면 가로 흘림).

## i18n (qtalk, ko/en)
care.state.open 응대 중/Open · care.state.hold 보류/On hold · care.state.resolved 해결/Resolved · care.setState 응대 상태 정하기/Set status · care.assignee 담당 {{name}}/Owner: {{name}} · care.noAssignee 담당 없음/No owner · care.unassigned 미배정/Unassigned · care.takeIt 내가 맡기/Assign to me · care.joinHint 담당자는 이 대화의 참여자가 돼요/The owner is added to this conversation · care.reopenHint 고객이 다시 글을 쓰면 «응대 중» 으로 돌아와요/Reopens when the customer writes again · care.openTasks 이 대화의 진행 중 업무 {{count}}건 · 해결해도 업무는 그대로 남아요/{{count}} open task(s) from this conversation stay open · left.filterMine(N) 답할 문의 ({{count}})/To answer ({{count}}) · left.noMine 답할 문의가 없어요/Nothing to answer · 알림 chat_assigned «{{who}} 님이 대화 담당으로 지정했어요»/«{{who}} made you the owner of a conversation» · todo verb.chat_open_inquiry 응대 중인 문의/Open inquiry.

## 구현 순서(커밋 단위)
1. 테이블·모델·마이그레이션·convCare + 고객 글 3문 훅 + 정리 훅 3곳
2. PUT …/care + 목록·상세 care + 방송 + 배정 알림
3. 화면(칩·목록·세그먼트·i18n) → 빌드
4. 확인 필요 연결

## 검증 시나리오
- 권한·격리: owner 200·재조회 일치 · member1(참여) 200 / member2(비참여) 404 · client 403 · ws7 403/404 · 내부·안내·보관 409 · 잘못된 배정 대상 400.
- **누출(가장 중요)**: client 토큰 목록·상세·프로젝트 대화 응답에 `care`·`assignee` 0건(문자열 검색) · 게스트 링크 응답도 · 고객 소켓이 `conversation:care` 못 받음(직원 소켓 양성 대조군).
- 전이: 해결 → client 글 → open(by NULL), 직원 화면 1초 안 · 보류 → 게스트 글 → open · 직원 글·내부 메모·Cue → resolved 유지 · 보관+해결 방 고객 글 → 재활성 + open · 행 없는 방 첫 글 → 기본 담당 규칙 · open 방 고객 글 10연타 → 방송 0, 행 1.
- 담당: 비참여 member 배정 → 참여자 행·목록에 방·알림 1(메일 0) · 본인 배정 알림 0 · 참여자에서 내보내면 NULL · 멤버 제거 NULL · 인수인계 인수자.
- 실시간·다중 기기 · 기존 채팅 4시나리오 회귀 없음.
- 숫자: «답할 문의 N» = 행 수 · 확인 필요 total +1, 안읽음 생겨도 1건 · `--suite inboxcount`.
- 화면 3폭(390/820/1440): 밴드2 한 줄·본문 y 같음·칩·팝오버 보임(elementFromPoint)·폰 팝오버 화면 안 · 모르는 state 글자 그대로(응답 가로채 주입 대조군).
- 가드·빌드: build EXIT 0 · guard 전체 · health-check · `--suite tenant` · 새 카나리 `--suite talkcare`.
- 마이그레이션 두 번 → 두 번째 0행 · dev 백필 수 손 SQL 대조.
- 완료 시 `/fable-검증` 1회(누출·권한 숫자).

## 1차에서 하지 않는 것
보류 기한·SLA · 대화 안 시스템 줄 · 해결 시 Q sale 기록·업무 자동 생성 · 대표용 멤버별 필터·통계 · 고객 안내(외부 발송) · Cue 자동 해결 · AI 앱 표면 · 내부·그룹 방.
