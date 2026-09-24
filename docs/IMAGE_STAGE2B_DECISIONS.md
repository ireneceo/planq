# 이미지 보안 Stage 2b — 결정문 (Fable 설계 2026-09-24, 구현 미착수)

대상 무인증 이미지 표면 **여섯**. 2a(개인 L1, `files/public-image`·`posts/editor-image`)는 켜져 있다. 이 문서는 «L2/L3 를 누구에게 여는가» 를 정한다.

## 0. 운영 실측 (읽기 전용, 2026-09-24)

| 표면 | 라우트 | 지금 판정 근거 | 운영 |
|---|---|---|---|
| 파일 썸네일 | `GET /api/files/public-image/:stored` | File 행 · L1 게이트 · **L2/L3 통과** | 이미지 L1 173 · L2 125 · L3 125 |
| 문서 본문 이미지 | `GET /api/posts/editor-image/:name` | File 행 · L1 게이트 · **L2/L3 통과** (업로드 시 프로젝트=L2, 아니면 L3 — L4 로는 절대 안 만든다) | editor-images L3 80 · L2 2. 공유 링크 문서 11(L3 7·L2 4) 중 본문 이미지 4건 |
| 위키 스크린샷 | `GET /api/wiki/image/:fileId` | **발행 help_article 본문이 file_id 를 참조할 때만** (vlevel 안 봄, File 은 L3 로 저장) | 발행 136 · 이미지 블록 **0** |
| 채팅 첨부 사본 | `GET /api/message-attachments/public/:stored` | MessageAttachment.file_path 접미사 — **File 등급 안 봄** | 연결 첨부 53: **L1 25(이미지 23)** · L2 26 · L3 2 |
| 업무 첨부 사본 | `GET /api/tasks/public/attach/:stored` | TaskAttachment.stored_name — **File 등급 안 봄** | 같은 stored: **L1 3** · L2 1 |
| 게스트 링크 | `/api/guest/:token/files`(썸네일 → public-image) · `/api/guest/:token/posts/:id`(본문 content_json) | 파일: L4 general 만 `preview_url`, L2/L3 는 키 없음(«자리는 보이되») · 문서: 본문 그대로 | project 3(활성 2) · conversation 2(활성 1) · 게스트 채팅은 첨부 미노출 |

★ **2a 는 아직 닫히지 않았다.** 사본 경로가 같은 stored name 을 그대로 쓴다 — dev 실측(file 4946, L1):
`files/public-image` 익명 **404** → `link-existing` 으로 채팅에 연결 → `message-attachments/public` 익명 **200 image/png**. 운영에는 그렇게 닿는 L1 이미지가 **23장** 있다.
`link-existing`(`message_attachments.js:171`)·업무 `attachments/link` 는 **연결하는 사람의 등급 접근을 묻지 않는다**(business_id 만) — 남의 L1 도 내 메시지에 붙일 수 있고, 붙는 순간 익명이 된다.

## 1. 무엇이 옳은 동작인가

**등급의 정본은 File 행 하나다. 사본 행에 등급 컬럼을 만들지 않는다.** 익명에게 열리는 것은 아래 표의 «허용 표면» 뿐이고, 나머지는 **보는 사람(pq_img 쿠키) + 목록과 같은 술어(`canAccessFileByLevel`)** 다.

| 등급 | 로그인 사용자(쿠키) | 익명 | 허용 표면(익명이라도 여는 문맥) |
|---|---|---|---|
| L1 | 올린 사람·platform_admin | ✗ | 없음 |
| L2 | 프로젝트 멤버(같은 술어) | ✗ | ①공유 토큰 문맥 ②게스트 프로젝트 토큰 문맥 ③서명 토큰 문맥 — **그 토큰이 가리키는 문서 본문에 그 이미지가 실제로 박혀 있을 때만** |
| L3 | 워크스페이스 멤버 | ✗ | ①②③ 같음 |
| L4 | 누구나 | ✓ | 전부 (게스트 썸네일·공개 문서) |
| 위키 스크린샷 | — | ✓ | `/api/wiki/image` **한 문**(발행 참조 술어가 곧 문맥). 재분류하지 않는다 — File 은 L3 로 두고, `public-image` 로는 L3 규칙을 그대로 받는다 |
| 채팅·업무 첨부(File 행 있음 — 53/54) | File 등급으로 | File 등급으로 | File 과 같다 |
| 채팅·업무 첨부(File 행 없음 — 업로드만) | 그 대화·업무 접근자(`canAccessConversation`/`canAccessTask`) | ✗ | 없음 (3단계에서) |

- **공유 문서 본문 이미지는 «토큰 문맥에서만»** — L4 로 재분류하면 공유를 끊어도 이미지 URL 은 영원히 공개다(이미지가 문서보다 오래 산다). 문맥은 요청에 실어 온다: 공개 페이지 응답이 `image_ctx`(단기 JWT, kind `imgctx`, 문서/프로젝트/서명요청 id, 1h)를 주고 화면이 `<img src>` 에 `?ctx=` 로 붙인다. 서버는 `ctx → 허용 문서 집합 → content_json(또는 서명 고정본)에 그 파일명이 있는가` 를 **한 함수**로 판정한다. 비밀번호 공유는 비밀번호를 통과한 응답에만 `image_ctx` 를 준다. 공유 해제·만료면 ctx 가 가리키는 share_token 이 더 이상 같지 않아 죽는다.
- PDF(`/public/:token/pdf`)는 서버가 `resolveEditorImage` 로 직접 읽는다 — 이미 토큰 문맥 안이다. 무변경.
- 게스트 «자리는 보이되» 는 지금이 옳다. 2b 로 **L4 썸네일이 계속 열리는지**가 회귀 축이다(게스트 요청은 익명이다).

## 2. 순서 · 범위 · 킬스위치

| 단계 | 내용 | 스위치 | 깨질 수 있는 것 |
|---|---|---|---|
| **0 (2a 마감, 지금)** | 사본 두 라우트가 File 행을 찾으면(`file_id` / stored basename) `isImageViewable` **같은 함수**를 부른다 · `link-existing`·`attachments/link` 는 연결자에게 `canAccessFileByLevel` 을 묻는다(403) | 기존 `image_gate_l1_off_until` | 남의 L1 을 사본으로 보던 사람 — 운영 23장, 전부 «목록에서 못 보는 것을 URL 로 보던» 경우 |
| 1 | `image_ctx` 배관(발급·`?ctx=` 판정·화면 3곳: 공개 문서·게스트 문서·서명) — **막지 않고 붙이기만** | 없음(additive) | 없음 |
| 2 | Stage-1 식 계측 `[imageGate:would-deny-l23]` — L2/L3 · 익명 · **유효 ctx 없음** 만 센다(ctx 있는 요청을 세면 공개 문서 조회가 전부 잡음이다). 14일(사용자 12명·공유 문서 11건이면 충분) | — | — |
| 3 | L2/L3 켬 — `files/public-image`·`posts/editor-image` | **새 컬럼** `image_gate_l23_off_until`(L1 과 독립 — L2/L3 만 되돌릴 수 있어야 한다) | 계측이 0 에 수렴하지 않은 화면 |
| 4 | 첨부 사본 중 File 행 없는 것 — 대화·업무 접근 술어(쿠키 필요) | `image_gate_attach_off_until` | 앱 콜드 스타트에서 쿠키 없는 첫 요청 — 계측으로 먼저 본다 |

- 스위치는 전부 **시각**(24h 자동 복귀), 못 읽으면 켬 — 2a 와 같은 계약.
- 관측은 `health-check --category=imagegate` 를 **확장**한다(별도 카테고리 X): `gate_on`·`session_alerts_24h` 를 `{l1, l23, attach}` 축으로.

## 3. 검증 항목 (`--suite imagegate2b`, 양성·음성 대조군 포함)

| # | 검사 |
|---|---|
| 1 | L2/L3 익명 404 (두 File 라우트) · L3 멤버 200 · L2 비프로젝트 멤버 404 / 프로젝트 멤버 200 · platform_admin 200 |
| 2 | 공유 문서: 유효 ctx 200 · 다른 문서의 ctx 로 같은 이미지 404 · 만료/해제 후 404 · 비밀번호 공유는 통과 전 404 → 후 200 |
| 3 | 게스트: L4 썸네일 200(회귀) · L2/L3 `preview_url` 키 없음 · 게스트 문서 본문 이미지 ctx 200 |
| 4 | 서명 공개 화면: 고정본 이미지 ctx 200 · 서명 완료·만료 후 정책대로 |
| 5 | 위키: 발행 참조 200 · 미참조 404 · 미발행 404 · **L3 게이트와 무관** |
| 6 | 사본: L1 을 연결한 첨부 익명 404(§0 의 dev 실측을 뒤집는다) · 올린 사람 200 · 남의 L1 `link-existing` 403 |
| 7 | 스위치 독립: l23 끔 → L2/L3 200 **인데 L1 은 여전히 404** |
| 8 | 캐시 앞 게이트: 멤버로 `?w=` 캐시를 덥힌 뒤 익명 404 |
| 9 | 계측 라인에 유효 ctx 요청이 **안 섞이는가**(ctx 있는 요청 100건 → would-deny 0) |

## 4. R · S · F
- **R**: 켜는 것은 시각 스위치로 되돌린다(R=0). 단 `link-existing` 403 과 ctx 배관은 코드라 배포 단위 — 3단계 **켜기 직전 한 번** Fable(운영 계측 로그 대조 · 공유 문서 11건 실열람).
- **S=1**: 이 문서가 그 판단이다. 구현은 설계 밖을 더하지 않는다(예: 첨부 행에 등급 컬럼).
- **F=1**: 위 9항목이 기계 판정이다. 0~2단계는 Opus 자체검증(«Fable 미검증(자체 검증)» 표기).
