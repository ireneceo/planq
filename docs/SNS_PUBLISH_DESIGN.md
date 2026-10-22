# 인사이트 글 SNS 발송 — 설계 초안 (2026-10-21 · [Opus] · Fable 설계 판정 전)

> Irene 원문(10-21): «인사이트에 있는 글을 하나씩 SNS에 자동으로 발송하게 해줘. 플랫폼관리자에서 계정연결하게 해줘.
> 보낼 수 있게 안내도 넣어주고. 글이랑 영상 각각 마케팅 탁월하게 제작해서 보내게 …»
> 상의 답(10-21): «어. 그렇게 하는데 스레드 꼭 넣어줘.» — 상의 문서 `docs/SNS_PUBLISH_CONSULT.md` §7 권고안 승인.
>
> 확정된 결정: 1차 채널 = LinkedIn 회사 페이지 · Facebook 페이지 · Instagram 비즈니스 · **Threads(필수)** /
> 네이버 블로그·카카오 채널 = 반자동 / X·TikTok 보류 / YouTube = 영상 단계에서.
> 방식 = AI 초안 → 사람 승인 → 예약 자동 발송(무인 발송 없음). 영상 = 카드 → 쇼츠 자동(ffmpeg 필요) + 시연 영상은 사람이 올림.

## 0. 범위 밖 (이번에 안 함)
- 워크스페이스(고객사) 기능이 아니다. **플랫폼(PlanQ 회사) 마케팅 도구**다 — business_id 없음, platform_admin 전용.
- 무인 자동 발송 · X · TikTok · AI 아바타 영상 · 광고 집행.

## 1. 데이터

### `social_accounts` (연결된 채널 계정 — 플랫폼 공통)
| 칸 | 뜻 |
|---|---|
| id · provider ENUM('linkedin','facebook','instagram','threads','youtube') | |
| external_id | 페이지/조직/IG 사용자/Threads 사용자 id |
| display_name · avatar_url | 화면 표시 |
| access_token_enc · refresh_token_enc | `services/encryption` 암호문. 전역 toJSON 이 `_enc` 를 내린다(CLAUDE.md 보안 8) |
| token_expires_at | 만료 7일 전 플랫폼 관리자 알림(platformNotify, 메일 1통/일) |
| status ENUM('active','expired','revoked','error') · last_error | |
| connected_by · connected_at | |
- 한 provider × external_id = 1행(UNIQUE). Facebook·Instagram 은 같은 Meta 연결 한 번으로 두 행이 생긴다(페이지와 연결된 IG 계정).

### `social_posts` (채널 한 곳에 나가는 게시물 1건)
| 칸 | 뜻 |
|---|---|
| id · article_id(FK help_articles) · account_id(FK) · provider | |
| angle | 같은 글을 다른 각도로 재사용(1~4) |
| kind ENUM('text','image','carousel','video') | |
| body | 채널별 본문(사람이 고칠 수 있음) |
| first_comment | LinkedIn 링크용 첫 댓글(선택) |
| link_url | 글 주소 + `utm_source=<provider>&utm_medium=social&utm_campaign=insight_<slug>` — **서버가 만든다**(화면이 보낸 링크를 그대로 쓰지 않음, 우리 도메인만) |
| media JSON | `[{file, w, h, mime}]` — `uploads/social/<yyyy-mm>/<uuid>.png` |
| status ENUM('draft','approved','scheduled','sending','sent','failed','canceled') | |
| scheduled_at · sent_at · approved_by · approved_at | |
| external_post_id · external_url · error_message | |
| metrics JSON · metrics_at | 5단계 |
- 반자동 채널(naver·kakao)은 provider 에 넣되 account_id NULL · 상태는 draft → approved → **«게시함 표시»(sent, 사람이 누름)** 만.

### `social_post_logs` — 상태 전이·외부 호출 결과(요청/응답 코드·오류). 외부 발송 = 처음부터 기록(CLAUDE.md 운영 안정성 6).

## 2. 상태 전이 — 문은 하나 (`services/social/socialTransition.js`)
draft →(승인) approved →(예약 시각 지정) scheduled →(cron 점유) sending → sent | failed · draft/approved/scheduled →(취소) canceled · failed →(사람이 [다시 보내기]) scheduled.
- **승인한 뒤 본문·이미지를 고치면 draft 로 돌아간다**(승인한 것과 나가는 것이 같아야 한다).
- **이중 게시 방지**: cron 은 `UPDATE … SET status='sending' WHERE id=? AND status='scheduled'` 영향 1행일 때만 보낸다.
  `sending` 이 10분 넘게 남은 행은 자동 재시도하지 않고 failed(«결과 모름 — 채널에서 확인 후 다시 보내기») — 다시 보내 두 번 게시되는 것보다 사람이 보는 것이 낫다.
- 한 계정 하루 상한(Instagram 공식 한도보다 낮게: 계정당 하루 5건) · 같은 글 같은 채널 3일 간격.

## 3. 채널 어댑터 (`services/social/<provider>.js` — 같은 모양)
`publish(account, post) → {external_post_id, external_url}` · `refresh(account)` · `metrics(account, post)` · `describeRequirements()`(안내 문구 키).
| 채널 | 게시 방식 | 미디어 |
|---|---|---|
| LinkedIn | `/rest/posts`, author = organization URN, 이미지는 Images API 로 **바이트 업로드** | 공개 주소 불필요 |
| Facebook 페이지 | Graph `/{page}/photos`(멀티파트 업로드) · 여러 장은 unpublished 사진 → feed attached_media | 공개 주소 불필요 |
| Instagram | Graph 컨테이너 생성(image_url) → 발행 · 캐러셀은 자식 컨테이너 | **공개 주소 필요** |
| Threads | Threads API 컨테이너(image_url) → 발행 · 캐러셀 지원 | **공개 주소 필요** |
- 앱 자격(client id/secret)은 플랫폼 설정에 암호화 저장(Apple·Stripe 선례, 재표시 없음).

## 4. 공개 미디어 주소 (새 무인증 표면 — Fable gate 대상)
- `GET /api/social-media/:token` — token = 32바이트 무작위(hex 64자), 게시물 미디어 1개에 1개.
- **열리는 기간**: 그 게시물이 scheduled/sending 인 동안 + sent 뒤 24시간. 그 밖은 404. 이미지(png/jpeg)만, `Cache-Control: private, max-age=300`.
- 이미지 내용은 어차피 곧 SNS 에 공개될 마케팅 카드라 비밀은 아니지만, 승인 전 초안이 밖에서 보이지 않게 기간을 건다.
- 레이트리밋 IP 분당 60 · `X-Robots-Tag: noindex`.

## 5. OAuth 연결 (관리자 전용)
- 시작 `GET /api/admin/social/:provider/connect`(authenticateToken + requireRole platform_admin) → 공급자 동의 → 콜백 `GET /api/admin/social/:provider/callback`.
- 콜백은 브라우저 리다이렉트라 토큰이 없다 → **state = 서명된 1회용 값(관리자 id·provider·10분)**, 사용 후 폐기. 실패는 관리자 화면으로 이유 코드와 함께 돌려보낸다.
- 받은 장기 토큰만 저장(Meta 는 60일 장기 토큰으로 교환 → 페이지 토큰). LinkedIn 은 갱신 토큰이 없을 수 있다 → 만료 7일 전 «다시 연결» 알림.
- 연결 해제 = 토큰 지움 + 공급자 revoke 호출(가능한 곳).

## 6. 소재 만들기
- 본문: `services/llm.callLLM` 목적 `social_draft` — 글 본문 블록 → 채널별 본문·훅 5개·카드 문구 JSON. 비용은 플랫폼 몫(cue_usage 에 안 셈), 관리자 per-user 레이트리밋.
- 카드 이미지: 템플릿 4종(문제제기·체크리스트·전후비교·숫자) HTML → `pdfService.getBrowser()` 재사용 screenshot(1080×1350 · 1200×630 · 1080×1920). 글자 넘침 검사(넘치면 생성 실패로 표시, 조용히 자르지 않음).
- **글별 링크 미리보기 이미지(1단계)**: `help_articles.og_image_path`(새 칸) — 있으면 `middleware/ogMeta` 가 그 글 주소에 쓴다. 없으면 지금처럼 기본 이미지.
- 쇼츠(4단계): 카드 PNG → ffmpeg(장면 전환·자막) 1080×1920 mp4. ffmpeg 없으면 버튼 비활성 + 이유.

## 7. 화면 — 플랫폼 관리자 > «SNS 발송» (`/admin/social`, ADMIN_MENUS + 탭 라우트 3곳)
1. **계정 연결** 칸: 채널 카드(상태·만료일·[연결]/[다시 연결]/[해제]) + «연결하려면» 접는 안내(비즈니스 계정 전환 · 페이지 관리자 권한 · 앱 심사 상태). Threads 카드 포함.
2. **글** 칸: 인사이트 글 목록(채널별 보냄/예약 수) → [소재 만들기] → 우측 패널(DetailDrawer): 카드 미리보기·채널별 본문 편집(자동저장)·[승인]·[예약](시각) — 반자동 채널은 [원고 복사]·[이미지 내려받기]·[게시함 표시].
3. **발송 일정** 칸: 예약/보냄/실패 목록 · 실패 이유 · [다시 보내기]·[취소].
- 외부로 나가는 [승인·예약]은 ConfirmDialog 에 **어느 계정(이름)으로 · 언제** 를 적는다(외부 발송 확인 규칙).
- i18n ko/en · 실시간(관리자 방 신호) · 3폭.

## 8. 단계
1. 글별 링크 미리보기 이미지 + 카드 템플릿 + 관리자 화면(글·소재·승인) + 반자동(네이버·카카오) — **외부 발송 없음**
2. 계정 연결(Meta: Facebook·Instagram·Threads / LinkedIn) + 공개 미디어 주소 + 예약 발송 cron
3. 성과 읽기(채널 API) + 글별 가입 수(signup_source)
4. 쇼츠 자동 생성 + YouTube
- Irene 할 일(채널별 하나씩): Meta 비즈니스 인증·앱 만들기·권한 심사(pages_manage_posts · instagram_content_publish · threads_content_publish) · LinkedIn Community Management API 신청 · 각 앱 자격을 관리자 화면에 넣기 · (4단계) ffmpeg 설치.

## 9. 운영 적용
- `scripts/migrate-social.js`(멱등: 표 3 · help_articles.og_image_path · platform_settings 자격 칸) — 배포 슬롯 등록, 코드 배포 전.
- 끄는 스위치: `.env SOCIAL_PUBLISH_ENABLED=1` 없으면 cron·발송·공개 미디어 주소 404(화면은 «발송 꺼짐» 표시).

## 10. 검증 계획
- 단계 1: 글 3편으로 카드·OG 이미지 렌더(글자 넘침 0) · OG 메타가 글별 이미지를 가리키는가 · 관리자 아닌 계정 403 · 승인 후 수정 → draft · health-check secrets.
- 단계 2: 각 채널 **시험 계정/비공개**로 실제 1건(외부 발송 — Irene 지시 뒤) · 이중 게시 방지(동시 cron 2개) · 공개 미디어 주소 기간 밖 404 · 토큰이 응답 원문에 0 · 만료 알림.

## 11. Fable 설계 판정 (2026-10-22) — VERDICT: PASS · 차단 0
저장소 확인: help_articles 에 og_image_path 없음 · 인사이트 OG 는 ogMeta.js:376-395 가 ogSources.resolveInsight(제목·요약만) · uploads 정적 서빙 없음 ·
routes/admin.js:14 가 /api/admin/* 전체를 platform_admin 으로 선점 · OAuth state 선례 services/ephemeralStore · dev 블로그 발행 글 30편(how-to 15·insights 13·updates 2).

**구현 전 설계에 반영할 비차단 지적(그대로 옮김):**
1. 단계 1 의 숨은 공개 표면 — OG 이미지: `GET /api/insights/:slug/og.jpg` 한 라우트, 판정 `ogSources.publishedInsightWhere(slug)` 아니면 404, `Cache-Control: public, max-age=86400`, sendFile, 재생성 시 `?v=<updated_at>`. ogMeta image 순서 «글 이미지 → settings.og_image_url → 기본». uploads 디렉토리 통째 static 금지.
2. OAuth 콜백을 `/api/admin/...` 에 두면 영영 401 → `/api/social-oauth/:provider/callback`(admin 밖) 또는 server.js:599 앞 마운트 중 하나 명시.
3. state 는 서명값이 아니라 `services/ephemeralStore`(구글·애플과 같은 벌, 1회 소비).
4. Instagram 은 JPEG 만 — sharp 로 JPEG 본도 만들어 media 에 두 경로, 공개 미디어 주소는 파일 그대로의 content-type.
5. 보내기 직전 재검사 — sending 점유 뒤 ①글이 아직 publishedInsightWhere ②계정 active, 아니면 failed(article_unpublished·account_inactive). 토큰 오류(Meta 190·LinkedIn 401) → 계정 expired/revoked + platformNotify.
6. scheduled 도 수정하면 scheduled_at 비우고 draft. sending·sent 수정은 409. 전이 함수가 막는다.
7. «결과 모름» failed 의 [다시 보내기] 는 ConfirmDialog 에 «채널에서 게시되지 않았음을 확인했다» 체크 필수(일반 failed 와 문구 가름).
8. 운영에서 fallback 암호키면 연결·앱 자격 저장 거절(routes/admin.js:692 선례, usingFallbackKey && production → 400).
9. 연결·해제·승인·예약·취소·게시함 표시는 writeAudit — social_post_logs 는 외부 호출 원장.
10. provider ENUM 에 naver·kakao 추가 + account_id NULL 허용.
11. 대상 글 = publishedInsightWhere 술어로 고정 + blog_category 범위(how-to 포함 여부) 명시.
12. 마이그레이션은 `dev-backend/scripts/migrate-social.js` · og_image_path 를 모델에 넣는다(sync alter 가 모델 밖 컬럼 DROP).
13. health-check secrets 1건 — `GET /api/admin/social/accounts` 원문에 토큰 0 + display_name 그대로(대조군). 앱 자격 칸은 `*_enc`.
14. callLLM purpose `social_draft` 를 PURPOSES 에 등록 + costGuard.perUserLimiter · 카드 렌더는 retainBrowser/releaseBrowser.
15. 토큰 보유 표시(token_set)는 인스턴스에서 읽어 서버가 만든다.

**단계 1(외부 발송 없음) 먼저 구현 — 된다.** 조건: 1·11·12·14 를 설계에 먼저 적고 시작. 단계 1 에 OAuth·cron·공개 미디어 주소·SOCIAL_PUBLISH_ENABLED 분기는 넣지 않는다(표 생성은 가능).
단계 1 검증 = §10 + «OG 라우트: 비공개 글 404 · 공개 글 200 · ogMeta 봇 응답 og:image 가 그 주소».
