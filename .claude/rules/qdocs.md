---
paths:
  - "dev-backend/routes/post*.js"
  - "dev-backend/routes/sign*.js"
  - "dev-backend/routes/survey*.js"
  - "dev-backend/routes/records.js"
  - "dev-backend/routes/docs.js"
  - "dev-backend/services/post*"
  - "dev-backend/services/sign*"
  - "dev-backend/services/survey*"
  - "dev-backend/services/actions/post_actions.js"
  - "dev-frontend/src/components/Docs/**"
  - "dev-frontend/src/pages/QDocs/**"
  - "dev-frontend/src/pages/Signatures/**"
  - "dev-frontend/src/components/Signatures/**"
  - "dev-frontend/src/pages/Public/**"
  - "dev-frontend/src/pages/Records/**"
  - "dev-frontend/src/pages/Settings/SignatureManageSection.tsx"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# Q docs — 댓글·서명·설문

**설문 (#460, 2026-10-07):** 새 표 없음 — **표 문서(`kind='table'`)의 «응답 받기» 문**이다. 문항 = 표 칸, 응답 1건 = 표 1줄(`created_by` NULL = 외부 응답), 통계 = 칸별 집계. 설계 docs/SURVEY_DESIGN.md
- 열쇠 `q_records.survey_token` 은 **쓰기만** 된다(문서 공유 열쇠와 따로). 응답을 읽는 공개 경로는 없다. 열쇠는 `GET /api/records/:id/survey`(켤 수 있는 사람)에서만 내리고 상세·목록은 `stripRecordSecrets` 로 뺀다 — 회귀 `health-check --category=secrets`.
- 무인증 표면 `routes/survey_public.js`(`/api/survey/:token`) — 판정은 매 요청 `services/survey.resolveSurveyToken` **한 함수**(문서 생존·워크스페이스 생존·`blocksExternalShare`·게시·마감·정원·하드캡 5,000). 레이트리밋 주 키 = 토큰. 화면 `/public/survey/:token`.
- 켜기 = 멤버 이상 ∧ `canEditPost`(L1 은 작성자만) · 보안등급 일반 아니면 켤 수 없고, 올리면 열쇠 회수. 운영 `migrate-survey.js`(배포 슬롯).

## 서명본은 **서버 한 곳에서 조립한다** (2026-09-22 박제)

> Irene: *"문서에 서명이 어떻게 나오는지 알 수 없어서 서명란을 입력하게 된다고 했는데"* → *"고쳐줘."*
> 설계·검증 정본: `docs/SIGNATURE_FIELD_DESIGN.md`

- **서명본 = 고정본(요청 때 동결한 본문) + 서명.** 조립은 `services/signedDocument.js` **한 함수**다 —
  앱 문서(`/api/posts/:id/signed-html`) · 공유 링크 · 공개 서명 화면 · PDF 넷이 같은 결과를 쓴다.
  화면이 각자 끼우면 네 곳이 갈라진다.
- **증명서 장(이메일·IP)은 멤버 PDF 에만.** 링크 소지자 누구나 여는 공개 PDF·공개 페이지에는 넣지 않는다
  (`postPdfHtml(..., { cert })`). 실측으로 확인한다 — HTML 에 없다고 PDF 에도 없는 것이 아니다(`pdftotext`).
- ★ **«볼 수 있는가» 는 본문과 같은 술어**(`routes/posts.js canReadPost`). 서명본만 `assertMember` 로
  막았더니 **고객이 자기 계약서를 열면 본문은 보이는데 서명 칸만 «서명 전»** 이었다 — 사용자에게는
  "서명했는데 안 들어갔다" 로 읽힌다(2026-09-22 실측 403 → 200).
- **보내는 쪽(우리)은 메일이 아니라 로그인으로 서명한다** — `routes/signature_internal.js`.
  증거(동의·시각·IP·UA·고정본 재해시·감사·알림·단계진행)는 공개 서명과 **같은 것**을 남긴다.
  메일이 안 나가므로 요청 상태는 `sent` 가 아니라 `pending` 이다.
- **서명자별 링크를 여러 사람이 보는 방에 올리지 않는다** — 채팅 카드에서 `sign_url` 을 뺐고,
  [서명하기] 는 본인 이메일로 보낸다(`POST /api/sign/request-link`, 무인증 · 10분 5회 ·
  명단에 없어도 **같은 응답**). 옛 카드에 남은 `sign_url` 도 화면이 읽지 않는다.
- 회귀: `node scripts/e2e/run.js --suite signature` (16검사 · 반증으로 5건 뒤집힘 확인).
- **서명 목록은 세 벌이 한 조각을 쓴다**(2026-10-23, Irene «보낸서명 리스트는 어딨어? … 설정에서 받은/보낸서명 관리 … 보낸담당자») — 개인 «받은·보낸 서명»(`/signatures/received`·`/sent`) ·
  설정 › 서명 관리(`/business/settings/signatures`, owner/admin). 응답 모양 `services/signatureList`(serialize·docAccessMap·hiddenRow) · API `routes/signatures_sent.js`.
  취소·재알림·회차 닫기 권한은 **`canManageRows` 한 술어**(요청자 ∨ 편집자 ∨ owner/admin ∧ 읽기 가능) — 읽을 수 없는 문서의 행은 가린다(제목·이메일·IP 없음, 검색도 읽을 수 있는 문서 안에서만).
  하드 삭제 없음(«삭제» = 요청 취소). 설계 `docs/SIGNATURE_MANAGE_DESIGN.md`.
- **서명·확인 요청이 살아 있는 문서는 «나만 보기»(L1) 가 될 수 없다 — 바닥 L2**(2026-10-23, Irene «서명을 회사이름으로 하면 개인이 마음대로 나만으로 하면 안되는 것 같은데» · Fable 설계 DESIGN-CHANGE) —
  party·kind 불문 · 살아 있음 = `SIGNATURE_ACTIVE_STATUSES`(서명 잠금과 같은 상수). 보낼 때 같은 트랜잭션에서 L2 로 올린다(프로젝트 문서 = 프로젝트, 없으면 특정 멤버 = 작성자 ∪ 우리 쪽 서명자) ·
  보낸 뒤 L1 로 좁히기는 **누구도** 못 한다(두 문 모두 409 `signature_visibility_floor`). 판정 `services/signatureCore.signatureVisibilityFloor` 한 곳 — 공개 범위를 바꾸는 새 문은 `blockIfBelowSignatureFloor` 를 부른다.
  옛 행 `scripts/migrate-signature-visibility-floor.js`(기본 읽기만). 회귀 `--suite sigfloor`. 설계 `docs/SIGNATURE_VISIBILITY_FLOOR_DESIGN.md`.
