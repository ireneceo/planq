# Q talk 대화방 알림 끄기 — 설계 (2026-11-13 · Fable 설계)

> Irene: 채팅·메일 공통 기능 빈칸 점검 뒤 «① 대화방 알림 끄기» 먼저 — *"20~30명 회사에서 가장 먼저 필요"*.
> 기준 커밋 `01e822a3`. 구현 방은 그 뒤 바뀐 것부터 확인한다(`git log 01e822a3..HEAD -- dev-backend/routes/notifications.js dev-backend/routes/conversations.js`).

## 1. 한 줄 정의
**내가** 고른 대화방의 **보통 메시지**가 나를 부르지 않게 한다(푸시·알림함·토스트·소리·메일 없음).
**나를 @부른 것과 담당 배정은 그대로 온다.** 다른 사람에게는 아무 영향이 없고, 내가 껐다는 것도 보이지 않는다.

## 2. 결정 요약
| 항목 | 결정 | 이유 |
|---|---|---|
| 저장 위치 | `conversation_participants.muted_at DATETIME NULL` (NULL = 켜짐) | 핀·읽음 커서와 같은 «내 상태» 행. 새 표 불필요 |
| 참여자가 아닌 사람(대표·관리자) | `touchOwnRow` 로 «보는 중»(is_viewer) 행에 담는다 — 핀과 같다. 껐다고 참여자가 되지 않는다 | 이들도 워크스페이스 방송으로 토스트·소리를 받는다 |
| 선택지 | **켜기/끄기만.** 1시간·8시간 같은 기간 없음 | 요청은 «시끄러운 방 끄기». 기간은 요청이 오면 `muted_until` 을 더한다(지금 만들지 않음) |
| 통과하는 것 | `eventKind:'mention'`(@멘션 · 응대 담당 배정) · 게스트의 계정 요청 | 나를 직접 부른 것·해야 할 일은 놓치면 안 된다 |
| 막히는 것 | `eventKind:'message'` + 대화방 소속 — 사람 메시지·카드·게스트 메시지·문의 답변·청구서 카드 | 전부 «방에 글이 올라왔다» 이다 |
| 사이드바·앱 아이콘 숫자 | **끈 방은 합계에서 뺀다** | 숫자가 계속 오르면 끈 의미가 없다 |
| 방별 안읽음 숫자 | 목록에 **그대로 보인다**(회색) + 방 이름 옆 종 끄기 아이콘 | 들어가 보면 몇 개 쌓였는지는 알아야 한다 |
| 집행 지점 | 서버 `notify()` 한 곳 + 화면 토스트 한 곳(끈 방 id 묶음) | 호출부 8곳에 흩지 않는다 |
| 고객(Client) | 쓸 수 있다(같은 API). 링크 게스트는 대상 아님(계정 알림이 원래 없다) | |
| 감사 로그 | 남기지 않는다 — 핀·읽음과 같은 개인 표시 상태 | |

배지 계약(`.claude/rules/badges.md`)과의 관계: Q talk 안읽음은 원래 «확인 필요 합» 의 **예외**라 합 계약은 안 깨진다.
회색 숫자는 «끈 방» 이라는 **새 상태의 표시**다 — 기존 배지의 색·모양은 건드리지 않는다.
끈 방에서 멘션되면 사이드바 Q talk 숫자는 안 오르지만 알림함·푸시·토스트로 온다(의도된 동작).

## 3. 서버

### 3-1. DB
- 모델 `models/ConversationParticipant.js` 에 `muted_at`(DATE, allowNull) 추가. `.claude/rules/db-schema.md` 한 줄.
- 운영 이관 `dev-backend/scripts/migrate-conv-mute.js` — INFORMATION_SCHEMA 로 칸이 없을 때만 `ADD COLUMN`(두 번 돌려도 같은 결과),
  `scripts/deploy-planq.sh` 이관 자리에 등록. 채워 넣을 값 없음(전부 NULL = 켜짐). 되돌리기 = 칸 삭제.

### 3-2. API (routes/conversations.js — 핀 바로 아래)
- `PUT /api/conversations/:businessId/:id/mute` 본문 `{ muted: true|false }` → `{ success, data: { muted_at } }`
  - 미들웨어 `authenticateToken, attachWorkspaceScope()` — `/read` 와 같다(`checkBusinessAccess` 를 쓰면 고객이 못 쓴다).
  - 순서: ① 방이 그 워크스페이스 것인지 ② `canAccessConversation(req.user.id, conv, req.scope)` ③ 그 뒤에만 행을 건드린다.
    ①② 실패는 둘 다 **404 `conversation_not_found`**(핀과 같다 — 방이 있는지조차 알려 주지 않는다). `muted` 가 boolean 아니면 400.
  - `muted:true` → `touchOwnRow(convId, uid, { muted_at: new Date() })` (이미 꺼져 있으면 시각 유지).
    그리고 그 방의 내 안읽음 `message` 알림 행에 `email_escalated_at = NOW()` — 끄기 직전에 생긴 행이 5분 뒤 메일로 나가지 않게.
  - `muted:false` → `ownRows` 로 찾아 `muted_at:null`. **행을 만들지 않는다.**
  - 끝에 `io.to('user:<id>').emit('conversation:mute', { conversation_id, business_id, muted_at })` — 내 다른 기기 동기화.
- `GET /api/conversations/me/muted` → `{ ids: [대화방 id…] }` — 내 행 중 `muted_at IS NOT NULL` 전부(워크스페이스 구분 없음, 토스트용).
  `/:businessId` 보다 **먼저** 선언한다(라우트 순서). 내 행만 읽으므로 접근 판정 불필요.
- 목록 `GET /:businessId` 응답에 `my_muted_at` 추가(`ownRows` 속성에 `muted_at` 만 더한다).
- «보는 중» 행이 참여자로 올라가도(`joinParticipant`) `muted_at` 은 그대로 둔다(핀·읽음과 같다). 참여자에서 빠지면 행과 함께 사라진다.

### 3-3. 알림 집행 — `routes/notifications.js` `notify()` 한 곳
게스트 계정 검사 바로 뒤, 알림 행을 만들기 전에:
```
eventKind === 'message' && String(entityType).toLowerCase() === 'conversation' && entityId && !ignoreMute
  → ownRows(userId, [entityId], ['muted_at']) 의 muted_at 이 있으면
    return { inbox:false, email:false, push:false, skipped:'conv_muted' }
```
- 여기서 돌아가면 알림 행이 없으므로 5분 뒤 메일(`unreadEscalationCron`)도 저절로 없다. 소켓 `notification:new` 도 안 나간다.
- 조회가 실패하면 **보낸다**(끄기는 편의 기능이다 — 실패했다고 알림을 삼키면 더 나쁘다). `console.warn` 한 줄.
- 반드시 `services/convParticipants.ownRows` 로 읽는다(«보는 중» 행 포함 · 가드 `convparticipants` — 밖에서 `unscoped()` 금지).
- 새 인자 `ignoreMute` 를 `notify`·`notifyMany` 에 더한다. 쓰는 곳은 하나: `routes/guest.js` 계정 요청(`chat_account_request`).
- 호출부 정리(같이 고친다):
  - `services/invoiceDelivery.js` L121 — `entityType`·`entityId` 가 **없다**. `entityType:'conversation', entityId: conv.id` 를 넣는다
    (안 넣으면 끈 방에도 청구서 카드 알림이 온다. 넣으면 방을 열 때 읽음 처리도 같이 된다).
  - `routes/guest.js`·`services/guestMessage.js` 는 `'Conversation'`(대문자) — 위 비교가 소문자로 맞추므로 그대로 둬도 된다.
  - `services/convCare.js`(담당 배정)·멘션 두 곳은 `eventKind:'mention'` 이라 손대지 않는다.

### 3-4. 숫자 — «합계» 세 곳에 같은 조건 `AND cp.muted_at IS NULL`
| 곳 | 바꿈 |
|---|---|
| `GET /me/unread-total-all` (사이드바·워크스페이스 선택기) | 추가 |
| `GET /:businessId/unread-total` | `total` 에서만 뺀다. `by_conversation` 은 그대로 |
| `services/chatBadge.chatUnreadForBadge` (푸시에 실리는 앱 아이콘 숫자) | 추가 |
| `routes/dashboard.js collectChats` («확인 필요» 채팅 항목 = 사이드바 Q talk 숫자) | 추가 — 구현 때 찾은 넷째 곳(2026-11-13). 내가 담당인 «응대 중» 문의 항목은 그대로 |
| 목록 `GET /:businessId` 의 방별 `unread_count` | **안 바꾼다** |
LEFT JOIN 인 두 곳은 내 행이 없으면 `cp.muted_at` 이 NULL 이라 지금처럼 센다. 끄기/켜기 직후 서버가 내게 `inbox:refresh` 도 쏜다(합계 다시 받기).

## 4. 화면
- **끈 방 묶음** `hooks/useMutedConversations.ts` — `useUnreadTotal` 과 같은 모듈 캐시. 로그인 뒤 `/me/muted` 1회 + 소켓 `conversation:mute` 로 넣고 뺀다
  + 창이 다시 보일 때 다시 받는다. `isMuted(convId)` 를 내보낸다.
- **토스트·소리** `components/Common/NotificationToaster.tsx` `message:new` 처리 맨 앞: `isMuted(msg.conversation_id)` 면 return.
  멘션은 `notification:new`(kind mention)로 따로 오므로 끈 방에서도 토스트·소리가 난다. 데스크탑 앱 알림도 이 토스트를 따라간다.
- **사이드바 숫자** `hooks/useUnreadTotal.ts` — `message:new` 의 «미리 +1» 을 끈 방이면 건너뛴다(뒤따르는 다시 받기는 그대로).
  `conversation:mute` 를 받으면 다시 받는다.
- **목록 행** `pages/QTalk/LeftPanel.tsx` — 방 이름 옆 종 끄기 아이콘(작게, 회색, `aria-label`), 안읽음 숫자는 끈 방이면 회색 바탕.
  «안읽음만» 걸러 보기와 그 개수는 끈 방도 포함한다(안 읽은 것은 맞다).
- **켜고 끄는 곳** — 대화방 머리의 ⋮ 메뉴에 «알림 끄기 / 알림 켜기» 한 줄(기존 메뉴 컴포넌트를 쓴다, 새로 만들지 않는다).
  목록 행에 이미 행 메뉴가 있으면 같은 항목을 거기에도. 확인 창 없이 바로 바뀌고, 실패하면 되돌리고 오류 문구를 보인다.
  `QTalkPage` 는 `conversation:mute` 를 `conversation:pin` 옆에서 받아 `my_muted_at` 을 고친다.
- **문구(ko / en)** — 네임스페이스 `qtalk`
  | 키 | ko | en |
  |---|---|---|
  | `mute.on` | 알림 끄기 | Mute notifications |
  | `mute.off` | 알림 켜기 | Unmute notifications |
  | `mute.badge` | 알림 꺼짐 | Muted |
  | `mute.hint` | 나를 @부른 메시지는 계속 알려 드려요 | You'll still be notified when someone @mentions you |
  | `mute.failed` | 알림 설정을 바꾸지 못했어요. 다시 시도해 주세요 | Couldn't change notification settings. Try again |
  `mute.hint` 는 메뉴 항목 아래 작은 글씨 또는 끄기 직후 한 번 보이는 안내(기존 안내 방식 재사용, `toast.success` 금지).

## 5. 하지 않는 것
기간 선택 · 워크스페이스 전체 끄기(이미 알림 설정 표가 있다) · 방 관리자가 남의 알림을 끄기 · 끈 방을 목록 아래로 내리기 · 메일(Q mail) 쪽 끄기.

## 6. 검증 목록 (실제 호출 · 포트 3003 · ws 6 시험 계정)
준비: owner 가 만든 방에 member1·member2 참여. member1 만 끈다. member2 는 대조군. 시험 데이터 이름은 `[확인용]`.

**API**
1. member1 `PUT …/mute {muted:true}` → 200, `muted_at` 값 있음. 다시 부르면 200·같은 시각. 목록 `my_muted_at` 일치, `/me/muted` 에 id 있음.
2. `{muted:false}` → 200·null, `/me/muted` 에서 빠짐. 행이 없는 사람이 `false` 를 불러도 **행이 안 생긴다**(행 수 전후 같음).
3. 접근 불가: member1 이 자기가 없는 사적 방을 끄기 → **404, 참여자 표 행 수 변화 0**. 다른 워크스페이스 id 로 → 404. `muted:"yes"` → 400.
4. 참여자 아닌 owner 가 끄기 → 200, 생긴 행은 `is_viewer=1`(참여자 목록·@ 후보에 안 나옴).
5. client 계정이 자기 방 끄기 → 200.

**알림(양성·음성 대조)** — owner 가 보통 메시지 1건
6. member1(끔): `notifications` 새 행 0 · `push_logs` 새 행 0 · 6분 뒤 메일 발송 기록 0.
7. member2(켬): 알림 행 1 · 푸시 기록 1 (대조군 — 이것이 0 이면 시험 자체가 틀린 것).
8. owner 가 `@member1` 멘션 → member1 에게 `mention` 알림 행 1 · 푸시 1 (끈 방인데도 온다).
9. 카드 메시지(`chatPost`)·청구서 카드(`invoiceDelivery`)·게스트 링크 메시지 → member1 0, member2 1. 게스트 계정 요청 → member1 도 1.
10. 응대 담당을 member1 로 배정 → 알림 1.
11. 끄기 직전에 생긴 안읽음 `message` 행: 끈 뒤 `email_escalated_at` 이 채워져 메일이 안 나간다.
12. member1 이 다시 켠 뒤 보통 메시지 → 알림 행 1(되돌아옴).

**숫자**
13. 끈 방에 메시지 3건: member1 `unread-total-all`·`/:biz/unread-total` 의 `total` 변화 0, 목록 그 방 `unread_count` = 3, `by_conversation` = 3.
    `chatUnreadForBadge` 도 변화 0. member2 는 셋 다 +3.
14. 켜면 합계가 바로 +3(안 읽은 채라면). 

**화면(폰·태블릿·데스크탑 셋 다, 실브라우저)**
15. 끈 방 메시지: 토스트 0·소리 0·사이드바 숫자 그대로, 목록 행은 회색 숫자 + 종 끄기 아이콘이 **실제로 보인다**(크기만 재지 말고 `elementFromPoint`·스크린샷).
16. 켠 방 메시지: 토스트 1(대조군). 끈 방 멘션: 토스트 1.
17. 두 창(같은 계정): 한쪽에서 끄면 다른 쪽 아이콘·메뉴 문구가 새로고침 없이 바뀐다.
18. 가드: `npm run build` · `node scripts/guard-invariants.js`(i18n·parity·convparticipants) · `node scripts/e2e/run.js --suite tenant` · 이관 스크립트 두 번 실행해 같은 결과.

## 7. 완료 검증에서 Fable 이 볼 곳(되돌리기 어려운 부분)
`notify()` 의 새 분기(중앙 발송 지점) · 새 문 `PUT /mute` 의 «판정 먼저, 행은 나중» · 운영 이관. 화면·문구는 자체 검증.
