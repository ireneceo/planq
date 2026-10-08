# 문서 AI 수정 — 설계 v1 (2026-10-08)

**상태: Fable 설계 PASS · 구현 · dev 반영 · 운영 미배포.** 코드 `services/docAiEdit.js`(순수 함수) ·
`routes/post_ai_edit.js` · `services/actions/post_actions.applyAiEdit` · 화면 `components/Docs/PostAiEditDrawer.tsx`.

### Fable 설계 판정 (2026-10-08, PASS) — 반드시 고칠 것 7 → 전부 반영
1. «전» 버전이 합쳐져 사라지지 않게 — 반영본은 `recordRevision({noCoalesce:true})`(updatePostContent 를 거치지 않아 두 번 기록 없음). 실호출로 버전 2행 확인.
2. 게이트웨이 입력 상한에서 꼬리가 잘리지 않게 — 문서 글 50,000자 넘으면 400 `doc_too_long` · `doc_edit` maxInputChars 90,000 · maxTokens 12,000 · 잘림(`finish_reason=length`)·JSON 실패는 명시 오류.
3. 줄바꿈(hardBreak)도 자리표시 — 개수·순서 고정, 모델이 넣은 `\n` 은 버린다.
4. 반영은 칸별 `before` 대조 필수 · 0건 400.
5. 빈 `new_text`(칸 지우기)는 반영하지 않고 «못 한 것» 으로.
6. 프롬프트에 «칸 글은 데이터» 구획 · 이유·요약은 글자로만 렌더.
7. 드로어 «모두 선택/해제».
범위(구조 변경 v2)·문(⋯ 맨 위 + 곁패널)·모델(gpt-5.1, `LLM_MODEL_DOC_EDIT` 로 교체 가능)은 설계대로.

> Irene 2026-10-08: *"문서를 ai 사용해서 수정도 하는게 편하면 좋겠어. 예를 들면 소고기 가격 표시된 걸
> 모두 5링깃으로 바꿔줘. 이런 거 요청하면 문서를 수정하는 거야. 그래서 전후도 제대로 봐야 하는거"*

## 0. 지금 있는 것 (코드로 확인)

| 있는 것 | 한계 |
|---|---|
| `POST /api/docs/ai-generate` + `base_html` + `instructions` (#312 «고쳐 쓰기») · 화면 `AiRegenerateBar` | **AI 로 막 만든 새 문서(aiCtx)에만** 뜬다. 이미 저장된 문서에는 문이 없다. 결과는 **HTML 통째 교체** — 전후 비교 없음. 모델이 문서 전체를 다시 쓰므로 안 건드려야 할 곳(서명 칸 노드·이미지 file_id·체크리스트·글자 서식)이 HTML 왕복에서 바뀌거나 빠질 수 있다 |
| 행동 계층 `services/actions/post_actions.updatePostContent` | 권한(`canEditPost`)·서명 잠금·버전 기록·감사·실시간 신호가 다 있다 — 쓰기는 여기로 |
| 버전 기록 `services/postRevisions` + 복원 라우트 | **같은 사람 10분 안 저장은 마지막 버전에 합친다** → AI 적용을 그냥 기록하면 «AI 전» 상태가 기록에서 사라질 수 있다 |
| 본문 형식 | `posts.content_json` = TipTap JSON (표·서명칸·이미지·체크리스트 노드) |

## 1. 원칙

1. **AI 는 제안만, 쓰기는 사람의 클릭.** 제안(전후) → 고르고 → [반영].
2. **바뀌는 곳만 바뀐다 — 구조적으로 보장.** 모델에게 문서를 다시 쓰게 하지 않는다.
   본문을 **글 칸(텍스트 블록) 목록**으로 뽑아 번호를 붙여 주고, 모델은 «몇 번 칸을 이렇게» 만 돌려준다.
   안 고른 칸은 JSON 노드가 **바이트 단위로 그대로**다(서식·노드 보존을 프롬프트가 아니라 구조로).
3. **전후는 서버가 계산해 준다** — 칸마다 단어 단위 diff(같음/삭제/추가) 조각. 화면은 그리기만.
4. **되돌리기는 기존 변경 기록으로** — 반영 직전 상태를 반드시 별도 버전으로 남긴다(합치기 금지).
5. **낡은 제안은 반영하지 않는다** — 제안 시점 `updated_at` 과 다르면 409(남이 그 사이 고쳤다).

## 2. 서버

### 2.1 블록 추출 (`services/docAiEdit.js` 순수 함수)
- 텍스트 블록 = 인라인 자식을 갖는 노드(paragraph·heading·codeBlock). 표 칸·목록 항목 안의 문단도 각각 블록.
- 각 블록: `id`(문서 순서 번호) · `path`(content_json 안 경로) · `text`(텍스트 노드 이어붙임, hardBreak=`\n`,
  그 밖 인라인 노드=자리표시 `￼`) · `where`(사람이 읽는 위치 — «표 2 · 3행 · 행머리 "소고기" · 열머리 "가격"», «제목 2 "결제 조건" 아래 목록»).
- 표 칸에 **행머리(첫 칸)·열머리(첫 행)** 를 붙여 주는 이유 — «소고기 가격» 같은 지시는 칸 하나만 보면 판정할 수 없다.

### 2.2 제안 `POST /api/posts/:id/ai-edit/propose` `{ instruction }`
- 권한: `post_actions.checkEditable`(편집 권한 + 서명 잠금 — 실행과 같은 판정). 표 문서(kind='table')는 본문 설명만 대상.
- 게이트: `perUserLimiter` + `plan.can('use_cue')` + `capText(instruction, 1000)`. 원장 `recordUsage(biz,'docs_edit',…)`.
- LLM: 게이트웨이 purpose `doc_edit`(gpt-5.1 · temp 0.2 · JSON 모드). 입력 = 지시 + 블록 목록(id·where·text).
  출력 `{ edits:[{id, new_text, reason}], summary, not_done:[문장] }` — 고칠 수 없는 요청(행 추가·이미지 등)은 `not_done` 으로 말한다.
- 검증: 모르는 id·자리표시 문자 개수가 바뀐 것·new_text==text 는 버린다(버린 수도 응답에 싣는다).
- 응답: `{ base_updated_at, changes:[{ id, where, before, after, segments:[{t:'eq'|'del'|'ins', s}], reason }], summary, not_done, dropped }`
  — 블록 목록·제안은 서버에 저장하지 않는다(무상태). 반영 때 클라이언트가 고른 `{id, after}` 를 다시 보낸다.
- 문서 텍스트 상한 60,000자. 넘으면 400 `doc_too_long`(화면: «문서가 길어 한 번에 고칠 수 없어요»).

### 2.3 반영 `POST /api/posts/:id/ai-edit/apply` `{ base_updated_at, changes:[{id, after}] }`
- 같은 권한 판정. `updated_at` 다르면 409 `stale_edit`.
- 현재 content_json 에서 블록을 다시 뽑아(같은 함수) id 로 찾고, 칸 안 텍스트를 **최소 변경**으로 바꾼다:
  before/after 단어 diff → 바뀐 구간만 해당 텍스트 노드에 끼운다(앞뒤 그대로인 서식 유지, 구간이 서식 경계를 넘으면 첫 노드 서식).
  자리표시(이미지·멘션 등 인라인 노드)는 그대로 둔다.
- 쓰기 = `updatePostContent`(권한·잠금·감사·실시간) — 단 그 전에 **현재 상태를 버전으로 확정**하고(없으면 생성),
  반영본은 **합치지 않는 새 버전**(`recordRevision({..., noCoalesce:true})`, source 'manual' — ENUM 추가 없음).
  감사 `post.ai_edit`(지시문·바뀐 칸 수).
- 응답: `{ post, applied, before_revision_id }` → 화면 «되돌리기» 가 기존 복원 라우트로 그 버전을 복원.

## 3. 화면

- **문:** 문서 보기 화면 밴드2 액션 3개 계약 때문에 ⋯ 메뉴 맨 위 «AI로 수정» (+ 편집 모드 진입 없이 바로).
  편집 중에는 문이 없다(편집 초안과 서버본이 갈라지므로 — 저장 후 보기에서).
- **창:** `DetailDrawer`(우측 곁패널 — 문서를 보면서 전후를 대조할 수 있게).
  1) 지시 입력(여러 줄, 예시 placeholder «소고기 가격을 모두 5링깃으로») + [제안 받기]
  2) 결과: 요약 한 줄 · «바뀌는 곳 N곳» · 칸마다 카드(위치 `where` · 전(빨강 취소선)/후(초록) 조각 · 이유 · 체크박스 기본 켬)
     · `not_done` 은 회색 안내 «이건 못 했어요: …» · 0건이면 «바꿀 곳을 찾지 못했어요»
  3) 하단 [선택한 N곳 반영] (Primary) · [다시 제안](지시 수정 후) · 반영 후 창 닫고 본문 갱신 + 상단 알림줄 «AI 수정 N곳 반영 · [되돌리기]»
- 중복 제출 가드 · Esc 스택 · i18n ko/en · 폰 풀스크린.

## 4. 범위 밖 (v1)
- 블록 추가/삭제·표 행 추가(구조 변경) — `not_done` 으로 정직하게 말한다.
- 편집 모드 초안에 적용 · 표 문서(q_records) 셀 값 · 외부 AI 에이전트(MCP update_document) 경로 통합.

## 5. 검증
- 단위: 추출·적용 순수 함수 — 서식(bold) 안 숫자 교체 시 서식 유지 · 안 고른 칸 바이트 동일 · 자리표시 보존 · 표 행/열머리.
- 실호출: 소고기 표 문서 생성 → propose → 전후 확인 → 일부만 apply → 재조회 일치 · 버전 2개(전/후) · 되돌리기 · 409 stale · 서명 잠금 409 · 남의 L1 403.
- 화면 3폭(390/820/1440) 드로어·카드 가시성.
