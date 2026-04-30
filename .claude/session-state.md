## 현재 작업 상태
**마지막 업데이트:** 2026-04-30 (개발완료)
**작업 상태:** 완료

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## 📦 이번 세션 작업 요약

**대규모 다중 사이클 — Q-A 부터 Q-G 까지 한 세션에 진행. 통계·분석 6탭 풀 구현 포함.**

### Q-A 정리 사이클 (production 정합성)
- QTalk **mock.ts + QDataContext.tsx 삭제** (CLAUDE.md 절대 금지 규칙 준수), `types.ts` 신규
- 사용자 노출 **엔지니어링 용어 정리** (Phase E·1·4 → 사용자 친화 텍스트)
- ProfilePage 한국어 하드코딩 제거 (언어 레벨 섹션 + LEVEL_OPTIONS + ExpertiseBtn)
- RightPanel taskStatusLabel/Color → 표준 `utils/taskLabel.ts` 통일
- LeftPanel border 색 표준화

### Q-B 보안 사이클
- `checkBusinessAccess` IDOR 강화 (URL path 만 신뢰)
- 회원가입 race condition (UniqueConstraintError catch)
- Refresh token cookie path 정합성 (logout 시 `/api/auth` + `/`)
- Invoices `sequelize.literal` → `fn(JSON_EXTRACT)` parameterized
- Platform admin businessRole 명시

### Q-C Push + 메일 사이클
- **VAPID 키 발급 + .env 입력 → Web Push 즉시 활성**
- `EmailLog` 모델 + `emailService.recordLog()` 자동 통합
- 관리자 메일 모니터링 페이지 (`/admin/email-logs`) — 상태 필터 + 재발송
- 알림 매트릭스 UI — ProfilePage 28 토글 (7 event × 4 channel)

### Dashboard + UserChip + 로고
- Dashboard placeholder → 위젯 페이지 (인박스 + 빠른 액션 + 미리보기 + 일정)
- 인사말 우측 상단 `UserChip` (모든 페이지 PageShell 공통)
- 로고 4종 적용 — favicon, PWA 192/512/180, 슬로건 흰색 (Login/Sidebar)
- manifest.json + apple-touch-icon

### PWA Install + Share Target
- `InstallPromptBanner` 모바일 하단 — Android beforeinstallprompt + iOS 단계 안내 + standalone 자동 감지 + 7일 dismiss
- 알림 권한 prompt → push subscribe 1탭
- `share_target` GET (title/text/url) → `/share-receive` → 채팅·업무·메모·문서 4 카드
- prefill 핸들러 (ChatPanel + QTaskPage)

### Q-G Insights 6탭 (★ 핵심 작업)
- 설계: `docs/INSIGHTS_DESIGN.md` (30년차 임원급 통합 설계)
- 백엔드: `routes/stats.js` + `services/stats.js` — 6 endpoints
- 프론트: `pages/Insights/InsightsPage.tsx` + 6 tabs + 공통 components.tsx + csvUtils.ts
- 6 탭: Overview / **Tasks & Time** ★ / Profit / Team / Finance / Reports
- 핵심 차트: Scatter (예측 vs 실제) + AI MAPE Line + 직원 가동률 Bar + 프로젝트 손익 Bubble
- 인사이트 박스 3층 (관찰→진단→처방) — 가로 inline 1줄 (Irene 피드백 반영)
- **CSV (Excel) 다운로드** 5탭 (UTF-8 BOM 한글 깨짐 방지)
- 라우트: `/stats/:tab` 단일 dynamic (이전 6 명시 라우트가 ComingSoonPage 가리던 버그 fix)

### I4 + P8.1
- RevisionPanel inline diff (splitInlineDiff + DeltaPill + form_data 풀기)
- TaskDetailDrawer Cue 섹션 (재실행 endpoint + 출처 chip + 마지막 이벤트 dot)

### 빌드 / 검증
- 마지막 빌드: exit 0
- 헬스체크: 27/27 통과 (반복)
- 신규 8+ endpoint 모두 E2E 통과

---

## 🔖 다음 할 일 (우선순위 순)

### N 운영 진입 마무리 (Irene 작업 + Claude 보조)
- `.env` 운영값 입력 (SMTP_HOST/USER/PASS, VAPID prod 별도 키 발급, PLANQ_BILLING_BANK_*, DOMAIN_NAME)
- 운영서버 nginx 설정 적용 + SSL 인증서
- PM2 prod 인스턴스 기동
- 첫 배포 후 헬스체크 + 핵심 플로우 E2E

### Insights Phase 2 후속 (1d ~ 2d)
- Reports 자동 생성 cron + PDF 템플릿 + 공유 링크
- Insights 데이터 시드 (실 매출/업무 데이터 입력 → 차트 시각 확인)
- xlsx 정식 파일 다운로드 (sheetjs) — CSV 외 옵션
- 직원별 카테고리 강점·약점 drawer (People 탭)

### Q-F 반응형 일괄 (Phase 8, 5~7d)
- 햄버거 2뎁스 아코디언 + 마스터-디테일 드릴다운 (메모리 등록)

### K — PortOne V2 + 팝빌 (~5d, 마지막)
- 운영서버 + 도메인 확정 후

---

## 🔑 환경변수 / 인증 현황

- 백엔드: port 3003 (PM2 `planq-dev-backend`, 정상)
- DB: planq_dev_db / planq_admin
- 도메인: dev.planq.kr (개발) / planq.kr (운영 미세팅)
- SMTP: **미설정** (운영 진입 전 필요)
- VAPID: ✅ **활성** (dev 키, 운영 진입 시 별도 키 발급)
- PLANQ_BILLING_BANK_*: **미설정** (운영 진입 전 Irene 입력 필요)
- 마지막 빌드: exit 0
- 헬스체크: 27/27 통과

---

## 📂 주요 문서 위치

- 프로젝트 가이드: `/opt/planq/CLAUDE.md`
- UI 가이드: `/opt/planq/dev-frontend/UI_DESIGN_GUIDE.md`
- 색상 가이드: `/opt/planq/dev-frontend/COLOR_GUIDE.md`
- ERD: `/opt/planq/docs/DATABASE_ERD.md`
- Q Bill 설계: `/opt/planq/docs/Q_BILL_SIGNATURE_DESIGN.md`
- **Insights 설계**: `/opt/planq/docs/INSIGHTS_DESIGN.md` (이번 세션 신규)
- 운영 배포 스크립트: `/opt/planq/scripts/deploy-prod.sh` 외 3개

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
