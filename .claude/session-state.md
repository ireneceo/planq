# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-04
**작업 상태:** 완료 · **운영 배포됨** (commit e915cd7, deploy 20260704_055535)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션 — 2026-07-04)
- **모바일 PWA 키보드/입력 전면 근본수정** (운영 #79·#110·#111·#113·#86) — 배포됨
  - 단일 레버: `100vh`/`100dvh`/`top:0;bottom:0` 컨테이너를 `--vvh` 바운드로. DetailDrawer 하나로 EventDrawer·FilePicker·CueHelp·InvoiceDetail 동시 해결
  - TaskDetailDrawer·MemoPopup·FilePicker 바텀시트 --vvh · RightDock FAB 키보드시 숨김
  - main.tsx: `--keyboard-height` + 캐럿기준 "가려졌을때만" 최소 스크롤(#111 자동 스크롤 근본)
  - MemoPopup Esc/X flush(#113 유실 실버그) · ChatPanel 모바일 Enter=줄바꿈(#110)
- **개인 메일 연동 통일** (운영 #72·#88·#107·#109, Fable 계획검수 B-수정) — 배포됨
  - 근본(F-1): 개인 뷰 ?scope=personal 는 완성인데 메뉴 링크 고아였음
  - MainLayout "내 계정 → 내 메일 계정" 링크 · EmailAccountSettings 뷰가 범위 결정(F-2 유령계정 제거) · ProfileIntegrations 읽기전용요약+관리링크
  - gmail_oauth state HMAC(CSRF, F-3) · 콜백 returnUrl 쿼리보존+open redirect 가드
  - 백엔드는 원래 아무 메일이나 IMAP 앱비번 지원 — 갭은 순수 프론트였음
- 네이티브앱 Capacitor Phase0~5 커밋 동봉 배포(운영 DB 컬럼 이미 존재 확인)
- **검증:** state HMAC 4/4 · 빌드 EXIT0/TS0 · health 29/29(2회) · i18n 하드코딩 0 · 운영 https 200 · PM2 online

### 다음 할 일 (운영 백로그 — DB에서 추출, scratchpad/prod-backlog.txt)
- 열린 운영 피드백 35건 중 남은 것: **Q Bill** #108[높음] 정기청구 알림·상태 / #91 결제완료 버튼 / #92 정기발송 표시 · **표시명** #87·#98 한수정→루아 · **파일** #106 나만보기 유출(보안)·#97 이미지 리사이즈 · **메일/OAuth** #88 Google 심사(Irene 콘솔) · **통계** #100·101·103·105 주간그래프 · **Cue** #81·#90 · #99·#104·#102·#95·#96·#89·#85·#84·#71·#112·#114
- **모바일 실기기 확인:** Irene PWA에서 #79/#110/#111/#113/#86 개선 체감 확인 (안 되면 화면 문구 글로)
- **메일 재연결:** Irene 내 계정 → 내 메일 계정 → 앱 비밀번호로 연결 (일반비번 아님)

---

## 복구 가이드

새 Claude 세션 시작 시:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

관련 메모리: `feedback_mobile_keyboard_vvh_bound`, `project_email_personal_unify`, `project_cost_guard_audit`.
운영 백로그 전문: scratchpad/prod-backlog.txt (35건, 운영 DB 덤프에서 추출).
