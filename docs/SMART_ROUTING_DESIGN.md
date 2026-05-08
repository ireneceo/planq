# Smart Routing — App-First Deep Linking

> **사이클 N+1 (2026-05-08)** — 외부 공유 링크 클릭 시 PlanQ PWA 가 설치되어 있으면 그 안에서 항목으로 자동 진입. 노션의 "공유 링크 → 웹 → 앱 검색 → 액션" 3-step friction 을 0-step 으로.

---

## 1. 문제

**노션 케이스:**
1. 동료가 노션 업무 공유 링크 보냄
2. 링크 클릭 → 브라우저 탭 열림 (read-only)
3. 액션 하려면 노션 데스크탑 앱 가서 검색
4. 찾아서 액션

→ **3-step friction**.

## 2. PlanQ 의 답

```
링크 클릭 → 미리보기 페이지 → 인증 detect → 0.3s 자동 redirect → PWA 안에서 그 항목 열림
```

→ **0-step friction.**

## 3. 흐름

```
외부 사용자가 https://planq.kr/share/task/abc123 클릭
              ↓
       [미리보기 페이지 로드]
       /public/tasks/abc123
              ↓
        access_token 검사
        ┌──────┴──────┐
   [유효]            [없음/만료]
       ↓                  ↓
 0.3s delay          미리보기 read-only
 + redirect              +
 /tasks?task=42      [PlanQ 로그인하고 액션]
       ↓                  +
 PWA 설치되어 있으면      [무료로 시작하기]
 PWA 안에서 열림
 미설치 시 브라우저 탭
```

## 4. auth-check API

```
GET /api/public/{entity}/:token/auth-check
Authorization: Bearer {access_token}

Response (인증 OK + 접근 가능):
{
  "success": true,
  "data": {
    "canAccess": true,
    "appUrl": "/tasks?task=42",      ← redirect 대상
    "entityType": "task",
    "entityId": 42
  }
}

Response (인증 X 또는 접근 권한 X):
{
  "success": true,
  "data": { "canAccess": false }
}
```

**canAccess 판단:**
- 토큰 유효
- 사용자가 그 entity 접근 권한 있음 (visibility / project_id / participant 검사)
- 권한 정책 옵션 A 와 일관

## 5. Frontend redirect 로직

```tsx
// /public/{type}/:token 페이지
useEffect(() => {
  const token = getAccessToken();
  if (!token) return;  // 비로그인 → 그대로 미리보기

  apiFetch(`/api/public/${entityType}/${shareToken}/auth-check`)
    .then(r => r.json())
    .then(j => {
      if (j.success && j.data.canAccess) {
        // 0.3s delay — UX 부드럽게 (사용자가 페이지 인지할 시간)
        setTimeout(() => {
          navigate(j.data.appUrl);
        }, 300);
      }
    })
    .catch(() => {});
}, [shareToken]);
```

## 6. PWA Standalone 자동 처리

| 환경 | 동작 |
|---|---|
| macOS PWA 설치 | 시스템이 planq.kr 도메인 → PWA 라우팅 (manifest scope) |
| Android PWA 설치 | 동일 |
| iOS PWA 설치 (홈 화면) | 동일 (iOS 16.4+) |
| 일반 브라우저 | 브라우저 탭에서 미리보기 + redirect |

별도 코드 X — manifest `display: standalone` + `scope: "/"` 만으로 OS 자동 처리.

## 7. 미리보기 페이지 — 비로그인 사용자

```
┌────────────────────────────────────────────┐
│ PlanQ                              [⋯]    │
├────────────────────────────────────────────┤
│ 📋 경쟁사 비교 분석표 작성                  │
│ 마감 5/15 · 진행률 60% · 담당 김재호        │
│                                            │
│ ABC, XYZ 등 경쟁사 5개 비교 분석...        │
│                                            │
│ [첨부 2개]                                  │
│                                            │
│ ─────────────────────────────────────────  │
│ ✨ PlanQ 사용자라면 더 많은 작업 가능        │
│   [PlanQ 로그인] [무료로 시작하기]           │
└────────────────────────────────────────────┘
```

## 8. 미리보기 페이지 — 로그인 사용자 (자동 redirect)

```
┌────────────────────────────────────────────┐
│ PlanQ 로 이동 중... ✨                      │
└────────────────────────────────────────────┘
        (0.3s 후 자동 redirect)
```

스피너만 잠깐. 빠르고 부드러운 UX.

## 9. 모바일 보강

```
PWA 미설치 모바일 미리보기 페이지 하단:
┌────────────────────────────────────────────┐
│ 📱 PlanQ 앱으로 더 빠르게                   │
│   [홈 화면에 추가하기 →]                    │
└────────────────────────────────────────────┘
```

기존 `PwaInstallBanner` 재사용.

## 10. 작업 항목 (사이클 N+1)

- 백엔드: `routes/public/auth-check.js` — 4 항목 통합 라우트
- 백엔드: 각 미리보기 라우트 (`/public/tasks/:token`, `/public/files/:token`, ...)
- 프론트: `pages/Public/PreviewPage.tsx` 공통 + 항목별 컴포넌트
- 프론트: `useSmartRedirect(entity, token)` 훅
- 프론트: 미리보기 페이지 [PlanQ 에서 보기] / [로그인] / [무료 시작] CTA

## 11. 비즈니스 가치

| 가치 | 설명 |
|---|---|
| **Friction 제거** | 노션 3-step → PlanQ 0-step |
| **Lock-in** | PWA 설치 유도 — 한 번 설치하면 모든 공유 링크가 PWA 로 |
| **신규 가입** | 외부 미리보기 [무료 시작] CTA → 가입 funnel 강화 |
| **Brand 노출** | 모든 공유 링크 = planq.kr 도메인 |
