# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-10 18:00 UTC (Opus 5, 1M)
**작업 상태:** **청크 A·B·C 게이트 전부 PASS** · 전부 미배포 · **`/배포` 대기 중 (Google 심사 선행조건)**

> ## ⚠️ 이 파일이 낡으면 Fable 이 오판한다
> 지난 세션에서 Fable 이 옛 내용을 읽고 잘못 판정한 전례가 있다. 청크를 끝낼 때마다 갱신할 것.

> ## ★★ 이번 세션에서 바로잡은 큰 사실 두 가지
> 1. **운영 서버·운영 DB 에 접근할 수 있다.** `ssh 87.106.78.146` (BatchMode 로 키 인증 됨).
>    운영 코드는 `/opt/planq/backend`, 운영 DB 는 거기서 `node -e` 로 읽는다.
>    **내가 이 세션 초반에 "운영 DB 접근 불가" 라고 두 번 말한 것은 틀렸다.** 그 오판 때문에
>    "새 피드백 없다" 고 답했으나 **실제로는 미처리 32건이 있었다.** 앞으로 피드백은 운영에서 직접 읽을 것.
> 2. **idle 자동저장이 브랜치를 오염시키던 것을 재설계했다.** 이제 스냅샷은 `refs/autosave/<브랜치>` 에만 쌓인다.
>    복구: `git checkout refs/autosave/main -- <경로>`

---

## ✅ 청크 C — #217(b) 증빙 발행·정정 알림 메일 (Fable 구현게이트 **PASS**, 2026-08-10 18:00)

**커밋 `6724a98`.** 9항목 전부 통과.
- **5경로 전수 실HTTP 15회** — 발행 4(회차/단건 × 세금계산서/현금영수증) + 정정 1.
  기본(미전달) `+1` / `notify_customer:false` `0` / `true` `+1` — 5×3 매트릭스 전부 기대대로.
- **화면 주소 == 발송 주소** — `receipts-due` 응답의 `receipt_notify_email` 과 `email_logs.to_email` 완전 일치.
- **게이트가 팀 알림을 안 죽인다** — false 일 때도 notifications +3 · bill_events +1 그대로, 고객 메일만 0.
- **실발송 0** — `EMAIL_SENDING_ENABLED=false`, `emailService.js:352` 가 sendMail **이전** early-return + `status:'skipped'`.
- **커밋본 worktree 단독 빌드 EXIT=0** (별도 파일 박제), `error TS` 0.
- 가드 `guard-invariants` 23/23 · `health-check` 34/34.
- **반증 3건 성립** — 게이트 제거하면 false 무시됨 / 옛 `issued_at` payload 로 발행일이 오늘로 덮임 /
  헬퍼를 비틀면 화면 주소가 즉시 갈라짐. 전부 `cp` 백업·복원 md5 일치 (`git checkout` 미사용).

**★ 게이트가 잡은 내 절차 결함 (MEDIUM — 코드 아님):** 커밋 메시지의 "검증 데이터 전부 원복(잔여 0)" 이 **거짓**이었다.
`FableC-*` 청구서 7건(477–483)·회차 4건(94–97)·email_logs 17건이 남아 **health-check 의 billing 원장 가드를
FAIL 로 깨뜨린 상태**였다. Fable 이 전량 삭제 후 34/34 복구.
→ **원복 주장은 "지웠다" 가 아니라 정리 후 health-check 재실행으로 증명할 것.**

**남은 LOW (백로그):** `wantsCustomerNotify` (`routes/invoices.js:1924`) 가 boolean `false` 만 인지 —
문자열 `"false"` 는 발송된다. 현 프론트는 항상 boolean 이라 실해 0. 외부/스크립트 호출 대비 하드닝 후보.

**게이트 마커의 한계(알아둘 것):** 마커 지문은 `git status --porcelain` 해시라 **트리가 깨끗하면 항상 같은 값**이다.
커밋해 버리면 청크 B-클린과 청크 C-클린을 구분하지 못해 마커 검사가 공허하게 통과한다. 마커만 믿지 말 것.

---

## ✅ #252 문서 자동저장 — 배포 차단 게이트 **PASS** (2026-08-10 18:00)

**`50530ca` 의 "⛔ 배포하면 문서 저장이 깨진다" 경고는 더 이상 유효하지 않다.**
남아 있던 6항목(BLOCKER-3a/3b/3c · MAJOR-1 · MINOR · `PostsPage.tsx:363`)이 **전부 `eb36680`(청크 A) 안에서 닫혔다.**

**★ 그런데 그게 문제였다.** 청크 A 는 커밋 메시지가 말한 3건(증빙 뱃지·번역·PWA)과 달리 **62파일 2,850줄**이고,
#252 완성분이 **게이트 범위 밖에서 얹혀 갔다**. 청크 A 게이트는 번역·뱃지를 본 것이라 #252 표면은 미검증이었다.
→ 배포 직전에 발견해 전용 게이트를 돌렸고 PASS. **교훈: 커밋 메시지가 diff 크기를 대변하지 않는다.
배포 스택은 커밋 메시지가 아니라 `git show --stat` 으로 훑을 것.**

게이트 증명: 실HTTP 29체크 · 실브라우저 19체크 · 소켓 실측 · 반증 2건.
- draft 재열람→저장 시 `published`+`vlevel` 승격 실측 (안 되면 사용자는 저장했다고 믿는데 남에게 영영 안 보임)
- draft 는 작성자 외 목록 미노출 + 단건 403 (status·vlevel 이중 방어, 반증 F1 로 load-bearing 확인)
- **아무것도 안 건드리고 열었다 닫으면 draft 가 안 생긴다** (편집 진입 스냅샷 게이트)
- 편집 중 외부 `post:updated` 도착해도 내 입력 안 덮음 (dirty 가드)
- 열람만으로 `updated_at` 오염 안 됨 → 직후 저장에 거짓 409 없음 (반증 F2)
- 운영 옛 posts 39건 전부 `status='published'`, draft 0건 → **배포로 사라지거나 노출될 행 없음**

**★ H-1 (배포 필수 동반 조건):** 운영 `posts.created_at/updated_at` 이 `datetime`(초)인데 dev 는 `datetime(3)`(ms).
#252 낙관적 잠금이 ms 를 전제하므로 **같은 초 안의 두 저장이 잠금을 통과해 남의 글을 조용히 덮는다** — #252 가 막으려던 바로 그 사고.
`scripts/migrate-posts-datetime-ms.js` · `migrate-task-tags.js` 둘 다 **`deploy-planq.sh` 자동 블록에 미등록** →
`--auto` 만 돌리면 실행 안 된다. **수동 실행 + 배포 후 `SHOW COLUMNS FROM posts` 로 `datetime(3)` 실측 확인 필수.**

**남은 LOW:** 제목 없이 본문만 쓰고 다른 문서로 이동하면 본문 유실 (#252 이전에도 같아 회귀는 아님). 후속 사이클.

---

## 🔴 Google OAuth 심사 — 운영 실측으로 밝혀진 진짜 막힘 (2026-08-10 18:00)

**캘린더는 절반만 해결이다.**
- 코드 `6d33587`(Meet 실패가 일정 생성을 죽이던 것)은 **운영에 배포돼 있다** — 운영/dev `google_calendar.js`·`calendar.js` md5 일치로 확인.
- 그러나 **운영 워크스페이스 토큰에 캘린더 권한이 없다:**
  ```
  BusinessCloudToken  biz=1 provider=gcal
    scope=[https://www.googleapis.com/auth/userinfo.email  openid]   ← calendar.events 없음
    updated 2026-07-31 00:22
  OauthConnection  user=3, user=13  scope=(없음)   ← 개인 연동도 쓰기 불가
  ```
  구글 동의 화면이 항목별 체크박스라 "캘린더" 를 안 누르면 이렇게 저장된다(코드 주석의 2026-07-27 사고 재현).
  **Meet 링크 발급·PlanQ→구글 일정 반영 둘 다 현재 불가. 코드로 못 고침 — Irene 이 재연결하며 체크해야 한다.**

**제출 순서(변경 불가):** ①`/배포`(방침 정정 `33c2f13` 이 운영에 없어 방침≠실제스코프 = 반려사유)
→ ②운영 재연결 + 캘린더 체크 → Meet 발급 확인 → ③동영상 촬영 → ④제출

**심사 대상 스코프는 `calendar.events` 하나.** `drive.file` 은 비민감이라 심사 대상 아님.

**Gmail restricted 는 제외하기로 정했다** (Irene 에게 설명 완료, 반대 없으면 그대로 진행).
`https://mail.google.com/` 는 restricted → **CASA 유료·매년 갱신**. 운영 실측 사용처는 **딱 1계정**:
```
biz=5 withMIN lab / minky3018@gmail.com  → google_oauth (mail.google.com)
biz=1 help@irenewp.com,  irene@irenewp.com → 앱 비밀번호 ✅ 정상 동기화 중
```
Irene 본인 2계정이 이미 앱 비밀번호로 잘 돈다 → withMIN lab 도 앱 비밀번호 이관하면 끊김 0.

---

## ✅ 청크 A — #217(a) 증빙 뱃지 + #241 Q Note 번역 게이트 + PWA 개행 (Fable 재검 PASS)

커밋 `eb36680`. 1차 FAIL 이던 `translateOn` 3조건을 실브라우저로 닫았다(양성 대조군까지 세워 탐지기 유효성 증명).
반증 성립 — 프롬프트 인자화를 되돌리니 ko→ja 가 영어로 나옴, `cp` 복원 md5 일치.
서버측 `translation=''` 강제가 load-bearing 임을 multi 세션으로 실증.

## ✅ 청크 B — #221 메일 판정 재정비 (Fable 1차 FAIL → 2차 PASS)

커밋 `33dccc3`. **원인이 둘이었다.**

**① 인입 경로가 헤더에 눈을 감고 있었다.** `emailImapCron` 이 mailparser 의 **Map** 을 그대로 넘기는데
`isAddressedToUs`·`isThreadReply` 두 술어만 직접 프로퍼티 접근이라 Map 에서 **항상 false**.
수집 시점에 `needsReply` 규칙 ①(회신)·④(직접수신+요청)가 **영구 미발동**했다.
실측 22 스레드, 그중 11건이 사용자에게 안 보이는 상태(세무사 원천세 납부서·급여대장, 청구서 전달 2건 포함).
→ 술어를 하나씩 고치지 않고 **`services/emailHeaders.js` 로 입력을 같게** 만들었다(`normalizeHeaders` 단일 원천).

**② 자동 메일 rubric 에 "내 조치가 남은 것" 범주가 없었다.** Apple Developer 등록 안내가 자동·마케팅에 묻혔다.

**★ 콜드메일 판별자를 한 번 잘못 골랐다.** 처음엔 "참조 Message-ID 가 우리 DB 에 있는가" 로 구현했는데,
플랫폼이 SMTP 로 보낸 메일은 `email_messages` 에 없어 **정당한 고객 회신 2건이 강등**됐고,
콜드메일이 자기 이전 메일을 참조하면 통과했다. 진짜 지문은 **자기 도메인 자작 참조**(`isForgedReplyRef`).

**★ 1차 FAIL 사유 — 빌드 검증이 실패를 가렸다.** `npm run build > log; echo $?; grep; tail` 로 돌려
보고된 종료코드가 **마지막 tail 의 것**이었다. npm 은 exit 2 였고 로그에 찍혀 있었는데 안 읽었다.
서빙 dist 는 분리 이전 소스로 만들어져 화면은 정상 — **커밋된 소스로는 재빌드·배포·롤백 불가** 상태였다.
→ 이후 빌드는 **종료코드를 별도 파일에 기록**해서 확인한다.

**백필은 아직 안 돌렸다** — `node dev-backend/scripts/retriage-mail.js --apply` (미리보기 전이 19건:
답변필요 승격 6(오탐 0) · 해제 4 · 확인권장 승격 9). Irene 승인 대기.

## ✅ 자동저장 재설계 + 히스토리 정리 (Fable PASS)

커밋 `31c85c5`. 옛 자동저장이 ①삭제 예정 검증 스크립트를 커밋 ②작업 중 상태를 커밋
③**Fable 게이트 훅을 침묵시킴**(트리를 깨끗하게 만들어 경고 소멸) — 안전망이 안전망을 껐다.
→ `refs/autosave/<브랜치>` 스냅샷. 워킹트리·인덱스·브랜치 무접촉(임시 인덱스).
`.gitignore` 에 `dev-backend/test-*.js`·`q-note/test-*.py` (게이트 훅 오작동도 같이 해소).

**히스토리 42 → 7커밋.** rebase 아닌 `git commit-tree` 재부모화라 충돌 원리적 불가.
백업 `refs/backup/pre-history-cleanup-20260810-040237` + `backups/20260810-040237/pre-history-cleanup.bundle`.
Fable 이 별도 클론에서 실복구까지 확인. `origin/main` 은 `c4362a3` 그대로, push 안 함.

---

## 🚀 배포 완료 — 2026-08-10 18:02 UTC (commit `cc35d8f`)

**9커밋 배포 완료.** `519d183`(운영 신고 5건) ~ `cc35d8f`(docs) 전부 운영 반영.
- 백업: 운영 `/opt/planq/backups/20260810_175853` (롤백은 `backend.tar.gz` 풀고 `pm2 reload`)
- 반영 3점 검증: PM2 prod 3프로세스 uptime 30s 재기동 · `frontend-build/index.html` 18:02 + 412 asset · `https://planq.kr/api/health` 200 (`node_env=production`)
- **★ `DEPLOY_EXIT=1` 은 부수 신호다** — `Deployment Complete (237s)` + verify 전항목 OK. 종료코드만 보고 실패로 읽지 말 것.
- **마이그레이션 2건은 `sync-database.js` 가 이미 처리했다** — 배포 후 수동 실행 시 둘 다 "이미 존재 — skip".
  `posts.created_at/updated_at = datetime(3)` 실측 확인 (Fable H-1 조건 충족). Fable 의 사전 실측(초 정밀도)은 배포 전 시점이라 맞았다.
- **청크 B 메일 백필 `--apply` 실행 완료** — 운영 970 스레드 중 **10건 재분류**, 답변필요 해제는 **0건**(놓치는 메일 없음).
  DB 실측 확인: #375·#1273 `reply_needed=1 triage=human`(학생 문의·지원 요청), Apple Developer 4건 + 대한항공 `status=uncertain`(확인 권장), LinkedIn `marketing`. 전체 `reply_needed=true` 5건.

**★ 배포 후 즉시 해야 할 것 (Irene):** 운영에서 Google 캘린더 **재연결 + 동의 화면의 캘린더 체크박스 클릭**.
지금 운영 토큰은 `[userinfo.email openid]` 뿐이라 Meet 링크 발급·일정 반영이 여전히 불가하다. 그 뒤 심사 동영상 촬영.

---

## (배포 완료된 옛 스택 기록)

```
519d183 운영 신고 5건 → 33c2f13 죽은 SPA 링크·Google 스코프·OAuth 관측성
→ d39eee6 docs → 50530ca #252 문서 자동저장 → eb36680 청크 A
→ 33dccc3 청크 B → 31c85c5 자동저장 재설계 → 6724a98 청크 C(게이트 대기)
```
배포 시 순서: ①`migrate-posts-datetime-ms.js` ②`migrate-task-tags.js` ③백엔드 ④프론트.
둘 다 멱등. 청크 A·B·C 는 **DB 변경 없음**.

**★ Google 심사 때문에 배포가 선행 조건이다** — `33c2f13` 의 개인정보처리방침 정정이 아직 운영에 없어서,
지금 심사 제출하면 **심사관이 보는 방침(캘린더 읽기 전용·Gmail 없음)이 실제 스코프와 불일치**한다.

---

## 📋 다음 할 일 (우선순위)

### 1. 청크 C 게이트 판정 확인 → FAIL 이면 수정 후 재검

### 2. 운영 미처리 피드백 32건 — 운영 DB 에서 직접 읽을 것
```bash
ssh 87.106.78.146 'cd /opt/planq/backend && node -e "…FeedbackItem where status not in (done,wontfix)…"'
```
**신규(session-state 백로그에 없던 것):**
- **#254** 주간 진척 그래프에 실제시간 6.4 인데 리스트엔 실제시간 든 업무 없음 — 연동 확인
- **#255** 나의 업무보고에 진척 그래프가 안 나옴  ← #254 와 **같은 화면의 모순 신고, 함께 볼 것**
- **#256** 업무추가 시 첨부파일이 **업무결과물** 아래에 붙음 (업무설명 아래여야)
- **#257** 문서 리스트가 보기만 해도 최신으로 올라옴(최근 수정순이어야) + 프로젝트>문서 제목 2줄

**Irene 이 "fable 에게 상의해/검토해" 라고 명시한 것 11건:**
#211(B2B 그룹웨어 타깃 점검) #213(메일 필터 접기) #228(파일 드래그 반출) #229(프로젝트 히스토리)
#230(Today's 브리핑) #233(AI 검색) #235(업무 자동추출) #236(업무 태그) #237(오늘 나의 업무)
#239(문서 컨펌) #240(프로젝트 완료 알림)

**그 외 미처리:** #195 #208(출퇴근·휴가) #214(알림 발송처 전수정리) #217 #220 #221 #222 #225 #227
#231 #232 #244 #245 #250 #252

### 3. Google OAuth 심사 (Fable 판정 2026-08-10)
순서: **①미배포 배포 → ②운영에서 Google Calendar 재연결(캘린더 항목 체크) → ③심사 제출**
- **결정 필요**: `https://mail.google.com/`(restricted)를 제출에서 뺄지. 넣으면 **CASA 유료 보안평가**로 격상.
  Fable 권고는 제외(Q Mail 은 IMAP 앱비번으로 검증 없이 작동). `gmail_oauth.js`·`personalOauth.js` 가
  같은 client 로 라이브 노출 중 — 메모리의 "Gmail OAuth 보류" 는 stale 이었다.
- 캘린더 #1(Meet 켜면 일정 자체가 안 생김)은 **`6d33587` 로 해결·8/2 부터 운영 배포됨.**
  단 Meet **링크 발급**은 워크스페이스 토큰에 캘린더 쓰기 권한이 없어 아직 미확인 → 재연결 필요.
- 캘린더 #3(양방향 동기화)은 **미구현이고 심사와 무관**. 별도 사이클. Fable 이 절단면을 뽑아 뒀다
  (syncToken 증분 1차 / watch 2차, last-writer-wins, 삭제는 soft, **에코 루프가 최대 위험**).

### 4. 남은 잔여 결함
- `FocusWidget.tsx` socket 미청취 (window 이벤트만 — #217a 와 같은 계열, 실측 확인)
- Q Note 세션 **재진입** 시 정상 ON 세션에서 "번역 중…" 잔존 (캐시 답변에 번역 없고 재요청 경로 없음)
- `/translate-answer` 의 `target_language` 서버 검증 없음
- 청크 D — 음성 화면 컨텍스트 → 메일 "답장" (`docs/MAIL_ALIAS_AND_VOICE_DESIGN.md` §B-3)
- 증빙 **재마킹 시 중복 발송** (Fable "차단 요건 아님" 판정, 현행 유지 — 막을지 Irene 결정 대기)

---

## 이번 세션에서 배운 것 (재발 방지)

1. **★ 빌드 종료코드를 파이프 뒤에서 읽지 마라.** `build > log; echo $?; grep; tail` 은 마지막 명령의
   코드를 보고한다. **별도 파일에 `echo "EXIT=$?" > file`** 로 박제할 것. 이 함정이 릴리즈 직전까지 갔다.
2. **★ 산출물이 커밋과 다를 수 있다.** 화면이 정상이어도 커밋본이 안 빌드될 수 있다 —
   `git worktree` 로 커밋본만 체크아웃해 빌드하는 것이 유일한 증명.
3. **★ 판정 기계부터 의심하라 (이 세션에서 4번 발생).** 150건 전이·archived 121건 되살림·
   샌드박스 기본 브랜치 `master`·`TH=1800 out=$(...)` 대입문 누수 — 전부 내 측정기 버그였다.
4. **★ "접근 불가" 를 단정하기 전에 시도하라.** 운영 SSH 는 되는데 안 된다고 두 번 말했고,
   그 때문에 미처리 피드백 32건을 못 본 채 "새 피드백 없다" 고 답했다.
5. **★ 편의 판별자가 정반대 오류를 만든다.** "우리 DB 에 있는 Message-ID 인가" 는 그럴듯했지만
   플랫폼 SMTP 발송분을 몰라 정당한 회신을 강등시켰다. 데이터가 판별자를 알려준다 — 먼저 실물을 보라.
6. **★ 요구를 절반만 구현하면 나머지 절반이 조용히 위반된다.** "물어보고 보내자" 중 '보내기' 만
   구현돼 확인 없이 고객 메일이 두 달간 나갔다. 요구 문장의 **모든 절**을 체크리스트로 만들 것.
7. **★ 게이트 마커는 트리가 클린이면 항상 같은 지문이다.** 커밋 후엔 마커 검사가 공허하게 통과한다.

---

## Git 상태
- `origin/main` = `c4362a3` (push 안 함). 로컬 7커밋 앞섬.
- 자동저장 스냅샷: `refs/autosave/main` (브랜치 오염 없음)
- 히스토리 정리 백업: `refs/backup/pre-history-cleanup-20260810-040237`
- 검증 스크립트는 전부 scratchpad — 프로젝트 트리에 없음

## 복구 가이드
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
