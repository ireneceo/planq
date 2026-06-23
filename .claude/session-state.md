# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-23 (2차)
**작업 상태:** 완료 — #72/#88 앱 비번 연결 안내 UX + 브랜드 컨설팅. **미배포 묶음 2건** + 신규 피드백 #93 발견(다음 사이클).

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- **#72/#88(ⓐ)** 메일 앱 비밀번호 연결 단계별 안내 UX — `EmailAccountSettings` ConnectGuide(Gmail/Naver/iCloud 번호 단계 + 발급 직링크). commit `c98bb50`. **미배포.**
- **브랜드 아키텍처 컨설팅(코드 외)** — 제품=PlanQ / 서비스=**워프로랩 스튜디오** 분리, 끼워팔기 금지, 깔때기 연결 확정. 워프로랩용 솔루션 소개 HTML 생성·전달 후 dev 사본 삭제. memory `project_brand_architecture_planq_worpro`.
- (직전) **#63 Phase 2** 워크스페이스 간 이전(복사, 원본 유지) commit `83737db`. **미배포.**

### 검증
- 헬스 29/29 · 빌드 EXIT0(TS 0) · 변경 페이지 서빙 200.

## ▶ 다음 할 일

### 1) 미배포 묶음 운영 배포 (다음 `/배포`)
- `83737db` #63 Phase 2 워크스페이스 간 이전 + `c98bb50` #72/#88 앱 비번 연결 안내. 한 번에 반영.

### 2) 신규 피드백 #93 (자율 가능, 다음 사이클 우선)
- **ⓐ Q helper 팝아웃 재로그인 버그** — 원인 파악됨: access token이 **메모리 변수**(`AuthContext.getAccessToken`)라 `window.open('/help-popout')` 새 창은 메모리 비어있음 → 부팅 `checkSession`→`tryRefresh`(refresh 쿠키) 완료 전 로그인 게이트 노출 추정. **수정 방향:** 팝아웃 부팅 시 `isLoading` 동안 로그인 화면 막고 refresh 완료 대기 / 또는 refresh 실패만 로그인. HelpStandalonePage 인증 게이트 점검.
- **ⓑ "진행시작" 화면 깜빡임 → 전수 실시간 전환** — 업무 우측패널 status 전환 시 full reload/remount로 깜빡임. 고정 화면 + 인플레이스 setState 전환으로 전수검사 요청(대규모). CLAUDE.md 운영안정성 #16(실시간 반영) 기준.

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
