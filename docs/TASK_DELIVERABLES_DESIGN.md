# 업무 «산출물» 고르기 설계 — 업무를 만들거나 요청할 때 «무엇을 만들어야 하는가» 를 칩으로 고른다

설계: [Fable] 2026-11-19 · 상태: **DESIGN-READY — Irene «권고대로»(A안) 승인됨. 구현은 Opus 가 이 문서대로.**
기준 HEAD: `6b5d9787`. 구현 전에 `git log 6b5d9787..HEAD -- dev-backend/routes/task_tags.js dev-backend/services/actions/task_actions.js dev-frontend/src/components/QTask` 로 바뀐 것부터 확인한다.

> Irene 원문(2026-11-19): *«업무설명에 필요한 산출물 선택하게 하는 거 어때? 기본 산출물들 자동 검색되게 미리 넣어두고 없는 건 입력되게 해서 저장되게. 업무를 진행하거나 요청을하거나 할 때 산출물이 중요하지 않나 해서.»*
> 승인된 권고안 A: 업무 설명 아래 «산출물» 칩 여러 개 · 기본 목록(ko/en) 자동 검색 · 없는 건 입력하면 워크스페이스 목록에 저장 · 업무 만들기·요청하기·상세·템플릿·AI 연결(create_task) · 결과물 칸 위에 «만들 산출물» · 태그와 같은 틀.

---

## 0. 한 줄 결론

**태그와 같은 «사전 + 연결» 두 표를 새로 둔다. 기본 목록은 코드(서버 한 곳)에 두고, 처음 고르는 순간에만 그 워크스페이스 사전에 행으로 들어간다(`preset_key` 로 기억 — 보는 사람 언어로 보인다). 고객에게는 그 업무의 산출물이 읽기 전용으로 보이고, 사전·편집은 멤버만. AI 는 기본 목록과 이미 있는 이름만 붙인다(새 이름을 만들지 않는다).**

| 정한 것 | 결정 |
|---|---|
| 구조 | 사전 `task_output_kinds` + 연결 `task_output_kind_links` (JSON 칸 아님) |
| 기본 목록 | 서버 코드 한 곳(22개, ko/en). 운영 DB 에 미리 넣지 않는다 — 고를 때 행이 생긴다 |
| 부가 칸(수량·메모·색·순서) | **없음** (Irene 요구 밖) |
| 상한 | 업무당 10 · 워크스페이스 직접 입력 100 · 이름 40자 |
| 고객(Client) | **그 업무의 산출물은 읽기 전용으로 보인다.** 사전 목록·편집은 못 한다 |
| 게스트·공개 공유 링크 | **싣지 않는다**(무인증 표면을 넓히지 않는다) |
| 수정 권한 | 태그와 같은 축 — 작성자·담당자·owner·admin (고객 제외) |
| 따라가는 곳 | 요청하기 · 반복 회차 · 템플릿 저장/적용 · 복사 · AI `create_task`/`update_task`/`get_task` |
| 이번에 안 하는 것 | 목록 칩·필터·검색 · 결과물 액션 자동 생성 · 순서 지정 · 공개 링크 표시 · AI 업무추가(후보 카드) 연결 |

---

## 1. 낱말 — 기존 «결과물» 과 섞이지 않게

이 저장소에는 비슷한 말이 이미 셋 있다. **넷째를 같은 이름으로 만들지 않는다.**

| 화면 글자 | 실체 | 뜻 |
|---|---|---|
| 결과물 (en `Deliverable`) | `tasks.body` + `task_deliverable_versions` | 담당자가 **만든 내용** |
| 결과물 액션 (en `Deliverable actions`) | `task_action_items` | 만들러 가는 **실행 버튼**(문서·일정) — 내부 작업 계획, 고객 숨김 |
| 프로젝트 캔버스 «산출물» | `routes/projects.js` 가 문서·글을 모은 자동 목록 | 프로젝트에 **이미 있는 것** |
| **(신규) 산출물 / 만들 산출물** (en `Expected outputs` / `To produce`) | `task_output_kinds` | 이 업무가 **만들어야 하는 것의 종류** |

- **코드 이름은 `output_kind`** 로 통일한다 — 표·모델·API 칸·파일 이름에 `deliverable` 을 쓰지 않는다(`task_deliverable_versions`·프로젝트 `deliverables` 와 grep 이 섞인다). 이 문서 파일명만 요청대로 `TASK_DELIVERABLES_DESIGN.md`.
- 영어 화면 글자에 `Deliverable` 을 쓰지 않는다(결과물 칸이 이미 그 낱말이다).
- **결과물 액션과의 관계**: 산출물 = «무엇을»(요청하는 사람이 고르는 종류, 고객도 봄) · 결과물 액션 = «어떻게»(담당자가 문서·일정을 만들러 가는 길, 내부). 이번에는 **둘을 연결하지 않는다**(산출물을 고른다고 액션이 생기지 않는다) — 후속 후보로만 적는다(§8).
- `tasks.category` 는 동결 그대로 — 건드리지 않고 화면에 내지 않는다.

---

## 2. 데이터 구조

### 2.1 왜 사전 + 연결 표인가 (JSON 칸을 버린 이유)
`models/TaskTag.js` 머리말의 판정이 그대로 적용된다 — 자유 문자열 JSON 이면 오타로 갈라지고, 이름을 바꿔도 옛 업무에 옛 이름이 남고, «없는 건 입력하면 저장» 의 저장처(워크스페이스 목록)가 없다. 뒤에 목록 필터를 붙일 때도 M:N 표여야 한다.

### 2.2 기본 목록을 어디에 두나 — **코드에 두고, 고를 때 행으로**

| 안 | 판정 |
|---|---|
| ① 워크스페이스마다 22개를 미리 넣는다(마이그레이션 백필 + 새 워크스페이스 생성 훅) | ✗ 운영 DB 대량 쓰기(되돌리기 어려움) · 한 언어로 굳는다(영어 사용자에게 한글 목록) · 안 쓰는 항목이 사전을 채운다 |
| ② 코드 키만 쓰고 직접 입력만 표에 둔다(연결 표가 «키 또는 id» 두 갈래) | ✗ 연결·템플릿·AI·복사가 전부 두 갈래 분기를 갖게 된다 |
| **③ 기본 목록은 코드, 처음 고를 때 사전에 행 생성 + `preset_key` 기억** | ✓ 채택 — 연결은 언제나 사전 id 하나, 배포 때 데이터 쓰기 0, 언어는 보는 사람 기준 |

- **기본 목록 정본 = `dev-backend/services/taskOutputKindPresets.js` 한 곳** — `[{ key, ko, en }]` (§7). 프론트 locale JSON 에 사본을 두지 않는다. 화면은 API 가 준 `labels` 를 보는 사람 언어로 고른다(§3.4).
- 사전 행의 `preset_key` 가 있으면 **기본 항목**, NULL 이면 **직접 입력 항목**.
- **보이는 이름**: 기본 항목 = `labels[보는 사람 언어]`(없으면 `name`) · 직접 입력 = `name`(넣은 그대로, 번역 없음).
- 기본 항목 행의 `name` 에는 워크스페이스 `businesses.default_language`(`ko`|`en`, 그 밖이면 `ko`) 라벨을 넣는다 — 서버가 글자로 써야 하는 곳(AI 응답·감사 기록·템플릿 저장)의 값이다.

### 2.3 이름 충돌 규칙 (한 함수 `resolveName` 이 판정 — §3.1)
입력 이름은 `NFC → trim → 연속 공백 1칸` 으로 정리하고, 비교는 대소문자 무시.
1. **기본 목록의 ko 또는 en 라벨과 같으면 → 그 기본 항목이다.** 직접 입력 행을 만들지 않는다(«제안서» 를 친 사람과 «Proposal» 을 친 사람이 같은 행을 쓴다).
2. 아니고 이 워크스페이스 사전에 같은 `name` 이 있으면 → 그 행.
3. 둘 다 아니면 → 새 직접 입력 행(만들 수 있는 길에서만 — §3.3, §5).
4. 이름 바꾸기도 같은 판정 — 기본 라벨과 같은 이름으로는 못 바꾼다(409 `matches_preset`), 사전 중복도 409.
5. **뒤에 기본 목록에 항목을 더했는데 어떤 워크스페이스에 같은 이름의 직접 입력 행이 이미 있으면** — 그 기본 항목을 처음 고르는 순간 새 행을 넣지 않고 **그 행에 `preset_key` 를 채운다**(입양). UNIQUE(business_id, name) 충돌도 없고 연결도 그대로다.
6. 기본 목록에서 항목을 **빼거나 key 를 바꾸지 않는다**(라벨 글자만 고칠 수 있다). 코드에서 사라진 `preset_key` 행은 `name` 으로 보이는 직접 입력처럼 동작한다(깨지지 않게 — `labels` 없음).

### 2.4 표

**`task_output_kinds`** — 워크스페이스 산출물 사전 (모델 `models/TaskOutputKind.js`)

| 칸 | 형 | 뜻 |
|---|---|---|
| `id` | INT PK AI | |
| `business_id` | INT NOT NULL · FK businesses | 테넌트 축 — 모든 조회 WHERE 에 건다 |
| `name` | VARCHAR(40) NOT NULL | 직접 입력 = 넣은 이름 · 기본 항목 = 워크스페이스 기본 언어 라벨 |
| `preset_key` | VARCHAR(40) NULL | 기본 목록 key. NULL = 직접 입력 |
| `created_by` | INT NOT NULL · FK users | |
| `created_at`/`updated_at` | DATETIME | `timestamps:true, underscored:true` |

인덱스(모델에 **name 명시**, DDL 과 글자까지 같게 — `TaskTag.js` F3 교훈):
- `task_output_kinds_biz_name_unique` UNIQUE(`business_id`,`name`)
- `task_output_kinds_biz_preset_unique` UNIQUE(`business_id`,`preset_key`) — MySQL 은 NULL 여러 개를 허용하므로 직접 입력 행끼리 충돌하지 않는다

**`task_output_kind_links`** — task ↔ 산출물 M:N (모델 `models/TaskOutputKindLink.js`)

| 칸 | 형 | |
|---|---|---|
| `id` | INT PK AI | |
| `task_id` | INT NOT NULL · FK tasks **ON DELETE CASCADE** | |
| `output_kind_id` | INT NOT NULL · FK task_output_kinds **ON DELETE CASCADE** | |
| `created_at`/`updated_at` | DATETIME | |

인덱스: `task_output_kind_links_unique` UNIQUE(`task_id`,`output_kind_id`) · `task_output_kind_links_kind` (`output_kind_id`).
FK 는 무명(MySQL 자동 이름), `onDelete:'CASCADE'` 를 모델 attribute 에도 적는다 — `migrate-task-tags.js` 머리말과 같은 이유.
연결 모델 관계: `TaskOutputKindLink.belongsTo(TaskOutputKind, { as: 'kind', foreignKey: 'output_kind_id' })`. **조회에 belongsToMany include 를 쓰지 않는다**(§3.1 `attachOutputKindsTo` 배치 머지).

색·순서(`sort_order`)·수량·메모 칸은 **두지 않는다.** 순서는 계산으로 정한다 — 기본 항목(코드 목록 순) → 직접 입력(이름순).

### 2.5 상한
- 업무당 **10** (`too_many_output_kinds`)
- 워크스페이스 직접 입력(`preset_key IS NULL`) **100** — 기본 항목 행은 세지 않는다(코드 목록 수로 이미 묶여 있다)
- 이름 **40자**

### 2.6 마이그레이션
`dev-backend/scripts/migrate-task-output-kinds.js` — `migrate-task-tags.js` 를 본으로 `CREATE TABLE IF NOT EXISTS` 두 개 + 끝에 실제 스키마(표·인덱스 이름) 다시 읽어 판정. **데이터 쓰기 0.** 배포 스크립트의 마이그레이션 자리(`scripts/deploy-planq.sh` — `migrate-task-tags.js` 가 등록된 곳)에 한 줄 등록. 순서 DB → 백엔드 → 프론트. 롤백 = 코드만 되돌림(표는 남아도 무해), 완전 제거는 links → kinds 순 DROP.
`.claude/rules/db-schema.md` 표 목록에 두 표를 한 줄씩 더한다.

---

## 3. 서버

### 3.1 서비스 한 곳 — `dev-backend/services/taskOutputKinds.js` (신규)
`routes/tasks.js`(2,999줄)·`task_actions.js`(2,457줄)는 god-file 이라 본체를 여기 두고 그쪽에는 **호출 한 줄씩**만 넣는다.

| 함수 | 하는 일 |
|---|---|
| `presets()` | 기본 목록 `[{ key, labels:{ko,en} }]` (정본 `taskOutputKindPresets.js`) |
| `normalizeName(raw)` | NFC·trim·연속 공백 1칸 |
| `resolveName(businessId, name)` | §2.3 판정 → `{ kind:'preset', key }` \| `{ kind:'row', row }` \| `{ kind:'new', name }` (쓰지 않는다) |
| `ensurePresetRow(businessId, key, userId, tx?)` | 기본 항목 행 find-or-create(+§2.3-5 입양). UNIQUE 위반(동시 생성)은 잡아서 다시 읽는다 |
| `createCustom(businessId, name, userId)` | 직접 입력 행 생성 — 상한 100·길이·§2.3 판정. 이미 있으면 그 행 반환(멱등) |
| `resolveNamesToIds(businessId, names, { userId, allowCreate })` | 이름 배열 → id 배열. 기본 라벨이면 `ensurePresetRow`, 있는 이름이면 그 id, 없으면 `allowCreate` 일 때만 `createCustom`. 못 푼 이름은 `unknown` 으로 돌려준다(던지지 않는다 — 부르는 쪽이 정한다) |
| `attachOutputKindsTo(rows, businessId)` | `task_id IN (...)` 배치 1회 → `row.output_kinds = [{ id, name, preset_key, labels? }]`, 순서 = 기본(코드 순) → 직접(이름순). 사전 쪽에도 `business_id` 조건(이중 방어). **다른 곳에서 실을 때도 이 함수만**(사본 금지) |
| `copyLinks(fromTaskId, toTaskId, tx?)` | 연결 그대로 복사(`ignoreDuplicates`) — 반복 회차·복사가 같이 쓴다 |
| `linkOnCreate(task, ids, businessId, tx)` | 생성 트랜잭션 안에서 검증(이 워크스페이스 id 만 · 10개 이하) + bulkCreate. 어긋나면 `actionCode` 달아 throw(태그 생성 블록과 같은 방식) |

### 3.2 행동 계층 — `dev-backend/services/actions/task_output_actions.js` (신규)
`setOutputKinds(task, actor, { kindIds = [], seriesScope })` — **`task_actions.setTags` 와 같은 뼈대**(그 함수의 공용 조각 `resolveSubject`·`fieldContext`·`done`·`fail`·방송 헬퍼를 가져다 쓴다. 복사하지 않는다 — export 가 없으면 export 를 더한다).

1. `assertMemberOrAbove` 아니면 403 `forbidden` (고객·게스트 차단)
2. `ctx.isCreator || ctx.isAssignee || ctx.isOwnerOrAdmin` 아니면 403 `forbidden_field_output_kinds`
3. id 정리(양의 정수·중복 제거) → 10개 초과 `too_many_output_kinds` → 이 워크스페이스 사전에 전부 있나, 아니면 `unknown_output_kinds`(400)
4. 전후가 같으면 쓰지 않고 `changed:false`(감사·방송 없음 — 멱등 no-op 에 소켓을 울리지 않는다)
5. 반복: `taskSeriesScope.seriesTargetIds(task, seriesScope)` — 대상 회차마다 **이번에 뺀 것만 빼고 넣은 것만 넣는다**(setTags 와 같은 델타)
6. 감사 `task.output_kinds_update`(old/new `output_kind_ids`·`series_scope`·`applied_to`, 에이전트면 `via`)
7. 방송 `task:updated` — payload 에 `output_kinds` 를 실어 `taskRoom.emitTask` 로(고객 방은 `serializeTaskForClient` 를 거친다 — 산출물은 차단 칸이 아니므로 그대로 간다)

**생성**: `task_actions.createTask` 의 태그 블록(≈960행) 바로 옆에 `if (Array.isArray(params.outputKindIds) && params.outputKindIds.length) await linkOnCreate(task, params.outputKindIds, businessId, t);` **한 줄**. 그리고 **만든 사람이 고객(`isClient`)인데 `outputKindIds` 가 오면 403 `forbidden_field_output_kinds`** 로 업무 생성 전에 거절(조용히 버리지 않는다).

### 3.3 라우트 — `dev-backend/routes/task_output_kinds.js` (신규)
mount: `server.js` 의 `app.use('/api/tasks', require('./routes/task_tags'))` **바로 다음 줄**(tasks.js 의 `/:id` 보다 앞). 파일 안 순서: 리터럴 경로(`/output-kinds/presets`) → `/output-kinds/:kindId` → `/:id/output-kinds`.
모든 라우트 `authenticateToken` + `requireMember`(= `task_tags.js` 의 같은 함수 모양: `requestScope` 낡은 창 판정 + `assertMemberOrAbove`). **고객은 전부 403.**

| 메서드·경로 | 본문 → 응답 | 비고 |
|---|---|---|
| `GET /api/tasks/output-kinds?business_id=` | 이 워크스페이스 사전 행 `[{ id, name, preset_key, labels?, usage_count }]` | `parsePagination`(default 200 / max 500) + `paginatedResponse`. 사용 수는 집계 1회(N+1 금지) |
| `GET /api/tasks/output-kinds/presets?business_id=` | `[{ key, labels:{ko,en} }]` 전체 | 코드 목록 그대로(고정 길이) |
| `POST /api/tasks/output-kinds` | `{ business_id, preset_key }` 또는 `{ business_id, name }` → 행 | **find-or-create**: 이미 있으면 200 으로 그 행, 새로 만들면 201. `name` 이 기본 라벨이면 그 기본 항목 행. 상한 400 · 빈 이름/40자 초과 400 · 모르는 `preset_key` 400 |
| `PUT /api/tasks/output-kinds/:kindId` | `{ name }` | **직접 입력 행만**(기본 항목은 400 `preset_not_renamable`). 409 중복 · 409 `matches_preset` |
| `DELETE /api/tasks/output-kinds/:kindId` | → `{ id, deleted:true, removed_links }` | **직접 입력 행만**(기본 항목 400 `preset_not_deletable`). 연결은 CASCADE — 화면이 사용 수를 먼저 보여 준다 |
| `PUT /api/tasks/:id/output-kinds` | `{ output_kind_ids:number[], series_scope? }` → `{ id, output_kinds }` | 위임만 — `setOutputKinds`. 업무는 `findByPk` 후 행동 계층이 `task.business_id` 로 판정(태그 라우트와 같은 모양) |

- 사전이 **바뀔 때만**(생성·이름 변경·삭제) 감사(`task_output_kind.create|update|delete`) + 소켓 `task_output_kind:updated`(`business:<id>` 방, payload `{ business_id, actor_user_id }` 만). find 로 끝난 POST 는 울리지 않는다.
- `PUT /:kindId`·`DELETE` 는 행을 `findByPk` 한 뒤 **그 행의 `business_id`** 로 `assertMemberOrAbove`(남의 워크스페이스 id 는 403).

### 3.4 읽기에 싣는 곳 — **상세 하나만**
- `GET /api/tasks/:id/detail` — 태그 `attachTagsTo` 바로 옆에 `attachOutputKindsTo([json], task.business_id)` 한 줄. **고객에게도 싣는다**(§4). `serializeTaskForClient` 의 `BLOCKED_FIELDS` 에 **넣지 않는다.**
  - ★ 드로어는 이 값으로 시작해 «전체 목록 교체» PUT 을 보낸다 — 여기서 빠뜨리면 하나 추가하는 순간 기존 것이 지워진다(태그 F1 과 같은 데이터 손실). §10 검사 ⑥.
- **목록 라우트(all-tasks 등)·검색·주간 보고·공개 공유(`/public/by-token`)·게스트에는 싣지 않는다.**
- 응답 항목 모양은 한 가지: `{ id, name, preset_key, labels? }` — `labels` 는 기본 항목에만. `usage_count` 는 사전 GET 에만(업무 응답에 싣지 않는다).

### 3.5 권한 표 (구현·검증이 같이 보는 한 장)

| 행위 | owner·admin | 멤버(작성자/담당자) | 멤버(무관) | 고객 | 게스트·무인증 |
|---|---|---|---|---|---|
| 업무의 산출물 **보기**(상세) | ✓ | ✓ | ✓(그 업무를 볼 수 있으면) | ✓(그 업무를 볼 수 있으면, 읽기 전용) | ✗ |
| 업무의 산출물 **바꾸기** | ✓ | ✓ | ✗ 403 | ✗ 403 | ✗ |
| 사전·기본 목록 **읽기** | ✓ | ✓ | ✓ | ✗ 403 | ✗ |
| 사전 항목 만들기·이름 바꾸기·삭제 | ✓ | ✓ | ✓ | ✗ 403 | ✗ |

사전 관리가 «멤버 누구나» 인 것은 태그 사전과 같은 선이다(새로 정하지 않는다). 상태(완료·취소·검토 중)로 잠그지 않는다 — 태그와 같다.

---

## 4. 누가 보나 — 고객에게 보이고, 공개 링크에는 안 싣는다

**고객(Client, 로그인)**: 그 업무의 산출물이 **보인다(읽기 전용).** 태그는 내부 운영 라벨(«재작업»·«수금지연»)이라 숨기지만, 산출물은 «이 업무로 무엇을 받는가» 라 **요청 명세(업무 설명)와 같은 성격**이다 — 설명·결과물을 이미 보는 사람에게 그 사이의 «무엇을» 만 가리면 Irene 이 말한 «요청할 때 산출물이 중요» 가 고객 쪽에서 성립하지 않는다.
- 고객이 보는 것은 **볼 수 있는 업무의 것만**(상세 응답). 워크스페이스 사전(다른 고객 일에 쓴 이름이 섞여 있다)과 기본 목록 API 는 403.
- 그래서 **고객은 이번에 고르지 못한다**(고객이 만든 요청에는 담당자·owner 가 붙인다). 고객 고르기는 «기본 목록만 열어 줄지» 를 따로 정해야 하는 일이라 범위 밖(§8).
- 멤버가 알아야 할 것: 직접 입력한 이름은 **그 업무를 보는 고객에게 보인다.** 고르는 칸 아래 한 줄로 말한다(§6.2 `outputs.clientHint`) — 내부 메모를 이름으로 쓰지 않게.

**게스트·공개 공유 링크(무인증)**: **싣지 않는다.** `routes/tasks.js` `/public/by-token` 의 화이트리스트와 `services/taskPublicShare.js` 를 건드리지 않는다. 무인증 표면 확장은 PlanQ «되돌리기 어려운 것» 이고 Irene 요구에 없다.

**멤버**: 그 업무를 볼 수 있는 멤버 전원(공개 범위·보안등급은 업무 접근 판정이 이미 가른다).

---

## 5. 따라가는 곳

| 길 | 따라가나 | 어떻게 |
|---|---|---|
| 업무 만들기 폼 — «업무»·«요청하기» 두 모드 | ✓ | `POST /api/tasks` 본문 `output_kind_ids` → `createTask` `params.outputKindIds`(생성 트랜잭션 안). **만든 뒤 PUT 을 따로 치지 않는다**(태그식 2단 호출의 «업무는 생겼는데 칩만 빠짐» 을 만들지 않는다) |
| 팝아웃 빠른 추가(`usePopoutQuickAdd`) | ✗ | 제목 한 줄 입력 — 칸 없음 |
| 반복 회차 생성 | ✓ | `recurringTaskGenerator` 태그 복사 블록 옆 `copyLinks(parent.id, inst.id)` (try/catch + warn, 태그와 같은 모양) |
| 반복 업무에서 바꾸기 | ✓ | `series_scope` — 태그와 같은 `SeriesScopeDialog`·같은 델타 규칙 |
| 복사 `POST /api/tasks/:id/copy` | ✓ | `Task.create` 뒤 `copyLinks(src.id, copy.id)` + 응답·방송 payload 에 `output_kinds`. 복사 계약 «분류·종류는 따라간다» |
| 템플릿 저장 | ✓ | `templateDetails.collectTaskExtras` 가 `output_names`(사전 `name` 배열) 수집 · `normalizeItemDetails` 에 `output_names`(문자열 40자·최대 10·중복 제거, `normalizeTagNames` 와 같은 모양) |
| 템플릿 적용(`/apply`·`ai-create/confirm`) | ✓ | `materializeItemExtras` 가 `resolveNamesToIds(…, { allowCreate: true })` → 연결. 결과 카운트에 `outputs` 추가. 직접 입력 상한에 걸린 이름은 건너뛰고 카운트로만 말한다(업무 생성은 막지 않는다) |
| 템플릿 편집 화면 | 표시만 | `TemplateEditItems` 의 태그 칩 줄에 산출물 칩을 읽기 전용으로 같이 보인다(`templateItem.ts` 에 `output_names?`). 템플릿 안에서 고르는 칸은 만들지 않는다 |
| AI `create_task` | ✓ | `output_names: string[]`(최대 10, 각 40자) — §5.1 |
| AI `update_task` | ✓ | `output_names` = **전체 새 목록**(태그와 같은 교체 의미) → `setOutputKinds` |
| AI `get_task` | ✓ | `outputs: string[]`(사전 `name`) — 고칠 때 지금 값을 알아야 한다 |
| 앱 안 Cue | ✓(같은 도구) | `create_task`/`update_task` 가 같은 registry 도구라 따로 만들지 않는다. Cue 허용목록을 새로 넓히지 않는다 |
| AI 업무추가 후보 카드·템플릿 AI 추천 | ✗ | 범위 밖(§8) |
| 목록 칩·필터·통합 검색·주간 보고·Q info 로 보내기 | ✗ | 범위 밖 |
| 공개 공유·게스트 | ✗ | §4 |

> 조사 중 확인한 사실(고치지 않는다 — 보고만): 지금 `POST /:id/copy` 는 **태그를 복사하지 않는다.** 산출물은 위 표대로 복사하지만 태그 동작은 이번에 바꾸지 않는다(«설계에 없는 것 임의 추가 금지»). Irene 에게 보고 한 줄.

### 5.1 AI 도구 — **기본 목록과 이미 있는 이름만**
- `services/agent/tools/tasks.js` 에 `resolveOutputNames(p, names)` — `taskOutputKinds.resolveNamesToIds(p.businessId, names, { userId: p.userId, allowCreate: false })`. `unknown` 이 하나라도 있으면 `VALIDATION_ERROR unknown_outputs` + `{ unknown_outputs, available_outputs }`(이 워크스페이스 사전 이름 + 기본 목록 ko·en 라벨, 최대 150) + hint. **태그 판정(Fable B 판정 3 ③ «AI 가 사전을 늘리지 않는다»)과 같은 선** — AI 는 같은 것을 매번 다른 말로 써서 사전을 쓰레기로 채운다.
- 기본 항목은 «새로 만드는 것» 이 아니다 — 기본 라벨(ko/en 어느 쪽이든)이면 `ensurePresetRow` 로 행이 생기고 붙는다.
- `create_task` 미리보기(`previewCreateTask`)도 같은 판정을 **먼저** 본다(실행에서야 막히면 확인 카드가 거짓말이 된다 — 태그와 같은 자리 한 줄).
- `update_task`: `output_names !== undefined` 면 미리보기 단계에서 권한(`isCreator||isAssignee||isOwnerOrAdmin`)과 이름 판정을 태그와 같은 자리에서 보고, 실행은 `task_output_actions.setOutputKinds`. `no_fields` 판정·`asked` 목록에 `output_names` 를 더한다. 위험도는 태그와 같다(이 칸 때문에 확인 2단계가 되지 않는다).
- `registry.js`: 두 도구 스키마에 `output_names: z.array(z.string().trim().min(1).max(40)).max(10).optional()` + describe(«Expected outputs of the task. Use a preset label or a name that already exists in this workspace — unknown names are rejected with the available list; PlanQ does not create new ones from here.»). `update_task` description 에 «expected outputs» 한 구절.
- **scope 는 그대로**(업무 쓰기 scope) — 새 scope·재연결 없음. 도구 수도 그대로(45). 에이전트 도구 파일에서 모델을 직접 쓰지 않는다(가드 `--category=agentsurface` — 서비스·행동 계층을 통해서만).
- `docs/AI_AGENT_INTEGRATION_DESIGN.md` §6.3 표의 두 도구 줄과 `.claude/rules/ai-agent.md` «쓰기 보강» 항목에 한 줄.

---

## 6. 화면

### 6.1 컴포넌트 (전부 신규 파일 — 드로어·폼에 인라인하지 않는다)

| 파일 | 역할 |
|---|---|
| `components/QTask/useTaskOutputKindDict.ts` | 사전(`GET /output-kinds`) + 기본 목록(`/output-kinds/presets`) 을 읽어 **고를 목록 하나**로 합친다: 사전 행 + 아직 행이 없는 기본 항목. 소켓 `task_output_kind:updated` 에 다시 읽기. `add(row)` 즉시 반영. 고객이면 호출하지 않는다(403 을 치지 않게) |
| `components/QTask/outputKindLabel.ts` | `labelOf(item, lang)` = `item.labels?.[lang] ?? item.name` **한 곳** — 칩·셀렉트·템플릿 칩이 전부 이 함수 |
| `components/QTask/OutputKindPicker.tsx` | `TagPicker` 와 같은 `PlanQSelect creatable isMulti isSearchable`. 옵션 값은 `id:<n>` 또는 `preset:<key>`. 행 없는 기본 항목을 고르면 `POST {preset_key}` 로 id 를 받아 바꿔 넣는다. 없는 이름은 `'{{name}}' 산출물 추가` → `POST {name}`. 실패(상한·중복)는 칸 아래 빨간 글씨(조용한 실패 금지 — `res.ok` 를 본다) |
| `components/QTask/OutputKindChips.tsx` | 읽기 전용 칩 줄(`TagChips` 모양·무채색). 빈 배열이면 **아무것도 그리지 않는다** |
| `components/QTask/TaskOutputKindsField.tsx` | 드로어용 묶음 — 라벨 줄(«산출물» + 멤버에게 «목록 관리») + 편집 가능하면 Picker(자기가 PUT 저장, 반복이면 드로어가 넘겨준 범위 묻기 함수 사용), 아니면 Chips. 고객 힌트 한 줄 |
| `components/QTask/OutputKindManageModal.tsx` | `Common/DictManageModal` 어댑터(`TagManageModal` 과 같은 모양, `reorder` 없음). **직접 입력 항목만** 보인다(기본 항목은 이름 변경·삭제 대상이 아니다). 삭제 확인에 사용 수 |

`PlanQSelect`·`DictManageModal`·`SeriesScopeDialog` 는 있는 것을 쓴다(새로 만들지 않는다 — `.claude/rules/ui-components.md`).

### 6.2 자리

**업무 만들기 폼 (`TaskCreateForm.tsx`) — «업무»·«요청하기» 두 모드 모두**
```
[제목]
[담당자] [프로젝트] [마감] …            ← 그대로
[태그]                                   ← 그대로(옵션 줄)
[업무 설명 / 요청 내용 에디터]
산출물  [ 제안서 × ][ 디자인 시안 × ][ 검색하거나 입력… ▾ ]   ← 신규, 설명 바로 아래 전폭
[첨부] …
```
- 상태 `outputKindIds: number[]` → 제출 본문 `output_kind_ids`. 폼 초기화(`initial`)·리셋 경로에 같이 넣는다.
- `initial.outputNames` 같은 사전 채움(Cue 폼 seed)은 **만들지 않는다**(범위 밖).
- 고객이 이 폼을 쓰는 화면이 있으면 그 역할에서는 칸을 그리지 않는다.

**업무 상세 (`TaskDetailDrawer.tsx`)** — 두 곳, 각각 **컴포넌트 한 줄**
1. «업무 설명 / 요청 내용» Section 안, **에디터 바로 아래**(설명 첨부·관련 업무 위): `<TaskOutputKindsField … />`
   - 편집 가능(작성자·담당자·owner·admin, 고객 아님) → Picker. 아니면 칩(읽기). 값이 비었고 편집도 못 하면 줄 전체를 그리지 않는다.
   - 설명은 «작성자만» 이지만 이 칸은 태그 축이다 — Section 머리의 «읽기 전용» 뱃지와 별개로 이 줄 라벨 옆에 자기 잠금 표시(`MetaLock` 과 같은 것)를 둔다.
2. «결과물» Section 안, **SectionTitle 바로 아래**(작성 상태 한 줄 `BodyModeLine` 위): `만들 산출물  [제안서][디자인 시안]` — `OutputKindChips` 읽기 전용. 비면 그리지 않는다. 담당자가 결과물을 쓰는 자리에서 «무엇을 내야 하나» 를 본다. «결과물 액션» Section 과는 섞지 않는다(그 칸은 고객에게 숨김, 이 줄은 고객에게도 보임).

★ **`TaskDetailDrawer.tsx`(3,789줄)는 god-file 래칫 대상이다.** 넣는 것은 import + 위 두 줄 + 값 연결 최소한. 늘어난 줄 수만큼 **같은 커밋에서** 기존 조각을 파일 밖으로 빼서 순증 0 이하로 맞춘다. `--no-verify`·베이스라인 올리기 금지. `routes/tasks.js`·`task_actions.js` 도 같다(호출 한 줄씩).

**목록 관리 진입**: `TaskOutputKindsField` 라벨 줄의 «목록 관리» 글자 버튼(멤버만) 한 곳. 다른 화면에 메뉴를 더하지 않는다.

**세 폭**: 칩은 줄바꿈된다(가로 넘침 없음). 폰에서 셀렉트 메뉴가 화면 밖으로 나가지 않는지 — `TagPicker` 와 같은 `PlanQSelect` 라 같은 동작이어야 한다(§10 화면 검사).

### 6.3 문구 (i18n — `qtask.json` ko/en 양쪽, 네임스페이스 `qtask`)

| 키 | ko | en |
|---|---|---|
| `outputs.label` | 산출물 | Expected outputs |
| `outputs.toProduce` | 만들 산출물 | To produce |
| `outputs.placeholder` | 산출물 검색 또는 입력 | Search or type an output |
| `outputs.createNamed` | '{{name}}' 산출물 추가 | Add "{{name}}" |
| `outputs.clientHint` | 고객이 보는 업무에서는 산출물 이름이 고객에게도 보입니다 | On tasks a client can see, output names are visible to the client |
| `outputs.manage` | 목록 관리 | Manage list |
| `outputs.manageTitle` | 산출물 목록 관리 | Manage outputs |
| `outputs.manageHint` | 직접 추가한 산출물만 이름을 바꾸거나 지울 수 있어요 | Only outputs you added can be renamed or deleted |
| `outputs.manageEmpty` | 직접 추가한 산출물이 아직 없습니다 | No custom outputs yet |
| `outputs.newPh` | 새 산출물 이름 | New output name |
| `outputs.usageCount` | 업무 {{count}}개 | {{count}} tasks |
| `outputs.deleteConfirm` | “{{name}}” 산출물을 {{count}}개 업무에서 빼고 삭제할까요? | Remove “{{name}}” from {{count}} tasks and delete it? |
| `outputs.createFailed` | 산출물을 추가하지 못했습니다 | Couldn't add the output |
| `outputs.saveFailed` | 산출물을 저장하지 못했습니다 | Couldn't save outputs |
| `outputs.renameFailed` | 이름을 바꾸지 못했습니다 | Couldn't rename |
| `outputs.deleteFailed` | 삭제하지 못했습니다 | Couldn't delete |
| `outputs.limitTask` | 업무당 산출물은 최대 10개입니다 | Up to 10 outputs per task |
| `outputs.limitWorkspace` | 직접 추가한 산출물은 최대 100개입니다 | Up to 100 custom outputs |
| `outputs.matchesPreset` | 기본 목록에 있는 이름입니다 | That name is already in the default list |

서버 오류는 **코드**(`too_many_output_kinds`·`output_kind_limit`·`matches_preset`·`duplicate_name`…)로 주고 화면이 위 키로 옮긴다 — 서버 한글 문장을 그대로 띄우지 않는다(en 사용자에게 한글이 뜬다). 기본 목록 라벨은 API `labels` 로 온다(locale 파일에 넣지 않는다 — 정본 한 곳).
`alert`·`confirm`·`toast.success` 금지 — 삭제 확인은 `DictManageModal` 이 가진 확인 창.

---

## 7. 기본 목록 (22개) — `services/taskOutputKindPresets.js`

순서가 곧 고르는 목록 순서(일의 흐름: 영업 → 기획 → 디자인 → 제작 → 개발 → 보고). key 는 한번 나가면 바꾸지 않는다.

| # | key | ko | en |
|---|---|---|---|
| 1 | `proposal` | 제안서 | Proposal |
| 2 | `quote` | 견적서 | Quote |
| 3 | `contract` | 계약서 | Contract |
| 4 | `planning_doc` | 기획서 | Planning document |
| 5 | `requirements` | 요구사항 정의서 | Requirements specification |
| 6 | `schedule` | 일정표 | Project schedule |
| 7 | `research_report` | 조사 보고서 | Research report |
| 8 | `data_analysis` | 데이터 분석 자료 | Data analysis |
| 9 | `wireframe` | 와이어프레임 | Wireframe |
| 10 | `design_draft` | 디자인 시안 | Design draft |
| 11 | `final_design` | 최종 디자인 파일 | Final design files |
| 12 | `prototype` | 프로토타입 | Prototype |
| 13 | `copywriting` | 원고 | Copy |
| 14 | `presentation` | 발표 자료 | Presentation deck |
| 15 | `video` | 영상 | Video |
| 16 | `source_code` | 소스 코드 | Source code |
| 17 | `release_build` | 배포본 | Release build |
| 18 | `test_report` | 테스트 결과서 | Test report |
| 19 | `user_manual` | 사용 설명서 | User manual |
| 20 | `meeting_minutes` | 회의록 | Meeting minutes |
| 21 | `progress_report` | 진행 보고서 | Progress report |
| 22 | `final_report` | 결과 보고서 | Final report |

파일이 로드될 때 스스로 확인한다(어긋나면 throw — 서버가 뜨지 않게): key 중복 0 · 정리한 ko/en 라벨 44개가 서로 전부 다름(대소문자 무시) · 각 40자 이하. 이 목록은 운영 시드 데이터가 아니라 **제품 사양(코드 상수)**이다 — mock 이 아니다.

---

## 8. 이번 범위가 아닌 것 (만들지 않는다 — 필요하면 Irene 에게 따로 묻는다)

- 목록·팝아웃 행의 산출물 칩, 산출물별 필터·묶음·통합 검색
- 산출물을 고르면 «결과물 액션» 이 자동으로 생기는 연결
- 수량·메모·담당·마감 같은 산출물별 부가 칸, 색, 순서 지정
- 고객이 요청할 때 직접 고르기 · 공개 공유 링크/게스트에 표시
- AI 업무추가 후보 카드·템플릿 AI 추천·Cue 폼 seed 에 산출물 채우기 · 템플릿 편집 화면 안에서 고르기
- 기본 항목 숨기기/워크스페이스별 기본 목록 편집
- 업무 복사 시 태그 미복사(기존 동작) 고치기
- `tasks.category` 승격/폐기

---

## 9. 구현 순서와 손대는 파일

1. **DB**: `scripts/migrate-task-output-kinds.js` · `models/TaskOutputKind.js` · `models/TaskOutputKindLink.js` · `models/index.js`(등록·관계) → dev 에서 실행 2회(멱등)
2. **서버 본체**: `services/taskOutputKindPresets.js` · `services/taskOutputKinds.js` · `services/actions/task_output_actions.js` · `routes/task_output_kinds.js` · `server.js` mount 한 줄
3. **기존 길에 한 줄씩**: `task_actions.createTask`(연결 + 고객 거절) · `routes/tasks.js`(POST 본문 `output_kind_ids` 전달 · detail attach · copy) · `recurringTaskGenerator.js` · `templateDetails.js`(normalize/collect/materialize)
4. **AI**: `services/agent/tools/tasks.js` · `services/agent/registry.js`
5. **화면**: §6.1 여섯 파일 → `TaskCreateForm.tsx` → `TaskDetailDrawer.tsx`(순증 0) → `TemplateEditItems.tsx`·`templateItem.ts` 칩 → `qtask.json` ko/en
6. **검사·문서**: `scripts/check-task-output-kinds.js`(§10) · `.claude/rules/db-schema.md`·`qtask.md`·`ai-agent.md` 한 줄씩 · `docs/AI_AGENT_INTEGRATION_DESIGN.md` §6.3 · 배포 스크립트 마이그레이션 등록
7. `npm run build`(메모리 자리표·백그라운드) → §10 전부 → `/fable-검증` 1회

규모 = 대(신규 표 2 + 다수 파일). 커밋은 서버/화면으로 나눠도 되지만 **3번의 detail attach 와 5번의 드로어는 같은 배포에 들어가야 한다**(§3.4 ★).

---

## 10. 검증 설계 — «끝났다» 고 말하려면 실측할 것

**공용 기준상 이 변경은 Fable 완료 검증 대상이다**(멀티테넌트 격리 · AI 에이전트 쓰기 표면 · 새 멤버 라우트 · 고객에게 가는 새 칸). 자체 검증 숫자를 만든 뒤 `/fable-검증` **1회**(쪼개 올리지 않는다).

회귀 스크립트 **`dev-backend/scripts/check-task-output-kinds.js`** 를 남긴다(지우지 않는다 — `check-recur-change.js` 와 같은 자리). 실 HTTP(포트 3003) + dev DB, 시험 계정(owner·member1·member2·client, ws 6) + 격리 상대(ws 7). 만든 데이터는 이름 앞에 `[확인용]`, 스크립트가 만든 사전 행·업무는 끝에 지운다(보고 «확인할 곳» 에 남길 1건 제외).

| # | 무엇을 증명하나 | 실측 | 통과 기준 |
|---|---|---|---|
| ① 마이그레이션 멱등 | 두 번 돌려도 같다 | 스크립트 2회 + `information_schema` | 2회차 «이미 존재 — skip», 인덱스 이름 4개가 모델 `name` 과 글자까지 같음, `sync-database.js` 를 돌려도 인덱스 수 불변 |
| ② 기본 항목은 고를 때만 생긴다 | 배포만으로 데이터 0 | 새 상태에서 `GET /output-kinds` | 행 0 · `/presets` 22개 |
| ③ 이름 판정 | ko/en 이 같은 행 | ws 6 에서 `POST {name:'제안서'}` → `POST {name:'proposal'}` → `POST {preset_key:'proposal'}` | 셋 다 같은 id, `preset_key='proposal'`, 사전 행 수 1 |
| ④ 직접 입력 | 저장·중복·정리 | `POST {name:'  [확인용]  브랜드  북 '}` 두 번 · 41자 · 빈 이름 | 첫 201 → 둘째 200 같은 id · 이름 `[확인용] 브랜드 북` · 400 · 400 |
| ⑤ 생성에 붙는다 | 업무·요청 두 모드 | `POST /api/tasks` `output_kind_ids` (본인 담당 / `as_request:true` 남 담당) → detail 재조회 | 두 건 모두 `output_kinds` id 집합 일치 · 순서 = 기본(코드 순)→직접(이름순) |
| ⑥ 상세가 싣는다(F1 재발 방지) | 교체 PUT 이 기존 것을 안 지운다 | 2개 붙은 업무 detail → 받은 목록 + 1개로 `PUT` → 재조회 | 3개. **양성 대조군**: detail attach 한 줄을 임시로 빼면 이 검사가 FAIL 로 뒤집히는지 확인 후 되돌림 |
| ⑦ 권한 축 | 태그와 같은 집합 | 같은 업무에 owner / 작성자 / 담당자 / 무관 멤버(member2) / client 로 `PUT /:id/output-kinds` | 200·200·200·**403**·**403**. 11개 → 400 |
| ⑧ 격리 | 남의 워크스페이스 id | ws 7 사전 id 를 ws 6 업무에 PUT · 생성 본문에 섞기 · ws 6 멤버가 ws 7 행 `PUT/DELETE /output-kinds/:id` · ws 7 `GET ?business_id=7` | 400 `unknown_output_kinds` · 생성 거절(업무 안 생김) · 403 · 403. DB 에 교차 연결 0행(SQL 로 셈) |
| ⑨ 고객 노출 — 보이는 것 | 고객이 그 업무의 산출물을 본다 | client 로 자기 프로젝트 업무 detail | `output_kinds` 에 이름 있음 · `usage_count` 없음 · `tags` 는 여전히 없음 |
| ⑩ 고객 노출 — 막힌 것 | 사전·쓰기·남의 업무 | client 로 `GET /output-kinds`·`/presets`·`POST`·`PUT /:id/output-kinds` · 접근 못 하는 업무 detail · client 가 `output_kind_ids` 를 실어 업무 생성 | 403×4 · 기존과 같은 거절(404/403) · 403 이고 업무 미생성. **양성 대조군**: `requireMember` 를 `assertBusinessAccess` 로 바꾸면 GET 이 200 으로 뒤집히는지 1회 확인 후 되돌림 |
| ⑪ 무인증 표면 불변 | 공개 링크에 안 실린다 | 산출물 붙은 업무를 공유 → `/api/tasks/public/by-token/:t` | 응답 키 집합이 변경 전과 **같다**(키 목록 diff 0) · `output` 문자열 0건 |
| ⑫ 목록에 안 실린다 | 범위 밖이 새지 않는다 | all-tasks 목록 응답 | `output_kinds` 키 없음 · 응답 시간·쿼리 수 변경 전과 같음(쿼리 +0) |
| ⑬ 반복 상속 | 회차가 부모 것을 받는다 | 반복 업무에 2개 → `generateOneSeries` → 새 회차 detail | 같은 2개 |
| ⑭ 반복 범위 | 델타만 적용 | 회차 A 에 1개 더 있는 상태에서 부모에서 `series_scope` 전체로 1개 추가·1개 제거 / `single` 로 변경 | 전체: 모든 회차에 추가분 생기고 제거분만 빠짐(A 의 고유분 유지) · single: 다른 회차 불변 |
| ⑮ 복사 | 내용은 따라가고 주인은 복사한 사람 | `POST /:id/copy` → 복사본 detail · 원본 detail | 복사본 같은 집합 · 원본 불변. 읽기 403 인 사람은 복사도 403(기존 판정 그대로) |
| ⑯ 템플릿 왕복 | 저장 → 적용 | 산출물 붙은 프로젝트 업무 → 템플릿 저장(항목 `output_names`) → **ws 6 다른 프로젝트**에 적용 · 사전에서 직접 입력 행을 지운 뒤 다시 적용 | 적용 업무에 같은 이름 · 지운 이름은 다시 만들어져 붙음(`allowCreate`) · 기본 항목은 `preset_key` 유지 |
| ⑰ AI 만들기 | 있는 이름·기본 라벨만 | `create_task` `output_names:['Proposal','[확인용] 브랜드 북']` / `['없는이름XYZ']` | 첫째 생성 + 2개 연결(영어 라벨이 ko 워크스페이스의 같은 행으로) · 둘째 `unknown_outputs` + `available_outputs` 반환, **업무 미생성**, 사전 행 수 불변 |
| ⑱ AI 고치기·읽기 | 교체 의미·권한 | `update_task` `output_names:[…]`(작성자 연결 / 무관 멤버 연결) → `get_task` | 교체됨·`outputs` 일치 / PERMISSION_DENIED. 감사 행에 `via: agent:*` |
| ⑲ 사전 관리 | 이름 변경·삭제·기본 항목 보호 | 직접 입력 행 이름 변경 → 붙은 업무 detail · 기본 라벨로 변경 시도 · 기본 항목 행 PUT/DELETE · 직접 입력 삭제 | 새 이름으로 보임 · 409 · 400×2 · 삭제 후 연결 0·`removed_links` 가 사전 사용 수와 같음 |
| ⑳ 상한 | 100 | 직접 입력 100개 채우고 101번째 · 그 상태에서 기본 항목 고르기 | 400 `output_kind_limit` · 기본 항목은 **성공**(상한에 안 든다). 끝나고 전부 정리 |
| ㉑ 감사·소켓 | 바뀔 때만 | 같은 목록으로 PUT 두 번 · find 로 끝난 POST | 감사 행 +1(두 번째 0) · 소켓 0회 |

**가드·빌드** (전부 초록 + 숫자 보고)
- `npm run build` EXIT 0 · `error TS` 0 (`tsc --noEmit` 로 대신하지 않는다)
- `node scripts/guard-invariants.js` 전체 — 특히 `godfile`(동결 수 증가 0)·`i18n`·`parity`(ko/en 키 수 같음)·`duproute`·`pagination`·`agentsurface`
- `node scripts/health-check.js` · `node scripts/e2e/run.js --suite tenant`

**화면** (폰·태블릿·데스크탑 세 폭 — 크기가 아니라 «보이는가»: 조상 클리핑 + `elementFromPoint` + 스크린샷)
- 만들기 폼 «업무»·«요청하기» 두 모드에서 설명 아래 칸이 보이고, 기본 항목 검색(«제안» → 제안서 / en 화면 «prop» → Proposal)·직접 입력 추가·제출 뒤 상세에 그대로
- 상세: 설명 아래 편집 칸(owner) · 무관 멤버는 칩 + 잠금 · **고객(`[as=client ws=6]`)은 칩만, «목록 관리»·셀렉트 없음, 네트워크에 `/output-kinds` 호출 0** · 결과물 머리 «만들 산출물» 줄 · 산출물 0개면 두 줄 모두 DOM 에 없음
- 언어 전환: 같은 업무가 ko 에서 «제안서», en 에서 «Proposal»; 직접 입력은 두 언어에서 같은 글자
- 반복 업무에서 바꾸면 범위 묻는 창이 태그와 같게 뜬다
- 드로어 줄 수: 변경 전 3,789 → 변경 후 ≤ 3,789

**요구사항 대조**(보고에 ✅/❌): 설명 아래 여러 개 고름 · 기본 목록 ko/en 자동 검색 · 없는 것 입력 → 워크스페이스 목록 저장 · 만들기 · 요청하기 · 상세 · 템플릿 · AI create_task · 결과물 위 «만들 산출물» · 태그와 같은 틀.

---

## 11. 배포·되돌리기

- 순서: 마이그레이션(표 2개, 데이터 0) → 백엔드 → 프론트. 옛 백엔드는 이 표를 쓰지 않으므로 DB 선행은 안전.
- 옛 프론트 + 새 백엔드: 새 칸을 모를 뿐 깨지지 않는다(본문에 `output_kind_ids` 없으면 아무 일도 안 한다).
- 되돌리기: 코드 롤백만으로 기능이 사라진다. 표와 그동안 쌓인 연결은 남고(무해) 다시 올리면 이어진다.
- 운영 반영: 다음 배포 때(일하는 방은 배포를 묻지 않는다).
