# Cue 대화형 실행 (#81) — 테스트 시나리오 / 결과

> 설계: `docs/CUE_CONVERSATIONAL_EXECUTION_DESIGN.md`. 실행 검증은 dev 실 HTTP + 서비스 직접 호출, 데이터 전량 원복.

## A. 백엔드 자동 검증 (2026-07-15, 실 HTTP + 서비스 — 24 PASS / 0 FAIL)

임시 스크립트 `test-cue-81.js`(실행 후 삭제). biz 3, owner=3, member=17('박개발').

### cue_tools 단위 (LLM 없이)
| 시나리오 | 결과 |
|------|:----:|
| validateNormalize create_task ok / title 없음 → title_required | ✅ |
| unknown tool 거부 | ✅ |
| **재무 봉쇄** — kind=invoice → invalid_kind | ✅ |
| **재무 봉쇄** — 카탈로그에 create_invoice/payment/bill 툴 부재 | ✅ |
| 문서 kind meeting_note 허용 | ✅ |
| 담당자 이름 "박개발" → user 17 (resolveAssignees 재사용) | ✅ |
| 모르는 이름 → null (본인 fallback) | ✅ |
| buildProposedAction 합성 tool_calls → proposed_action + 담당자 해석 반영 | ✅ |
| 마감일 정규화 (YYYY-MM-DD) | ✅ |
| 다중 tool_calls → 첫 유효 쓰기 1건만 | ✅ |

### execute-action HTTP
| 시나리오 | 결과 |
|------|:----:|
| create_task 201 → DB 저장, 담당자 기본 본인(오너) | ✅ |
| create_task 담당자 지정(assignee_id) → assertAssignable 통과, assignee=17 | ✅ |
| create_event 201 / create_document_draft 201 | ✅ |
| unknown_tool 400 / title 없음 400 | ✅ |
| **재무 봉쇄** — kind=invoice 400 | ✅ |
| **메뉴 게이트** — qtask='none' 멤버 execute → 403 `menu_forbidden:qtask` | ✅ |
| 데이터 전량 원복 (task·event·doc·권한 row 0) | ✅ |

## B. 통합(LLM 포함) 스모크 — /help → proposed_action
- workspace 모드 실 질문("…업무 만들어줘") → 응답에 `proposed_action.tool` 존재 확인 (실 LLM 1회).
- 킬스위치: `CUE_TOOLS_ENABLED=0` → tools 미전달 → proposed_action 없음(옛 동작).

## C. 프론트 (수동/시각)
- CueHelpDrawer workspace 모드에서 실행 지시 → 답변 아래 **인라인 확인 카드**(팝업 아님).
- 담당자 피커(비-AI 멤버) · 마감 SingleDateField · 설명 접기 · [취소]/[＋추가](ActionButton 3톤, submitting 가드).
- [추가] → 성공 시 "✓ 추가됐어요 · 열기↗"(딥링크 `/tasks?task=`·`/calendar?event=`·`/info?doc=`). done 후 재실행 불가.
- 실행 후 다른 탭/페이지 실시간 반영(행동 계층 broadcast §16).
- i18n ko/en (qhelper.action.* 34키). 에러 매핑(menu_forbidden·cannot_assign·quota).

## D. 가드 (상시)
- `guard-invariants.js` `cuetools` — TOOL_SCHEMAS·executeTool·검증·담당자 해석 존재 + 재무 모델/툴 부재 + 라우트가 행동 계층 직접 require 안 함 + execute-action 라우트 존재. **20/20 통과.**
