# Q mail — 업체 보낸편지함·스팸함 가져오기 설계 (1쪽)

> 2026-10-07 · [Opus] 작성 · Fable B 판정 4 기반(Irene: "fable 판정대로 해" — 순서 보낸편지함 먼저 · 스팸 30일 · 스팸 첫 가져오기 14일)
> 상태: **Fable 설계 게이트 — 수정 후 PASS (2026-10-07)**. 아래 «Fable 판정» 절이 본문보다 우선한다.

## 왜
- 계정 4개 모두 `imap_folder='INBOX'` 만 읽는다(운영 실측). 커서 `imap_last_uid` 는 **계정당 1개**.
- ① Gmail·네이버 웹/앱에서 **직접 보낸 메일**은 업체 보낸편지함에만 있다 → PlanQ «보낸메일» 이 비고,
  «아는 상대» 판정(`isKnownContact` ③ = outbound 에 그 주소)과 «우리가 답했다» 가 못 잡는다(행 27·28 의 근본).
- ② 업체가 스팸함으로 보낸 메일은 들어온 적이 없다 → 스팸 탭이 거의 빈다(스레드 4,127 중 spam 2).

## 원칙
1. **읽기 전용 미러.** 업체 쪽 이동·삭제·플래그(읽음 포함) 변경 0. `markSeen:false` 그대로.
2. **폴더 이름을 하드코딩하지 않는다.** `getBoxes()` 의 SPECIAL-USE 속성(`\Sent`·`\Junk`)으로 찾고, 없을 때만 이름 후보
   (`[Gmail]/Sent Mail`·`[Gmail]/보낸편지함`·`Sent`·`Sent Messages`·`보낸메일함` / `[Gmail]/Spam`·`Junk`·`스팸메일함`)로 폴백.
   못 찾으면 그 역할은 **꺼진 상태로 기록**(조용히 INBOX 를 다시 읽지 않는다). 찾은 이름은 계정 설정 화면에 보인다.
3. **커서는 폴더별.** 새 표 `email_account_folders(id, account_id, role ENUM('sent','spam'), folder, uid_validity, last_uid,
   last_synced_at, last_error, enabled, UNIQUE(account_id, role))`. `email_accounts.imap_last_uid` 는 INBOX 커서로 남는다.
   UIDVALIDITY 가 바뀌면 그 폴더 커서를 0 으로(= 그 역할의 첫 가져오기 규칙으로) 되돌린다.
4. **연결을 늘리지 않는다.** 3분 tick 의 `syncOne` 이 INBOX 를 끝낸 **같은 연결**에서 Sent → Spam 순서로 `openBox` 한다
   (네이버 동시 연결 제한). IDLE 은 INBOX 만. 한 폴더 실패가 INBOX 저장을 되돌리지 않는다(폴더별 try, `last_error`).
5. **첫 가져오기 상한** — Sent 30일·Spam 14일, 각 300건(기존 `BACKFILL_LIMIT`). 증분은 오래된 것부터(운영 #261 규칙 그대로).

## 보낸편지함(role sent) 저장 규칙
- `direction:'outbound'`, 읽음, 알림·확인필요·답변필요 **켜지 않음**(행 28 `isOwnSentCopy` 와 같은 처리 — 같은 함수 경로 재사용).
- **중복** — PlanQ 가 SMTP 로 보낸 메일은 Gmail 이 Sent 에 자동 복사한다. 기존 `business_id + message_id` 검사로 건너뛴다
  (인덱스 `email_messages_message_id` 있음). 안 하면 모든 발송이 두 번 보인다.
- **스레드** — 기존 `findOrCreateThread`(In-Reply-To → References → 제목) 그대로. 새 스레드면 참여자는 받는 사람.
  스레드에 우리 답장이 붙으면 그 스레드의 `reply_needed` 는 끈다(우리가 답했다는 사실 — 화면의 «답변 필요» 와 같은 술어).
- 첨부는 저장한다(보낸메일 보기에 필요) — 기존 `saveAttachmentAsFile`·쿼터·dedup 그대로.
- **개인 계정의 보낸편지함은 그 계정 주인만** 본다 — 이미 `accessibleAccountIds`(계정 단위)가 막는다. 새 규칙 없음.

## 스팸함(role spam) 저장 규칙
- **항상 새 스레드**, `status:'spam'`. 기존 스레드에 붙이지 않는다(In-Reply-To 위조로 진행 중 대화에 끼어드는 것을 막는다).
  이미 같은 message_id 가 있으면(받은편지함에서 먼저 받았다가 업체가 스팸으로 옮김) 건너뛴다.
- 확인필요·상담(`saleMailCriteria`)·알림·자동추출·FAQ 클러스터·`isKnownContact` 증거 — **전부 제외**
  (status spam 은 이미 `mailFolders` 가 뺀다. 증거원 쿼리 `isKnownContact`·`saleMailCriteria` 에도 `status<>'spam'` 확인 — 구현 때 전수).
- **첨부는 저장하지 않는다**(파일 쿼터·검색 오염) — 첨부 이름·크기만 메타로.
- **[스팸 아님]** = 로컬 `status→open` 만. 업체 쪽은 그대로라 화면이 «Gmail·네이버에서도 스팸 해제해 주세요» 라고 말한다.
- **보존 30일** — `spam` 상태로 30일 지난 스레드는 cron 이 **영구 삭제**(메시지·스레드, 휴지통 안 거침). [스팸 아님] 한 것은 대상 아님.
  업체 자동 삭제를 따라가지 않는다(우리 쪽 기준 하나).

## 켜고 끄기 · 롤백
- 계정별 `email_account_folders.enabled`(기본 켜짐). 계정 설정 화면에 «보낸편지함 가져오기»·«스팸함 가져오기» 토글(AutoSaveField).
- 전역 비상 스위치 `QMAIL_EXTRA_FOLDERS=0`(기본은 **켜짐** — 기본 꺼짐 플래그는 운영에서 조용히 죽는다).
- 롤백 = 스위치 끄기. 이미 들어온 보낸메일은 남는다(사실 기록). 스팸은 30일 뒤 사라진다.

## 운영 적용
- `scripts/migrate-mail-folders.js`(표 생성, 멱등) — 배포 슬롯, 코드 배포 전. 첫 tick 에 폴더 탐색·첫 가져오기가 돈다.

## 검증(구현 후)
- dev 실계정(Gmail 비번/OAuth 1개 이상)으로: 폴더 탐색 결과 · Sent 30일 첫 가져오기 수 · PlanQ 발송분 중복 0 ·
  스팸 스레드가 확인필요·상담·알림·검색 제외 · 첨부 File 0 · 30일 지난 스팸 삭제(픽스처) · [스팸 아님] 후 삭제 제외 ·
  UIDVALIDITY 변경 시 커서 리셋 · 폴더 하나 실패해도 INBOX 정상 · 남의 워크스페이스·개인 계정 보낸메일 안 보임 ·
  `isKnownContact` 가 보낸편지함 기록으로 참이 되는 양성 대조군.

## Fable 이 볼 것
1. 스팸을 «항상 새 스레드» 로 두는 것이 맞는가(사람이 [스팸 아님] 한 뒤 원 대화에 다시 붙이는 문이 필요한가).
2. 보낸편지함이 `reply_needed` 를 끄는 것 — 다른 앱에서 «답장하지 않고 전달만» 한 경우도 끈다(Fwd: 는 제외할지).
3. 개인 계정이 아닌 **공용 계정**의 보낸편지함은 멤버 전원이 본다 — 지금 받은편지함과 같은 범위라 괜찮은가.
4. 스팸 30일 영구 삭제(R=1 삭제 실행) — 감사 로그 요약 1행/일로 충분한가.

---

## Fable 판정 (2026-10-07) — 수정 후 PASS. **이 절이 위 본문보다 우선한다**

### 고칠 점
1. **IDLE 계정은 tick 이 건너뛴다**(`emailImapCron.js tick`) — 운영 4계정은 사실상 전부 IDLE 이라 `syncOne` 은 INBOX 새 메일이 올 때만 돈다.
   → Sent/Spam 은 `syncOne` 안(INBOX 뒤 같은 연결)에서 돌되, **IDLE 계정도 10분마다 `guardedSync`**(syncBusy 직렬화 그대로).
2. **`isOwnSentCopy` 는 Sent 폴더에 못 쓴다**(받는 칸에 내 주소를 요구) → `ownCopy = role==='sent' || isOwnSentCopy(...)`. 이후 저장·읽음·unread·알림 제외는 기존 ownCopy 분기 재사용.
3. **순서 역전 가드** — Sent 첫 가져오기(30일)가 이미 고객 답장이 온 스레드에 옛 발신을 붙이면 `last_message_*`·`reply_needed:false` 를 무조건 덮어
   답변 필요 메일이 사라지고 `mailFollowUpCron` 이 옛 발신에 «답이 없다» 를 띄운다. → **`parsed.date > thread.last_message_at` 일 때만** last_message_*·reply_needed 를 바꾼다. `message_count`·participants 는 항상.
4. **uid 공간은 폴더마다 다르다** — `uidFailures` 키 `${account.id}:${role}:${uid}`, isBackfill 은 폴더 행 기준.
   **`email_messages.source_folder ENUM('inbox','sent','spam') NOT NULL DEFAULT 'inbox'`** 를 둔다(증거원 제외의 손잡이).
5. **스팸 스레드에 `mailLink.linkThread` 를 부르지 않는다**(`clientTimeline.js` 는 client_id 만 본다 → 고객 타임라인에 스팸). triage·`isKnownContact`·`notifyInboundMail`·`scheduleFromInbound` 전부 건너뛰고 `status:'spam', triage:'spam', reply_needed:false` 직접 기록.
6. **Sent 스레드 매칭 3단계**(제목+참여자)는 fromEmail 을 참여자와 비교한다 — Sent 는 from 이 나라서 안 맞는다 → role sent 는 to/cc 로 비교.
7. **Message-ID dedup 은 Gmail 만 보장** — 네이버 SMTP 가 Message-ID 를 바꾸는지 **실측**. 바꾸면 «같은 계정·같은 to·제목·±2분 outbound» 폴백.

### 쟁점 결정
- ① **스팸은 항상 새 스레드 — 유지.** [스팸 아님] 은 원 대화에 다시 붙이지 않는다. 대신 `mark-not-spam` 은 provider 출신이면 **수신 triage(isKnownContact·규칙·linkThread)를 그 자리에서 돌린다**(알림은 안 보냄).
- ② **Fwd 는 «답했다» 가 아니다** — 판정은 접두어가 아니라 받는 사람: Sent 의 to/cc 에 우리 주소 아닌 것이 하나도 없으면 `email_messages.internal_only=1`.
  reply_needed 끄기·`saleInbox` outboundCount·`emailFaqCluster` 표준답변은 `internal_only=0` 만 센다.
- ③ **공용 계정 Sent 는 멤버 전원 — 맞다**(격리 축 = 계정 하나).
- ④ **삭제 범위를 좁힌다** — `email_threads.spam_origin ENUM('provider') NULL` + `spam_since DATETIME`. 삭제는 `spam_origin='provider' AND status='spam' AND spam_since < now-30d` 만
  (사용자가 INBOX 에서 스팸 표시한 것은 지우지 않는다). `mark-not-spam` 은 `spam_origin=NULL`. 감사: 실행 1회 = 워크스페이스당 AuditLog 1행(`mail.spam_purge`, 건수+thread id 목록).

### 증거원·소비처 — spam 제외 추가 3곳
- `isKnownContact ④`(inbound 자체 조회) → `AND source_folder <> 'spam'`
- `emailFaqCluster.js` 공용계정 스레드 → `status != 'spam'`
- `clientTimeline.js` → `status != 'spam'`
- 이미 제외(변경 불필요 확인): mailFolders(all/sent/검색) · saleInbox · mailFollowUp INACTIVE_STATUS · mailAutoExtract · agent/tools/mail · mailBrief
- UIDVALIDITY: 폴더 행 `uid_validity` ↔ `box.uidvalidity` 다르면 `last_uid=0`.

### 추가 검증
양성 대조군 «Sent 백필이 더 최근 inbound 가 있는 스레드의 reply_needed 를 끄지 않는다» · «IDLE 계정에서 10분 내 Sent 도착» ·
«스팸 폴더 메일의 In-Reply-To 가 우리 도메인을 가리켜도 isKnownContact 거짓» · 네이버 발송 1건 중복 0.
