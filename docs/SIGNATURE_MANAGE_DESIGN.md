# 서명 관리 — 받은·보낸 서명 + 워크스페이스 «서명 관리» (2026-10-23)

> Irene 2026-10-22: «받은 서명 메뉴는 있는데 보낸서명 리스트는 어딨어?» · «전체 워크스페이스 설정에서 받은/보낸서명 관리가 있어서
> 다 정보가 리스트업 되어야 하고 … 보낸담당자 누군지도 남아야 하고 … 서명관리라고 하거나 받은/보낸 서명이라고 해서 둘다 나오게»
> 설계 판정: Fable DESIGN-CHANGE(아래 ①~⑤ 반영) · 구현 [Opus]

## 1. 화면
| 자리 | 주소 | 누가 | 범위 |
|---|---|---|---|
| 개인 메뉴 «받은·보낸 서명» (`nav.signatures`) | `/signatures/received` · `/signatures/sent` (경로가 탭) | 받은: 누구나 · 보낸: 멤버 이상 | 받은 = 나에게 온 것(모든 워크스페이스) · 보낸 = 내가 요청한 것(지금 워크스페이스) |
| 설정 › 서명 관리 (`nav.signatureManage`) | `/business/settings/signatures` | owner · admin · platform_admin | 그 워크스페이스 전체 + 요청자 |

- 이름을 둘이 다르게 둔다 — 같은 글자면 «내 것만» 과 «전체» 가 섞여 읽힌다.
- 알림 링크 `/signatures/received?sig=` · 인박스 보관 링크 · 옛 `/docs?tab=received-signatures` 리다이렉트는 그대로.
- 보낸·관리 목록은 한 컴포넌트 `components/Signatures/SignatureRequestList`(mode sent|manage). 문서·회차 묶음 머리줄 + 서명자 행.
  기본 필터 «진행 중» · «이전 회차 포함» 체크(기본 끔) · 검색 · (관리) 요청자.

## 2. 데이터·API — 새 칸 없음
- 보낸 담당자 = `signature_requests.requester_user_id`(NOT NULL, 처음부터 있었다). 마이그레이션 없음.
- `routes/signatures_sent.js` (signatures 보다 앞 마운트, 꼬리 경로 고유)
  - `GET /api/signatures/sent?business_id=` — requester = 나 ∧ 지금 워크스페이스(requestScope)
  - `GET /api/signatures/manage/:businessId` — checkBusinessAccess + owner/admin/platform_admin(아니면 403 `owner_only`), `pagination.requesters`
  - 둘 다 parsePagination(50/200) · `status=open|all|signed|rejected|canceled|expired` · `kind` · `include_superseded=1` · `q`
- 응답 모양은 `services/signatureList` 한 벌(받은 목록과 공유): `serialize`(token·sign_url 은 받는 본인 `withLink` 만) · `docAccessMap`.
- 요청자 이름은 워크스페이스 표시명(`applyMemberDisplayName`).

## 3. 읽을 수 없는 문서 — 빼지 않고 가린다 (②)
요청 행은 «멤버가 한 관리 행위 기록» 이라 건수·상태·요청자·만료는 관리자 몫이고, 내용은 닫힌다(2026-10-09 «볼 수 없는 것은 수정·삭제도 못 한다»).
`hiddenRow`: 제목 없음(«비공개 문서») · 문서 링크 없음 · 이메일 `a***@domain` · signed_ip·note·comment·rejected_reason 없음 · `can_manage:false`.
**검색(q)은 읽을 수 있는 문서 안에서만** 제목·서명자를 찾는다(문서 목록 술어 `postListWhereByLevel`) — 가린 행의 제목·이메일을 검색으로 떠볼 수 없다.

## 4. 관리 동작 — 한 술어 (①③)
`services/signatureList.canManageRows(user, post, rows)` = 요청자 ∨ canEditPost ∨ (그 워크스페이스 owner/admin ∧ canReadPost).
취소(`DELETE /signatures/:id`)·재알림(`POST …/reminder`)·회차 닫기(`POST /posts/:id/signatures/close-round`) 셋이 이 함수를 쓴다
(`signatureCore.canManageRequest` 는 위임, `signature_round.js` 의 인라인 복사본은 지웠다).
- 본문 편집(canEditPost)은 넓히지 않는다 — 10-23 «owner/admin 예외 없음» 그대로. 취소·재알림은 관리 행위 축(업무 삭제·이관과 같은 축).
- **«삭제» = 요청 취소.** 하드 삭제 문은 없다(서명 행은 증빙 · «보낸 담당자가 남아야» 와 양립 불가). signed/rejected/superseded 취소는 400 그대로.
- **«수정» = 문서로** — 목록의 [문서 보기]/[고쳐서 다시 보내기] → 문서의 회차 닫기 → 편집 → 재요청.
- 재알림 확인창은 받는 주소를 적는다(외부 발송 확인 규칙).

## 5. 실시간 (⑤)
취소·재알림 라우트도 `inbox:refresh`(reason `signature_canceled`·`signature_reminded`)를 쏜다 — 전엔 생성·서명·거절·회차 닫기만 쐈다.
목록은 socket `inbox:refresh` + window `inbox:refresh`·`socket:reconnected` + `useVisibilityRefresh`. 사이드바 배지는 받은 대기 수 그대로.

## 6. 회귀
- `health-check --category=secrets` «보낸 서명·서명 관리 목록에 서명 링크(token)가 실리지 않는다»(대조군: 시험 행 실림)
- `health-check --category=displayname` 목록에 `/api/signatures/manage/:biz` (표시명 덮기를 끈 양성 대조군으로 FAIL 확인)
