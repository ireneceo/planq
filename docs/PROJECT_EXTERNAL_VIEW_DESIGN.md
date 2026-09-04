# 외부 프로젝트 열람 링크 설계 — "앱에서 보는 프로젝트 화면 그대로, 로그인 없이"

> 작성: 2026-09-02 · **Fable 설계 게이트 산출물** (공개·무인증 표면 확장 = 보안 경계 변경 → 고위험, 설계·구현·배포 3단 Fable)
> 상태: **승인됨 (2026-09-04). §12 세 건 모두 제안대로 확정 — Irene "제안대로 ㄱ".**
> 1차 착수 가능. Q1 승인으로 2차 문서 탭도 보안등급 축으로 간다.
> 근거는 전부 실제 파일을 열어 `파일:줄` 로 적었다. 못 연 것은 `[미확인]`. 운영 DB 는 읽기만 했다.
> 선행 문서: `docs/GUEST_LINK_DESIGN.md`(게스트 링크 #259), `docs/SHARE_PREVIEW_POLICY.md`(공개 미리보기 노출 매트릭스), `docs/VISIBILITY_VOCABULARY.md`(L1~L4), `docs/PERMISSION_MATRIX.md §7`(고객 범위)

---

## 0. 지난 판정의 정정 — 무엇이 틀렸고 왜 이번엔 다른가

**지난 라운드(2026-09-02 오전) 판정:** "프로젝트 공유 = 그 프로젝트의 고객 채널에 게스트 링크 발급. 개요는 이미 나가고 있다."
Opus 는 그대로 구현했고, Irene 은 결과를 보고 이렇게 말했다:

> "프로젝트 헤더에 고객공유링크 버튼이 누르면 채팅창 링크가 생겨. 이 버튼은 여기 왜 있어? 헷갈려."
> "너가 공유해준 링크도 채팅방 링크잖아."
> "**나는 프로젝트 안 탭들 보는 그대로 프로젝트 링크 물어본건데?**"

### 0.1 틀린 것 두 가지

| # | 지난 판정 | 실제 | 근거 |
|---|---|---|---|
| 1 | "게스트 개요가 이미 거래 단계 kind/label/status + 업무 총수/완료수를 내보낸다" (`routes/guest.js:81-95` 인용) | 그 시점 코드는 **이름·설명·상태·시작일·종료일 5개뿐**이었다. 단계·업무 숫자·문서 목록은 Opus 가 이번에 새로 넣은 것(현재 미커밋 `guest.js:96-143`) | `routes/guest.js:88-94` (5필드), `:96-143` (신규 블록, `git diff` 로 확인) |
| 2 | "개요 몇 줄 + 채팅이면 프로젝트 공유다" | Irene 의 요구는 **탭이 있는 읽기 전용 프로젝트 페이지**다. 1280×900 에서 정보 띠 200px, 나머지 700px 이 채팅 — 받은 사람에게는 채팅방이다 | Opus 실측 좌표, `GuestConversationPage.tsx:247-292`(띠) · `:325-358`(채팅 본문 `flex:1`) |

1번은 인용 전에 파일을 열지 않은 잘못이다. 이 문서의 모든 `파일:줄` 은 이번에 실제로 열어 확인했다.
2번은 전제 오류다 — "채팅 링크에 프로젝트 정보를 얹으면 프로젝트 링크" 라고 봤는데, Irene 의 기준은 **화면의 주인이 누구냐**다. 이번 설계는 **프로젝트가 주인이고 대화는 탭 하나**다.

### 0.2 이번 설계의 한 줄

> **외부 열람 링크 = 로그인 안 한 고객이 보는 프로젝트 페이지.** 로그인 고객(Client 역할)이 앱에서 보는 것의 **부분집합**만 나간다(상한). 그 안에서 **보안등급이 걸린 자료는 자리만 보이고 "로그인하면 볼 수 있어요"** 로 잠긴다(Irene: "보안등급 걸리는 건 로그인 시키고 나머지는 채팅창처럼 그냥 공유").

"로그인 고객의 부분집합" 을 상한으로 두는 이유: 링크를 받은 사람은 **기껏해야 아직 로그인하지 않은 그 고객**이다. 로그인 고객보다 더 보는 일은 있을 수 없고, 그 상한은 이미 코드에 있다 — `CLIENT_HIDDEN_TABS` (`QProjectDetailPage.tsx:149`) 와 서버의 `role === 'client'` 403 들 (`routes/projects.js:384, 434, 627, 703 …`).

---

## 1. 지금 앱의 프로젝트 탭 — 무엇이 있고 고객에게 무엇이 숨는가 (실측)

`QProjectDetailPage.tsx:147` `TabKey` 11종 + 고정 문서 탭(`doc-N`). 고객 숨김은 `:149`:

```ts
const CLIENT_HIDDEN_TABS: TabKey[] = ['dashboard', 'clients', 'transactions', 'report', 'details', 'settings', 'history'];
```

| 탭 | 라벨(ko/en) | 데이터 원천 | 로그인 고객 | 왜 |
|---|---|---|:-:|---|
| dashboard | 개요/Overview | `ProjectCanvas` (전략 5필드 `strategy_*`, `Project.js:53-57`) + 설명 | ❌ | 내부 전략. `:715` `!isClient` |
| tasks | 업무/Tasks | `GET /api/projects/:id/tasks` (`projects.js:2285`) | ✅ | **`role` 을 아예 안 본다** — 전 업무·담당자·요청자 그대로 (`:2287` 구조분해에 role 없음) |
| clients | 고객/Clients | `project.projectClients` (`loadProjectDetail` `:3033-3048`, `contact_email` 포함) | ❌ | 다른 고객 연락처 |
| files | 파일/Files | `DocsTab` → files 라우트 (`files.js:457 fileListWhereByLevel`) | ✅ | 고객은 자기 프로젝트+본인 업로드 (`access_scope.js:298-309`) |
| docs | 문서/Docs | `PostsPage scope=project` → `posts.js:219-224 postListWhere` | ✅ | 고객은 자기 프로젝트 post (`access_scope.js:425-433`, **vlevel 무검사**) |
| info | 정보/Info | KB documents (`kb.js:186`) | (탭은 보임) | 서버가 **client 403** — 고객에게는 빈 탭이다 |
| transactions | 거래/Transactions | `projects.js:2100-2160` — 청구서 `grand_total/paid_amount`, 서명 `signer_email` | ❌ | 돈·이메일 |
| report | 보고서/Report | `ReportUnitView` (멤버별 공수) | ❌ | 공수·원가 |
| history | 히스토리/History | `event_stream` 6소스 (`projects.js:380-384`) | ❌ (403) | 소스별 고객 필터 없음 |
| details | 상세정보/Details | 재무(`monthly_fee`·`auto_invoice_*` `Project.js:38-50`)·전략 편집 | ❌ | |
| settings | 설정/Settings | | ❌ | |

**고객 기본 탭은 `docs`** (`:243` `isClient ? 'docs'`). 즉 앱이 이미 "고객에게 프로젝트란 업무·파일·문서" 라고 정의해 놓았다. 외부 링크는 여기서 출발한다.

> **별건 발견 (이번 범위 아님, 기록만):** `GET /api/projects/:id/tasks` 가 client 역할에 아무 필터가 없다(`projects.js:2285-2310`). PERMISSION_MATRIX §7 은 고객 업무를 "담당·작성·요청·컨펌 본인 OR 참여 대화방 OR **참여 프로젝트의 task**" 로 정의하므로 프로젝트 안에서는 정합이다. 다만 `estimated_hours/actual_hours`(`Task.js:194,198`)·`body`(`:41`)까지 고객에게 내려간다 — 이 문서의 외부 화이트리스트(§3.2)가 그보다 좁은 이유이기도 하다.

---

## 2. ③ 토큰 체계 — 결론: **게스트 링크를 그대로 쓴다. 스키마는 `scope` 컬럼 1개만 더한다.**

### 2.1 세 갈래

| 안 | 내용 | 버리는 이유 / 고르는 이유 |
|---|---|---|
| A. `guest_links.conversation_id` nullable 화 | 프로젝트만 가리키는 링크 허용 | **버림.** `resolveGuestToken` 이 대화방을 필수로 검증하고(`guest_link.js:45-47`), `issueGuestLink` 가 참가자 row 를 만들며(`:119-123`), 공개 라우트 4개 전부 `conversation` 을 구조분해한다(`guest.js:77,164,249,273`), 관리 라우트는 대화방 단위로 목록·회수한다(`guest_admin.js:38,124`). Q sale 설계는 `guest_links.client_id`·`has_guest_link` 를 대화방 전제로 쓴다(`Q_SALE_DESIGN.md:300-316`). nullable 로 바꾸면 이 **7곳의 술어가 전부 두 갈래**가 되고, 그 갈림이 곧 우회로다. 게다가 대화방이 없으면 "문의" 가 없다 — Irene 은 "채팅창처럼" 이라고 했다. |
| B. 프로젝트 전용 테이블 `project_share_links` | 토큰·해석기·킬스위치 별도 | **버림.** 해석기가 두 벌 = 만료·회수·킬스위치 검사를 빠뜨리는 곳이 생긴다(`guest.js:1-9` 의 규칙 ①이 바로 이것). 관리 UI·감사·Q sale 연동도 두 벌. |
| **C. 게스트 링크 그대로 + `scope` 컬럼** | 링크는 여전히 대화방 하나에 붙는다. `scope='project'` 면 **프로젝트 페이지(탭)** 로 열리고 그 대화방은 "대화" 탭이 된다. `scope='conversation'` 이면 지금처럼 채팅만 | **고름.** 스키마 변경은 컬럼 1개 추가(기본값 있음), 해석기·킬스위치·회수·rate-limit·감사 전부 그대로. 탭 라우트는 `scope` 로만 열린다 — 용도 제한을 "검사" 가 아니라 **파생 열쇠**로 둔다(memory `feedback_falsify_both_directions`). |

### 2.2 왜 `scope` 가 꼭 필요한가 — 기존 링크가 조용히 넓어지는 것을 막는다

QTalk 에서 만든 채팅 링크도 `project_id` 를 들고 있다 (`guest_admin.js:95` `projectId: conv.project_id`). `project_id` 유무로 페이지를 갈라 버리면 **이미 나가 있는 채팅 링크가 배포 순간 업무·문서 탭을 얻는다.** 운영에 그런 링크가 1건 있다(운영 DB 실측: guest_links 1건, project_id 있음, 활성). 그래서:

```sql
ALTER TABLE guest_links
  ADD COLUMN scope ENUM('conversation','project') NOT NULL DEFAULT 'conversation' AFTER project_id,
  ADD INDEX guest_links_project_scope (project_id, scope);
```

- 기존 행은 전부 `conversation` (백필 불요, 의미 불변). 운영 적용은 위 ALTER 한 줄 — `sync-database` 의 ALTER 는 인덱스 64키 한계(memory `feedback_sync_alter_too_many_keys`)가 있어 **수동 ALTER 가이드**로 배포 체인에 넣는다. 멱등 스크립트 `dev-backend/scripts/migrate-guest-link-scope.js`(컬럼 존재 검사 후 ALTER).
- 모델 `GuestLink.js` 에 컬럼 추가. **sync 가 모델 밖 컬럼을 DROP 하는 사고**(memory `feedback_sync_drops_columns_not_in_model`)를 피하려면 모델과 ALTER 를 같은 커밋에.

### 2.3 링크 한 개가 여는 것 (scope 별)

| | `conversation` (지금) | `project` (신규) |
|---|---|---|
| 착지 | `/g/:token` 채팅 화면 | `/g/:token` **프로젝트 페이지** (탭) |
| 대화방 | 그 방 하나 | 그 방 하나 = "대화" 탭 |
| 프로젝트 | 이름·설명·상태·기간 5필드 (**Opus 가 넣은 단계·업무 숫자·문서 띠는 뺀다** — 채팅 링크는 채팅이다, §9) | 개요·업무·문서·파일·대화 5탭 (§3) |
| 쓰기 | `can_write` | `can_write` (같은 컬럼, 같은 라우트) |

URL 은 **`/g/:token` 하나**로 둔다. 같은 토큰에 두 경로를 주면 리다이렉트·OG·publicSurface·robots 가 두 벌이 된다. 페이지는 `ctx.scope` 로 갈라 그린다. (Irene 이 "채팅방 링크잖아" 라고 한 것은 URL 이 아니라 **열린 화면**을 보고 한 말이다.)

### 2.4 대화방은 어느 것인가

프로젝트의 **고객 채널(`channel_type='customer'`) 중 id 가 가장 작은 것**, 없으면 만든다 — Opus 가 `POST /projects/:id/guest-channel` 에 넣은 판단(미커밋 `projects.js:688-750`)을 **API 가 아니라 서비스 함수**로 옮긴다(§9). 발급 라우트가 내부에서 부른다. 고객 채널이 여럿인 프로젝트(고객사가 둘)는 첫 방에 붙는다 — 모달이 "대화 탭 = {방 제목}" 을 보여 준다. 방을 고르게 하는 것은 2차(§8).

---

## 3. ① 탭 구성과 필드 화이트리스트

### 3.1 탭 — 5개 내보내고 6개 없앤다

| 외부 탭 | 라벨 ko / en | 원천 탭 | 내보내는 이유 |
|---|---|---|---|
| **개요** | 개요 / Overview | (신규 조합 — 앱 dashboard 의 캔버스는 **아니다**) | 설명·기간·상태·거래 단계 칩·업무 요약 숫자. 지금 정보 띠(`GuestConversationPage.tsx:247-292`)를 탭으로 |
| **업무** | 업무 / Tasks | tasks | 고객이 보는 것. 필드는 §3.2 |
| **문서** | 문서 / Docs | docs | 고객 기본 탭. 보안등급 게이트 §4 |
| **파일** | 파일 / Files | files | 목록. 다운로드는 §4.3 |
| **대화** | 대화 / Chat | (프로젝트 헤더의 "프로젝트 채팅" 버튼 `:662-670` 에 해당) | 기존 게스트 채팅 그대로. 문의 자리 |

**없애는 탭과 근거 (탭이 없다 = 라우트도 없다 = 가장 강한 차단, GUEST_LINK §5.3):**

| 탭 | 왜 없나 |
|---|---|
| 고객(clients) | `projectClients.contact_email`(`ProjectClient.js:12`) — 다른 고객의 연락처. 고객도 못 본다 |
| 거래(transactions) | `grand_total/paid_amount/currency`(`projects.js:2153`), `signer_email`(`:2136`). **돈·주문 무결성 영역.** 거래 **단계 라벨**만 개요 칩으로 (§3.2 개요) |
| 보고서(report) | 멤버별 공수 — 원가가 역산된다 |
| 히스토리(history) | 6소스 스트림, 고객도 403 (`projects.js:384`) |
| 상세정보(details)·설정(settings) | 재무·전략·편집 |
| 정보(info, Q info/KB) | 서버가 고객에게 403 (`kb.js:186`) — 고객도 못 보는 것을 외부에 열 수 없다 |
| 고정 문서 탭(doc-N) | 멤버 개인 설정 |
| 캔버스(dashboard 의 ProjectCanvas) | 전략 5필드는 내부 (`:715 !isClient`) |

### 3.2 필드 화이트리스트 — 탭마다, 필드 단위

**원칙 (GUEST_LINK §5 그대로):** 전용 serializer 가 **나열한 키만** 담는다. 모델 `toJSON` 후 delete 금지. 여기 없는 필드는 안 나간다.
**추가 원칙 (이번 신설):** **보안등급 축이 없는 자유 텍스트는 1차에 내보내지 않는다.** 업무의 `description`·`body`(`Task.js:36,41`)가 그것이다 — 등급 컬럼이 없어 "걸리면 잠근다" 를 적용할 수 없으니 fail-closed 로 뺀다. 제목은 예외(정체성이고, 공개 업무 미리보기가 이미 내보낸다 `SHARE_PREVIEW_POLICY.md §2 Task`).

#### 개요 (`GET /api/guest/:token`, scope=project 일 때 `project` 객체)

| 필드 | 나감 | 근거 |
|---|:-:|---|
| `name`, `description`, `status`, `start_date`, `end_date` | ✅ | 지금과 같다 (`guest.js:88-94`) |
| `stages[]`: `kind`, `label`, `status` (order 순) | ✅ | Opus 신규 블록 유지 (`guest.js:103-111`). `linked_entity_id/type`·`metadata`·날짜 ❌ |
| `task_summary`: `total`, `completed` | ✅ | `guest.js:114-118` 유지 |
| `docs[]` | ❌ **뺀다** | 문서 탭 라우트로 옮긴다(§3.2 문서). 개요에 남기면 규칙이 두 벌 |
| `color`, `client_company`, `project_type`, `kind` | ❌ | 필요 없다. `client_company` 는 고객 자신이지만 카톡방의 제3자에게는 정보다 |
| `contract_amount`, `monthly_fee`, `billing_*`, `auto_invoice_*`, `strategy_*`, `success_metrics`, `owner_user_id`, `default_assignee_user_id`, `gdrive_folder_id` | ❌ | 재무·전략·내부 키 (`Project.js:18-64`) |
| 멤버 목록 | ❌ (1차) | `loadProjectDetail` 은 `User.email` 을 싣는다(`projects.js:3040`). 재사용 금지. 2차에 "담당 팀" 표시명만 검토 |

#### 업무 (`GET /api/guest/:token/tasks`)

| 필드 | 나감 | 근거 |
|---|:-:|---|
| `id` (카드 링크용), `title`, `status`, `progress_percent`, `start_date`, `due_date`, `completed_at`, `is_milestone`, `category` | ✅ | 앱 업무 목록 컬럼(`ProjectTaskList.tsx:655-667`: 업무·담당자·상태·진행률·기간·설명) 중 **설명을 뺀 것**. 공개 업무 미리보기와 정합(`SHARE_PREVIEW_POLICY.md §2`) |
| `assignee_name` — **워크스페이스 표시명만** (`applyMemberDisplayName`, `projects.js:2307`) | ✅ (**§12-Q3**) | 앱의 고객 화면·공개 미리보기 둘 다 담당자 이름을 보인다. `user_id`·`email` ❌ |
| `description`, `body` | ❌ | 등급 축 없는 자유 텍스트 (위 원칙). `client_share_custom/client_share_content`(`Task.js:127-132`) 로 고객용 본문을 따로 두는 구조가 이미 있으니 **업무 상세는 2차에 그 필드로** |
| `estimated_hours`, `actual_hours`, `actual_source` | ❌ | 공수 → 원가 (`Task.js:194-203`) |
| `requester`, `request_by_user_id`, `created_by`, `reviewers[]`, `review_*`, `requires_client_review` | ❌ | 내부 관계·컨펌 워크플로. 컨펌은 로그인 고객의 일 |
| `priority_*`, `workstream_id`, `planned_week_start`, `recurrence_*`, `hold_*`, `cue_*`, `source*`, `share_token` | ❌ | 내부 운영·토큰 |
| 댓글·이력·첨부 | ❌ | 라우트 없음 |
| 삭제(`deleted_at`)·`canceled` | 삭제 ❌ / canceled ✅ 표시 | 앱 목록과 같다. 정렬은 앱 기본(`created_at DESC`) |

#### 문서 (`GET /api/guest/:token/posts`, `GET /api/guest/:token/posts/:postId`)

목록 조건(서버): `project_id = P AND business_id = B AND deleted_at IS NULL AND status='published' AND vlevel IN ('L2','L3','L4')`.
`status` 규칙은 `shareOpenable.js:29` **같은 함수**(`shareOpenReason('post')`)로, 등급은 `securityLevel.js:16` **같은 함수**(`blocksExternalShare`)로 — 카드(`cardResolver.js:54-62`)와 판정이 갈리지 않게.

| 필드 | general | internal | confidential | 근거 |
|---|:-:|:-:|:-:|---|
| `id`, `title`, `category`, `updated_at` | ✅ | ✅ (**잠금 표시**) | ❌ — **건수만** (`locked_count`) | §4 |
| `author_name` (표시명) | ✅ | ❌ | ❌ | |
| 본문 (`content` 블록 → 뷰어) | ✅ (상세 라우트) | ❌ 404 | ❌ 404 | 상세 라우트는 `locked` 면 404 — "그 문서가 있다" 는 목록이 이미 말했고, 본문 존재 여부를 따로 흘릴 이유가 없다 |
| 첨부 | **L4 파일만** 다운로드 (`posts.js:1620-1628 isPublicFile` 같은 술어), 나머지는 이름+크기+"로그인 후 받기" | ❌ | ❌ | GUEST_LINK §5.1 "비이미지 첨부 로그인" 과 정합 |
| `share_token`, `share_password_hash`, `vlevel`, `security_level` 원값, `author_id`, `editor`, `translations`, `content_text` | ❌ | ❌ | ❌ | 화이트리스트 밖. `translations` 가 원문을 들고 나간 전례(CLAUDE.md 운영 정책) |
| `vlevel='L1'` 문서 | 행 자체 ❌ | | | 개인 문서는 프로젝트에 묶여 있어도 남의 것이다 |
| `draft` | 행 ❌ | | | `shareOpenReason` 이 `not_published` |

> **L2·L3 를 내보내는 이유 (§12-Q1 의 핵심):** 운영 posts 는 L2 34·L3 31·L1 4·**L4 0** (운영 DB 실측 2026-09-02). "이미 외부 공유된 것(L4)만" 이면 운영 문서 탭은 **빈 탭**이다. Irene 의 문장은 축을 **보안등급**으로 못 박았다("보안등급 걸리는 건 로그인"). 그래서 프로젝트 링크가 살아 있는 동안 그 프로젝트의 L2/L3 문서는 사실상 외부에 열린다. 이것이 어휘(L2=팀 비공개, `VISIBILITY_VOCABULARY.md:16`)와 어긋나는 지점이라 **Irene 결정 1번**으로 올린다. 승인되면 어휘 문서에 "프로젝트 외부 링크가 활성인 동안 그 프로젝트의 L2/L3 는 링크 소지자에게 열린다" 를 박제하고, 앱 프로젝트 헤더에 **globe 칩 "외부 링크 활성"** 을 띄워 멤버가 안다(§7.3).

#### 파일 (`GET /api/guest/:token/files`, `GET /api/guest/:token/files/:fileId/open`)

목록 조건: `project_id = P AND business_id = B AND deleted_at IS NULL AND vlevel IN ('L2','L3','L4')` (legacy `visibility` fallback 은 `access_scope.js:462` 와 같은 식).

| 필드 | general | internal | confidential |
|---|:-:|:-:|:-:|
| `id`, `file_name`, `file_size`, `mime_type`, `updated_at`, 폴더명(`file_folders.name`) | ✅ | ✅ 잠금 | ❌ 건수만 |
| `uploader_name` 표시명 | ✅ | ❌ | ❌ |
| 다운로드 | **L4 이면** `/open` 이 `/public/files/:share_token` 으로 302 (카드 open `guest.js:246-266` 과 같은 방식 — 응답에 토큰을 싣지 않는다). **L2/L3 는 "로그인 후 받기"** | ❌ | ❌ |
| `file_path`, `content_hash`, `external_url`, `storage_provider`, `share_token`, `uploader_id` | ❌ | ❌ | ❌ |

> 파일 **다운로드**를 L4 로 제한하는 이유: Irene 의 게스트 원안 "파일 다운로드만 로그인 유도"(GUEST_LINK §1)를 그대로 지킨다. 문서 본문은 열고 파일은 잠그는 비대칭은 의도다 — 문서는 읽는 것이고 파일은 반출이다.

#### 대화 (`GET /api/guest/:token/messages`, `POST …/messages`, 카드 open)

**무변경.** `visibleToGuest`(`guest.js:52-54`)·`serializeMessage`(`:57-72`) 그대로.

### 3.3 새지 않는 근거 — 항목별 한 줄

| 걱정 | 어디서 막히나 |
|---|---|
| 담당자 이메일 | 업무 serializer 는 `assignee_name` 문자열만. `User` include 의 `email` 을 애초에 attributes 에 넣지 않는다 |
| 공수·원가 | `estimated_hours/actual_hours` 키가 serializer 에 없다. 거래·보고서 탭은 라우트가 없다 |
| 내부 메모 | 업무 `description/body` 키 없음. 프로젝트 노트·이슈 라우트 없음. 대화 `is_internal` 은 `visibleToGuest` |
| 멤버 이메일 | `loadProjectDetail` 재사용 금지(`projects.js:3040` email include). 멤버 목록 라우트 없음 |
| 전략·재무 | 개요 serializer 5+2 필드만 |
| 다른 프로젝트·워크스페이스 | 모든 탭 라우트의 `project_id`·`business_id` 는 `req.guest.link` 에서만 온다. 파라미터에 없다 (GUEST_LINK §6.1 IDOR 구조) |
| 다른 대화방 | `conversation_id` 링크 row 고정 |

---

## 4. ② 보안등급 처리 — "자리는 보이고, 열면 로그인"

### 4.1 동작

Irene: "보안등급 걸리는 건 로그인 시키고." → **숨기지 않는다. 자리만 보이고 잠긴다.**

| `security_level` | 목록 | 열기 |
|---|---|---|
| `general` | 보통 행 | 열린다 |
| `internal` | 행 + 🔒 + 회색 "로그인하면 볼 수 있어요" | 누르면 §4.2 로그인 안내 |
| `confidential` | 행 없음. 목록 하단 한 줄 "보안 문서 N건 · 로그인 필요" | 없음 |

`internal` 과 `confidential` 을 가르는 이유는 `securityLevel.js:3-5` 의 정의 그대로다 — internal 은 "외부공유 차단", confidential 은 "일괄 export 도 관리자만". 제목이 곧 정보인 문서("M&A 검토안")는 confidential 로 올리면 제목도 안 나간다. 이 규칙은 **화면 문구로 한 줄** 보여준다(memory `feedback_rules_must_be_explained_briefly`): 잠긴 행의 회색 문장이 그 한 줄이다.

`vlevel` 은 게이트가 아니라 **필터**다: L1 은 행 자체가 없다(개인). 로그인해도 L1 은 고객이 못 본다 — 그러니 "로그인하면 볼 수 있어요" 라고 말하면 거짓이 된다. 잠금 문구는 오직 `security_level` 에만 붙는다.

### 4.2 로그인 안내 — 기존 부품으로

잠긴 항목을 누르면 화면 안 시트(팝업 위 팝업 금지) 한 장:

```
🔒 로그인이 필요한 자료예요
이 자료는 담당자가 보안 등급을 걸어 두었어요. 계정이 있으면 로그인해서 볼 수 있어요.
[로그인]   [계정 요청하기]
```

- **[로그인]** → `/login?next=/g/<token>?tab=docs&post=<id>`. 로그인 후 게스트 페이지로 **돌아온다**(앱으로 보내지 않는다 — 앱은 고객이 어디로 가야 할지 모른다).
- 돌아온 페이지가 토큰을 들고 있으면 `GET /api/guest/:token/auth-check` (**`authenticateToken` 필수**, `posts.js:1651-1664` 패턴 복제)를 부른다:
  ```
  { canAccess: boolean, appUrl: '/projects/<id>?tab=docs&post=<postId>' | null }
  ```
  판정 = `loadProjectOrForbidden(project.id, req.user.id)` (`projects.js:40-52`) 가 `role` 을 주면 true. **게스트 라우트 안에서 유일하게 인증이 필요한 라우트**라 `guest.js` 가 아니라 `guest_admin.js` 옆의 새 파일 `routes/guest_auth.js` 에 둔다 — "한 파일에 인증·무인증이 섞이면 다음 사람이 어느 라우트가 공개인지 못 본다"(`guest_admin.js:3-5`).
- `canAccess=true` 면 잠긴 행이 **"앱에서 열기"** 버튼으로 바뀐다. 자동 리다이렉트는 하지 않는다 — N+72-3 "로그인했어도 따로 보이는게 맞다"(`PublicPostPage.tsx:55`). 페이지 상단에도 "PlanQ 에 로그인되어 있어요 · [앱에서 이 프로젝트 열기]" 한 줄.
- `canAccess=false` (로그인은 했는데 이 프로젝트 고객이 아님) → 잠긴 행 그대로 + "이 프로젝트에 초대된 계정이 아니에요. 담당자에게 계정 요청을 보내세요."
- **[계정 요청하기]** → 기존 `POST /api/guest/:token/account-request` (`guest.js:194-240`). 가입 화면으로 보내지 않는 이유는 그 라우트 주석 그대로(`auth.js:216` 새 워크스페이스 생성 사고).

**Smart Routing 은 이 페이지에서 2단(auth-check + "앱에서 열기")까지만.** `OpenInAppBanner` 는 `/g/` 를 일부러 제외하고 있다(`OpenInAppBanner.tsx` `isPublicRoute` 정규식 `^\/(public|invite|sign)\/`) — 게스트 표면은 PlanQ 안내를 띄우지 않는다는 원칙(`App.tsx:205` `isGuestSurface`). 유지.

### 4.3 파일 다운로드도 같은 시트

L2/L3 파일의 "로그인 후 받기" 는 §4.2 시트와 **같은 컴포넌트**. 문구만 "이 파일은 로그인 후 받을 수 있어요".

---

## 5. ④ 읽기/쓰기 — 열람 + 대화 탭 문의

**결론: 프로젝트 링크의 쓰기는 대화 탭의 텍스트 메시지뿐. 지금 게스트와 같다.**

- 업무·문서·파일은 **읽기 전용.** 컨펌(`requires_client_review`)·댓글·업로드 라우트 없음.
- 대화 탭은 `can_write` 그대로(`guest.js:274`, `GuestLink.js:48`). 발급 모달에 **"문의 허용" 토글**(기본 켬)을 노출한다 — API 는 이미 `can_write` 를 받는다(`guest_admin.js:98`), 화면만 없었다.
- 열람 전용 링크(`can_write=false`)면 대화 탭은 읽기 + 하단 "읽기 전용 링크입니다" (`GuestConversationPage.tsx:410` 그대로).

프로젝트 링크가 채팅 링크보다 **보이는 것이 많은데 쓰기 기본값을 같게 두는 이유**: 쓰기 상한은 "고객 채널에 4,000자 텍스트" 로 이미 고정돼 있고(`guest.js:277-283`), 프로젝트 링크의 위험 증분은 **읽기**에서 온다. 읽기 증분은 §3·§6 에서 막는다.

---

## 6. ⑥ 위협 모델 — 채팅 링크 대비 무엇이 달라지나

GUEST_LINK §2 의 전제는 그대로다: **링크를 아는 사람 = 그 고객이라는 보장이 없다. 유출을 막는 것이 아니라 열리는 것의 상한을 구조로 고정한다.**

### 6.1 토큰 하나로 새로 열리는 것 (scope=project 증분)

| 새로 열림 | 상한 |
|---|---|
| 업무 제목·상태·진행률·기간·담당자 표시명·마일스톤 (그 프로젝트 전부) | 설명·본문·공수·요청자·컨펌·댓글 ❌. 앱 고객 화면·공개 업무 미리보기가 이미 내보내는 집합의 부분집합 |
| `general` 문서 본문 (L2/L3/L4, published) | `internal` 제목만, `confidential` 건수만, L1·draft 행 없음 |
| 파일 이름·크기·종류 | 다운로드는 L4 만. `internal` 이름만, `confidential` 건수만 |
| 거래 **단계 라벨**(견적→계약→청구…) | 금액·회차·서명자 ❌ |

**채팅 링크(scope=conversation)는 변하지 않는다** — 이 문서 배포로 기존 링크가 넓어지지 않는다(§2.2).

### 6.2 위협별

| 위협 | 대응 | 채팅 링크와 같은가 |
|---|---|---|
| 토큰 추측 | 32바이트 random·해시 저장·일률 404 (`guest_link.js:15-20,28-32`) | 같다 |
| 회수·만료·킬스위치 | `resolveGuestToken` 단일 착지점(`:26-73`) — 탭 라우트도 전부 `attachGuest` 뒤. 플랫폼·워크스페이스 2단 킬스위치(`:40-43`)·회수(`:31`)·90일 슬라이딩(`:32,62-66`) 그대로 | 같다 |
| 무인증 탐색(스크래핑) | 탭 라우트 토큰당 rate-limit: `tasks` 30/분, `posts` 30/분, `posts/:id` 60/분, `files` 30/분, `files/:id/open` 30/분, `auth-check` 30/분 (`guestLimiter` `guest.js:26-33` 재사용). 목록 `limit` 200 고정, 페이지네이션은 2차 | 새 라우트 |
| 링크 유출 시 문서 반출 | 문서 본문은 HTML 로 나가지만 첨부·파일은 L4 외 잠금. 확산 뒤 회수 1클릭 | **넓다** — 이것이 프로젝트 링크의 본질적 트레이드오프. Irene 이 "그냥 공유" 라고 수용한 전제 |
| OG 크롤러 유출 | `ogMeta.js:287-369` 에 `/g/` 케이스가 없어 **기본 OG(브랜드·태그라인) + `noindex`(`:258,:366`)** 로 떨어진다 — 프로젝트명·문서명은 OG 에 실리지 않는다(GUEST_LINK §9.4 그대로). 그대로 둔다. 실측 확인 항목(§10) | 같다 |
| 검색·AI 학습 크롤러 | `robots.txt` 의 GPTBot/Google-Extended/ClaudeBot `Disallow` 목록에 **`/g/` 가 없다**(`dev-frontend/public/robots.txt`) — 지금까지는 채팅만이라 넘어갔지만 문서 본문이 나가면 학습 코퍼스가 된다. **`Disallow: /g/` 3곳 추가** (색인은 X-Robots-Tag 가 막고, 이건 학습 편입만) | **보강 필요** |
| XSS (문서 본문) | 게스트 문서 뷰어는 `PublicPostPage` 와 **같은 블록 렌더러·같은 DOMPurify 설정**을 쓴다(사본 금지 — memory `feedback_copied_component_drifts_extract_shell`). 서버는 저장된 블록 JSON 을 그대로 주고 정화는 뷰어 한 곳 | 새 표면 |
| 인라인 이미지(문서 본문 안 `image` 블록) | `[미확인]` — PublicPostPage 가 이미지 블록을 어떤 경로로 그리는지 이번에 열지 못했다. 구현 게이트에서 실측: 인증 경로면 게스트에게 깨진 이미지가 뜬다 → 그 자리에 "로그인 후 보기" 로 떨어뜨릴 것. 조용히 깨진 채 두지 않는다 |  |
| 이미지 쿠키 | `setImageCookie`(`guest.js:80`) 는 대화 이미지용 — 문서 이미지에도 같은 문이면 그대로 통과. 위 실측과 같이 확인 |  |
| 로그 잔존 | 토큰이 URL 에 실려 nginx access log 에 남는다 — 기존과 같다 | 같다 |

### 6.3 막지 못하는 것 (정직하게)

- 카톡방의 제3자가 업무 제목·진행률·general 문서를 본다. 상한은 "그 프로젝트의 고객이 앱에서 보는 것보다 적게".
- 문서 본문을 복사해 나가는 것. 화면에 뜬 것은 막을 수 없다. 그래서 등급을 걸 수 있는 자료만 열고, 걸 수 없는 자유 텍스트(업무 설명·본문)는 1차에 안 연다.

---

## 7. ⑤ 화면 설계 (텍스트 와이어)

### 7.1 게스트 페이지 `/g/:token` — scope=project

**라우팅·상태 (무인증):**
- 진입 시 `GET /api/guest/:token` 1회 → `ctx` (`scope`, `project`, `conversation`, `can_write`, `account_requested`). 404 → 만료 화면(지금과 같다).
- 탭은 `?tab=overview|tasks|docs|files|chat` (기본 `overview`). `useSearchParams` 로 싱크 — 뒤로가기·공유·새로고침이 탭을 지킨다(CLAUDE.md "드로어 URL 싱크" 와 같은 규칙, 단수형 쿼리).
- 문서 본문은 `?tab=docs&post=<id>`. 잠긴 문서는 `post=` 가 와도 시트만.
- 탭 데이터는 **탭이 처음 열릴 때** 1회 요청, 페이지 안 캐시. 대화 탭만 폴링(지금 `GuestConversationPage.tsx:108` 의 interval) — **대화 탭이 활성일 때만** 돈다. 다른 탭에 있다가 돌아오면 즉시 1회 재요청.
- 로그인 토큰이 브라우저에 있으면(`getAccessToken()`) `auth-check` 1회 → 상단 한 줄 + 잠긴 행 버튼 교체 (§4.2).
- 워크스페이스 chrome 은 지금처럼 전부 숨김(`publicSurface.ts:22 '/g/'`).

**데스크탑 (≥1025px):**

```
┌──────────────────────────────────────────────────────────────────────┐
│ 워프로랩                                            [로그인되어 있어요 · 앱에서 열기] │  ← auth-check true 일 때만 우측
│ 홈페이지 리뉴얼                                                          │  18px/700 (PanelHeader 규격 60px)
│ 진행 중 · 2026-08-01 ~ 2026-10-31                                        │  13px 회색
├──────────────────────────────────────────────────────────────────────┤
│  개요   업무 12   문서 5   파일 8   대화 ●                                │  ← 탭바. 숫자는 ctx 의 count. 대화 ● = 안 읽음(2차)
├──────────────────────────────────────────────────────────────────────┤
│ [개요]                                                                  │
│  설명 문단 (project.description, pre-wrap)                               │
│  진행 단계   (견적 ✓) (계약 ✓) (청구 ●진행) (세금계산서 ·)                    │  ← StageChip 그대로 (`GuestConversationPage.tsx:444-449`)
│  업무 진행   7 / 12 완료  ▓▓▓▓▓▓▓░░░░░ 58%                                │
│  ─────────────────────────────────────────                              │
│  아래 대화 탭에서 담당자에게 바로 문의할 수 있어요.                            │
└──────────────────────────────────────────────────────────────────────┘
```

```
│ [업무]                                                                  │
│  업무                          담당자     상태      진행률    기간          │  ← 앱 열 순서 그대로, 설명 열만 없음
│  ◆ 디자인 시안 확정              루아      완료      100%   08/05~08/12   │  ◆ = 마일스톤
│    메인 페이지 퍼블리싱            이나      진행 중    60%   08/13~08/30   │
│    …                                                                    │
│  (행 클릭 없음 — 1차는 목록. 2차에 상세 시트)                                │
```

```
│ [문서]                                                                  │
│  📄 홈페이지 리뉴얼 제안서        제안    08-20    루아                    │  → 클릭: 본문 뷰
│  📄 1차 시안 검토 요청            보고    08-25    이나                    │
│  🔒 개발 범위 내부 검토           기획    08-27    로그인하면 볼 수 있어요    │  ← internal
│  ────────────────────────                                               │
│  보안 문서 1건 · 로그인 필요                                              │  ← confidential 건수
│                                                                         │
│  [문서 본문 뷰 — ?post=id]                                                │
│  ← 문서 목록                                                            │
│  홈페이지 리뉴얼 제안서                                    제안 · 08-20    │
│  (PublicPostPage 와 같은 블록 렌더러)                                       │
│  첨부  📎 제안서_v3.pdf 2.1MB  [받기]      📎 견적내역.xlsx 40KB  로그인 후 받기 │  ← L4 만 [받기]
```

```
│ [파일]                                                                  │
│  📁 시안                                                                 │
│    🖼 main_v2.png      1.2MB   08-25   루아      로그인 후 받기            │
│    📎 style-guide.pdf  3.4MB   08-20   이나      [받기]                   │  ← L4
│  🔒 계약 관련           —      08-27   —         로그인하면 볼 수 있어요    │  ← internal (이름만)
│  보안 파일 2건 · 로그인 필요                                               │
```

```
│ [대화]   — 지금의 GuestConversationPage 본문·입력줄 그대로 (`:325-411`)     │
│  (계정 요청 배너도 여기 한 곳에만. 다른 탭에는 안 띄운다 — 읽으러 온 사람을 막지 않는다) │
```

**폰 (≤640px):**

```
┌────────────────────────┐
│ 워프로랩                │
│ 홈페이지 리뉴얼          │
│ 진행 중 · 08-01~10-31   │
├────────────────────────┤
│ 개요 업무 문서 파일 대화 │  ← 가로 스크롤 탭바, 활성 탭 자동 스크롤인
├────────────────────────┤
│ (탭 본문 — 세로 스크롤)  │
│                        │
│ [업무] 행은 2줄 카드:   │
│  ◆ 디자인 시안 확정      │
│    완료 100% · 루아 · ~08/12 │
│                        │
│ [대화] 는 지금과 같이    │
│  100dvh 안에서 입력줄   │
│  하단 고정 (`Wrap` `:416`) │
│  + 키보드 up 계약        │
└────────────────────────┘
```

- 대화 탭만 `height:100dvh` 컬럼 레이아웃(입력줄 고정). 나머지 탭은 문서 흐름.
- 잠금 시트(§4.2)는 바텀시트(FilePicker 패턴 75vh, safe-area).
- 터치 타겟 40×40. 고정 px 폭 금지, `mediaPhone` 토큰.
- `data-testid`: `guest-tab-{key}`, `guest-doc-open`, `guest-file-get`, `guest-locked-row`, `guest-login-sheet`, `guest-open-in-app`.
- 접근성: 탭바 `role="tablist"`, 시트 `role="dialog" aria-modal="true"` + 3훅(`useBodyScrollLock/useEscapeStack/useFocusTrap`).

**컴포넌트 구조 (파일 800줄 규칙):**
- `pages/Guest/GuestPage.tsx` — ctx 로드 + `scope` 분기 (얇다)
- `pages/Guest/GuestConversationPage.tsx` — 지금 파일. **채팅 본문·입력줄을 `GuestChatPanel.tsx` 로 뽑아** scope=conversation 화면과 프로젝트 "대화" 탭이 **같은 컴포넌트**를 쓴다. 코드 이동이므로 성공 경로(메시지 전송→DB 행→멤버 화면) 를 다시 태운다(memory `feedback_code_move_needs_success_path`)
- `pages/Guest/GuestProjectPage.tsx` — 헤더·탭바·탭 스위치
- `pages/Guest/tabs/{Overview,Tasks,Docs,Files}Tab.tsx`
- `pages/Guest/LoginRequiredSheet.tsx`
- 문서 뷰어: `PublicPostPage` 의 블록 렌더러를 **공유 컴포넌트로 추출**해 양쪽이 쓴다 `[추출 대상 파일 미확인 — 구현 시 PublicPostPage 안의 렌더 부분을 열어 결정]`

### 7.2 멤버 화면 — 프로젝트 헤더의 링크 아이콘

Irene: "링크 아이콘으로" (텍스트 버튼 말고).

```
프로젝트 헤더 우측:  [프로젝트 채팅] [프로젝트 메일] [🔗] [← 목록]
```

- `[🔗]` = 36×36 아이콘 버튼, `GuestLinkButton.tsx` 의 `TriggerBtn` 링크 svg 그대로(`:98-108`). `aria-label`/`title` = "외부 열람 링크". `data-testid="project-share-link"` 유지.
- 활성 링크가 1개 이상이면 아이콘 우상단 작은 점(teal). 그러면 멤버가 "이 프로젝트는 밖에 열려 있다" 를 안다 — L2/L3 문서가 외부에 보이는 상태의 **시각 시그널**(memory `feedback_visibility_signal_required`).
- 고객(client)에게는 아이콘 없음(지금 `:685 !isClient`), 서버도 403.

**모달 — "외부 열람 링크" (StandardModal md, 기존 게스트 링크 모달과 같은 껍데기):**

```
외부 열람 링크                                                 ×
로그인 없이 이 프로젝트의 진행 상황·업무·문서·대화를 볼 수 있는 링크입니다.
카톡·메일로 보내세요. 보안 등급이 걸린 자료는 로그인해야 열립니다.
대화 탭 = "홈페이지 리뉴얼 고객" 채널

[ ] 문의 허용 (링크 받은 분이 대화 탭에 글을 쓸 수 있어요)    ← 기본 켬
[ + 새 링크 만들기 ]

방금 만든 링크
https://dev.planq.kr/g/AbC…                 [복사] [공유]      ← 원문은 지금뿐 (guest_admin.js:110-111)

이 프로젝트의 링크 2
🔗 AbCdEf…  만든 날 08-30 · 마지막 사용 09-01 · 메시지 3      [회수]
🔗 XyZ123…  만든 날 08-15 · 사용 없음                         [회수]
```

- 컴포넌트: `GuestLinkButton.tsx` 를 **`GuestLinkModal` 로 일반화**한다 — `adapter: { list(), issue(body), revoke(id), lead: string, subject: string }` 를 받아 QTalk(대화방 스코프)과 프로젝트 헤더(프로젝트 스코프)가 **한 모달**을 쓴다. 지금의 `autoOpen`/`onClosed` 땜질(미커밋 diff)은 이 일반화로 흡수. 베끼면 갈라진다(운영 알림/새 소식 드롭다운 전례).
- 회수한 링크는 목록에서 즉시 사라지고, 게스트는 다음 요청부터 404·만료 화면.

### 7.3 앱 안 시각 시그널 (승인 조건, §12-Q1 에 딸림)

프로젝트 헤더 제목 옆 globe 칩 **"외부 링크 활성"** (활성 링크 ≥1). 문서·파일 목록 행에는 표시하지 않는다(행마다 붙이면 시끄럽고, 프로젝트 단위 사실이다).

### 7.4 ko / en 문구

`guest` 네임스페이스에 `proj.*` 추가, `qproject` 에 `share.*` 교체. 아래가 전부(설계 단계에서 양쪽 확정 — CLAUDE.md i18n 규칙).

| 키 | ko | en |
|---|---|---|
| guest:proj.tab.overview | 개요 | Overview |
| guest:proj.tab.tasks | 업무 | Tasks |
| guest:proj.tab.docs | 문서 | Docs |
| guest:proj.tab.files | 파일 | Files |
| guest:proj.tab.chat | 대화 | Chat |
| guest:proj.stages | 진행 단계 | Progress |
| guest:proj.stagesEmpty | 아직 등록된 단계가 없어요. | No stages yet. |
| guest:proj.tasks | 업무 진행 | Task progress |
| guest:proj.taskCount | {{done}} / {{total}} 완료 | {{done}} / {{total}} done |
| guest:proj.tasksEmpty | 아직 등록된 업무가 없어요. | No tasks yet. |
| guest:proj.chatHint | 대화 탭에서 담당자에게 바로 문의할 수 있어요. | Use the Chat tab to reach the team directly. |
| guest:proj.col.task | 업무 | Task |
| guest:proj.col.assignee | 담당자 | Assignee |
| guest:proj.col.status | 상태 | Status |
| guest:proj.col.progress | 진행률 | Progress |
| guest:proj.col.dates | 기간 | Dates |
| guest:proj.milestone | 마일스톤 | Milestone |
| guest:proj.docsEmpty | 공유된 문서가 아직 없어요. | No documents yet. |
| guest:proj.filesEmpty | 공유된 파일이 아직 없어요. | No files yet. |
| guest:proj.locked | 로그인하면 볼 수 있어요 | Sign in to view |
| guest:proj.lockedCountDocs | 보안 문서 {{n}}건 · 로그인 필요 | {{n}} restricted document(s) · sign in required |
| guest:proj.lockedCountFiles | 보안 파일 {{n}}건 · 로그인 필요 | {{n}} restricted file(s) · sign in required |
| guest:proj.get | 받기 | Download |
| guest:proj.getLogin | 로그인 후 받기 | Sign in to download |
| guest:proj.backToDocs | 문서 목록 | All documents |
| guest:proj.attachments | 첨부 | Attachments |
| guest:proj.untitled | 제목 없음 | Untitled |
| guest:login.title | 로그인이 필요한 자료예요 | Sign in to view this |
| guest:login.body | 담당자가 보안 등급을 걸어 둔 자료예요. 계정이 있으면 로그인해서 볼 수 있어요. | The team restricted this item. Sign in with your account to view it. |
| guest:login.fileBody | 이 파일은 로그인 후 받을 수 있어요. | Sign in to download this file. |
| guest:login.cta | 로그인 | Sign in |
| guest:login.request | 계정 요청하기 | Request an account |
| guest:login.notInvited | 이 프로젝트에 초대된 계정이 아니에요. 담당자에게 계정 요청을 보내세요. | This account isn't on this project. Ask the team to invite you. |
| guest:signedIn.lead | PlanQ 에 로그인되어 있어요 | You're signed in to PlanQ |
| guest:signedIn.open | 앱에서 이 프로젝트 열기 | Open in app |
| guest:acct.leadProject | 이 링크로는 진행 상황·업무·문서·대화를 볼 수 있어요. 보안 자료까지 보려면 계정이 필요해요. | This link shows progress, tasks, docs and chat. Restricted items need an account. |
| qproject:share.title | 외부 열람 링크 | External view link |
| qproject:share.lead | 로그인 없이 이 프로젝트의 진행 상황·업무·문서·대화를 볼 수 있는 링크입니다. 카톡·메일로 보내세요. 보안 등급이 걸린 자료는 로그인해야 열립니다. | Anyone with this link can see progress, tasks, docs and chat without signing in. Restricted items still require sign-in. |
| qproject:share.chatChannel | 대화 탭 = {{name}} | Chat tab = {{name}} |
| qproject:share.allowWrite | 문의 허용 | Allow messages |
| qproject:share.allowWriteHint | 링크 받은 분이 대화 탭에 글을 쓸 수 있어요 | Link holders can post in the Chat tab |
| qproject:share.create | 새 링크 만들기 | Create link |
| qproject:share.fresh | 방금 만든 링크 | New link |
| qproject:share.list | 이 프로젝트의 링크 {{n}} | Links for this project ({{n}}) |
| qproject:share.active | 외부 링크 활성 | External link active |
| qproject:share.errForbidden | 이 프로젝트의 링크를 만들 권한이 없습니다. | You can't create links for this project. |
| qproject:share.errDisabled | 게스트 링크 기능이 꺼져 있습니다. 관리자에게 문의해 주세요. | Guest links are turned off. Contact an admin. |
| qproject:share.errGeneric | 링크를 만들지 못했습니다. 잠시 후 다시 시도해 주세요. | Couldn't create the link. Try again shortly. |

기존 `guest:ov.*`·`qproject:share.preparing/errGeneric`(미커밋)은 위로 대체. `acct.lead`(채팅 링크용 "이 대화만 볼 수 있어요") 는 그대로 — scope=conversation 에서 다시 참이 된다(§9).

---

## 8. ⑦ 절단면 — 세 사이클, 각각 그 자체로 쓸모

| 사이클 | 넣는 것 | 그 자체로 쓸모 | 게이트 |
|---|---|---|---|
| **1차 — 틀 + 개요 + 업무 + 대화** | `scope` 컬럼·모델·마이그레이션 스크립트 / 발급·목록·회수 라우트(프로젝트 스코프) / `ensureProjectCustomerChannel` 서비스 / `GET /guest/:token` scope 분기 / `GET /guest/:token/tasks` / `GuestPage` 분기 + `GuestProjectPage` (개요·업무·대화 3탭, 문서·파일 탭은 **탭 자체 없음**) / `GuestChatPanel` 추출 / 링크 아이콘 + 일반화 모달 / Opus 미커밋분 정리(§9) / robots.txt `/g/` | 고객이 링크 하나로 **진행 단계·업무 목록·진행률을 보고 문의**한다. 문서는 아직 카드(대화)로 공유. 무인증으로 새로 나가는 것은 업무 제목·상태·담당자 표시명뿐 | 설계(이 문서)·구현·배포 3단 Fable. 운영 ALTER 1줄 |
| **2차 — 문서 + 파일 + 보안등급 잠금 + auth-check** | `posts`/`posts/:id`/`files`/`files/:id/open` 라우트 / 블록 렌더러 추출 / 잠금 행·건수·시트 / `guest_auth.js auth-check` / "앱에서 열기" / 헤더 globe 칩 | "보안등급 걸리는 건 로그인, 나머지는 그냥" 이 실제로 작동. **Irene Q1 승인 뒤** | 무인증 문서 본문 = 별도 Fable 게이트(양성·음성 대조군 필수 §10) |
| **3차 — 상세·미리보기·편의** | 업무 상세 시트(`client_share_content` 우선, 없으면 제목만) / 이미지 파일 인라인 미리보기 / 대화 탭 안 읽음 점 / 고객 채널 여러 개일 때 방 선택 / 목록 페이지네이션 / 알림 메일에 프로젝트 링크 동봉 | 앱 고객 화면에 더 가까워진다 | 각 항목 소·중 |

1차를 문서 없이 내는 이유: 업무 목록은 **등급 축이 없어 잠글 것이 없고** 자유 텍스트를 안 내보내니 위험 증분이 제목·표시명뿐이다. 문서 본문은 무인증 HTML 이 처음 나가는 지점이라 따로 게이트를 통과시키는 것이 맞다.

---

## 9. ⑧ 지금 있는 것 — 살릴 것과 되돌릴 것

미커밋 변경 10파일 + 신규 1파일(`git status` 실측). **`git checkout` 으로 되돌리지 않는다**(memory) — 아래대로 Opus 가 편집으로 정리한다.

| 있는 것 | 판정 | 어떻게 |
|---|---|---|
| `POST /api/projects/:id/guest-channel` (`projects.js:688-750` 미커밋) | **API 로는 되돌린다. 본문은 살린다.** | 라우트를 지우고 본문을 `services/project_channel.js :: ensureProjectCustomerChannel(project, userId)` 로 옮긴다. 새 `POST /api/projects/:id/guest-links` 가 내부에서 부른다. "채널 찾기" 를 화면이 부르는 API 로 두었기 때문에 버튼이 **채팅 링크 버튼**이 됐다 — 화면은 "링크를 만든다" 만 알면 된다 |
| `guest.js:96-143` 개요 확장(단계·업무 숫자·문서 목록) | **단계·업무 숫자는 살린다(scope=project 일 때만). 문서 목록은 뺀다.** | `if (link.scope === 'project')` 안으로 옮기고 `project.docs` 블록 삭제(2차 문서 탭 라우트로). scope=conversation 은 5필드로 복귀 — 채팅 링크 화면·문구가 다시 참이 된다 |
| `ProjectShareLinkButton.tsx` (신규, 텍스트 버튼 + `guest-channel` 호출) | **다시 쓴다.** | 링크 아이콘 버튼 + `GuestLinkModal` 프로젝트 어댑터. `guest-channel` 호출 제거 |
| `GuestLinkButton.tsx` 의 `autoOpen/onClosed` 땜질 | **되돌리고 일반화로 흡수.** | `GuestLinkModal` 로 분리, QTalk 쪽은 어댑터만 바꿔 무변경 동작 |
| `GuestConversationPage.tsx` 정보 띠(`:243-292`) + `GuestCtx` 확장(`:29-36`) | **띠는 뺀다. 타입은 옮긴다.** | 띠의 StageChip·Bar 는 `tabs/OverviewTab.tsx` 로 이동. 채팅 화면은 헤더 아래 **프로젝트 이름 한 줄**만(원래대로) |
| `guest.json` `ov.*`·`acct.leadProject`, `qproject.json` `share.*` | **키 교체** | §7.4 표대로. `ov.*` 삭제, `acct.leadProject` 문구 교체 |
| `QProjectDetailPage.tsx:685-687` 버튼 자리 | **자리는 살린다.** | 아이콘 컴포넌트로 교체 |
| `QTalkPage.tsx` `withLoadTimeout` (무한 스피너 수정) | **이 건과 무관 — 그대로 둔다.** | 별도 커밋으로 먼저 분리 커밋 권장 |

정리 뒤 커밋은 두 개: ① QTalk 타임아웃(무관) ② 프로젝트 외부 열람 1차.

---

## 10. 구현 게이트에서 Fable 이 실측할 것 (1차·2차 공통)

| 리스크 | 검증 (실 HTTP · 양성/음성 대조군) |
|---|---|
| 화이트리스트 누수 | 각 게스트 라우트 응답 JSON **전 키 스냅샷**을 §3.2 표와 대조. `email`·`estimated`·`actual`·`body`·`description`·`share_token`·`grand_total` 문자열 grep 0건 |
| scope 파생 열쇠 | scope=conversation 토큰으로 `/tasks`·`/posts`·`/files` → **404**(양성). scope=project 토큰 → 200(음성). 같은 프로젝트·같은 방이어도 갈린다 |
| 기존 링크 불변 | 배포 전후 운영 채팅 링크 1건의 `GET /api/guest/:token` 응답 키 diff **0** |
| 보안등급 (2차) | 프로젝트에 general·internal·confidential·L1·draft 문서 5건 심기 → 목록 행 3(general 열림, internal 잠금, L1·draft 없음) + `locked_count=1`. `posts/:id` 는 general 200 / internal·confidential·L1·draft **전부 404** |
| 파일 다운로드 (2차) | L4 general → 302 Location `/public/files/…`; L2 general → 404; internal → 404 |
| auth-check (2차) | 무토큰 401 / 무관 사용자 `canAccess:false` / 프로젝트 고객·멤버 `true` + `appUrl` 라우트 실존(memory `feedback_notify_link_must_match_route`) |
| 회수·킬스위치 | 회수 → 5개 라우트 전부 404. `platform_settings.guest_links_enabled=0` → 전부 404, 되돌리면 200 |
| rate-limit | `/tasks` 31회째 429 (가드는 깨뜨려 확인) |
| OG·noindex | `curl -A Kakaotalk-scrap /g/<token>` → 프로젝트명 **없음** + `X-Robots-Tag: noindex`. robots.txt 에 `/g/` 3줄 |
| 코드 이동 성공 경로 | `GuestChatPanel` 추출 뒤 게스트 메시지 전송 → `messages` 행 + 멤버 QTalk 소켓 수신 + push_logs ≥1 (CLAUDE.md 13번 패턴) |
| 화면 | 폰 390px 에서 탭 5개 스크롤·대화 탭 입력줄 가림 없음(하니스 `--suite mobile`), 잠긴 행이 **"안 눌린다"** 가 아니라 시트를 띄우는지, 상태값 미지정(`skipped` 단계·`canceled` 업무)이 기본값으로 떨어지지 않는지(CLAUDE.md 상태값 규약) |
| 가드 | `node scripts/health-check.js`, `npm run build` 실 exit 0, `guard-invariants --category=i18n,parity` |
| 운영 마이그레이션 | ALTER 멱등 스크립트 2회 실행 무해, 롤백 = 코드 롤백만(컬럼 잔존 무해) |

---

## 11. 근거 코드 인덱스

| 무엇 | 위치 |
|---|---|
| 게스트 링크 모델 (`conversation_id` NOT NULL, `project_id`, `can_write`) | `dev-backend/models/GuestLink.js:30,34,48` · dev DB `SHOW COLUMNS` 실측 |
| 해석기 단일 착지점·킬스위치·대화방 필수·슬라이딩 | `dev-backend/services/guest_link.js:26-73` (`:40-43` 킬스위치, `:45-47` 대화방, `:62-66` 슬라이딩) · 발급 `:114-141` |
| 공개 라우트·rate-limit·화이트리스트·Opus 신규 블록 | `dev-backend/routes/guest.js:26-33, 52-72, 75-159 (88-94 / 96-143), 162, 194, 246-266, 271-283` |
| 관리 라우트 (고객 채널만·보관 차단·킬스위치·`projectId: conv.project_id`) | `dev-backend/routes/guest_admin.js:31, 47, 65-80, 95, 110-111, 117` |
| 미커밋 `guest-channel` | `dev-backend/routes/projects.js:688-750` (git diff) |
| 프로젝트 접근·상세·업무·거래·이력 | `routes/projects.js:40-52, 337-366, 2285-2310, 2100-2160, 380-384, 3033-3048` |
| 탭·고객 숨김·기본 탭·헤더 버튼 | `dev-frontend/src/pages/QProject/QProjectDetailPage.tsx:147, 149, 237-245, 655-690, 695-701, 715, 727, 737, 1121-1126, 1237-1239` |
| 업무 목록 열 | `pages/QProject/ProjectTaskList.tsx:655-667` |
| Task 컬럼 | `models/Task.js:36, 41, 45, 123-132, 194-203, 208, 226, 278` |
| Post/File 등급·레벨 | `models/Post.js:20, 23, 48, 62-66` · `models/File.js:144-150` · `services/securityLevel.js:16-19` · `services/shareOpenable.js:29, 45-52` |
| 고객 술어 | `middleware/access_scope.js:298-309, 425-433` · `routes/posts.js:219-224, 1620-1628, 1651-1664` · `routes/kb.js:186` |
| 카드 해석(같은 술어 재사용) | `services/cardResolver.js:54-64` |
| OG·noindex·robots | `middleware/ogMeta.js:258, 287-369` · `dev-frontend/public/robots.txt` · nginx `location /` `$planq_share_bot` |
| 공개 표면·게스트 표면 | `src/utils/publicSurface.ts:22` · `src/App.tsx:205, 592` · `components/Common/OpenInAppBanner.tsx` |
| 게스트 화면 | `pages/Guest/GuestConversationPage.tsx:26-37, 108, 239-292, 325-411, 416` · `components/QTalk/GuestLinkButton.tsx:20-95` · `pages/QProject/ProjectShareLinkButton.tsx` |
| 정책 문서 | `docs/GUEST_LINK_DESIGN.md §2, §5, §6, §11` · `docs/SHARE_PREVIEW_POLICY.md §1-2` · `docs/PERMISSION_MATRIX.md §7-8` · `docs/VISIBILITY_VOCABULARY.md:16` |
| DB 실측 (2026-09-02) | dev: guest_links 10(project 3, 활성 5) · projects 34 · 고객채널 25 · posts L4 1 · files L4 0 / 운영: guest_links 1(project 1, 활성 1) · posts L2 34·L3 31·L1 4·internal 1·**L4 0** · files L4 0 |

---

## 12. Irene 결정 — **2026-09-04 세 건 모두 제안대로 확정**

> Irene: "제안대로 ㄱ"
>
> - **Q1 = 보안등급 축.** 프로젝트 링크가 살아 있는 동안 그 프로젝트의 L2/L3 문서가
>   링크 소지자에게 열린다. 대가(L2 "팀 비공개" 배지가 반쪽 진실이 되는 것)는
>   **헤더 globe 칩 + 어휘 문서 박제**로 보완한다 — 이 둘은 2차의 **필수 항목**이지
>   선택이 아니다. 한 번 나간 문서는 되돌릴 수 없으므로 칩 없이 2차를 내지 않는다.
> - **Q2 = 멤버 이상.** 채팅 링크와 같은 권한(`assertMemberOrAbove`) + 감사 로그.
> - **Q3 = 담당자 표시명 보인다.** 워크스페이스 표시명만. 이메일·id 는 나가지 않는다.

### 원문 (판단 근거 보존)

**Q1. 문서·파일을 여는 축 — 보안등급(제안) vs L4 만**
제안: `security_level` 이 게이트(general 열림 / internal 제목만 / confidential 건수만), `vlevel` 은 L1 만 제외. 즉 **프로젝트 링크가 살아 있는 동안 그 프로젝트의 팀(L2)·워크스페이스(L3) 문서가 링크 소지자에게 열린다.** 근거: 운영에 L4 문서가 0건이라 "L4 만" 은 빈 탭이고, Irene 의 문장이 축을 보안등급으로 못 박았다. 대가: L2 "팀 비공개" 배지가 프로젝트 링크 활성 중에는 반쪽 진실이 된다 → 헤더 globe 칩 + 어휘 문서 박제로 보완. **승인하면 2차 착수, 아니면 2차 문서 탭은 L4 만(그리고 문서를 L4 로 올리는 동선을 먼저 만든다).**

**Q2. 프로젝트 링크 발급 권한 — 멤버 이상(제안) vs owner/admin 만**
채팅 링크는 멤버 이상이다(`guest_admin.js:52`). 프로젝트 링크는 여는 범위가 넓다(업무 전부, 2차엔 문서 본문). 제안은 **멤버 이상 그대로**(발급이 한 번의 클릭이어야 영업이 산다 — GUEST_LINK §0 의 교훈) + 감사 로그 + 헤더 칩. owner/admin 만으로 조이려면 `assertMemberOrAbove` 대신 `ownerOrAdmin` 한 줄이다.

**Q3. 업무 탭에 담당자 표시명을 보일지 — 보인다(제안) vs 숨긴다**
로그인 고객 화면(`ProjectTaskList.tsx:656`)과 공개 업무 미리보기(`SHARE_PREVIEW_POLICY.md §2`)가 이미 담당자 이름을 보인다. 워크스페이스 표시명(예: "루아")만 나가고 이메일·id 는 없다. 숨기면 고객은 "누구한테 물어봐야 하나" 를 대화 탭에서 다시 묻게 된다.
