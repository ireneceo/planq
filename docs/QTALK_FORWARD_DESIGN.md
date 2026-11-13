# Q talk — 메시지를 다른 대화방으로 전달 (설계)

> 2026-11-13 · [Fable 설계] · 빈틈 점검 ③ (Irene «권고대로») · 조사 시점 HEAD `b094fd99`
> 묶는 규칙: security-detail 참조 규칙 5 · 사적 대화 D3 · backend-routes 복사 계약 · realtime · ops-backend(notify) · 삭제 마스킹

## 0. 한 줄 정의
전달 = **내가 읽을 수 있는 일반 메시지의 «내용만» 내 이름으로 다른 방에 새로 쓰는 것.**
원본과의 연결(원래 방·원래 보낸 사람·답장·반응·고정·읽음·번역)은 **하나도 따라가지 않는다.**
그래서 받는 방 사람이 원본 방의 존재·이름·참여자를 알 길이 없다(샐 칸이 없다).

## 1. 누가 · 무엇을 · 어디로
| 항목 | 결정 | 이유 |
|---|---|---|
| 전달하는 사람 | 그 워크스페이스 **owner·admin·member 만**. 고객·게스트 403. 플랫폼 관리자 자격만으로는 안 됨 | 고객은 «만들지 못한다»(복사 계약). 남의 워크스페이스 방에 글을 쓰게 두지 않는다 |
| 원본 방 | `canAccessConversation(나, 원본)` — 읽기와 같은 술어 | 읽기 403 = 전달 403 |
| 대상 방 | 같은 워크스페이스 · `canAccessConversation(나, 대상)` · 원본과 다른 방 · 보관 방은 409(직원 쓰기 규칙 `decideArchivedWrite`) · PlanQ 안내방(`isPlatformConversation`)은 원본·대상 모두 제외 | 일반 메시지 쓰기와 같은 문턱 |
| 전달되는 메시지 | `kind='text'` · 지워지지 않음 · 내부 메모 아님 · 미승인 Cue 초안 아님 | 아래 |
| 개수 | 한 번에 **한 방의 메시지 1~20개 → 대상 방 1곳** | 여러 방 동시 발송은 넣지 않는다 |

**전달 못 하는 것 (서버가 400 `not_forwardable`, 화면은 처음부터 고르지 못하게)**
- **지운 메시지** — 원문은 DB 에 남아 있다. 전달로 꺼내면 마스킹이 뚫린다.
- **내부 메모(`is_internal`)** — 전부 막는다. 화면에 내부 메모 표시가 없어(ChatPanel 에 `is_internal` 분기 0곳) 물려줘도 사용자가 구별할 수 없다.
- **미승인 Cue 초안** (`is_ai ∧ ai_mode_used='draft' ∧ ¬ai_draft_approved`) — 아직 보낸 글이 아니다.
- **카드·시스템 메시지** — 카드 `meta` 는 살아 있는 열쇠(공유 토큰·서명 주소)다. 복사 계약상 열쇠는 안 따라간다.
- 승인된 Cue 답·남이 쓴 글은 된다 — 전달본은 **내 글**(`sender_id=나`, `is_ai=false`)이 된다.

## 2. 무엇이 복사되나
| 따라간다 | 따라가지 않는다 |
|---|---|
| 본문 글자 그대로 · 첨부 **연결**(같은 저장 파일을 가리키는 새 `message_attachments` 행) | 원래 보낸 사람·원래 방(이름·id) · 답장 대상 · 반응 · 고정 · 읽음 · 수정됨 표시 · 번역 캐시 · Cue 칸 |

- **표시**: 새 메시지 `meta = { forwarded: true }` 한 칸뿐. 화면은 말풍선 위에 «전달된 메시지» 한 줄.
  - 원래 보낸 사람 이름을 **넣지 않는다** — 다른 고객사 담당자 이름이 고객 방에 찍히면 고객 사이 누출이고, 이름을 복사해 두는 것 자체가 규칙 5 위반.
  - 원래 방 이름도 넣지 않는다(사적 방의 존재가 드러난다). **원본 id 는 감사 로그에만** 남긴다.
  - 새 컬럼·마이그레이션 없음(`meta` 는 이미 text 메시지에도 쓴다 — `meta.guest`).
- **멘션은 다시 울리지 않는다** — 전달 경로는 `resolveMentions` 를 **부르지 않는다**. 받는 사람 전원이 일반 `message` 알림 한 건.
- **첨부**
  - 물리 파일은 복사하지 않는다(`link-existing` 과 같은 방식). 채팅 첨부를 물리적으로 지우는 경로는 없다(조사: destroy/unlink 0건) → 원본을 지워도 전달본은 산다.
  - 직접 올린 첨부(`file_id` 없음): 원본 방을 읽을 수 있으면 전달 가능.
  - 워크스페이스 파일 연결 첨부(`file_id` 있음): ① `imageViewer.canUserSeeFile(나, 파일)` — 붙일 때 원본 읽기 권한(`link-existing` 과 같은 술어) ② **보안등급이 `general` 이 아니면 전달 불가**(400 `attachment_restricted`).
    - 왜 «고객 방일 때만» 이 아니라 전부인가: 채팅 첨부는 붙는 순간 그 방 전원에게 열린다(내려받기 판정 = 방 접근). «바깥 사람이 있는 방» 술어를 새로 만들면 그 술어가 틀리는 날이 곧 누출이다. v1 은 술어 없이 닫는다. 꼭 필요하면 파일 첨부로 직접 붙인다.
  - 하나라도 걸리면 **전체를 안 보낸다**(부분 전달 없음).
- 전달본은 보통 메시지다 — 내가 수정·삭제·답장·다시 전달할 수 있다(누구를 사칭하지 않으므로 수정 제한 불필요).

## 3. API
`POST /api/conversations/:businessId/:id/forward` (`:id` = 원본 방) · `authenticateToken` + `attachWorkspaceScope()` + `perUserLimiter('msg-forward', 분당 10)`
본문 `{ message_ids: number[1..20], target_conversation_id: number }` → `201 { success, data: { target_conversation_id, messages: [...] } }`

**검사 순서 — 다 읽고 다 통과한 뒤에만 쓴다** (본체는 `services/messageForward.js` 한 곳)
1. 멤버 이상인가(`scope.isOwner|isAdmin|isMember`) → 아니면 403
2. 모양: 정수·중복 제거·1~20개·대상 ≠ 원본 → 400
3. 원본 방: `business_id` 일치 + `canAccessConversation` → 아니면 **404**(있다는 것도 알리지 않는다)
4. 대상 방: `business_id` 일치 + `canAccessConversation` → 아니면 **404** · 안내방/`staffWriteBlocked` 403 · 보관 409
5. 메시지: `id IN (...) AND conversation_id = 원본` 으로 읽는다. 개수가 다르면 404 `message_not_found` · 1절 조건에 걸리면 400 `not_forwardable`
6. 첨부: 2절 ①② · 합계 30개 초과 400
7. **한 트랜잭션**으로 `Message` N개(원본 `created_at, id` 순서대로 차례로 만들어 순서 유지) + `MessageAttachment` 행
8. 커밋 뒤: `last_message_at` · `promoteSpeaker` · 방송 · 감사 · 알림 (실패해도 저장은 되돌리지 않음, 경고 로그)

**방송·알림 — 새 사본을 만들지 않는다.** `services/chatPost.js` 의 방송+알림 부분을 안쪽 함수로 빼서 카드와 전달이 같이 쓴다.
- 방송: 메시지마다 `message:new` → `isVisibleToClient` 로 `conv:<대상>` / `:staff` 선택 + `convBroadcast.emitConvWide`(사적 방은 참여자에게만). 페이로드는 일반 메시지와 같은 모양(표시명·첨부 직렬화·`other_count`/`read_by_count`).
- 알림: **묶음당 1건**(20개 전달 = 알림 1건). `notifyMany` `eventKind:'message'` · 보낸 사람 제외 참여자 · `previewPolicy:'excerpt'` · `skipChannels:['email']` · `entityType:'conversation'`, `entityId:대상` → ①의 방 알림 끄기가 `notifications.js` 에서 저절로 걸린다. 본문 = 첫 메시지 앞부분(첨부만이면 기존 첨부 문구).
- 감사: `logAudit` `message.forward` 1건 — `{ source_conversation_id, source_message_ids, new_message_ids, attachment_count }`, target = 대상 방.
- Cue 자동 응답·응대 상태(`convCare`)는 건드리지 않는다(보낸 사람이 직원).
- 저장 용량 집계가 `message_attachments.file_size` 합이면 전달로 두 번 세진다 — 구현 때 집계 쿼리를 확인하고, 그렇다면 `file_path` 기준 중복 제거.

## 4. 화면
- **들어가는 곳**: 메시지 더보기 메뉴 «전달»(1개) · 여러 개 선택 막대 «전달»(복사 옆). 전달 못 하는 메시지(1절)는 메뉴에 «전달» 이 없고, 여러 개 선택에 섞여 있으면 빼고 센다 — 창에 «{{n}}개 중 {{m}}개만 전달됩니다(카드·지운 메시지 제외)».
- **방 고르기**: `ShareReceivePage` 안의 대화방 고르기(검색 + 묶음 + 행)를 `components/Common/ConversationPicker.tsx` 로 **꺼내 둘이 같이 쓴다**(새로 만들지 않는다 · 기존 testid 유지). 보관 방·현재 방·안내방은 목록에서 뺀다.
- **보내기**: 방을 고르면 아래 버튼 «‘{{room}}’에 전달». 고객이 있는 방(`channel_type='customer'` 또는 고객 연결)이면 버튼 위에 «고객이 보는 방입니다» 한 줄. 누르는 즉시 보내지 않고 고르기 → 버튼 두 단계.
- **끝난 뒤**: 창 닫힘 · 선택 모드 해제 · 기존 «복사됨» 과 같은 방식의 알림 한 줄 + «방으로 이동»(`alert`·`toast.success` 금지). 실패는 창 안에 이유.
- **받는 쪽**: 말풍선 위 작은 회색 한 줄 «전달된 메시지»(`ReplyQuote` 위 줄과 같은 글자 크기). 폰·태블릿·데스크탑 같은 위치.

**i18n (`qtalk`)**
| 키 | ko | en |
|---|---|---|
| `chat.action.forward` | 전달 | Forward |
| `forward.title` | 어느 대화방으로 전달할까요? | Forward to which chat? |
| `forward.search` | 대화방·고객 이름으로 찾기 | Search chats or customers |
| `forward.send` | ‘{{room}}’에 전달 | Forward to “{{room}}” |
| `forward.count` | 메시지 {{n}}개 | {{n}} messages |
| `forward.partial` | {{n}}개 중 {{m}}개만 전달됩니다 (카드·지운 메시지 제외) | Only {{m}} of {{n}} will be forwarded (cards and deleted messages are skipped) |
| `forward.clientRoom` | 고객이 보는 방입니다 | Customers can see this chat |
| `forward.done` | 전달했어요 | Forwarded |
| `forward.goRoom` | 방으로 이동 | Open chat |
| `forward.label` | 전달된 메시지 | Forwarded message |
| `forward.err.notForwardable` | 전달할 수 없는 메시지가 섞여 있어요 | Some messages can’t be forwarded |
| `forward.err.attachment` | 보안등급이 걸린 첨부는 전달할 수 없어요. 파일 첨부로 직접 붙여 주세요 | Restricted attachments can’t be forwarded. Attach the file directly instead |
| `forward.err.archived` | 보관된 대화방에는 전달할 수 없어요 | You can’t forward to an archived chat |
| `forward.err.failed` | 전달하지 못했어요. 다시 시도해 주세요 | Couldn’t forward. Please try again |
| `forward.empty` | 전달할 수 있는 대화방이 없습니다 | No chats to forward to |

## 5. 검증 — 실제 HTTP(3003) + 소켓, 대조군 포함 (`scripts/e2e` `--suite forward`)
| # | 음성(막혀야) | 기대 |
|---|---|---|
| N1 | 고객 계정이 전달 호출 | 403 · 대상 방 메시지 수 변화 0 |
| N2 | 내가 참여자가 아닌 사적 방을 **원본**으로 | 404 |
| N3 | 내가 못 들어가는 방(member 가 비참여 프로젝트 방)을 **대상**으로 | 404 · 변화 0 |
| N4 | 다른 워크스페이스 방을 대상으로 / 다른 방의 메시지 id 를 끼워서 | 404 |
| N5 | 지운 메시지 | 400 · 원문이 대상 방 어디에도 없음(응답 원문 문자열 검색) |
| N6 | 내부 메모 → 고객 방 / 내부 방 둘 다 | 400 |
| N7 | 미승인 Cue 초안 · 카드 메시지 | 400 |
| N8 | 보안등급 confidential 파일 연결 첨부 → 고객 방 / 내부 방 | 400 |
| N9 | 내가 못 보는 파일(남의 L1)이 붙은 메시지 | 400 |
| N10 | 정상 1개 + 불가 1개 섞음 | 400 · **정상 것도 안 감**(변화 0) |
| N11 | 21개 · 대상 = 원본 · 보관 방 | 400 · 400 · 409 |
| N12 | 본문에 `@멤버` 가 든 메시지 전달 | 그 멤버에게 `mention` 알림 0건(일반 `message` 1건만) |
| N13 | 대상 방 알림을 끈 참여자 | 알림 0건 · 앱 숫자 불변 |
| N14 | **사적 원본 방 → 고객 방**: 대상 방 응답·소켓 페이로드 원문에서 원본 방 id·제목·원래 보낸 사람 id/이름 검색 | 0건 |
| N15 | 사적 대상 방으로 전달했을 때 비참여 멤버 소켓(`business:` 방) | `message:new` 0건 |

| # | 양성(돼야) | 기대 |
|---|---|---|
| P1 | 글 1개 전달 | 201 · 대상 방 재조회에 같은 본문 · `sender_id=나` · `meta.forwarded=true` · `reply_to`/`is_edited`/반응 비어 있음 |
| P2 | 3개(남의 글·승인된 Cue 답 포함) | 원본 순서대로 3개 · 전부 내 글 |
| P3 | 직접 올린 첨부 1개 포함 | 대상 방 참여자가 새 첨부 id 로 내려받기 200 · 대상 방 **비참여자**는 403 · 원본 지운 뒤에도 200 |
| P4 | general 파일 연결 첨부 | 전달됨(N8 의 대조군) |
| P5 | 대상 방 다른 참여자 | 소켓 `message:new` 수신 · `message` 알림 1건(3개 전달해도 1건) · 메일 즉시 발송 0 |
| P6 | 고객 방으로 전달 → 그 고객 계정 목록·게스트 링크 | 전달본 보임(N6 의 대조군) |
| P7 | 감사 로그 | `message.forward` 1건 · 원본 id 들이 여기에만 있음 |
| P8 | 화면(폰·태블릿·데스크탑) | 더보기 «전달» → 방 고르기 → 버튼 → «전달된 메시지» 줄이 실제로 보임(`elementFromPoint`) · `ShareReceive` 고르기 회귀 없음 |

가드: `guard-invariants`(duproute·broadcast·convparticipants·i18n·parity) · `health-check --category=secrets` · `npm run build`.
**완료 검증은 Fable 대상**(권한·가시성 표면) — 설계 1 + 검증 1.

## 6. 범위 밖 · 따로 본 것
- 여러 방 동시 전달 · 원래 보낸 사람 표시 · 내부 메모 전달 · 보안등급 파일의 «내부 방끼리» 전달 — 넣지 않는다(필요하면 따로 설계).
- **비차단 발견(기존 문)**: `message_attachments` `link-existing` 은 붙이는 사람의 읽기 권한만 보고 **보안등급을 안 본다** — 멤버가 confidential 파일을 고객 방에 첨부할 수 있다(규칙 4 «밖으로 나가는 모든 문»). 전달은 이 구멍을 넓히지 않게 더 좁게 닫았다. 그 문을 닫을 때 «바깥 사람이 있는 방» 술어를 `access_scope` 한 곳에 만들고, 그때 전달의 ②도 그 술어로 풀 수 있다.
