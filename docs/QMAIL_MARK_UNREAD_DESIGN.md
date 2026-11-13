# Q mail — «안 읽음으로 표시» (나만) 설계

> 2026-11-13 · Fable 설계 · 판정 **DESIGN-READY** · 빈칸 점검 ② (Irene «권고대로»)
> 바탕: `docs/MAIL_MEMBER_READ_AND_REPLY_OWNER_DESIGN.md` §7 · `services/mailRead.js` · `.claude/rules/qmail.md` ③④⑤

## 1. 무엇을 만드나
읽은 메일을 **나에게만** 다시 안 읽음으로 돌린다(«나중에 다시 볼 것» 표시). 다른 멤버의 읽음·메일 상태·알림은 그대로다.
다시 열거나 «모두 읽음»·«확인 완료» 를 누르면 풀린다.

## 2. 방식 결정 — 사람별 표시 칸 하나
`email_thread_participants.marked_unread TINYINT(1) NOT NULL DEFAULT 0` 을 더한다.

| 후보 | 판정 |
|---|---|
| 내 커서만 낮추기 | 불가 — 바닥(`read_floor_message_id`) ≥ 마지막 받은 메일인 옛 스레드는 안 읽음이 안 된다(dev 실측 239건) |
| 바닥 낮추기 | 불가 — 바닥은 공용이라 모두에게 안 읽음이 된다 |
| 커서 낮추기 + 사람별 바닥 무시 | 버림 — 커서·`last_read_at` 은 «읽음 n/m» 명단의 사실(누가 언제 열었나)이다. 표시 때문에 지우면 남이 보는 명단이 바뀐다 |
| **사람별 표시 칸 (채택)** | 커서·바닥·명단을 안 건드린다. 읽음 쓰기 한 곳(`markReadFor`)이 같이 내리면 푸는 길이 저절로 전부 맞는다 |

## 3. 데이터 · 마이그레이션
- 새 스크립트 `dev-backend/scripts/migrate-mail-mark-unread.js` — 칸이 없을 때만 `ALTER TABLE … ADD COLUMN`(멱등), 출력 «추가함/이미 있음».
- `scripts/deploy-planq.sh` 배포 슬롯에 **PM2 reload 앞**으로 등록(판정 SQL 이 이 칸을 읽으므로 코드보다 먼저여야 한다). 개발 DB 에도 같은 스크립트를 돌린다.
- 모델 `EmailThreadParticipant` 에 칸 추가. 채워 넣을 값 없음(기본 0). 되돌리기 = 코드만(칸은 남겨도 무해).

## 4. 판정 — `services/mailRead.js` 한 곳
```
나에게 안 읽음 = last_inbound_message_id IS NOT NULL AND (
     last_inbound_message_id > GREATEST(내 커서, 바닥)          -- 종전
  OR EXISTS(내 참여자 행 AND marked_unread = 1) )               -- 추가
```
- `unreadExpr` 에 위 OR 한 줄. `unreadForWhere`·`unreadAttribute` 는 그대로 따라온다 → **목록 점·`?unread=true`·«전체» 탭 수·
  «모두 읽음 (N)» 라벨/확인/실행(`resolveBulkTargetIds` actionWhere)·계정별 안 읽음 수·주소 모드 목록·Q sale 메일 행·AI `search_mail`(unread_only)** 이 호출부 수정 없이 같이 바뀐다.
- `isUnreadFor(thread, mine)` — 둘째 인자를 커서 숫자에서 **내 참여자 행(없으면 null)** 으로 바꾼다. 함수가 `last_read_message_id` 와 `marked_unread` 를 직접 읽는다
  (인자를 하나 더 붙이는 방식은 호출부가 빠뜨려도 조용하다). 고칠 호출부: `routes/email_threads.js` 상세(~L540) · `services/agent/tools/mail.js` L77·L282·L315~323
  (L315 의 `attributes` 에 `marked_unread` 추가).
- AI 메시지별 읽음(`readFor`) — 표시가 켜져 있으면 **마지막 받은 메일 한 통**만 안 읽음, 나머지는 종전 계산.
- **명단(`readersOf`)은 표시를 보지 않는다** — 종전 계산(커서·바닥)을 `openedLatest(thread, cursor)` 로 떼어 그것만 쓴다. 남에게도 나에게도 «읽음 n/m» 은 그대로다.
- `markReadFor` — `ON DUPLICATE KEY UPDATE` 에 `marked_unread = 0` 한 줄. 이것으로 열기·«모두 읽음»·«확인 완료»(단건·일괄) 네 길이 모두 표시를 푼다.
- 새 함수 `markUnreadFor(userId, threadId)` — 단일 UPSERT: 행이 없으면 `(커서 NULL, marked_unread 1)` 로 만들고, 있으면 `marked_unread = 1, updated_at` 만 바꾼다.
  커서·`last_read_at`·담당·팔로우·보는 중 칸은 안 건드린다. 옛 공용 칸(`email_threads.unread_count`·`email_messages.is_read`)도 **쓰지 않는다**.

## 5. API — 단건 하나
`POST /api/businesses/:businessId/email-threads/:id/mark-unread`
- 미들웨어 = mark-read 와 같다(`authenticateToken, checkBusinessAccess, requireMenu('qmail','read')`), `// audit-exempt: 본인 읽음 표시`.
- 범위 = mark-read 와 같은 조회(`business_id` + `accessibleAccountIds`). 없으면 404 `thread_not_found`(남의 워크스페이스·남의 개인 계정).
- 받은 메일이 없는 스레드(`last_inbound_message_id` NULL — 보낸 것만 있는 스레드)는 400 `no_inbound_message`. 판정식이 받은 메일을 전제하므로 표시가 켜져도 안 보이고 풀 길도 없다.
- 성공 `{ id, unread_count: 1 }`. 이미 안 읽음이어도 200(멱등).
- 실시간: `emitMyRead(req, businessId, { thread_id, unread: 1 })` — **`user:<나>` 방에만**(§7 C4). `business:` 방에는 쏘지 않는다.
- 상세 응답(GET `…/email-threads/:id`)에 두 칸 추가: `marked_unread`(내 표시) · `can_mark_unread`(= 받은 메일 있음).
- **일괄은 지금 만들지 않는다** — 목록에 여러 개 고르기가 없다. 나중에 만들면 `resolveBulkTargetIds` 를 거친다(규칙 ⑤).
- AI 에이전트 도구는 더하지 않는다(쓰기 표면 불변).

## 6. 열면 자동으로 읽음이 되는 것과의 관계
지금 `loadDetail` 은 상세를 받을 때마다(`mail:updated` 신호로 다시 읽을 때 포함) 안 읽음이면 mark-read 를 부른다. 그대로면 누르자마자 풀린다.
1. **누른 화면** — 성공하면 `clearSelection()` 으로 상세를 닫는다(좁은 화면은 목록으로). 기억해 둔 탭도 같이 지워져 탭을 오가도 다시 안 열린다. 이어서 목록(silent)·수를 다시 읽는다.
2. **같은 메일을 열어 둔 내 다른 기기·탭** — 닫지 않는다. 대신 자동 읽음 조건을 고친다:
   `자동 읽음 = unread_count > 0 AND ( marked_unread 아님 OR 이 화면이 이 메일을 «새로 여는» 중 )`.
   «새로 여는» = 직전에 자동 읽음 판단을 한 스레드 id(ref)와 다를 때. 선택이 풀리면 ref 를 비운다. 신호로 다시 읽기·재시도·연결 뒤 새로고침은 같은 id 라 표시를 풀지 않는다.
3. **다시 열기**(목록에서 누름·알림·링크) — «새로 여는» 것이므로 종전처럼 읽음 → 표시 풀림.
4. 표시가 켜진 채 새 메일이 오면 그대로 안 읽음(어차피 안 읽음). 열면 둘 다 풀린다.
5. `mark-read` 를 부르는 다른 화면이 있으면(`grep -rn "mark-read" dev-frontend/src`) 같은 조건을 쓴다.

## 7. 화면 · 문구
- 자리: **상세 ⋯ 메뉴**(`detailMenuItems`) 맨 위 한 줄. `can_mark_unread` 가 false 면 내지 않는다. 폰·태블릿·데스크탑 같은 메뉴.
- 목록 행에는 지금 넣지 않는다 — 행 전체가 버튼이고 행 메뉴가 없다(새로 만들면 별도 화면 일). 확인 창·성공 토스트 없음(결과는 목록의 굵은 글씨·점이 말한다).
- 실패하면 상세를 닫지 않고 기존 오류 줄(`errorMsg`)에 문구.

| 키 (`qmail`) | ko | en |
|---|---|---|
| `actions.markUnread` | 안 읽음으로 표시 | Mark as unread |
| `actions.markUnreadFailed` | 안 읽음으로 표시하지 못했습니다. 다시 시도해 주세요. | Couldn't mark as unread. Please try again. |

testId `mail-detail-mark-unread`.

## 8. 바뀌지 않는 것
다른 멤버의 읽음·목록·수 · «읽음 n/m» 명단과 시각(나 포함) · `reply_needed`·`status`·폴더·담당·팔로우·답변 업무 ·
메일 알림(`mailNotify` 는 읽음을 안 본다 — 다시 울리지 않는다) · 메뉴/확인 필요 배지(`mailTodoWhere` 는 귀속 축, 읽음 아님) · 옛 공용 읽음 칸 · 감사 로그.

## 9. 가드 · 같이 고칠 것
- 가드 `mailread` 에 한 줄: `marked_unread` 글자는 `services/mailRead.js`·모델·마이그레이션·합치기 스크립트에만 나온다(다른 파일이 직접 읽거나 쓰면 실패).
- `scripts/merge-split-mail-threads.js` — 참여자 행을 합칠 때 `marked_unread` 는 OR 로 옮긴다(안 옮기면 합친 뒤 표시가 사라진다).
- `.claude/rules/qmail.md` 에 규칙 한 줄 · `db-schema.md` 칸 한 줄.

## 10. 검증 목록 (실호출 포트 3003 · 시험 워크스페이스 6 · owner/member1)
양성
1. **옛 스레드**(바닥 ≥ 마지막 받은 메일, 내 참여자 행 없음) → mark-unread 200 → 목록 `unread_count` 1 · `?unread=true` 에 나옴 · DB: 내 행 생김(커서 NULL, 표시 1), 스레드의 바닥·`unread_count` 칸 불변.
2. **새 스레드**(내 커서로 읽음) → 같음 · 내 `last_read_message_id`·`last_read_at` 불변.
3. 누르기 전후 **정확히 +1**: «전체» 탭 수 · «모두 읽음 (N)» 라벨 = 확인 문구 = bulk-read `updated` · 그 계정의 계정별 안 읽음 수. 두 번 눌러도 +1 그대로(멱등).
4. 다시 열기(GET 상세 → mark-read) → 표시 0 · 위 수 전부 −1. bulk-read·mark-handled 로도 풀림.
5. 실시간: 같은 사용자 소켓 둘 — 하나에서 누르면 다른 쪽이 `mail:updated {thread_id, unread:1, read:true}` 를 받는다.
6. 화면(폰 375 · 태블릿 · 데스크탑): ⋯ 에 항목이 **보이고**(elementFromPoint) 누르면 상세가 닫히고 그 행이 안 읽음 모양. 같은 메일을 열어 둔 둘째 탭은 3초 뒤에도 안 읽음 유지(DB 표시 1) · 그 탭에서 다른 메일 갔다 돌아오면 풀림.
7. AI `search_mail unread_only` 에 그 스레드가 나오고 `get_mail_thread` 가 `unread_count:1` · 마지막 받은 메일만 `is_read:false`.

음성(대조군)
8. **다른 멤버(member1)**: 같은 스레드 `unread_count`·«전체» 수·«읽음 n/m» 명단 전후 동일. member1 소켓은 신호를 받지 않는다.
9. 범위: 다른 워크스페이스 스레드 id · 남의 개인 계정 스레드 id → 404, 참여자 행 수 불변. qmail 메뉴 none 멤버 → 403.
10. 받은 메일 없는 스레드 → 400 `no_inbound_message`, 행 안 생김. 화면에 항목 없음.
11. `reply_needed`·`status`·`reply_task_id`·감사 로그 행 수·알림 행 수 전후 동일.
12. **검사 반증**: `unreadExpr` 의 OR 줄을 잠깐 빼면 1·3 이 빨강 · `markReadFor` 의 `marked_unread = 0` 을 빼면 4 가 빨강 · 자동 읽음 조건을 옛것으로 되돌리면 6 의 둘째 탭이 빨강.
13. 가드: `guard-invariants`(mailread·i18n·parity) · `npm run build` · `--suite maillabel`·`--suite mail`·`--suite tenant` 초록. 마이그레이션 두 번 돌려 둘째가 «이미 있음».

회귀 고정: `--suite maillabel` 에 «안 읽음으로 표시 → (N) +1 → 다시 열면 −1» 한 검사를 더한다.
