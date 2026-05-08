## 현재 작업 상태
**마지막 업데이트:** 2026-05-08
**작업 상태:** 사이클 마무리 + 운영 4회 라이브

### 이번 세션 (2026-05-08) — Q-S 사이클

운영 라이브: `64bcfc1 → 83e2c03 → f6bbe69 → 4fad341 → 9a18ea3` (5 commit, 4 차례 운영 push)

### 완료된 작업

**핵심 기능 + 버그 fix:**
- 데스크탑 알림 사운드 unlock 패턴 (NotificationToaster — persistent AudioContext + first-gesture)
- OS app badge 합산 (인박스 + 채팅 = 단일 source) + race fix (prevTotalRef)
- 인박스 cross-workspace socket join (모든 워크스페이스 room 자동 join/leave)
- 영상/음성 업로드 12 확장자 + Drive 라우팅 5GB cap + 친절 에러
- Q Talk 모바일 입력란 가림 fix (100dvh + interactive-widget=resizes-content + visualViewport scrollIntoView)
- Q Talk FAB 자동 숨김 + 헤더 ⓘ 도움말 인라인
- Q Talk 채팅 스크롤 안정화 (sentinel + ResizeObserver/MutationObserver)
- 메시지 로드 1.5s 재시도 (silent-fail 빈화면 방지)
- StorageSettings setInterval 빈 브라우저 폴링 제거
- Q Task 우측 패널 1회 peek 애니메이션
- 알림 자동 진단 모달 (OS 별 안내, 5초 timeout)
- 사이드바 InboxDot 점 → InboxBadge 숫자 통일 (collapsed absolute)
- backend push payload.badge 합산 (frontend useGlobalBadge 와 동일 정의)
- SW setAppBadge number-only (점 표시 부작용 제거)
- 사운드 항상 + 토스트 context-aware skip 분리

**박제 — 사이클 N+1 + N+2 합의:**
- 8 설계 문서 (`/opt/planq/docs/`):
  - VISIBILITY_VOCABULARY.md
  - PERSONAL_VAULT_DESIGN.md
  - QNOTE_CAPTURE_DESIGN.md
  - AI_TASK_DESIGN.md
  - TASK_TEMPLATE_SYSTEM.md
  - SHARE_SYSTEM_UNIFIED.md
  - SMART_ROUTING_DESIGN.md
  - EMAIL_DELIVERY_POLICY.md
- 12 메모리 박제

### 미해결 이슈

**데스크탑 (Mac Chrome) push 알림 + 사운드 안 옴**
- 백엔드 statusCode 201 (FCM 까지 정상)
- 모바일 (iPhone) 정상 작동
- POS 는 같은 macOS 에서 정상 작동
- → 결론: PlanQ origin 의 Chrome 권한 차단 / SW 캐시 / PWA 환경 문제
- → 코드로 풀 수 없음. **PWA 재설치 (fresh start) 권장**
- 안 되면 운영 rollback 옵션

### 다음 할 일

**사이클 N+1 (Irene 최우선):**
- AI 업무 추가 + 미리보기 + 일괄 확정
- 업무 템플릿 시스템 (Preset 10종 + 사용자 저장 + AI 추천)
- 통합 공유 시스템 (Q task/file/info/calendar 통일)
- Smart Routing (App-First Deep Linking)

설계 박제 모두 완료 — `docs/AI_TASK_DESIGN.md`, `docs/TASK_TEMPLATE_SYSTEM.md`, `docs/SHARE_SYSTEM_UNIFIED.md`, `docs/SMART_ROUTING_DESIGN.md` 참조.

---

## 환경
- **dev:** dev.planq.kr (port 3003)
- **운영:** planq.kr (port 3004)

## 운영 라이브 (마지막)
- commit: `9a18ea3`
- timestamp: 2026-05-08 09:36 (4번째 push 완료)
- backup: `/opt/planq/backups/20260508_093744`

---

## 복구 가이드

새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
