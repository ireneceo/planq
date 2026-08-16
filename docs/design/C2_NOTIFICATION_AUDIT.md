# C2 설계 — 알림 전수정리 (#278 · #281 · #282 · #214)

작성: 2026-08-16 (Opus 5, 1M) · 베이스 `f13bbec`
Irene 요청 원문 요지: *"전체 알림설정 파악 좀 해서 검토해봐. 채팅인지 메일인지 몰라서 헷갈려."* (#281)
*"어떤 곳의 어떤 목적의, 어떤 발송처(PlanQ or 워크스페이스 이름)를 전수검사 해서 재정리해."* (#214)

---

## 0. 확정된 병인 3개 (전부 코드 실측)

| # | 증상 | 병인 | 파일 |
|---|---|---|---|
| 278-a · 282 | **본인이 한 액션의 알림이 본인에게 온다** | 액션 계층 `broadcastTask()` 가 **`actor_user_id` 를 payload 에 안 싣는다**. 토스터는 이 값으로 본인 액션을 걸러내는데 값이 없으니 못 거른다 | `services/taskTransition.js:22-31` · 호출부 `task_actions.js:680,747,795` |
| 278-b · 214 | **"확인 권장 — PlanQ" 라는 알림이 온다** | PlanQ 가 보낸 **알림 메일이 사용자의 연결된 메일함으로 되돌아오고**, Q Mail 이 그걸 새 메일로 인지해 **다시 알린다**. 기존 루프 가드는 `email` 채널만 막아 인앱·푸시로 샌다 | `services/mailNotify.js:108-110`, 가드는 `:115-118` |
| 281 | **채팅인지 메일인지 구분이 안 된다** | 알림 제목 규약이 종류마다 제각각. 메일=`확인 권장 — {발신자}`, 업무=`{행위 문장}`, 채팅=별도. **어느 기능에서 온 알림인지 제목에 없다** | `mailNotify.js:108` · `task_actions.js:notifyTask` · 채팅 경로 |

### 0.1 #282 는 병인이 둘이다 — 두 번째는 정책 문제(Irene 확인 필요)

원문: *"완료처리는 승인한 후 업무를 처리한 담당자가 승인한 거 인지하고 해야 하는 건데"*

현재: `review_policy='any'` 이면 컨펌자 1명 승인 즉시 **자동 `completed`**
(`services/actions/task_actions.js:118-119`, `recalcStatusFromReviewers`).

이건 2026-04-25 에 **의도적으로 결정된 것**이다 — `done_feedback` 단계를 폐지하면서 자동 전환으로 바꿨다
(CLAUDE.md "Q Task 상태 ENUM" 주석). Irene 이 지금 그 결정에 이의를 제기하고 있다.

**설계 판단:** 자동 완료 자체는 유지한다. 이유 —
- 승인했는데 담당자가 완료 버튼을 또 눌러야 하면 "승인이 끝이 아닌" 이중 단계가 부활한다(폐지한 이유 그대로)
- 다만 **담당자가 승인 사실을 인지**해야 한다는 요구는 정당하다 → 지금은 자동 완료 분기에서
  **요청자에게만** 알림이 가고 **담당자에게는 아무 알림도 안 간다**(`task_actions.js:795-801` 의 if 분기).
  → **담당자에게 "컨펌 완료 — 업무가 완료 처리됐습니다" 알림을 추가**한다. 이것이 Irene 요구의 실질이다.

> 자동 완료를 없애는 쪽으로 되돌리려면 Irene 의 명시적 결정이 필요하다. 이 설계는 **되돌리지 않는다.**

---

## 1. 알림 전수 지도 (#214·#281 이 요구한 "전수검사")

### 1.1 채널 3종

| 채널 | 전달 | 정의 |
|---|---|---|
| `inbox` | 인앱 알림함 + 소켓 토스터 | `Notification` row + `notify:new` |
| `push` | OS 알림 (Web Push / APNs / FCM) | `sendPushToUser` |
| `email` | 알림 메일 | `sendNotificationEmail` |

`notification_prefs` = user × business × event_kind × channel. row 없으면 ON.

### 1.2 event_kind (현행 13종) × 제목 규약 — **지금은 통일 규약이 없다**

이 청크에서 **제목 규약 1벌**을 정본으로 세운다:

```
{기능 라벨} · {행위}          예) Q Mail · 답변 필요 · 홍길동
                               Q Task · 컨펌 요청 · "로고 수정"
                               Q Talk · 새 메시지 · 워프로랩
```

- **첫 토큰이 항상 기능명** — Irene 의 "채팅인지 메일인지 몰라서 헷갈려" 를 직접 해소
- **워크스페이스명은 본문 접두**(`[워프로랩]`)로 유지 — 이미 `subjectPrefix()` 규약이 있다
- OS 알림은 브라우저가 제목 뒤에 사이트명(`— PlanQ`)을 자동으로 붙인다. **우리가 또 붙이지 않는다**

### 1.3 발송처(From) 규약 — #214 의 핵심 질문

| 알림 성격 | From 표시 | 근거 |
|---|---|---|
| 플랫폼 사무 (가입·비밀번호·결제·약관) | `PlanQ` | 사용자와 PlanQ 사이의 일 |
| 워크스페이스 업무 (업무·메일·채팅·청구) | `{워크스페이스명}` | 사용자와 그 조직 사이의 일 |

현행 `emailService.subjectPrefix(workspaceName)` 이 이미 이 분기를 구현하고 있다(`:245`).
**전수 점검해서 workspaceName 을 안 넘기는 호출부를 찾아 채운다** — 안 넘기면 전부 `[PlanQ]` 로 떨어진다.

---

## 2. 수정 항목

### 2.1 `actor_user_id` 누락 (278-a · 282)

```js
// services/taskTransition.js
function broadcastTask(task, event = 'task:updated', actorUserId = null) {
  const data = { ...task.toJSON(), ...(actorUserId ? { actor_user_id: actorUserId } : {}) };
  ...
}
```
호출부 전수(`task_actions.js` 3곳 + 그 외 `grep broadcastTask`)에 actor 를 넘긴다.

**fail-closed 가드 추가:** `actor_user_id` 없이 broadcast 하는 경로를 정적 가드로 잡는다
(`scripts/guard-invariants.js` 신규 카테고리 `broadcast-actor`). 안 그러면 다음 emit 지점에서 재발한다.

### 2.2 자기 알림메일 재수신 루프 (278-b · 214)

`services/mailNotify.js` 진입부에 **발신자 기준 차단**:
- 인바운드 메일의 `from_email` 이 **PlanQ 시스템 발신 주소**(`MAIL_FROM`/`noreply@planq.kr` 계열)면
  `notifyInboundMail` 자체를 **skip** (알림을 만들지 않는다)
- 판정은 상수 1벌(`services/platformMail.js` 가정 — 없으면 신설)로 두고 `emailService` 의 발신 주소와
  **같은 원천**을 쓴다 (두 벌로 갈라지면 다시 샌다 — 메모 `feedback_predicate_must_match_both_sides`)

> 메일 자체를 안 받게 하는 것이 아니다. **그 메일에 대한 알림만** 만들지 않는다.
> (PlanQ 알림메일은 메일함에는 남아야 한다 — 사용자가 지운 알림을 메일로 다시 찾을 수 있어야 함)

### 2.3 제목 규약 통일 (281)

- `services/notifyTitle.js` **(신규)** — `buildTitle({ feature, action, subject })` 1벌
- 적용처: `mailNotify.js` · `task_actions.js:notifyTask` · 채팅 알림 경로 · 캘린더 · 청구
- i18n: 제목도 ko/en 양쪽 (현재 한국어 하드코딩이 다수 — `title: '컨펌자가 승인했습니다'` 등)
  → **이건 별도 부채다.** 이 청크에서는 규약 함수와 ko/en 키를 만들고, 호출부는 전수 전환한다.

### 2.4 담당자 승인 인지 알림 추가 (282)

`task_actions.approve()` 의 `task.status === 'completed'` 분기에서
요청자 알림에 더해 **담당자 알림**을 추가 (actor 제외는 기존 `excludeUserId` 그대로).

---

## 3. 변경 파일

**백엔드**
- `services/taskTransition.js` — broadcastTask actor 파라미터
- `services/actions/task_actions.js` — 호출부 3곳 + approve 담당자 알림
- `services/mailNotify.js` — 자기발신 메일 알림 skip
- `services/notifyTitle.js` **(신규)** — 제목 규약
- `services/emailService.js` — workspaceName 미전달 호출부 보정
- `routes/notifications.js` — (제목 규약 적용 지점 확인만, 로직 무변경 목표)
- `scripts/guard-invariants.js` — `broadcast-actor` 카테고리

**프론트**
- `components/Common/NotificationToaster.tsx` — 규약 변경에 따른 표시 정합 확인
- `public/locales/{ko,en}/*.json` — 알림 제목 키

**DB 변경 없음.**

---

## 4. 검증 계획

1. **자기 액션 무알림** — A가 컨펌 승인 → **A 화면에 토스터 0건**, 담당자·요청자 화면에는 1건씩 (2탭 실측)
2. **반증** — `actor_user_id` 를 다시 빼면 1번이 FAIL 하는지 실측
3. **루프 차단** — PlanQ 알림메일을 실제로 수신시킨 뒤 `notifications` row 증가 0 · `push_logs` 증가 0
4. **반증** — skip 조건을 끄면 3번이 FAIL 하는지
5. **제목 규약** — 메일·업무·채팅 각 1건 발생시켜 제목 첫 토큰이 기능명인지 실측
6. **발송처** — 플랫폼 사무 메일 1건 `[PlanQ]`, 워크스페이스 업무 메일 1건 `[워프로랩]` 실측
7. **가드** — health-check · build · guard-invariants 전체 · i18n 패리티
8. **회귀** — 채팅·알림 4시나리오(CLAUDE.md "검증 시나리오 — 채팅·알림") 전건
