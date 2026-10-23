---
paths:
  - "dev-backend/routes/admin_social.js"
  - "dev-backend/routes/insight_og.js"
  - "dev-backend/services/social/**"
  - "dev-backend/services/ogSources.js"
  - "dev-frontend/src/pages/Admin/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# SNS 발송(플랫폼 마케팅 도구)

**SNS 발송 (3, 2026-10-22 · 플랫폼 마케팅 도구 — business_id 없음, platform_admin 전용):** social_accounts · social_posts · social_post_logs + `help_articles.og_image_path`. 설계 docs/SNS_PUBLISH_DESIGN.md
- **대상 글 = `publicContent.BLOG_WHERE`**(랜딩 /insights 와 같은 술어 — how-to 제외). 화면 플랫폼 관리자 > SNS 발송(`/admin/social`, 서버 `routes/admin_social.js`).
- **글별 링크 미리보기 이미지의 공개 문은 `GET /api/insights/:slug/og.jpg` 하나**(`routes/insight_og.js`, `publishedInsightWhere` 아니면 404 · uploads 를 통째로 열지 않는다). 주소는 `ogSources.insightOgImageUrl` 한 함수 — 봇 응답(ogMeta)·정적 페이지(seoArtifacts)가 같이 쓴다.
- **게시물 상태를 바꾸는 문은 `services/social/socialTransition` 하나**(승인 뒤 고치면 draft · 게시함/취소는 수정 409 · 전이마다 social_post_logs + writeAudit). 채널 목록은 `services/social/channels` 한 벌(Threads 포함 · 네이버·카카오 = 반자동).
- 카드 렌더는 PDF 브라우저를 빌린다(`retainBrowser` 를 newPage 앞에서) · 글자가 넘치면 저장하지 않고 422. AI 초안 목적 `social_draft`.
- **단계 1 = 외부 발송 없음.** OAuth·예약 cron·공개 미디어 주소는 단계 2(설계 §3~5, Fable 지적 2~8). 운영 `migrate-social.js`(배포 슬롯, 코드보다 먼저). 회귀 `--suite socialadmin` · health-check secrets «SNS 연결 계정».

