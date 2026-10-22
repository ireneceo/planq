# 답변 필요 메일이 확인 권장에 남는 문제 — 진단·보완안 (2026-10-22)

> Irene: «지금 메일에서 답변필요한게 죄다 확인권장에 남아있어. 운영서버에 메일리스트 한번 봐봐. 너무 심해.
> 내 메일도 서명요청에 대한 요청내용 왔는데 이게 확인권장이야. 제대로 리스트업 할 수준의 조건이 안돼? 방법이 없을까?
> Fable이 바로 검토해서 신속하게 보완해줘.»

상태: **Fable 판정 PASS(2026-10-22 재시도) → 구현 완료(dev).** 판정 원문 요약은 docs/FABLE_GATE_QUEUE.md 맨 위. 아래 6절이 구현·검증 결과.
[Opus] 운영 읽기 전용 조회·시뮬만 했다(운영 쓰기 0).

## 1. 운영 실측 (최근 30일 확인 권장)
- 워프로랩(ws1) 약 180건 · 기율법률(ws17) 약 50건.
- 시뮬 도구: `mailRetriage.judgeThread` 를 운영 데이터에 읽기만으로(/tmp 미러 + `node --preserve-symlinks`, 수정 파일만 바꿔 끼움).

## 2. 원인 다섯 갈래
| # | 무엇 | 운영 예 | 원인 |
|---|---|---|---|
| D1 | 우리 메일에 온 **진짜 답장**이 확인 권장 | 5015 «RE: [워프로랩] 서명 요청 — 업무협력 계약서» — 거래처가 «사업자 주소 변경, 수정 요청 드립니다» | 인용된 원문 안내 문구가 보안 코드 기준에 걸림. 보안 기준이 관계(우리 대화 회신)보다 **먼저** 돈다 |
| D2 | 전자서명 «내 차례» 가 확인 권장 | 4978 모두싸인 «[서명요청] … 서명할 차례입니다» | 자동 발송 → 업무 내용(automated_relevant) → 확인 권장. 우리가 움직여야 끝나는 일인데 inbound_action 에 낱말 없음 |
| D3 | 새로 연결한 계정의 지난 메일 33건 | ws17 계정 10-21 08:33 연결. «[RE][기율법률] 소장 및 가상계좌 송부 건»(변리사 «절차·일정을 알려주시면») 등 | 처음 가져오는 30일은 «읽기만»(답변 필요 끔 — 옛 결정). 게다가 받은편지함을 보낸편지함보다 먼저 가져와 그 순간엔 «우리가 메일 보낸 상대» 를 몰랐다(mailplug 답장은 회신 헤더가 없다). **지금 기준으로 다시 재면 33건 모두 답변 필요** |
| D4 | 법원 전자송달 통지 | «…보정명령등본이(가) 전자발송되었습니다» · «의견제출요청» · «기일변경명령» · «조정기일통지서» (scourt.go.kr) | 사람 메일·모르는 상대·요청 문장 없음 → 확인 권장. 기한이 있는 송달 |
| D5 | 확인 권장이 다른 시스템 알림으로 덮임 | platform_notice 137건(ws1 127) 중 PlanQ 알림은 ~10건. 나머지는 POS «Role request» 59 · PO 알림 · Plesk 29 | `isFromOurPlatform` 가 SMTP_FROM **도메인**(irenewp.com)으로 판정. help@irenewp.com 을 PlanQ·POS·Plesk 가 같이 쓴다. PlanQ 표식 헤더 없음 |

D3 나이 분포(연결 시점 기준 마지막 메일, 일:건) — 0:1 5:2 6:5 7:5 8:2 13:2 14:2 19:2 20:1 21:1 22:3 23:2 28:1 29:2 30:2 (14일 안 = 19건).

## 3. 시험안(D1·D2)과 시뮬 숫자
- D1: 사람 메일은 `relationVerdict`(우리 대화 회신·아는 상대)를 보안 기준보다 먼저 본다(수집·재판정 두 경로). 모르는 상대의 ④ 요청 판정 순서는 그대로.
- D2: inbound_action 에 «내 서명 차례» 낱말 8개(아래 패치). «서명 완료» 는 안 걸린다.
- 운영 2,199 스레드(400일) 옛/새 비교: **바뀌는 것 정확히 2건**(5015 → 답변 필요 · 4978 → 답변 필요), 그 밖 0건.

## 4. Fable 이 정할 것
- D1·D2 시험안 PASS?
- D3: 첫 동기화(받은·보낸 둘 다) 끝나면 그 계정 «읽기만» 스레드를 한 번 다시 재서, 마지막이 받은 메일 + 판정 답변 필요 + **14일 안** 만 올리는 안 — 창 길이? ws17 기존 33건은 운영 일회 실행(Irene 승인 필요) — 14일(19건) 또는 전부?
- D4: 송달(명령·요청·기일통지)을 답변 필요로(전 워크스페이스 공용 낱말) / 확인 권장 유지 / 학습·규칙에 맡김?
- D5: (a) 그대로 (b) platform_notice 기본 끔 (c) PlanQ 발송 메일에 표식 헤더를 달고 표식 있는 것만 platform_notice (d) 기타 — 옛 스레드 소급 방법 포함.

## 5. 시험안 패치 (판정 PASS 면 `git apply`)
```diff
diff --git a/dev-backend/services/emailTriage.js b/dev-backend/services/emailTriage.js
index 00b88793..8ddb84bf 100644
--- a/dev-backend/services/emailTriage.js
+++ b/dev-backend/services/emailTriage.js
@@ -422,6 +422,13 @@ function replyVerdict({ subject, bodyText, fromEmail, headers, ownEmails, ownMat
     ? { ok: true, criterion: 'direct_request' } : no('unclear_intent');
 }
 
+/** 관계로 답변 필요가 되는가 — replyVerdict 가 thread_reply·known_contact 로 참일 때만 그 기준 id, 아니면 null.
+ *  보안 알림보다 먼저 보는 데 쓴다(관계 없는 ④ direct_request 는 종전 순서 그대로). */
+function relationVerdict(args) {
+  const v = replyVerdict(args);
+  return v.ok && (v.criterion === 'thread_reply' || v.criterion === 'known_contact') ? v.criterion : null;
+}
+
 /** 답변 필요인가(참/거짓) — replyVerdict 의 얇은 껍데기. 기존 호출부 호환. */
 function needsReply(args) {
   return replyVerdict(args).ok;
@@ -559,6 +566,14 @@ function triageInbound({ subject, bodyText, fromEmail, headers, ownEmails, ownMa
   //   triage 로 게이트하면 대상 대부분을 놓친다(SECURITY_CODE 주석의 실측).
   //   답장할 상대는 없으니 답변 필요는 아니다 — human 경로에서 본문 상투구("요청이 아니라면")가
   //   요청 문장으로 잡혀 답변 필요로 오승격되던 것도 여기서 같이 막힌다.
+  // ★ 2026-10-22 — 사람 메일의 **관계**(우리 대화에 온 회신·아는 상대)는 보안 알림보다 먼저 본다.
+  //   우리 서명 요청 메일에 거래처가 «수정 요청 드립니다» 로 답했는데, 인용된 원문의 안내 문구가 보안 기준에 걸려
+  //   확인 권장으로 갔다(운영 5015, Irene: "내 메일도 서명요청에 대한 요청내용 왔는데 이게 확인권장이야").
+  //   보안 우선 순서의 이유(모르는 상대 본문의 «요청이 아니라면» 상투구가 ④ 로 올라가는 것)는 관계 없는 메일에만 해당한다.
+  if (triage === 'human' && c.status === 'open') {
+    const rel = relationVerdict({ subject, bodyText, fromEmail, headers, ownEmails, ownMatcher, isKnownContact: known, off });
+    if (rel) return out('open', true, c.uncertain_reason, rel);
+  }
   if (c.status === 'open' && on('security_code') && isSecurityNotice(subject, bodyText)) {
     return out('uncertain', false, 'security_code', 'security_code');
   }
@@ -651,6 +666,11 @@ function retriageStored({ triage, subject, bodyText, fromEmail, headers, ownEmai
   }
 
   // 로그인·인증 코드 — triage 무관 승격(triageInbound 와 같은 규칙. 두 경로가 갈라지면 안 된다).
+  // 사람 메일의 관계 — triageInbound 와 같은 자리(보안 알림보다 먼저).
+  if (triage === 'human' && !hasAdPrefix(subject)) {
+    const rel = relationVerdict({ subject, bodyText, fromEmail, headers, ownEmails, ownMatcher, isKnownContact: known, off });
+    if (rel) return { triage, status: 'open', reply_needed: true, uncertain_reason: null, criterion: rel };
+  }
   if (on('security_code') && isSecurityNotice(subject, bodyText)) {
     return { triage, status: 'uncertain', reply_needed: false, uncertain_reason: 'security_code', criterion: 'security_code' };
   }
@@ -771,6 +791,7 @@ module.exports = {
   triageBodyOf,
   needsReply,
   replyVerdict,
+  relationVerdict,
   isAutoAck,
   isInboundAction,
   isScheduleNotice,
diff --git a/dev-backend/services/mailCriteriaCatalog.js b/dev-backend/services/mailCriteriaCatalog.js
index adfceb05..fd6df12c 100644
--- a/dev-backend/services/mailCriteriaCatalog.js
+++ b/dev-backend/services/mailCriteriaCatalog.js
@@ -152,6 +152,13 @@ const TERMS = {
     '(문의|예약|신청|주문|상담|견적|리뷰|후기)(이|가)?\\s*(접수|등록|도착|들어왔)',
     '답변이\\s*(등록|도착|달렸)', '문의하신 내용에 답변', '회신이?\\s*도착',
     '님이\\s*(답변|회신|메시지|댓글|문의)',
+    // 2026-10-22 — 내 서명을 기다리는 전자서명 요청(모두싸인·DocuSign 등). 우리가 움직여야 끝나는 일이다.
+    //   Irene: *"서명요청에 대한 요청내용 왔는데 이게 확인권장이야"* (운영 4978 모두싸인 «… 서명할 차례입니다» → 확인 권장이었다).
+    //   «서명 완료» 같은 결과 통지는 넣지 않는다(automated_relevant 가 확인 권장으로 둔다).
+    '\\[서명\\s*요청\\]', '서명할\\s*차례', '님이[\\s\\S]{0,60}서명을?\\s*요청',
+    '\\b(please|kindly) (review and )?(docu)?sign\\b', '\\b(waiting|awaiting) (for )?your signature\\b',
+    '\\b(invited|requested) you to (review and )?sign\\b', '\\bsent you a document to (review and )?sign\\b',
+    '\\byour signature is (requested|required)\\b',
   ],
   // 2026-10-16 — 일정이 잡혔다·바뀌었다는 안내(예약 확정·리마인더·변경·취소). 답장할 상대는 없지만 날짜가 박힌 약속이다.
   //   Irene: *"스케줄 제대로 예약된 안내인데 확인권장에도 안나오고 답변필요에도 안나와. 이런 미스는 너무 커"*
```

## 6. 구현·검증 (2026-10-22, [Opus])
- D1 패치 그대로 · D2 Fable 수정 낱말(sign in/up 제외 · «서명 요청 취소» 제외) · D5 표식 헤더(`emailService` → `X-PlanQ-Notice`, `TRIAGE_HEADER_KEYS` 저장, `isFromOurPlatform(from, headers, complete)`).
  ★ D5 폴백을 **한 가지 좁혔다**: 표식 전 옛 메일도 헤더가 저장돼 있으면 SMTP_FROM 정확 주소 **+ `X-Auto-Response-Suppress`** 일 때만 PlanQ 알림. 표식만 보면 옛 PlanQ 알림 «새 문의 #2» 4건이 재판정 때 inbound_action 으로 답변 필요에 올라갔다(시뮬). 운영 실측 — 그 헤더는 PlanQ 알림에만 있고 POS·Plesk·케어 경보엔 없다.
- D3 `mailRetriage.promoteBackfillReplies` + 동기화 자동 호출(받은편지함 또는 보낸편지함 첫 가져오기 뒤) + `scripts/promote-backfill-replies.js`.
- 운영 읽기 시뮬(400일, 2,164 스레드): 처음 재던 날(2,199) 대비 새로 바뀌는 것 **5015 한 건**(→ 답변 필요). 4978·기율 33건은 그사이 기율에서 «처리»(archived·handled)해 대상에서 빠졌다.
  ws17 일회 실행 미리보기(account 7 · 기준 10-21 08:33 · 14일): 재판정 9건 중 올릴 것 **0건** → 운영 일회 실행 불필요.
- dev 실DB(스레드 9460, 원복함): 창 안 → 대상 · 창 밖(+20일) → 아님 · 미리보기 쓰기 0 · 반영 → 답변 필요·이유 inbound · 마지막이 우리 답장 → 아님 = 5/5.
- 카나리 `--suite mail` 새 9건 포함 실패 0 · 옛 코드로 되돌린 대조군에서 새 검사 4건 FAIL(표식 없는 다른 시스템·같은 도메인 사람·인용문 보안 문구·서명 차례) · health-check 89/89 ·
  guard 실패 3건은 서명 기능 파일(signatures.js·signature_round.js·PublicSignPage.tsx — 다른 방 작업, 이번 변경 무관).
- D4: 코드 변경 없음. 기율 법원 송달 발신 주소가 법원마다 다르다(0x…ecfs@scourt.go.kr 5개) → 주소 학습이 아니라 **도메인 규칙** «scourt.go.kr → 항상 답변 필요» 가 맞다(설정 › 메일 규칙).
- 확인 못 함: 실제 발송 메일에 `X-PlanQ-Notice` 가 붙는지(dev 는 발송 정지) — 운영 배포 뒤 받은 PlanQ 알림 1통의 헤더로 확인.
