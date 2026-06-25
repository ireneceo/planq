# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-25 (3차)
**작업 상태:** **#93-ⓐ/ⓑ 운영 배포 완료** (deploy `20260625_184251`·149초·`1c21df1`·planq.kr 헬스 200·PM2 prod 2개 online). 이후 **#93-ⓑ 전수 확대 dev 완료·미배포**(`cfaf5c3`, 다음 `/배포` 대상).

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션 — 3차)
- **#93-ⓐ/ⓑ 운영 배포** — 직전 세션 미배포분(`a1ee0b4`+`f6e19f9`) `/검증`(헬스29/29·빌드EXIT0·워크플로 shape)+`/배포 --auto`(149초)로 운영 라이브. node_env=production·prod-backend(1.45.0)/prod-qnote online.
- **#93-ⓑ 전수 확대** (`cfaf5c3`, **미배포**) — 나머지 워크플로 액션(ack/submit-review/cancel-review/complete/approve/revert/revision/reviewer·policy) 깜빡임 제거. callAction→refreshAfterAction 의 `setDetailTask(detailR.data)` 전체 교체를 인플레이스로: (1) status·진행률 등 스칼라는 액션 응답(task.toJSON / approve `{task,new_status}`)에서 즉시 병합 → 액션카드 지연 점프 제거 (2) 리뷰어·이력·댓글·첨부 background 보강하되 **body/description(RichEditor 바인딩)은 prev 레퍼런스 유지** → 에디터 리렌더 원천 차단. focus:refresh dispatch 추가. 검증: 빌드EXIT0·TS0 / **워크플로 shape E2E 10/10**(전이별 status·approve 래핑·body 보존, JWT 직접서명으로 리뷰어 approve 라이브) / i18n 0 / dev 서빙 200 / 테스트데이터 원복.

### 직전 세션(2차) 완료분
- **랜딩페이지 재정비** — 홈 Features Q 시리즈 5→9개(Mail·docs·Calendar·Project). v1.45.0 운영 배포(`e8709a7`, deploy `20260625_155601`, planq.kr 헬스 200). 동봉: #72/#88 앱 비번(`c98bb50`) + #63 Phase 2(`83737db`). 빌드 OOM fix(package.json 8192).
- **#93-ⓐ Q helper 팝아웃 재로그인** (`a1ee0b4`, **미배포**) — 부모 창(window.opener)이 `__pqGetToken` 으로 access token getter 노출 → 팝아웃 부팅 checkSession 이 즉시 상속 → refresh 라운드트립/플래시 제거. 만료 시 기존 apiFetch 401→refresh 자동 복구. cross-origin opener throw→catch 폴백, 일반 탭 무변경.
- **#93-ⓑ "진행 시작" 깜빡임** (`f6e19f9`, **미배포**) — actStart 가 status 전이 후 전체 refetch(refreshAfterAction → setDetailTask(detailR.data)) 로 본문/액션카드까지 리렌더 → 깜빡임. status 만 인플레이스 병합 + 이력/리뷰어만 refreshWorkflowOnly 헬퍼로 보강. status 전이 시 inbox:refresh+focus:refresh dispatch(Focus 위젯 즉시 동기화). changeStatus 에도 동일 이벤트.

### 검증 (#93)
- 백엔드 refresh 3시나리오 PASS · 상속(유효)/me 200 · 만료 401→복구 · 빌드 EXIT0(tsc+vite 8GB) · 번들 브리지 반영 · /help-popout·/tasks 서빙 200 · 신규 i18n 0.

### 피드백 큐 확인
- `feedback_items` 미해결 2건 + `contact_inquiries` 미응답 13건 — **전부 옛 검증/테스트 잔존물**(example.com·local.test·"검증"·"회귀검증"). 진짜 신규 피드백 0건. (관리자 인박스 정리용 cleanup 은 보류 — Irene 확인 후)

## ▶ 다음 할 일

### 1) #93-ⓑ 전수 확대 운영 배포 (다음 `/배포`)
- `cfaf5c3` 워크플로 전수 깜빡임 제거. 프론트 단독(DB 변경 0). 검증 통과 상태.
- **참고:** #93-ⓐ(팝아웃 재로그인)는 데스크탑 window.open 을 robust 하게 해결(이미 운영 라이브). iPhone PWA 에서 window.open 이 Safari(별도 쿠키 jar)로 탈출하는 케이스라면 opener 상속이 안 되므로(별도 컨텍스트) 인앱 드로어 방식 전환 필요 — Irene 이 어느 환경에서 봤는지 확인 시 추가 대응.

### 2) 외부의존 (자율 불가)
- **#60** iOS 푸시 — Capacitor 네이티브앱 결정 (Irene)
- **#72/#88(ⓑ)** Google OAuth 검증 제출 — Google Cloud 콘솔 (Irene) + GCP redirect URI 등록

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
