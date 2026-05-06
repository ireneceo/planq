## 현재 작업 상태
**마지막 업데이트:** 2026-05-06
**작업 상태:** 완료 — 주간 보고 Phase 1 + 약관 재동의 hotfix 운영 라이브 (`66f55da` 04:54:56 push)

### 진행 중인 작업
- 없음

### 이번 세션 (3 commit)

이전 세션 (lua) 의 미커밋 작업 검증·박제·배포 마무리.

**완료된 작업:**
- `4adcbc8` fix(auth): 약관 재동의 모달 hotfix
  - 랜딩 7 경로 (`/`, `/features`, `/pricing`, `/about`, `/contact`, `/blog`, `/legal/*`) 에서 모달 차단
  - 백엔드 `routes/users.js` PUT 에 `terms_accepted_at`/`terms_version`/`privacy_*` 분기 추가 (이전엔 무시되어 영구 루프)
  - `AuthContext.refreshUser()` 추가 → window.location.reload() 제거
- `58487e9` feat(qtask): 주간 보고 (Weekly Review) Phase 1
  - 신규 테이블 2 (weekly_reviews / weekly_review_settings)
  - 백엔드: 모델 2 + snapshot 빌더 + cron + 라우트 8 (758줄)
  - 프론트: 4 컴포넌트 + service + QTaskPage 4번째 탭 + NotificationSettings 자동토글 (1365줄)
  - utils/response.js 헬퍼 신규 (CLAUDE.md 표준 정착)
  - node-cron 의존성 추가
- `66f55da` docs(claude): 개발팀 + 협업 규칙 섹션

**중간 fix (사이클 살리기):**
- 이전 세션이 `npm install node-cron` 안 함 → 백엔드 부팅 실패 상태였음 → 설치
- `utils/response.js` 누락 → routes/weekly_reviews 가 require 실패 → 신규 헬퍼 작성

### 운영 라이브 결과
- URL: `https://planq.kr` (`66f55da`)
- 운영 백업: `/opt/planq/backups/20260506_045423` + `20260506_045456` (2회 deploy 흔적, 동일 commit)
- 헬스체크: planq.kr health 200, weekly-reviews 401 (auth 정상), frontend 200
- PM2: planq-prod-backend / planq-prod-qnote 모두 online

### 협업 룰 (Irene + lua)
- CLAUDE.md 에 개발팀/협업 규칙 섹션 추가됨 (commit `66f55da`)
- lua 작업 후 미커밋 상태로 남기면 다른 사람이 위에 덮어쓸 수 있음 → 자기 작업 자기가 끝까지 (코드→install→sync→build→검증→commit)
- PM2 권한: 현재 irene 계정에서만 restart 가능 → 다음 사이클에 sudoers 또는 systemd 분리 (lua 가 자기 백엔드 변경 후 직접 restart 가능하게)
- 같은 dev 서버·working tree 공유 환경의 한계 인정 → 장기적으로 옵션 B (별도 디렉/포트/DB/서브도메인) 검토

### 다음 할 일

**운영 확인 (Irene):**
- planq.kr 로그인 후 약관 모달이 메인에서 안 뜨는지 + 동의 시 닫히는지 확인 (당장 영향)
- `/tasks` 4번째 탭 "주간 보고" 진입 확인
- 헤더 우측 "이번 주 마무리" 버튼 동작 확인

**다음 진입 ★ 후보 (lua/Irene 협의):**
- 주간 보고 Phase 2 — Insights "주간 추세" 탭 (JSON 통계 활용)
- KB Phase 2 — PDF/docx 파일 업로드 + 다중 분리 정밀
- Q Task 정기업무 (RRULE) — `project_qtask_recurrence_plan.md`
- Q docs 재구조화 + 자료정리 Brief — `project_qdocs_restructure_brief_plan.md`
- 협업 인프라 — PM2 권한 분리 (sudoers / systemd) + 옵션 B 환경 분리 검토

---

## 환경
- **운영 라이브:** https://planq.kr (`66f55da`, timestamp `20260506_045456`)
- **dev:** dev-backend port 3003 (planq-dev-backend), dev.planq.kr — 헬스 200
- **운영:** backend port 3004 (planq-prod-backend), q-note port 8001 (planq-prod-qnote)
- DB: dev planq_dev_db, 운영 planq_prod_db (양쪽 weekly_review_* 테이블 존재)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
