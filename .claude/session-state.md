# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-25 (2차)
**작업 상태:** v1.45.0 운영 배포 완료. 이후 **#93-ⓐ/#93-ⓑ dev 완료·미배포** (다음 `/배포` 대상).

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- **랜딩페이지 재정비** — 홈 Features Q 시리즈 5→9개(Mail·docs·Calendar·Project). v1.45.0 운영 배포(`e8709a7`, deploy `20260625_155601`, planq.kr 헬스 200). 동봉: #72/#88 앱 비번(`c98bb50`) + #63 Phase 2(`83737db`). 빌드 OOM fix(package.json 8192).
- **#93-ⓐ Q helper 팝아웃 재로그인** (`a1ee0b4`, **미배포**) — 부모 창(window.opener)이 `__pqGetToken` 으로 access token getter 노출 → 팝아웃 부팅 checkSession 이 즉시 상속 → refresh 라운드트립/플래시 제거. 만료 시 기존 apiFetch 401→refresh 자동 복구. cross-origin opener throw→catch 폴백, 일반 탭 무변경.
- **#93-ⓑ "진행 시작" 깜빡임** (`f6e19f9`, **미배포**) — actStart 가 status 전이 후 전체 refetch(refreshAfterAction → setDetailTask(detailR.data)) 로 본문/액션카드까지 리렌더 → 깜빡임. status 만 인플레이스 병합 + 이력/리뷰어만 refreshWorkflowOnly 헬퍼로 보강. status 전이 시 inbox:refresh+focus:refresh dispatch(Focus 위젯 즉시 동기화). changeStatus 에도 동일 이벤트.

### 검증 (#93)
- 백엔드 refresh 3시나리오 PASS · 상속(유효)/me 200 · 만료 401→복구 · 빌드 EXIT0(tsc+vite 8GB) · 번들 브리지 반영 · /help-popout·/tasks 서빙 200 · 신규 i18n 0.

### 피드백 큐 확인
- `feedback_items` 미해결 2건 + `contact_inquiries` 미응답 13건 — **전부 옛 검증/테스트 잔존물**(example.com·local.test·"검증"·"회귀검증"). 진짜 신규 피드백 0건. (관리자 인박스 정리용 cleanup 은 보류 — Irene 확인 후)

## ▶ 다음 할 일

### 1) #93-ⓐ/#93-ⓑ 운영 배포 (다음 `/배포`)
- `a1ee0b4` 팝아웃 재로그인 + `f6e19f9` 진행시작 깜빡임. 한 번에 반영.
- **참고:** #93-ⓐ 는 데스크탑 window.open 팝아웃을 robust 하게 해결. iPhone PWA 에서 window.open 이 Safari(별도 쿠키 jar)로 탈출하는 케이스라면 opener 상속이 안 되므로(별도 컨텍스트) 인앱 드로어 방식 전환 필요 — Irene 이 어느 환경에서 봤는지 확인 시 추가 대응.

### 2) #93-ⓑ 전수 확대 (선택 · 대규모)
- 이번엔 actStart(진행 시작)+changeStatus 만 인플레이스 전환. 나머지 워크플로 액션(ack/submit-review/approve/revision/complete)은 여전히 callAction→refreshAfterAction 전체 refetch. 완료/승인은 body 변동 가능성 있어 전체 refetch 가 안전한 면도 있음 — 깜빡임 더 호소되면 케이스별 인플레이스 전환.

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
