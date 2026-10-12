# 업무 «결과물 액션» 설계 — 업무에서 문서·일정·메일·프로젝트를 만들러 보내고, 만든 것을 업무에 건다

설계: [Fable] 2026-10-12 · 상태: **설계 — Irene 승인 전 구현 안 함**
정찰: `.claude/plans/qmv4ltl66.md`(HEAD ed936de1 기준) — 이 문서는 2026-10-12 HEAD(827b9df8)로 다시 대조했다.

> Irene 원문: *"업무에서 내부 우리 솔루션 내의 액션기능이 있으면 어때? 업무를 할 때 결과물을 문서로 만들어야 하면 문서작성하게 보내고, 프로젝트를 만들게 보내고, 일정을 추가하게 보내고 메일쓰게 보내거나 등등 액션추가라고 해서 결과적으로 할 일을 넣어두고 안내하면 더 쉬울 것 같은데 어때? 결과물에 넣기위해 작업이 필요할 때 하는 거지 그리고 그 액션버튼을 통해 갔으면 해당 업무랑 연결되어 있는 거 알게 해주고 문서들 업무랑도 연결하는 거 있는게 좋지 않아? 반복업무의 경우 결과물 버전별로 액션하게 하고. 이거 검토해봐. 있으면 탁월한 기능이 될 것 같아서."*

---

## 0. 한 줄 결론

**만든다 — B안(액션 표 신설)으로.** 다만 «연결» 자체는 새로 만들지 않는다. 문서는 이미 있는 업무 첨부(`task_attachments.post_id`)에, 일정은 이미 있는 `calendar_events.task_id` 에 건다. 새 표(`task_action_items`)는 **«아직 안 만든 할 일»과 «무엇으로 끝났나»** 만 담는다.

Irene 요청을 네 조각으로 나누면 지금 저장소에 있는 것은 절반이다:

| 조각 | 지금 | 이 설계 |
|---|---|---|
| ① 할 일을 넣어 두고 안내 | 없음 | **새 표** — 업무 상세 «결과물 액션» 칸(체크리스트) |
| ② 버튼으로 그 화면에 가서 만들기 | 없음 (새 문서·새 일정·새 메일·새 프로젝트 어느 화면도 «어느 업무에서 왔는지» 받는 문이 없다) | 모든 대상 화면이 **같은 주소 인자 하나**(`?from_action=<id>`)를 읽고, 저장 경로가 **서버 함수 하나**로 연결을 쓴다 |
| ③ 만든 것이 업무와 연결됐다고 보이기 | 일정 → 업무 한 방향만 (`EventDrawer` 업무 칩). 문서·메일·프로젝트에는 업무 역참조 0 | 대상 쪽 «업무: 제목» 칩 — **직렬화 함수 하나**, 보는 사람 기준 |
| ④ 반복업무는 회차마다 | 회차 = 별도 업무 행이라 저절로 성립 | 새 회차를 만들 때 **액션 목록 내용만 복사**(연결·완료는 안 따라감) |

정찰 계획의 정정 한 가지: 계획은 업무↔일정이 «양방향 표시 있음» 이라 했지만, **업무 상세(`TaskDetailDrawer`)에는 연결된 일정이 전혀 안 보인다**(일정 상세에서 업무만 보인다). 이 설계의 액션 칸이 업무 쪽에서 일정을 보는 첫 자리가 된다.

---

## 1. 왜 B안인가 (A안·C안을 버린 이유)

| 안 | 내용 | 판정 |
|---|---|---|
| **A. 연결만** — 업무 상세에 «만들기» 메뉴, 저장되면 기존 연결 문에 건다. 표 없음 | 누르면 바로 가고, 돌아오면 연결만 남는다 | ✗ Irene 요청의 핵심 «할 일을 **넣어두고** 안내» 가 없다. 메일·프로젝트는 걸 칸도 없어 결국 컬럼을 늘려야 한다 — 표 하나 안 만들려다 네 표에 칸을 흩뿌리게 된다 |
| **B. 액션 표** — 업무에 «만들 것» 을 미리 적어 두고, 가서 만들면 그 행이 «무엇으로 끝났나» 를 기억한다 | `project_stages`(kind·status·linked_entity_type/id)와 같은 모양이 이미 있고 검증돼 있다 | ✓ 채택 |
| **C. 범용 연결 표** — 업무↔무엇이든 거는 polymorphic 표 하나로 기존 연결까지 흡수 | 깔끔해 보인다 | ✗ 이미 쓰이는 `task_attachments.post_id`·`calendar_events.task_id`·`tasks.email_thread_id` 를 옮겨야 한다(운영 백필 = 되돌리기 어려움). 같은 값이 두 곳에 있는 기간이 생긴다. «새로 만들지 않는다» 규칙 위반 |

**B 에서 지키는 선 — 같은 값을 두 벌로 만들지 않는다.**
- «이 문서는 이 업무의 결과물에 들어가는가» 의 정본은 **그대로 `task_attachments`(post_id, context='task')** 다. 액션으로 만든 문서도 이 표에 들어간다(그래서 컨펌 제출 회차 박제 `attachment_ids` 에 저절로 포함된다 — §5).
- «이 액션은 무엇으로 끝났나» 의 정본은 **`task_action_items.linked_entity_*`** 다.
- 둘은 뜻이 다른 두 질문이라 두 표가 맞다. 대상 화면의 «연결된 업무» 칩은 **함수 하나**가 두 표를 합쳐 읽는다(§3) — 읽는 공식이 하나면 갈라지지 않는다.

---

## 2. 데이터 모델

### 2.1 새 표 `task_action_items`

> 이름을 `task_actions` 로 하지 않는 이유: `services/actions/task_actions.js` 가 **행동 계층(업무 상태 전이·필드 규칙)** 파일이다. 같은 이름의 표·라우트·서비스를 두면 구현하는 사람이 두 파일을 섞는다. 화면 글자는 «결과물 액션».

| 칸 | 형 | 뜻 |
|---|---|---|
| `id` | INT PK AI | |
| `business_id` | INT NOT NULL | 테넌트 축. 모든 조회 WHERE 에 건다 |
| `task_id` | INT NOT NULL · FK tasks CASCADE | `task_attachments`·`task_links` 와 같은 삭제 계약(업무가 지워지면 계획도 간다) |
| `order_index` | INT NOT NULL DEFAULT 0 | 목록 순서(끌어 옮기기는 2단계) |
| `kind` | ENUM('doc','event','mail','project') NOT NULL | 1단계 화면은 doc·event 만 열고, ENUM 은 넷을 처음부터 둔다(뒤에 append 마이그레이션을 또 돌리지 않게). 서버는 `TASK_ACTION_KINDS` 설정의 `enabled` 로 받을 수 있는 종류를 가른다 — 꺼진 종류는 400 |
| `label` | VARCHAR(200) NOT NULL | 무엇을 만들 것인가(«견적서 초안», «킥오프 미팅»). 대상 화면의 제목 기본값이 된다 |
| `note` | VARCHAR(1000) NULL | 메모(받을 사람·참고) |
| `meta` | JSON NULL | 종류별 힌트(일정: 희망 날짜 · 메일: 받는 주소). `project_stages.metadata` 와 같은 자리 |
| `status` | ENUM('pending','active','completed','skipped') NOT NULL DEFAULT 'pending' | **`project_stages` 와 같은 네 낱말.** pending=안 만듦 · active=만들기 시작했으나 끝나지 않음(임시저장 문서) · completed=끝 · skipped=이번엔 안 함 |
| `linked_entity_type` | ENUM('post','calendar_event','email_thread','project') NULL | 종류↔대상 짝은 서버 표 하나(doc→post · event→calendar_event · mail→email_thread · project→project). 어긋나면 400 |
| `linked_entity_id` | INT NULL | |
| `linked_attachment_id` | INT NULL | doc 액션이 **스스로 만든** `task_attachments` 행. 해제할 때 이것만 지운다(사람이 따로 붙인 첨부는 건드리지 않는다) |
| `fulfilled_by` / `fulfilled_at` | INT NULL / DATETIME NULL | 누가 언제 끝냈나 |
| `fulfilled_round` | INT NULL | 끝낸 시점의 `tasks.review_round` — «결과물 어느 회차에서 만든 것» (표시는 2단계, 값은 처음부터 적는다. 나중에 두 공식으로 추정하지 않기 위해 — `TaskDeliverableVersion.review_round` 가 같은 이유로 생겼다) |
| `created_by` | INT NOT NULL | |
| `created_at` / `updated_at` | | `timestamps:true, underscored:true` |

인덱스: `(task_id, order_index)` · `(task_id, status)` · `(business_id, linked_entity_type, linked_entity_id)`(대상 쪽에서 «나를 건 업무» 를 찾을 때).

외래키는 `task_id` 만. 대상(post·event·thread·project)에는 FK 를 두지 않는다 — 문서는 휴지통(soft delete)이라 행이 남고, 지워졌는지는 **보여줄 때** 판정한다(`eventTaskLink` 가 `deleted:true` 를 붙이는 것과 같은 방식).

### 2.2 기존 표 — 변경 없음
`task_attachments`·`calendar_events`·`email_threads`·`projects`·`posts` 에 칸을 더하지 않는다. 메일·프로젝트의 «이 업무에서 만듦» 은 새 표의 `linked_entity_*` 가 담는다.

### 2.3 운영 적용
`dev-backend/scripts/migrate-task-action-items.js` — `CREATE TABLE IF NOT EXISTS` + 인덱스, 멱등, `--dry`. **코드 배포 전**(배포 슬롯 등록). 롤백 = 코드만 되돌림(표는 남아도 무해).

---

## 3. 서버 — 함수는 셋, 자리는 한 곳

새 서비스 **`services/taskActionItems.js`** 하나에 모은다. 라우트·행동 계층·대상 화면 저장 경로가 전부 이 파일을 부른다.

### 3.1 `fulfill({ actionId, actor, entityType, entityId, transaction?, source })` — «무엇으로 끝났나» 를 쓰는 **유일한 문**
1. 액션을 `id + business_id` 로 읽는다(없으면 404 — 남의 워크스페이스 id 는 존재도 알리지 않는다).
2. 업무를 읽고 `canAccessTask` + **담당자인가**(§6 권한). 아니면 403 `only_assignee`.
3. 대상 행이 **같은 business_id** 인지, 종류 짝이 맞는지.
4. `status` 가 pending·active 일 때만. 같은 대상을 다시 보내면 **멱등(no-op)**.
5. 쓰기(한 트랜잭션):
   - `linked_entity_*`, `fulfilled_*`, `fulfilled_round = task.review_round`
   - 종류별 상태: **doc** → 문서가 `draft` 면 `active`, 발행본이면 `completed` · **event/mail/project** → `completed`
   - **doc 이면 `task_attachments`(post_id, context='task') 행을 만든다** — `routes/task_attachments.js` 의 문서 첨부 블록을 **함수로 뽑아**(`services/taskAttachmentLink.linkPostsToTask` — 파일용 `linkFilesToTask` 가 이미 그 파일에 있다) 라우트와 같이 쓴다. 중복 검사도 그 함수 안. 만들어진 행 id 를 `linked_attachment_id` 에.
6. 감사 `task.action_fulfilled`(old/new) · `broadcastTask(task,'task:updated')`(services/taskTransition — 기존 함수. 드로어는 이 사건에 상세를 다시 읽는다).

실패해도 **대상(문서·일정)은 이미 만들어진 뒤**다. 호출부는 응답에 `warnings:['action_link_failed']` 를 실어 화면이 «문서는 만들어졌지만 업무에 연결되지 않았습니다 — 업무에서 [기존 것 연결]» 을 말한다. 조용히 삼키지 않는다.

### 3.2 `onPostPublished(post)` · `unlink({ actionId, actor })` · `onAttachmentDeleted(attachment)`
- **문서가 draft → published 가 되는 순간**(`routes/posts.js` 승격 PUT · `post_actions.updatePostContent` 의 status 변경) `active` 액션을 `completed` 로. 문서를 다시 draft 로 내리는 길은 없으니 역방향은 없다.
- **해제**(담당자): 링크 칸 비움 · `status='pending'` · `linked_attachment_id` 가 있으면 그 첨부 행만 삭제. 감사 `task.action_unlinked`.
- **첨부 목록에서 사람이 그 첨부를 지우면**(`DELETE /api/tasks/attachments/:id`) 그 첨부를 가리키는 액션은 pending 으로 돌아간다 — 안 그러면 «완료인데 결과물에 없는» 거짓 상태가 남는다.
- 대상이 지워진 경우(문서 휴지통·프로젝트 보관)는 **읽을 때** `deleted:true` 로 그린다. 상태를 되돌리지 않는다(사람이 지운 뜻을 시스템이 해석하지 않는다).

### 3.3 `linkedTasksOf(entityType, entityId, viewer, businessId)` — 대상 쪽 «연결된 업무» **직렬화 하나**
- 모은다: `task_action_items`(linked_entity) ∪ 종류별 기존 연결(post → `task_attachments.post_id` · calendar_event → `calendar_events.task_id` · email_thread → `tasks.email_thread_id`(메일에서 만든 업무, 반대 방향이지만 «연결된 업무» 로 같은 칩) · project → 액션만).
- 거른다: **보는 사람 기준 `canAccessTask`**(`access_scope`) — 못 보는 업무는 제목도 id 도 내지 않는다(`routes/posts.js` 의 `linked_posts` 와 같은 규칙). 예외는 일정 하나 — `eventTaskLink.attachTaskLinks` 는 이미 `{id, hidden:true}` 를 내는데, 그 칸은 사람이 바꾸는 선택 칸이라 «값이 있다» 는 사실을 숨기면 실수로 지운다. **기존 동작을 바꾸지 않는다.**
- 내보내는 모양: `[{ id, title, status, project_id, via: 'action'|'attachment'|'event'|'source' }]`. 제목을 복사해 두지 않고 매번 읽는다(공유·참조 다섯 규칙 ⑤).
- 고객(client) 역할도 같은 함수 — 고객이 볼 수 있는 업무(자기 프로젝트의 업무 등)만 남는다. 액션 목록 자체는 고객에게 내지 않는다(§6).

### 3.4 라우트 — 새 파일 `routes/task_action_items.js`
| 메서드·경로 | 누가 | 하는 일 |
|---|---|---|
| `GET /api/tasks/:id/actions` | 멤버 이상 ∧ canAccessTask | 목록(+ 대상 요약: 문서 제목·상태·일정 시각 — 보는 사람이 그 대상을 볼 수 있을 때만, 아니면 `hidden:true`) |
| `POST /api/tasks/:id/actions` `{kind,label,note?,meta?}` | 작성자·담당자·owner·admin | 추가. 중복 제출 가드. 업무당 상한 **30** |
| `PATCH /api/tasks/:id/actions/:aid` `{label?,note?,meta?,order_index?,status?:'skipped'\|'pending'}` | 같음 | 글자·순서·건너뜀 |
| `DELETE /api/tasks/:id/actions/:aid` | 같음 | 삭제(완료된 것은 먼저 해제해야 지울 수 있다 — 결과물에 들어간 첨부가 조용히 빠지지 않게) |
| `POST /api/tasks/:id/actions/:aid/link` `{entity_type, entity_id}` | **담당자** | «기존 것 연결» → `fulfill(source:'manual')`. 문서는 `canReadPost`, 일정은 `canAccessEvent` 등 **각 자료의 읽기 술어**를 먼저 본다(붙일 때 원본 읽기 권한) |
| `DELETE /api/tasks/:id/actions/:aid/link` | **담당자** | 해제 |
| `GET /api/task-actions/:aid/handoff` | 멤버 이상 ∧ canAccessTask | 대상 화면이 처음 열릴 때 읽는 것: `{ action:{id,kind,label,note,meta,status}, task:{id,title,due_date,project_id,business_id}, can_perform }`. **주소에는 숫자 id 만** 다닌다(제목·마감이 URL 에 안 실린다) |

마운트: `/api/tasks` 에 **`routes/tasks.js` 보다 앞**에 붙인다(`/:id/actions` 가 `tasks.js` 의 `/:id/:x` 류와 겹치지 않도록 — 가드 `duproute` 는 한 파일만 보므로 순서가 계약이다). `/api/task-actions` 는 별도 접두어.

### 3.5 대상 저장 경로가 부르는 자리 (각 1줄)
| 종류 | 만드는 문 | fulfill 호출 자리 |
|---|---|---|
| doc | 화면 `POST /api/posts` → `services/actions/post_actions.createPost` | `createPost(params.fromActionId)` 끝에서. 화면은 **첫 자동저장(draft 생성)** 때 보낸다(`PostsPage` 는 첫 글자에 draft 를 만든다) → 액션 `active` → 발행 때 §3.2 로 `completed` |
| event | 화면 `POST /api/calendar/:biz/events`(`routes/calendar.js:593` 인라인) · 에이전트 `event_actions.createEvent` | 라우트와 행동 계층 **둘 다** 끝에 한 줄(둘이 한 함수가 아니다 — 지금 구조 그대로 둔다). `task_id` 는 handoff 가 준 업무 id 로 이미 채워 보낸다(`resolveTaskLink` 가 검증) |
| mail | `POST /:biz/email-compose`(`routes/email_threads.js:1312`) — 보내는 순간 스레드가 생긴다 | 스레드 생성 뒤 `fulfill(email_thread)`. **초안(`email_drafts`)은 걸지 않는다** — 사용자당 1행이라 «어느 액션의 초안» 을 담을 자리가 없고, 보내기 전엔 결과물이 아니다. 전달·답장 경로는 대상 아님(새 메일만) |
| project | `POST /api/projects` → `project_actions.createProject` | 끝에서 `fulfill(project)`. **업무를 그 프로젝트로 옮기지 않는다** — 옮기면 그 프로젝트 고객에게 업무가 보이는 가시성 확대라 별도 결정(기존 «프로젝트 이동» 기능이 이미 있고, 액션 완료 칩 옆에 [이 프로젝트로 옮기기] 를 2단계에 둘 수 있다) |

`fromActionId` 를 받는 쪽은 **멤버십·담당자 검사를 fulfill 에 맡기고 자기 검사를 더하지 않는다**(두 벌이 되면 갈라진다).

---

## 4. 화면

### 4.1 업무 상세 — «결과물 액션» 칸
자리: `TaskDetailDrawer.tsx` 의 **결과물 Section(:2582) 바로 위**, 댓글 Section 아래. 새 컴포넌트 `components/QTask/TaskActionItemsSection.tsx`(결과물을 위한 것이니 결과물 옆. 의뢰 명세 아래 `RelatedTasksSection` 과 모양·칩 규격을 같이 쓴다).

```
데스크탑(480px 패널)
┌ 결과물 액션  1/3                              [+ 액션 추가] ┐
│ ☐ 📄 견적서 초안                  [문서 만들기 ↗] [기존 것 연결] ⋯ │
│ ◐ 📄 제안서                       작성 중(임시저장) · 문서 열기 ↗  ⋯ │
│ ☑ 📅 킥오프 미팅                  10/15 14:00 · 일정 열기 ↗      ⋯ │
│                                                                   │
│  반복 업무: 새 회차마다 이 목록이 미완료 상태로 복사됩니다   (부모일 때만)│
└───────────────────────────────────────────────────────────────────┘
[+ 액션 추가] 를 누르면 같은 자리에 펼침(팝업 위 팝업 금지):
┌ 종류  (📄 문서)(📅 일정)                            ← 1단계 둘 · 2단계 (✉ 메일)(📁 프로젝트)
│ 무엇을 만들까요  [ 견적서 초안                        ]
│                                       [취소] [추가]  ← Ctrl/⌘+Enter, Enter 단독 저장 금지, IME 조합 중 무시
```

- 체크 모양은 상태: ☐ pending · ◐ active · ☑ completed · ⊘ skipped(회색). **체크를 손으로 눌러 완료하는 것은 없다** — 완료는 «만들어진 것» 으로만 된다(결과물에 뭐가 들어갔는지 모르는 완료를 만들지 않는다). «이번엔 안 함» 은 ⋯ 메뉴의 [건너뛰기].
- `[문서 만들기 ↗]` = **담당자에게만** 활성. 다른 사람에게는 비활성 + 이유(«담당자가 만듭니다»). 담당자가 없으면 «담당자를 정하면 만들 수 있어요».
- 이동은 **`tabStore.openInNewTab(path)`** — 업무를 보던 탭은 그대로 남는다(«하던 일 위에 얹히는 진입점은 새 탭»). 미러 모드(폰)는 같은 함수가 제자리 이동으로 떨어진다 — 그래서 대상 화면의 «돌아가기» 띠(§4.2)가 필요하다.
- 글자 수정은 ⋯ → [이름 바꾸기] → `AutoSaveField`(가드 `autosave`). 삭제는 `ConfirmDialog`.
- 대상 요약(문서 제목·일정 시각)은 서버가 보는 사람 기준으로 준 것만 그린다. `hidden:true` 면 «볼 수 없는 문서» 회색 칩, `deleted:true` 면 «지워진 문서».
- 실시간: 드로어가 이미 `task:updated` 에 상세를 다시 읽는다 — 이 칸도 그때 다시 읽는다(§16 (c)). 새 소켓 사건을 만들지 않는다.
- `data-testid`: `task-actions-add` · `task-action-row-<id>` · `task-action-go-<id>` · `task-action-link-existing-<id>`.

폰(≤640)
```
┌ 결과물 액션 1/3            [+ 액션 추가] ┐
│ ☐ 📄 견적서 초안                      ⋯ │
│   [문서 만들기 ↗          ] [기존 것 연결] │   ← 두 번째 줄, 버튼 40px
│ ☑ 📅 킥오프 미팅 · 10/15 14:00        ⋯ │
│   [일정 열기 ↗                         ] │
└──────────────────────────────────────────┘
```

### 4.2 대상 화면 — «이 업무에서 만들고 있어요» 띠 + 저장 뒤 «업무: 제목» 칩
**들어오는 주소는 네 화면이 같다: `?from_action=<id>`** (문서 `/docs?from_action=12` · 일정 `/calendar?new=1&from_action=12` · 메일 `/mail?compose=1&from_action=12` · 프로젝트 `/projects?new=1&from_action=12`). 화면은 `GET /api/task-actions/12/handoff` 를 읽고:
1. 새로 만들기 폼을 연다(문서 `startNew()` — `PostsPage.tsx:609` 의 `?prefill=` 효과와 같은 자리에 분기 · 일정 `setShowNewModal(true)`(지금은 주소 인자가 없다 — `MailPage` 의 `compose=1` 패턴으로 추가) · 메일 `compose=1`(이미 있음) · 프로젝트 `NewProjectModal`).
2. 기본값: 제목/이름 = `label`, 프로젝트 = `task.project_id`, 일정은 `linkedTask` 미리 선택(`NewEventModal` 에 `initialLinkedTask` prop 추가)·시작일 = `task.due_date`.
3. 주소에서 `from_action` 을 **즉시 지운다**(replace) — 새로고침·뒤로가기로 두 번 만들지 않게. `prefill` 이 그렇게 한다.
4. 폼 위에 띠(`role=status`, 접근성 비모달): **«업무 ‹견적 요청 정리› 의 결과물 액션 ‹견적서 초안› 을 만들고 있어요 — 저장하면 업무에 연결됩니다 · [업무 열기]»**. `can_perform:false` 면 «담당자만 연결할 수 있어요 — 만들어도 업무에 연결되지 않습니다» 로 바꾸고 `from_action_id` 를 보내지 않는다(서버 403 을 미리 말한다).
5. 저장 요청에 `from_action_id` 를 싣는다(문서는 첫 자동저장, 일정·프로젝트는 생성, 메일은 보내기).
6. 저장 뒤에는 띠가 사라지고 **상세 밴드2 왼쪽 메타**에 `업무: 견적 요청 정리` 칩(연결된 업무 수만큼, 3개 넘으면 «+n»). 누르면 `openInNewTab('/tasks?task=<id>')`. 칩 자리: 문서 `PostsPage` `MetaLeft` · 일정 `EventDrawer` 기존 «업무 연결» 칸(이미 있음, 변경 없음) · 메일 스레드 상세 밴드2 · 프로젝트 개요 머리줄.

### 4.3 ko/en 문구 (네임스페이스 · 키 · ko · en)
| ns·키 | ko | en |
|---|---|---|
| qtask `resultActions.title` | 결과물 액션 | Deliverable actions |
| qtask `resultActions.add` | 액션 추가 | Add action |
| qtask `resultActions.kind.doc` / `.event` / `.mail` / `.project` | 문서 / 일정 / 메일 / 프로젝트 | Document / Event / Mail / Project |
| qtask `resultActions.labelPlaceholder` | 무엇을 만들까요 (예: 견적서 초안) | What will you make? (e.g. Quote draft) |
| qtask `resultActions.go.doc` / `.event` / `.mail` / `.project` | 문서 만들기 / 일정 추가 / 메일 쓰기 / 프로젝트 만들기 | Create document / Add event / Write mail / Create project |
| qtask `resultActions.open.doc` … | 문서 열기 / 일정 열기 / 메일 열기 / 프로젝트 열기 | Open document / … |
| qtask `resultActions.linkExisting` | 기존 것 연결 | Link existing |
| qtask `resultActions.unlink` | 연결 해제 | Unlink |
| qtask `resultActions.skip` / `.unskip` | 건너뛰기 / 다시 할 일로 | Skip / Back to to-do |
| qtask `resultActions.status.active` | 작성 중(임시저장) | In progress (draft) |
| qtask `resultActions.assigneeOnly` | 담당자가 만듭니다 | Only the assignee makes this |
| qtask `resultActions.noAssignee` | 담당자를 정하면 만들 수 있어요 | Set an assignee to start |
| qtask `resultActions.hidden` / `.deleted` | 볼 수 없는 항목 / 지워진 항목 | Not visible to you / Deleted |
| qtask `resultActions.recurringHint` | 반복 업무: 새 회차마다 이 목록이 미완료 상태로 복사됩니다 | Recurring: each new occurrence gets this list, unchecked |
| qtask `resultActions.deleteConfirm` | «{{label}}» 액션을 삭제할까요? 연결된 결과물은 그대로 남습니다. | Delete “{{label}}”? Linked items stay. |
| common `fromTask.banner` | 업무 ‹{{task}}› 의 결과물 액션 ‹{{label}}› 을 만들고 있어요 — 저장하면 업무에 연결됩니다 | Making “{{label}}” for task “{{task}}” — it links to the task when saved |
| common `fromTask.cannotLink` | 담당자만 연결할 수 있어요 — 만들어도 업무에 연결되지 않습니다 | Only the assignee can link — this won’t attach to the task |
| common `fromTask.openTask` | 업무 열기 | Open task |
| common `fromTask.linkFailed` | 만들어졌지만 업무에 연결되지 않았습니다 — 업무에서 [기존 것 연결] 을 눌러 주세요 | Created, but not linked to the task — use “Link existing” on the task |
| common `linkedTasks.chip` | 업무: {{title}} | Task: {{title}} |
| common `linkedTasks.more` | +{{n}} | +{{n}} |

---

## 5. 반복업무 · 결과물 회차

Irene 의 «버전» 은 두 가지로 읽힌다. 둘 다 답한다.

| 뜻 | 저장소 사실 | 설계 |
|---|---|---|
| **회차**(이번 주 것, 다음 주 것) | 회차 = 별도 `tasks` 행(`recurrence_parent_id`). `recurringTaskGenerator.createOccurrence` 가 부모 필드·컨펌자·태그를 복사한다(`task_links` 는 의도적으로 안 복사) | 같은 자리에서 **부모의 액션 목록을 `kind·label·note·meta·order_index` 만 복사**, `status='pending'`, 연결·fulfilled 전부 비움. 복사 계약(«내용만 가져오고 이력은 두고 온다»)과 같다. 부모에서 액션을 고치면 **다음 회차부터** 반영(다른 필드와 같다). 회차에서 더한 액션은 그 회차에만. 1단계는 «이 회차만/앞으로 모두» 물음(`taskSeriesScope`)에 액션을 넣지 않는다 — 부모 화면에 안내 한 줄(§4.1)로 대신한다. 2단계에서 물음에 합류 |
| **결과물 버전**(같은 업무의 v1 → 수정요청 → v2) | 컨펌 요청 때 `task_deliverable_versions` 가 본문+`attachment_ids`(context='task')를 박제 | 액션 목록은 버전과 무관하게 하나다. 대신 **doc 액션이 만든 문서는 `task_attachments` 에 들어가므로 그 뒤의 모든 제출 회차에 저절로 포함**된다 — 따로 «결과물에 넣기» 를 누르지 않는다. 어느 회차에서 만들었는지는 `fulfilled_round` 에 남는다(표시는 2단계 `DeliverableHistory` 한 줄). 수정요청을 받아 새 문서가 필요하면 액션을 하나 더 더한다 |

---

## 6. 권한 · 격리 · 실시간 · 감사

**책임선과 맞춘다** — 액션 목록은 «무엇을 만들 것인가»(의뢰·수행 양쪽의 일), 액션을 **수행해 결과물에 넣는 것**은 담당자의 일(body 축).

| 행위 | 누가 | 근거 |
|---|---|---|
| 보기 | 멤버 이상 ∧ `canAccessTask`. **고객(client)에게는 목록을 내지 않는다** | 내부 작업 계획 — 태그·중요도와 같은 취급(`taskClientView` BLOCKED 와 같은 선). 고객은 결과물(첨부된 문서)만 기존 경로로 본다 |
| 추가·이름·순서·건너뛰기·삭제 | 작성자·담당자·owner·admin | `canEditTitle/Tags` 와 같은 집합(«이 업무가 무엇에 관한 것인가» 축). ★ Irene 결정 1 (§8) |
| 만들러 가기·기존 것 연결·해제 | **담당자만, 직급 예외 없음** | body 와 같은 선 — 액션 완료 = 결과물 첨부가 생긴다 |
| 완료된 액션 삭제 | 먼저 해제해야 함(409) | 결과물 첨부가 조용히 사라지지 않게 |

- **테넌트**: 액션은 `id+business_id`, 대상도 같은 `business_id` 만. 다른 워크스페이스 id 는 404(존재를 알리지 않는다).
- **붙일 때 원본 읽기 권한**: «기존 것 연결» 은 `canReadPost`/일정 접근/스레드 접근을 본 뒤 건다. **보여줄 때 보는 사람 기준**: §3.3.
- **실시간**: 액션 쓰기 전부 `broadcastTask(task,'task:updated')`(기존). 고객 방(`project:<id>:client`)에는 업무 행이 `taskClientView` 를 거쳐 가고 액션은 행에 없다 — 새지 않는다.
- **감사**: `task.action_added` · `task.action_fulfilled`(source: create|manual|publish) · `task.action_unlinked` · `task.action_skipped` · `task.action_removed`. 행동 계층 `task_actions.js` 의 `audit(actor, entry)` 헬퍼를 쓴다.
- **AI 에이전트(`services/agent/registry.js`)·Cue**: 1단계는 도구를 **더하지 않는다**(쓰기 표면·scope 확장은 그 자체가 Fable 대상). `fulfill` 이 행동 계층에 있으므로 뒤에 `create_document` 등에 `task_action_id` 인자를 더하면 같은 함수로 끝난다 — 설계서 `AI_AGENT_INTEGRATION_DESIGN.md` 쪽 결정으로 넘긴다.
- **배지**: «확인 필요»·메뉴 배지에 넣지 않는다(배지 합 계약이 흔들린다). 업무 목록 행 표시도 1단계 없음.

---

## 7. 단계 · 파일 · 검증

### 1단계 — 표 + 업무 상세 칸 + 문서·일정 (Irene 승인 뒤)
백엔드
- `models/TaskActionItem.js`(신규) · `models/index.js`(association: Task.hasMany `actionItems`, TaskActionItem.belongsTo Task/User)
- `services/taskActionItems.js`(신규 — fulfill·unlink·onPostPublished·onAttachmentDeleted·linkedTasksOf·KINDS 표)
- `services/taskAttachmentLink.js` — `linkPostsToTask` 추가(라우트 `task_attachments.js:290~` 블록을 옮김, 동작 무변경)
- `routes/task_action_items.js`(신규) + `server.js` 마운트(tasks.js 앞) · `routes/task_attachments.js` DELETE 에 `onAttachmentDeleted` 1줄
- `services/actions/post_actions.js createPost`(fromActionId) · `routes/posts.js` 발행 경로(onPostPublished) · `GET /api/posts/:id` 에 `linked_tasks`
- `routes/calendar.js` POST(fulfill) · `services/actions/event_actions.js createEvent`(fulfill)
- `services/recurringTaskGenerator.js createOccurrence` — 액션 내용 복사
- `scripts/migrate-task-action-items.js`(신규, 배포 슬롯)

프론트
- `components/QTask/TaskActionItemsSection.tsx`(신규) · `TaskDetailDrawer.tsx` 한 줄(결과물 Section 위)
- `components/Common/FromTaskBanner.tsx`(신규, 네 화면 공용) · `hooks/useFromActionHandoff.ts`(주소 읽기·handoff 조회·주소 지우기 — 네 화면이 베끼지 않게 한 벌)
- `components/Docs/PostsPage.tsx`(`?from_action` 분기 · 첫 저장에 `from_action_id` · 밴드2 `linked_tasks` 칩)
- `pages/QCalendar/QCalendarPage.tsx`(`?new=1&from_action`) · `NewEventModal.tsx`(`initialLinkedTask`·`initialTitle` 재사용·`fromActionId`)
- `public/locales/{ko,en}/qtask.json`·`common.json`

검증(1단계)
- 가드: `node scripts/guard-invariants.js`(duproute·i18n·parity·autosave·wsscope 전체 실행) · `node scripts/health-check.js` · `npm run build` EXIT 0 · `--suite tenant`
- 실호출(:3003): 로그인 → `POST /tasks/:id/actions`(doc) → `POST /api/posts {from_action_id, status:'draft'}` → `GET actions` = active + `linked_entity_id` 일치 → 발행 PUT → completed, `task_attachments` 에 post_id 행 1, `linked_attachment_id` 일치 → 컨펌 요청 → `task_deliverable_versions.attachment_ids` 에 그 첨부 포함 → 해제 → 첨부 행 삭제·pending
- 거절: 비담당자 `/link` 403 · 남의 워크스페이스 action id 404 · 종류 불일치(doc 액션에 calendar_event) 400 · 같은 대상 두 번 → 멱등 · `can_perform:false` 인 사람의 `from_action_id` 는 문서는 생기고 `warnings` 만
- 가시성: L1(나만 보기) 문서로 완료한 액션을 **다른 멤버**가 보면 `hidden:true`, 문서 상세의 업무 칩은 고객이 그 업무를 못 보면 0건 · 고객 토큰으로 `GET actions` 403
- 반복: 부모에 액션 2 → `createOccurrence` 강제 실행 → 회차에 pending 2·링크 0 · 회차에서 완료해도 부모·다른 회차 변화 0
- 화면 `--suite taskactions`(신규 카나리 `scripts/e2e/canary-task-actions.js`): 폰 390 · 태블릿 · 데스크탑 — [문서 만들기] 가 **새 탭**으로 열리고 원 탭 업무가 남는가(데스크탑) / 띠 문구에 업무·액션 이름 / 발행 뒤 업무 칸이 리로드 없이 ☑ 로(소켓) / 문서 밴드2 칩 좌표·가시성(`elementFromPoint`) / **양성 대조군**: fulfill 호출을 뺀 빌드에서 ☑ 판정이 뒤집히는가, 비담당자 계정은 버튼 비활성.
- 확인할 곳(보고용): `https://dev.planq.kr/tasks?task=<id>` [as=member2 ws=6](담당자) · 같은 주소 [as=owner ws=6](비담당자 — 버튼 비활성) · `https://dev.planq.kr/docs?post=<id>` 업무 칩

### 2단계 — 메일·프로젝트 + 연결 모아보기
- `TASK_ACTION_KINDS` 에 mail·project `enabled` · `routes/email_threads.js` compose(fulfill) · 메일 스레드 상세 `linked_tasks` 칩 · `MailPage` `compose=1&from_action` · `project_actions.createProject`(fulfill) · `NewProjectModal` 이름 기본값 · 프로젝트 개요 «이 프로젝트를 만든 업무» 칩 · 액션 완료 칩 옆 [이 프로젝트로 업무 옮기기](기존 이동 기능 재사용)
- 업무 상세 액션 칸 아래 «연결된 일정 n»(액션 없이 `task_id` 로 걸린 일정도 보이게 — 지금 업무 쪽에서 일정을 볼 자리가 없다)
- `DeliverableHistory` 회차 줄에 «이 회차에서 만든 것: 문서 1·일정 1»(`fulfilled_round`)
- 반복 «이 회차만/앞으로 모두» 물음에 액션 포함 · 액션 끌어 순서 바꾸기
- 검증: 메일 보내기 → 스레드 id 로 completed · 받는 주소 확인창(외부 발송 규칙 그대로 — compose 가 이미 한다) · 프로젝트 생성 뒤 업무 `project_id` **불변** 확인(음성 대조군)

### 3단계(후보, 별도 결정) — 업무(하위 업무)·Q note 메모·청구서 종류 · 업무 템플릿(`TaskTemplateItem`)에 액션 목록 · AI 에이전트 도구 인자 · Cue 가 액션을 제안

---

## 8. Irene 가 정할 것 (3개 — 각각 권고 붙임)

**1. 액션을 적어 두는 사람 — 작성자(의뢰자)도 가능하게 할까요, 담당자만 할까요?**
   - A안(권고): 작성자·담당자·owner·admin 모두 적을 수 있고, **만들러 가기·연결은 담당자만**. 의뢰자가 «문서로 내 주세요, 킥오프 일정 잡아 주세요» 를 미리 걸어 두면 그것이 곧 안내가 된다. 책임선(결과물=담당자)은 «수행» 쪽에서 지킨다.
   - B안: 담당자만 적고 담당자만 수행. 의뢰자는 설명에 글로 쓴다. 단순하지만 «넣어두고 안내» 의 절반(의뢰자가 안내)이 빠진다.
   - **권고: A.** 되돌리기는 어렵지 않다(권한 집합 한 줄).

**2. 액션으로 만든 문서를 결과물 첨부에 자동으로 넣을까요?**
   - A안(권고): 넣는다 — 그 문서가 곧 결과물의 일부이고, 컨펌 제출 회차에 저절로 포함된다(«결과물에 넣기 위해» 가 Irene 원문). 해제하면 액션이 만든 첨부만 빠진다.
   - B안: 연결만 하고 첨부는 사람이 따로 붙인다. 한 번 더 눌러야 하고, 잊으면 제출본에 문서가 없다.
   - **권고: A.** 단 일정·메일·프로젝트는 첨부가 아니라 연결(칩)로만 — 결과물이 아니라 과정이다.

**3. 1단계 범위 — 문서·일정 둘만 먼저 낼까요, 메일·프로젝트까지 한 번에 낼까요?**
   - A안(권고): 문서·일정 먼저(연결 문이 이미 있어 저장소 변경이 작고, 네 화면 공통 부품 — handoff·띠·칩·fulfill — 을 실사용으로 한 번 검증한 뒤 메일·프로젝트에 같은 부품을 붙인다). 표·ENUM 은 넷을 처음부터 두므로 2단계에 스키마 변경이 없다.
   - B안: 넷 다 한 번에. 메일은 «보내기 = 완료» 라 외부 발송 경로를 같이 검증해야 하고, 프로젝트는 «업무를 옮길까» 가 붙어 범위가 커진다.
   - **권고: A.** 2단계는 1단계 뒤 바로 이어서(별도 승인 없이 이 문서대로).

---

## 9. 이 설계가 지키는 저장소 규칙 (대조표)
- 새로 만들지 않는다 — 연결은 기존 `task_attachments`·`calendar_events.task_id`, 모양은 `project_stages`, 칩은 `RelatedTasksSection`, 첨부 함수는 `taskAttachmentLink`, 띠·handoff 훅은 네 화면 공용 한 벌.
- 공유·참조 다섯 규칙 ⑤ — 붙일 때 원본 읽기(`canReadPost` 등), 보여줄 때 보는 사람(`linkedTasksOf`·`canAccessTask`), 제목 복사 없음.
- 복사 계약 — 회차에 내용만, 연결·완료는 두고 온다.
- 책임선 — 적기는 title 축, 수행은 body 축(담당자, 직급 예외 없음).
- 행동 계층 — `fulfill` 이 한 곳, 화면·에이전트·Cue 가 같은 함수.
- 라우트 — 새 파일·마운트 순서 명시, 같은 파일 중복 선언 없음.
- 실시간 §16 — 기존 `task:updated` 재사용, 고객 방 누수 없음. 하던 일 위 진입점은 새 탭.
- 상세 두 밴드 — 칩은 밴드2 왼쪽 메타에, 셋째 밴드 없음. 폰에서 버튼은 둘째 줄 40px.
- 자동저장 — 이름 바꾸기 `AutoSaveField`, 추가는 버튼+Ctrl/⌘+Enter(중복 제출 가드).
- Fable 사용 — 이 설계 1회. 구현 완료 검증은 **권한·격리(담당자 403·테넌트 404·L1 hidden)** 가 걸려 있어 `gate` 1회. 화면 간격·문구는 자체 검증.
