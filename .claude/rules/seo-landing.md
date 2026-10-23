---
paths:
  - "dev-backend/services/seoArtifacts.js"
  - "dev-backend/services/publicContent.js"
  - "dev-backend/services/ogSources.js"
  - "dev-backend/routes/landing_visits.js"
  - "dev-backend/routes/og.js"
  - "dev-backend/routes/insights.js"
  - "dev-backend/routes/blog.js"
  - "dev-frontend/public/seo-pages.json"
  - "dev-frontend/index*.html"
  - "dev-frontend/src/pages/Landing/**"
  - "dev-frontend/src/components/Landing/**"
  - "dev-frontend/src/pages/Insights/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 랜딩 SEO·방문 집계

**랜딩 SEO · 방문 집계 (2026-09-21):** 대상은 **랜딩(공개 소개·인사이트·Q위키)뿐** — 워크스페이스는 대상 아니다.
공개 페이지 정본 `dev-frontend/public/seo-pages.json`(새 공개 페이지를 만들면 한 줄 추가). `services/seoArtifacts.js` 가
**운영 DB 기준으로 운영에서** 페이지별 HTML·`sitemap.xml`·`rss.xml` 을 만든다(배포 직후·서버 시작·매일 0시) — dev 빌드에서 만들면
dev 에만 있는 글이 운영에 샌다(그래서 배포 rsync 가 생성물을 뺀다). nginx 무변경: `/x` → `/x/` → `x/index.html`.
홈 description 은 Google OAuth 심사 목적 문장, `naver-site-verification` meta 는 네이버 소유확인 — **둘 다 지우지 말 것.**
★ 2026-09-22 — **본문도 HTML 에 싣는다.** 네이버·AI 크롤러(GPTBot·Perplexity·Claude)는 JS 를 대개 안 돌려 그동안 제목 한 줄만 봤다
(홈 513자·요금제 151자). 이제 `<div id="root">` 안 시각숨김 `<main id="seo-prerender">` 에 **화면과 같은 문구**
(`seo-pages.json` 의 `sections` = landing.json 키 · `faq` = FAQPage · `list` = 글 링크)를 넣고, 앱이 뜨면 React 가 갈아끼운다.
홈도 생성한다 — 빌드 원본은 `index.template.html` 로 보관. ★ nginx `gzip_static` 이라 **`.gz` 도 같이 쓴다**(옛 압축본이 있으면
구글봇·브라우저는 새 파일 대신 그것을 받는다 — curl 로 재면 멀쩡해 보인다).
방문 집계 `landing_visits`(숫자만)·`landing_visitors`(하루 비밀 해시) — 쿠키·IP·UA 저장 없음, 무인증 `POST /api/landing-visits` 는
랜딩 주소만·봇 제외·IP 분당 60. 조회는 플랫폼 관리자 > 랜딩 방문.

