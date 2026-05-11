# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-11
**작업 상태:** 완료 — v1.6.0 운영 라이브
**버전:** v1.6.0 운영 라이브 (commit `eb8769a`, deploy 110s)

---

## 진행 중인 작업
- 없음 (사이클 N+9 핵심 완료 — 청크 5 시각 시그널은 보강 청크)
- lua 의 모바일 반응형 7 파일 미커밋 (대기)

---

## 완료된 작업 (이번 세션 — 사이클 N+9)

### 청크 1 — DB 4단계 visibility (commit e04a71b)
- files / posts (vlevel) / kb_documents / invoices.owner_user_id 컬럼 + ENUM
- 마이그레이션 백필 (운영 files 5 + posts 3 백필, invoices 0)
- access_scope 옵션 A 헬퍼 6종 (canAccess + listWhere × file/post/kb)
- getUserScope.projectMemberIds 추가

### 청크 2 — 개인 보관함 (commit 8cc69e7)
- 사이드바 협업/개인 섹션 (sectionFeatures → 협업 + sectionPersonal 신설)
- `/personal-vault` 라우트 + PersonalVaultPage (4 탭: 대시·문서·파일·지식)
- backend `/api/personal-vault/{summary,files,posts,kb-documents}` 4 라우트
- 첫 사용 explainer (localStorage dismiss)

### 청크 3 — 라우트 옵션 A 본격 적용 (commit a41a6ea)
- files/posts/search 라우트 listWhere → ByLevel 점진 교체
- canAccessFileByLevel / canAccessPostByLevel 단건 검사
- client 는 옛 헬퍼 보존 (project-client 자기 프로젝트만)

### 청크 4 — Visibility 배지 + 변경 API (commit 59f6f25)
- VisibilityBadge (4 단계 아이콘 + 색)
- VisibilityChangeModal (L1/L2/L3 picker + project 선택)
- PUT /api/files/:bizId/:id/visibility + PUT /api/posts/:id/visibility

### 이미지 lightbox + 공유 첨부 다운로드 (commit d812068)
- ImageLightbox 컴포넌트 (풀스크린 portal, Esc/배경 닫기)
- LightboxWrapper (자식 <img> 클릭 위임, ProseMirror 편집 영역 제외)
- Tiptap Image extension width attribute + BubbleMenu S(33%)/M(66%)/L(원본)
- backend `/api/posts/public/:token/attachments/:attId/download` 공개 라우트

### 문서 이미지 → File 통합 + OG (commit da8c80f)
- POST /editor-image: business_id 받으면 표준 File 테이블에 row 생성
  (visibility=L1 default, Q file 메뉴에 보임 + share-link 가능)
- PostEditor businessId prop (3 호출처 — DocumentEditorPage, PostsPage, ProjectPostsTab)
- PostEditor borderless prop + PublicPostPage 적용 (이중 박스 제거)
- index.html generic OG / Twitter 메타 (PlanQ 로고 512px)

### 헬스체크 fix (commit eb8769a)
- VisibilityChangeModal raw <select> → PlanQSelect

### 검증
- 누적 E2E 19/19 PASS (DB ENUM + 옵션 A + personal-vault + visibility 변경 + 공유 + editor-image + 마이그레이션)
- 헬스체크 27/27
- 빌드 2.27s, TS 에러 0
- 외부 https://planq.kr/api/health 200, planq-prod-backend v1.6.0

### 운영 배포
- commit `eb8769a` (누적 7), deploy-planq.sh --auto, 110s
- 백업: `/opt/planq/backups/20260511_175933`
- 운영 DB 사전 처리: invoices.owner_user_id 컬럼 ALTER (sequelize sync 의 "Too many keys" 회피)
- 운영 마이그레이션 백필: files 5 (L3=3+L2=2) / posts 3 (L2=3) / invoices 0

---

## 메모리 박제 (이번 세션)
- 새 박제 없음 — 기존 설계 (VISIBILITY_VOCABULARY.md + PERSONAL_VAULT_DESIGN.md) 그대로 구현

---

## 다음 할 일

### 청크 5 (남은 작업 — 다음 사이클)
- VisibilityBadge 카드/행 적용 (Q file, Q docs, Q info 의 모든 카드)
- VisibilityChangeModal 진입점 연결 (배지 클릭)
- 5중 시각 시그널 (헤더 sub-line / 프로젝트 노트 dismiss 박스 / popup 자물쇠 / FirstVisitTour)
- DocsTab 카드 hover share 아이콘 (사용자 요청 잔여)
- 동적 OG (backend SSR `/public/posts/:token` HTML 응답 + 운영 nginx /public/* proxy 변경)

### 다른 차순위
- Q note 텍스트 type + Quick Capture (중)
- Custom SMTP (Pro+) (소)
- 설문 기능 MVP (4 사이클, docs 완료)
- AI 사용량 세분화 + Task AI 예측·번역 recordUsage 통합

---

## 환경변수 / 인증 현황
- SMTP 5개 dev/prod populated
- DEEPGRAM 양쪽 EMPTY
- JWT_SECRET dev/prod 분리
- platform_admin: irene@irenecompany.com (dev), irene@irenewp.com (prod)
- .env 권한 640

---

## 주요 문서 위치
- 권한 매트릭스: `/opt/planq/docs/PERMISSION_MATRIX.md`
- 4단계 visibility: `/opt/planq/docs/VISIBILITY_VOCABULARY.md`
- 개인 보관함 설계: `/opt/planq/docs/PERSONAL_VAULT_DESIGN.md`
- 공유 미리보기 정책: `/opt/planq/docs/SHARE_PREVIEW_POLICY.md`
- 설문 기능 설계: `/opt/planq/docs/SURVEY_SYSTEM_DESIGN.md`
- 개발 로드맵: `/opt/planq/DEVELOPMENT_PLAN.md`

---

## 복구 가이드
새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
