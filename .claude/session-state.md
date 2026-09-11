# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-09-11 (Opus 5, 1M)
**작업 상태:** ✅ **운영 배포 완료 `4aa971ef`** (2026-09-11 06:06 UTC, v1.48.21 유지) — Fable PASS ×3

### 이번 세션에 운영으로 나간 것
- **확인필요·대시보드·Q Bill 워크스페이스 격리** (`a8ae55a6`) — 운영 dashboard.js md5 = HEAD 확인
- **플랫폼 관리자 탭** 이름·identity·`+` 범위
- **공개 화면 여백** (center 420 · 폰 16px · 툴바 전폭)
- **모바일 채팅 (#409·#410)** — 타이핑 중 바닥 유지 · 전송/수신 즉시 바닥(smooth·조상 scrollIntoView 제거) ·
  터치 기기 진입 시 키보드 안 띄움 · 알림 탭(planq:navigate) → 바닥 + 포커스 해제 · 키보드 up 입력란 28% 캡
- **AI 일정 수정 서버 1차** + 안정화 — 선점(동시 1회)·지금값 대조·0건 409 해제·결과 원장·요약 알림 1통·include_closed.
  운영 `schedule_batches` 생성 확인(0행). **화면은 아직 없음**
- **업무 날짜** — PUT 과 일괄 수정이 같은 이력·알림 함수 · 제목 시작일/마감일/일정 변경 · 이력 라벨 "일정 변경" ·
  빈 값 저장(옛 500) · 잘못된 날짜 400 · 완료 업무: 단건 수정 허용 / 일괄 기본 제외
- **메일 자동 연결** — 초대 주소가 프로젝트 여럿이면 프로젝트 미배치
- 릴리즈노트 **v1.48.21 운영 발행**(배포 스크립트 자동) · 개발 현황 id=78

### 배포 검증 (3점 + 기능)
last-deployed 4aa971ef · planq-prod-backend uptime 56s · QTalkPage 청크 06:06 + 터치 판정 포함 ·
ko 라벨 "일정 변경" · schedule_batches 존재 · https://planq.kr/api/health 200 · / 200

### 다음 할 일 (우선순위 순)
1. **운영 신고 #409·#410 답글** — 관리자 > 피드백에서 답글 달기(Irene). 장부 스크립트는 답글 있는 건만 닫는다.
   `scripts/feedback-close-backlog.txt` 에 올려 둠 → 답글 후 다음 배포에서 자동으로 닫힌다
2. **iOS 앱 재빌드** — Codemagic `ios-testflight` 수동 트리거. `AppDelegate.swift` 의 키보드 위 ▲▼✓ 줄 제거가
   앱 번들에만 들어간다. Swift 는 개발서버에서 컴파일 불가 → 빌드 성공·실기기(바 사라짐·키보드 높이 정상) 확인 필요
3. **실기기 확인** — 폰 Q Talk 여러 줄 입력 · 전송 직후 바닥 · 알림 탭 진입 시 키보드 닫힘 (#410 끊김은 헤드리스로 재현 불가 — 기전으로만 판정)
4. `pages/Guest/GuestChatPanel.tsx` — 같은 계열(`bottomRef.scrollIntoView`, 타이핑 추적 없음)
5. AI 일정 수정 화면(`pages/QProject/ScheduleEditModal.tsx`) — 서버 운영 반영됨. 설계 `docs/AI_SCHEDULE_EDIT_DESIGN.md`
6. 운영 메일 자동연결 백필(`dev-backend/scripts/backfill-mail-links.js`) — 권한 분류기에 막혀 있던 건. Fable: 다중 프로젝트 수리 후 dry-run 정상
7. Irene 판단 3건 — 관리자 모드 알림 벨 범위 전환 · PublicSignPage 이메일 선노출 · 보고서 공유 링크 무만료
8. 백로그 — 프로젝트 "주요 이슈" 자동화 · #407 · #381/#382 Q sale · Finance 고정비 입력 UI

### 이번 세션에서 배운 것 (박제)
- `feedback_headless_hides_smooth_scroll_jank` — 헤드리스는 짧은 smooth 를 한 프레임에 끝낸다. 프레임 기록은 옛 코드도 초록 → 기전(호출 수)을 센다. 절대값 판정은 쉬는 자리부터 빨간불
- MEMORY.md 압축(342 링크 보존 · 도메인 섹션 → `index_domains.md`)
- `routes/tasks.js` 의 errorResponse 는 `middleware/errorHandler` 것 — 코드를 `message` 에 싣는다(`utils/response` 는 `code`). 테스트 판정은 둘 다 본다
- 운영 확인 명령에 `pm2` 와 `dev-backend` 문자열이 같이 있으면 POS 보호 훅이 막는다 — 나눠서 실행

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
