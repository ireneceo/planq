# 채팅에서 고객 정보·멤버 정보 공유 (명함 아니어도) — 설계 초안

- 상태: Fable 설계 판정 **DESIGN: CHANGE** 반영해 구현 (방 c1868e32 · 2026-11-25 · [Opus] 조사·구현) — 판정은 아래 5절. **5절이 3절보다 우선**한다.
- Irene 원문: «고객 정보나 멤버 정보도 서로 공유할 수 있으면 좋겠다. 명함 아니여도.»
- 앞선 일: 채팅 «+» 업무·일정 추가(797215cd) · 명함 카드 `name_card`(docs/NAME_CARD_V3_STRATEGY.md 9절 결정 4) · 정찰 계획 `.claude/plans/qmwvqp7pa.md` B 절

## 1. 지금 있는 것 (사실)
- 채팅 «+» = `pages/QTalk/ChatPanel.tsx` OverflowMenu(`chat-plus`): 파일 · 명함 보내기 · 업무 추가 · 일정 추가(멤버만).
- 카드 메시지 = `messages.kind='card'` + `meta.card_type`. 쓰는 문 하나 `services/chatPost.postCardMessage`(저장·방송·알림).
  business 방 방송은 `SECRET_META`(share_token·url 등) 를 덜어낸다.
- 명함 카드: `POST /api/businesses/:biz/name-card-messages` — **공개 링크(/c/:token)가 열린 명함만**. meta 에 이름·부제·공개 url. 누르면 공개 명함 페이지.
  게스트·고객도 같은 공개 페이지로 연다(`cardResolver.resolveCard` name_card 분기).
- 게스트 링크 채팅(`routes/guest.js`)은 카드마다 `resolveCard` 로 상태를 다시 계산하고, 주소는 누를 때 302 로만 준다. 모르는 card_type → `unsupported`.
- 사람 정보의 정본:
  - 고객 = `clients` 행(표시명·회사·전화·직함·부서·이메일(초대 이메일/계정 이메일)·사업자 칸·메모·담당 멤버·영업 단계·요약…) + `client_contacts`(담당자 여러 명: 이름·직함·부서·이메일·휴대폰·전화·팩스·주소·메모·사진).
    읽기 권한 = Q sale 메뉴(`saleCommon.readChain` — 멤버 이상 + `requireMenu('qsale','read')`, 고객 403).
  - 멤버 = `business_members`(표시명·직함·organization·부서/팀) + `users`(이메일·전화·아바타). 같은 워크스페이스 멤버는 `/members` 로 이미 연락처까지 본다.
    고객은 멤버 목록을 못 본다(memberOnly). `UserInfoPopover` 가 멤버/고객을 가려 이름·이메일·직책·회사를 보여 주고 프로필(멤버 `/business/members?member=`, 고객 `/sale/:id`)로 간다.
- 고객 «내 고객으로 저장» 류: `client_contacts.source` ENUM 에 `chat` 이 이미 있다(쓰는 곳 없음).

## 2. 무엇을 정해야 하나 (되돌리기 어려운 판단)
1. **어떤 방에 보낼 수 있나** — 팀 방(고객 참여자 없음) / 고객 방(고객이 읽음) / 게스트 링크가 걸린 방(링크 받은 제3자가 읽음).
2. **카드에 무엇을 싣나** — 스냅샷(보낸 순간 값 박제) vs 참조(id 만, 볼 때 보는 사람 권한으로 다시 읽음).
3. **누르면 어디로** — 내부 상세(Q sale 고객 상세·멤버 상세) vs 새 공개 링크.
4. **받은 사람이 «저장»** — 같은 워크스페이스 안이라 고객은 이미 Q sale 에 있다. 저장이 뜻을 가지려면 «다른 고객의 담당자로 추가» 같은 것뿐.

## 3. 작업 모델 제안 (Fable 판정 받을 안)
- **A. 팀 방 전용 «참조 카드» 두 종** — `client_profile`(client_id) · `member_profile`(user_id).
  - 보낼 수 있는 방: 고객·게스트가 없는 방만(`channel_type` 이 customer 가 아니고 client 참여자 0 · 게스트 링크 0). 서버가 거절(400 `room_has_external`).
  - 보내는 사람: 멤버 이상. 고객 카드는 Q sale read 권한이 있어야 보냄. 멤버 카드는 같은 워크스페이스 활성 멤버만.
  - meta = `{card_type, client_id|user_id, title(표시명)}` 만 — 연락처·메모를 메시지에 박제하지 않는다(나중에 지워도 대화에 남는 사본이 생긴다 · 검색·Cue·전달 재료로 새는 길).
    title 도 볼 때 다시 읽어 덮는다(보는 사람 권한) — 권한 없으면 «볼 수 없는 고객» 으로.
  - 카드 본문(요약)은 보는 사람 기준 응답 한 곳 `GET /api/businesses/:biz/profile-cards/:type/:id` 로 다시 읽는다:
    고객 = 표시명·회사·직함·담당 멤버·대표 연락처(전화·이메일) · 멤버 = 표시명·직함·부서/팀·이메일·전화(= `/members` 와 같은 폭).
  - 누르면 내부 상세 새 탭(고객 `/sale/:id` · 멤버 `/business/members?member=`). 공개 링크 없음.
  - 전달(forward)은 card 라 이미 안 됨(forwardable 은 text 만). 게스트 화면엔 visibleToGuest 를 거치지만 고객·게스트 없는 방이라 닿지 않음 — 그래도 `resolveCard` 에 두 종을 `not_available` 로 명시(모르는 값으로 떨어뜨리지 않게).
- **B. 고객 방·게스트 방에서 «사람을 소개» 하고 싶을 때** = 기존 명함 카드(공개 명함 링크)로. 이번에 새 표면을 열지 않는다.
  멤버가 «+» 메뉴를 고객 방에서 열면 «고객 정보·멤버 정보» 항목은 보이지 않거나 비활성 + 이유.
- **C. «내 고객으로 저장»** 은 만들지 않는다(같은 워크스페이스 — 카드를 누르면 이미 그 고객 상세).
- 실시간: postCardMessage 그대로(카드 meta 에 비밀값 없음). 프로필이 바뀌어도 카드는 볼 때 다시 읽으므로 방송 추가 없음.
- 대안(기각 후보): 고객 방에도 «담당 멤버 정보» 카드를 허용(고객이 담당자 연락처를 알게) — 고객이 멤버 연락처를 보는 새 표면이라 이번엔 명함으로.

## 4. 확인 방법(계획)
- 실HTTP: 팀 방 client_profile/member_profile 보내기 201 → 메시지 card_type 재조회 일치 · 고객 방 400 · 게스트 링크 걸린 방 400 · 고객 토큰 403 · Q sale read 없는 멤버 → 고객 카드 보내기 403, 받은 카드 요약 = «볼 수 없음»(이름도 안 나옴) · 다른 워크스페이스 client_id 404.
- 화면 3폭: «+» 항목 · 고르기 창 · 카드 렌더 · 누르면 새 탭 상세 · 다른 창 실시간.
- 가드·빌드·health·tenant.

## 5. Fable 설계 판정 (2026-11-25 · DESIGN: CHANGE) — 구현이 따른 것
바꾼 점 ① 메시지 content·meta 에 이름 없음 — `{card_type, client_id|user_id}` + 고정 문구 «[고객 정보]»/«[멤버 정보]»
(알림 본문·미리보기·검색·Cue 재료·business 방 방송·답장 인용으로 먼저 나가기 때문) ② 방 술어는 허용 목록 `channel_type IN (internal, group)`
(NULL = 옛 팀 방, access_scope 와 같은 해석) + `client_id NULL` + client 참여자 0(**is_viewer 행 포함**) + 살아 있는 게스트 링크 0 + 보관 아님 — PlanQ 안내방(platform) 차단
③ 고객·게스트에게는 자리도 없다 — `utils/messageVisibility.STAFF_ONLY_CARD_TYPES` 를 고객 술어 한 벌(Sequelize·raw SQL·메모리)에 넣어
목록·미리보기·안읽음·검색·Cue·`conv:<id>` 방송(→ `:staff`)·게스트가 같이 닫힌다. `cardResolver` 도 두 종을 `not_available` 로 명시
④ 대상 검증(멤버 = 활성 직원·수락된 계정·Cue/AI 제외 / 고객 = 같은 워크스페이스·보관/멤버 전환 제외) + 감사 `profile_card.sent_to_chat`(연락처 값 없음)
⑤ 멤버 카드 폭 = `/members` 가 직원에게 주는 칸(표시명·직함·부서/팀·소속·이메일·전화·아바타) — 그보다 넓지 않게.
그대로: 팀 방 전용 · 참조 방식(볼 때 보는 사람 권한, 권한 검사 먼저 → no_permission/not_available) · 누르면 내부 상세 새 탭 · 저장 기능 없음 · 고객 방은 명함.
- 구현: `services/profileCard.js`(판정 한 곳) · `routes/profile_cards.js`(방 확인·보내기·보는 사람 기준 요약) · `utils/messageVisibility.js` ·
  화면 `pages/QTalk/{ProfileCardBubble,SendProfileCardModal,chatCardShell}.tsx` · `services/profileCards.ts`. AI 에이전트 표면에는 넣지 않았다.
- Irene 에게 알릴 것: «명함 아니어도» 는 **팀 방에서만** 된다. 고객 방에서 담당자를 소개하는 것은 이번에도 명함(멤버 연락처 동의 장치가 명함 공개 스위치뿐). 넓히려면 별도 결정.
