# 청구서 첨부(파일·문서·업로드) — 설계 정본 (2026-11-25)

> Irene: *"청구서에 출처문서만 연결할 수 있는데 문서든 파일이든 업로드든 첨부문서/파일들도 넣을 수 있어야 해. 확인 해줘."*
> 확인 결과: 기능 자체가 없었다(출처 문서 `invoices.source_post_id` 1칸뿐). 정찰 계획 `.claude/plans/qmwvr8164.md`.
> 설계 판정: Fable `VERDICT: DESIGN` (방 a7fa6169, 2026-11-25). 아래 결정 번호는 그 판정 그대로다.

## A. 결정 (Fable 권고 — Irene 상시 지시 «Fable 권고가 있으면 그대로»)
1. **고객 노출 = 첨부마다 «고객에게 보이기» 스위치, 기본 꺼짐(내부용).** 잘못 숨기면 한 번 눌러 고치지만, 잘못 보이면 되돌릴 수 없다.
2. **문서 첨부는 그 문서가 이미 외부 공유로 열려 있을 때만 고객에게 보인다** — 제목 + 그 문서 자신의 공개 링크.
   조건 `!blocksExternalShare(post) && shareOpenReason('post', post) === null`(업무 공유 선례 `taskPublicShare.js` 와 같은 함수)을 매 요청 다시 계산.
   공유 토큰 자동 발급 없음 · 청구서 토큰으로 문서 대리 렌더 없음. 공유가 회수·만료되면 줄째로 빠진다(제목도 안 나감).
   **B-④ 그대로** — `source_post` 는 계속 제목만(토큰 없음). 첨부는 사람이 일부러 켠 것이라 축이 다르다.
3. **메일에는 파일을 싣지 않는다 — 기존 공개 페이지 링크만.** `invoiceDelivery.js`·메일 템플릿 변경 0 (외부 발송 표면 변경 없음).
4. **복제는 첨부 행을 복사**(포인터만 · `client_visible`·`sort_order` 승계 · `created_by` = 복사한 사람 · 지워졌거나 복사하는 사람이 못 읽는 원본은 건너뜀). **정기청구는 손대지 않는다**(엔진이 프로젝트에서 새로 만든다 — 복사할 원본이 없다). 수정발행은 범위 밖.

## B. 표 `invoice_attachments`
`id · business_id · invoice_id(FK CASCADE) · file_id NULL(FK CASCADE) · post_id NULL(FK CASCADE) · client_visible BOOL 기본 0 · sort_order · created_by · created_at/updated_at`
- file_id·post_id **정확히 하나**(서버 강제). 바이트 복사 없음(CalendarEventAttachment 방식).
- UNIQUE (invoice_id,file_id)·(invoice_id,post_id) — 같은 자료를 다시 붙이면 건너뜀(멱등). 청구서당 20개.
- File·Post 는 소프트 삭제라 CASCADE 는 휴지통 단계에서 안 돈다 — 모든 읽기가 `deleted_at` 을 다시 본다. 청구서 삭제 라우트는 첨부 행을 명시로 지운다.
- 운영 반영: 새 표라 배포의 `sync-database` 가 만든다(마이그레이션 스크립트 없음).

## C. 서버
- 판정 한 곳 **`services/invoiceAttachments.js`** — `attachableRows`(붙이기 검증) · `publicTargetReason`/`publicAttachmentReason`(밖으로 나가는가) · `memberList`/`publicList` · `setOnCreate` · `copyForDuplicate` · `previewTargets`.
- 라우트 **`routes/invoice_attachments.js`** — `/api/invoices` 에 invoices.js **보다 먼저** 마운트(꼬리 `/attachments…` 만).

| 라우트 | 권한 | 동작 |
|---|---|---|
| `GET /:biz/:id/attachments` | 상세 GET 과 같은 문(allowNonMember) | 멤버 = 전체(보는 사람 기준 · `public_state`·`shareable_reason`) / 고객 = `publicList` 만 |
| `POST /:biz/:id/attachments` | checkBusinessAccess + qbill write · 고객 403 | `{file_ids, post_ids, client_visible}` |
| `PATCH /:biz/:id/attachments/:attId` | 〃 | `{client_visible, sort_order}` · 켤 때 술어가 막으면 400 `attachment_not_shareable:<이유>` |
| `DELETE /:biz/:id/attachments/:attId` | 〃 | 연결만 끊음(원본 그대로) |
| `POST /:biz/attachments-preview` | 〃 | 발행 창(저장 전) — 이름·켤 수 있는가, **저장 안 함**. 붙이기와 같은 검증 |
| `GET /public/:token/attachments/:attId/download` | 무인증 · IP 분당 60 | 아래 술어 · 실패는 404(만료만 410) |

- 생성 `POST /api/invoices/:biz` 가 `attachments:[{file_id|post_id, client_visible}]` 를 받아 **같은 트랜잭션**에 넣는다 — 실패하면 생성 전체 취소. PUT 은 첨부를 받지 않는다(저장 뒤엔 위 라우트로 즉시).
- 붙일 때: 같은 워크스페이스 · 미삭제 · 붙이는 사람이 읽을 수 있음(파일 `canAccessFileByLevel`, 문서 `canReadPost`). 없음·남의 것·못 읽음 = 같은 404 `attachment_target_not_found`.
- **켜기(PATCH client_visible:true)도 켜는 사람이 원본을 읽을 수 있어야 한다**(`canReadTarget` — 붙이기·켜기·복제가 같은 함수, 못 읽으면 404). 숫자 아닌 `:id`·`:attId` 는 404(`router.param`).
- 못 읽는·지워진 줄은 원본 id 도 싣지 않는다(이름·file_id·post_id 모두 null).
- 상태: `canceled` 만 변경 불가(400 `invoice_canceled`). 모든 CUD 감사 `invoice.attachment.add|update|remove`.
- **밖으로 나가는 술어** `publicAttachmentReason` — `client_visible` ∧ (파일: 미삭제·미purge·보안등급 일반·L1 아님·**L2 지정 멤버 아님**(폴더 공유 링크 `targeted` 와 같은 폭 — 완료 검증 비차단 1) / 문서: A-2). 공개 목록·공개 내려받기·고객 GET·스위치 저장이 같은 함수.
- 공개 내려받기: 토큰 → `shareOpenReason('invoice')` null(초안·취소 404, 만료 410) → 행이 이 청구서 것 ∧ 파일 행 → File 같은 워크스페이스 → 술어 → `readAttachmentBody`(Drive 포함) · attachment · nosniff.
- 업로드는 새 저장 경로 없음 — 일정 미팅자료와 같은 `attach_for=event`(L2/L3)로 올려 file_id 연결. 기본 L1 이면 «고객에게 보이기» 가 영영 안 켜진다.
- `services/fileUsage.js` 에 `invoice_attachments` 조회 추가(kind `invoice`) — 파일 지우기·범위 좁히기 경고에 잡힌다.

## D. 화면
- `components/QBill/InvoiceAttachmentsField.tsx` 하나 — 발행 창(출처 문서 칸 아래, 저장 전엔 화면에 들고 있다가 생성 요청에 실음 · 편집 모드는 즉시)과 상세 드로어(출처 카드 아래)가 같이 쓴다.
  고르기 = 공용 `AttachmentField`(업로드·기존 파일/문서·Drive) · 목록 = 공용 `AttachmentList`(+ `trailing` 칸에 스위치) · 저장 뒤 스위치는 `AutoSaveField type="toggle"`.
- 고객(앱 안)은 보이는 것만 링크로 · 공개 페이지(`PublicInvoicePage`)는 «첨부» 절(있을 때만): 파일 내려받기 · 문서 새 탭.
- 출처 문서 칸은 그대로(단일 · 항목·금액 자동 채움).

## E. 검증 (2026-11-25 자체 검증 — 실 HTTP 3003)
- 실호출 37 + 9 = 46/46: 생성 3종 · 멱등 · 토글 · 떼기(원본 남음) · 복제 승계 · 청구서 삭제 0행 · 감사 3종 · 다른 워크스페이스 파일·문서 404 · 고객 쓰기 403 ·
  21개째 400 · 취소 청구서 400 · 둘 다 400 · 초안 토큰 404 · 만료 410 · 취소 토큰 404 · 내부용 404 · 다른 청구서 attId 404 · 휴지통·L1·보안등급 404 ·
  문서 공유 회수 → 토큰·제목 없음 · 공유 안 된 문서 켜기 400 · B-④ 유지 · **양성 대조군**(보이기 파일 200 + 바이트 일치 · 취소 되돌리면 200) · fileUsage 에 청구서.
- 화면 3폭(1440·768·390) 36/36 — 드로어 3줄·스위치 2 켜짐/1 막힘·가림 없음 · 스위치 끄기/켜기 PATCH 정확히 1건씩·DB·공개 응답 반영 · 발행 창 칸·추가 입력 · 공개 페이지 2건·내부용 이름 없음·가로 넘침 없음.
- 발행 창 화면 동선 5/5 — 파일 올리기 → 칩(저장 전 DB 0) → «고객에게 보이기» → 임시 저장 → 청구서+첨부 1행·보이기 1 · 올린 파일 L3.
- 확인 못 함: 발행 창에서 «기존 문서 검색» 으로 고르는 화면 동선(미리보기 API 로 대신) · «발행하고 보내기»(외부 발송이라 누르지 않음).

## F. Fable 완료 검증 1차 FAIL → 고침 (2026-11-25)
- 차단 1: PATCH(켜기)가 요청자 읽기 권한을 안 봐서, 멤버가 직접 받기 403 인 파일을 켜 무인증 공개 링크로 받았다(재현) → `canReadTarget` 추가.
- 차단 2: 숫자 아닌 attId 로 무인증 500 → `router.param` 정수 검사 404.
- 비차단 반영: L2 지정 멤버 파일 공개 제외(1) · 못 읽는 줄 id 제거(3). 남김: 이미 보낸 청구서에서 켤 때 확인 창(2 — 발송 확인 창 자체가 없음, 별건) · DB «정확히 하나» CHECK 제약 없음(4 — 서버 강제, 설계대로).
- 재측정 19/19: 재현 C5 404·C6 404(음성) · 대표 켜기 → 공개 200 + 본문 일치(양성) · 멤버가 읽을 수 있는 파일 켜기 200 · 지정 멤버로 좁히면 공개 404 · NaN 8경로 404 · 기존 상세·공개 200.
