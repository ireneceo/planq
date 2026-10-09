# 팀 대화방 «참여자만» — 설계 (2026-10-09 · 보안 점검 2차 D3)

> Irene(상황판 답): «권고대로» — Fable 권고 *«참여자를 고른 그룹 대화는 참여자만 · 프로젝트·팀 채널은 지금대로»*.
> 조사: 대화방이 보이는/전달되는 자리 전수(아래 §4 표). 운영 실측(읽기만): 프로젝트 없는 팀 대화방 6개(그중 만든 사람 혼자 3개) ·
> **참여자 아닌 사람이 글을 쓴 방 0개** — 바꿔도 대화방을 잃는 사람이 없다.

## 1. 무엇이 «사적 대화방» 인가 — 정의 한 줄
`project_id IS NULL AND client_id IS NULL AND channel_type IN ('internal','group')` = 사람을 골라 만든 팀 대화.
  (Fable: `client_id` 조건이 없으면 고객이 붙은 internal 방이 «팀은 못 보고 고객은 보는» 거꾸로 닫힘이 된다.)
- 프로젝트 채널(project_id 있음) · 고객 채널(customer) — **지금대로**(워크스페이스 멤버 전원).
- 판정 함수 하나: `access_scope.isPrivateConversation(conv)` — 칸이 덜 실린 객체가 오면 다시 읽는다(fail-closed).

## 2. 누가 보나
- 사적 대화방: **참여자만**. owner/admin 도 참여자가 아니면 못 본다(«나만 보기» 문서·일정과 같은 선). platform_admin 은 종전대로.
- 고객 규칙은 그대로(참여자 또는 자기 client_id).

## 3. 한 벌로 바꾸는 것
1. `canAccessConversation` · `conversationListWhere` — 정본. 멤버 목록은 `(project_id not null) OR (channel_type = customer) OR (id IN 내 참여 대화)`.
   → 목록·상세·읽음·메시지 CRUD·첨부·묶음 다운로드·검색·Cue·AI 에이전트·공유 카드·끌어 넣기·대시보드 대화가 **그대로 물려받는다**.
2. 소켓: `server.js canJoinConversation` 을 `canAccessConversation` 으로(직원 하위 방도 같은 판정) · 참여자를 빼면 그 사람 소켓을 `conv:X` 에서 뺀다.
3. **새 메시지 방송** — 사적 대화방은 `business:` 방이 아니라 **참여자 각자의 `user:` 방**으로(`message:new`·`message:reaction`).
   한 함수 `services/convBroadcast.emitConvEvent(io, conv, event, payload)` 로 모은다(6곳: conversations · projects · chatPost · guest · invoiceDelivery · clientOnboarding — 고객/프로젝트 방은 지금과 같은 방).
4. 참여자 추가 — 사적 대화방은 **이미 참여자인 사람만** 추가할 수 있다(지금은 멤버 누구나 자기를 넣을 수 있다 = 규칙 우회).
5. 프로젝트 없는 대화방 헬퍼 `projects.js loadStandaloneConvOrForbidden`(메모·이슈·업무 후보·추출·대화방 수정) · Cue 초안 승인/거절·평가 — `canAccessConversation` 으로.
6. 숫자 — 푸시 배지 SQL(`notifications.js`)을 목록 술어로 · 멘션 알림은 볼 수 있는 사람에게만(아니면 제목·발췌가 나간다).
7. 파생물 — 대시보드 업무 후보: 사적 대화방에서 나온 후보는 그 방 참여자에게만 · 공유 대상 고르기 목록·서명 카드·문서/업무 작성 때 `conversation_id` 연결: 볼 수 있는 방만 ·
   업무·문서 목록의 «출처 대화방» 제목: 볼 수 없으면 제목을 싣지 않는다.

## 4. 바꾸지 않는 것 (의도)
- **확정된 업무는 업무 규칙 그대로** — 사적 대화에서 만든 업무도 업무다(담당·요청자·워크스페이스 업무 목록). 대화 내용은 따라가지 않는다(출처 제목만 가림).
- 이벤트 흐름(event_stream)은 본문이 없는 활동 메타 — 이번 범위 밖(기록).
- 보관함 목록 제목 — 같은 목록 술어를 쓰게 한다(보관도 같은 방이다).

## 5. 검증
- 실HTTP: 멤버 A·B, owner O. A 가 B 와 만든 방 — O·C(비참여 멤버) 목록·상세·메시지·첨부·검색 = 없음/403, A·B = 보임 · O 가 참여자 추가로 자기를 넣기 403 ·
  프로젝트·고객 채널 = 종전대로 보임(대조).
- 실소켓: A 가 보낸 메시지 — B 소켓 받음 · O·C 소켓 0건 · 프로젝트 채널 메시지 = O·C 받음(대조).
- 대조군: 원본 코드로 되돌려 같은 검사가 뒤집히는가. health · guard · tenant · clientlink · 빌드.

## 6. Fable 설계 검토 (2026-10-09, OK-WITH-CHANGES → PASS) 반영
1. 정의에 `client_id IS NULL` (위 §1). 운영 6건 전부 client_id 없음.
2. «잃는 사람 없음» 은 «쓴 사람» 만 잰 것 — 혼자 방 3건을 읽기만으로 확인: 멤버 1명 워크스페이스 2곳·2명 워크스페이스 1곳(메시지 2·만든 사람만 씀). 전체 채널 모양 없음.
   **참여자 자동 백필 안 함**(하면 그날부터 전원에게 알림). 새 대화 창에 «프로젝트 없는 대화는 참여자만 봅니다» 한 줄.
3. owner/admin 은 내용은 못 보지만 **관리 행위(보관·삭제·참여자 내보내기)는 id 로 남는다** — 업무 삭제와 같은 선. 그 응답에 본문 없음.
   유일한 멤버 참여자가 나가면 그 방은 platform_admin 외 아무도 못 본다(기록).
4. 사적 방 방송은 `user:` 방으로만 — `business:` 로 같이 쏘지 않는다. `emitConvEvent` 가 유일한 문 + 가드(직접 `business:` 로 `message:new` 금지). 후보 방송(발췌)도 같은 문.
5. Cue 를 켜는 순간 Cue 사용자를 참여자로(`findOrCreate`) — 참여자 목록에 보이게. ★ 완료 검증에서 «효과 없음» 확인: Cue(ai)는 접근 판정의 멤버가 아니고 자동응답은 고객 채널 전용이라, 사적 방에서 답하는 경로는 원래 없다(해 없음).
6. 업무 후보(발췌 포함)는 목록·승인/거절·방송 셋 다 같은 술어.
7. 멘션 — 피커는 참여자만, 서버는 비참여자를 버린다.
8. 검증 추가: owner 가 id 로 메시지 GET/POST·첨부·반응·핀·읽음·참여자 = 403 · 알림 링크 `?conv=` 폴백 · Cue 켠 사적 방에서 Cue 답 · 메시지가 정확히 1번 그려짐 · 가드 양성 대조군.

## 7. Fable 완료 검증 (2026-10-09) — VERDICT: PASS
- owner·admin 양쪽 비참여자로 목록·단건·수정·삭제·실시간·안읽음·푸시 배지·멘션·검색·리뷰/인사이트·고객 경로·프로젝트/고객 채널 회귀 실측 — 누수 0·회귀 0.
- 비차단: ① Cue 참여자 추가는 판정상 효과 없음(위 5) ② 보관된 사적 방은 목록에서 아무도 못 본다(보관함은 관리자 전용·관리자 비참여) — id 로 해제는 된다
  ③ 메일 주석 정정 ④ `dashboard.collectCandidates` 는 지금 `/todo` 가 부르지 않는 함수(술어는 무해) ⑤ API 로 `group` 을 보내도 `internal` 로 저장(판정 무관).
