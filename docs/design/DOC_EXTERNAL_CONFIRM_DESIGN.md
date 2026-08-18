# #239 문서 외부 컨펌 — 설계 (Fable 판정, 2026-08-18)

> Irene 원문: *"문서를 서명처럼 컨펌기능을 추가해줘. 그냥 확인했다. 아니면 의견 남기게. 웹미리보기에서.
> 이게 필요한 이유는 굳이 내부로 유저로 들어오지 않고 업무처리 하게."*
>
> 판단 주체: Fable. 대상: `signature_requests` 확장 (kind='confirm'). 3단 게이트 대상(공개 라우트 신설).
> 관련: `docs/design/B2B_AGENCY_FIT_REVIEW.md` §3-3 (#239·#271·#273), `docs/Q_BILL_SIGNATURE_DESIGN.md` (Phase A).

---

## 판단 A — 인증 수위: **A3 (수신자 지정 링크 = 신원, OTP 없음)**

**결정**: 확인 요청은 서명과 같은 **사람별 토큰**(signature_requests 재사용)으로 발행하되,
**OTP 는 요구하지 않는다**. 링크(64-hex, 256bit)가 곧 신원이다. 확인 시 IP/UA/시각을 박제한다.
무거운 확인이 필요하면 기존 **서명 요청**(OTP+캔버스)을 쓰면 된다 — **A4(요청자 선택)는 이미 제품에
존재하는 셈**이다. 발행 모달에서 "확인 요청 / 서명 요청" 을 고르는 것이 그 선택이다.

**근거**:
- 신원 없는 공개 share 링크(A2, `/public/posts/:token`)에 확인 버튼을 달면 **전달받은 누구나**
  '확인함'을 누를 수 있다. 확인은 대행 업무에서 검수 완료 신호이고 그 뒤에 청구가 붙는다
  (`B2B_AGENCY_FIT_REVIEW.md` §1, §3-3) — 위조 가능한 확인은 만들지 않는다.
- 반대로 OTP(A1)를 확인에까지 걸면 Irene 이 원한 가벼움("굳이 내부로 들어오지 않고")이 죽는다.
- 사람별 토큰은 이메일 수신함과 동일한 신뢰 수준 — 대행업계가 지금 하는 "메일로 '확인했습니다' 회신"과
  같은 무게이며, 그보다 낫다(시각·IP·UA·본문 스냅샷 시점이 남는다).
- 인프라 전부 기존: 토큰 발급·만료·멱등 재발송·수신함 표시(`routes/signatures.js:104-236`,
  `routes/dashboard.js:471` 내가 받은 요청), 공개 페이지(`PublicSignPage.tsx`).
- "웹미리보기에서" = 화면 요구다. `/sign/:token` 페이지가 이미 문서 본문 전체를 렌더한다
  (`GET /api/sign/:token` 이 `content_json` 반환, `routes/signatures.js:333-368`) — 확인용 뷰도 같은
  표면을 쓴다. 기존 공개 share 링크(`/public/posts/:token`)에는 **아무것도 붙이지 않는다**.

**리스크**: 링크 전달 시 대리 확인 가능. 수용 — 서명이라는 상위 수단이 있고, 확인 레코드에
signer_email(발행 시 지정)·IP·UA 가 남아 분쟁 시 추적 가능. OTP 옵션 추가는 후속(요청 오면).

---

## 판단 B — 데이터 모델: **signature_requests 확장 (kind 컬럼). 새 테이블 없음**

**결정**: `signature_requests` 에 4컬럼 추가 + status ENUM 2값 추가.

```sql
-- 운영 ALTER (additive only — MySQL 8 즉시 적용, 온라인 안전. sync-database 로도 가능하나 수동 정본)
ALTER TABLE signature_requests
  ADD COLUMN kind ENUM('sign','confirm') NOT NULL DEFAULT 'sign' AFTER entity_id,
  ADD COLUMN confirmed_at DATETIME NULL,
  ADD COLUMN comment TEXT NULL,
  ADD COLUMN comment_at DATETIME NULL,
  MODIFY COLUMN status ENUM('pending','sent','viewed','signed','rejected','expired','canceled',
                            'confirmed','commented') NOT NULL DEFAULT 'pending';
```

- 신규 인덱스 불필요 (기존 `token` unique, `(business_id,status)` 등 5개로 충분 —
  sync-alter 64키 한도 무관).
- 백필 불필요: 기존 row 는 DEFAULT 'sign' 이 정확한 의미다.
- ENUM 값은 **끝에만 추가** (기존 값 순서 불변 — 안전).

**근거**:
- 확인과 서명은 필드의 90%가 동일하다: 사람별 토큰, signer_email, 만료(14일), viewed 추적,
  business_id 격리, 멱등 재발송, reminder, 수신함/받은 목록 노출. 별도 테이블은 "같은 값의 여러 벌"
  (memory `feedback_same_value_multiple_formulas`) — 목록·수신함·만료·취소 로직이 두 벌로 갈라진다.
- 의미가 다른 부분은 kind 축 하나로 정확히 표현된다. `entity_type` polymorphic 이 이미 같은 패턴.
- lifecycle (kind='confirm'): `pending→sent→viewed→{confirmed | commented}` + `expired/canceled`.
  `commented` 는 비종결 — 이후 `confirmed` 로 전이 가능(의견 남겼다가 나중에 확인).
  `confirmed` 는 종결 — 이후 comment/confirm 409.
- 만료: 모델 주석의 "00:30 cron" 은 **실존하지 않는다**(전 코드 grep 0건) — 실제로는
  `GET /api/sign/:token` 진입 시 lazy 만료 처리(`routes/signatures.js:337-341`). confirm 도 같은
  경로를 그대로 탄다. 신규 cron 없음. (모델 주석은 이번에 사실대로 수정.)

**리스크**: `projectStageEngine.js:342` `allSigned = sigs.every(s.status==='signed')` — 계약 post 에
confirm row 가 섞이면 **contract stage 가 영영 완료 안 되는 회귀**. 해결: stage engine 의
SignatureRequest 조회 2곳(`:96`, `:338`)에 `kind:'sign'` WHERE 추가 (절단면에 포함, 필수).
같은 이유로 `routes/projects.js:1959` transactions 집계엔 kind 를 응답에 실어 프론트가 배지 구분.

---

## 판단 C — 의견 저장·전달: **request row 의 comment 필드 + AuditLog 전문 + notify/socket**

**결정**:
- 의견은 `signature_requests.comment`(TEXT, 2000자 캡) + `comment_at` 에 저장 — **"현재 의견" 1건**.
  재제출 시 덮어쓰되, 매 제출이 ① AuditLog(`signature.comment`, metadata 에 전문) ② notifyMany 로
  흘러나가므로 이력은 감사로그·알림에 남는다. 왕복 이력의 정식 구조는 #271(버전 왕복)의 몫 —
  여기서 미리 만들지 않는다.
- post 댓글 테이블은 **없고**(posts 에 댓글 모델 부재), task_comments 는 엔티티가 다르다 — 억지 재사용 금지.
- 워크스페이스 인지 경로 (§13·§16 준수, 기존 서명과 동일 배선):
  1. `notifyWorkspaceMembersOnSignature` 확장(`routes/signatures.js:441-467`) — kind
     'confirmed'/'commented' 문구 추가. eventKind 는 기존 `'signature'` 재사용
     (`routes/notifications.js:14` ENUM 에 실존 — pref 스키마 무변경).
  2. `io.to('business:${business_id}').emit('inbox:refresh', { reason: 'signature_confirmed'|'signature_commented', ... })`
     — sign/reject 와 동일 패턴(`routes/signatures.js:409-410`).
  3. 문서 상세 진행 패널(GET `/api/posts/:id/signatures`)에 comment/confirmed_at 노출.
  4. dashboard "서명 거절" 위젯(`routes/dashboard.js:514`)을 "외부 응답" 위젯으로 확장 —
     `status IN ('rejected','commented')` (의견 = 조치 필요 신호).

**리스크**: comment 덮어쓰기로 UI 상 직전 의견이 사라짐 — 수용(감사로그·알림에 잔존). 확인 후
의견 추가 불가(409) — 재요청(멱등 재발송이 새 라운드) 으로 해소.

---

## 판단 D — 1차 범위·절단면·#271 관계

**1차 범위 (이번 사이클)**:
- entity_type **'post' 만** (document 는 legacy — 서명도 post 만 활성, `SignatureRequest.js:3`).
- 발행: PostSignatureModal 에 "확인 요청 | 서명 요청" 세그먼트 (kind 전달). 발행 라우트는 기존
  `POST /api/posts/:id/signatures` 에 `body.kind` 추가 (신규 라우트 아님 — 멱등 조회에 kind 조건 추가).
- 공개 액션 2개 신설: `POST /api/sign/:token/confirm`, `POST /api/sign/:token/comment`.
- 공개 페이지: PublicSignPage 가 `kind==='confirm'` 이면 ConfirmView 렌더 (OTP·캔버스 없음.
  [확인했습니다] + 의견 textarea + [의견만 보내기]).
- 범위 외: 공개 share 링크(/public/posts)에 확인 붙이기(위조 축), 대화방 카드 자동 후속 메시지,
  OTP 옵션, document/task entity, 의견 스레드.

**공개 라우트 안전장치 (fail-closed)**:
- **kind 가드 양방향**: `/otp`,`/verify`,`/sign`,`/reject` 는 `kind==='sign'` 만 (아니면 400
  `wrong_kind`) / `/confirm`,`/comment` 는 `kind==='confirm'` 만. 옛 row 는 DEFAULT 'sign' → 기존
  플로우 무변화.
- **rate-limit**: confirm/comment 에 token+IP 키 limiter (기존 otpVerifyLimiter 패턴,
  `routes/signatures.js:88-96`) — 5분 10회. 발행측은 기존 인증 라우트라 기존 가드 유지.
- **입력 캡**: comment 2000자, signer_name 100자 (slice, 초과시 400 아님 — 서명 reject reason 500자
  slice 패턴과 동일하되 명시 캡 초과는 400).
- **킬스위치**: `FEATURE_DOC_CONFIRM=off` env 검사 시 두 공개 POST 503 `feature_disabled` +
  발행 모달 세그먼트 숨김(GET /api/sign/:token 응답에 feature flag 불요 — 발행 자체가 안 되므로).
- 상태 가드: expired/canceled 410·400, confirmed 재호출 409 (기존 sign 라우트 패턴 그대로).

**#271(결과물 버전 왕복)과의 관계**:
- **별건 유지가 맞다.** #239 는 **문서(post)** 의 외부 확인, #271 은 **업무 결과물(body)** 의 버전
  왕복이다. 저장 축(post vs task), 발행 주체(문서 작성자 vs 담당자), 종결 의미(문서 승인 vs 검수
  라운드)가 다르다.
- 접점 설계만 박제: task 의 `external_review` 상태(#206·#273, `TaskDetailDrawer.tsx:1767`)는 현재
  수동 해제다. #271 구현 시 "버전 vN 을 외부 확인으로 보냄" 이 **이번에 만드는 confirm 발행을
  재사용**한다 — `entity_type` ENUM 에 값을 추가하는 것으로 충분하도록, 이번 구현에서 라우트를
  entity_type 하드코딩 없이 유지(loadEntity 스위치 확장만으로 되게). 지금 두 기능을 잇지 않는다.
- 사용자 어휘 충돌 방지: 문서 쪽 라벨은 **"확인 요청"**, 업무 쪽(external_review)은 기존
  "외부 컨펌" 유지. i18n 키 분리(qdocs vs qtask).

---

## 구현 절단면

| 파일 | 무엇을 | 규모 |
|---|---|---|
| `dev-backend/models/SignatureRequest.js` | kind/confirmed_at/comment/comment_at + status ENUM 2값 + 주석 갱신(cron 허구 제거) | 소 |
| `dev-backend/routes/signatures.js` | 발행 body.kind + 멱등조회 kind 조건 + 이메일 kind 문구 + GET /sign/:token 응답 kind·comment + **신규 POST /confirm·/comment** (limiter·캡·킬스위치·kind 가드 양방향) + notifyWorkspaceMembersOnSignature kind 확장 + serializer 4필드 | 중 (~180줄) |
| `dev-backend/services/projectStageEngine.js` | SignatureRequest 조회 2곳(`:96`,`:338`) `kind:'sign'` 필터 — **회귀 차단 필수** | 소 |
| `dev-backend/routes/projects.js` | `:1959` sig 집계 attributes 에 kind 추가 | 소 |
| `dev-backend/routes/dashboard.js` | `:471` 받은 요청 attributes 에 kind / `:514` 위젯 `commented` 포함 | 소 |
| `dev-backend/services/emailService.js` | sendSignatureRequestEmail kind 파라미터 (확인용 제목·CTA 문구) | 소 |
| `dev-frontend/src/components/Docs/PostSignatureModal.tsx` | kind 세그먼트 + POST body + 진행 목록 kind 배지·comment 표시 | 중 |
| `dev-frontend/src/pages/QDocs/PublicSignPage.tsx` | kind 분기 — ConfirmView (확인 버튼 + 의견, OTP·캔버스 경로 미진입) | 중 |
| `dev-frontend/src/pages/Todo/TodoPage.tsx` · `Signatures/ReceivedSignaturesList.tsx` | 받은 요청 kind 라벨("확인 요청") | 소 |
| `dev-frontend/public/locales/{ko,en}/qdocs.json` | confirm 네임스페이스 키 (ko/en 동시) | 소 |
| 운영 마이그레이션 | **`scripts/migrate-doc-external-confirm.js` 가 정본** (멱등, 배포 스크립트 자동 실행). 수동 ALTER 아님 — Fable 판정 2026-08-18 | — |
| 롤백 정책 | **코드만 revert. 컬럼·ENUM 은 남긴다.** 축소 SQL 을 만들지 않는다(confirmed/commented 행이 생긴 뒤엔 데이터를 자른다). ⚠️ `models/SignatureRequest.js` 의 컬럼 선언은 **revert 금지** — sync alter 가 모델에 없는 컬럼을 DROP 한다 | — |

**게이트**: 공개 라우트 신설 = 고위험 5호(보안 경계). 설계(본 문서)→구현→배포 3단 전부 Fable.

---

## 검증 계획 (구현 후 — 실 HTTP 로 증명)

정상 경로:
1. login → `POST /api/posts/:id/signatures {kind:'confirm', signers:[{email}]}` → row kind='confirm',
   dev 콘솔에 `/sign/:token` URL.
2. **무인증** `GET /api/sign/:token` → kind·본문 content_json 반환, status sent→viewed.
3. **무인증** `POST /sign/:token/comment {comment:'문구 수정 요망'}` → 200, status='commented',
   comment 저장. 재조회로 값 일치.
4. **무인증** `POST /sign/:token/confirm {comment:'확인'}` → 200, status='confirmed', confirmed_at·IP·UA 박제.
5. notify: 4 직후 sleep 3s → `notifications`/`push_logs` 에 워크스페이스 멤버 row ≥1
   (memory `feedback_notify_trigger_required`). `GET /api/posts/:id/signatures` 에 comment·confirmed_at 노출.

위조 반증 (막혀야 함):
6. 임의 64-hex 토큰 → 404. 짧은/긴 토큰 → 404.
7. **kind 교차**: sign 토큰에 `/confirm` → 400 wrong_kind. confirm 토큰에 `/sign`·`/otp` → 400.
8. confirmed 후 `/confirm`·`/comment` 재호출 → 409. canceled/expired 토큰 → 410·400.
9. comment 2001자 → 400. rate-limit: 같은 token+IP 11회/5분 → 429.
10. 공개 share 링크(`/public/posts/:token`) 표면에 확인 API 없음 — PublicPostPage 무변경 diff 확인.
11. `FEATURE_DOC_CONFIRM=off` 로 재시작 → confirm/comment 503.

정상 사용자 반증 (막히면 안 됨):
12. OTP 없이 3·4 가 성공한다 (가벼움 보장 — confirm 경로에 otp_required 없음).
13. **옛 데이터 sample**: kind 컬럼 없던 기존 서명 row 1건(운영 패턴) → GET /sign/:token 기존 OTP→서명
    플로우 그대로 완주, serializer kind='sign'.
14. 멀티테넌트: 타 워크스페이스 멤버가 `GET /api/posts/:id/signatures` → 403.
15. **stage 회귀**: 계약 post 에 sign(signed) + confirm(confirmed) 공존 → contract stage 가
    'completed' 로 정상 전이 (confirm row 가 allSigned 판정을 오염시키지 않음 — projectStageEngine kind 필터 증명).
16. 빌드: `npm run build` EXIT 0 별도 파일 박제 + `node scripts/guard-invariants.js --category=i18n,parity`.
