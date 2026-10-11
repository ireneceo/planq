# Cue 를 에이전트 카탈로그 위로 — 범위 확장 설계 (2026-10-12, Fable 설계 판정 DESIGN-OK)

> Irene 2026-10-12: *"화상미팅 하고 싶으면 구글링크 생성버튼 누른 것처럼 등록할 수 없어? 알아서 생성해서 추가 안내해주는 거야.
> 그리고 태그나 다른 설정 요청하면 다 되는 거 맞냐는 거야. 일정 뿐 아니라 다른 업무, 이메일 쓰기, 프로젝트 등록, 노트 작성, 등등
> Cue가 할 수 있는 범위를 넓히라는 거야. 그리고 수정까지."*
> 전제: docs/AI_AGENT_INTEGRATION_DESIGN.md §8.5 · Irene 결정 ⑥(카탈로그 한 벌 — M2 에 cue_tools 를 레지스트리 위로) — 미이행이었다.

## A. 구조 — cue_tools 는 레지스트리 어댑터
- `TOOL_SCHEMAS` = registry `TOOLS` 중 Cue 허용목록을 zod→JSON Schema 로 · `executeTool` = `runTool`. 자체 검증·dispatch 코드는 지운다.
- 옛 이름 흡수: `create_document_draft→create_document`, `add_task_comment→add_task_note`. `reschedule_events`(MEDIUM, preview=previewMoves)·`submit_review`(MEDIUM)는 레지스트리에 새로 등록.
- principal `{ userId, businessId, platformRole, provider:'cue', grantId:'cue:<userId>:<businessId>', clientId:null, scopes }` — scopes 는 표면: `BUNDLE_SCOPES` + `mail:*` 는 동의 화면과 같은 술어(`workspaceMailAllowed` ∧ qmail 메뉴)일 때만. 권한은 행동 계층이 본다.
- 스위치: 외부는 `AGENT_ENABLED/AGENT_WRITE_ENABLED`, Cue 는 `CUE_TOOLS_ENABLED` — `cfg.enabledFor(p)`·`writeEnabledFor(p)` 한 곳.
- 확인: 카드 누름 = 사람 확인. `runTool(..., { humanConfirmed:true })` 는 provider 'cue' 에만 MEDIUM 토큰 면제, 지문 멱등 유지(두 번 눌러도 1건, 두 번째 replayed).
- `/help` 는 쓰기를 실행하지 않는다 — 어댑터 `propose()` = strict 파싱 + `tool.preview`. 계량은 runTool 만(execute-action 의 중복 recordUsage 삭제).
- 읽기 루프: 라운드 4 · 읽기 호출 6 · 12초. 쓰기 도구가 나오면 멈추고 첫 쓰기만 카드. 읽기 감사는 /help 1행.
- 감사 `agent.<tool>` + `permission_basis:'session', provider:'cue'`. `created_via='cue'` 유지.

## B. 카드 — 공통 1개, preview 가 그린다
preview 계약 `{ summary_key, fields:[{key,label_key,value,type,editable,options?}], warnings:[code], targets:[{type,id,title}] }`. 라벨은 i18n 키. id 는 편집 불가. 편집값은 서버가 다시 strict 파싱.

## C. 1차에 여는 쓰기
| 도구 | 등급 | 조건 |
|---|---|---|
| create_event + attendees·create_meeting | 참석자/Meet 있으면 MEDIUM | 멤버·고객만 · 카드가 알림 받을 사람·Meet 소스를 말한다 · L1 Meet 차단 · Meet 실패는 일정 저장+경고 |
| update_event(제목·메모·장소·분류·알림·시간·기존 meeting_url) | MEDIUM | 행동 계층 `event_actions.updateEvent` 신설 · 예약 409 · 반복 409 · **시간 변경 시 참석자 알림(eventNotify)** — rescheduleEvent 도 같이 |
| add_meeting_to_event | MEDIUM | `/:id/meeting` 과 같은 함수(행동 계층으로 올려 라우트도 사용) |
| update_task + tag_names·category·estimated_hours | 기존 | FIELD_RULES 거절은 preview 단계에서 |

2차: 일정 PUT 전체 위임 · 메일 compose 초안 · 프로젝트 수정 · 메모/Q info 수정 · 여러 카드.
영구 금지: 발송·삭제·외부 이메일 초대·반복 시리즈 편집·예약 전이·청구·권한·20건 초과·워크스페이스 설정.

## D. 검증(필수)
옛 7종 동등(행 1·감사 1·계량 +1) · /help 쓰기 0(양성 대조군) · 격리 · 스위치 4조합 · 루프 상한 · 두 번 누름 replayed · 카드 편집값 반영 · Meet(연동/L1/미연동) · 참석자 알림 수 · update_event 알림·409 · update_task 비작성자 설명 거절 · 가드·health·빌드·e2e·카드 3폭.
