# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-12
**작업 상태:** 완료 — v1.7.1 운영 라이브 (사이클 N+11)
**버전:** v1.7.1 (commits `966144e` + `d746d6f` + `3e2b595` — 218s 1회 deploy)

---

## 진행 중인 작업
- 없음

---

## 완료된 작업 (이번 세션 — 사이클 N+11)

사용자 보고 3건 + 인프라 개선 2건 = 총 5건. 3 commit 운영 라이브.

### commit 966144e (UX fix 3건)

1. **Q Task 우측 패널 상단 빈 공간** — `TaskDetailDrawer` + `QTaskPage` 업무추가 패널 `top:60px` → `top:0` (데스크탑) + `@media max-width:1024px { top:56px }`. 회귀 원인: 직전 `2b64012` lua 모바일 fix 가 17+ 모달 일괄 적용하며 데스크탑 드로어까지 휩쓸음. 데스크탑은 상단 GNB 없는데 60px 빈 공간 발생, 모바일 GNB 56px 와도 어긋남.

2. **ErrorBoundary "문제가 발생했습니다" 깜빡임 제거** — ChunkLoadError 자동 reload 시 `setTimeout(reload, 0)` 전에 fallback UI 한 frame 그리던 회귀. `getDerivedStateFromError` 에 `silentReload` flag → render() 에서 `null` 반환해 UI 안 그림. 60초 가드에 막힐 때만 일반 에러 화면.

3. **Q Task 모바일 실시간 갱신 회복** — `visibilitychange` 핸들러로 PWA background → foreground 복귀 시 socket 재연결 사이 missed `task:new/updated/deleted` 보정.

### commit d746d6f (perf 2건)

4. **`hooks/useVisibilityRefresh.ts` 공통 훅 + 3 페이지 적용** — QTaskPage / QTalkPage / TodoPage 일괄 적용. 5초 minInterval 가드. QTalkPage 는 socket 재연결 + 활성 conv messages cache invalidate + 대화 목록 merge refresh 3중 회복.

5. **라우트 청크 prefetch 인프라 (`lib/routePrefetch.ts`)** — 17 핵심 path 매핑. 앱 mount idle 시 자주 가는 5개 prefetch. 전역 mouseover + focusin delegation 으로 모든 internal link hover 자동 prefetch. Vite module promise 캐시로 lazy() 와 동일 import 공유.

### commit 3e2b595 (build 인프라)

6. **vendor 청크 분리 (vite.config.ts manualChunks)**:
   - vendor-tiptap (416KB) — RichEditor 사용 페이지만
   - vendor-recharts (310KB) — Insights/WeeklyReview 만
   - vendor-react/router/select/socket/i18n/styled/date/tippy 분리
   - **index 청크 343 → 165 KB (52% 감소)**
   - sourcemap=false, chunkSizeWarningLimit=600
   - 캐시 효율: vendor 는 라이브러리 업데이트 전까지 hash 고정 → 다음 배포 시 페이지 청크만 새로 받고 vendor 는 캐시 hit

7. **빌드 OOM 박제** — `package.json` scripts.build 에 `NODE_OPTIONS=--max-old-space-size=4096` 인라인. tsc + vite build 양쪽. `npm run build` 만으로 안정 빌드.

### 검증

- 빌드 3.73 ~ 4.07s, TS 에러 0 (3회)
- 헬스체크 27/27 PASS
- 외부 https://planq.kr/api/health 200, planq-prod-backend v1.7.1

---

## 메모리 박제 (이번 세션)

- 새 메모리 없음 (인프라 개선 위주, 회귀 패턴 박제는 N+10 에서 끝남 — `feedback_react_portal_bubble`, `feedback_express_route_order` 그대로 유효)

---

## 다음 할 일

DEVELOPMENT_PLAN 차순위:

### 즉시 진입 가능
- **청크 5 (visibility 배지 카드/행 적용 + 5중 시각 시그널)** — lua 모바일 반응형 commit `2b64012` 정리 완료. 진입 가능. Q file `DocsTab`, Q docs `PostsPage`, Q info 카드 + VisibilityChangeModal 진입점 + 5중 시그널
- **DocsTab 카드 hover share 아이콘** — 작은 UX 개선
- **동적 OG (backend SSR + nginx /public/* proxy)** — Q docs / 청구서 등 공개 페이지 미리보기 메타

### 차순위
- Q note 텍스트 type + Quick Capture (중)
- Custom SMTP (Pro+) (소)
- 설문 기능 MVP (4 사이클, docs 완료)
- AI 사용량 세분화 + Task AI 예측·번역 recordUsage 통합
- Signature 알림 통일

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
- 개발 로드맵: `/opt/planq/DEVELOPMENT_PLAN.md`

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
