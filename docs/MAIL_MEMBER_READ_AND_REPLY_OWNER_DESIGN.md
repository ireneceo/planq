# 공용 메일 — 멤버별 읽음 · 답변 담당 → 업무 자동 연결 (설계 초안, 2026-10-22)

> Irene: *"공용메일을 읽었는지 안읽었는지를 멤버별로 알아야 하는데 내가 읽은 건지 누가 읽었는지 알게 할 수 없어?
> 그냥 읽음 표시는 누구 기준이야? … 내가 읽은 건지 아닌지 기준이고 읽은 거랑 답변한거 멤버별로 권한자 이름으로 보내자.
> 그리고 메일별 답변 담당자 지정이 되어서 내가 답변 할 예정인지 다른 사람에게 답변요청할건지 넣고 이걸 업무로 연결해서
> 자동등록되게 … 복잡하게 하지말고 탁월하게 문제해결과 편의성 확인해서 fable이 검증해"*

작성 [Opus]. 판정 받을 것은 6절.

## 1. 지금 사실 (코드·dev 실측)

| 항목 | 지금 |
|---|---|
| 읽음 기준 | **워크스페이스 하나** — `email_threads.unread_count` + `email_messages.is_read`. 누가 열든(`POST …/mark-read`, 상세 열면 자동) 0 으로 → 모든 멤버에게 읽음. 「모두 읽음」·「확인 완료」도 같은 칸을 0 으로 |
| 업체 쪽 읽음 | 안 건드린다(IMAP EXAMINE·markSeen:false). PlanQ 안의 읽음은 PlanQ 만의 것 |
| 멤버별 칸 | `email_thread_participants.last_read_message_id · last_read_at` **칸은 있는데 쓰는 곳 0** (dev 행 7개, 읽음값 0) |
| 담당 | 이미 있다 — `participants.is_assigned`(1명) · `POST …/assign` · 상세 밴드2 «담당» 칩 · «담당» 폴더 · 지정 알림 `mail_assigned`(10-08). **업무와 연결은 없다** |
| 메일 ↔ 업무 | 이미 있다 — `tasks.email_thread_id`, 메일 우측 패널 «관련 업무»(ContextTaskList), 업무 상세에 원본 메일 링크(routes/tasks.js:1981). 메일 담당과는 안 엮였다 |
| 답장한 사람 | 보낸 메일마다 `sent_by_user_id`(PlanQ 발송) · `services/mailSender.resolveOutboundSenders`(IMAP 보낸편지함분 주소로) — 10-21 |
| 받은 메일 쓰는 문 | `services/emailImapCron.js:924` 하나 |
| 규모(dev) | 스레드 7,129 · 공용 계정 4,515 / 개인 2,614 · unread>0 6,750 |

**문제**: 공용 메일함에서 A 가 열면 B 의 «안 읽음» 도 사라진다. 그래서 B 는 그 메일을 못 보고 지나간다. 누가 봤는지·누가 답했는지도 화면에 없다.

## 2. 설계 — 읽음

**읽음은 «사람 × 스레드»** 다. 개인 메일함도 같은 규칙(주인 한 명이라 결과는 지금과 같다).

- 정본: `email_thread_participants.last_read_message_id`(이미 있는 칸). 스레드를 열면 **나의** 행만 `= 그 스레드 마지막 받은 메일 id`, `last_read_at = now`.
- 스레드에 새 칸 2개:
  - `last_inbound_message_id` — 마지막 받은 메일 id. 쓰는 문은 받은 메일 쓰는 곳 하나(imapCron) + 백필.
  - `read_floor_message_id` — 옛 공용 읽음의 바닥. **배포 때 한 번** `unread_count = 0` 인 스레드에 `= last_inbound_message_id` 로 채운다. 그 뒤로 쓰지 않는다(옛 «누군가 읽음» 을 모두의 읽음으로 이어받아, 배포 날 수천 건이 갑자기 안 읽음으로 뜨지 않게).
- **나에게 안 읽음** = `last_inbound_message_id > GREATEST(COALESCE(내 last_read_message_id,0), COALESCE(read_floor_message_id,0))`.
  판정은 `services/mailRead.js` **한 곳**(SQL 조각 `unreadForWhere(userId)` · `markReadFor(userId, threadIds)` · `readersOf(threadId)`). 목록 `unread=true` · 굵은 줄/점 · 「전체」 배지 · 계정별 미읽음 · AI 앱 `unread_only` 가 같은 함수.
- 쓰는 문: 상세 열기(자동) · `mark-read` · `bulk-read`(「모두 읽음」 = **나만**) · `mark-handled`/`bulk-handled`(확인 완료 = 상태는 팀 것, 읽음은 누른 사람만).
- `unread_count`·`is_read` 칸은 남기되 **읽지 않는다**(옛 번들·되돌리기용). 새 코드가 읽으면 가드 `--category=mailread` 래칫.
- 새 멤버: 바닥 이후 받은 메일 중 자기가 안 연 것은 안 읽음 — 일반 메일 앱과 같다. 「모두 읽음」 이 한 번에 치운다.

## 3. 설계 — «누가 읽고 누가 답했나» 보이기

상세 밴드2(메타 줄)에 칩 하나 — **«읽음 2/4»**(이 스레드를 볼 수 있는 멤버 중 마지막 받은 메일까지 읽은 사람 수). 누르면 팝오버:

```
읽음 (2)       김오너 · 10/22 09:14
               이디자 · 10/22 10:02
안 읽음 (2)    박개발 · 최팀장
답장 (1)       이디자 · 10/22 10:30
```

- 명단 = **이 메일 계정을 지금 볼 수 있는 멤버**(공용 = qmail 읽기 권한 멤버 · 개인 = 주인만 → 칩 숨김). 판정은 기존 `accessibleAccountIds` 를 사람마다 거꾸로 — `mailRead.audienceOf(accountId)` 한 곳.
- 답장 = 그 스레드 보낸 메일의 보낸 멤버(`resolveOutboundSenders` 결과, 확인된 것만). 마지막 받은 메일 **뒤** 답장이 있으면 칩 옆에 «답장함: 이디자».
- 이름은 워크스페이스 표시명(BusinessMember.name → User.name). 고객·게스트에겐 메일 화면 자체가 없다.
- 목록 행에는 새 표시를 넣지 않는다(굵기·점은 «나에게» 기준으로 바뀔 뿐). 목록이 무거워지지 않게.

## 4. 설계 — 답변 담당 → 업무 자동 연결

이미 있는 «담당» 칩을 **«답변 담당»** 으로 바꾸고, 지정 = 업무 한 건.

- 팝오버 맨 위 두 줄: **[내가 답변할게요]** · 아래 멤버 목록(= 그 사람에게 답변 요청). «담당 없음» 은 해제.
- 지정하면 `task_actions.createTask` (화면 업무 추가와 같은 문):
  - 제목 `메일 답변: {제목 60자}` (i18n 꼬리표) · `emailThreadId` · `sourceEmailMessageId` = 마지막 받은 메일 · 담당 = 고른 사람 · 만든 사람 = 나(남이면 곧 «요청», 기존 요청 알림이 간다)
  - 마감 = 오늘(워크스페이스 시간대) — 답장할 일은 미루지 않는 것이 기본. 업무에서 바꿀 수 있다.
  - 프로젝트·고객 = 스레드에 붙은 것(있으면). 공개 범위 = 기본(L3) — 단 **개인 메일 계정**이면 업무를 «나만 보기»(L1) 로(개인 메일 제목이 팀 업무 목록에 나가지 않게).
  - 기존 `mail_assigned` 알림은 업무 요청 알림과 겹치므로 **보내지 않는다**(알림 한 통).
- 한 스레드 = 열린 답변 업무 **하나**. 표식 후보: (a) `email_thread_participants.reply_task_id` 칸(담당 행에 업무 id) — 제안 · (b) `tasks.created_via = 'mail_reply'`(STRING, 표시 전용이라 «권한·전이에 물리지 않는다» 계약과 부딪힘). `tasks.source` 는 담당자 배정이 덮어쓰는 워크플로 칸이라 못 쓴다 — **6절 판정 2**.
- 담당 바꿈 → 그 업무를 `task_actions.reassign`(같은 문). 해제 → 그 업무 **취소**(canceled, 이력에 «메일 담당 해제»).
- **답장하면 업무 완료** — 그 스레드에서 답장이 나가면(PlanQ 발송 3문 또는 IMAP 보낸편지함 사본, 보낸 멤버 확인된 것) 그리고 보낸 사람 = 업무 담당자면 `task_actions.complete(담당자)`. 컨펌자가 붙어 있으면 완료 대신 아무것도 안 함(기존 규칙). 담당자가 아닌 멤버가 답장했으면 업무에 시스템 댓글 «이디자 님이 답장했습니다» 만 남긴다(닫는 것은 담당자).
- «답변 불필요»(dismiss-reply)·«확인 완료»(mark-handled) → 열린 답변 업무 취소(이유 이력).
- 업무를 먼저 완료/취소해도 메일 담당은 그대로(담당 = 누구 일인가, 업무 상태 = 끝났나).
- 권한: 담당 지정은 지금처럼 qmail write. 받는 사람이 그 계정을 못 보면 400 `assignee_cannot_see_mail`(지금은 알림만 안 보냈다 — 업무가 생기면 제목이 나가므로 막는다).

## 5. 바뀌는 파일(예상)

서버: `services/mailRead.js`(새) · `services/mailReplyTask.js`(새 — 지정·바꿈·해제·답장 완료 한 곳) · `routes/email_threads.js`(목록 unread·상세 readers·mark-read·bulk-read·handled·assign·답장 3문 훅) · `services/emailImapCron.js`(last_inbound + 보낸편지함 사본 → 완료 훅) · `services/agent/tools/mail.js`(unread_only) · 모델 2 · `scripts/migrate-mail-member-read.js`(칸 2·백필, 멱등, 배포 슬롯).
화면: `MailPage.tsx`(칩 문구·[내가 답변할게요]·읽음 칩) · i18n ko/en qmail.
검증: 새 카나리 `--suite mailread`(A 열면 B 는 안 읽음 그대로 · 칩 숫자 · 담당 지정 → 업무 1건·요청 알림 1통 · 답장 → 완료 · 해제 → 취소 · 개인 메일 L1) + 3폭.

## 6. 판정 받을 것

1. 읽음 바닥(`read_floor_message_id`) 방식 — 배포 날 «옛 공용 읽음 = 모두 읽음» 으로 이어받는 것이 맞나, 아니면 배포 시점 이전은 전부 읽음으로 칠까.
2. 답변 업무 표식 — `tasks.source` 값 추가 vs `participants.reply_task_id` 칸. (단순·되돌리기 쉬운 쪽)
3. 답장 → 자동 완료 범위 — 담당자 본인 답장만 완료(제안) vs 누구든 답장하면 완료.
4. 해제·답변 불필요·확인 완료 → 업무 취소가 맞나(아니면 그대로 두기).
5. 남의 읽음 시각을 멤버끼리 보여도 되나(제안: 같은 메일함을 보는 팀원끼리 — 시각까지).
6. 개인 메일 계정 답변 업무 = L1 고정.
