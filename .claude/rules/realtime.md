---
paths:
  - "dev-backend/routes/**"
  - "dev-backend/services/**"
  - "dev-frontend/src/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 실시간 데이터 반영·채팅 알림 검증

16. **🔥 실시간 데이터 반영 — 모든 페이지 강제 (사이클 N+38 박제)** — **사용자 호소 핵심: "리프레시 없이 즉시 보여야 한다".** 다른 사용자가 데이터 추가/수정/삭제하면 본인이 그 페이지를 열고 있을 때 **즉시 자동 반영**. 페이지 mount 시 다음 4 요소 모두 구현 필수:

    **(a) socket 연결 + business room join** — `io({ auth: token })` + `s.emit('join:business', businessId)` (cross-workspace 사용자는 모든 워크스페이스 room join). 재연결 시 `s.on('connect')` 에서 자동 재 join (TodoPage.tsx:122-124 패턴).

    **(b) backend broadcast 호출** — 데이터 변경 라우트는 모두 `io.to('business:${bizId}').emit('<event>', payload)` 호출. 라우트 추가 시 같이 broadcast 강제:
       - tasks: `task:new` / `task:updated` / `task:deleted`
       - candidates: `candidate:new` / `candidate:updated` (`routes/task_workflow.js` broadcast helper 참조)
       - messages: `message:new` (routes/conversations.js)
       - posts/files/kb/invoices/events: 같은 패턴 — entity 별 event 명. 누락 시 사용자 호소 "갱신 안 됨" 반복.

    **(c) frontend listener + silentLoad 또는 setState merge** — `s.on('<event>', debouncedReload)` (250ms debounce + 250ms 합치기) 또는 즉시 `setState((prev) => merge(prev, payload))`. list 큰 페이지는 silentLoad (server fresh — memory `feedback_visibility_refresh_server_fresh.md`), list 작은 페이지는 즉시 state merge.

    **(d) visibility/focus 복귀 안전망** — `useVisibilityRefresh(silentLoad)` 훅 추가. PWA background → foreground 또는 socket 끊김 → 재연결 시 missed event 회복. 모바일 PWA 에서 시스템이 socket 끊을 때 정합.

    **(e) 같은 탭 안 안전망 (선택)** — workflow 액션 (status 변경 등) 시 `window.dispatchEvent(new CustomEvent('inbox:refresh'))` + 페이지가 `window.addEventListener('inbox:refresh', debouncedReload)`. socket broadcast 와 별개로 자체 액션 즉시 sync (TaskDetailDrawer + TodoPage N+35 패턴).

    **(f) 서버가 거절한 소켓은 다시 붙지 않는다 (2026-10-01 박제)** — socket.io v4 는 미들웨어 거절(만료 토큰)이면
       자동 재연결을 멈춘다(`active:false`). 오래 연 화면이 배포·끊김 뒤 영영 실시간 0 이었다(메일 목록 신고).
       `services/socket.ts` 가 토큰 갱신 후 직접 `connect()` 하고, 재연결마다 `window` 에 `socket:reconnected` 를 쏜다 —
       **끊긴 동안 온 broadcast 는 다시 오지 않으므로** 실시간이 중요한 화면은 그 신호에 silentLoad 를 건다(MailPage 선례).

    **검증 시나리오 — 신규 페이지 추가 시 필수 통과:**
       1. **2 브라우저 탭** (다른 사용자 시뮬레이션) — A 가 추가/수정 → B 가 그 페이지 열고 있으면 즉시 보임 (≤ 1초)
       2. **socket 끊김** — 모바일 background 5분 후 foreground → 그 동안 다른 사용자가 추가한 데이터 즉시 보임
       3. **다중 디바이스** — 같은 사용자 데스크탑 + 모바일 동시 접속. 한 쪽 액션 → 다른 쪽 즉시 반영 (`user:N` socket room)
       4. **새로고침 불필요** — F5 안 눌러도 페이지 자체가 갱신. F5 누르면 리셋 — 사용자 호소 "리프레시 안 해도" 보장

    **신규 페이지 / 라우트 추가 시 체크리스트:**
       - [ ] backend route 가 `broadcast()` 호출하는가?
       - [ ] frontend 페이지가 socket listener 등록하는가?
       - [ ] silentLoad 함수가 200~250ms debounce 되는가?
       - [ ] `useVisibilityRefresh` 등록되어 있는가?
       - [ ] 다른 탭에서 변경 시 즉시 보이는지 visual 검증했는가?

    **회귀 사례 (N+35~):**
       - 확인필요 카드 (Dashboard/TodoPage) — socket broadcast 정합인데도 silentLoad debounce 지연 → window CustomEvent 안전망 추가
       - MemoPopup → QNote sync — backend Q note 가 별도 FastAPI 라 socket.io 사용 X → window CustomEvent 패턴
       - task_workflow.js 8 라우트 broadcast 누락 (옛) → `broadcast(req, task)` 호출 강제

    **박제: 신규 모든 페이지/라우트 작성 시 이 16번 항목을 체크리스트로 사용. 누락 시 사용자 호소 회귀 반복.**

16-P. **공개(무인증) 페이지도 다시 읽는다 — 소켓을 못 쓰므로 방식이 다르다 (2026-09-13 박제)**

> Irene: *"문서를 수정했는데도 링크에서 이전 내용으로 나와. 수정한 내용 실시간으로 반영되게 해줘."*

**서버가 신선하다고 화면이 신선한 것이 아니다.** 2026-09-13 실측 — `/api/posts/public/:token` 은
`no-store` 였고 OG 도 DB 직독이었다. 그런데 **공개 페이지 12종이 전부 mount 때 한 번 읽고 끝**이라,
링크를 열어 둔 채 원본을 고치면 보는 사람은 새로고침 전까지 옛 내용을 봤다.

- 공개 라우트는 **socket.io 가 JWT 를 요구해서 16번의 (a)(b)(c) 를 그대로 쓸 수 없다.**
  대신 **`hooks/usePublicRevalidate`** 한 벌 — 탭 복귀(`visibilitychange` + `focus` **둘 다**) 재조회 +
  보이는 동안만 60초 폴링. **숨으면 멈춘다**(공개 라우트는 인증이 없어 rate-limit 만이 방어선이다).
- **`silent` 재조회는 화면을 되돌리지 않는다.** 로딩 스피너·에러 화면·비밀번호 잠금 화면으로 떨어지면
  갱신이 아니라 고장으로 읽힌다. 실패는 삼키되 **보고 있던 내용은 그대로 둔다**(410 만료만 예외 — 그건 알려야 한다).
- **입력 중에는 끈다(`enabled: false`).** 갱신이 끼어들면 사용자가 쓰던 것이 사라진다:
  서명은 `phase === 'review'` 일 때만(OTP·캔버스 단계에서 `reload` 가 phase 를 다시 계산하면
  **그리던 서명이 날아간다**) · 청구서는 모달 열림 중 정지.
- **비밀번호로 연 페이지는 같은 자격으로 다시 읽는다** — `pwRef` 에 성공한 비밀번호를 남기고,
  401 에는 `if (silent) return`. 안 그러면 **갱신이 곧 잠금**이 된다.
- 새 공개 페이지를 만들면 이 훅을 붙인다. 검증은 "링크를 연 채 DB 로 원본을 바꾸고 탭 복귀" —
  **수정 직후엔 그대로(음성 대조군) → 복귀 후 바뀜** 둘 다 잰다.

## 검증 시나리오 — 채팅·알림 (사이클 N+12 박제)

채팅·알림 영역 (Q Talk, NotificationToaster, push, socket) 기능 추가/수정 시 **아래 4 시나리오 모두 검증**. 활성 시나리오 하나만 통과시키면 회귀가 운영까지 도달함 (N+11 → N+12 회귀 실사례).

1. **활성 conv 외 conv 메시지** → 사이드바 토탈 unread +1 + 좌측 리스트 conv row unread +1 + (활성 tab 이면) NotificationToaster 토스터 + ping 사운드
2. **background → foreground 복귀** → 백그라운드 동안 다른 conv 에 도착한 메시지로 사이드바·리스트 unread 갱신 (활성 conv 의 messages 만 복원 ≠ 검증 완료)
3. **OS push 실제 도착** (in-app 토스터와 분리) → 데스크탑·모바일 둘 다 background tab. 다른 user 가 메시지 → 두 디바이스 모두 OS notification + PushLog status='sent'. test push (디바이스 알림 테스트) 통과 ≠ 실제 채팅 push 도착 보장
4. **다중 디바이스 동기화** → 같은 user 데스크탑 + 모바일 동시 접속. 한 쪽에서 conv 읽음/핀 → 다른 쪽 자동 반영 (`user:N` socket room broadcast)

박제: `feedback_chat_notification_verification.md`.

---

