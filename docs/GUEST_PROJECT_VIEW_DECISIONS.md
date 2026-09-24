# 고객용 프로젝트 링크(`/g/<token>`) — 설계 결정 7건

> 2026-09-24 · Fable 판정. Irene 신고 원문 두 건에 대한 **결정**이다(선택지 아님).
> 구현은 Opus. 선행 설계 정본 `docs/PROJECT_EXTERNAL_VIEW_DESIGN.md`(2026-09-04)는 유지하고,
> 이 문서가 **뒤집는 항목**(§12-Q3 담당자 표시 · 발급=항상 새 행)은 여기가 정본이다.

> Irene: *"여기 고객용 프로젝트 링크가 계속 탭마다 레이아웃이 달라. 그리고 업무관리는 담당자 표시할지 말지
> 체크하게 하면 안돼? 표시 안되는게 좋은데. 팀이름으로 표시하고 고객만 고객이름 표시하고. 문서탭은 문서처럼
> 카드형하고 가야지. 파일도 그렇고. 파일들, 채팅에서 청구서, 업무들 확인하고 싶으면 고객으로 등록하기 해서
> 워크스페이스 들어가게 해야 하는 거 아니야? 개요에 프로젝트 내용은 왜 이렇게 적게 나오고 탬들에 필요한 필터나
> 카테고리는 일부러 뺀거야? 이유가 있어? 점검 좀 해줘."*
> *"그리고 링크를 계속 새로 만들어? 왜 이러는 거야? 이유가 있어?"*

---

## 0. Opus 조사의 검증 — 맞는 것과 고칠 것

| # | Opus 진술 | 판정 |
|---|---|---|
| ① 레이아웃 | 개요·업무 880 가운데 / 문서·파일 전폭, styled 13개 중복 | **맞다.** 추가: `/g/` 를 재는 e2e 카나리가 **0건**이다(`scripts/e2e/` grep). 지금까지 이 표면은 Fable 이 손으로만 쟀다 |
| ② 담당자 | 서버가 무조건 싣는다 · `guestDisplayNames` 한 곳 · 토글은 설계만 | **맞다.** 추가 실측: **운영 `teams` 0행 · `business_members.team_id` 0건.** «팀 이름» 을 `teams` 에서 읽으면 **전원 빈칸**이다 → 정본을 `teams` 로 잡으면 안 된다(§A-3) |
| ③ 문서·파일 | 1열 목록, 썸네일 없음 | 맞다. 추가: `/api/files/public-image/:storedName` 은 **이미 무인증**이고 `security_level=general` 만 본다(vlevel 안 봄). 게스트 썸네일은 새 바이트 표면이 아니라 **토큰(stored name)을 누구에게 주느냐**의 문제다(§D) |
| ④ 등록 동선 | 배너는 대화 화면만 · 시트는 닫기 하나 · `auth-check` 프론트 0건 | **맞다.** 정정 하나: 설계 §4.2 의 `/login?next=` 는 **없는 인자**다. `LoginPage.tsx:482` 는 **`?redirect=`** 를 읽는다 |
| ⑤ 개요 | 진행률·이슈는 필드도 라우트도 없다 | 맞다. `Project` 모델에 진행률 컬럼이 없고(`models/Project.js`), 앱 개요는 전략 캔버스(내부 전용 `:715 !isClient`)다 — «빼서» 와 «없어서» 를 §E 에서 가른다 |
| ⑥ 필터 | 서버 `req.query` 0건, `category` 는 응답에 있음 | 맞다 |
| ⑦ 링크 재발급 | `issueGuestLink` 가 항상 새 행 | 맞지만 **원인이 아니라 증상**이다. 운영 실측(2026-09-24): 프로젝트 3 에 `#1` conversation(09-02·살아 있음) · `#3` project(09-13) · `#5` project(**오늘 08:43 생성**) · `#3` 은 **08:47 회수**. 즉 Irene 은 **옛 링크의 주소를 다시 볼 수 없어서** 새로 만들고 옛것을 닫았다. 주소를 다시 못 보는 이유는 설계다 — 토큰은 sha256 해시만 저장(GUEST_LINK §2.2·§13.4)하고, 모달이 **"나중에 다시 필요하면 새로 만들어 주세요"** 라고 말한다(`GuestLinkButton.tsx:163`). «화면에 2개» 는 `#3`+`#5` 두 project 링크다. `#1` 은 09-05 scope 도입 전의 채팅 링크라 프로젝트 모달에는 안 뜬다(`projects.js:1088` scope 필터) — 정상 |

> Irene 의 "왜 이러는 거야" 에 대한 답: **버그가 아니라 설계가 낳은 동선이다.** 토큰 원문을 남기지 않는 것은
> 맞는 결정이었고(DB 사본 하나로 모든 대화가 열리면 안 된다), 그 대가로 «주소를 다시 볼 길» 을 안 만든 것이 틀렸다.
> 개인 링크(§13.4)는 이미 **파생(HMAC)** 으로 이 문제를 풀어 뒀는데 공유 링크에는 적용하지 않았다. §B 가 그것을 맞춘다.

---

## 우선순위와 게이트

| 순서 | 항목 | R·S·F | 검증 |
|---|---|---|---|
| 1 | **B. 링크 재사용** | **R=1** (무인증 표면의 토큰 체계) | Fable |
| 2 | **A. 담당자 표시 정책** | R=0 · S=0(여기서 설계 끝) · F=1 | **B 와 묶어 한 라운드** Fable (쪼개지 않는다) |
| 3 | C. 껍데기 통일 | F=1 | 자체 (`--suite guestproject`) |
| 4 | D. 문서·파일 카드 | F=1 | 자체 |
| 5 | G. 고객 등록 동선 | F=1 | 자체 |
| 6 | F. 필터·카테고리 | F=1 | 자체 |
| 7 | E. 개요 보강 | F=1 | 자체 |

- C~G 는 **한 커밋 묶음**으로 가도 된다. 카나리 `scripts/e2e/canary-guest-project.js` 를 **먼저** 만든다(§H) —
  지금 이 표면은 아무도 기계로 안 잰다.
- **A·B 는 운영 스키마 변경이 없다**(§A-1: `businesses.permissions` JSON 안 · §B: 컬럼 추가 없음). 배포 슬롯 스크립트 불필요.

---

## A. 담당자 표시 정책

### 결정
1. **스위치는 워크스페이스 하나.** `businesses.permissions.client_show_assignee: boolean` — 이미 있는 JSON 컬럼과
   `GET/PUT /api/businesses/:id/permissions` (`routes/businesses.js:1425~`) · `pages/Settings/PermissionsSettings.tsx` 에 키 하나를 더한다.
   **컬럼을 새로 만들지 않는다.** (QMAIL_CONTEXT_DESIGN §8.5 가 컬럼 3개를 그렸지만 그 설계는 미구현이고, 같은 값을 두 저장소에 두지 않는다.)
2. **기본값 `false` = 숨김.** §12-Q3(2026-09-04 "보인다") 를 **뒤집는다.**
3. **숨길 때 멤버는 «워크스페이스 이름»** (`brand_name || name` — `billing.js:246` 등 3곳이 쓰는 같은 식). `teams` 는 정본이 아니다.
4. **고객은 언제나 고객 이름.** 스위치와 무관하게 `clients.display_name || company_name`.
5. **한 술어, 네 표면.** `services/guestParty.js` **한 파일** — 업무 `assignee_name` · 문서 `author_name` · 파일 `uploader_name` · 채팅 `sender_name` 이 전부 이 함수를 부른다. `guest_project.js:87 guestDisplayNames` 는 이 파일로 옮기고 지운다.

### 근거
- **어디에 두나 — «어느 링크가 무엇을 보여주는지 기억할 수 있는가».** 링크별 스위치는 보이지 않는 상태를 링크 수만큼 만든다(운영에 프로젝트 3 하나에 링크가 셋이다). 프로젝트별은 설정 자리가 없고(프로젝트 설정 탭은 재무·편집), 발급 모달의 체크는 §B 로 링크가 **하나로 수렴**하면 뜻이 사라진다. 워크스페이스 정책은 «우리 회사가 고객에게 개인 이름을 보이는가» 라는 **회사 결정**이고 그 결정은 한 곳에 있어야 한다.
- **기본값을 뒤집는 근거 — «누구한테 물어보나» 는 이 화면에서 거짓 문제다.** 게스트는 사람에게 묻지 않는다. 대화 탭은 **고객 채널**(`ensureProjectCustomerChannel`)로 가고, 거기서 답하는 사람은 프로젝트 멤버 전원이다. 이름을 알아도 그 사람에게 따로 갈 길이 없다. 그러니 이름은 «행동 가능한 정보» 가 아니라 «직원 명단 노출» 이다. 카톡 채널·고객센터가 회사 이름으로 답하는 것과 같은 계약이다.
- **`teams` 가 아닌 이유.** 운영 0행이라 지금 켜면 전원 빈칸이고, 채워져도 "개발1팀" 은 **조직 구조**라 고객에게 뜻이 없고 내부 형태를 새로 흘린다. Irene 의 «팀» 은 «우리 팀 = 우리 회사» 다.
- **문서·파일은 멤버면 이름 칸을 아예 비운다(null).** 카드마다 "워프로랩" 을 반복하면 정보가 아니라 소음이다. 업무는 남긴다 — 담당이 «우리» 인지 «고객(당신)» 인지가 곧 «누가 움직일 차례인가» 라 뜻이 있다. 채팅은 말풍선에 «누가» 가 있어야 하므로 남긴다.

### 술어 (구현 지점)
```
services/guestParty.js
  loadGuestPartyPolicy(businessId)      → { showMembers:boolean, workspaceName:string }   // permissions.client_show_assignee
  guestPartyLabels(businessId, userIds, { surface })   → Map<userId, string|null>
     surface: 'task' | 'doc' | 'file' | 'chat'
     ① Client(user_id∈ids, business_id) 가 있으면        → client.display_name || company_name       (항상)
     ② 그 외(멤버·Cue·탈퇴자 등 전부)
          showMembers=true  → 기존 규칙(워크스페이스 표시명 → User.name; 이메일 안 읽음)
          showMembers=false → surface∈{task,chat} ? workspaceName : null
```
- `routes/guest_project.js` 3 라우트(`/tasks`·`/posts`·`/files`) + `/posts/:postId` 상세 · `routes/guest.js:43 serializeMessage`(게스트 메타 이름 분기는 그대로 두고, `m.sender?.name` 자리를 이 Map 으로 바꾼다. 메시지 목록 라우트가 sender id 를 모아 한 번 호출).
- 설정 화면: `PermissionsSettings.tsx` 에 «고객 공개 범위» 카드 1개, 토글 1개 «외부 링크·고객 화면에 담당자 이름 보이기», `AutoSaveField type="toggle"`. 문구 ko/en 동시.
- **하지 말 것**: `teams` 조인 · 링크별/프로젝트별 스위치 · `client_show_progress`·`completed_date` 까지 같이 만들기(요청 없음) · 앱 안 로그인 고객 화면(`ProjectTaskList`)까지 이번에 바꾸기(별건, 같은 키를 나중에 그 화면이 읽으면 된다) · 표시명 규칙을 라우트 안에서 다시 쓰기.

### R·S·F
R=0(표시만, 되돌릴 수 있고 스키마 없음) · S=0(여기서 결정 끝) · F=1 — 실HTTP: 토글 off → 멤버 담당 업무 `assignee_name == 워크스페이스명`, 고객 담당 업무 == 고객명, 문서 `author_name == null`, 채팅 멤버 발화 == 워크스페이스명; 토글 on → 멤버 표시명; 어느 쪽에서도 응답 원문에 `@`·`user_id` 0건(`health-check --category=secrets` 계열 대조). **B 와 한 라운드로 Fable 에 올린다**(따로 안 올린다).

---

## B. 링크 재사용

### 결정
1. **공유 링크 토큰도 파생(HMAC)으로 만든다** — 개인 링크와 같은 원리(`personalTokenFor`), 재료만 다르다:
   `HMAC(GUEST_LINK_SECRET, 'shared:' + id + ':' + createdAt(ms) + ':' + business_id)`. 저장은 지금처럼 **해시만**(`token_hash`·`token_hint`). `resolveGuestToken` 은 **무변경**.
2. **주소는 다시 볼 수 있다.** 목록 라우트 두 곳(`projects.js:1077` · `guest_admin.js:25`)이 살아 있는 shared 링크에 `url` 을 싣는다 — 파생 토큰의 해시가 `token_hash` 와 같을 때만. **옛 난수 링크는 `url: null`**(운영 살아 있는 링크 3개가 이것이다). 모달은 그 행에 "이전 방식 링크 — 주소를 다시 볼 수 없어요. [새 링크로 교체]" 를 보인다.
3. **발급은 멱등이다.** `POST …/guest-links` 는 같은 (scope, project_id 또는 conversation_id) 에 **살아 있는 shared 링크가 있으면 그것을 200 `reused` 로 돌려준다**(url 포함). 없을 때만 201 `issued`. 두 멤버가 동시에 눌러도, 더블클릭해도 하나다.
4. **새로 만드는 문은 «교체» 하나.** body `{ replace: true }` → 기존 링크 `revokeGuestLink`(자식 개인 링크 동반 회수, 감사) 뒤 새로 발급 201. 모달은 ConfirmDialog 로 묻고 문구에 **«이전 주소로 들어오던 사람·답글 알림 신청자가 끊깁니다»** 를 적는다(외부 영향은 확인을 받는다 — CLAUDE.md 2026-09-13).
5. **can_write 가 다르면 — 재사용이 이긴다.** 발급 body 의 `can_write` 는 **새로 만들 때만** 쓴다. 기존 링크의 값은 모달에 칩으로 보이고, 바꾸려면 «교체» 다. (PATCH 를 만들지 않는다 — 요청에 없다.)
6. **`expires_at` 은 재사용 때 갱신하지 않는다.** 만료는 슬라이딩(쓰면 밀린다). 발급자가 열어 본 것은 사용이 아니다.
7. **발급자가 달라도 같은 링크다.** 링크는 프로젝트의 것이지 멤버의 것이 아니다(`created_by` 는 감사용).
8. **scope 가 다른 링크가 같이 살아 있는 것은 정상이다.** «대화만» 과 «프로젝트 열람» 은 다른 상품이다. 프로젝트 모달은 project 만(지금 그대로), 대화방 모달은 둘 다 보이되 **scope 칩**(«프로젝트 열람» / «대화만»)을 붙인다(`serializeGuestLink` 에 `scope` 가 이미 있다). 서로를 자동 회수하지 않는다.

### 근거
- Irene 이 본 «2개» 는 **주소를 다시 못 봐서 생긴 것**이다(§0-⑦). 저장 방식(해시만)은 지키면서 주소를 다시 보려면 파생뿐이고, 이 시스템은 그 길을 개인 링크에서 **이미 택했다**(GUEST_LINK §13.4: *"비밀키만 새도 못 만들고 DB 만 새도 못 만든다 — 원문 저장보다 엄격히 낫다"*). 같은 저장소 안에 같은 문제의 답이 두 벌이면 안 된다.
- 멱등 발급이 «링크를 계속 새로 만드는» 동선을 **구조로** 없앤다. 문구로 "있으면 재사용하세요" 라고 말하는 것은 고치는 것이 아니다.
- 교체를 **별도 인자**로 두는 이유: 유출 의심 때 «옛것을 죽이는» 것이 목적이지 «하나 더» 가 목적이 아니다. 회수 없는 재발급은 살아 있는 문을 늘릴 뿐이다.

### 구현 지점
- `services/guest_link.js`
  - `sharedTokenFor(link)` (personalTokenFor 옆, 같은 fail-closed: secret 없거나 32자 미만이면 null — 단 **발급에서는 null 이면 500 `guest_link_secret_missing`** 으로 죽인다. 난수로 조용히 떨어지면 «다시 못 보는 링크» 가 또 생긴다. 운영·dev 둘 다 62자 secret 이 있음을 확인했다).
  - `issueGuestLink` — placeholder 해시로 create → `sharedTokenFor` 로 `token_hash/hint` update (`mintPersonalToken` 과 같은 두 단계, 한 트랜잭션).
  - `findLiveSharedLink({ businessId, scope, projectId|conversationId })` — 정렬 `id DESC` 1건. **두 라우트가 같은 함수를 부른다**(대화방·프로젝트 발급이 복사본을 두었다가 한쪽이 죽은 전례).
  - `urlForSharedLink(link)` → 파생 토큰 해시 == `token_hash` ? `${APP_URL}/g/${token}` : null. `serializeGuestLink` 는 **그대로**(원문 토큰 금지 원칙) — `url` 은 목록 라우트가 살아 있는 행에만 덧붙인다.
- `routes/projects.js:1113` · `routes/guest_admin.js:60` POST: `replace` 분기 → 위 순서. 감사 `guest_link.replace`(old→new id).
- `components/QTalk/GuestLinkButton.tsx`: ①살아 있는 링크 행에 주소 + [복사][보내기] (fresh 와 같은 부품) ②링크가 있으면 «링크 만들기» 버튼을 **숨기고** «새 링크로 교체» 만 ③`url:null` 행은 안내 + 교체 ④`:163` 문구 삭제("새로 만들어 주세요" 는 이제 거짓) ⑤scope 칩.
- **하지 말 것**: `token` 평문·암호화 컬럼 · PATCH can_write · 자동 회수(다른 scope) · 옛 난수 링크를 파생으로 «마이그레이션»(원문을 모른다 — 못 한다) · 발급 응답 형식 변경(`url` 키는 그대로, `message` 만 `reused|issued`).

### R·S·F
**R=1** — 무인증 표면의 토큰 생성 규칙과 secret 의존이 바뀐다. 잘못되면 «만들어진 링크가 안 열린다» 또는 «secret 유출 시 열거» 다. Fable 게이트: ①파생 토큰으로 `GET /api/guest/:token` 200 · 회수 후 404 · 옛 난수 링크 계속 200(운영 `#1 #2 #5` 로 실측) ②`url` 이 파생 링크에만 실리고 옛 링크는 null ③멱등: POST 2회 → 행 1개, `reused` ④`replace` → 옛 행 revoked + 자식 revoked + 새 행 1 ⑤secret 을 비운 프로세스에서 POST → 500, 행 0 ⑥응답·로그 어디에도 원문 토큰이 목록 경로 외로 안 나감.

---

## C. 레이아웃 통일 — 게스트 껍데기 계약

### 결정
- **껍데기 하나: `pages/Guest/guestShell.ts` 의 `GuestTabPane`.** 지금 `GuestProjectPage.tsx:253 Scroll` 을 그대로 옮긴다 — `flex:1; min-height:0; overflow-y:auto; padding:16px 20px(폰 14px 16px)`; 안의 직계 자식은 `max-width: READ_W(880px); margin: 0 auto; width:100%`. 다섯 탭 전부 이 안에 그린다. **문서·파일은 자기 `Scroll` 을 지운다.**
- 대화 탭도 같은 기둥이다: `GuestChatPanel` 의 메시지 목록·입력줄을 같은 `READ_W` 로 가운데 모은다(100dvh 컬럼·입력줄 고정 계약은 그대로). 탭을 옮길 때 글의 왼쪽 x 가 바뀌지 않는 것이 이 항목의 정의다.
- `data-testid="guest-tab-body-<key>"` 를 다섯 탭 루트에 준다(프로젝트 탭 규칙과 같은 손잡이 이름 체계).
- **13개 중복 styled → `guestShell.ts` 한 곳**: `Empty`·`RetryInline`·`HiddenNote`·`Lock` + 시트 4종(`Sheet`·`SheetBox`·`SheetTitle`·`SheetBody`·`SheetBtn`). 시트는 §G 의 `LoginRequiredSheet` 가 쓴다.
- 업무 탭 행 모양(테두리 상자 + border-bottom)은 **유지**. 업무는 앱에서도 목록이다. 카드는 문서·파일만(§D).

### 근거
앱의 `ProjectTabPane/ProjectTabFull` 을 그대로 가져오지 않는다 — 그 계약은 PageShell 20px 여백·탭 막대 높이 상수에 묶여 있고 게스트에는 그 크롬이 없다. 게스트 표면의 기준은 **읽기 폭**(2026-09-10 Irene "허접" 지적으로 880 이 정해졌다)이고 그 숫자를 다섯 탭이 나눠 쓰면 된다. 숫자를 바꾸지 않는다.

### 하지 말 것
READ_W 값 변경 · 탭마다 padding 다르게 · 데스크탑 전폭 카드(1560px 에 6열은 카드가 아니라 타일이다) · `100vh`(지금 `Wrap` 은 `100dvh` — 이 화면은 앱 크롬 밖이라 예외가 맞다, 건드리지 않는다).

### R·S·F
F=1 — 3폭(375·900·1440)에서 다섯 탭 본문 첫 자식 `left/right` 집합이 **하나**인가, 세로 스크롤 주체가 `guest-tab-body-*` 인가(바깥 `scrollHeight == clientHeight`). 양성 대조군: 문서 탭 `Scroll` 을 되살리면 집합이 둘이 되는가.

---

## D. 문서·파일 카드형

### 결정
- **카드 그리드로 간다.** `pages/Guest/guestCards.ts`: `Grid = repeat(auto-fill, minmax(180px,1fr)) gap 12px` · `Card`(흰 배경·1px `#e2e8f0`·radius 10·padding 12) · `Thumb`(4:3, `#f1f5f9`) — 값은 Q file `DocsTab.tsx:2726~2760` 과 **같은 숫자**를 적는다.
  ★ 지금 `DocsTab.tsx` 는 **다른 세션(Q file)이 미커밋으로 편집 중**이다(git status). 그 파일을 건드리지 않는다. 공용 `components/Common/cardGridShell.ts` 로 **빼는 것은 Q file 작업이 커밋된 뒤** 후속으로 한다 — `guestCards.ts` 머리말에 이 사실과 대상 줄 번호를 적는다.
- **문서 카드**: 분류 칩 · 제목(2줄 클램프) · 바닥줄(날짜 · 고객 작성자면 이름). 썸네일 없음(문서에 표지 이미지 필드가 없다). 잠긴 카드는 흐리게 + 🔒 + 캡션 «로그인하면 볼 수 있어요», 누르면 §G 시트.
- **파일 카드**: 썸네일 영역(이미지면 그림, 아니면 종류 글리프) · 파일명 · 크기·날짜 · 꼬리표 [받기] / [로그인 후 받기] / 🔒.
- **썸네일은 `downloadable` 인 이미지에만.** 서버 `GET /:token/files` 가 `preview_url` 을 **`downloadable && isRenderableImage`** 일 때만 싣는다(`services/filePreview.previewUrlForFile(file) + '?w=320'`). 쿼리 attributes 에 `file_path`·`external_id`·`storage_provider` 를 더하되 **응답에는 `preview_url` 만** 담는다. L2/L3(로그인 후 받기)·잠김은 `preview_url` 없음.

### 근거
- **왜 downloadable 에만인가.** `public-image` 는 stored name 을 아는 사람에게 무인증으로 준다. L2/L3 파일은 «자리는 보이되 받을 수 없음» 이 계약인데(설계 §4.3 — 파일은 «반출»), 썸네일 토큰을 주면 320px 사본을 받게 한 것이다. L4 general 은 이미 `share_token` 으로 원본을 받을 수 있으니 썸네일은 **새 노출이 아니다**. 이 경계가 곧 «보안등급 게이트와 충돌하지 않는 선» 이다.
- 잠긴 파일의 썸네일은 **없다** — 이름만 나가는 것이 그 등급의 뜻이다.

### 하지 말 것
문서 본문 첫 이미지로 표지 만들기(본문 읽기와 같은 노출 — 안 한다) · `public-image` 에 vlevel 검사 추가(별건, 지금 다른 화면이 L2/L3 general 썸네일을 쓴다) · 파일 카드에서 직접 `/public/files/:token` 링크(토큰은 302 로만, 지금 규칙 유지).

### R·S·F
F=1 — 실HTTP: L4·general·png → `preview_url` 200 이미지 · L2·general·png → 키 없음 · internal → 행에 키 없음 · confidential → 행 없음. 화면: 375 폭 2열 / 1440 폭 4열(880 안), 카드 테두리 x 집합.

---

## E. 개요 보강

### «빼서» 와 «없어서» — Irene 물음의 답
| 항목 | 상태 | 이유 |
|---|---|---|
| 전략 캔버스(배경·과제·목표·메시지·방식) | **빼서** | 앱에서도 고객에게 안 보인다(`QProjectDetailPage :715 !isClient`) |
| 거래 금액·결제 | **빼서** | 재무(§3.1) — 단계 라벨만 칩으로 |
| 멤버 목록 | **빼서** | 이메일 포함 `loadProjectDetail` — §A 정책과도 어긋난다 |
| 진행률 % | **없어서** | 프로젝트에 컬럼이 없다. «완료/전체» 가 그 자리다(두 공식을 두지 않는다) |
| 이슈·노트 | **없어서(+빼서)** | `project_issues` 에 고객 노출 축이 없고 `project_notes` 는 자유 텍스트라 1차 원칙(등급 축 없는 텍스트는 안 내보냄) |

### 결정 — **서버 화이트리스트를 늘리지 않고** 이미 여는 데이터로 채운다
개요 탭이 `/tasks`·`/posts` 를 **탭 열 때 한 번** 더 부른다(둘 다 이미 무인증으로 여는 데이터). 추가 섹션:
1. **마일스톤** — `is_milestone` 업무를 `due_date` 순으로 최대 6개: 제목·상태·기간(`period`).
2. **다음 마감** — 미완료 업무 중 가장 가까운 `due_date` 1건.
3. **최근 문서 3** — 문서 카드(§D 부품) 3장 + «문서 탭 전체 보기».
4. **문의 창구** — «{워크스페이스 이름}에 문의» 버튼 → 대화 탭. (`ChatHint` 문장을 버튼으로.)
`client_company`(모델 `:11`) 는 **넣지 않는다** — 고객이 자기 회사명을 볼 이유가 없고, 링크가 다른 고객사에 전달됐을 때 «누구 프로젝트인지» 를 알려 준다.

### 하지 말 것
서버 개요 라우트에 필드 추가 · 이슈/노트 새 라우트 · 진행률 평균 같은 두 번째 공식 · 개요에서 문서 본문 미리보기.

### R·S·F
F=1 — 마일스톤 목록 == `/tasks` 중 `is_milestone` 집합, 다음 마감 == min(due) 실측.

---

## F. 필터·카테고리

### 결정
- **넣는다. 전부 클라이언트 필터.** 데이터는 이미 200건 상한으로 한 번에 온다. 서버 인자를 **하나도 추가하지 않는다.**
- 업무: 상태 알약(`segmentedToggle.tsx` — 전체/진행 중/완료) + 분류 셀렉트(응답의 `category` 집합) + 검색(제목). 문서: 분류 + 검색. 파일: 종류(이미지/문서/기타 — mime 파생) + 검색.
- 한 줄은 `components/Common/filterBar.tsx` 껍데기(높이 36 · 축 이름은 셀렉트 밖). 필터 결과 0건 문구 ko/en.
- 필터·분류 UI 는 목록이 **1건 이상일 때만** 그린다(빈 탭에 필터줄은 소음).

### 근거
서버 인자는 무인증 표면의 **질의 자유도**를 넓힌다(검색어로 존재 여부 탐색 — 지금은 200건 전체가 어차피 나가지만, 정렬·검색 인자를 열면 그 뒤 페이지네이션과 함께 열거 도구가 된다) → R=1 이 되는데 필요가 없다. 200건 안에서는 화면이 충분하고, 그 밖은 3차(페이지네이션)의 일이다.

### 하지 말 것
`?q=`·`?status=`·`?sort=` 서버 인자 · 정렬 변경 · 200 상한 변경 · 필터 상태 URL 싱크(탭만 URL, 필터는 탭 안 상태 — 공유 URL 에 검색어를 싣지 않는다).

### R·S·F
F=1 — 필터 후 행 수 == 클라이언트 predicate 로 센 수, 네트워크 요청 수 **불변**(필터 조작 중 `/api/guest/` 호출 0건).

---

## G. 고객 등록 동선 — 설계 §4.2 복원 + 문 하나

### 결정
1. **`pages/Guest/LoginRequiredSheet.tsx` 한 부품** — 문서·파일의 자기 시트를 지우고 이것으로. 변형 `reason: 'locked-doc' | 'locked-file' | 'download' | 'register'`.
   버튼 둘: **[로그인]** → `/login?redirect=` + `encodeURIComponent('/g/<token>?tab=<tab>')` (**`redirect`** — `LoginPage.tsx:482`가 읽는 이름. 설계 §4.2 의 `next` 는 오기) · **[계정 요청하기]** → 이메일 칸 + 기존 `POST /api/guest/:token/account-request`. 보낸 뒤 «요청 보냄 — 담당자가 초대 메일을 보내면 계정을 만들 수 있어요»(`ctx.account_requested` 와 같은 상태).
   `role="dialog" aria-modal` + 3훅(지금 시트와 같음).
2. **프로젝트 화면 헤더 오른쪽에 «고객으로 등록» 버튼**(secondary 톤, `data-testid="guest-register"`) → 같은 시트 `reason:'register'`. 문구: *«이 링크로는 보기만 할 수 있어요. 파일 받기·청구서·업무 확인은 고객 계정으로 워크스페이스에 들어오면 돼요.»* 이미 요청했으면 버튼 라벨이 «요청 보냄». 배너(대화 화면의 그것)는 프로젝트 화면에 **얹지 않는다** — 읽으러 온 사람 위에 띠를 두지 않는다는 원칙(§7.1)은 유지하고, 문은 버튼 하나로 항상 있다.
3. **`auth-check` 를 쓴다.** 마운트 때 `getAccessToken()` 이 있으면 `GET /api/guest/:token/auth-check` 1회(`apiFetch`). `canAccess=true` → 헤더 오른쪽이 «고객으로 등록» 대신 **[앱에서 열기]**(`appUrl`, 새 탭 아님 — 같은 창) · `false` → 시트 안에 «이 프로젝트에 초대된 계정이 아니에요. 담당자에게 계정 요청을 보내세요» 한 줄(설계 §4.2 문구 그대로, i18n 키 `login.notInvited` 이미 설계됨).
4. 가입 화면으로 **보내지 않는다** — `auth.js:216` 새 워크스페이스 생성 판정 유지. 계정은 멤버의 초대 메일 한 곳.

### 근거
Irene: *"고객으로 등록하기 해서 워크스페이스 들어가게"* — 지금은 프로젝트 화면에 **그 문이 없다**(`:117-126` early return 으로 배너에 못 닿는다). 설계 §4.2 는 이미 이 동선을 그렸고 서버(`guest_auth.js`)는 완성돼 있다. 새로 설계할 것이 없고 **화면이 안 붙은 것**이다(memory `feedback_backend_done_ui_missing`).

### 하지 말 것
가입 링크 · 자동 리다이렉트(`canAccess` 여도 사용자가 눌러야 한다 — N+72-3) · `OpenInAppBanner` 를 `/g/` 에 켜기 · 시트를 탭마다 따로 그리기.

### R·S·F
F=1 — `auth-check` 무토큰 401 / 무관 계정 `false` / 프로젝트 고객 `true`+`appUrl` 라우트 실존(`/projects/p/:id`) · 시트 두 버튼 좌표·가시성 3폭 · [로그인] href 의 `redirect` 가 되돌아오는가(로그인 후 `/g/<token>?tab=docs` 착지).

---

## H. 카나리 — `scripts/e2e/canary-guest-project.js` (`--suite guestproject`)

이 표면은 지금 **아무 기계도 안 잰다.** C~G 를 구현하기 **전에** 이 파일을 만들고, 각 항목의 F 판정을 여기 싣는다.
- 픽스처: 프로젝트 1 + 업무(마일스톤 1·고객 담당 1·멤버 담당 2·완료 1) + 문서(general·internal·confidential·L1) + 파일(L4 png·L2 png·internal) → 끝나면 **원복**.
- 잰다: ①탭별 본문 x 집합(3폭) ②카드 열 수 ③`preview_url` 유무 4케이스 ④담당자 라벨(토글 on/off 두 번, 응답 원문 `@` 0건) ⑤필터 중 네트워크 0건 ⑥시트 버튼 둘 + `redirect` 착지 ⑦(§B) POST 2회 → 행 1·`reused`.
- 양성 대조군 최소 2: 문서 탭 `Scroll` 복원 → ① 뒤집힘 · L2 에 `preview_url` 강제 → ③ 뒤집힘.

---

## 근거 코드 인덱스
| 무엇 | 어디 |
|---|---|
| 담당자 표시명 | `dev-backend/routes/guest_project.js:60-71, 87-100` · `routes/guest.js:43` |
| 워크스페이스 이름 식 | `services/billing.js:246` (`brand_name \|\| name`) |
| 설정 JSON·라우트·화면 | `models/Business.js:294` · `routes/businesses.js:1425-1445` · `pages/Settings/PermissionsSettings.tsx:70-80` |
| 토큰 파생(개인) | `services/guest_link.js:340-370` (`personalTokenFor`·`mintPersonalToken`) |
| 발급 두 라우트 | `routes/projects.js:1113-1160` · `routes/guest_admin.js:60-115` |
| 모달 | `components/QTalk/GuestLinkButton.tsx:65-90, 163, 178-186` |
| 껍데기 원본 | `pages/Guest/GuestProjectPage.tsx:253-259` (Scroll) · `GuestDocsTab.tsx:171-245` · `GuestFilesTab.tsx:148-201` |
| 카드 숫자 원본 | `pages/QProject/DocsTab.tsx:2726-2760` (미커밋 편집 중 — 건드리지 말 것) |
| 썸네일 무인증 경로 | `routes/files.js:245-312` · `services/filePreview.js:79` |
| auth-check | `routes/guest_auth.js` · 로그인 되돌아오기 `pages/Login/LoginPage.tsx:480-488` (`?redirect=`) |
| 운영 실측 | guest_links `#1 #3 #5`(프로젝트 3) · `teams` 0행 · `GUEST_LINK_SECRET` 62자(운영·dev) |
