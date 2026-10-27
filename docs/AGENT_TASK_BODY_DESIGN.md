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

---

## 2026-10-27 개정 — 설명·결과물 «교체 / 덧붙이기» 분리 + 조회 Markdown 통일 (Fable 설계 GO-WITH-CHANGES → 구현)

> Irene: «추진과제 업무로 추가하면 생긴 이 내용들 다 지워야 해. 업무들에 이상하게 들어가. 이건 챗지피티가 수정요청 준거야.»
> 증상: update_task 로 고친 설명을 보내면 교체 안 되고 뒤에 붙음 · get_task 가 준 HTML 을 돌려보내면 `<p>` 등이 글자로 저장 · 반복하면 또 붙음.
> 원인: 위 10-22 판정의 «기본 append» 가 «받은 것(HTML) ≠ 보낼 것(Markdown)» 상태에서 정해졌다. 이번 개정이 그 판정을 뒤집는다(Fable 정당 판정).

1. **update_task 의 description·body = 항상 교체**, 늘 MEDIUM(확인 2단계). `mode:'append'` 는 VALIDATION_ERROR `use_append_to_task`(조용히 교체로 바꾸지 않는다). 미리보기 `replaces.<칸>` = 전·후 글자 수 · `clears_field` · `lines_removed`(사라지는 줄).
2. **append_to_task**(LOW, tasks:write) — 끝에 덧붙이기. 권한·잠금은 같은 `task_actions.updateFields`. 끝이 이미 같은 내용(공백 정리 HTML 비교)이면 `skipped_duplicate` — 권한·잠금은 그래도 본다.
3. **조회 = Markdown** — `services/agent/taskMarkdown.js` 한 벌(내놓는 문법 = 읽는 문법, 같은 문서 모형을 거친다). get_task 가 description·body 를 `description_format:'markdown'` 으로, 쓰기 한도 20000자까지 자르지 않고 준다.
   지원: 제목·문단(줄바꿈 = `<br>`)·글머리/번호/체크리스트(중첩)·인용·구분선·코드 블록·굵게·기울임·취소선·인라인 코드·링크(http(s)·mailto·앱 안 `/…`)·이미지(우리 업로드 주소만)·백슬래시 이스케이프.
   표·밑줄·정렬·알 수 없는 태그·안전하지 않은 링크/이미지 = `<칸>_lossy:true` + `_lossy_reasons` → **교체 거절** CONFLICT `lossy_use_append_or_app`(덧붙이기는 허용). 20000자 넘는 칸 = 잘림 표시 + 교체 거절 `too_long_to_replace_use_app`.
4. **원시 HTML 입력 거절** — `looksLikeHtml`(코드 블록·인라인 코드·`\<` 제외) → VALIDATION_ERROR `html_not_accepted`. update_task·append_to_task·create_task 한 함수.
5. **빈 문자열 = 비움** → null 저장(`<p></p>` 남기지 않음, MEDIUM 확인).
6. **감사에 옛 원문** — 설명·결과물을 바꾸면 `task.update_fields` old_value 에 옛 description/body 를 자르지 않고 남긴다(업무엔 버전 이력이 없어 유일한 복구 경로).
- 앱 안 Cue: update_task 를 그대로 쓴다(카드 확인 = 교체 확인). append_to_task 는 Cue 허용목록에 넣지 않았다(카드 문구가 필요 — 다음 일).
- 운영 업무 889·892·894·895·899·916(K-DINE IOI mall) 정리는 범위 밖(운영 쓰기 — Irene 지시 필요). 고친 기능이 나간 뒤 ChatGPT 가 get_task → 덩어리(`\<p>…`) 지운 Markdown 으로 update_task 하면 정리된다(dev 에서 같은 모양 재현·정리 확인).

### 자체 검증 (2026-10-27 dev, 확인용 업무 6147 ws 6)
- 도구 실호출 36/36 — 완료 기준(일부 줄 지워 교체 → 재조회 지운 것 0·남긴 것 1번, 3회 반복 동일) · 토큰 없는 교체 = 미리보기만(DB 불변) · mode:append 거절 · HTML 거절 3도구(DB 불변) · 코드 안 HTML 수용 ·
  덧붙이기 중복 건너뜀 · 같은 키 재시도 1번 · 감사 old_value 원문 · "" → null · 체크리스트·취소선·이미지·인용·중첩 왕복 · 표·밑줄 lossy → 교체 거절·덧붙이기 허용 · 운영 사고 모양 재현 → 정리 ·
  15388자 전체 · 26388자 잘림+교체 거절 · 비작성자 거절 · 결과물 교체/검토 중 잠금(덧붙이기·중복 끝도).
- 양성 대조군: 교체를 append 로 되돌리면 4건 FAIL 로 뒤집힘 → 복원 36/36.
- 왕복 고정점: dev 업무 설명·결과물 72/72(lossy 1 — 평문 `<deliverable>` 이 태그로 읽히는 옛 평문) · 무작위 Markdown 12000건 고정점 0 불일치.
