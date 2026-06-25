# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-25
**작업 상태:** 완료 — **v1.45.0 운영 배포 완료** (랜딩페이지 재정비 + 빌드 OOM fix + 미배포 묶음 #72/#88·#63 동봉). 미배포 0.

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- **랜딩페이지 재정비(Irene 지시)** — 홈 Features 섹션 Q 시리즈 5→9개 확장(Q Mail·Q docs·Q Calendar·Q Project 추가). `HomePage.tsx` Q_SERIES + `landing.json` ko/en. 노출 순서 Irene 확정.
- **빌드 OOM 근본 fix** — `dev-frontend/package.json` build 스크립트 인라인 NODE_OPTIONS 4096→8192 (tsc+vite). deploy/dev 빌드 OOM 차단.
- **버전 업 v1.44.1 → v1.45.0** (dev-backend/dev-frontend package.json).
- **운영 배포** deploy `20260625_155601` · 152초 · commit `e8709a7` · planq.kr 헬스 200. 동봉: #72/#88 앱 비번 안내(`c98bb50`) + #63 Phase 2 자료 이전(`83737db`).

### 검증
- 헬스 29/29 · 빌드 EXIT0(tsc+vite 8GB) · 서빙 200 · ko/en 패리티 9/9 · i18n 0 · 운영 landing.json 9개 라이브 · PM2 prod-backend/prod-qnote online.

## ▶ 다음 할 일

### 1) #93-ⓐ Q helper 팝아웃 재로그인 버그 (자율 가능 · 다음 우선 · 중 규모)
- 원인 파악됨: access token이 **메모리 변수**(`AuthContext.getAccessToken`)라 `window.open('/help-popout')` 새 창은 메모리 비어있음 → 부팅 `checkSession`→`tryRefresh`(refresh 쿠키) 완료 전 로그인 게이트 노출 추정.
- 수정 방향: `HelpStandalonePage` 인증 게이트에서 `isLoading` 동안 로그인 화면 막고 refresh 완료 대기 / refresh 실패만 로그인.

### 2) #93-ⓑ "진행시작" 화면 깜빡임 → 전수 실시간 전환 (자율 가능 · 대규모)
- 업무 우측패널 status 전환 시 full reload/remount로 깜빡임. 고정 화면 + 인플레이스 setState 전환으로 전수검사 요청. CLAUDE.md 운영안정성 #16 기준.

### 3) 외부의존 (자율 불가)
- **#60** iOS 푸시 — Capacitor 네이티브앱 결정 (Irene)
- **#72/#88(ⓑ)** Google OAuth 검증 제출 — Google Cloud 콘솔 (Irene) + GCP redirect URI 등록

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
