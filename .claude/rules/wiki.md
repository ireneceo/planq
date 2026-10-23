---
paths:
  - "dev-backend/routes/wiki.js"
  - "dev-backend/routes/admin_wiki.js"
  - "dev-backend/services/wiki*"
  - "dev-backend/setup-wiki-schema.js"
  - "dev-backend/seed-wiki-content.js"
  - "dev-frontend/src/pages/Wiki/**"
  - "dev-frontend/src/pages/Help/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# Q위키(help_*)

**Q위키 (2):** **help_categories**, **help_articles** (2026-06-18 신규 — PlanQ 제품 사용법 도움말. 플랫폼 공통 콘텐츠(business_id 없음), 격리 축은 article.visibility('public'/'authenticated')만. help_articles FULLTEXT(ngram) 한글검색 + body ko/en JSON 블록. 본문 임베딩은 **kb_chunks 재사용**(source_type ENUM 'kb'/'wiki' 추가 + source_id + business_id/kb_document_id nullable — wiki chunk는 플랫폼 공통이라 NULL, 워크스페이스 KB 검색 비오염). 스크린샷은 File 재사용(image 블록 file_id). 운영 적용 시 `dev-backend/setup-wiki-schema.js`(FULLTEXT+ALTER 멱등) + `seed-wiki-content.js`(콘텐츠) 실행. 설계 docs/Q_WIKI_DESIGN.md)

