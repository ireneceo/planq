# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-08 (사이클 N+92)
**작업 상태:** 완료 (dev 검증) · **운영 미배포**

---

## ✅ N+92 완료 — 운영 고객 피드백 처리

> 운영(planq.kr) 피드백 16건 중 미답변 11건(ID 6~16) 전수 검토 → 전부 답변 + reviewing 운영 DB 반영(platform_admin user 1). 자주 호소된 항목부터 실제 수정.

### 완료된 작업 (이번 세션 · dev 검증 · 다음 배포 반영 예정)
- **Focus 좌측 [포커스 중] 배너 (ID 15·16#1·#2·#4)**
  - backend: 신규 `services/focusSync.js` — 워크플로(complete/submit-review/cancel-review) status 전이 시 담당자 FocusSession 종료/시작. (기존엔 routes/tasks.js PUT 에만 있어 워크플로 완료 시 세션 잔존 → 배너 안 사라짐). E2E 6/6.
  - frontend: `FocusWidget` 가 `inbox:refresh`/`focus:refresh` window 이벤트 실시간 listen (30s 폴링 → 즉시) + `QTaskPage.saveField` dispatch + `?task=` URL→state sync (배너 업무명 클릭 이동).
- **Q helper 엔터 통일 (ID 12#1)** — `CueHelpDrawer` Q Talk 과 동일 (Enter 전송/Shift+Enter 줄바꿈/IME 가드) + 안내문 ko·en.
- **결제 배너 → 미결제 청구 결제 UI** — 배너 "결제하러 가기" 가 플랜 재선택만 되던 것 → grace/past_due 시 `?pay=1` 결제 모달 자동 오픈 + `PlanSettings` 상단 "결제가 필요한 청구" 카드(금액·결제 버튼). i18n payDue.* ko·en.

### 답변 완료 + 개발 예정 (운영 reviewing — 다음 섹션에서 기획/개발)
ID 16#3 재개 버튼(설계) · 14 업무 삭제 안 됨 · 13 Q docs 리스트·Q info 수정삭제공유 · 12#2 Q Talk 입력란 흔들림 · 11 Q Task 실시간·프로젝트명 변경 · 10 단계 되돌리기 버튼 · 9 Q Talk 팝아웃 창 · 8 활성방 토스터·입장 스크롤 · 7 모바일 채팅 아이콘·간격 · 6 Q info 공유·다중전송·미리보기

### 수정된 파일
- backend: `services/focusSync.js`(신규), `routes/task_workflow.js`
- frontend: `components/Focus/FocusWidget.tsx`, `pages/QTask/QTaskPage.tsx`, `components/Common/CueHelpDrawer.tsx`, `pages/Settings/PlanSettings.tsx`, `components/Layout/WorkspaceBillingBanner.tsx`, `public/locales/{ko,en}/{plan,common}.json`

### 검증
- 헬스 29/29 · 빌드 EXIT 0 · focus E2E 6/6 · 서빙 200 · i18n 0 · 8-A padding 교정 · DB 스키마 변경 0

## 다음 할 일
- **운영 피드백 reviewing 10건 기획/개발** (위 "개발 예정" 목록) — 다음 섹션에서 진행
- 이번 N+92 수정분 운영 반영 (`/배포`) → 반영 후 피드백 15·16#1/#2/#4·12#1·결제 done 전환

## 환경
- dev: 3003 (dev.planq.kr) / prod: planq.kr 3004 (v1.33.1)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
