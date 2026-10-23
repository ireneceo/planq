# Cue 답 흘려 보내기(스트리밍) 설계 — 2단계

> Irene 2026-10-23: *"Cue를 검색창에서 쓰니 너무 오래 걸려. 속도 당길 수 없어?"*
> 1단계(82bac69e): 위키 검색 병렬화 + 라운드별 시간 로그. 실측 — 서버 준비 0.18~0.34초, 나머지는 LLM 왕복
> (라운드당 1.9~3.3초 · 도구를 쓰면 2라운드 5.6초). 사용자는 마지막 글자까지 «생각 중…» 만 본다.
> 목표: **첫 글자를 1~3초 안에.** 답의 내용·카드·과금·로그는 그대로.

## 0. 범위
- 바꾸는 것: `services/llm.js`(스트림 선택지) · `services/cue_tools.js converse`(라운드별 흘리기) ·
  `routes/cue.js POST /help`(SSE 응답 — `Accept: text/event-stream` 일 때만) · `server.js` compression 필터 ·
  `hooks/useCueChat.ts`(스트림 읽기) · `components/Common/CueTurnList.tsx`(흘러오는 답 그리기) · i18n 1키.
- 안 바꾸는 것: 옛 JSON 응답(Accept 없으면 바이트 단위로 그대로) · `/help-public`(게스트 — 캐시 경로) ·
  `/execute-action` · 다른 LLM 용도 전부(스트림은 **선택 인자**, 안 주면 지금 코드 경로 그대로) · 프롬프트·모델·도구·상한.

## 1. 게이트웨이 — `callLLM({ …, onDelta })`
- `onDelta` 를 준 호출만 `stream: true, stream_options: { include_usage: true }` 로 보낸다. 없으면 지금 경로(한 줄도 안 바뀜).
- 반환 모양은 **지금과 같다**(`content · tool_calls · finish_reason · input_tokens · cached_tokens · output_tokens · fallback · model · ms · attempts`).
  스트림 조각을 모아 `content` 와 `tool_calls`(index 별로 id·name·arguments 이어 붙이기)를 만들고, 마지막 usage 조각에서 토큰을 읽는다.
- `onDelta(text)` 는 content 조각마다 부른다. `onToolStart()` 는 첫 tool_calls 조각에서 한 번.
- 재시도: **첫 조각을 내보내기 전**(HTTP 상태 단계·연결 실패)에만 지금 규칙대로. 조각을 내보낸 뒤 끊기면 재시도하지 않고
  fallback(통계 failed) — 다시 보내면 화면에 같은 글이 두 번 흐른다.
- 타임아웃: 지금 `AbortSignal.timeout(45s)` 를 스트림 전체에 그대로 + 호출부가 준 `signal`(사용자가 창을 닫음)과 합친다(`AbortSignal.any`).
- 빈 본문 경고·통계·last_error 는 지금과 같은 자리에서.

## 2. 도구 루프 — `converse({ …, onEvent })`
라운드마다 `callLLM({ onDelta, onToolStart })` 로 부른다. 라운드 결과 판정 로직은 **지금 그대로**이고 화면 신호만 더한다:
| 이 라운드가 | 내보내는 신호 |
|---|---|
| 글만 냈다(= 답) | 조각마다 `delta` |
| 읽기 도구를 불렀다(다음 라운드로) | 첫 tool 조각에서 `status:searching` · 앞서 흘린 글이 있으면 `reset` |
| 쓰기를 전부 받아들였다(= 답 + 카드) | 흘린 글 그대로(카드는 `done` 에만) |
| 쓰기 일부 거절(다음 라운드로) | `reset` + `status:searching` |
- 글이 tool_calls 와 같이 오는 드문 라운드(앞말)는 일단 흘리고, 그 라운드가 다음 라운드로 넘어가면 `reset` 으로 지운다.
- 사용자가 끊으면(signal) 다음 라운드를 시작하지 않는다(비용). 이미 쓴 토큰은 아래 원장에 그대로 적는다.

## 3. 분류 꼬리표 붙잡기 — `services/cueStreamTag.js`(새, 순수 함수)
답 끝의 `[[cue:topic=…;intent=…;ok=…]]` 가 흘러나오면 안 된다.
- 흘리는 쪽에 «보류 버퍼» 를 둔다: 내보낼 글에서 **`[` 로 시작하는 꼬리 중 `[[cue` 의 앞부분이 될 수 있는 것**(`[`, `[[`, `[[ c`, `[[cu` …)은 다음 조각까지 잡아 둔다.
  `[[cue` 가 확정되면 그 뒤는 **끝까지 아무것도 안 내보낸다**(태그는 맨 끝줄 약속이고, 뒤에 무엇이 와도 `done.answer` 가 정본).
  아니라고 판명되면(`[[x`, `[링크]`) 잡아 둔 글을 내보낸다.
- 태그 앞 줄바꿈·공백도 잡아 둔다(끝에 빈 줄이 남지 않게) — 공백 꼬리는 다음 글자가 오면 같이 내보낸다.
- `done.answer` = 지금과 같은 `parseClassification(content).answer` — 화면은 done 을 받으면 흘린 글을 **이것으로 바꾼다**(정본은 하나).
- 단위 검사: 태그가 조각 경계 어디에서 잘려도 화면 글에 `[[` 가 0번 · 마크다운 링크 `[a](b)` 는 그대로 · 태그 없는 답 그대로.

## 4. 라우트 — `POST /api/cue/help`
- `Accept` 에 `text/event-stream` 이 있을 때만 스트림. 그 전의 모든 거절(400 question_required · 409 stale · 422 한도 · 429 rate-limit · 키 없음)은
  **헤더를 보내기 전**이라 지금 JSON 그대로 나간다 — 화면은 Content-Type 으로 가른다.
- 문맥 수집이 끝난 뒤(LLM 직전) 헤더를 보낸다: `Content-Type: text/event-stream; charset=utf-8` · `Cache-Control: no-cache, no-transform` ·
  `X-Accel-Buffering: no`(nginx `/api/` 블록은 buffering 켜져 있다) · `res.flushHeaders()`. 곧바로 `status:thinking` 하나(첫 바이트).
- 이벤트(SSE `event:` + `data:` JSON 한 줄):
  - `status` `{ kind: 'thinking'|'searching' }`
  - `delta` `{ t }` — 꼬리표 붙잡기를 거친 글
  - `reset` `{}` — 지금까지 흘린 글을 지운다
  - `done` `{ …옛 JSON 의 data 와 같은 칸 }` — answer · mode · sources · log_id · proposed_action(s)
  - `error` `{ message: 'llm_error' }` — 옛 502 와 같은 코드
- 과금(recordUsage)·질문 로그·주제 분석·감사·사용량 로그 줄은 **지금과 같은 자리·같은 조건**에서, `done` 을 쓰기 직전에.
  끊긴 경우(사용자가 닫음)에도 LLM 을 한 번이라도 불렀으면 토큰을 원장에 적는다(지금도 응답이 버려져도 적는다 — 같은 뜻).
- `req.on('close')` → AbortController → converse·callLLM 에 signal. 쓰기 전에 `res.writableEnded/destroyed` 확인.
- compression: `server.js` 필터가 응답 Content-Type 이 `text/event-stream` 이면 압축하지 않는다(압축은 조각을 모아 보낸다).
- 스트림 경로와 JSON 경로는 **한 함수**가 만든다 — 마지막 «응답 내기» 만 `sink`(JSON 이면 successResponse, 스트림이면 done 이벤트)로 갈라
  카드·출처·과금 코드를 두 벌로 만들지 않는다.

## 5. 화면 — `useCueChat` + `CueTurnList`
- 로그인 사용자(`!isGuest`)는 `Accept: text/event-stream` 을 싣는다. 응답 Content-Type 이 event-stream 이 아니면 지금 JSON 처리 그대로
  (거절·옛 서버·프록시가 바꾼 경우).
- 스트림: `res.body.getReader()` + `TextDecoder` + SSE 줄 파서(빈 줄 = 이벤트 끝). `delta` → 그 턴 `a += t` (loading 유지, `streaming:true`) ·
  `reset` → `a=''` · `status:searching` → `phase:'searching'` · `done` → 지금 JSON 성공 처리와 **같은 함수**로 마무리(a 를 done.answer 로 덮음·카드·출처·logId) ·
  `error` 또는 done 없이 끝남 → 지금 오류 처리.
- 렌더: `loading && a` 이면 «생각 중…» 대신 흘러오는 글(`Answer`)을 그린다. `loading && !a` 는 phase 에 따라 «생각 중…» / «워크스페이스에서 찾는 중…»(새 키 `qhelper.searching` ko/en).
  카드·출처·피드백은 지금처럼 `!loading` 일 때만.
- 상태 갱신은 조각마다가 아니라 **한 프레임에 한 번**(requestAnimationFrame 으로 모아) — 조각이 초당 수십 개라 setState 폭주를 막는다.
- 세 표면(검색창·드로어·채팅/메일 우측 패널)이 같은 훅·같은 목록이라 함께 바뀐다. 드로어 자동 스크롤은 `[turns]` 효과라 흘러올 때도 따라간다.

## 6. 검증
- 단위: 꼬리표 붙잡기(조각 경계 전수 · 링크 · 태그 없음) · 게이트웨이 스트림 조립(가짜 SSE 본문으로 content/tool_calls/usage) — 실호출 없이.
- 실호출(dev, owner ws6): 같은 질문 3종(일반·도구 읽기·카드 제안)을 JSON / 스트림으로 — **첫 delta 까지 ms** · 끝까지 ms · answer 같음 ·
  카드 수 같음 · cue_usage 행 1개씩 · 스트림 글 어디에도 `[[cue` 없음 · Accept 없이 옛 JSON 그대로 · 한도 422 는 JSON.
- 화면 3폭: 검색창 Cue — 흘러오는 중 글이 보임(elementFromPoint) · 끝나고 카드 · 꼬리표 0.
- 대조군: 붙잡기를 끈 필터로 돌리면 `[[cue` 가 화면에 나와 판정이 뒤집히는지.

## 7. 정할 것 (Fable)
1. reset 방식(앞말을 흘렸다 지우기) vs 라운드 끝까지 잡아 두기(앞말 라운드만 늦어짐) — 위는 전자.
2. 사용자가 끊었을 때 과금 1회를 그대로 둘지(지금 JSON 도 응답을 안 봐도 1회) — 위는 그대로.
3. `onDelta` 를 `callLLM` 선택 인자로 넣는 것 vs 별도 `callLLMStream` 함수 — 위는 선택 인자(재시도·통계·능력표 한 벌).

## 8. Fable 설계 판정 (2026-10-23) — OK-WITH-CHANGES
- 결정: ① reset 방식 — 단 `onToolStart(name)` 으로 도구 이름을 넘겨 읽기 도구면 곧바로 reset+searching, 쓰기면 라운드 끝에 판정(전부 수용 → 그대로, 일부 거절 → reset)
  ② 과금 1회 그대로 — **게이트웨이에 signal 을 넘기지 않는다**(중간에 끊으면 usage 조각이 안 와 토큰 0 이 적힌다). 끊으면 converse 가 다음 라운드만 안 시작
  ③ 선택 인자 `onDelta` — 분기는 `data = onDelta ? readSseBody(r) : r.json()` 한 줄, readSseBody 가 같은 모양을 돌려준다. 조각을 낸 뒤 실패는 재시도 없이 break
- 고칠 것: 끊김 감지는 `res.on('close') && !res.writableFinished`(req close 는 본문 읽은 직후 불린다) · 헤더 뒤 예외는 `event:error internal_error` + end ·
  꼬리표 접두 판정은 cueQuestionAnalysis 의 TAG_RE 옆(대소문자·공백 허용 같이) · log_id await → done · 끊겨도 원장·분석·감사 같은 자리 ·
  조립 단위검사에 tool_calls 조각 합치기·cached_tokens · 오류가 조각 뒤면 부분 글 + 오류 한 줄 · event-stream 아니면 JSON 경로 그대로(422 한도 창 포함) · done 덮기는 JSON 성공 처리와 같은 함수.
