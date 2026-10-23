---
paths:
  - "dev-backend/routes/sale*.js"
  - "dev-backend/routes/client*.js"
  - "dev-backend/services/sale*"
  - "dev-backend/services/sales*"
  - "dev-backend/services/client*"
  - "dev-backend/services/qnoteOwnership.js"
  - "dev-frontend/src/pages/QSale/**"
  - "dev-frontend/src/components/QSale/**"
  - "dev-frontend/src/components/Clients/**"
  - "dev-frontend/src/components/Common/UserInfoPopover.tsx"
  - "dev-frontend/src/pages/Settings/Mail*"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# Q sale — 고객 축·상담 기록·사람 아이콘

**Q sale (2):** **client_stage_history**, **client_interactions** (2026-09-11 신규 — 영업은 **새 고객 테이블이 아니라 `clients` 의 축**이다. 설계 docs/Q_SALE_DESIGN.md)
- `clients` 확장: `status` ENUM 끝에 **`prospect`**(문의 고객 = 계정 없음 + 초대 안 함) append · `sales_stage`(none→inquiry→consulting→proposal→negotiation→won/lost) · `sales_source` · `lost_reason/lost_note` · `phone` · `expected_amount/currency` · `last_touch_at`(파생) · 인덱스 2.
- **직접 관리 고객 = `clients.status='managed'`** (2026-10-15, Irene *"고객이 가입을 안 해도 관리자가 정보를 넣고 직접 관리하는 고객도"*) — 계정·초대 없이 정보만 관리하는 **정식 고객**(한도 포함). `active` 는 «계정이 연결된 고객» 이다 — 계정 없는 행을 active 로 만들지 않는다.
  관계 판정은 `services/clientAccess`(canInviteClient·emailEditable·reactivatedStatusOf) 한 곳, 응답 `can_invite`·`email_editable` 만 화면이 본다. 초대·등록 문은 `routes/client_invites.js`(초대는 `client_id` 로 같은 행 승격). 운영 `migrate-client-managed.js`(배포 슬롯, 백필은 수동 `--apply`). 설계 docs/CLIENT_MANAGED_DESIGN.md
- **고객 화면은 Q sale 하나다** (2026-10-16, Irene *"설정에 고객리스트와 큐세일즈에 고객이랑 또 따로 만들었어? … 합쳐서 제대로"*) — 옛 설정 > 고객(`/business/clients`)·고객 타임라인 페이지는
  없앴고 주소는 `components/Clients/LegacyClientsRedirect` 가 쿼리째 `/sale?tab=clients`·`/sale/:id` 로 넘긴다. 상세는 Q sale 패널·상세 페이지가 **같은 절**
  (`components/Clients/` — ClientStatusBanner·ClientRecordSections(사업자·증빙·정기 청구·메모)·ClientAuditHistory·ClientAddDrawer)을 얹는다.
  메뉴 권한 키는 `qsale` 하나(`clients` 폐지 — 옛 행은 `migrate-menu-key-clients.js --apply` 가 더 좁은 쪽으로, 배포 슬롯). 연결 프로젝트 판정은
  `clientAccess.projectLinkWhere`/`projectsByClient` 한 벌(client_id 또는 계정 contact_user_id). 설계 docs/CLIENT_SCREENS_MERGE_DESIGN.md
- **단계를 바꾸는 문은 하나다** — `services/salesStage.js setStage`(컬럼 + 이력 + 감사 + broadcast). `client.update({sales_stage})` 를 다른 곳에서 부르면 이력·실시간이 조용히 빠진다.
- **접근 종류는 컬럼이 아니라 파생이다** — `services/clientAccess.js accessKindOf`(guest/invited/member)와 같은 판정을 목록 필터도 쓴다(`accessWhere`). 프론트가 `user_id` 로 스스로 판정하지 않는다.
- **한도 술어도 한 곳** — `services/clientQuota.js`: 정식 고객 = prospect 를 뺀 기존 집합, 문의 고객은 `prospects_max`(정식 ×3). `plan.can('add_client')`·`can('add_prospect')` 가 같은 술어를 쓴다. 생성 후 `invalidateBusinessCache`(사용량 30초 캐시).
- **라우트는 세 파일이 한 접두어를 나눈다** — `routes/sale.js`(목록·상세·단계·타임라인) · `sale_interactions.js` · `sale_save.js`. 권한 체인·직렬화는 `services/saleCommon.js` 한 벌(베끼면 한쪽만 고쳐진다). 고객(client) 역할은 서버 `blockClient` + 프론트 `hasBiz('owner','member')` **같은 술어**로 막는다.
- **운영 적용**: `dev-backend/scripts/migrate-qsale.js`(멱등, ENUM 끝 append 3건 — `clients.status` · `notifications.event_kind` · `notification_prefs.event_kind`). **코드 배포 전에** 실행한다. 두 알림 테이블은 값 **순서가 다르므로** 한 목록을 공유하지 않는다. 롤백은 `prospect→archived`(invited 로 돌리면 라벨이 거짓이고 한도에 들어간다).
- **상담에 무엇이 들어오는가는 «관계» 로 가른다** (2026-09-16 박제 — Irene: *"상담리스트에 메일이 너무
  쓸데없이 많이 들어와. 그냥 신청하라는 홍보메일도 가져오면 어떻게 해?"*). 판정은
  **`services/saleMailCriteria.js` 한 곳** — ①우리가 답한 스레드 ②개인 주소(무료메일 개인 계정 ·
  회사 도메인이면 **이름 두 토막 이상**) ③사람이 올린 것. 그 외는 상담에 넣지 않는다.
  - ★ **확인완료(`archived`)한 것은 «행위로 증명된 관계» 일 때만 들인다**(우리가 답했다 / 사람이 올렸다).
    «확인완료 + 답 없음» 은 사람이 **보고 무시했다**는 가장 강한 신호다 — 거기에 주소 모양 추정을
    쓰면 Q mail 에서 치운 은행 알림·회람·스팸이 되살아난다(2026-09-17 실측: owner 화면 4 → **48**).
  - ★ **「후보」 칸은 2026-09-17 에 없앴다.** 운영에 쌓인 22건을 전수로 열어 보니 **진짜 문의 0건**
    — 자동메일 오판이 모이는 자리였고, [상담으로 보내기] 0회 · [보관/무시] 7회로 **버리기만** 했다.
    좁히는 기준과 [상담으로 보내기] 문은 남는다(문이 없으면 놓친 것을 살릴 길이 사라진다).
  - **키워드로 가르지 않는다.** 그 길을 두 번 걸었고 두 번 다 샜다(발송전용 패턴·광고 표기·List-* 헤더).
    운영 실측 32건 중 진짜 문의는 7건이고, 그중 5건이 «우리가 답함» 또는 «개인 주소» 였다.
  - **놓친 것을 살릴 문은 남긴다.** 좁힌 기준과 **[상담으로 보내기]**(`POST /:biz/inbox/promote`)는
    **한 벌**이다 — 문이 없으면 놓친 문의를 살릴 길이 없고, 기준이 없으면 목록이 홍보로 덮인다.
    ★ 「후보」 **칸**은 없앴지만(위 불릿) **문은 그대로다.** 진입점 3곳:
    메일 목록 **우클릭**(행이 `<button>` 이라 안에 메뉴를 못 넣는다 → `AppContextMenu` 의
    `data-pq-context`) · 메일 상세 ⋯ · 채팅 메시지 툴바(고객 대화방만, 팀 대화방은 400).
  - **보관함 [되돌리기]도 승격으로 읽는다** — 사람이 "문의 맞다" 고 말한 것이다. 안 그러면 되돌려도
    후보로 떨어져 되돌리기의 뜻이 사라진다(실측으로 잡았다).
  - **목록과 집계는 `classifyMailThreads` 한 번**을 읽는다. 각자 세면 같은 술어가 두 벌이 된다
    (memory `feedback_same_value_multiple_formulas`). 회귀: `node scripts/e2e/run.js --suite salecriteria`.
  - **미등록 메일은 사람(바깥 주소) 한 줄이다** (2026-10-23, Irene *"같은 고객인데 메일이 여러 개 … 그룹핑"* · Fable 설계) —
    `services/saleMailBundle` 한 벌이 목록·숫자(email·needs_reply)·보관함을 묶는다(대표 = 최신 스레드, 답할 차례 = 하나라도,
    `meta.thread_ids`). 등록 뒤 고객 한 줄과 같은 단위다. 줄 단위 동작(✕·되돌리기·영구 빼기)은 `forEachInboxThread` 로 묶음 전부.
    «대응 끝» 상태는 두지 않는다 — 아래 09-18 절 그대로.

## 상담은 «고객에 달리는 기록» 이다 — 업무가 아니다 (2026-09-18 박제)

> Irene: *"프로젝트 고객 업무 이메일 들이 서로 연결된 것처럼 상담도 다 연결해야 하는데
> 업무처럼 취급되면 될지 프로젝트나 고객처럼 연결이 되어야 할지 모르겠는데."*

**상담은 `clients` 축에 달리는 기록(`client_interactions`)이다.** 업무처럼 자기 생명주기
(담당자·마감·상태 전이)를 갖는 1급 엔티티로 만들지 않는다.

- 업무는 «누가 언제까지 무엇을 한다» 라서 **상태가 변한다.** 상담은 «언제 무슨 접점이 있었다» 라서
  **변하지 않는다**(사실의 기록). 같은 틀에 넣으면 상담에 담당자·상태가 생기고, 그 순간
  "끝난 상담/안 끝난 상담" 이라는 뜻 없는 축이 하나 더 생긴다.
- **고객이 이미 허브다** — 채팅·메일·업무·청구·노트·일정이 전부 고객으로 모인다
  (`services/clientTimeline.js`). 상담을 그 옆에 나란히 세우면 허브가 둘이 되고, 둘은 반드시 갈라진다.
- 단계(`sales_stage`)는 **이미 고객의 컬럼**이다. 상담이 따로 서면 단계가 어디 붙는지 모호해진다.

그래서 모든 «상담으로 저장» 은 **같은 원장 한 곳**에 착지한다:

| 들어오는 곳 | 문 |
|---|---|
| 메일 — 목록 우클릭 · 상세 ⋯ · **상세 툴바**(2026-09-18 추가) | `POST /api/sale/:biz/inbox/promote` |
| 채팅 메시지 툴바 | 같은 문 (`kind='conversation'`) |
| **Q note 세션** (2026-09-18 추가) | `POST /api/sale/:biz/clients/:id/interactions` + `qnote_session_id` |
| 사람이 직접 | 같은 문 (고객응대 내역 추가) |

- **출처는 화면이 고르지 않는다** — `source_kind='qnote'` 는 서버가 **노트 소유를 확인한 뒤** 박는다
  (`services/qnoteOwnership.js` 한 곳, fail-closed). 화면이 보낸 문자열을 그대로 쓰면 원장에 거짓이 남는다.
  ★ `qnoteByEntity` 로 대신 묻지 않는다 — 그 문은 `visibility <> 'L1'` 이라 **개인 노트를 안 준다**.
  막 끝낸 내 회의는 대개 L1 이므로 그 문으로 물으면 **내 것도 "아니다"** 가 된다.
- **저장은 연결까지다** — 노트를 상담으로 저장하면 **노트 자체도 그 고객에 연결**한다(`session.client_id`).
  기록만 남기고 원본으로 가는 길이 없으면 «연결» 이 아니라 복사다. 되돌아가는 문은 상담 행의 **[노트 열기]**
  (`meta.source_kind==='qnote'` 일 때만 — `services/clientTimeline.js` 가 `source_kind`·`qnote_session_id` 를 싣는다).

### 사람 아이콘은 프로필로 간다 (같은 날)
> Irene: *"채팅에서 고객이나 멤버 아이콘 누르면 프로필로 가야지 고객프로필이랑 멤버 프로필."*

`UserInfoPopover` 는 멤버/고객을 이미 가려내고 있었지만 **막다른 길**이었다(이름·이메일까지만).
- 고객 → `/sale/:clientId` (Q sale 고객 상세가 곧 고객 프로필)
- 멤버 → `/business/members?member=:userId` — 멤버 상세 드로어는 **있었는데 URL 싱크가 없어**
  바깥에서 가리킬 방법이 없었다. 키는 `member.id` 가 아니라 **user_id** 다(부르는 쪽이 아는 것은 사람의 id).
- 둘 다 **새 탭**으로 연다 — 대화 중에 눌렀는데 보던 대화가 사라지면 안 된다.

