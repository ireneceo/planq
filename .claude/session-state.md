# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-08 — **v1.33.2 운영 라이브** (deploy `20260608_190800`, commit `2227a01`)
**작업 상태:** 완료 · 운영 배포 검증 3/3 OK (헬스 내부/외부 · 프론트 200 · PM2 prod 정상)

---

## ✅ N+93 완료 — 설정 메뉴 개인/워크스페이스 분리 + v1.33.2 배포

> "설정이 없다 / 못 찾겠다" 호소 해소 = **누락 진입로 노출 + 그룹 시각 분리**. 페이지는 이미 있었으나 메뉴에 안 걸려 있던 것을 노출.

### 완료된 작업 (이번 세션)
- **설정 아코디언 2그룹 분리** — `AccordionGroupLabel` 신설로 **워크스페이스 설정 / 개인 설정** 구분 (MainLayout).
- **개인 설정 진입로 노출** — 내 프로필 · 외부 연동(`/profile/integrations`) · 내 업무 설정(`/me/work-settings`). 아코디언 열림/active 조건에 `/me/work-settings` 추가, 프로필 active 는 exact match 로 분리.
- **Q Mail 계정 노출** — `/business/settings/mail-accounts` 워크스페이스 그룹에 추가 (IconInbox). 개인/팀 구분은 **메뉴 위치**로 (EmailAccountSettings 물리 이동 X).
- **i18n** — layout.json ko/en: integrations·mailAccounts·personalSettings·workspaceGroup, en myWorkSettings.
- **v1.33.2 운영 배포** — N+92(Focus 배너·Q helper·미결제 결제) + 통합 런처·팝아웃·tap-to-reveal 동봉. 버전업 + 임시 테스트 파일(test-popout-auth.js) 제거 + 한/영 릴리즈노트.

### 수정된 파일
- `dev-frontend/src/components/Layout/MainLayout.tsx`
- `dev-frontend/public/locales/{ko,en}/layout.json`
- `dev-backend/package.json`, `dev-frontend/package.json` (1.33.1 → 1.33.2)
- `dev-backend/test-popout-auth.js` (제거)

### 검증
- 헬스 29/29 · 빌드 EXIT 0 · 운영 배포 검증 3/3 OK · DB 스키마 변경 0

---

## 진행 중인 작업
- 없음

## 다음 할 일
- **운영 피드백 reviewing 10건 기획/개발** (N+92에서 답변 완료, 개발 대기):
  ID 16#3 재개 버튼 · 14 업무 삭제 · 13 Q docs 리스트·Q info 수정삭제공유 · 12#2 Q Talk 입력란 흔들림 · 11 Q Task 실시간·프로젝트명 변경 · 10 단계 되돌리기 · 9 Q Talk 팝아웃 · 8 활성방 토스터·입장 스크롤 · 7 모바일 채팅 아이콘·간격 · 6 Q info 공유·다중전송·미리보기
- (선택) ProfileIntegrationsPage 의 `window.location.href` full-reload 링크 → SPA navigate

## 환경
- dev: 3003 (dev.planq.kr) / prod: planq.kr 3004 (**v1.33.2**)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
