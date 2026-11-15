# 문의 인박스 — PlanQ 가 직접 회신 메일 보내고 기록 (2026-11-15)

> Irene 2026-11-15: «개발에 제대로 되게 할거야» — 문의 상세에서 회신을 써서 PlanQ 가 보내고, 보낸 회신이 그 문의 기록에 시간순으로 남는다. 여러 번 회신 가능.
> 주체: [Opus] 초안 → Fable 설계 판정 1회 · 완료 검증 1회.

## 0. 지금
- `/admin/inquiries` 상세의 [메일로 회신] = `mailto:` (관리자 메일 프로그램만 연다). PlanQ 는 안 보내고 기록도 없다.
- `contact_inquiries` 에는 `replied_at`·`replied_by_user_id`·`reply_note`(내부 노트) 뿐 — PATCH 가 노트를 저장할 때 `replied_at` 을 찍는다(=«마지막 처리» 시각, 실제 회신과 무관).
- 회신 초안 칸: `useDraftText('admin-inquiry-reply', id, 'platform')` + AI 초안 버튼(`POST …/ai-draft`, 저장·발송 없음).
- 플랫폼 메일 발송 문: `services/emailService.sendEmail` — EmailLog 1행(sent/failed/skipped) · dev 는 `EMAIL_SENDING_ENABLED=false` 라 skipped · 발신 `SMTP_FROM` · 모든 플랫폼 메일에 자동발송 헤더(`Auto-Submitted`, `X-Auto-Response-Suppress`, `X-PlanQ-Notice`) · 푸터 «발신 전용 · 회신은 받지 못합니다».

## 1. 새 표 `contact_inquiry_replies` (외부 발송 기록 — ops-backend 6)
| 칸 | 뜻 |
|---|---|
| id | PK |
| inquiry_id | FK contact_inquiries CASCADE |
| sent_by_user_id | FK users SET NULL — 보낸 관리자 |
| to_email | 실제 받는 주소(보낼 때 서버가 문의 행에서 읽은 값, 화면 값 아님) |
| subject | 보낸 제목 |
| body | 관리자가 쓴 본문 원문(텍스트, ≤10,000자) |
| locale | ko/en — 제목·고정 문구 언어 |
| status | ENUM `sending`·`sent`·`failed`·`skipped` |
| error_message | 실패·건너뜀 이유(≤1000) |
| sent_at | 성공 시각 |
| created_at/updated_at | |
색인 (inquiry_id, created_at) · (sent_by_user_id, created_at).
- EmailLog 와 별개(문의 쪽 이력). EmailLog 는 `template='inquiry_reply'`, `related_entity_type='inquiry_reply'`, `related_entity_id=reply.id`, `initiated_by=관리자`.
- 운영: `scripts/migrate-inquiry-replies.js`(멱등 — 표·FK 확인, 배포 슬롯 sync 뒤 reload 앞).

## 2. 서버 — `services/inquiryReply.sendInquiryReply` 한 문
`POST /api/inquiries/admin/:id/replies` (authenticateToken + requireRole('platform_admin') + 한도) body `{ body }`
1. 문의 없음 404 · `status='spam'` 409 `inquiry_spam` · 본문 trim 1~10,000자 아니면 400 · 받는 주소 형식 불량 400.
2. **중복 방지**: 같은 문의에 같은 본문이 `sending`/`sent` 로 60초 안에 있으면 409 `duplicate_reply` (두 번 누름·재시도 겹침).
3. 행 생성 `status='sending'` → `emailService.sendEmailDetailed`(새 함수 — sendEmail 과 같은 몸통이 `{status, error}` 를 돌려주게 나누고, 기존 `sendEmail` 은 그것의 bool 래퍼) 호출 → 결과로 행 갱신(sent: sent_at / failed·skipped: error_message).
4. 성공(sent)이면 `contact_inquiries.replied_at=now, replied_by_user_id=관리자` · 상태 `new` 이면 `in_progress` 로(보낸 뒤 «새 문의» 탭에 남지 않게). 해결 처리는 관리자가 정한다(자동 resolved 안 함).
   skipped(dev·차단 주소)·failed 는 문의 상태·replied_at 을 바꾸지 않는다.
5. 감사 `writeAudit` action `inquiry.reply_send` target `contact_inquiry` (new_value: reply_id·status·to_email·글자 수 — 본문 원문은 감사에 안 싣는다, 표에 있다).
6. 응답: 회신 행(본문 포함) + 갱신된 문의 상태. 실패도 **200 + status:failed + error** (기록은 남았으므로) — 화면이 이유를 보인다.
- `GET /api/inquiries/admin/:id/replies` — 시간순(오래된 → 최근), 보낸 사람 이름(관리자 계정 이름 — 플랫폼 관리자 화면 전용이라 표시명 계약 대상 아님).
- `sending` 으로 5분 넘게 남은 행(서버가 중간에 죽음)은 읽을 때 `failed`·`interrupted` 로 보이게 한다(행은 그대로, 화면 표시만 — 다시 보내기는 관리자가 판단).
- 한도: `perUserLimiter('inquiry-reply', 분 5)` + `perUserDaily('inquiry-reply', 일 50)` (관리자당). 같은 문의당 하루 10통(서버 count).

### 메일 모양 (`emailService.sendInquiryReplyEmail`)
- 제목: ko `[PlanQ] 문의 #<id> 답변드립니다` / en `[PlanQ] Re: your inquiry #<id>`.
- 본문: 인사 없이 관리자 글을 그대로(escape + 줄바꿈 보존) → 고정 서명 «PlanQ 운영팀 / PlanQ Support» → 회색 인용 «보내 주신 문의(<접수일>)» 원문 앞 800자.
- **사람이 쓴 답이므로 자동발송 헤더를 붙이지 않는다**(`Auto-Submitted` 등 — 받는 쪽이 회신을 막거나 자동 메일로 분류). `sendEmailDetailed({ humanReply: true })` 가 헤더 세 개를 뺀다.
- **회신 받는 주소**: `replyTo = 플랫폼 supportEmail`(platform_settings.support_email, 기본 help@planq.kr). 푸터는 «발신 전용» 대신 «이 메일에 회신하시면 PlanQ 운영팀이 받습니다» (`footerOptions.replyable`).
- 받는 주소는 문의 행의 `from_email` 하나뿐 — 화면에서 바꿀 수 없다(임의 주소 발송 문을 만들지 않는다).

## 3. 화면 — `AdminInquiriesPage` 상세
- «회신 초안» 칸 → 이름 «회신» 칸으로 이어 쓴다(초안 보존·AI 초안 그대로).
- 칸 아래 [PlanQ 에서 보내기] (Primary 톤 아님 — 푸터의 [저장] 이 Primary. 회신 칸 바로 아래 Secondary) · [복사] 유지 · 옛 [메일로 회신](mailto) 은 뺀다(두 문이면 기록이 갈린다).
  - 본문 비면 비활성. 스팸 상태면 비활성 + 이유 «스팸으로 표시된 문의에는 보낼 수 없어요».
- 누르면 `ConfirmDialog`: «<from_email> 로 이 회신을 보냅니다. 보낸 뒤에는 되돌릴 수 없어요.» (받는 주소를 문구에) → 확인 시 POST, submitting 가드.
- 결과: sent → 초안 비움 + 기록에 추가 · failed/skipped → 초안 유지 + 기록에 «보내지 못함: <이유>»(skipped dev 는 «이 서버는 메일 발송이 꺼져 있어요»).
- «보낸 회신» 절(시간순): 줄마다 시각 · 보낸 사람 · 받는 주소 · 상태 칩(보냄/실패/보내지 않음/보내는 중) · 본문(접힘 4줄, 누르면 전체).
- 목록 행: 회신 수 «회신 n» 꼬리표(GET 목록에 `reply_count` 하나 — 서브쿼리).
- 실시간: 플랫폼 관리자 화면 — 다른 관리자 동시 작업은 드묾. 상세를 열 때·보낸 뒤 다시 읽는다(새 소켓 사건은 만들지 않음, 비차단으로 적음).
- ko/en 새 키 `common:adminInq.reply.*`.

## 4. 검증 계획(자체)
- 실호출: 로그인(admin) → POST 회신 → 행 status skipped(dev) · EmailLog 1행 related_entity 일치 · 감사 1행 · GET 시간순 2건(두 번 보내기) · 같은 본문 60초 409 · 스팸 409 · 빈 본문 400 · 비관리자 403 · 문의 상태 new 유지(skipped) .
- 발송 성공 경로: `sendEmailDetailed` 를 시험 안에서 sent 로 바꿔(전송 객체 교체) sent → replied_at·in_progress 전이 확인.
- 메일 HTML: 헤더(Auto-Submitted 없음·replyTo)·escape(`<script>` 본문) 검사.
- 화면: 3폭 — 보내기 버튼·확인창 주소·기록 줄 · 실패 이유 표시.

## Fable 판정 받을 것
A. 표 분리 vs EmailLog 만 쓰기 · B. 성공 시 new→in_progress 자동 · C. 자동발송 헤더 빼기 + replyTo support (자기 오염: 고객 회신이 Q mail 로 수집될 때의 분류) · D. 실패도 200 · E. 받는 주소 고정 · F. 한도 값.

## Fable 설계 판정 (2026-11-15) — DESIGN: FIX → 아래 6건 반영해 구현
1. 문의 행 `FOR UPDATE` 트랜잭션 안에서 스팸·60초 같은 본문·문의당 하루 10통(sending+sent) 검사 + `sending` 행 생성 → 커밋 → SMTP 는 트랜잭션 밖.
2. 5분 넘은 `sending` 은 «실패» 가 아니라 **«결과 확인 안 됨 — 보내졌을 수 있어요»**(표시 상태 `unknown`) · 그 문의에 이런 행이 있으면 다시 보낼 때 확인창에 경고.
3. 발송은 `contact_inquiries.replied_at`/`replied_by_user_id` 를 건드리지 않는다(노트 저장이 덮는 칸) — 목록 «회신함» 은 replies 표에서(`reply_count`·`last_reply_sent_at`).
4. new→in_progress 는 `UPDATE … WHERE id=? AND status='new'` 조건부.
5. 자동발송 헤더 빼기는 공용 인자로 열지 않는다 — `sendEmail` 래퍼는 bool 그대로·인자 그대로, 헤더 없는 경로는 `sendInquiryReplyEmail` 안에서만 닿는 내부 함수. 대조군: 기존 템플릿 헤더 셋 그대로 + bool / 회신 메일 헤더 셋 없음 + replyTo.
6. 성공 경로 시험은 시험 프로세스 안에서만 `EMAIL_SENDING_ENABLED` 를 켜고 가짜 전송 객체 주입 · 실제 SMTP 호출 0 단언 · dev 서버 .env 는 안 바꿈.
비차단 반영: 인용 escape · 확인창에 이름+주소 · 한도 미들웨어는 authenticateToken 뒤 · 푸터 «발신 전용» 두 곳 모두 replyable 로 · 마이그레이션 배포 슬롯 · Reply-To(help@planq.kr) 실제 수신 여부는 운영 확인 필요(확인 못 함).
