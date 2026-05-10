## 현재 작업 상태
**마지막 업데이트:** 2026-05-10
**작업 상태:** 사이클 N+2 완료 + v1.3.0 운영 라이브

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**v1.3.0 운영 라이브 (`650fb6f`, 2026-05-10 11:11:54 UTC, 107s)**

**Race fix (자꾸 로그아웃):**
- `refresh_tokens.replaced_by_id` 컬럼 + 30초 grace window
- JWT payload 에 `jti` UUID 추가 — 같은 초 sign 시 token_hash 충돌 차단
- frontend `tryRefresh` 5xx/network 1.5s 재시도

**PWA 자동 무효화:**
- `vite.config.ts emitVersionJson` plugin → `/version.json`
- `main.tsx` Socket `server:build` 1차 + 5분 polling 안전망
- form-dirty 가드 (input/textarea/contentEditable + `data-form-dirty="1"`)
- `<UpdateBanner>` 토스트 ("나중에" / "지금 새로고침")
- SW `updateViaCache: 'none'` + 30분 update 체크

**표 (Q record) 고도화:**
- 시드 컬럼 제거 (빈 표 시작) + EmptyWrap 첫 컬럼 입력 CTA
- ColumnSettings popover (이름/타입/options/aggregate/Delete)
- `attach` 셀 type — 파일 업로드 / 파일 연결 / 문서 연결 / AI 새 작성→연결
- **행 자동 계산 4 type — row_sum / row_avg / row_min / row_max** (자동 계산 read-only `fx` 라벨)
- **footer 8 aggregate** + 친근화 라벨 ("값 있는 행 수" / "비어있는 비율" / "채워진 비율")
- 보기 모드 readOnly (PostsPage:805 readOnly={true})
- 본문 설명 에디터 — 빈 상태 닫힘 / 30자 초과 자동 펼침 / 양방향 토글 (DescBox 헤더 × 닫기)

**본문↔문서 통합 연결:**
- `posts.linked_post_ids` JSON 컬럼
- AttachmentField `includePosts={true}`
- 보기 모드 linked_posts chip (📄/📊)
- 자기 자신 link 차단 + invalid post_id 무시

**서명 받기:**
- PostSignatureModal 에 ContactPickWrap PlanQSelect — 멤버 + 고객 통합 자동완성
- 선택 시 빈 첫 행 채움 또는 새 행 추가, 중복 차단

**외부 점검 7원칙 (사이클 N+3 박제):**
- #1 `/api/push/test` per-user rate-limit (분당 5회)
- #2 form-dirty + reload 연기 + UpdateBanner
- #3 playPing 200ms debounce
- #4 push subscribe endpoint 화이트리스트 (https + FCM/Mozilla/Apple/Edge 도메인)
- #5 endpoint 재등록 cleanup (다른 user → 옛 row expired 마크)
- #6 **PushLog 테이블 신설** (모든 발송 기록 — user/sub/host/category/status/code/error/title)
- #7 권한 좀비 동기화 (`syncPermissionOnFocus` + `bindPermissionSync`)

**UX:**
- PwaInstallBanner "7일 안 보기" (localStorage) + dismissedUntil 가드
- 모바일 로그인 로고 200px → 140px (768px 이하)
- Q docs 새 문서 모달 blank/table 모드 dead UI 파일 업로드 제거
- 셀 흰 배경 + 행 hover #F8FAFC + 비표준 hex 토큰 교체 (#FAFBFC → #F8FAFC)

**규칙 박제:**
- CLAUDE.md "운영 안정성 규칙" 7개 섹션
- `memory/feedback_ops_stability_7.md` + MEMORY.md 인덱스

### 검증 결과 (직전)

- 헬스체크 27/27 PASS (모든 사이클)
- API 8/8 PASS — race + 화이트리스트 (FCM 201 / evil 400 / http 400) + rate-limit (200×5, 429) + PushLog 5건 + 재등록 옛 row expired
- 매트릭스 E2E — 행 합계 (370/600/900) + 평균 (123/200/300) + 열 합계 (600/650/620) + grand total 1,870
- 보안 — 자기 자신 차단 / invalid post_id 무시
- UI/UX 8단계 — i18n 0 hardcode, ko/en 키 100% 동기화, hex 모두 토큰
- 9 단계 모두 PASS

### 알려진 회귀 (다음 사이클 fix)

- `weeklyReviewCron` 매시 에러: `Unknown column 'BusinessMember.active'` (pre-existing, 이번 사이클 무관)
- 운영 nginx `/version.json` cache-control 헤더 누락 — 이번 배포 후 sudo SSH 로 적용 필요

### 다음 할 일 (사이클 N+3 후보)

1. weeklyReviewCron BusinessMember.active 회귀 fix (5분)
2. 운영 nginx /version.json + /sw.js + / no-cache add_header (sudo)
3. 사이클 N+1 박제 — list API `latest_estimation_source` 시각 분기 / 모달 통일 / 통합 공유 / Smart Routing
4. PushLog admin 통계 페이지 (이번 사이클은 모델만, UI 는 후속)
5. iOS 가이드 UA 분기 (Safari 16/17)

---

## 환경
- **dev:** dev.planq.kr (port 3003) — chunk `Bf7eOMAf` (build_id 1778410903329)
- **운영:** planq.kr (port 3004) — commit `650fb6f` (build_id 1778411490010)
- **DB:** dev `planq_dev_db` / prod `planq_prod_db`
- **PM2:** planq-dev-backend (1.3.0) / planq-prod-backend (1.3.0) / planq-qnote / planq-prod-qnote

## 운영 라이브 (마지막)
- commit: `650fb6f`
- timestamp: 2026-05-10 11:11:54 UTC (107s deploy)
- backup: `/opt/planq/backups/20260510_110953`
- 외부 health: ✅ 200
- 버전: **v1.3.0** (minor, 1.2.0 → 1.3.0)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
