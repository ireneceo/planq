# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-21 (운영 피드백 대량 처리 세션 — 마무리)
**작업 상태:** 완료 — **운영 피드백 28→3 pending** (25건 처리). 미배포 0. 남은 3건 전부 외부의존(자율불가).

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- **#61** Cue 워크스페이스 현황 항상 주입 — `cue_context.js getWorkspaceOverview()`(권한범위 프로젝트·업무상태·연체·급한업무·미수금, 재무는 owner/admin만) buildCueContext 최상단 주입. **운영 배포**(deploy 20260621_191141·154s·83e69db, planq.kr 헬스 200, 운영 반영 확인). done.
- **#68** Q Talk @멘션 — **이미 완전 구현·라이브**(ChatPanel 자동완성+하이라이트 + `mention_parser` 양쪽 라우트 notify). E2E PASS(@김오너→user15 mention 알림 발생). done.
- 세션 중 배포분: **#75**(세금계산서 발행내역 패널)·**#77**(증빙파일)·**#80**(우측하단 빠른만들기)·**#82**(Gmail 연결 401 fix)·**#83**(메일연결 위키) + 통합 정체성 컨텍스트·AI 템플릿 추천·#84/#71/#79.
- 옛 배포완료 피드백 일괄 done: #57·58·59·62·64·65·66·67·69·70·73·74·76 등.

### 박제
- 빌드 검증은 **실 exit code**(`npm run build > log; echo $?`)로. `| tail`이 npm 실패 가린 사고 박제 — memory `feedback_build_real_exit_code`.
- 피드백 respond = platform_admin(irene) PATCH /api/feedback/:id/respond. 위키 운영반영 = 배포 후 node seed-wiki-content.js(멱등).
- 헬스체크 socket auto-join 테스트는 async race로 가끔 flaky(재실행 시 통과) — 진짜 회귀 아님. user5=biz5 owner 정상.

## ▶ 다음 할 일 — 남은 pending 3건 (전부 외부의존, 자율 진행 불가)

- **#60** iOS 모바일 푸시 안 옴 — 기기 표시상태/iOS 한계. 근본해결 = **Capacitor 하이브리드 네이티브앱** 착수 결정 필요. (memory `project_native_app_capacitor_plan`, `feedback_ios_push_presentation_device_state`)
- **#63** 자료 일괄다운로드 + 워크스페이스 간 이동 — 대규모. **제품결정 선행**: 이동단위(파일만/업무·대화 포함), 권한, 승인흐름. 결정 후 `/기능설계` → 구현.
- **#72** 구글 로그인 안 됨 — 코드는 라이브(v1.23.0), **Google Cloud 콘솔 OAuth 검증 제출**이 막힘. Irene 작업. (memory `project_google_oauth_verification_pending`)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
