## 현재 작업 상태
**마지막 업데이트:** 2026-05-03 11:00
**작업 상태:** 중단 (이어서 재개 예정 — Q docs 재구조 + 자료정리(Brief) 시작)

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해. memory/project_qdocs_restructure_brief_plan.md 의 3 commit 단위로 진행.
```

---

## 🔖 지금 중단 지점

**마지막 작업 (이번 세션, 14 commits 운영 라이브):**
- v1.1.0 운영 배포 (Q Note + Q Task 정기업무 + 백업 양방향 크로스)
- SaaS readiness 8 commit (외부 API timeout / fan-out 비동기 / pagination / AuditLog / pino+request_id / uploads cleanup / 권한 통일 / cue_usage 통합 추적)
- 운영 q-note 가동 (apt + venv + torch + requirements + PM2 + .env scp)
- JWT_SECRET / INTERNAL_API_KEY / PLANQ_NODE_BASE_URL 운영 ↔ q-note 일치
- platform_settings DB 이전 (모델·라우트·UI·운영 시드)
- DROPBOX 정리
- 사이드바 좌측 하단 표시 fix (워크스페이스 컨텍스트 우선)

**바로 다음 작업 (Q docs 재구조 + 자료정리):**
- 합의안: `memory/project_qdocs_restructure_brief_plan.md` (3 commit 순차)
- Commit 1 — 받은 서명 인박스 이전 (Q docs 페이지 = 문서만 깔끔, 받은 서명 = 인박스로)
- Commit 2 — 자료정리 (Brief) AI 모드 확장 (NewDocumentModal AI 탭에 모드 토글 + BriefComposer)
- Commit 3 — Brief 백엔드 + LLM (services/brief_service.js, posts.brief_meta JSON, cue_usage 'brief')

**맥락 유지할 것:**
- 이름: 한글 "자료정리", 영문 "Brief". Q 접두 안 붙임 (Q docs 안의 기능)
- 별도 메뉴 X. NewDocumentModal AI 탭의 "자료 업로드 → 정리" 모드
- 받은 서명을 인박스로 이전하면 Q docs 페이지 깔끔해짐 (탭 제거, 바로 PostsPage)
- URL 호환: `/q-docs?tab=received-signatures` → `/inbox?type=signatures` redirect

---

## 📦 이번 세션 작업 요약 (commit 14건)

- v1.1.0 운영 라이브 + 운영 q-note 정상 가동
- 백엔드 모든 LLM 호출처 cue_usage 통합 (answer / summary / task_execute / task_extraction / kb_embed / translation / brief 예정)
- 운영 ↔ q-note 환경변수 mismatch 모두 fix
- platform_settings DB 이전 (관리자 UI 에서 즉시 변경 가능)
- 사이드바 워크스페이스 컨텍스트 표시 (계정 vs 워크스페이스 분리 메모 정책 반영)

**커밋:** `f2ddb1f` 사이드바 좌측 하단 표시 fix — 워크스페이스 컨텍스트 우선

---

## 📂 다음 할 일 (우선순위)

### A. Q docs 재구조 + 자료정리 (다음 세션 첫 작업)
메모 `project_qdocs_restructure_brief_plan.md` 의 3 commit 단위 그대로.

### B. Phase 4 (트래픽 증가 시점)
- DAU 100+ → BullMQ + Redis worker
- 인스턴스 2+ 필요 → Socket.IO Redis adapter / multer → S3
- /insights 응답 1초 초과 → read-replica

### C. 운영 .env 보호 (다음 사이클 후보)
deploy-planq.sh 가 .env sync 제외라 신규 환경변수 추가 시 누락 가능. .env.example 동기화 또는 누락 시 경고 추가 검토.

---

## 🔑 환경
- dev backend port 3003 (planq-dev-backend), POS port 3001
- 운영 backend port 3004 (planq-prod-backend, **v1.1.0**), POS port 3002 공존
- 운영 q-note port 8001 (**planq-prod-qnote** ✅ 가동 완료)
- DB: dev planq_dev_db, 운영 planq_prod_db (양쪽 65 tables / 1039 cols 일치)
- 운영 q-note .env: OPENAI/DEEPGRAM key 채워짐, JWT_SECRET / INTERNAL_API_KEY / PLANQ_NODE_BASE_URL 운영 backend 와 일치
- 운영 platform_settings 테이블 시드됨 (id=1, brand=PlanQ, support_email=help@planq.kr, legal_entity=워프로랩)

---

## 📂 주요 위치
- v1.1.0 운영 라이브: `f2ddb1f`
- 합의안 메모: `memory/project_qdocs_restructure_brief_plan.md`
- SaaS readiness 메모: `memory/project_saas_readiness_2026_05_03.md`
- 백업 양방향: 메모 `project_backup_strategy.md`
- 운영 배포: `scripts/deploy-planq.sh`
