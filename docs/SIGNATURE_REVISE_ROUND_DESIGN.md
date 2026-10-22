# 서명 요청 뒤 문서 고치기 — «회차 닫기» 설계 초안 (2026-10-22, [Opus] · Fable 설계 판정 대상)

## 0. 원문
- Irene: *"나만 서명했는데 고객이 수정요청하면 수정할 수 있어? 보내는 사람 서명 말고 다른 사람 서명 전에는 문서 수정 가능하지? 이후는 안되는 거고."*
- 질문 ② 에 *"권고대로 진행해 줘"* — 권고: 수정 요청이 오면 같은 문서에서 고쳐 다시 보낸다. 우리 서명은 고친 본문에 다시 받는다.

## 1. 지금 사실 (코드)
| 무엇 | 어디 | 동작 |
|---|---|---|
| 본문 잠금 | `services/signatureCore.isPostSignatureLocked` | kind=sign 이고 status ∈ pending·sent·viewed·**signed** 인 행이 하나라도 있으면 잠김. 아무도 서명 안 해도 요청 즉시 잠김 |
| 취소 | `DELETE /api/signatures/:id` | signed·rejected 는 400 `already_finalized` |
| 고객 «수정 요청» | `POST /api/sign/:token/reject` (사유 500자) | 그 행만 rejected. 다른 행 그대로 |
| 서명 회차 | `services/signedDocument.signRoundWhere` | kind=sign ∧ status ≠ canceled — **회차 경계가 없다**(그 문서의 모든 옛 행) |
| 고정본 | `loadSignedView` | 회차 안에서 **가장 먼저 만든 행**의 content_snapshot |
| 재요청 | `POST /posts/:id/signatures` | 같은 이메일의 pending/sent/viewed 만 재사용, 그 밖은 새 행(새 동결) |

**결과**
- (A) 우리 쪽(us)이 서명 → 고객 거절: us 행 signed 가 남아 **영영 잠김**. 취소도 못 함. 복사본으로만 다시 보낼 수 있다.
- (B) 아무도 서명 안 함 → 고객 거절: 잠금은 풀림(rejected 는 잠금 목록 밖). 고쳐서 다시 요청하면 새 행이 생기지만
  회차에 옛 rejected 행이 그대로 남아 **고정본 = 옛 행(가장 작은 id)의 본문** → 서명본·PDF·서명자 화면이 «고치기 전 본문» 으로 그려질 수 있다(코드상 — 실측 전). 진행 «N명 중 M명» 도 옛 행을 센다.
- (C) 아무도 서명 안 함 + 고객도 아직: [모두 취소] 하면 풀림(지금도 가능, 화면 문구 있음).

## 1-b. «수정 요청» 흐름 실측 (2026-10-22, dev 실HTTP · 문서 4386 «[확인용] 서명 수정요청 흐름» ws 6)
Irene 추가 지시: *"수정요청도 들어오고 하게 잘 프로세스 점검해줘."*
순서: 멤버(이디자, uid 16)가 서명 요청(우리 칸 1 + 고객 칸 2) 200 → 우리 서명 200 → 고객 거절(사유 «3조 금액 수정 부탁드립니다») 200.
| 확인 | 결과 |
|---|---|
| 그 뒤 본문 고치기 PUT | **409 post_locked_by_signature** |
| 우리 서명 취소 DELETE | **400 already_finalized** → 고칠 길 없음(1절 A 실측 확인) |
| 알림 | 워크스페이스 7명에게 «서명 거절됨» — **요청을 보낸 본인(uid 16)은 0건** (`notifyWorkspaceMembersOnSignature` 의 `excludeUserId = requester` — «자기 행동이라 제외» 인데 행동한 것은 고객이다. 서명 완료 알림도 같다) |
| 알림 내용 | «최고객 님이 서명을 거절했습니다 · 문서: …» — **사유가 없다**. 무엇을 고치라는지 문서를 열어야 안다 |
| 확인 필요 | owner 에게만 뜬다(`dashboard.js` owner/admin 분기). **요청한 멤버에게는 안 뜬다** |
| 고객 화면 | 버튼은 «거절» 하나, 사유는 선택, 안내는 «의견은 별도로 회신해 주세요» — **«수정 요청» 이라는 길이 없다** |

### 더 판정 받을 것
- **D8 고객 화면에 «수정 요청»** — «거절» 옆(또는 대신) «수정 요청»: 사유 필수, 안내 «보낸 분이 고쳐서 다시 보내 드립니다». 저장은 같은 rejected + 구분 칸(`reject_kind` revise|decline)? 아니면 거절을 «수정 요청» 으로 이름만 바꾸고 사유 필수? (공개 표면 문구·계약 변경)
- **D9 알림 받는 사람** — 서명·거절·확인 사건은 **요청자 포함**(제외할 사람 없음 — 행동자는 외부). 우리 쪽(us) 로그인 서명만 행동자 본인 제외.
- **D10 알림·확인 필요에 사유** — 알림 본문에 사유 첫 줄(예: 80자) · 확인 필요 «수정 요청» 항목을 owner/admin 외 **요청자에게도**(한 업무 = 한 버킷 원칙처럼 한 사람에게 한 번).
- 이 넷과 D1~D7 을 한 번에 판정한다(쪼개 올리지 않는다).

## 2. 제안 (판정 받을 것)
**회차를 명시적으로 닫는다.** 닫힌 회차의 행은 기록으로만 남고 잠금·서명본·진행·거래 단계·급여 계약·확인필요 어디에도 세지 않는다.

- **D1 닫는 표시** — `signature_requests.status` ENUM 끝에 `superseded` append(운영 `migrate-…` 배포 슬롯) + `superseded_at`.
  (대안: 칸만 추가하고 status 유지 — 증거(signed) 의미는 보존되나 status 를 읽는 12곳이 전부 새 칸을 봐야 한다.
  ENUM 이면 화이트리스트로 읽는 곳(잠금·확인필요·insights·cue·request-link)은 자동으로 빠지고, 블랙리스트로 읽는 곳만 고친다:
  signRoundWhere · payrollContracts live · projectStageEngine allSigned · projects.js 거래 탭 · 화면 visible.)
  ★ signed 행의 서명 이미지·시각·IP·해시는 지우지 않는다(감사 증거). status 만 superseded.
- **D2 언제 닫나 — 사람이 누른다** «고쳐서 다시 보내기» (문서 서명 진행 칸 · 문서 편집 잠금 안내 옆).
  누를 수 있는 때: 회차에 **받는 쪽(them) signed 가 0** (= Irene «다른 사람 서명 전에는 수정 가능»).
  거절 유무와 무관(거절이 오면 강조해서 보여 준다). them 이 한 명이라도 서명했으면 버튼 없음 → 지금처럼 복사본으로.
  자동(고객 거절 순간 자동 닫기)은 하지 않는다 — 다른 서명자가 아직 진행 중일 수 있고, 닫히는 순간 그들의 링크가 죽는다.
- **D3 닫을 때 하는 일** (한 트랜잭션, `services/signatureCore.closeRound` 한 문):
  열린 행(pending·sent·viewed) → canceled(링크 즉시 만료, 지금 취소와 같음) · us signed → superseded · rejected·expired → superseded ·
  감사 `signature.round_closed`(사유·행 id) · 실시간 inbox:refresh · afterSignatureChange(거래 단계 재계산).
  받는 쪽에 메일 안 보냄(외부 발송 늘리지 않음 — 다시 보낼 때 새 요청 메일이 간다).
- **D4 다시 보내기** — 기존 요청 창 그대로. 닫힌 회차 행은 재사용 조회(`existing`)에 안 걸리므로 새 행·새 동결. us 도 새로 서명.
- **D5 (B) 옛 결함** — signRoundWhere 에서 superseded 를 빼면 닫은 뒤엔 해결. 닫지 않고 거절 뒤 바로 다시 요청하는 길(지금 가능)은?
  → 요청 생성 때 회차에 rejected·expired 행만 남아 있으면(열린·서명 행 0) **자동으로 superseded 처리 후 새 회차**로 시작. 열린/서명 행이 있으면 지금처럼 같은 회차에 더한다.
- **D6 권한** — 닫기 = 지금 취소와 같은 술어(`canManageRequest`: 요청자 또는 그 문서 편집 가능자). 멤버 이상.
- **D7 이력 보기** — 서명 진행 칸 아래 «이전 회차 n건» 접힌 목록(누가·언제·거절 사유). 공개 서명 화면에는 안 보인다.

## 3. 검증 계획(자체)
- 실HTTP: (A) us 서명 → them 거절 → 닫기 200 → PUT 본문 200 → 재요청 → 서명본 frozen = 새 본문 · 진행 0/2 · us 새 서명 가능 ·
  (음성) them 1명 signed 뒤 닫기 409 · 닫은 뒤 옛 토큰 /sign/:token 만료 · 권한 없는 멤버 403 · 다른 워크스페이스 404.
- 거래 단계·급여 계약 signed_at 이 닫힌 회차를 «완료» 로 세지 않는다.
- 화면 3폭: 버튼 보임·확인창 문구·닫은 뒤 편집 가능.
- 운영 마이그레이션 멱등(ENUM append 2회 실행).
