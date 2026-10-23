---
paths:
  - "dev-backend/routes/admin_dev_status.js"
  - "dev-backend/services/devStatus*"
  - "dev-backend/scripts/*dev-status*"
  - "scripts/deploy-planq.sh"
  - "docs/dev-status/**"
  - "dev-frontend/src/pages/Admin/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 플랫폼 운영 — 배포별 개발 현황(dev_status_reports)

**플랫폼 운영 (1):** **dev_status_reports** (2026-09-03 신규 — 배포별 개발 현황. platform_admin 전용.
키는 `commit_to` UNIQUE (버전은 며칠씩 안 오르는데 배포는 하루 여러 번 한다 — version 을 키로 잡으면
그날 배포가 1행으로 덮인다). 기계가 아는 값(커밋 범위·배포 시각·롤백 경로·닫은 신고·스키마 변경 여부)은
`scripts/deploy-planq.sh publish_dev_status()` 가 `--meta` 로 주입하고, 사람은 `docs/dev-status/next.json` 에
서술 11섹션만 쓴다. **릴리즈노트(HelpArticle)와 같은 곳에 두지 않는다** — HelpArticle.visibility 는
('public','authenticated') 두 값뿐이라 넣는 순간 모든 로그인 사용자에게 흘러가고, 여기에는 미공개 이슈가 실린다.
화면 `/admin/dev-status` 는 **텍스트로만** 렌더한다(저장형 XSS 차단). 발행 스크립트는 `dev-backend/scripts/` 에
둔다 — 운영에는 루트 `scripts/` 가 없다(rsync 는 dev-backend 만 보낸다))

