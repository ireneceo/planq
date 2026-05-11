# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-11
**작업 상태:** 완료 — v1.6.1 운영 라이브
**버전:** v1.6.1 운영 라이브 (commit `d3e7f0a`, deploy 110s)

---

## 진행 중인 작업
- 없음
- lua 의 모바일 반응형 7 파일 미커밋 (대기)

---

## 완료된 작업 (이번 세션 — 사이클 N+9)

### 청크 1 (e04a71b) — DB 4단계 visibility
- files.visibility / posts.vlevel / kb_documents.scope('private') / invoices.owner_user_id 컬럼
- access_scope 옵션 A 헬퍼 6종 + getUserScope.projectMemberIds
- 마이그레이션 백필 (운영 files 5 + posts 3)

### 청크 2 (8cc69e7) — 개인 보관함
- 사이드바 협업/개인 섹션 + /personal-vault NavItem
- PersonalVaultPage 4 탭 (대시·문서·파일·지식)
- backend /api/personal-vault/* 4 라우트
- 첫 사용 explainer (localStorage dismiss)

### 청크 3 (a41a6ea) — 라우트 옵션 A
- files/posts/search listWhere → ByLevel 점진 교체
- 단건 canAccess 도 ByLevel 변환

### 청크 4 (59f6f25) — Visibility 배지 + 변경 모달
- VisibilityBadge (4 단계 아이콘+색)
- VisibilityChangeModal (PlanQSelect + project picker)
- PUT /api/files/:bizId/:id/visibility + /api/posts/:id/visibility

### 이미지 라이트박스 (d812068)
- ImageLightbox + LightboxWrapper (자식 img 위임, 편집 영역 제외)
- Tiptap Image width attribute + BubbleMenu S(33%)/M(66%)/L(원본)
- 공유 미리보기 첨부 다운로드 라우트 (/api/posts/public/:token/attachments/:id/download)

### editor-image File 통합 + OG (da8c80f)
- POST /editor-image business_id 받으면 표준 File 등록 (visibility=L1)
- Q file 메뉴 노출 + share-link 가능
- PostEditor businessId prop (3 호출처)
- PostEditor borderless + PublicPostPage 적용 (이중 박스 제거)
- index.html generic OG/Twitter 메타

### 헬스체크 fix (eb8769a)
- VisibilityChangeModal raw <select> → PlanQSelect

### 인박스 후보 link fix (d3e7f0a)
- task_candidate link → /tasks?scope=mine&tab=all&candidate=Y
- Conversation archived_at != null 제외
- Q task 우측 패널 자동 펼침 + CandCard 1.8s rose flash

### 검증
- 누적 E2E 19/19 PASS + 청크별 60+ PASS
- 헬스체크 27/27
- 빌드 1.5~2.3s, TS 에러 0
- 외부 https://planq.kr health 200, planq-prod-backend v1.6.1

### 운영 배포 (2회)
- 03:00 `eb8769a` v1.6.0 (110s, files 5+posts 3 백필)
- 03:26 `d3e7f0a` v1.6.1 hotfix (110s)
- 백업: /opt/planq/backups/20260511_182356

---

## 메모리 박제 (이번 세션)
- `feedback_inline_assets_as_files.md` (신규) — 본문 인라인 자료 표준 File 등록 강제
- `feedback_sync_alter_too_many_keys.md` (신규) — sequelize sync alter 누적 인덱스 회피
- 기존 `project_visibility_vocabulary` / `project_personal_vault` / `project_invoice_signature_owner` / `feedback_visibility_signal_required` 는 그대로 (구현 결과로 docs 만 업데이트)

---

## 다음 할 일 (DEVELOPMENT_PLAN.md 기반)

### 청크 5 (남은 — 사이클 N+10)
- VisibilityBadge 카드/행 적용 (Q file `DocsTab`, Q docs `PostsPage`, Q info 카드)
- VisibilityChangeModal 진입점 (배지 클릭)
- 5중 시각 시그널 (헤더 sub-line / 프로젝트 노트 dismiss 박스 / popup 자물쇠 / FirstVisitTour)
- DocsTab 카드 hover share 아이콘
- 동적 OG — backend SSR `/public/posts/:token` HTML + 운영 nginx `/public/*` proxy 변경

### 차순위
- Q note 텍스트 type + Quick Capture (중)
- Custom SMTP (Pro+) (소)
- 설문 기능 MVP (4 사이클, docs 완료)
- AI 사용량 세분화 + Task AI 예측·번역 recordUsage 통합
- Signature 알림 통일 (requester_user_id 기준)

### 잔여 follow-up
- lua 모바일 반응형 7 파일 — lua 마무리 대기

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
- 4단계 visibility: `/opt/planq/docs/VISIBILITY_VOCABULARY.md` (작업 매트릭스 §6 업데이트)
- 개인 보관함 설계: `/opt/planq/docs/PERSONAL_VAULT_DESIGN.md` (작업 범위 §8 업데이트)
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
