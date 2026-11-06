# 가입 = 계정만 · «시작하기» · 워크스페이스 참여 신청 — 설계

> 2026-11-06 · [Fable] 설계 판정 문서 (코드 변경 없음 · 커밋 안 함)
> Irene 원문(11-06): *"새 계정 만드는 거 로그인 상태에서 하니까 워크스페이스가 그냥 바로 만들어지는데. 우린 무료가 아닌데 모르는 새 그냥 만들어지면 안되잖아. 워크스페이스를 만들건지 다른 초대에 대응할건지 다른 워크스페이스 초대받은 걸 표시해야지. 그리고 다른 워크스페이스 검색해서 신청하게는 못할까?"*
> 승인된 권고(«권고대로»): ① 초대 창에 권한(멤버/관리자) — 작업 모델이 구현 중, 이 문서 범위 밖(`business_members.invited_role` · 수락 때 적용 — 이미 `services/invites.acceptInvite` 에 들어가 있는 것을 확인했다) ② 가입 = 계정만 → «시작하기» 에서 초대 수락 / 새로 만들기(14일 체험 명시) / 참여 신청 ③ 이름 검색 없음 — 대표가 켠 워크스페이스만 도메인 추천 + 참여 코드 → 대표·관리자 승인.
> 관련 규칙: `.claude/rules/auth.md`(OAuth 끝부분 한 벌·기기 계정 묶음) · `security-detail.md`(응답 비밀값·초대는 수락 때만 계정 연결·멤버가 이긴다) · `billing.md`(체험 필드는 `newTrialBusinessFields` 하나) · `workspace.md`(정본 `users.active_business_id` · `pickActiveBusinessId`).

---

## 0. 핵심 결정 (요약)

| # | 결정 |
|---|---|
| D1 | **가입(비밀번호·구글·애플·계정 추가)은 계정만 만든다.** 워크스페이스를 만드는 문은 `POST /api/businesses` **하나**(새 `services/workspaceCreate.createWorkspace` 로 본체 이동). `routes/auth.js /register` 의 워크스페이스·Cue 생성 블록과 `routes/oauth/core.js setupNewWorkspace` 는 지운다. |
| D2 | 워크스페이스 0개 상태는 **이미 성립하는 상태**(dev 실측 193명 · 스위처 «워크스페이스 없음» · 대시보드는 `bizId null` 가드)다. 새로 만드는 것은 그 상태의 **착지 화면 `/welcome`(«시작하기»)** 과 셸의 **한 곳(`ProtectedRoute`) 리다이렉트** 뿐이다. |
| D3 | `/welcome` 은 세 칸 — (a) 나에게 온 초대 (b) 참여 신청(도메인 추천 + 참여 코드) (c) 새 워크스페이스 만들기(이름 + 체험 플랜 + **«14일 무료 체험이 시작됩니다 · 체험이 끝나면 결제가 필요합니다»** 문장). 순서 고정 (a)→(b)→(c). (c) 는 기본 강조 아님. |
| D4 | **받은 초대 목록은 이메일 인증 뒤에만**(`users.email_verified_at` · OAuth 가입은 생성 때 인증됨). 인증 전에는 **개수도 이름도** 보이지 않는다(남의 이메일로 가입해 «어느 회사가 나를 초대했나» 를 보는 것 방지). 토큰 링크 수락(`/invite/:token`)은 종전대로 — 토큰 소지 = 메일함 증명. |
| D5 | 목록 응답에 **초대 토큰을 싣지 않는다.** 수락은 `POST /api/me/invites/:type/:id/accept` 가 서버 안에서 토큰을 찾아 **`services/invites.acceptInvite` 한 함수**를 부른다(수락 문 두 벌 금지). |
| D6 | 참여 신청 = 새 표 `workspace_join_requests`(사람×워크스페이스 **한 행**, UNIQUE) · 상태 `pending/approved/rejected/canceled` · 대기 14일 만료(읽을 때 판정, 새 cron 없음). 승인 = 멤버 행 생성(`joined_at` 즉시, 기본 `member`, 승인자가 `admin` 선택 가능) + `plan.can('add_member')` 게이트 + `clientToMember.promoteClientToMember`. |
| D7 | 공개 표면은 **없다.** 추천·코드 조회·신청 전부 **로그인 + 이메일 인증** 뒤. 코드 조회 실패는 한결같이 404. 이름 검색 없음. 응답에 멤버 수·대표 이름 없음. |
| D8 | 대표 설정(owner 만): `join_by_domain`(도메인 일치 추천) · `join_code`(8자, 서버 생성·재발급). **도메인 = 대표의 인증된 이메일 도메인**(DNS 없음) · 공용 메일 도메인(gmail 등) 불가 · 판정은 켤 때와 신청할 때 **같은 술어**(`services/joinPolicy.domainJoinOpen(biz)` — 대표가 바뀌거나 이메일을 바꾸면 저절로 닫힌다, 저장값을 믿지 않는다). |
| D9 | 옛 번들 호환: `/register` 가 `workspace_name`·`plan_code` 를 받아도 **무시하고 계정만** 만든다(로그 집계). 옛 셸은 «워크스페이스 없음 · 눌러서 새로 만들기» → `POST /api/businesses` 로 여전히 만들 수 있다(명시적 행동). 운영 스키마 변경은 **2단계에만**(additive). |
| D10 | 단계: **1단계** 계정만 가입 + `/welcome`(초대·만들기) + 받은 초대 API — 스키마 변경 0. **2단계** 참여 신청(표·설정·추천·코드·승인). **3단계(비차단)** 초대 거절 · 신청 만료 정리 · 워크스페이스 생성 전환 측정. |

---

## 1. 지금 코드 사실 (HEAD bdd558b2 실측 · 작업 모델 보고에 더한 것)

| 항목 | 사실 |
|---|---|
| 가입 세 문이 각자 워크스페이스를 만든다 | `routes/auth.js:386~420`(이메일) · `routes/oauth/core.js:95 setupNewWorkspace`(구글·애플 공통 — 이름이 «{이름} 의 워크스페이스») · `routes/businesses.js:81`(로그인 상태 두 번째). 셋 다 Business + owner BM + Cue User + ai BM + `newTrialBusinessFields`. 같은 코드 3벌. |
| 0개 상태를 셸이 어떻게 다루나 | `getUserWithBusiness` 가 `business_id:null` 로 내려준다. `ProtectedRoute` 는 로그인만 본다(`components/ProtectedRoute.tsx:93`). `MainLayout` 은 `business_id ?? null` 로 탭 범위를 비운다. `WorkspaceSwitcher:92` `noWorkspace` → 트리거를 누르면 **만들기 모달**(이름만 · 체험 문구 없음 · `POST /api/businesses`). `DashboardPage:38` `bizId null` 이면 조회 안 함 → **빈 화면**. `pickActiveBusinessId` 는 0개면 null 로 자가치유. 즉 상태는 성립하지만 **착지가 없다.** |
| 이메일 인증 | 가입 때 토큰 72h 발급·메일. 인증 전에도 로그인·모든 기능 사용. `email_verified_at` 는 세션 payload 에 실린다(`USER_SENSITIVE_FIELDS` 밖). OAuth 가입은 생성 즉시 인증. dev 실측: 활성 사람 306 중 **미인증 252**. |
| 초대 세 종류 | 멤버 `business_members(user_id NULL, invite_email, invite_token, invited_at, invited_role)` · 고객 `clients(invite_email, invite_token, invited_at, accepted_at)` · 프로젝트 고객 `project_clients(contact_email, invite_token, invited_at, contact_user_id)`. 만료 30일 `services/inviteExpiry.isExpired` 한 곳. 해석·수락 `services/invites.resolveInviteToken/acceptInvite` 한 벌(수락 때 `inviteeAccountOf` — 받는 이메일에 계정이 있으면 그 계정만). **이메일로 «나에게 온 초대» 를 모으는 조회는 없다.** `GET /api/invites/:token` 은 토큰으로만. |
| 기존 계정 앱 알림 | `services/inviteNotify.notifyExistingInvitee` — 초대 시점에 계정이 있던 사람만, `business_id NULL` 범위, 링크 `/invite/<token>`. 가입 뒤에 온 초대는 메일뿐. |
| 자리 한도 | `plan.can(biz,'add_member',{excludeMemberId})` · `memberInvite.seatsRemaining`. 수락 시 422 `quota`(`buildQuotaError`). |
| 공용 메일 도메인 목록 | `routes/mail_aliases.js:133 PUBLIC_MAIL_DOMAINS`(15개) — 라우트 파일 안에 갇혀 있다. |
| 관리자 술어 | `access_scope.js:215` = platform_admin ∨ owner ∨ admin. `routes/businesses.js:45 isAdmin` 은 owner 만(이름이 틀렸다 — 새 코드는 이것을 쓰지 않는다). 대표 전용은 `loadRateActor().isOwner`/`business.owner_id === req.user.id` 식. |
| 알림 종류 | `NotificationPref.EVENT_KINDS` ENUM(끝에만 append) — `invite` 있음. 소켓 방 `user:<id>`(server.js:215) · `business:<id>`. |
| 운영 마이그레이션 | `dev-backend/scripts/migrate-*.js` 멱등 + `scripts/deploy-planq.sh` 슬롯 한 줄. |
| 가입 rate-limit | IP 3회/1h, 살아 있는 초대 토큰은 예외 + 토큰당 5회(`middleware/security.js:395~420`). `/resend-verify-email` 은 인증만 있고 한도 없음. |
| 화면 | `RegisterPage.tsx`(616줄) — 워크스페이스 이름 칸 + `TrialPlanPicker` + `?add=1` 계정 추가 + 초대 모드(`?redirect=/invite/..`). 가입 뒤 `finishSignup(...)` → `/dashboard`(이메일) · `/inbox`(OAuth `?done=1`). `/start` 는 **이미 랜딩 주소**다(App.tsx:792) → 새 화면은 `/welcome`. |
| dev DB | 살아 있는 워크스페이스 74 · 그중 **대표 혼자(+Cue) 46** · 자동 이름(«… 의 워크스페이스») 3 · 대기 멤버 초대 13 · 대기 고객 초대 20. 대표 이메일 도메인은 거의 시험용(test.planq.kr 53). 운영 수치는 배포 때 읽기 전용 스크립트로 잰다(§9). |

---

## 2. 가입 흐름 — 워크스페이스 0개가 정상 착지

### 2-1. 서버
- `POST /api/auth/register` — `invite_token` 유무와 무관하게 **User 만** 만든다(+약관·인증 토큰·세션·`deviceAccounts.afterLogin`·감사 — 지금 그대로). 초대 토큰이 있으면 종전처럼 커밋 뒤 `acceptInvite` best-effort. `workspace_name`·`business_name`·`brand_name_en`·`plan_code` 는 **받아도 쓰지 않는다**(검증에서 빼고, 왔으면 `[register] legacy workspace fields ignored` 를 `[wsctx] summary` 처럼 집계 로그 — 0 이 되면 수신 자체를 지운다). 응답 `user.workspaces = []`, `next: '/welcome'` 힌트 한 칸(옛 번들은 무시한다).
- `routes/oauth/finish.js` — 신규 가입 분기에서 `setupNewWorkspace` 호출 제거. `planCode` 인자·state 의 plan 은 지운다(가입 화면에서 더 이상 고르지 않는다). 신규·초대 아님·redirect 없음 → 종전대로 `/register?done=1&method=` (전환 측정 자리) → 화면이 `/welcome` 으로.
- `routes/oauth/core.js setupNewWorkspace` 삭제. `routes/auth.js` 의 Business/Cue 생성 블록 삭제. 두 곳의 `newTrialBusinessFields`·`generateSlug` import 정리.
- `POST /api/businesses` — 본체를 `services/workspaceCreate.createWorkspace(userId, { name, brand_name_en, lang, plan_code }, { transaction })` 로 옮기고 라우트는 검증·감사·응답만. **이 서비스가 워크스페이스를 만드는 유일한 문**이다(가드 `trialplan` 은 그대로 이 한 곳만 본다). 생성 뒤 `active_business_id` 전환은 지금처럼. 이메일 인증을 요구하지 않는다(§10 권고 1).
- `getUserWithBusiness` 변경 없음. `email_verified_at` 가 이미 실린다 — 화면은 이것으로 인증 여부를 안다.

### 2-2. 화면
- `RegisterPage.tsx` — 워크스페이스 이름 칸·`TrialPlanPicker`·`brand.featureList` 중 «워크스페이스가 만들어집니다» 류 문구 제거. 남는 것: 이름·이메일·비밀번호·약관·구글/애플·`?add=1`·초대 모드. 가입 성공 → `finishSignup({method})` → **`/welcome`**(초대 모드는 종전대로 `/invite/:token`). OAuth `?done=1` 착지도 `/welcome`.
- `components/ProtectedRoute.tsx` **한 곳**: 로그인됨 ∧ `user.workspaces.length === 0` ∧ `platform_role !== 'platform_admin'` ∧ 경로가 허용 목록 밖 → `<Navigate to="/welcome" replace />`. 허용 목록(0개여도 열리는 곳): `/welcome` · `/profile/*`(계정·탈퇴) · `/invite/*` · `/oauth/*` · `/verify-email/*` · `/notifications` · `/guide/*`. 계정 추가 모드(`addAccountMode`)는 `/register`·`/login` 에서만 도니 영향 없다 — 새 계정으로 재부팅되면 같은 규칙으로 `/welcome`.
- `WorkspaceSwitcher` — 0개 트리거·«새 워크스페이스 만들기» 항목 모두 **`/welcome?from=switcher`** 로 보낸다. 만들기 모달은 지운다(만드는 화면 한 벌 — 체험 문구가 두 곳에서 갈리지 않게).
- 네이티브 앱: OAuth 복귀 → 부팅 → 같은 규칙. 딥링크 `/invite/:token` 은 허용 목록이라 그대로.

---

## 3. «시작하기» `/welcome` — 정보 구조

레이아웃은 `RegisterPage` 와 같은 인증 껍데기(사이드바 없음 · 오른쪽 위 계정 메뉴: 계정 전환·로그아웃) · 폰 1열 / 태블릿·데스크탑 1열 최대 560px(카드 세 장 세로). 네임스페이스 **`welcome`**(ko/en 새 파일 · `i18n.ts ns` 등록).

```
[PlanQ]                                   (계정 메뉴 ▾)
시작하기                                   welcome.title
{name} 님, 어디서 일할지 고르세요.           welcome.subtitle

┌ 이메일 인증 배너 (미인증일 때만) ───────────────────────┐
│ ✉ {email} 을 인증하면 받은 초대가 보입니다.               │
│   [인증 메일 다시 보내기]   (보냄 · 72시간 안에 열어 주세요) │
└──────────────────────────────────────────────────────┘

┌ (a) 나에게 온 초대 ─────────────────────────────────────┐
│ 브랜드파트너스  · 팀원(관리자) · 김오너 님이 초대 · 11월 3일 · 27일 남음  [들어가기] │
│ 워프로랩       · 고객       · 프로젝트 «리브랜딩» · 11월 1일            [들어가기] │
│ (없으면) 받은 초대가 없습니다.                                                  │
└──────────────────────────────────────────────────────┘

┌ (b) 우리 회사 워크스페이스에 참여 ─────────────────────┐   ← 2단계
│ @wor-pro.com 으로 참여할 수 있는 워크스페이스                 │
│   워프로랩  [참여 신청]        (신청 중 · 승인을 기다립니다 [취소]) │
│ 참여 코드가 있나요?  [ ABCD-EFGH ] [찾기]                      │
│ (미인증이면) 이메일을 인증하면 회사 워크스페이스를 찾을 수 있습니다. │
└──────────────────────────────────────────────────────┘

┌ (c) 새 워크스페이스 만들기 ─────────────────────────────┐
│ 워크스페이스 이름 [            ]                            │
│ 체험 플랜  ( ) 혼자 Starter  (•) 팀 Basic 추천  ( ) 큰 팀 Pro  │
│ ⓘ 14일 무료 체험이 시작됩니다. 체험이 끝나면 결제가 필요하고,   │
│   결제하지 않으면 워크스페이스가 잠깁니다.                      │
│                         [14일 체험으로 만들기]                 │
└──────────────────────────────────────────────────────┘
```

동작
- (a) 는 `GET /api/me/invites`. `email_verified:false` 면 칸 자체를 접고 배너만(개수 노출 없음).
- [들어가기] = `POST /api/me/invites/:type/:id/accept` → 성공 시 `/me` 다시 읽고 `redirect`(멤버 `/dashboard` · 고객 `/talk`)로. 422 `quota` 면 줄 안에 «자리가 없어 지금은 들어갈 수 없어요. {workspace} 대표에게 알려 주세요»(`buildQuotaError` 본문 그대로). 410 이면 «만료된 초대» 로 줄 회색.
- 실시간: 소켓 `notification:new`(event_kind `invite`) 또는 `join_request:decided` 를 받으면 목록을 다시 읽는다. `?from=switcher` 가 아니고 다시 읽은 `/me` 의 `workspaces.length ≥ 1` 이면(다른 탭에서 수락) 활성 워크스페이스로 간다.
- (c) 버튼은 `POST /api/businesses {brand_name, plan_code}` — 성공 → `/dashboard`. 이름 빈 값·중복 검증은 서버 그대로.
- 워크스페이스가 이미 있는 사람이 열면(`?from=switcher`) 세 칸 모두 같은 모양(초대·신청·만들기 — 두 번째 워크스페이스).

문구(ko / en)
| 키 | ko | en |
|---|---|---|
| `welcome.title` | 시작하기 | Get started |
| `welcome.subtitle` | {{name}} 님, 어디서 일할지 고르세요. | {{name}}, choose where you'll work. |
| `welcome.verify.banner` | {{email}} 을 인증하면 받은 초대가 보입니다. | Verify {{email}} to see invitations sent to you. |
| `welcome.verify.resend` | 인증 메일 다시 보내기 | Resend verification email |
| `welcome.verify.sent` | 보냈어요 · 72시간 안에 열어 주세요 | Sent · open it within 72 hours |
| `welcome.invites.title` | 나에게 온 초대 | Invitations for you |
| `welcome.invites.empty` | 받은 초대가 없습니다. | No invitations yet. |
| `welcome.invites.roleMember` / `roleAdmin` / `roleClient` | 팀원 / 관리자 / 고객 | Member / Admin / Client |
| `welcome.invites.by` | {{name}} 님이 초대 | Invited by {{name}} |
| `welcome.invites.daysLeft` | {{n}}일 남음 | {{n}} days left |
| `welcome.invites.enter` | 들어가기 | Join |
| `welcome.invites.expired` | 만료된 초대 | Expired |
| `welcome.invites.quota` | 자리가 없어 지금은 들어갈 수 없어요. {{workspace}} 대표에게 알려 주세요. | No seats left right now. Let the owner of {{workspace}} know. |
| `welcome.join.title` | 우리 회사 워크스페이스에 참여 | Join your company's workspace |
| `welcome.join.domainHint` | @{{domain}} 으로 참여할 수 있는 워크스페이스 | Workspaces open to @{{domain}} |
| `welcome.join.request` | 참여 신청 | Request to join |
| `welcome.join.pending` | 신청 중 · 승인을 기다립니다 | Requested · waiting for approval |
| `welcome.join.cancel` | 취소 | Cancel |
| `welcome.join.codeLabel` | 참여 코드가 있나요? | Have a join code? |
| `welcome.join.codeFind` | 찾기 | Find |
| `welcome.join.codeNotFound` | 코드에 맞는 워크스페이스가 없습니다. | No workspace matches that code. |
| `welcome.join.needVerify` | 이메일을 인증하면 회사 워크스페이스를 찾을 수 있습니다. | Verify your email to find your company's workspace. |
| `welcome.join.rejected` | 승인되지 않았습니다 · {{date}} 뒤 다시 신청할 수 있어요 | Not approved · you can ask again after {{date}} |
| `welcome.create.title` | 새 워크스페이스 만들기 | Create a new workspace |
| `welcome.create.namePlaceholder` | 워크스페이스 이름 (회사·팀 이름) | Workspace name (company or team) |
| `welcome.create.trialNotice` | 14일 무료 체험이 시작됩니다. 체험이 끝나면 결제가 필요하고, 결제하지 않으면 워크스페이스가 잠깁니다. | A 14-day free trial starts now. Payment is required when it ends; otherwise the workspace is locked. |
| `welcome.create.submit` | 14일 체험으로 만들기 | Create with 14-day trial |

---

## 4. 받은 초대 API

### `GET /api/me/invites` (인증 · 범위 없음 — `/api/auth/*` 와 같이 `X-Workspace-Id` 를 보지 않는다)
- `email_verified_at` 가 없으면 `{ email_verified:false, invites:[] }` **200**(403 아님 — 화면이 배너를 그린다).
- 내 주소 집합 = `users.email` + (`secondary_email` ∧ `secondary_email_verified_at`) — `oauth/finish.js` 2분기와 같은 집합. 비교는 trim·소문자.
- 세 종류를 모아 `invited_at DESC`:
  - 멤버: `business_members` `user_id IS NULL ∧ joined_at IS NULL ∧ removed_at IS NULL ∧ invite_token IS NOT NULL ∧ LOWER(invite_email) IN (…)` ∧ Business `deleted_at IS NULL`
  - 고객: `clients` `user_id IS NULL ∧ accepted_at IS NULL ∧ invite_token IS NOT NULL ∧ LOWER(invite_email) IN (…)` ∧ Business 살아 있음
  - 프로젝트 고객: `project_clients` `contact_user_id IS NULL ∧ invite_token IS NOT NULL ∧ LOWER(contact_email) IN (…)` ∧ Project→Business 살아 있음
  - 만료 판정은 **`inviteExpiry.isExpired(invited_at)` 그대로**(SQL 로 옮기면 `activeMemberSeatWhere` 와 같은 상수). 만료 행은 `expired:true` 로 **최근 7일 것만** 내려준다(«왜 안 보이지» 방지) — 그 뒤는 뺀다.
- 행 모양(화이트리스트 — 모델 통째 금지): `{ type:'workspace_member'|'workspace_client'|'project_client', id, workspace_name, workspace_logo_url, inviter_name(표시명 규칙 — `displayName.applyMemberDisplayName` 로 초대자 BM 이름 우선), invited_at, expires_at, expired, role('member'|'admin'|'client'), project_name?, company_name? }`. **`invite_token`·이메일·초대자 계정 이메일 없음.**
- 이미 내가 멤버/고객인 워크스페이스의 초대는 `acceptInvite` 의 흡수 규칙에 맡긴다(목록에서 숨기지 않는다 — 수락하면 흡수·착지).

### `POST /api/me/invites/:type/:id/accept` (인증)
- 행을 `(type,id)` 로 찾고 → 내 주소 집합과 `isSameInvitee` 가 아니면 **404**(존재 노출 없이) → `resolveInviteToken(row.invite_token)` → `acceptInvite(req.user, resolved, { io, actorReq:req })`. 응답·오류 매핑은 `routes/invites.js POST /:token/accept` 와 **같은 블록**(공통 함수로 뽑아 둘이 같이 쓴다). 감사는 `acceptInvite` 가 쓴다(`invite.accept` · audit-exempt 주석).
- 가드 `secrets`: `/api/me/invites` 응답 원문에 `invite_token` 값 0.

### 알림 연결
- `inviteNotify.notifyExistingInvitee` 는 그대로. **가입 뒤에 온 초대**도 이제 `/welcome` 목록에 보인다(메일만 받던 구멍이 닫힌다). 초대 시점에 계정이 없었던 사람이 나중에 가입하면 — 가입 응답 뒤 `/welcome` 이 목록을 읽으므로 추가 알림을 만들지 않는다.

---

## 5. 참여 신청 — 데이터·상태·승인 (2단계)

### 5-1. 표 `workspace_join_requests`
| 칸 | 형 | 뜻 |
|---|---|---|
| id | INT PK | |
| business_id | INT FK businesses | |
| user_id | INT FK users | 신청자 |
| source | ENUM('domain','code') | 어떻게 찾았나 |
| status | ENUM('pending','approved','rejected','canceled') | 만료는 상태가 아니라 `pending ∧ expires_at < now` 판정(읽는 곳 `services/joinRequests.isLive` 한 함수) |
| message | VARCHAR(300) NULL | 신청자 한마디(선택 · 본문 금지 — 짧게) |
| requested_at · expires_at | DATETIME | expires_at = requested_at + 14일 |
| decided_at · decided_by | DATETIME NULL · INT NULL | 승인·거절한 사람 |
| decision_note | VARCHAR(300) NULL | 거절 사유(신청자에게 보인다) |
| retry_after | DATETIME NULL | 거절 뒤 7일 — 그 전 재신청 409 `join_cooldown` |
| created_at · updated_at | | |
| **UNIQUE(business_id, user_id)** | | 사람×워크스페이스 한 행. 재신청은 **같은 행**을 pending 으로 되돌린다(requested_at·expires_at 갱신, decided_* 비움). 경합은 UNIQUE 가 막는다(두 번째 INSERT 는 UPDATE 로 재시도). |
| INDEX(business_id, status) · INDEX(user_id) | | |

Sequelize 모델 `models/WorkspaceJoinRequest.js`(`tableName 'workspace_join_requests'`, underscored). `services/workspaceAlive` — 이 표를 읽는 cron 은 없다(새 cron 안 만듦).

### 5-2. 신청자 쪽 API (인증 + **이메일 인증 필수** — 미인증 403 `email_not_verified`)
| 라우트 | 하는 일 |
|---|---|
| `GET /api/join/suggestions` | 내 인증된 주소 도메인(들)로 열린 워크스페이스 — `joinPolicy.domainJoinOpen(biz)`(§6) 참 ∧ `join_domain ∈ 내 도메인` ∧ 살아 있음 ∧ 내가 멤버/활성 고객 아님. 각 행 `{ business_id, brand_name, brand_logo_url, request: {status, requested_at, retry_after}|null }`. **멤버 수·대표 이름 없음.** 공용 도메인은 애초에 켜지지 않으니(§6) gmail 사용자에겐 빈 목록. |
| `POST /api/join/lookup {code}` | 코드 정규화(대문자·`-`·공백 제거) → `businesses.join_code = ? ∧ deleted_at IS NULL` 1건 → `{ business_id, brand_name, brand_logo_url, request }`. 없으면 **404 `join_code_not_found`**(코드 꺼짐·워크스페이스 삭제·오타 모두 같은 404). |
| `POST /api/join/requests {business_id, source, code?, message?}` | source `domain` 이면 `domainJoinOpen ∧ 도메인 일치` 다시 검사, `code` 면 코드 다시 대조(lookup 결과를 믿지 않는다). 이미 멤버 409 `already_member`(고객이면 허용 — 승인 때 «멤버가 이긴다»). pending 있음 409 `already_requested`. `retry_after > now` 409 `join_cooldown`. 성공 201 `{ id, status:'pending', expires_at }`. |
| `GET /api/join/requests/mine` | 내 신청(살아 있는 pending + 최근 30일 결정된 것) — `/welcome` (b) 칸. |
| `DELETE /api/join/requests/:id` | 내 pending 만 → `canceled`. |

### 5-3. 워크스페이스 쪽 API (`authenticateToken + checkBusinessAccess` + **owner/admin**(`access_scope` 215 술어 — 새 `requireWorkspaceAdmin` 헬퍼가 없으면 그 술어를 export 해 쓴다))
| 라우트 | 하는 일 |
|---|---|
| `GET /api/businesses/:id/join-requests?status=pending` | 목록 — 신청자 `{ user_id, name(계정 이름 — 아직 멤버가 아니라 표시명이 없다 · 승인 뒤부터 표시명 규칙), email, avatar_url }`, `source`, `message`, `requested_at`, `expires_at`. 만료된 pending 은 `expired:true` 로 7일만. 응답에 `seats_remaining`(`memberInvite.seatsRemaining`) 동봉 — 화면이 «남은 자리 n» 을 보여 준다. |
| `POST /api/businesses/:id/join-requests/:rid/approve {role?}` | 트랜잭션: 행 pending·미만료 재확인(`SELECT … FOR UPDATE`) → `plan.can(biz,'add_member')`(excludeMemberId 없음 — 새 자리) 실패 422 `buildQuotaError` → 이미 멤버면 409 → `BusinessMember.create({ user_id, role: resolveAccessRole(role)(기본 member · admin 허용 · owner 불가), joined_at: now, invited_by: 승인자, invited_at: now })` → `clientToMember.promoteClientToMember` → 행 `approved` → 커밋 → `afterPromote` · 신청자 `active_business_id` 가 NULL 이면 이 워크스페이스로(`pickActiveBusinessId` 와 모순 없음 — 있으면 건드리지 않는다). |
| `POST …/:rid/reject {note?}` | `rejected` · `retry_after = now+7d` · `decision_note`. |

### 5-4. 알림·실시간·감사
| 사건 | 알림(`notify`) | 소켓 | 감사 |
|---|---|---|---|
| 신청 생성·재신청 | 그 워크스페이스 **owner+admin 전원**(`BusinessMember role IN('owner','admin') ∧ removed_at NULL ∧ user_id NOT NULL` — `emailImapCron.js:1341` 과 같은 집합. 새 ENUM 없이 `eventKind:'invite'` 재사용 — 둘 다 «멤버십» 사건이라 끄는 단위가 같다. 제목 «참여 신청이 왔습니다» 본문 «{이름} ({이메일})» 링크 `/business/members?tab=requests`) | `business:<id>` 에 `join_request:updated {id, business_id}` **신호만** | `workspace.join_request` (userId 신청자 · businessId) |
| 승인 | 신청자에게 `eventKind:'invite'` · businessId = 그 워크스페이스(이제 멤버다) · 제목 «{워크스페이스} 참여가 승인됐어요» 링크 `/dashboard` · `workspaceName` 동봉(토스터가 워크스페이스 이름을 단다) | `user:<신청자>` 에 `join_request:decided {id, business_id, status:'approved'}` · `business:<id>` 에 `member:updated` | `workspace.join_approve` (targetType business_member · newValue {user_id, role, request_id}) |
| 거절 | 신청자에게 `eventKind:'invite'` · **businessId NULL**(아직 그 워크스페이스 사람이 아니다 — `inviteNotify` 와 같은 규칙) · 제목 «{워크스페이스} 참여가 승인되지 않았어요» 본문 = note | `user:<신청자>` `join_request:decided` | `workspace.join_reject` |
| 취소 | 없음 | `business:<id>` `join_request:updated` | `workspace.join_cancel` |
메일·푸시: `notify` 의 기본 채널 규칙 그대로(새 메일 템플릿 없음 — 알림 메일은 `notify` 의 일반 양식). **외부 발송을 새로 만들지 않는다.**

### 5-5. 승인 화면
- `/business/members` 에 탭 `?tab=requests`(«참여 신청» · 대기 수 배지 — 배지 계약 `.claude/rules/badges.md` 대로 **메뉴 배지 합에 넣지 않는다**, 탭 안 숫자만). owner/admin 에게만 탭이 보인다.
- 줄: 아바타·이름·이메일·«도메인 @wor-pro.com / 코드» · 한마디 · 신청일 · [승인 ▾ 멤버/관리자] [거절]. 승인은 `ConfirmDialog` 로 «{이름} 을(를) {역할}로 들입니다 · 남은 자리 n → n-1». 거절은 사유 한 줄 입력(선택).
- 자리가 0이면 [승인] 비활성 + «자리가 없습니다 · 플랜 설정»(눌리게 두고 422 로 거절하지 않는다 — CLAUDE.md «눌리게 두고 서버가 거절하면 아무 일도 안 일어남»).
- 멤버 화면 네임스페이스에 `joinRequests.*` 키(ko/en).

---

## 6. 대표 설정 — 켜기·도메인·코드 (2단계)

### 6-1. 칸(`businesses`, additive)
| 칸 | 형 | 뜻 |
|---|---|---|
| `join_by_domain` | TINYINT(1) NOT NULL DEFAULT 0 | 도메인 일치 추천 켬 |
| `join_domain` | VARCHAR(120) NULL | 켤 때 대표의 인증된 이메일 도메인을 **복사**(화면 표시·인덱스용). 신뢰의 근거가 아니다(아래 술어) |
| `join_code` | VARCHAR(12) NULL **UNIQUE** | NULL = 코드 참여 끔. 8자 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`(0/O/1/I 제외) 서버 생성. 화면 표시 `ABCD-EFGH` |
| `join_code_rotated_at` | DATETIME NULL | |

### 6-2. 술어 — `services/joinPolicy.js` 한 벌
- `ownerVerifiedDomains(biz)` = 대표(`owner_id`) User 의 `email`(∧ `email_verified_at`) + `secondary_email`(∧ verified) 의 도메인 − `PUBLIC_MAIL_DOMAINS`.
- `domainJoinOpen(biz)` = `join_by_domain ∧ join_domain ∈ ownerVerifiedDomains(biz) ∧ deleted_at IS NULL`. **켜기·추천·신청이 모두 이 함수**를 본다 → 대표 이전(`transfer-ownership`)·대표 이메일 변경·인증 해제로 조건이 깨지면 **저절로 닫힌다**(저장값을 고칠 필요도, 놓칠 일도 없다). 설정 화면은 «대표의 인증된 회사 메일이 없어 꺼져 있습니다» 를 같은 함수 결과로 말한다.
- `PUBLIC_MAIL_DOMAINS` 는 `routes/mail_aliases.js` 에서 **`utils/publicMailDomains.js` 로 옮겨** 둘이 같이 쓴다(복사 금지).

### 6-3. API (owner 전용 — `business.owner_id === req.user.id ∨ platform_admin`, admin 불가)
| 라우트 | |
|---|---|
| `GET /api/businesses/:id/join-settings` | `{ join_by_domain, join_domain, domain_open(술어 결과), owner_domains(켤 수 있는 도메인 목록), code_enabled, join_code(이 라우트에서만), join_code_rotated_at, pending_count }` |
| `PUT /api/businesses/:id/join-settings {join_by_domain?, join_domain?, code_enabled?}` | 켤 때 `join_domain ∈ ownerVerifiedDomains` 아니면 400 `domain_not_verified`(공용 도메인도 이 400). `code_enabled:true` 면 코드 생성, `false` 면 NULL. 감사 `business.join_settings`(old/new — 코드 값은 싣지 않고 `code_enabled` 만). |
| `POST /api/businesses/:id/join-settings/rotate-code` | 새 코드. 옛 코드 즉시 무효. 이미 들어온 pending 신청은 유지. 감사. |

- **`join_code` 는 전역 toJSON 비밀 목록(`models/index.js`, 규칙 8)에 넣는다** — `GET /api/businesses/:id`·`/auth/me`·목록 어디에도 안 실린다. 가드 `secrets` 에 1건(«join-settings 에는 오고, 상세에는 없다» 대조군).

### 6-4. 설정 화면
- 설정 › 일반(브랜드) 탭의 «멤버 참여» 카드(owner 에게만 · Danger Zone 위). 두 스위치 + 코드 표시·복사·재발급(`ConfirmDialog` «옛 코드는 바로 쓸 수 없게 됩니다»). 꺼져 있으면 왜 못 켜는지(술어 결과) 한 줄. `settings` 네임스페이스 `joinSettings.*`(ko/en).

### 6-5. 공개 표면·남용 방지 정리
| 표면 | 인증 | 노출 | 한도 |
|---|---|---|---|
| 가입·로그인 화면 | 무인증 | **변화 없음** | 종전 |
| `/api/me/invites` | 로그인 + 이메일 인증 | 나에게 온 것만 · 토큰 없음 | 일반 API 한도 |
| `/api/join/suggestions` | 로그인 + 인증 | 내 도메인으로 열린 것만 · 이름·로고만 | 일반 |
| `/api/join/lookup` | 로그인 + 인증 | 코드가 맞는 1건 · 이름·로고만 · 실패 404 한결같이 | **사용자당 10회/시 + IP 30회/시**(새 limiter · keyGenerator user id). 32^8 ≈ 1.1×10¹² 공간이라 한도 안에서 추측 불가 |
| `/api/join/requests` POST | 로그인 + 인증 | — | 사용자당 5회/시 |
| `/resend-verify-email` | 로그인 | — | 사용자당 3회/시(지금 없는 한도를 이번에 붙인다 — `/welcome` 배너가 버튼을 노출하므로) |
| 이름 검색 | **없음** | | |

---

## 7. 권한 표
| 행위 | owner | admin | member | client | platform_admin |
|---|---|---|---|---|---|
| 워크스페이스 만들기(`POST /api/businesses`) | 누구나(로그인) | | | | |
| 받은 초대 보기·수락 | 본인(이메일 인증) | | | | |
| 참여 신청·취소 | 본인(이메일 인증 · 그 워크스페이스 멤버 아님) | | | | |
| 신청 목록·승인·거절 | ✓ | ✓ | ✗ 403 | ✗ 403 | ✓ |
| 참여 설정(도메인·코드) 보기·바꾸기 | ✓ | ✗ 403 | ✗ | ✗ | ✓ |
| 승인 때 role 지정 | member/admin | member/admin | | | |

---

## 8. 기존 사용자·옛 번들 영향
| 경우 | 영향 | 처리 |
|---|---|---|
| 옛 번들 `RegisterPage` 가 `workspace_name`+`plan_code` 를 보냄 | 계정만 생김 · 옛 셸은 `/dashboard` 착지 → 스위처 «워크스페이스 없음 · 눌러서 새로 만들기» 모달 → `POST /api/businesses` 로 만들 수 있다(명시적 행동 — Irene 의 «모르는 새» 가 아니다) | 서버 집계 로그로 수신 수를 보고 0 이면 수신 제거. 새 번들은 청크 복구·자동 새로고침 규칙(`ops-frontend.md`)대로 교체된다 |
| 옛 번들 OAuth 가입 | state 의 plan 은 무시 · `/register?done=1` → 옛 코드는 `/inbox` 로 → 빈 화면(스위처로 만들기 가능) | 같은 번들 교체로 해소. 하루 이내 |
| 이미 워크스페이스 0개인 계정(dev 193 · 운영 수치는 §9 에서 잼) | 다음 로그인부터 빈 대시보드 대신 `/welcome` | 데이터 변경 없음 |
| 자동 이름 «… 의 워크스페이스»(dev 3) | 그대로 둔다(이름 바꾸기는 설정에 있다) | 없음 |
| 대기 중 초대(dev 멤버 13·고객 20) | 받는 사람이 로그인하면 `/welcome` 에 바로 보인다 | 없음 |
| `TrialPlanPicker` 의 `DEFAULT_TRIAL_PLAN`·`config/plans.DEFAULT_SIGNUP_PLAN` | 가입 화면 → `/welcome` (c) 로 자리만 옮김 | 가드 `trialplan` 그대로 |
| 마케팅 `finishSignup({trial_plan})` | 가입 때 플랜이 없다 → `trial_plan` 생략 | 워크스페이스 생성 전환(`pq_workspace_create`)은 3단계 비차단 |
| dev-login 시험 계정 | 모두 워크스페이스 있음 — 영향 없음 | — |
| `/start` | 랜딩 주소 그대로 | 새 화면은 `/welcome` |

---

## 9. 운영 마이그레이션·배포
- **1단계: 스키마 변경 없음.** 코드만. 배포 전 읽기 전용 수치(배포 방이 잰다): 활성 사람 수 · 워크스페이스 0개 수 · 미인증 수 · 대기 초대 수 — «확인할 곳» 에 붙인다.
- **2단계: `dev-backend/scripts/migrate-join-requests.js`**(멱등) — `CREATE TABLE IF NOT EXISTS workspace_join_requests …` + `ALTER TABLE businesses ADD COLUMN …` 4칸(각각 information_schema 로 있는지 확인) + UNIQUE(join_code). `scripts/deploy-planq.sh` 슬롯 등록, **코드보다 먼저**(모델이 SELECT 한다). 롤백: additive — 코드만 되돌리고 칸은 남긴다(모델 선언까지 되돌리면 sync 가 DROP 한다 — 기존 주석 규칙).
- `sync-database.js` 를 dev 에서 돌려 모델과 맞춘다. `docs/DATABASE_ERD.md`·`.claude/rules/db-schema.md` 에 표 한 줄.

---

## 10. 권고 · Irene 에게 알릴 것 (결정은 안 기다린다 — 다르게 하고 싶으면 한 줄로)
1. **워크스페이스 만들기에 이메일 인증을 요구하지 않는다** — 가입 IP 한도(3/h)가 대량 생성을 막고, 만들기는 이제 «14일 체험» 문장을 읽고 누르는 명시적 행동이다. 인증까지 걸면 첫 체험이 메일함에서 막힌다. (바꾸려면 `createWorkspace` 앞 한 줄.)
2. **참여 설정은 대표(owner)만** 켠다 — 켜면 같은 도메인 사람 전원에게 회사 이름이 보인다. 관리자에게 열면 «누가 켰는지» 가 흐려진다.
3. **승인 기본 권한 member**, 승인자가 admin 을 고를 수 있다(초대 ① 과 같은 선택지 — `resolveAccessRole` 재사용).
4. **초대 «거절» 은 3단계** — 지금 표에 `declined_at` 이 없고 고객 초대는 고객 기록이라 지울 수 없다. 1단계는 «수락» 과 30일 자연 만료만. 필요하면 멤버 초대에 한해 pending 행 삭제 + 초대자 알림으로 붙인다.
5. **알림 종류는 `invite` 재사용**(ENUM 추가 없음). «초대» 를 끈 사람은 참여 신청 알림도 꺼진다 — 둘 다 멤버십 사건이라 같은 스위치가 맞다고 본다. 따로 끄고 싶다는 요구가 오면 그때 ENUM 끝에 `join_request` 를 붙인다(마이그레이션 1줄).
6. 되돌리기 어려운 점: **없다.** 1단계는 스키마 0, 2단계는 additive. 옛 자동 생성 워크스페이스는 손대지 않는다.

---

## 11. 단계 나누기
| 단계 | 내용 | 먼저 내는 이유 |
|---|---|---|
| **1** | D1(계정만 가입 · `createWorkspace` 한 곳) · `/welcome` (a)(c) · `GET /api/me/invites` · accept-by-id · `ProtectedRoute` 리다이렉트 · 스위처 → `/welcome` · 인증 배너 + `/resend-verify-email` 한도 · RegisterPage 정리 · i18n `welcome` | Irene 의 첫 문장(«모르는 새 만들어진다»)을 닫는다. 스키마 변경 0 이라 되돌리기 쉽다 |
| **2** | 표·모델·마이그레이션 · `joinPolicy` · `publicMailDomains` 이동 · `/api/join/*` · `/api/businesses/:id/join-requests*` · `join-settings` · 설정 카드 · 멤버 화면 «참여 신청» 탭 · 알림·소켓·감사 · limiter 2개 | 1단계 화면에 (b) 칸을 끼운다 |
| **3(비차단)** | 초대 거절 · 만료 신청 정리(필요하면 `retentionPurge` 에 한 줄 — `aliveBusinessWhere`) · `pq_workspace_create` 전환 측정 · `[register] legacy` 수신 제거 | |

---

## 12. 검증 계획 — 무엇을 증명하나
### 1단계 (실HTTP 3003 · `node test-xxx.js` → 삭제)
1. **가입 셋 다 워크스페이스 0** — `/register`(workspace_name·plan_code 를 실어 보내도) → `user.workspaces=[]` · DB `businesses` 증가 0 · `users` +1 · Cue 계정 증가 0. 구글은 `finishOauthLogin` 을 시험 프로필로 직접 호출(기존 nativelogin 스위트 방식) → 같은 결과. 계정 추가(`add-intent` → `/register`) → 같은 결과 + 기기 계정 묶음 유지.
2. **초대 가입은 그대로** — 살아 있는 멤버 초대 토큰으로 `/register` → 그 워크스페이스 멤버 1개 · active_business_id = 그곳(회귀 `--suite invite`).
3. **만들기 한 문** — `POST /api/businesses {brand_name, plan_code:'pro'}` → plan pro · trialing · trial_ends_at = +14d(±1분) · owner BM · Cue BM · active 전환. `grep -rn "newTrialBusinessFields" dev-backend` 가 `config/plans.js`·`services/workspaceCreate.js` 둘뿐(가드 `trialplan` 통과).
4. **받은 초대** — 시험 계정 A(인증됨)에 멤버·고객·프로젝트 고객 초대 3건 + B(미인증)에 1건 → A `GET /api/me/invites` 3건(타입별 1) · 응답 원문에 `invite_token` 문자열 0 · B `{email_verified:false, invites:[]}` · B 의 초대를 A 가 `accept` → 404 · A 가 자기 멤버 초대 accept → 200 → `/me` workspaces +1 · `invited_role:'admin'` 이면 role admin · 같은 id 다시 accept → `already:true`. 31일 늙힌 초대(invited_at 직접 UPDATE — 시험 DB) → `expired:true`, accept 410. 자리 0인 워크스페이스 초대 accept → 422 `quota`.
5. **보조 이메일** — A 의 인증된 secondary_email 로 온 초대가 목록에 있다 · 미인증 secondary 로 온 것은 없다.
6. **셸** — 크롬(`--suite welcome`, 폰·태블릿·데스크탑 3폭): 0개 계정 로그인 → `/dashboard` 요청이 `/welcome` 에 착지 · `/profile`·`/invite/:token` 은 안 튕김 · platform_admin 은 안 튕김 · 미인증이면 (a) 칸 없음·배너 있음(elementFromPoint 로 «보이는가») · [들어가기] 뒤 `/dashboard` · (c) 만들기 뒤 `/dashboard` + 스위처 이름 일치 · 스위처 «새로 만들기» → `/welcome?from=switcher` 에서 머무름.
7. **가드** — `health-check` 전체 · `guard-invariants`(i18n·parity·trialplan·wsscope) · `npm run build` EXIT 0 · `--suite tenant,invite,invitenotify,nativelogin,welcome`.
8. **대조군(양성)** — `createWorkspace` 를 `/register` 에서 다시 부르게 한 가짜 패치에서 1번이 실패하는지 1회.

### 2단계
1. **술어 한 벌** — 대표 이메일이 `wor-pro.com`(인증) 인 워크스페이스에서 켜기 200 · gmail 대표 400 `domain_not_verified` · 켠 뒤 대표 이메일을 gmail 로 바꾸면(시험 DB UPDATE) `suggestions` 에서 사라지고 `join-settings.domain_open:false`(저장값은 1 그대로) · `transfer-ownership` 뒤 새 대표 도메인 불일치 → 같은 결과.
2. **노출** — 다른 도메인 사용자 `suggestions` 0건 · `lookup` 오타·꺼진 코드·삭제 워크스페이스 모두 404 같은 본문 · `GET /api/businesses/:id`·`/auth/me`·목록 응답 원문에 `join_code` 값 0(secrets) · `join-settings` 에는 있음(대조군) · admin 이 `join-settings` 403.
3. **신청 흐름** — 신청 201 → owner·admin 알림 각 1(member 는 0) → 같은 사람 재신청 409 → 취소 → 재신청 201(같은 행 id) → 거절 → 즉시 재신청 409 `join_cooldown` → `retry_after` 를 과거로 UPDATE → 201 → 승인 `{role:'admin'}` → BM role admin · joined_at · 신청자 `/me` workspaces +1 · 알림 1(businessId 그 워크스페이스) · `business:<id>` 에 `join_request:updated`·`member:updated` 신호(본문 없음) · 감사 4종.
4. **한도·경합** — 자리 1 남은 워크스페이스에 신청 2건 승인 → 두 번째 422 · 같은 신청 승인 요청 2개 동시(Promise.all) → 멤버 행 1개(FOR UPDATE).
5. **고객 → 멤버** — 그 워크스페이스 활성 고객이 신청·승인 → `promoteClientToMember` 결과(고객 행 archived · 대화 역할 member) — `--category=clientlink` 회귀.
6. **limiter** — `lookup` 11번째 429 · `requests` 6번째 429 · `resend-verify-email` 4번째 429.
7. 크롬 3폭 — (b) 칸 · 멤버 화면 «참여 신청» 탭 · 설정 카드(코드 복사·재발급 확인창) · 미인증 계정은 (b) 가 안내 문장만.

### 공통 — Fable 검증(공용 기준 ② «인증/권한·공개 표면») 은 **2단계 완료 뒤 1회**(1단계는 공개 표면·권한 변경이 없어 자체 검증 숫자로 끝낸다 — 단 1단계도 `/register` 가 생명선이므로 위 1·2·8 숫자를 보고에 붙인다).
