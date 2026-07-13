# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-13 (Opus, 1M) — 행동 계층 **2A(생성 계열) 갭 게이트 40 PASS / 0 FAIL** · 권한 거부가 500 으로 새던 결함 fix
**작업 상태:** 완료 (dev 검증 통과 · **미배포** — 배포하려면 `/배포`. ⚠️ 운영 배포 전 **수동 ALTER 선행 필요**)

---

## ✅ 이번 세션 완료 — 행동 계층 2A 갭 게이트 (commit d35511c)

전/후 스냅샷이 **안 본 영역**(G1~G14)을 실HTTP 로 때리는 갭 게이트를 붙였더니 FAIL 4건. 하나씩 진짜 회귀인지 테스트 결함인지 갈랐다 — **코드 회귀 3건 fix, 나머지는 게이트 자신이 틀렸다.**

### 진짜 회귀 (fix 완료)
- **G1·G2 컨텍스트 유실** — 라우트가 행동 계층에 `conversation_id`·`email_thread_id` 를 **snake_case** 로 넘겨 **조용히 버려졌다**(업무가 대화·메일에서 끊긴다). params 는 **camelCase 가 계약**. 타입도 에러도 안 난다.
- **G3 미배정 강제 배정** — 담당자 미지정 후보 등록 시 등록자가 강제로 담당자가 됐다. `allowUnassigned` 로 옛 동작(미배정 = null) 복원 — 후보 등록 경로만 허용.
- **G14 권한 거부가 500** — 행동 계층은 `menu_forbidden:qtask` 를 **http 403** 으로 거부하는데 `registerCandidate` 가 그 status 를 버려 라우트가 **500 서버 오류**로 흘렸다. 화면이 "권한 없음"과 "장애"를 구분 못 함. `err.http` 를 계약으로 올려 caller 3곳(projects·qnote_bridge·email_threads)이 그대로 응답.

### 게이트 결함 (오탐 — 테스트 fix)
- **G6·G7** — `logSince()` 가 **바이트 오프셋**(`statSync().size`)으로 **문자열**을 slice. 로그가 한글투성이라 바이트 > 문자 → 새로 쓰인 줄을 통째로 건너뛰어 **Cue 완료 로그가 구조적으로 안 보였다.** 버퍼에서 자르도록 fix + 타임아웃 45s → 240s (실제 Cue 실행 ~2분).
- **G11** — fire-and-forget 알림을 `sleep` 없이 즉시 카운트 → 언제나 0건. 프로브 실측 +500ms 에 정확히 1건 도착(user=17).

> **교훈 (박제):** FAIL 을 코드에서 찾기 전에 **판정 기계부터 의심**한다. 테스트가 "로그 없음"이라는데 `grep` 하면 로그가 있으면, 틀린 건 테스트다. memory `feedback_false_fail_suspect_the_judge.md`.

### 검증
`test-fable-2a-gaps.js` **40 PASS / 0 FAIL** (실HTTP · 전량 원복 — 잔존 task/candidate/perm 0, cue_usage 원복) · health-check **30/30** · guard-invariants **18/18** · e2e tenant **0 실패**

### 수정된 파일
- `dev-backend/services/task_extractor.js` — `err.http` 계약 + `allowUnassigned`
- `dev-backend/services/actions/task_actions.js` — `allowUnassigned` · 미배정은 '요청' 아님
- `dev-backend/routes/tasks.js` — confirm 컨텍스트 camelCase
- `dev-backend/routes/projects.js` · `qnote_bridge.js` · `email_threads.js` — 거부 상태 그대로 응답
- `dev-backend/test-fable-2a-gaps.js` — 게이트 결함 2건 fix

---

## 다음 할 일

1. **행동 계층 3사이클** — `event_create` / `document_draft` (생성 계열 잔여). **invoice 전이는 의도적 카탈로그 제외** (재무 영구 봉쇄).
2. **#81 Cue 대화형 실행** — 행동 계층 2A 완료로 선행 조건 충족.
3. **KB 과잉 제거.**
4. 운영 배포는 별도 `/배포` 대기 (이번 사이클 dev 만 반영). ⚠️ **운영 ALTER 수동 선행** 필요.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
