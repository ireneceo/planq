# 워크스페이스 초대 인앱 알림 — 설계 초안 (Fable 판정 대기)

> [Opus] 초안 · 2026-10-12 · 방 3a26aed0 · Fable 한도(429)로 판정 못 받음 → 상황판 Fable 대기
> Irene 원문: «초대메일 보낸 사람이 우리 솔루션 사용하는 유저라면 플랜큐 안에서도 알림을 보내야 하지 않아? 워크스페이스 초대가 메일로만 알리네.»
> 정찰 계획: `.claude/plans/qmv5802hf.md`

**구현은 Fable 판정 뒤에 시작한다** — 인증/권한 판정의 원천(멤버십 행) 변경 + 운영 백필 + 외부 발송(푸시) 트리거라 공용 기준 `design`·`gate` 대상.

## 1. 사실 (코드·dev DB 실측, 2026-10-12 HEAD c9c7896e)

| # | 사실 | 위치 |
|---|---|---|
| F1 | 멤버 초대가 받는 이메일이 기존 계정이면 **초대 순간에** `business_members.user_id` 를 채운다(`joined_at` 은 NULL) | `routes/businesses.js` 멤버 초대 `BusinessMember.create({ user_id: existingUser?.id … })` |
| F2 | 권한 판정은 `joined_at` 을 안 본다 — `BusinessMember where {user_id, business_id, removed_at:null}` | `middleware/access_scope.js getUserScope` |
| F3 | 워크스페이스 전환기 원천도 `user_id` + `removed_at` 만 본다 | `routes/auth.js getUserWithBusiness` · `GET /api/businesses`(removed_at 도 안 봄) |
| F4 | ⇒ 기존 계정은 **수락 전부터 멤버 권한·전환기 노출** · 거절 불가 · 30일 만료 뒤에도 그대로 | dev `business_members id=330`(만료 · user_id 있음 · joined_at NULL) |
| F5 | 수락 경로는 user_id 가 NULL 이어도 이미 동작한다 — `bm.update({user_id, joined_at})` | `services/invites.js acceptInvite` |
| F6 | 좌석 계수는 이미 `joined_at` 을 «실멤버» 판별자로 쓴다(F2b — 바로 이 prefill 때문) | `services/inviteExpiry.activeMemberSeatWhere` |
| F7 | 설정 > 멤버 화면은 «대기 중 = `!user_id && invite_email`» — prefill 된 초대는 **실멤버로 그려진다** | `WorkspaceSettingsPage.tsx` isPending |
| F8 | 고객 초대도 기존 계정이면 `Client.user_id` 를 채우지만 권한 판정이 `status:'active'` 를 요구해 수락 전 접근 없음. 프로젝트 고객은 수락 때만 `contact_user_id` | `routes/clients.js` · `access_scope` 2)·3) |
| F9 | dev: 미수락 초대 3행 중 user_id prefill 1행 · **user_id 있음 + joined_at NULL + invite_token NULL 8행 = 옛 경로 직접 추가 실멤버(건드리면 안 됨)** | dev 읽기 |
| F10 | 운영 수치는 못 읽음(운영 읽기 스크립트가 권한 거부) | — |
| F11 | `notify()` 기본은 메일까지 태운다 → `skipChannels:['email']` 필요. 종 범위 `notificationScope` = 현재 워크스페이스 + `business_id NULL` | `routes/notifications.js` |

## 2. 초안 결정 (Fable 이 판정할 것)

### D1. 수락 전 멤버 권한 — (가) prefill 중단 + 백필 (권고)
- 멤버 초대에서 `user_id` 를 **채우지 않는다**(수락 때만). 중복 검사: 실멤버 = `user_id` 일치, 대기 = `invite_email` 일치(지금과 같다).
- user_id 키로 멤버십을 읽는 86개 파일을 하나도 안 고치고 한 번에 닫힌다. 화면 `isPending` 술어와도 맞아진다(F7).
- (나) «읽는 곳마다 joined_at 조건» 은 표면이 넓고 새 라우트가 또 빠뜨린다 — 기각 권고.
- 백필(멱등, 배포 슬롯 · 코드보다 먼저든 뒤든 무해):
  `UPDATE business_members SET user_id = NULL WHERE joined_at IS NULL AND invite_token IS NOT NULL AND removed_at IS NULL AND role NOT IN ('owner','ai')`
  - F9 의 8행(invite_token NULL)은 제외된다.
  - ★ 확인할 것: 수락 시 invite_token 을 지우지 않으므로 «수락했는데 joined_at 이 없는» 옛 행이 있는지 운영에서 먼저 센다(있으면 그 행은 실멤버 — 술어에서 빠져야 한다). 감사 로그 `invite.accept` 와 대조.
  - 백필 대상 user 의 `users.active_business_id` 가 그 워크스페이스면 `pickActiveBusinessId` 가 로그인·me 때 자가치유한다(멤버십 목록에서 빠지므로) — 별도 UPDATE 불필요(확인 필요).
  - 그 사람이 수락 전에 만든 데이터(업무·댓글 등)는 남는다 — 운영 건수 확인.
- grep 으로 볼 것: prefill 된 user_id 에 기대는 곳(멤버 목록·멘션 후보·담당자 후보·Cue 문맥·알림 fan-out «워크스페이스 멤버 전원»).

### D2. 인앱 알림
- 대상: 받는 이메일이 기존 계정(게스트 그림자 계정 제외 — notify 가 이미 거른다)인 **멤버 초대 · 워크스페이스 고객 초대 · 프로젝트 고객 초대** 다섯 곳. 헬퍼 하나 `services/inviteNotify.notifyExistingInvitee({ email, kind, businessId, wsName, inviterName, token, actorUserId, ioApp })`.
- `businessId: null` — 받는 사람은 그 워크스페이스에 아직 없으므로 워크스페이스 범위로 저장하면 어느 창에서도 안 보인다.
- `eventKind:'invite'`, `skipChannels:['email']`(초대 메일이 따로 나간다 — 두 통 금지).
- 링크 `/invite/<token>`(메일과 같은 문 — 수락 화면). 토큰이 푸시 페이로드로 Apple/Google 을 지난다: 토큰 = 메일함 소유와 같은 자격이라 새 노출은 아니라고 보지만 판정 필요. 대안은 `previewPolicy` 처럼 푸시엔 링크 없이 «초대가 왔다» 만.
- 문구 ko «{워크스페이스} 워크스페이스 초대» / «{초대한 사람} 님이 초대했습니다. 눌러서 수락하세요.» · en «Invitation to {ws}» / «{inviter} invited you. Tap to accept.» (서버 문자열 — 기존 notify 호출부와 같은 방식)
- 수락·취소·만료 뒤 알림: 수락 화면이 «이미 수락»/«만료» 를 말하므로 막다른 길은 아님 — 정리 표시는 선택.

### D3. 다른 계정으로 수락
- 지금처럼 토큰 소지자가 로그인한 계정으로 수락(토큰 = 메일함 소유). 인앱 알림은 이메일 주인 계정에만 간다. 변경 없음 권고.

## 3. 검증 계획 (구현 뒤 · 자체 + Fable gate 1회)
- 실 HTTP: owner(ws 6) 가 기존 시험 계정 이메일 초대 → ①받는 사람 `GET /api/businesses`·로그인 `workspaces` 에 ws 6 **없음** ②`GET /api/tasks?business_id=6` 등 멤버 라우트 **403** ③알림 행 1건(`business_id NULL`, event `invite`) · 초대 메일 1통(두 통 아님) ④받는 사람 종 목록에 보임 ⑤링크 수락 → 멤버 권한 생김 · 초대한 사람에게 기존 «가입» 알림.
- 음성 대조군: 없는 이메일 초대 → 알림 0 · 옛 코드(prefill)로 되돌리면 ①② 가 뒤집히는지.
- 백필 스크립트 dev 실행 → id 330 user_id NULL · F9 8행 불변 · 재실행 0행.
- `node scripts/health-check.js` · `guard-invariants.js` · `e2e --suite tenant` · build.

## 4. Fable 판정 (2026-10-15 · DESIGN-OK) — 구현은 이것을 따른다
정본 기록: `docs/FABLE_GATE_QUEUE.md` 맨 위 «2026-10-15 워크스페이스 초대 인앱 알림». 요지:
- 1절 정정: **F8 틀림** — 프로젝트 고객은 기존 계정이면 초대 순간 `contact_user_id` 와 고객 채널을 받는다(의도). 알림은 «추가되었습니다» · 그 biz · 프로젝트 주소 · 토큰 없음.
  **F11 보강** — `unreadEscalationCron` 이 `invite` 를 5분 뒤 메일로 다시 보낸다 → notify 에 에스컬레이션 차단 옵션.
- D1 (가) + 백필 둘 갈래(그 biz 감사 기록 0 → 대기로 / 1↑ → joined_at = 첫 감사 시각). 운영 사전 점검 ⒝=0 이어야 진행.
- D2 헬퍼 `services/inviteNotify` 한 벌 · 경로 5 · 재발송 중복 금지 · 수락/취소 때 읽음 처리 · 알림 클릭의 `/invite` 는 전면 이동.
- D3 유지. D4 완료 때 Fable gate 1회.
