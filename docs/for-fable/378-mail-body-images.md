# [Fable 대기] #378 곁가지 — 메일 본문 이미지를 어떻게 실어 보낼 것인가

> **Opus 판단 보류.** Irene 지시: "판단이 애매하면 나중에 fable이 하게 빼놔."
> 잘못 고르면 **받는 사람 화면에서 깨지거나, 이미지가 영구 공개된다.** 되돌리기 어렵다.

## 사실 (코드로 확인)

- `pages/QMail/MailPage.tsx` 의 RichEditor 두 곳(작성 2196 · 답장 2526)에 **`uploadUrl` 이 없다.**
  그래서 메일 본문에는 이미지를 **드래그·붙여넣기로 아예 넣을 수 없다**(handleDrop 이 즉시 return false).
  Irene #378: "통일해서 맞춰서 일반적인 기능으로 해야 해. 파일 동기화랑 이미지나 파일 드래그 및 복사해서 넣었을 때나."
- 다른 화면은 넣을 수 있다 — Q info·Q Task(RichEditor, `/api/files/:biz`) · Q docs(PostEditor, `/api/posts/editor-image`).
- **단순히 uploadUrl 만 넘기면 안 된다.** 그 경로가 주는 `preview_url` 은
  `/api/files/public-image/<uuid>` 라는 **상대 경로**다. 메일은 외부 메일 클라이언트에서 열리므로
  ①절대 URL 이어야 하고 ②그 URL 이 수신자에게 열려 있어야 한다.
  발송 경로에 이미지 처리가 **없다** — `services/emailHtmlInline.js` 는 표에만 인라인 스타일을 입힌다.
  즉 지금 상태로 넣으면 **작성 중에는 멀쩡하고 받은 사람에게만 깨진다** — 가장 나쁜 실패 모양이다.

## Fable 이 정할 것

1. **절대 URL 인가, CID 첨부인가.**
   · 절대 URL(`https://planq.kr/api/files/public-image/<uuid>`) — 구현이 가볍지만 그 이미지는
     **링크를 아는 누구에게나 영구 공개**된다. 메일은 전달·인용으로 퍼진다. 만료·회수 수단이 없다.
   · CID 첨부(`cid:`) — 메일에 바이트를 실어 보낸다. 외부 노출 0, 대신 용량이 커지고
     수신 쪽 표시 정책(이미지 차단)에 걸릴 수 있다. 수신 경로는 이미 `cid:` 를 다룬다
     (`routes/email_threads.js:517` — 받은 메일의 cid 이미지를 srcDoc 용으로 변환 중).
2. **어느 쪽이든 발송 파이프라인에 변환 단계가 필요하다** — 어디에 둘 것인가.
   `emailHtmlInline` 옆(표와 같은 자리)인가, 별도 단계인가. 멱등이어야 한다(초안 재발송·서명 이중 적용).
3. **전달(forward) 과의 충돌** — 전달은 원문 HTML 을 본문에 합성한다. 남의 메일에 있던 이미지까지
   우리가 다시 올리면 안 된다. 우리가 넣은 것만 골라내는 표식이 필요하다(표는 `pq-table` 클래스로 구분 중).

## 이번 사이클에 한 것 / 안 한 것

- 했다 — Q info 인라인 업로드 404 수정, RichEditor 크기 조절 통일(Q docs 와 같은 확장·CSS),
  검사기 3종(`editorupload` · `richresize` · 기존 `imgresize`).
- 안 했다 — **메일 본문 이미지.** 위 결정 없이는 손대지 않는다.
