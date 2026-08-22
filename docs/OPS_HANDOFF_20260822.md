# [운영 → dev] 2026-08-22 작업 요청 5건

> 운영(87.106.78.146) 실측 기준. 운영 `feedback_items` #370~#374 로 등록돼 있다 (dev DB 에는 없다).
> 각 항목의 전체 본문은 운영 DB 에 있고, 이 문서가 그 요약 + 코드 위치다.
> 작성: 운영 Claude 세션, 2026-08-22 03:40 UTC.

## 우선순위

| # | 분류 | 내용 | 상태 |
|---|---|---|---|
| #374 | bug/high | `routes/og.js` SPA index 경로가 dev 전용 — 운영 404 유발 | 운영 핫픽스 완료, 코드 수정 필요 |
| #373 | bug/high | #362 미완 — 크롤러가 `routes/og.js` 에 도달 못 함 | 미해결 |
| #370 | bug/high | 자기발신 알림메일 로고가 매번 File 로 저장 | 운영 소급 정리 완료, 원인 차단 필요 |
| #371 | improve | Q Mail 이 PlanQ 자기발신 알림메일을 재수집 (inbound 36%) | Irene 판단 필요 |
| #372 | bug | `business_storage_usage` 카운터가 실제와 불일치 | 미해결 |

---

## #374 (bug/high) — routes/og.js 의 SPA index 기본경로가 dev 전용. 운영 장애를 냈다

`routes/og.js:23`

```js
const INDEX_HTML = process.env.SPA_INDEX_PATH
  || path.join(__dirname, '..', '..', 'dev-frontend-build', 'index.html');
```

운영 빌드 디렉토리는 `frontend-build` 다. 2026-08-22 #362 nginx 블록 적용 직후
`/insights/:slug` 가 **사람·크롤러 모두 404 `not found`** 로 죽었다.
`readIndexHtml()` 이 null → `sendHtml()` 이 `res.status(404).send('not found')`.

설정 한 줄 추가가 기능 추가가 아니라 페이지 다운이 되는 구조였다.

**운영 조치 (완료)**

```
/opt/planq/backend/.env 에 추가:
  SPA_INDEX_PATH=/opt/planq/frontend-build/index.html
pm2 restart planq-prod-backend --update-env
백업: /opt/planq/backend/.env.bak-og362-20260822_033424
복구 확인: /insights/create-workspace → 200, <title>워크스페이스 만들기 · PlanQ</title>
```

**코드 수정 요청**

같은 저장소에 올바른 패턴이 이미 두 군데 있다. og.js 만 단일 dev 경로를 하드코딩했다.

- `middleware/ogMeta.js:263` — `[FRONTEND_INDEX_HTML, ../../frontend-build, ../../dev-frontend-build]` 후보 배열
- `services/emailService.js:15` — `LOGO_CANDIDATES` 동일 패턴

`routes/og.js` 도 같은 후보 배열로 바꿀 것. 그러면 운영 `.env` 설정 없이도 동작하고,
`SPA_INDEX_PATH` 미설정이 장애로 이어지지 않는다.

추가로 `sendHtml()` 이 index.html 을 못 읽었을 때 404 를 내는 것도 재검토.
이 라우트 목적은 "SPA 를 그대로 돌려주되 og 태그만 갈아끼운다" 이므로,
읽기 실패는 `next()` 로 흘려보내 정적 폴백에 맡기는 편이 사용자에게 안전하다.

**배포 절차 관점**

`docs/OG_PREVIEW_NGINX_PROD.md` 는 "코드는 이미 배포돼 있다, 남은 것은 nginx 한 블록뿐" 이라고 적혀 있었으나
실제로는 운영 env 항목이 하나 더 필요했다. dev→운영 문서에 **운영에서 추가로 필요한 env** 섹션을 넣을 것.

⚠ 운영 `.env` 에 `SPA_INDEX_PATH` 가 들어가 있다. 재배포로 이 항목이 날아가면 `/insights/:slug` 가 다시 404 난다.

---

## #373 (bug/high) — #362 미완. 크롤러가 routes/og.js 에 도달하지 못한다

nginx 블록은 적용됐는데 **원래 불만은 그대로다.** 같은 URL, UA 만 다르게:

```
사람(Chrome)           : <title>워크스페이스 만들기 · PlanQ</title>       ← 정상
크롤러(Kakaotalk-scrap): <title>PlanQ — 일이 일이 되지 않게 …</title>     ← 기본 홍보문구
```

SNS 미리보기를 만드는 쪽은 크롤러다. 즉 #362 가 요청한 "링크 보낼 때 글 제목이 나오게" 는 아직 안 됐다.

**원인**

```
server.js:318  app.use(ogMetaMiddleware)             ← 먼저
server.js:479  app.use('/', require('./routes/og'))  ← 나중
```

`middleware/ogMeta.js` 의 봇 분기는 `/public/posts/:token`, `/sign/:token`, `/public/:type/:token` 만 처리하고
**마지막 "3) 그 외 = 기본 (랜딩) OG" 에서 `res.send()` 하고 끝난다 — `next()` 를 부르지 않는다.**
`/insights` 케이스가 거기 없으므로 봇 요청은 항상 이 catch-all 에서 소진되고,
크롤러용으로 만든 `routes/og.js` 의 `/insights/:slug` 핸들러는 봇에게 영영 도달하지 않는다 (사람 요청만 받는다).

**수정안**

`middleware/ogMeta.js` 봇 분기에 `/insights/:slug` 케이스를 추가한다 (봇 렌더의 단일 소유자를 미들웨어로 유지).

- 조건은 `routes/blog.js` 의 `BLOG_WHERE` 와 동일: `slug` + `blog_published_at IS NOT NULL` + `is_published` + `visibility='public'`
- 제목 `title_ko || title_en`, 설명 `summary_ko || summary_en` (200자 clip), 못 찾으면 기본 OG 폴백
- `routes/og.js` 와 술어가 갈라지지 않게 조건을 헬퍼로 빼서 양쪽이 같이 쓸 것

대안(비추): 미들웨어 마지막 분기를 `next()` 로 바꿔 og.js 로 넘긴다.
→ `/sign`, `/public/*` 등 기존 동작까지 영향 범위가 넓어진다. 케이스 추가가 안전하다.

**이번 nginx 적용으로 실제로 좋아진 것** (회귀 아님, 기록용)

- `/public/posts/:token` 크롤러 미리보기: 기본 문구 → 실제 제목
  (`"PlanQ — 리시피 공유 게시글 및 dm - 짜장떡볶이"` 확인).
  nginx 가 백엔드로 넘기기 전에는 정적 index.html 이 나가서 미들웨어가 아예 안 돌던 것이다.
- 사람 트래픽 무영향: `/insights/:slug`, `/public/posts/:token`, `/` 전부 200 + SPA 정상 부팅
  (`index-B90tysEw.js`, `<div id="root">` 확인). `/api/health`, `/locales/*` 도 무영향.

**미검증**

`/public/docs/:token` — 운영에 `share_token` 이 있는 `documents` 가 0건이라 실측 불가.
(테스트에 쓴 토큰은 `posts` 것이었고, 그때 기본 OG 가 나온 건 "못 찾으면 존재 여부 안 흘림" 정책대로 동작한 것)

**#362 검증 명령** — 여기에 글 제목이 나와야 닫을 수 있다

```bash
curl -s -A 'Kakaotalk-scrap' https://planq.kr/insights/create-workspace | grep og:title
```

---

## #370 (bug/high) — 자기발신 알림메일 로고가 매번 File 로 저장

워프로랩(business_id=1) Q File 의 **52%(524건 / 20.5MB)** 가 `planq-logo.png` 였다.
2026-07-02 ~ 08-22 누적, 하루 평균 ~15건. 전부 39,196 B 동일 바이트의 물리 복사본.

**체인**

1. `services/emailService.js:376` — 모든 알림메일에 로고를 inline cid 첨부로 붙인다
   (템플릿 `:153` 이 `<img src="cid:planq-logo@platform">`, `getLogoAttachment()` `:22` 가 `filename: 'planq-logo.png'`)
2. 그 메일이 `SMTP_FROM=help@irenewp.com` 으로 다시 들어오고 Q Mail IMAP 이 수집
   (inbound 2,274건 중 이 주소 발신 826건 = 36%)
3. **수신 측 메일서버가 `cid:` 를 `data:image/png;base64,…` 로 치환해서 배달한다.**
   실측: inbound 중 `body_html LIKE '%cid:%'` 9건, `data:image` 684건. 저장된 본문에 cid 문자열이 아예 없다.
4. `services/emailAttachments.js:27` `isEmbedded()` 가 "본문이 그 cid 를 참조하는가" 로만 판정 → 매칭 실패
   → fail-open 으로 false → `is_inline=0` (로고 첨부 524건 전부)
5. `services/emailImapCron.js:199` `saveAttachmentAsFile()` 이 `isNoiseAttachment()` 만 걸러내고
   inline 여부와 무관하게 무조건 File row + 물리파일을 만든다
6. 부수: `routes/files.js:616` 의 content_hash 중복제거(ref_count)를 메일첨부 경로가 안 탄다
   (`saveAttachmentAsFile` 이 content_hash 를 안 채움 — 524건 전부 NULL)

★ **#215 의 fail-open 정책 자체는 옳다.** 문제는 그 술어가 "첨부 칩에 보여줄지"(표시)용인데
  "File 을 만들지"(저장)에도 그대로 쓰인 것. 로고는 표시가 아니라 저장 단계에서 걸러졌어야 한다.
  #215 가 막으려던 사고(세금계산서 숨김)와는 다른 축이므로 **표시 술어 `isEmbedded` 는 건드리지 말 것.**

**수정 A (필수)** — `saveAttachmentAsFile()` 에 저장 게이트 추가

판정 재료 (실측 기준):
- `att.contentId === LOGO_CID` (`'<planq-logo@platform>'`, `emailService.js` 상수 import 해서 하드코딩 회피) — 로고 524건 전부 이 값
- 또는 발신 == `process.env.SMTP_FROM` **AND** `triage_headers` 에 `auto-submitted: auto-generated`
  ※ 이 헤더는 소급 판정엔 불완전 — 826건 중 416건만 보유(헤더가 나중에 추가됨). 신규 수신엔 유효.

해당 시 File 을 만들지 않고 `file_id: null` 로 `EmailAttachment` row 만 남긴다
(#215-G 의 노이즈 MIME 처리와 동일 패턴 — 원본 재구성 가능성 보존).

**수정 B (권장)** — 메일첨부에도 content_hash 중복제거 적용

`routes/files.js:616` 과 같은 경로를 타게 한다: `sha256(att.content)` → 같은 business_id 에
동일 hash + `deleted_at IS NULL` 인 File 이 있으면 물리 저장 없이 `ref_count` 증가 후 그 id 반환.

- A 만 하면 로고는 막히지만 반복되는 다른 첨부(거래처 서명 이미지, 뉴스레터 배너 등)는 계속 쌓인다
- **B 만 하면 안 된다** — File 1개 + `ref_count` 524 가 되어 Q File 목록엔 여전히 보인다. A 가 선행
- 삭제 경로(`routes/files.js:919~929`)는 이미 ref_count 감소 + 0 일 때만 물리 삭제라 그대로 정합

**운영 소급 정리 (완료)**

524건 soft delete + `email_attachments.file_id=NULL, is_inline=1` 정정,
물리파일은 `/opt/planq/backups/logo-cleanup-20260822_024124/` 로 격리 이동(`affected.json` 으로 롤백 가능).
워프로랩 Q File 997건 → 478건, `uploads/1/email` 82MB → 61MB.

대상 기준은 **파일명이 아니라 `content_id='<planq-logo@platform>'`**.
`file_name LIKE '%planq-logo%'` 로 잡으면 외부(jwchoi@kiyul.co.kr)가 실제로 보낸
동명의 Gmail 인라인 이미지 1건(`content_id='<ii_19f55731ef3b21e712b1>'`)까지 딸려온다.

**검증** (dev 수정 배포 후 하루)

```sql
SELECT DATE(created_at) d, COUNT(*) c FROM files
WHERE file_name LIKE '%planq-logo%' AND deleted_at IS NULL GROUP BY d ORDER BY d DESC LIMIT 5;
-- 적용일 이후 0 이어야 함
```
- 알림메일 수신 후 Q Mail 스레드 상세에서 로고가 **본문에 여전히 보이는지** (A 는 File 생성만 막는다)
- 다른 워크스페이스 정상 첨부(세금계산서·영수증)가 계속 File 로 저장되는지 회귀 확인 — #215 재발 방지

---

## #371 (improve) — Q Mail 이 PlanQ 자기발신 알림메일을 다시 수집

inbound 2,274건 중 `from_email='help@irenewp.com'`(= `SMTP_FROM`) 이 **826건 (36%)**.
건당 `body_html` ~58KB (대부분 로고 base64). #370 의 상위 원인이기도 하다.

`auto-submitted: auto-generated` 헤더는 이미 붙여둔 상태다 (triage 오분류 방지용 — 붙이기 전에는
"답변 필요" 116건 중 93건이 이것 때문이었다). 같은 헤더로 **수집 단계에서 스킵**하거나
별도 라벨/폴더로 격리하는 것을 검토.

⚠ "PlanQ 가 나에게 보낸 알림을 메일함에서도 보고 싶다" 는 요구가 있을 수 있어 **Irene 판단 필요**.
스킵이 아니라 격리 쪽이면 스레드 목록 기본 필터에서 빼는 정도로도 충분하다.

---

## #372 (bug/normal) — business_storage_usage 카운터가 실제와 불일치

```
카운터(biz 1)                          = 14건  /  53,676,225 B
실제 files(planq, deleted_at IS NULL)  = 961건 / 183,289,407 B
그중 메일첨부 아닌 것만                  = 47건  /  99,955,706 B
```

즉 (a) 메일첨부(`emailImapCron.saveAttachmentAsFile`)는 이 카운터를 아예 증가시키지 않고,
(b) 메일첨부를 빼고 봐도 47건 vs 14건으로 이미 어긋나 있다.
biz 5 는 17건 2.7MB 를 쓰는데 카운터는 0 이다.

**영향**: 스토리지 쿼터가 실제 사용량을 못 막는다.

**할 일**
- `saveAttachmentAsFile()` 이 `services/storageUsage.js` 를 경유하게 한다
  (⚠ 그 파일 `:72` 경고 — 자체 트랜잭션을 여니 다른 트랜잭션 안에서 호출 금지)
- 전 워크스페이스 카운터 재계산 백필 1회
- 참고: 로고 524건 정리 시 이 카운터는 **일부러** 안 건드렸다. 반영된 적이 없어서 차감하면 더 틀어진다.

---

## 운영 쪽 참고 파일

| 경로 | 내용 |
|---|---|
| `/opt/planq/SESSION_STATE.md` | 2026-08-22 작업 기록 + 주의사항 |
| `/opt/planq/backups/ops-20260822/` | 이번에 쓴 스크립트 3종 (로고 정리 / nginx 패치 / 피드백 등록) |
| `/opt/planq/backups/logo-cleanup-20260822_024124/` | 격리된 로고 파일 524개 + `affected.json` (롤백용) |
| `/opt/planq/backend/.env.bak-og362-20260822_033424` | SPA_INDEX_PATH 추가 전 백업 |
| `/etc/nginx/sites-available/planq.kr.bak-og362-20260822_033141` | nginx 블록 삽입 전 백업 |
