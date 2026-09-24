# 고객 진입 설계 — «처음 닿는 시점» 의 완성도 (CLIENT_ENTRY_DESIGN)

> 2026-09-24 · Fable 전략기획·설계. **코드 변경 없음(읽기 전용 조사).** 구현은 이 문서의 §5 단계 순서로 Opus.
> 선행 정본: `docs/Q_SALE_DESIGN.md`(고객 축) · `docs/GUEST_LINK_DESIGN.md` + `docs/PROJECT_EXTERNAL_VIEW_DESIGN.md` +
> `docs/GUEST_PROJECT_VIEW_DECISIONS.md`(게스트 표면). 이 문서는 그 셋을 **뒤집지 않고 잇는다.**
> 뒤집는 항목은 한 건뿐이다 — GUEST_LINK §10 이 스케치한 `/w/{slug}/contact` **공개 슬러그 폼은 만들지 않는다**(§3-D1).

## 0. Irene 원문 (요약하지 않는다)

> *"고객이 미팅이나 상담을 예약하고 그게 Q sale와 연결되서 Q calendar랑도 관리될 수 있어? 고객 프로젝트 페이지에서 고객이 체크하거나
> 고객 이메일을 관리자가 등록하면 알아서 관리되는 건데 신청을 어떻게 받지?*
> *고객에게 제공하는 워크스페이스 서비스 웹페이지 만들면 어때? 고객에게 워크스페이스 안내하고 그리고 문의 남기고 채팅남기고 상담신청
> 일정 남기면 담당자가 승인 및 수정요청 하고, 이거 프로젝트 고객페이지랑 접목해서 프로젝트가 있는 고객은 거기까지 보이고.*
> *그러니까 처음 고객이 접근하는 시점에 대한 완성도있는 보완이라고 보면 어때? 그 이후 고객의 움직임과 루트가 혼란스럽지 않게 하는 거야.
> 완벽한 고객유도 프로세스 전략기획을 하고 ui/ux 설계할 수 있어?*
> *고객은 자기 문의리스트도 봐야 하네. 채팅과 다르게. 지금 문의 없지? 가입 전후의 고객을 분리해? 아니면 이메일 정보를 무조건 고객이나
> 관리자가 입력해서 활용해? 지금 체계에서 어떤 맥락으로 구조가 최적화 가능한지 봐줘."*

핵심 문장은 **«그 이후 고객의 움직임과 루트가 혼란스럽지 않게»** 다. 그래서 이 설계의 판정 기준은 하나다 —
**고객이 어느 시점에 들어오든 같은 주소 체계·같은 신원·같은 원장으로 이어지는가.**

---

## 1. 현황 진단 — 사실과 근거

### 1.1 «처음 닿는» 표면은 지금 **5개**이고, 워크스페이스 공개면은 **없다**

| # | 표면 | 주소 | 누구의 것 | 신원 | 근거 |
|---|---|---|---|---|---|
| ① | 랜딩(소개·기능·요금·인사이트·Q위키·**문의**) | `/`, `/features`, `/pricing`, `/contact`, `/insights/*` | **PlanQ 플랫폼**의 것 | 없음 | `App.tsx:648-660` · `seo-pages.json` |
| ② | 게스트 링크 | `/g/<token>` (scope `conversation` / `project`) | **워크스페이스**의 것 | 그림자 User + (선택) 이메일 OTP 개인 링크 | `routes/guest*.js` · `models/GuestLink.js:36,88-116` |
| ③ | 공개 링크(문서·청구서·서명·일정·파일·보고서·회의) | `/public/*/:token`, `/sign/:token` | 워크스페이스의 것 | 없음(토큰 소지) | `App.tsx:631-643` |
| ④ | 초대 메일 | `/invite/:token` → `/register?invite_token=` | 워크스페이스의 것 | **계정 생성 유일 경로** | `routes/invites.js` · `emailService.js:472` · `auth.js:236-246` |
| ⑤ | 로그인 앱(고객 역할) | `/inbox` 착지 → `/talk` `/tasks` `/projects` `/calendar` `/bills` | 워크스페이스의 것 | `clients.user_id` | `App.tsx:183` · `config/navMenus.ts:40-50` |
| — | **워크스페이스 서비스 웹페이지** | — | — | — | **없음(grep 0건)** — `path="/w/`·`/ws/`·`by-slug`·`public-profile` 전부 0건. `businesses.slug` 는 있으나 읽는 공개 라우트가 없다 |

★ ②의 게스트 화면은 **워크스페이스 이름조차 싣지 않는다** — `routes/guest.js`·`guest_common.js`·`guest_project.js` 에 `brand_name` 0건.
고객은 «누구의 링크인지» 를 카톡 문맥으로만 안다. 처음 닿는 화면에 발신자가 없다.

### 1.2 경로도 — 어디서 이어지고 어디서 끊기는가

```
[손님]                                                          [워크스페이스 팀]
  │
  ├─ ① 랜딩 /contact ──POST /api/inquiries──▶ contact_inquiries ──▶ platform_admin 만 알림      ✗ 워크스페이스로 안 간다
  │        (kind landing|enterprise · 문의 유형 = 도입/기술지원/제휴)                               (PlanQ 도입 문의 창구 — 맞는 동작)
  │
  ├─ ② /g/<token> (conversation) ──메시지──▶ conversations(customer) ──▶ Q Talk · Q sale «상담» 탭 ✓ 이어짐
  │        ├─ [답글 알림 신청] 이름+이메일+OTP ──▶ guest_links(personal, contact_email, email_verified_at)   ✓ 신원 생김
  │        └─ [계정 요청하기] ──▶ link.account_requested_at + 멤버 알림(+Q sale 알림은 link.client_id 있을 때만) ✓
  │              └─ 멤버 [초대 보내기] ──▶ ④                                                     ✓ (사람 한 번 클릭)
  │
  ├─ ② /g/<token> (project) ── 개요·업무·문서·파일·대화 ──▶ 위와 같은 대화방                     ✓ (오늘 §G 로 등록 문 추가 예정)
  │
  ├─ ③ /public/invoices|posts|sign ── 읽기·결제·서명 ──▶ 원본 엔티티                             ✓  단, 여기서 «문의» 로 가는 문 없음
  │
  ├─ ④ /invite/:token ──▶ /register(invite_token) ──▶ clients.user_id + status active            ✓ 계정
  │        └─ clientOnboarding: customer 대화방 + 환영 메시지 자동                              ✓
  │
  └─ ⑤ 로그인 고객 ──▶ /inbox(청구·컨펌) · /talk · /projects · /calendar(참석 일정만) · /bills    ✓
           ├─ «내 문의 목록»                                                                    ✗ 없음
           ├─ «상담·미팅 신청»                                                                  ✗ 없음 (일정 생성 403 — event_actions.js:70)
           └─ /me/feedback(문의·피드백)                                                          = PlanQ 에 대한 문의. 고객 역할은 사이드바에서 숨김(MainLayout.tsx:1563)
```

**끊기는 곳은 세 군데다.**
1. **워크스페이스로 향하는 «문» 이 없다.** 손님이 스스로 두드릴 수 있는 문은 ①뿐인데 그 문은 PlanQ 로 간다. 워크스페이스 문(②)은 **멤버가 먼저 링크를 만들어 건네야** 열린다. 즉 지금 체계에서 «신청을 어떻게 받지?» 의 답은 **«못 받는다 — 팀이 먼저 링크를 보낸다»** 다.
2. **시간을 고르는 면이 없다.** 고객이 미팅을 원하면 채팅에 글로 쓰고, 멤버가 Q calendar 에서 일정을 만들어 고객을 참석자(`client_id`)로 넣는다. 그 뒤 고객에게 가는 알림은 **스텁**이다(`event_actions.js:307` *"client attendee 는 별도 채널 (추후)"*). 운영 `calendar_event_attendees.client_id IS NOT NULL` **0건**, dev 0건 — 이 경로는 한 번도 쓰이지 않았다. Q sale 설계 §5.5 «일정 잡기» 는 **미구현**(`pages/QSale/` 에 `calendar` 0건).
3. **고객이 «내가 남긴 것» 을 다시 보는 자리가 없다.** 게스트는 대화 하나, 로그인 고객은 대화방 목록뿐이다. 건(件)으로 남는 것 — «언제 무엇을 요청했고 지금 어느 상태인가» — 를 보는 화면이 없다.

### 1.3 «문의» 는 두 원장이 맞다 — 그런데 **둘 다 고객→워크스페이스 문의가 아니다**

| 원장 | 누가 | 어디로 가나 | 근거 |
|---|---|---|---|
| `contact_inquiries` | 손님(무인증, 토큰 있으면 사용자 연결) | **`notifyPlatformAdmins`** — PlanQ 운영팀. `business_id` 는 «문의자가 속한 워크스페이스» 표기일 뿐 수신처가 아니다 | `routes/inquiries.js:104-131` |
| `feedback_items.kind='inquiry'` | 로그인 사용자 | **`notifyPlatformAdmins`** — PlanQ 운영팀 | `routes/feedback.js:120-137` · `CueHelpDrawer.tsx:9,30` |

→ Irene 의 *"지금 문의 없지?"* 는 **맞다.** 고객이 워크스페이스에 남기는 «문의 건» 원장은 없다. 그 자리를 지금 **대화방(`conversations.channel_type='customer'`)** 과 **메일 스레드** 가 대신하고, Q sale «상담» 탭이 그것을 `client_id IS NULL` 축으로 모아 보여 준다(Q_SALE §5.2-A). 채팅은 흐름이라 «건» 이 아니다 — Irene 이 *"채팅과 다르게"* 라고 한 정확히 그 차이다.

**결정(§3-D3):** 두 플랫폼 원장은 그대로 둔다(합치지 않는다 — 수신처가 PlanQ 라 워크스페이스 문의와 섞으면 격리가 깨진다). 고객→워크스페이스 «문의 건» 은 새 표를 만들지 않고 **상담 신청 = `calendar_events` 행**, **자유 문의 = 그 방문자의 customer 대화방** 으로 가른다(§4.3). «내 문의 목록» 은 이 둘을 한 화면에 모은 것이다.

### 1.4 예약 — 있는 부품과 없는 부품

| 부품 | 상태 | 근거 |
|---|---|---|
| 일정 + 참석자(멤버 `user_id` / 고객 `client_id`) · 고객 본인 RSVP | **있음** | `calendar.js:855-905` · `attendedEventIds` 한 원천 |
| Google Calendar 동기화 · Meet 자동 생성(`auto_create_meeting`) | 있음 | `event_actions.js` · `google_calendar.js:253` |
| 워크스페이스 근무시간 | **있음, 미사용** | `businesses.work_hours JSON`(`Business.js:121`) |
| 상담 원장이 일정을 가리키는 칸 | **이미 있음** | `client_interactions.calendar_event_id` · `source_kind ENUM … 'calendar'`(`ClientInteraction.js:16,27`) — 설계가 이 연결을 예비해 두었다 |
| 고객이 시간을 고르는 화면 | **없음** | grep `booking|appointment|availability|time.?slot` — 프론트 0건(매치된 파일은 전부 다른 뜻) |
| 일정의 «신청 → 승인/수정 → 확정» 상태 | **없음** | `CalendarEvent` 에 status 계열 컬럼 없음(`CalendarEvent.js` 전수) |
| 고객 참석자 알림·메일 | **없음(스텁)** | `event_actions.js:307` |
| 고객의 일정 생성 | **403** | `event_actions.js:69-70` · `calendarPermission.js:20` — **유지한다**(고객이 팀 캘린더에 직접 쓰면 안 된다). 신청은 «생성» 이 아니라 «요청» 이다 |

### 1.5 이메일 — Irene 질문의 답

> *"가입 전후의 고객을 분리해? 아니면 이메일 정보를 무조건 고객이나 관리자가 입력해서 활용해?"*

**분리하지 않는다. 그리고 «무조건» 도 아니다 — 이메일은 «행동이 필요한 순간» 에 받고, 그때부터 한 행의 열쇠가 된다.** 지금 구조가 이미 그렇다:

- 고객은 **한 행(`clients`)** 이고 상태만 `prospect → invited → active` 로 흐른다. 접근 종류는 컬럼이 아니라 파생(`services/clientAccess.js accessKindOf`). 가입 전후를 **표로 가르면** 이력·타임라인·단계가 두 벌이 된다 — Q_SALE §3.1 D1 이 이미 이 결정을 내렸고 맞다.
- 가입 전 신원의 열쇠는 **이메일 하나**다: 게스트 `guest_links.contact_email + email_verified_at`(OTP) → `save-as-client` 가 `findExistingByContact` 로 **같은 이메일이면 새로 만들지 않고 잇는다**(`sale_save.js:328`) → 초대는 `clients.invite_email` → 수락 시 같은 행에 `user_id`.
- 그러므로 «관리자가 입력» 과 «고객이 입력» 은 **같은 칸에 도착하는 두 문**이다. 어느 쪽이 먼저든 한 행이다.
- **받는 시점:** 읽기만 하는 사람에게는 묻지 않는다(GUEST_LINK 원칙 — *"읽으러 온 사람 위에 띠를 두지 않는다"*). **남기려는 순간**(답글 알림·계정 요청·상담 신청·문의 목록 보기)에 OTP 로 받는다. 상담 신청은 예외 없이 이메일 확인이 선행이다 — 시간을 잡아 놓고 연락할 길이 없으면 예약이 아니다.
- **개인정보 보존은 지금 규칙 그대로** — 미확인 24시간·회수/만료 후 30일 삭제(`services/guestContactCleanup.js`). 상담 신청으로 `clients` 행이 생기면 그때부터는 고객 데이터다(prospect).

**운영 실측(2026-09-24, 읽기 전용):** 운영 워크스페이스 8 · 고객 12(prospect 4 · invited 4 · member 3) · 살아 있는 게스트 링크 3 · 이메일 확인 게스트 **0** · 계정 요청 **0** · `contact_inquiries` **0** · 상담 원장 2 · 고객 참석 일정 **0**. dev: 고객 39(prospect 1·invited 20·member 13) · 확인 게스트 3 · 계정 요청 1 · 상담 10(미팅 3) · 고객 참석 0.
→ 규모가 작다. **지금은 표를 늘릴 때가 아니라 문을 이을 때다.** 아직 아무도 걷지 않은 길(고객 참석 일정 0)에 새 표를 세우면 그 표가 곧 두 번째 원장이 된다.

### 1.6 발주자(호출 프롬프트) 조사의 검증

| 진술 | 판정 |
|---|---|
| 문의 축이 두 갈래(`contact_inquiries` / `feedback_items.inquiry`) | 맞다. **정정:** 둘 다 **PlanQ 로 가는** 문의다(§1.3). «워크스페이스 문의 원장» 은 0개다 |
| 게스트 «계정 요청하기» 가 멤버 알림 + Q sale 알림까지 | 맞다. **조건 하나:** Q sale 알림은 `link.client_id` 가 있을 때만(`guest.js:199`). 미등록 게스트의 요청은 대화방 참가자 알림만 간다 |
| Google Meet/Calendar 연동 있음 | 맞다. 단 **고객 참석자에게는 어떤 알림도 안 간다**(§1.4) |
| 가입 화면으로 직접 보내지 않는다(`auth.js:216`) | 맞다(`auth.js:236-246` 초대 토큰 분기). 이 설계도 유지한다 |
| `attendedEventIds` 한 원천 · 고객 참석자 `client_id` | 맞다(`calendar.js:305-313`) |

---

## 2. 무엇이 «혼란» 을 만드는가 — 구조로 읽기

고객이 겪는 혼란은 화면이 못생겨서가 아니라 **표면마다 신원·주소·원장이 다르기 때문**이다.

| 축 | 지금 | 결과 |
|---|---|---|
| 주소 | `/g/…` · `/public/…` · `/invite/…` · `/contact` · 앱 | 어느 것이 «우리 회사 창구» 인지 고객이 모른다. 링크마다 다른 모양의 화면 |
| 신원 | 그림자 User · OTP 개인 링크 · 계정 | 같은 사람이 세 번 «누구인지» 를 증명한다 |
| 원장 | 대화방 · 메일 스레드 · (없는) 문의 건 · (없는) 예약 | 팀은 Q sale 에서 모아 보지만 **고객 쪽에는 모아 보는 자리가 없다** |
| 발신자 | 게스트 화면에 워크스페이스 이름 없음 | «누가 보낸 링크인가» 를 화면이 말하지 않는다 |

설계는 이 네 축을 **각각 하나로** 만든다: 주소 = `/g/<token>` 한 계열 · 신원 = 이메일 한 열쇠(§1.5) · 원장 = 기존 것(대화방·`calendar_events`·`client_interactions`) · 발신자 = 모든 게스트 화면 머리에 워크스페이스.

---

## 3. 전략 결정

### D1. «워크스페이스 서비스 웹페이지» 는 **만든다 — 그러나 4번째 표면이 아니라 게스트 링크의 세 번째 scope 로**

- `guest_links.scope` ENUM 에 **`workspace`** 를 append 한다(2026-09-05 `project` 추가와 같은 멱등 스크립트, 기본값 `conversation` 유지 — 나가 있는 링크는 넓어지지 않는다).
- 주소는 그대로 **`/g/<token>`** 이다. 화면 껍데기는 오늘 결정된 `GuestTabPane`(READ_W 880) 하나. 탭이 «안내 · 문의(채팅) · 상담 예약 · 내 문의 · 프로젝트» 로 늘 뿐이다.
- **공개 슬러그 `/w/:slug` 는 만들지 않는다.** 이유 셋 —
  ① **열거·스팸 표면**이 하나 더 생긴다(R=1). 지금 게스트 링크의 스팸 방어(토큰별·IP별 리밋, `guest_links_enabled` 킬스위치, OTP)는 전부 «토큰을 아는 사람» 전제 위에 있다. 슬러그는 그 전제를 무너뜨린다.
  ② **운영 워크스페이스 8곳**이다. 공개 페이지를 «검색으로 찾아오는» 유입은 지금 이 규모에서 0에 가깝고, 실제 유입은 명함·카톡·메일 서명·제안서 링크 — **전부 링크를 건네는 동선**이다. 토큰 링크가 곧 그 용도다.
  ③ 회사가 자기 홈페이지·네이버 플레이스에 «문의하기» 버튼을 달고 싶다면 **이 토큰 링크를 거기 붙이면 된다.** 나중에 «짧은 주소» 가 정말 필요해지면 `businesses.slug` → 살아 있는 workspace 링크로 302 하는 **얇은 별칭**을 opt-in 으로 붙일 수 있다(§5 P4). 그것은 표면이 아니라 별칭이다.
- CLAUDE.md «새로 만들지 않는다 — 기존 것을 찾아서 쓴다» 와 정확히 같은 결론이다: 게스트 링크는 이미 신원(OTP)·대화방·계정 요청·Q sale 유입·킬스위치·감사·재사용(오늘 §B 멱등 발급)을 다 갖고 있다. 없는 것은 **워크스페이스 단위의 발급**과 **탭 셋**뿐이다.

### D2. 고객의 «하나의 문» = `/g/<token>` — 주소 체계

```
/                       PlanQ 랜딩 — PlanQ 도입 문의만. 워크스페이스 고객 동선과 섞지 않는다(§4.1 문구 한 줄만)
/g/<workspace token>    워크스페이스 홈  ┐  같은 화면 계열(GuestTabPane). scope 가 탭을 정한다:
/g/<project token>      프로젝트 열람    ├    workspace: 안내·문의·상담 예약·내 문의·(프로젝트 = 잠김/앱에서 열기)
/g/<conversation token> 대화만           ┘    project:   개요·업무·문서·파일·대화 (+ 머리에 워크스페이스·[내 문의])
                                               conversation: 대화 (+ 머리에 워크스페이스)
/public/*/:token        자료 링크 — 그대로. 바닥에 «{워크스페이스}에 문의» 한 줄이 workspace 링크로 간다(있을 때만)
/invite/:token          계정 생성 유일 경로 — 그대로
앱 (로그인 고객)         /home = 같은 워크스페이스 홈 컴포넌트를 app 모드로 얹는다. 나머지 메뉴 그대로
```

- **한 워크스페이스에 workspace 링크는 살아 있는 것 하나**(오늘 §B 멱등 발급을 같은 함수로 — `findLiveSharedLink({scope:'workspace'})`). 설정 화면 «고객 창구» 카드에서 주소·QR·[복사]·[교체].
- 방문자가 이메일을 확인하면 **개인 링크(`kind='personal'`)** 가 생기고, 그 사람의 «내 문의» 는 개인 링크 주소에서만 열린다(지금 `notify/me` 가 personal 만 받는 것과 같은 규칙). 공유 링크 소지자 전원이 남의 문의를 볼 수 없다.
- 프로젝트 내용은 **workspace 링크로 넓히지 않는다.** «프로젝트가 있는 고객은 거기까지» 는 두 길로만 — ① 팀이 발급한 project 링크(기존) ② 로그인(`auth-check` → [앱에서 열기], 오늘 §G). OTP 이메일은 로그인보다 약하다 — 이메일 일치만으로 프로젝트를 열면 그것이 곧 가시성 확대 통로다.

### D3. 가입 전/후는 **합친다** — 구분은 «접근 종류» 로만, 이미 있는 대로

- `clients` 한 행 · `accessKindOf` 파생 · 계정은 초대 메일 한 곳. **바꾸지 않는다.**
- 상담 신청은 **prospect 행을 만든다**(있으면 잇는다). 게스트 채팅은 지금처럼 **사람이 [고객으로 등록]** 한다. 차이의 이유: 예약은 «연락처 + 시간» 이 있어야 성립하는 **행동**이고, 채팅은 아직 관계가 아니다. 예약을 받았는데 고객 행이 없으면 참석자(`client_id`)를 못 만든다.
- 로그인 고객의 «홈» 과 게스트의 «홈» 은 **같은 컴포넌트, 다른 모드**(`scope` prop — 2026-09-13 QNotePage 와 같은 방식). 가입했다고 다른 화면이 나오면 그것이 곧 «루트가 혼란스러운» 순간이다. 로그인하면 잠긴 탭이 열릴 뿐이다.

### D4. 상담 신청은 «업무» 도 «상담 기록» 도 아니다 — **일정** 이다

- CLAUDE.md: 상담(`client_interactions`)은 «있었던 일의 기록» 이라 상태가 없다. 신청은 **아직 없었던 일**이라 그 표에 못 들어간다.
- 신청 → 승인/수정 → 확정은 곧 **시간이 정해지는 과정**이므로 그 상태는 `calendar_events` 에 붙는다(컬럼 하나 — §4.4). 확정된 미팅이 **끝나면** `client_interactions(kind='meeting', source_kind='calendar', calendar_event_id)` 가 생긴다 — 이미 예비된 칸이다.
- 단계는 `sales_stage` 한 문(`setStage`)으로 — 신청 접수 = `inquiry`, 확정 = `consulting`(origin `auto`, reason «상담 예약 확정»). 이미 그보다 뒤 단계면 건드리지 않는다(단계는 되돌리지 않는다).

---

## 4. UI/UX 설계 — 텍스트 와이어 (코드 금지)

공통 규격은 오늘 `GUEST_PROJECT_VIEW_DECISIONS.md` §C(껍데기 `GuestTabPane`·READ_W 880·`data-testid="guest-tab-body-<key>"`)와 §G(`LoginRequiredSheet`)를 그대로 쓴다. 폰 우선(카톡에서 눌러 들어온다).

### 4.1 랜딩 — 바꾸지 않는다. 한 줄만

`/contact` 문의 유형(도입·기술 지원·제휴·그 외) 위에 회색 한 줄:
> *«거래 중인 회사에 문의하시려면 그 회사가 보낸 링크(또는 초대 메일)로 들어가 주세요. 이 창구는 PlanQ 도입·지원 문의입니다.»* (ko/en)

잘못 들어온 문의를 **PlanQ 운영자가 손으로 돌려보내는 일**을 없앤다. 그 이상은 하지 않는다 — 랜딩은 PlanQ 의 것이다.

### 4.2 워크스페이스 홈 — `/g/<workspace token>`

```
┌──────────────────────────────────────────────────────────────────────┐
│ [로고] 워프로랩                                     [로그인] [고객으로 등록] │  ← 밴드1 (모든 scope 공통. 발신자를 화면이 말한다)
│  브랜드 태그라인 한 줄                                                     │
├──────────────────────────────────────────────────────────────────────┤
│  안내 │ 문의하기 │ 상담 예약 │ 내 문의 │ 프로젝트 🔒                        │  ← 탭 (GuestTabPane, 880 가운데)
├──────────────────────────────────────────────────────────────────────┤
│  (신원 띠 — 확인 전)  ✉ 이메일을 확인하면 문의·예약을 남기고 다시 볼 수 있어요  [확인하기] │
│  (신원 띠 — 확인 후)  홍길동 · h***@company.com   [알림 끄기] [내 정보 지우기]         │
└──────────────────────────────────────────────────────────────────────┘
```

| 탭 | 내용(위계 순) | 동작 | 데이터 |
|---|---|---|---|
| **안내** | 소개 문단 · 제공 서비스(항목 3~6) · 연락처(전화·이메일·주소·근무시간) · 주요 버튼 **[문의하기] [상담 예약]** | 버튼은 탭 이동 | `businesses` 기존 컬럼(`brand_*`, `phone`, `email`, `website`, `address`, `work_hours`) + **`permissions.customer_entry.intro`**(소개·서비스 항목 JSON — 새 컬럼 없음, 설정 «고객 창구» 카드에서 AutoSaveField) |
| **문의하기** | 채팅(기존 `GuestChatPanel`) | 확인 전: 읽기 전용 안내 + [확인하기]. 확인 후: 본인 대화방에 글 | 개인 링크 → **본인 customer 대화방**(§4.5) |
| **상담 예약** | §4.3 | — | — |
| **내 문의** | §4.4 | — | — |
| **프로젝트 🔒** | 잠김 캡션 «초대된 고객 계정으로 로그인하면 프로젝트를 볼 수 있어요» | 누르면 `LoginRequiredSheet(reason:'register')`. 로그인 + `auth-check` true 면 탭이 **[앱에서 열기]** 로 바뀐다 | 오늘 §G 그대로 |

- 신원 띠는 `GuestNotifySection`(이름·이메일·OTP·동의) **그대로** 재사용한다 — 문구만 «답글 알림» 에서 «문의·예약» 으로. 확인이 곧 개인 링크 발급이고, 이후 화면은 **개인 링크 주소**로 옮겨간다(주소창이 바뀐다 — 그 주소가 «내 자리» 다. 저장하라고 한 줄 안내).
- conversation·project scope 링크도 **밴드1 은 같다**(워크스페이스 이름·로고). 오늘 «담당자 이름 대신 워크스페이스 이름» 결정(§A)과 같은 값(`brand_name || name`)이다.

### 4.3 상담 예약 — 3단

```
① 용건                      ② 시간                         ③ 확인
┌──────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
│ 어떤 상담인가요?        │   │ 9월 26일(금)               │   │ 신규 프로젝트 상담 · 30분     │
│ (○ 신규 프로젝트 ○ 견적 │   │ ◀  월 화 수 목 금 ▶         │   │ 9/26(금) 14:00–14:30 KST    │
│  ○ 진행 중 건 ○ 기타)   │   │ [10:00][10:30][11:00]      │   │ 화상(Meet 링크는 확정 후)     │
│ 한 줄 메모 (선택)       │   │ [14:00][14:30] …           │   │ 홍길동 · h***@company.com    │
│                       │   │ 표시 시간대: Asia/Seoul ▾   │   │ [신청 보내기]                │
│ [다음]                 │   │ [다음]                     │   │ ← 담당자가 확인 후 확정합니다  │
└──────────────────────┘   └──────────────────────────┘   └──────────────────────────┘
```

- **슬롯은 서버가 계산한다** — `work_hours` ∩ (담당 멤버의 기존 일정 제외) ∩ (지금 + 최소 리드타임) 을 **30/60분 격자**로. 응답은 `["2026-09-26T05:00:00Z", …]` **시작 시각 배열뿐**이다. 제목·상대·일정 수 어느 것도 안 나간다. 게스트가 보는 것은 «비어 있음» 뿐이며 «왜 막혀 있는지» 는 말하지 않는다.
- 담당 멤버 = `clients.assigned_member_id`(있으면) → 설정 `customer_entry.booking.member_id` → owner. 라운드로빈·다중 담당은 **하지 않는다**(요청 없음).
- 신청 시각의 **표시 시간대는 방문자 브라우저**, 저장은 UTC. 확인 화면에 두 시간대(방문자·워크스페이스)를 같이 적는다 — 해외 고객이 있는 워크스페이스(`reference_timezones`)에서 «몇 시인지» 가 틀리면 예약이 아니라 사고다.
- **[신청 보내기]** 는 확인 이메일이 있어야 활성. 없으면 버튼 비활성 + 이유(«이메일을 먼저 확인해 주세요» — 눌리는데 400 은 «아무 일도 안 일어남» 이다).
- 보낸 뒤: «신청을 보냈어요. 담당자가 확인하면 이 주소와 이메일로 알려 드려요» + [내 문의 탭으로].

### 4.4 내 문의 — «채팅은 대화, 문의는 건(件)» 을 한 줄로 가르는 화면

```
┌ 내 문의 ──────────────────────────────────────────────────────────┐
│  상담·미팅                                                      │
│  ● 확인 대기   신규 프로젝트 상담 · 9/26(금) 14:00 · 30분   [취소]     │
│  ● 시간 변경 제안  담당자가 9/29(월) 11:00 를 제안했어요  [수락] [다른 시간] │
│  ● 확정      견적 상담 · 9/22(월) 10:00 · Meet 링크 [열기]  [일정 파일 .ics] │
│  ○ 끝남      9/10 첫 상담 · 30분                                     │
│  ─────────────────────────────────────────────────────────────  │
│  대화                                                           │
│  💬 워프로랩과의 대화 · 마지막 답변 어제 15:20 · 안 읽음 2   [열기 →]        │
└──────────────────────────────────────────────────────────────────┘
```

- **위 = 상태가 있는 것(일정)** · **아래 = 흐름(대화)**. 두 묶음 사이 구분선 하나가 «채팅과 다르게» 의 전부다. 문의 건에 댓글 스레드를 따로 만들지 않는다 — 건에 대한 말은 대화에서 한다(그래야 팀 쪽 원장이 둘이 안 된다). 각 건의 [문의하기]는 대화 탭으로 가며 그 건을 인용 카드로 첫 줄에 넣는다.
- 상태 라벨(고객 관점): **확인 대기 · 시간 변경 제안 · 확정 · 취소됨 · 끝남**. 팀 관점 라벨은 §4.6. ko/en 동시.
- 로그인 고객(app 모드)은 같은 화면이 `/home` 의 «내 문의» 탭이다. 데이터 축이 `client_id` 라 게스트·로그인 어느 쪽에서도 **같은 건이 보인다**(개인 링크의 `client_id` == 로그인 고객의 `clients.id` — 이메일로 이어져 있다).

### 4.5 팀 쪽 — 새 화면 없음. 있는 자리에 항목이 늘 뿐

| 자리 | 무엇이 보이나 | 동작 |
|---|---|---|
| **확인 필요**(`GET /api/dashboard/todo`) | 새 버킷 «상담 신청» — `verb: 'schedule'` — «홍길동 · 신규 프로젝트 상담 · 9/26 14:00 신청» | [승인] [다른 시간 제안] [거절] — **한 곳에서 끝난다**. `total` 에 합산(부분집합 계약) · `todo.verb.schedule` ko/en |
| **Q calendar** | 신청 상태 일정은 **점선 테두리 + «신청»** 칩. 확정되면 실선 | 상세 드로어 밴드2 에 같은 3버튼 |
| **Q sale › 상담 탭** | 소스 칩 **«예약»** 추가(`saleInbox` 가 `calendar_events.booking_status='requested' AND client 미등록…` 이 아니라 — 신청은 prospect 를 만들므로 **고객 탭**에 바로 뜬다). 상담 탭에는 «답할 차례» 로 세지 않는다(예약은 확인필요가 센다 — 같은 값을 두 곳에서 세지 않는다) | 행 → 고객 상세 |
| **Q sale › 고객 상세 타임라인** | 신청·제안·확정·끝남 이 `calendar` 채널로 한 줄씩 · 끝난 미팅은 `client_interactions` 행으로도 | 기존 `clientTimeline` 에 채널 하나 |
| **설정 › 고객 창구**(`PermissionsSettings` «고객 공개 범위» 카드 옆) | workspace 링크 주소·QR·[복사][교체] · 소개/서비스 항목 · 예약 켜기 · 담당 멤버 · 길이(30/60) · 리드타임(예: 24h) · 하루 최대 건수 | 전부 `AutoSaveField` · `permissions.customer_entry` JSON |

- 알림은 **양방향 기존 문**으로: 팀 → `notifyMany(eventKind:'event')` + Q sale 담당 귀속(`saleNotify.recipientsFor`). 고객 → 개인 링크 이메일(`guest_subscribe` 의 답글 알림 발송 경로 재사용 — `last_notified_at`·`unsubscribed_at` 그대로) + 로그인 고객이면 앱 알림. **확정 메일에는 .ics 첨부** — 고객 캘린더에 들어가야 예약이 끝난다.
- 확정 시 `auto_create_meeting` 이 켜진 워크스페이스는 Meet 링크가 생기고(기존 경로) 고객 메일·내 문의에 실린다. Google 초대 메일은 **보내지 않는다**(우리 메일 한 통으로 끝 — 두 통이면 어느 것이 정본인지 고객이 모른다).

### 4.6 상태 기계 — 어디에 무엇이 저장되는가

```
booking_status (calendar_events, NULL = 보통 일정)
  requested ──[승인]──▶ confirmed ──(end_at 지남)──▶ done(파생·컬럼 아님) ──▶ client_interactions 자동 1행
     │  └──[다른 시간 제안: start/end 갱신]──▶ proposed ──[고객 수락]──▶ confirmed
     │                                            └──[고객: 다른 시간]──▶ requested (새 시간)
     └──[거절] / [고객 취소]──▶ declined | canceled
```

| 사건 | 저장 | 부수효과 |
|---|---|---|
| 신청 | `calendar_events{ booking_status:'requested', created_by:담당 멤버 id, visibility:참석자만, attendees:[{client_id}, {user_id:담당}] , description:용건+메모, created_via:'booking' }` · 없으면 `clients{status:'prospect'}` 생성(`sale_save` 의 `findExistingByContact` + `add_prospect` 한도 **같은 함수**) · `guest_links.client_id` 연결 | `setStage(inquiry, origin:'auto')`(단계 `none` 일 때만) · 확인필요 항목 · 담당 알림 · 감사 `booking.request` |
| 승인 | `booking_status:'confirmed'` | 고객 메일(.ics·Meet) · `setStage(consulting, auto)`(단계가 inquiry 이하일 때만) · Google 동기화(기존) |
| 다른 시간 제안 | `start_at/end_at` 갱신 + `'proposed'` | 고객 메일 «제안» · 내 문의에 [수락][다른 시간] |
| 고객 수락 | `'confirmed'` + 고객 attendee `response:'accepted'`(기존 RSVP 라우트의 게스트 버전) | 승인과 같음 |
| 거절·취소 | `'declined'`/`'canceled'` | 상대에게 알림 · 캘린더에서 흐리게 |
| 끝남 | `end_at < now && confirmed` 를 **파생**으로 판정(컬럼 없음) | cron 이 `client_interactions{kind:'meeting', source_kind:'calendar', calendar_event_id, origin:'auto', occurred_at:start_at}` 1행(멱등 — `calendar_event_id` 유니크 검사) · 확인필요 «상담 기록 확인» 은 기존 `review` 라우트 |

**스키마 변경은 이 둘뿐이다** (§5): `guest_links.scope` ENUM append `'workspace'` · `calendar_events.booking_status ENUM(...) NULL`. 새 표 0.
`customer_entry` 설정은 `businesses.permissions` JSON 안(오늘 §A-1 과 같은 자리) — 컬럼 없음.

### 4.7 프로젝트가 있는 고객 — «거기까지 보인다» 의 표현

같은 페이지의 **탭 하나**다(다른 화면이 아니다).
- 게스트(OTP만): 🔒 잠김. 시트에 [로그인] [계정 요청하기].
- 로그인 + 이 워크스페이스 고객: 탭 라벨이 **«프로젝트 3»** 로 바뀌고, 누르면 앱 `/projects`(app 모드에서는 바로 목록). 게스트 화면 안에 프로젝트 내용을 그리지 않는다 — 팀이 project 링크를 따로 발급한 경우만 그 링크에서 본다(기존).
- 앱 `/home`(client 역할 착지)은 같은 컴포넌트 app 모드: 안내 · 문의(→ `/talk` 의 내 customer 대화방) · 상담 예약 · 내 문의 · 프로젝트 · 청구(→ `/bills`). 지금 `/inbox` 착지는 **유지하되** client 역할만 `/home` 으로(확인필요 항목 — 청구·컨펌 — 은 `/home` 위에 카드로 같이 보인다. 두 화면이 아니라 한 화면에 얹는다).

---

## 5. 구현 단계 · 판정 · 하지 말 것

| 단계 | 내용 | 스키마 | R·S·F | 게이트 |
|---|---|---|---|---|
| **P0 — 잇기** | ① 모든 `/g/` 화면 밴드1 에 워크스페이스 이름·로고(`brand_name \|\| name`, 게스트 응답에 `workspace:{name, logo_url}` 두 필드 — 화이트리스트에 **이 둘만**) ② 랜딩 `/contact` 한 줄(§4.1) ③ `/public/*` 바닥 «{워크스페이스}에 문의» (workspace 링크 있을 때만, 없으면 줄 자체 없음) ④ 오늘 §G(`LoginRequiredSheet`·«고객으로 등록») 와 같은 커밋 묶음 | 없음 | R=0 · S=0 · F=1 | 자체(`--suite guestproject` 확장: 밴드1 이름 3폭·응답에 `@`·`user_id` 0건) |
| **P1 — 문** | workspace scope 링크 발급(멱등, 설정 «고객 창구» 카드) · 워크스페이스 홈 4탭(안내·문의·내 문의(대화만)·프로젝트🔒) · OTP 확인 → 개인 링크 + **본인 customer 대화방** 생성(`GuestLink.conversation_id` 를 그 방으로) · Q sale 상담 탭에 그대로 유입 | `guest_links.scope` ENUM append — 멱등 스크립트 `migrate-guest-link-scope-workspace.js`, **코드 배포 전** | **R=1**(무인증 표면 확장·토큰 체계) · S=0 | **Fable**. 실측: 공유 workspace 링크 `can_write=false` 강제 → POST messages 403 · 개인 링크만 자기 방에 200 · 다른 개인 링크의 방 404 · 옛 conversation/project 링크 응답 **바이트 동일**(양성 대조군) · 킬스위치 `guest_links_enabled=false` 로 전부 404 · OTP 리밋 5종 그대로 |
| **P2 — 예약** | 슬롯 API(무인증, 개인 링크 필수) · 신청(prospect 생성 포함) · 확인필요 버킷 + 승인/제안/거절 · 고객 수락/취소 · 메일(.ics) · 끝남 cron → `client_interactions` · `sales_stage` 자동 전이 · Q calendar 점선 | `calendar_events.booking_status` NULL 컬럼 — 멱등 스크립트, 코드 배포 전 | **R=1**(무인증 표면에서 `clients`·`calendar_events` 쓰기 · 외부 메일 발송 · 단계 전이) · S=1(«무엇이 새는가» 를 슬롯 응답으로 설계) | **Fable — P1 과 한 라운드로 묶는다**(쪼개지 않는다). 실측: 슬롯 응답에 시각 배열 외 키 0 · `work_hours` 밖 시각 신청 400 · 리드타임 안 400 · 하루 상한 초과 429 · 같은 이메일 두 번 신청 → `clients` 1행 · `add_prospect` 한도 초과 → 422 이고 행 0 · 승인 → 고객 메일 1통·.ics 1개·Meet(켜진 곳만) · 끝남 cron 2회 → interaction 1행 · 확인필요 `total` == 버킷 합 · 고객 역할 일정 생성 여전히 403 |
| **P3 — 로그인 고객 홈** | `/home`(app 모드 같은 컴포넌트) · client 착지 `/inbox → /home` · 프로젝트 탭 «N» · 확인필요 카드 얹기 · 인사이트 «유입 → 예약 → 확정 → 등록» 퍼널(`guest_links.use_count`·`booking_status`·`clients.status` 파생) | 없음 | R=0 · F=1 | 자체(3폭 · 게스트/로그인 «내 문의» 같은 건 집합 · `useTabTitle` enabled 계약) |
| **P4 — 보류** | 슬러그 별칭 `/w/:slug`(opt-in) · Cue 1차 응대(GUEST_LINK §10-2) · 다중 담당 라운드로빈 · 결제 선불 예약 | — | R=1 | 요청이 생길 때 |

### 하지 말아야 할 것 (단계 공통)

- **새 표를 만들지 않는다** — `bookings`·`client_requests`·`workspace_pages` 전부 금지. 문의 건은 `calendar_events`, 자유 문의는 대화방, 기록은 `client_interactions`, 설정은 `permissions` JSON, 소개 문구도 JSON. 표가 늘면 «고객이 허브» 가 깨진다.
- **공개 슬러그·검색엔진 노출 금지**(P4 전까지). `seo-pages.json` 에 넣지 않는다 — 랜딩 SEO 는 PlanQ 의 것이다. `/g/` 는 `noindex` 그대로.
- **OTP 이메일로 프로젝트·청구서·문서 내용을 열지 않는다.** 이메일 일치 ≠ 로그인. 잠금은 오늘 §G 시트 하나.
- **가입 화면으로 보내지 않는다**(`auth.js:236` 판정 유지). 계정은 초대 메일 한 곳.
- **슬롯 응답에 시각 외 정보를 싣지 않는다**(제목·참석자·이유·건수). 응답 원문으로 검사한다(`health-check --category=secrets` 계열).
- **고객이 일정을 «생성» 하게 하지 않는다** — `event_actions.js:70` 403 은 유지. 신청은 `created_by=담당 멤버` 인 요청 행이다.
- **같은 값을 두 곳에서 세지 않는다** — 예약 대기 수는 확인필요 버킷 한 공식. Q sale 상담 탭·캘린더 배지가 따로 세면 #297 계열 재발.
- **Google 초대 메일과 우리 메일을 둘 다 보내지 않는다.** 우리 메일 + .ics 한 통.
- **한 번에 하나만 편집**(같은 저장소에 Q file 작업이 미커밋 진행 중 — `DocsTab.tsx` 등 건드리지 않는다).
- **화면을 새로 그리지 않는다** — `GuestTabPane`·`GuestChatPanel`·`GuestNotifySection`·`LoginRequiredSheet`·`filterBar`·`segmentedToggle`·`AutoSaveField`·`ChipPopover`. 예약 달력은 Q calendar 의 월 그리드 부품을 읽기 전용으로 얹는다(없으면 그때 이유를 코드에 적고 만든다).

---

## 6. 권고 — 무엇을 먼저, 무엇을 미루는가

**결정: P0 는 지금(오늘 §C~G 묶음과 같은 커밋 계열), P1+P2 는 한 사이클로 Q file 작업 커밋 직후, P3 는 그 다음, P4 는 보류. 온프렘보다 앞에 둔다.**

근거:
1. **가장 싼 것이 가장 큰 혼란을 지운다.** 게스트 화면에 발신자 이름이 없는 것(P0-①)은 R=0·한나절이고, «누구 링크인지» 를 화면이 말하는 순간 나머지 표면이 한 계열로 읽히기 시작한다. 이것은 오늘 결정된 게스트 껍데기 통일과 같은 파일들이다 — 따로 열지 않는다.
2. **P1 만으로는 새 가치가 거의 없다.** conversation 링크가 이미 «채팅으로 문의» 를 준다. P1 의 값은 P2(예약)가 얹힐 때 나온다. 반대로 P2 는 P1 의 개인 링크 없이는 신원이 없다. 그래서 **둘은 한 라운드**이고, 둘 다 R=1 이라 Fable 게이트도 한 번이다(쪼개 올리지 않는다 — CLAUDE.md 소모 규칙).
3. **규모가 근거다.** 운영 고객 참석 일정 0건·확인 게스트 0건인 지금은 «표를 세우는» 비용이 «문을 잇는» 비용보다 크고, 잘못 세운 표는 되돌릴 수 없다(R). 이 설계의 스키마 변경이 ENUM append 1 + NULL 컬럼 1 인 이유다.
4. **온프렘(`ONPREM_DESIGN.md`, 조건부)보다 앞이다.** 온프렘은 «있는 제품을 다른 곳에 놓는» 일이고, 이것은 «제품에 문을 다는» 일이다. 문이 없는 제품을 옮겨 놓아도 고객은 못 들어온다. 감사로그·Q file 은 진행 중인 것을 끝내고 온다(중간에 끼우지 않는다 — 같은 파일 충돌).
5. **미루는 것과 이유:** 슬러그 공개 페이지(열거 표면, 8개 워크스페이스에 값 없음) · Cue 1차 응대(무인증 LLM 비용 표면 — costGuard 설계가 먼저) · 라운드로빈(담당 1명 규모) · 문의 건 댓글 스레드(대화방이 그 일을 한다).

**일정 감각(lua 1명 + AI):** P0 1일 · P1+P2 구현 6~8일 + Fable 1라운드 · P3 3일. 카나리 `--suite guestentry` 를 P1 **전에** 만든다(오늘 §H 와 같은 이유 — 이 표면을 기계로 재는 것이 아직 없다).

---

## 7. 근거 코드 인덱스

| 무엇 | 어디 |
|---|---|
| 랜딩 문의 → 플랫폼 | `dev-backend/routes/inquiries.js:31-131` · `dev-frontend/src/pages/Landing/ContactPage.tsx:70-76` · `locales/ko/landing.json:841-852` |
| 로그인 문의 → 플랫폼 | `routes/feedback.js:60-137` · `components/Common/CueHelpDrawer.tsx:9,30-38` · `MainLayout.tsx:1563-1607`(client 숨김) |
| 게스트 링크 모델·scope·개인 링크 | `models/GuestLink.js:36-116` · `routes/guest_subscribe.js` · `services/guest_link.js` · `scripts/migrate-guest-link-scope.js` |
| 계정 요청 | `routes/guest.js:149-215` · `services/saleNotify.js:30-59` |
| 게스트 응답에 워크스페이스 없음 | `routes/guest.js`·`guest_common.js`·`guest_project.js` — `brand_name` 0건 |
| 고객 한 행·접근 종류 | `models/Client.js` · `services/clientAccess.js` · `routes/sale_save.js:260-380`(`save-as-client`, `findExistingByContact`, `add_prospect`) |
| 가입은 초대 토큰만 | `routes/auth.js:236-246` · `routes/invites.js:36-206` · `services/emailService.js:472` |
| 초대 수락 후 자동 대화방 | `services/clientOnboarding.js` |
| 일정·참석자·RSVP·고객 생성 403 | `routes/calendar.js:236-262, 855-905` · `services/actions/event_actions.js:69-70, 197-221, 307` · `services/calendarPermission.js:20` |
| 근무시간(미사용) | `models/Business.js:121` |
| 상담 원장이 일정을 가리키는 칸 | `models/ClientInteraction.js:16,27` · `routes/sale_interactions.js:79`(review) |
| 고객 타임라인 채널 | `services/clientTimeline.js:22,33` |
| 확인필요 수집기 | `routes/dashboard.js:433-560` |
| 고객 역할 메뉴·착지 | `config/navMenus.ts:40-50` · `App.tsx:183` |
| 워크스페이스 공개면 부재 | `App.tsx` `path="/w/`·`/ws/` 0건 · `routes/businesses.js` `by-slug` 0건 · `routes/platform_public.js`(플랫폼 사업자 정보만) |
| 실측 수치 | dev `planq_dev_db` · 운영 SSH `87.106.78.146:/opt/planq/backend` (2026-09-24, 읽기 전용) |
