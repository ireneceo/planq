# 게스트 링크 고객의 사진·PDF 보내기 + 직원 첨부 보기 (2026-11-12 · Fable 설계 `DESIGN: READY`)

> Irene: *"채널톡 쓰는 고객사가 우리 거 같이 쓸건데 … 불편한 채팅영역 기능 없는지 체크해줘."* → 점검 B «권고대로 진행해 줘»(Fable 설계 먼저).
> 원래 설계 `docs/GUEST_LINK_DESIGN.md` §1 비범위 v1 «게스트 업로드(텍스트만 — 남용 상한)» 를 **이미지·PDF 에 한해** 연다. «비이미지 다운로드는 로그인 유도» 는 그대로.

## Irene 에게 전할 한 줄
게스트 링크 고객이 사진·PDF 를 보낼 수 있게 엽니다(파일당 10MB · 한 번에 3개 · 링크당 100개/300MB · 워크스페이스 용량에서 차감). 문서·압축·영상은 계속 계정 초대 고객만. 직원이 보낸 그림은 게스트에게 보이게 하고, 파일 내려받기는 지금처럼 로그인 유도.

## 확인한 사실
- `routes/guest.js serializeMessage` 에 attachments 가 없다 → 게스트는 직원이 보낸 그림·파일을 지금 전혀 못 본다(08-18 설계 §5 미구현).
- 08-18 설계가 쓰려던 `/:id/raw` 는 08-20 보안 삭제. `/public/:storedName` 은 UUID 를 알면 영구히 열리고 링크 회수로 닫히지 않는다 → 게스트에게 쓰지 않는다.
- 선례: `guest_project.js /:token/files/:fileId/preview` — 토큰 아래 · 줄인 webp 만 · 실패 404 · 판정이 캐시보다 먼저.
- 서버에 악성 파일 검사기 없음 → 형식을 이미지·PDF 로 좁히고 매직바이트 검사.

## 1. 읽기 — 게스트가 직원 첨부를 본다
- `GET /api/guest/:token/messages`: `MessageAttachment` include. 응답 화이트리스트 `attachments: [{ id, file_name, file_size, kind: 'image'|'file', has_preview }]`. `preview_url`·stored name·mime·file_id·storage 를 싣지 않는다(`serializeMessageAttachment` 쓰지 않음).
- 새 라우트 `GET /api/guest/:token/attachments/:attId/preview?w=` (새 파일 `routes/guest_attachments.js`, guest.js 에서 `router.use`)
  - `guestLimiter('guest-att-preview', 120/분)` → `attachGuest` → `requireRoom`
  - 술어: 첨부 → 메시지 `conversation_id = 링크의 방` ∧ 안 지움 ∧ `visibleToGuest(msg)`. 아니면 전부 404.
  - `isRenderableImage` ∧ `imageResize.RESIZABLE` 만. `snapPreviewWidth`, **webp 리사이즈본만**, 원본 폴백 없이 실패 404. 캐시 키 `guest-att:<provider>:<external_id|file_path>`.
  - 판정이 캐시보다 먼저. `Cache-Control: private, max-age=3600`, nosniff, `inline; filename="preview"`.
- 비이미지(PDF 포함): 파일명+크기 칩 → 기존 `LoginRequiredSheet`.
- `has_preview` 와 위 라우트 200 조건은 **같은 함수** `guestAttachmentPreviewable(att)`(services 한 벌).

## 2. 쓰기 — 게스트 업로드
- `POST /api/guest/:token/messages/upload` (multipart, 같은 새 파일) — 메시지 + 첨부를 **한 요청**에서 같이 만든다.
  - 필드: `files`(1~3), `content`(선택 ≤4000, 텍스트 라우트와 같은 정화), `guest_name`(선택, 같은 정화·예약어).
- 미들웨어(전부 multer 앞): ① `guestLimiter('guest-upload',5/분)` + `('guest-upload-h',30/시간)` ② IP 키 30/10분 ③ `attachGuest`→`requireRoom`→`can_write` 아니면 403 `read_only_link` ④ env `GUEST_UPLOAD_ENABLED !== 'false'`(꺼지면 404) ⑤ `Content-Length > 31MB` 413 ⑥ 링크 누적 사전 검사 ⑦ multer `{ fileSize:10MB, files:3, fields:4, fieldSize:20KB }` → `uploads/{biz}/{yyyy-mm}/{uuid}{ext}`.
- 형식: `services/uploadPolicy.js` `GUEST_ATTACHMENT_EXT = .jpg .jpeg .png .webp .gif .heic .heif .pdf`(ATTACHMENT_EXT 부분집합 assert, svg 제외).
- 내용 검사 `services/guestUploadCheck.js`: 매직바이트 = 확장자(JPEG FFD8FF · PNG 89504E47 · GIF GIF8 · WEBP RIFF…WEBP · HEIC/HEIF ftyp 브랜드 · PDF %PDF-), 불일치 400 `invalid_file`. jpeg/png/webp/gif 는 sharp `metadata()` 성공. mime 은 서버 판정값. 파일명 `decodeOriginalName` → 제어문자·경로 구분자 제거 → 120자.
- 한도·쿼터: 파일당 `min(10MB, 플랜)`. 주인 = 워크스페이스 — `plan.can(biz,'upload_file',{size,external:false})` + `reservePlanqUpload`(파일마다). `storage_provider:'planq'`, File 행 없음. 링크 누적: 그림자 User 가 그 방에 올린 첨부 **100개 또는 300MB**(SQL 집계) 넘으면 429 `guest_upload_cap`. 하나라도 실패하면 전부 되돌림(unlink·release·메시지 없음, 메시지+첨부 한 트랜잭션).
- 메시지 생성은 텍스트 라우트와 **한 함수** `services/guestMessage.createGuestMessage(...)`(이름 정화·예약어·meta.guest·is_internal:false·message_count·last_message_at·알림).
- 소켓: 첨부까지 만든 뒤 `message:new` 한 번(`serializeMessageAttachments` payload) + `emitConvWide`.
- 알림: `notifyMany` `previewPolicy:'internal_only'`. 본문 = 글 또는 `outsidePreview.attachmentBody`. **파일명 싣지 않음.**
- 게스트 응답 `{ id, created_at, attachments:[…화이트리스트] }` — `preview_url` 절대 안 줌.
- `GET /api/guest/:token` 에 `upload: { enabled, max_bytes, max_files, accept }`(can_write ∧ 스위치). 화면은 이 값만.

## 3. 회수·노출
- 회수·만료·킬스위치 → 업로드·미리보기 모두 `resolveGuestToken` 404. 올린 파일은 대화 기록(직원 삭제). OG·메일·푸시 노출 없음.

## 4. 화면 `pages/Guest/GuestChatPanel.tsx`
- 클립 버튼(`upload.enabled`) · 파일 칩(이름·크기·✕) · 보내기 전 개수·크기·형식 검사 → 비활성+이유 · 진행 표시 · 실패하면 글·파일 되돌림.
- 말풍선: 그림 썸네일 `…/preview?w=400`, 누르면 크게(w=1600). 파일 칩 → `LoginRequiredSheet`.
- 오류 문구 ko/en(`guest`): invalid_file · file_too_large · too_many_files · guest_upload_cap · too_many_requests · 용량 초과.

## 5. 비범위
오피스·zip·영상·음성 · 게스트 비이미지 다운로드 · PDF 쪽 미리보기 · 게스트 수정/삭제 · 워크스페이스별 켜기 화면 · DB 컬럼 추가.

## 6. 검증 시나리오 (완료 검증도 Fable 대상)
1. 정상: jpg 1 / png+pdf+글 / 그림만 → 201, 직원 목록·소켓 첨부, 게스트 목록 화이트리스트 키만.
2. 형식: .svg · .docx · .exe→.jpg 개명 · 깨진 jpg → 400, 디스크 파일 0·메시지 0·쿼터 변화 0.
3. 크기·개수: 10MB+1 → 413 · 4개 → 400 · 큰 Content-Length 파싱 전 거절.
4. 한도: 분당 6번째 429 · 링크 누적 직전/직후 · 쿼터 초과 413 + 예약 반환.
5. 권한: can_write=false 403 · 회수/만료 404(업로드·미리보기) · 방 없는 링크 404 · 스위치 off 404.
6. 누수(양성 대조군): 다른 방 / 내부 메모 / 지운 메시지 / 미승인 초안 첨부 preview → 404, 같은 방 그림 200, Content-Type 항상 image/webp, 게스트 응답에 UUID stored name 0건.
7. 회귀: 텍스트 POST 응답·알림·소켓 같음 · 예약어 400 유지 · ctx 는 `upload` 키 외 동일.
8. 알림: 파일명·본문 메일/푸시 안 나감.
9. 화면 3폭 + elementFromPoint.
10. 가드: health-check · guard-invariants · tenant suite · build.
