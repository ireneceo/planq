# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-12
**작업 상태:** 완료 — v1.7.1 운영 라이브 (사이클 N+11)
**버전:** v1.7.1 (commits `966144e` + `d746d6f` + `3e2b595` + `e9399cc` — 218s + 49s deploy)

---

## 🚩 내일 (2026-05-13) 최우선 — 운영 GDrive 연결 fix

**증상:** 운영서버(https://planq.kr) 에서 Google Drive 연결 오류 계속. dev (https://dev.planq.kr) 는 정상.

**원인 (진단 완료):** 운영 `.env` 의 GOOGLE OAuth credentials 가 example placeholder 그대로.

```
운영 /opt/planq/backend/.env (현재):
GOOGLE_CLIENT_ID=<google_oauth_client_id>        ← placeholder
GOOGLE_CLIENT_SECRET=<google_oauth_client_secret> ← placeholder
GOOGLE_REDIRECT_URI=https://planq.kr/api/cloud/callback/gdrive  ← 정상
```

코드는 정상 (dev-backend/services/gdrive.js). `isConfigured()` 가 `!!env` 단순 검사라 placeholder 도 truthy 판정 → Google 에 가짜 client_id 전달 → `invalid_client` reject.

### 해결 절차 (irene 직접 진행 — 시크릿 + Google 계정 자격 필요)

#### ① Google Cloud Console 등록 확인
- URL: https://console.cloud.google.com/apis/credentials
- dev 에서 쓰는 OAuth client 선택
- **승인된 리디렉션 URI** 에 prod 가 등록되어 있는지 확인:
  - 기존: `https://dev.planq.kr/api/cloud/callback/gdrive` (있을 것)
  - 추가: `https://planq.kr/api/cloud/callback/gdrive` ← 없으면 + URI 추가
- **승인된 JavaScript 원본**:
  - 기존: `https://dev.planq.kr`
  - 추가: `https://planq.kr`
- 하단 **저장** (반영 5분 ~ 수 시간)

#### ② 운영 .env 두 줄 교체
```bash
ssh irene@87.106.78.146
sudo nano /opt/planq/backend/.env
# GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET 두 줄을
# dev /opt/planq/dev-backend/.env 의 실값으로 교체
```

#### ③ 운영 재시작
```bash
pm2 restart planq-prod-backend
pm2 logs planq-prod-backend --lines 20  # 에러 없는지 확인
```

#### ④ 검증
https://planq.kr 에서 Drive 연결 재시도 → 인박스 OAuth 동의 화면 정상 노출 → 연결 완료 후 file 업로드 1회 테스트.

### 같이 점검할 항목
- 운영 `.env` 다른 placeholder 잔존 검사:
  ```bash
  ssh irene@87.106.78.146 "grep -E '=<[a-z_]+>' /opt/planq/backend/.env"
  ```
- 이게 GDrive 만의 누락인지, Dropbox/기타 외부 연동도 같은 회귀 있는지 (PlanQ 는 Dropbox 제거됨, GDrive 만 유효)

### 박제 — 다음 사이클 마지막에 메모리 신규
- `feedback_env_placeholder_check.md` — `.env` placeholder (`=<xxx>` 패턴) 자동 검사 health-check 항목 추가 (운영 진입 시 회귀 방지)

---

## 진행 중인 작업
- 없음

---

## 완료된 작업 (이번 세션 — 사이클 N+11)

사용자 보고 3건 + 인프라 개선 2건 = 총 5건. 3 commit 운영 라이브 + 버전 bump.

### commit 966144e (UX fix 3건)
1. **Q Task 우측 패널 상단 빈 공간** — `TaskDetailDrawer` + `QTaskPage` 업무추가 패널 `top:60px` → `top:0` (데스크탑) + `@media max-width:1024px { top:56px }`. 회귀 원인: 직전 `2b64012` lua 모바일 fix 가 17+ 모달 일괄 적용하며 데스크탑 드로어까지 휩쓸음.
2. **ErrorBoundary "문제가 발생했습니다" 깜빡임 제거** — ChunkLoadError 자동 reload 시 `setTimeout(reload, 0)` 전에 fallback UI 한 frame 그리던 회귀. `getDerivedStateFromError` 에 `silentReload` flag → render() 에서 `null` 반환.
3. **Q Task 모바일 실시간 갱신 회복** — `visibilitychange` 핸들러로 PWA background → foreground 복귀 시 missed `task:new/updated/deleted` 보정.

### commit d746d6f (perf 2건)
4. **`hooks/useVisibilityRefresh.ts` 공통 훅 + 3 페이지 적용** — QTaskPage / QTalkPage / TodoPage 일괄. 5초 minInterval. QTalkPage 는 socket 재연결 + 활성 conv messages cache invalidate + 대화 목록 merge refresh 3중 회복.
5. **라우트 청크 prefetch 인프라 (`lib/routePrefetch.ts`)** — 17 path 매핑. idle 시 5개 prefetch. 전역 mouseover + focusin delegation.

### commit 3e2b595 (build 인프라)
6. **vendor 청크 분리** — vendor-tiptap (416KB), vendor-recharts (310KB), vendor-react/router/select/socket/i18n/styled/date/tippy. **index 청크 343 → 165 KB (52% 감소)**. 캐시 효율 향상.
7. **빌드 OOM 박제** — `package.json` scripts.build 에 `NODE_OPTIONS=--max-old-space-size=4096` 인라인.

### commit e9399cc (version bump)
8. 1.7.0 → 1.7.1 + DEVELOPMENT_PLAN + session-state. --skip-build 운영 push 49s.

### 검증
- 빌드 3.73 ~ 4.07s, TS 에러 0
- 헬스체크 27/27 PASS
- 외부 https://planq.kr/api/health 200, planq-prod-backend v1.7.1

---

## 메모리 박제 (이번 세션)
- 새 메모리 없음. 회귀 패턴은 N+10 박제 (`feedback_react_portal_bubble`, `feedback_express_route_order`) 그대로 유효.

---

## 차순위 (GDrive fix 끝난 후)
- 청크 5 (visibility 배지 카드/행 적용 + 5중 시각 시그널)
- DocsTab 카드 hover share 아이콘
- 동적 OG (backend SSR + nginx /public/* proxy)
- Q note 텍스트 type + Quick Capture
- Custom SMTP (Pro+)
- 설문 기능 MVP (4 사이클)

---

## 환경변수 / 인증 현황
- SMTP 5개 dev/prod populated
- DEEPGRAM 양쪽 EMPTY
- **GOOGLE_CLIENT_ID/SECRET — dev 정상 / 운영 placeholder ★ 내일 fix 필요**
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
