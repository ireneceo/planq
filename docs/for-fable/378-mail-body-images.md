# [판정 완료] #378 곁가지 — 메일 본문 이미지를 어떻게 실어 보낼 것인가

> **2026-09-01 Fable 판정: CID 첨부.** 구현 완료. 이 문서는 결정 근거를 남기기 위해 보존한다.

## 결정

**본문에 넣은 우리 이미지는 발송 직전 `cid:` 첨부로 바꾼다.** 저장본(`body_html`)은 URL 그대로 둔다.

## 왜 절대 URL 이 아닌가 (셋 다 코드로 확인)

1. **`/api/files/public-image/:token` 은 무인증·무만료·무회수다** (`routes/files.js:225`).
   유일한 방벽이 UUID 추측 불가능성인데, 게다가 `security_level`·`vlevel` 을 **전혀 보지 않는다** —
   드래그아웃(`/drag`)이나 `gdriveMirror.isEligible` 은 막는 것을 이 경로만 통과시킨다.
   메일에 그 주소를 박으면 그 구멍이 **워크스페이스 밖으로 영구히** 나간다. 메일은 전달·인용으로
   퍼지고 회수 수단이 없다.
2. **이 코드베이스는 이미 CID 를 쓴다.** `emailSend.js` 의 `attachDataUrls: true` 가 받은 메일의
   data:URI 를 multipart/related 로 내보내고, 플랫폼 메일 로고도 `cid:planq-logo@platform` 이다.
   새 표준을 들이는 게 아니라 있는 정공법에 합류한다.
3. **메일은 기록이다.** URL 이면 나중에 그 파일을 지우는 순간(soft delete → 404) 수신자 메일함과
   우리 보낸메일함 **양쪽에서** 그림이 사라진다. CID 는 발송 시점 바이트가 메일에 고정된다.

### 내가(Opus) 틀렸던 것
앞 판에서 "CID 는 수신측 이미지 차단 정책에 걸릴 수 있다" 고 적었는데 **방향이 반대다.**
차단 대상은 원격 URL 이고, CID 는 첨부라 Gmail·Outlook·Apple Mail 에서 기본 표시된다.
오히려 절대 URL 이 (a) 차단 대상이고 (b) 수신자가 열 때마다 우리 서버에 흔적을 남겨
사실상 추적 픽셀이 된다 — 고객 메일에 넣을 성격이 아니다.

### 기각한 제3안
- **만료 서명 URL** — 메일은 1년 뒤에도 읽힌다. 만료가 있으면 보관 메일이 깨지고, 없애면 절대 URL 과 같다.
- **하이브리드(작은 건 CID, 큰 건 URL)** — 큰 이미지일수록 노출이 아픈데 그것만 공개하는 셈.

## 구현 (2026-09-01)

- `dev-backend/services/emailImageEmbed.js` (신규) — `embedOwnImages(html, { businessId })`
- `dev-backend/services/emailSend.js` — `wireHtmlFont` 직후 한 곳에서 호출.
  답장·새메일·전달 세 경로가 모두 이 함수를 지나므로 한 곳이면 된다.
- `dev-frontend/src/pages/QMail/MailPage.tsx` — 작성·답장 RichEditor 에 `uploadUrl`
  (Q info·Q Task 와 **같은 주소** `/api/files/:biz`)
- `scripts/e2e/canary-mail-image.js` (신규) — 실제 브라우저로 드래그해 본다

### 우리 것을 알아보는 법 — 클래스 표식을 쓰지 않는다
`pq-table` 같은 클래스 패턴은 쓸 수 없다: 붙여넣은 남의 HTML 도 아무 클래스나 달고 오고,
RichEditor 의 이미지에는 애초에 클래스가 안 붙는다.
대신 **"src 가 우리 public-image 경로이고 그 토큰의 File 행이 이 워크스페이스 것"** 으로 판정한다.
File 행은 서버만 만들므로 위조할 수 없다.

전달(forward)에서 저절로 옳게 갈린다:
- 남의 원문 이미지(`data:` · 원격 `https:` · `cid:`) → 판정에 안 걸린다. 손대지 않는다.
- 내가 보낸 이미지 메일을 전달 → 진짜 우리 것이라 다시 실린다. 수신자가 본다.

### 조용히 빼지 않는다
보안등급 위반·바이트 없음·용량 초과(합계 8MB)는 **발송을 거부**하고 사용자가 읽을 문구를 준다.
"수신자에게만 깨지는" 실패보다 "보내는 사람이 즉시 아는" 실패가 낫다 — 작성 중에는 멀쩡한데
받은 사람만 못 보는 것이 이 계열에서 가장 나쁜 실패 모양이다.

## 남는 것

- **실수신 확인은 운영에서만 가능하다.** dev 는 `EMAIL_SENDING_ENABLED=false` 라 `sendMail` 이
  변환 단계 **앞에서** return 한다. 지금까지의 근거는 단위 15/15 + 실제 MIME 컴파일 7/7 +
  브라우저 4/4 이고, **Gmail·네이버·Outlook 실수신 스크린샷은 아직 없다.**
- Fable 이 범위 밖으로 기록한 부수 발견 (별도 처리 필요):
  · `resolveAttachments`(`email_threads.js:80`) 가 `fs.existsSync` 로 **Drive 저장 첨부를 조용히 떨군다**
  · inbound 에 진짜 `cid:` 첨부가 있는 메일을 전달하면 `restoreEmbeddedImages` 가 `planq-embed` 만
    다뤄 인라인이 안 살아난다
  · `public-image` 가 `security_level`/`vlevel` 을 무시하는 것은 **기존 노출**이다 —
    CID 선택은 이것을 넓히지 않을 뿐 없애지는 않는다
- **Irene 확인 필요:** 메일 본문에 넣은 이미지가 Q File 에 File 행으로 쌓인다(Q info 와 같은 대접).
  보내지 않은 초안의 이미지도 남는다. "통일해서 맞춰서" 원칙상 맞지만, 파일함이 메일 스크린샷으로
  채워지는 것을 받아들일지는 확인이 필요하다.
