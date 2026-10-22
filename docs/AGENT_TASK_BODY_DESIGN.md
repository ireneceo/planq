# AI 앱이 업무 «결과물»·덧붙이기를 쓰게 하기 — 설계 (Fable 판정 ADJUST 2026-10-22 → 구현)

> Irene 2026-10-21: «왜 챗지피티가 추가 못하는 거야? 확인해서 보완해줘. PlanQ 연결 오류로 업무에 직접 추가하지 못했어.
> [IPC 스티커&LED A4, A3 청구] 업무상세에 넣을 내용이야.»
> 작성 [Opus] · Fable 한도(429)로 설계 판정 못 받음 → 구현은 시작하지 않았다(공용 기준 5절).

## 원인 (코드로 확인 · 운영 실패 코드는 이 방에서 읽기 권한이 막혀 못 봄)
- ChatGPT 가 업무 상세에 쓸 수 있는 칸은 `update_task.description` 하나. 설명은 **작성자만**(FIELD_RULES, 2026-09-07 Irene).
- 결과물(`tasks.body`, 담당자만)을 쓰는 도구는 **없다.** → 남이 만든 업무면 어느 길로도 못 넣는다.
- 거절 봉투가 `forbidden_fields:description` 코드뿐이라 ChatGPT 가 «연결 오류» 로 옮겼을 가능성이 크다.
- 그 밖에: 입력 5000자 초과는 MCP 입력 검증에서 거절(감사 행 없음) · 설명·결과물은 HTML 인데 AI 가 보낸 마크다운을 그대로 저장해 줄바꿈이 뭉친다.

## 이미 고친 것 (Fable 불필요 — 문장만, 판정은 그대로)
- 업무 칸 권한 거절에 `denied_fields` + `hint`(«PlanQ 권한 규칙이지 연결 문제가 아니다 · add_task_note 로 넣기를 제안하라») — `services/agent/errors.js forbiddenFieldsError` 한 곳, 실행·미리보기 둘 다.
- `update_task` 설명에 «설명은 통째로 바뀐다(최대 5000자) · 남의 업무엔 add_task_note».

## Fable 이 정할 것 (작업 모델 권고)
1. `update_task` 에 `body`(결과물) — 권한 = 같은 FIELD_RULES(담당자만) + `taskTransition.canEditBodyInStatus` 잠금 → CONFLICT `body_locked:<상태>` + hint. 실행은 행동 계층 `updateFields` 한 곳(감사·실시간 그대로).
2. `mode: 'append'|'replace'` — 설명·결과물에 공통. 권고 기본 append(LOW), 내용이 있는 칸의 replace 는 MEDIUM(확인 2단계, riskOf). 옛 호출 호환(지금 설명은 replace LOW)을 어떻게 할지.
3. 마크다운 → HTML — `markdown.markdownToDoc` JSON 을 이스케이프한 HTML 로(원시 HTML 해석 안 함). create_task 설명도.
4. 한도 — 설명·결과물 20000자(add_client_interaction 과 같음) · `updateFields` 의 조용한 `slice(0,5000)` 대신 VALIDATION_ERROR `too_long`.
- 새 scope 없음(tasks:write) · HIGH 표면 없음.

## 검증 (판정 뒤)
① 비작성자 담당자 `update_task{body}` → 성공·화면 결과물에 서식 ② 같은 계정 `{description}` → PERMISSION_DENIED + hint ③ 비담당자 `{body}` → 거절(음성 대조군)
④ append 두 번 → 둘 다 남음 ⑤ 검토 중 업무 body → body_locked ⑥ 20001자 → VALIDATION_ERROR ⑦ `--category=agentsurface` · health-check.

## Fable 판정 (2026-10-22 · VERDICT: ADJUST) — 구현한 그대로
1. `update_task`: description·body 각 20000자(마크다운) · `mode` append(기본)|replace · replace 면 항상 MEDIUM(확인 2단계) · scope 그대로 tasks:write.
2. `markdown.js`: `docToHtml`·`markdownToHtml`(모든 글자 이스케이프, 링크는 http(s)·mailto 만) · `plainToHtml`(화면 plainTextToHtml 과 같은 규칙). update_task 설명·결과물 + create_task 설명에 쓴다.
3. `task_actions.updateFields`: body 받음 · 권한 FIELD_RULES → 잠금 `canEditBodyInStatus` → 409 `body_locked:<상태>` · 덧붙이기 = 옛 칸을 HTML 로 바꾼 뒤 잇기 · 조용한 자르기 없앰 → `description_too_long`(60000바이트)·`body_too_long`(200000자) · 감사에 mode. createTask 도 같은 바이트 검사.
4. 미리보기: body 권한·잠금을 먼저 봄(실패할 요청엔 토큰 없음) · mode · before 2000자 + 전체 글자 수. 잠금 거절 hint(수정본 작성하기 · add_task_note).
5. 옛 평문 설명은 손댈 것 없음(화면이 이미 평문→HTML 로 보여 줌).

### 자체 검증 (2026-10-22 dev, 확인용 업무 4571·4572·4573 ws 6)
① 담당자(비작성자) body → 성공·h2/목록 ② description → 거절+hint ③ 비담당자 body → 거절 ④ 덧붙이기 2번 순서대로 ⑤ 검토 중 실행·replace 미리보기 모두 CONFLICT(토큰 없음) · 보류 중 허용
⑥ 20001자 → VALIDATION_ERROR · 한글 2만 자 → description_too_long ⑦ replace 토큰 없음 → 미리보기(mode·전체 글자 수) · 토큰 → 덮어씀 · mode 없는 호출 → 덧붙임 ⑧ 옛 평문 줄바꿈 보존
⑨ `<script>`·javascript: 링크 → 글자 그대로 ⑩ 감사 mode 있음(판정 정규식이 띄어쓰기를 몰라 FAIL 로 찍힘 — 값 확인) · 잠금 대조군(검사 빼면 써짐 → 복원하면 거절) · 가드 76/77 · health-check 89/89.
