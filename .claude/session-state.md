## 현재 작업 상태
**마지막 업데이트:** 2026-05-04
**작업 상태:** 완료 — Q-Q 사이클 (랜딩 풀세트 + Q Task 상세 폼 통일 + PWA 게이트) 운영 라이브

### 진행 중인 작업
- 없음

### 다음 사이클 (합의 완료, 즉시 시작 가능)

**주간 보고 (Weekly Review) 기능** — 설계 문서: `docs/WEEKLY_REVIEW_DESIGN.md`

- Q Task 페이지 안 4번째 탭 "주간 보고" + "이번 주 마무리" 버튼 + "한 주 메모" 모달
- 자동 박제 (매주 일요일 23:59 ws_tz) + 수동 박제 (사용자 클릭)
- 신규 테이블 2개 (`weekly_reviews`, `weekly_review_settings`) — 기존 0 변경
- 자동 ON/OFF 토글: `/business/settings/notifications` 신규 섹션 + Q Task 탭 우측 둘 다
- 라벨 합의: "주간 보고" / "이번 주 마무리" / "한 주 메모"
- snapshot_data JSON 저장 → 통계 활용 (Phase 3 — Insights 신규 탭 "주간 추세")

**원칙: 기존 코드·layout·테이블 0 변경. 추가만.**

체크리스트는 docs/WEEKLY_REVIEW_DESIGN.md §15 참조.

### 완료된 작업 (이번 세션)
- **`f7256ac`** (operational) — 랜딩 풀세트 (Home/Features/Pricing/Blog/About/Contact + LandingLayout + i18n 200+키) + Q Task 상세 폼 통일 (셀 순서/styled/AI 추천/반복하기) + 백엔드 PUT recurrence_rule + PWA banner 비로그인 미노출 + RootRoute POS 패턴
- 이전 사이클 (`abe697f` 까지): 알림 매트릭스 grid 4컬럼 fix / candidates dedup / chunk fail 자동 reload / 담당자/프로젝트 변경 / AI 예측 버튼 / 업무 추출 default 담당자

---

## 환경
- **운영 라이브**: https://planq.kr (`f7256ac`, timestamp `20260504_182803`)
- **dev**: dev-backend port 3003 (planq-dev-backend), dev.planq.kr
- **운영**: backend port 3004 (planq-prod-backend), q-note port 8001 (planq-prod-qnote)
- DB: dev planq_dev_db, 운영 planq_prod_db (양쪽 sync)
- 백업: `/opt/planq/backups/20260504_182803` (운영서버)

---

## 복구 가이드

새 Claude 세션 시작 시:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
다음 사이클은 docs/WEEKLY_REVIEW_DESIGN.md 의 Phase 1 부터.
```
