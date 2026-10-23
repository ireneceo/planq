---
paths:
  - "dev-backend/routes/**"
  - "dev-backend/services/**"
  - "dev-backend/middleware/**"
  - "dev-backend/models/**"
  - "dev-backend/mcp/**"
  - "q-note/**"
  - "scripts/health-*.js"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 보안 — 응답 비밀값·공유·참조·권한 회수 상세

### 응답에 **자격증명을 싣지 않는다** (2026-09-13 박제)

`c.toJSON()` · `successResponse(res, model)` 처럼 **모델을 통째로** 내보내는 코드는 컬럼이 늘 때마다
자동으로 새 필드를 내보낸다. 2026-09-13 실측 — `GET /api/clients/:biz`(목록·상세)가 **`invite_token`** 을
실어 보냈다. 그 토큰은 `POST /api/auth/register` 가 **"그 고객으로" 계정을 붙이는 값**이다
(`routes/auth.js:242` · `routes/invites.js:57`) — 고객 목록 **읽기 권한만** 있어도 남의 고객 초대 링크를
만들 수 있었다. 화면은 그 필드를 한 곳도 쓰지 않았다.

- **비밀 필드는 한 곳에서 내린다** — `services/clientResponse.js` 의 `CLIENT_SECRET_FIELDS` + `stripClientSecrets()`(고객 라우트 두 파일이 같이 쓴다).
  응답 지점마다 손으로 지우면 새 라우트에서 빠진다.
- **열거식은 컬럼이 늘면 샌다**(`feedback_mask_by_whitelist_not_denylist`). 그래서 **게이트에 붙였다** —
  `node scripts/health-check.js --category=secrets` 가 응답 **원문 문자열**로 판정한다(키 이름만 보면
  중첩·새 경로에서 빠져나간다). 통째로 빈 응답이 거짓 통과하지 않도록 "쓸 필드는 그대로 온다" 대조군도 같이 본다.
- **토큰·해시·시크릿을 새로 컬럼에 넣으면** 그 모델을 내보내는 라우트를 전수로 보고, 같은 계열 검사를 1건 추가한다.
- 노출된 뒤에는 **회전 여부를 데이터로 판단한다** — 2026-09-13 운영 실측은 고객 7명 중 토큰 보유 1건,
  그중 미수락 0건이어서 **살아 있는 링크가 없었다**(회전하면 이미 보낸 메일의 링크가 죽는다).

### 공유·참조는 **다섯 규칙**이다 (2026-09-27 박제 — 보안 설정 점검)

> Irene: *"개별 업무나 개별 문서마다 보안 설정한 거, 공유범위랑 제대로 구조화되서 엇나가는 문제 없는지 확인해."*
> 점검 결과·체크리스트 정본: `docs/SECURITY_SWEEP_2026-09-27.md`

1. **공유 링크 발급 = 읽기와 같은 술어** — 문서 `canReadPost` · 파일 `canAccessFileByLevel`/`canDownloadFile` · Q info
   `canAccessKbDocumentByLevel` · 업무 `canAccessTask`. `/api/share/*` 공용 경로도 `shareDenied` 로 **각 자료의 자기 공유 라우트와 같은 검사**.
2. **범위를 L1/L2 로 좁히면 이미 나간 링크를 끊는다** — `services/share_helper.shareOffPatch`(비밀번호 해시까지). 달력이 선례.
   (예외: Q note — 공유 창이 외부 링크를 별도 컨트롤·해제 버튼으로 다룬다. 생성자만 발급.)
3. **비밀번호 공유는 하위 주소(PDF·첨부·옛 다운로드·OG 미리보기)도 비밀번호를 본다** — `<a href>` 는 헤더를 못 실으므로
   비밀번호를 통과한 응답에만 서명(`shareSubQuery` → `?dl=`)을 붙이고 하위 라우트가 `verifyShareSub` 로 본다.
4. **보안등급(internal·confidential)은 밖으로 나가는 모든 문에서 막는다** — 공개 첨부 판정 `shareOpenable.isPublicFile` 은 L4 **+ general**.
5. **참조(첨부·연결·미팅자료·복사·brief·KB 가져오기)는 붙일 때 원본 읽기 권한, 보여줄 때 보는 사람 기준.** 제목을 복사해 두지 않는다.

- **Q info 읽기 판정은 한 벌**(`access_scope.canAccessKbDocumentByLevel`·`kbDocumentsListWhereByLevel`) — 목록·상세·검색·Cue·추천이 같은 함수.
- **Cue 가 고객 대화방에 답할 때 재료는 «그 고객에 연결된 것» 뿐** (2026-10-16, Irene *"고객은 연결된 곳만 보이는 거야"* · Fable 판정) —
  Q info 는 `access_scope.canClientReadKb`/`kbClientReadableWhere` 한 벌(scope client · client_id/client_ids · 보안등급 일반 — 전체 공개 L3/L4 워크스페이스·프로젝트 자료도 빠진다).
  지식 카드(CueKnowledge)는 내부 화면(audience internal)만. 고객에게 답할 재료는 고정 FAQ 로 넣는다. 회귀 health-check kbauth `cue_client_kb`.
- **고객은 자기 범위 Q info 를 고객 홈 «자료» 칸에서 읽기 전용으로 본다** (2026-10-23, Irene «권고대로» · Fable 설계 `docs/CLIENT_QINFO_VIEW_DESIGN.md`) —
  술어는 위 한 벌 + `vlevel L4·NULL`(나만 보기로 바뀐 고객 범위 행은 빠진다) · 모양은 `services/kbClientView` 한 벌(비밀 칸·작성자·범위 칸·첨부 없음 — 공개 링크 by-token 도 같은 칸 함수) ·
  API `routes/client_home.js` `/info`·`/info/:id`(없으면 404) · 실시간 `services/kbSignal.emitKb` 한 문(고객 범위면 연결 고객 `user:` 방에도 신호). `routes/kb.js` 의 고객 403 은 그대로.
  회귀 `--suite clientinfo` · health-check secrets «고객 홈 자료·공개 링크».
- **고객이 볼 프로젝트는 `project_clients.contact_user_id = 나` 하나로 판정한다**(프로젝트 목록·access_scope·참여자 추가 등 10곳).
  고객에 계정이 붙는 문(초대 수락)은 반드시 `services/clientOnboarding.linkClientToProjects` 를 부른다 — 2026-10-06 워크스페이스 고객
  수락이 이 값을 안 채워 **고객 화면에서 프로젝트·채팅방이 통째로 사라졌다**(프로젝트 상세는 표시용으로만 메워 «참여 중» 이라 우리 쪽에선
  안 보였다). 대화 참여자 역할은 서버가 정한다(멤버 → member, 아니면 client) — 내부 메시지 알림 제외가 `role==='client'` 로 판정한다.
  회귀: health-check `--category=clientlink` · `--suite clientlink`.
- **실시간 방송은 신호만**(`{id, business_id, project_id}`) — 행 전체를 방에 뿌리면 L1 본문·공유 토큰이 멤버 전원·프로젝트 고객에게 간다. 받는 화면은 id 로 다시 읽는다.
- **목록 범위 조건은 `Op.and` 안에** — 호출부가 `where.project_id = ?` 로 필터를 덧붙이면 최상위 키는 덮어써진다(고객 문서 목록이 그랬다).

### 보안 점검 2차가 더한 세 규칙 (2026-10-09 박제 — 정본 `docs/SECURITY_SWEEP_2026-10-09.md`)
6. **프로젝트 방은 둘이다** — 멤버 `project:<id>` / 고객 `project:<id>:client`. 방송은 **`services/projectRoom.emitProject` 한 문**
   (고객 방에는 `CLIENT_VIEW` 에 등록된 사건만 고객용으로 — 업무는 `taskClientView`, 나머지는 신호. 모르는 사건은 고객에게 안 간다).
   `io.to(\`project:…\`)` 직접 쓰기는 가드 `--category=broadcast`(checkProjectRoom)가 막는다. 대화방은 `isVisibleToClient` 로 `conv:<id>` / `:staff` 를 고른다.
7. **권한이 줄면 실시간도 회수한다** — 멤버 내보내기 → `socketRevoke.leaveBusinessRooms` · 정지/탈퇴/비밀번호 재설정 → `disconnectUser`
   (소켓 인증이 계정 상태를 본다). 비밀번호 재설정은 refresh 토큰 전부 revoke.
8. **응답 비밀값은 전역 toJSON 한 곳이 내린다**(`models/index.js`) — `_enc`·`_encrypted`·비밀번호/공유 비밀번호 해시·일회용 토큰·평문 결제 비밀값.
   보유 여부가 필요하면 **원본 행(인스턴스)에서** 읽는다(toJSON 뒤 객체에는 없다).
- **공개 링크 하위 주소는 비밀번호를 주소에 싣지 않는다** — 메타 응답이 주는 서명(`download_qs` → `?dl=`)을 쓴다. 공유 비밀번호는 링크당 15분 10회.
- **지운 워크스페이스의 공개 링크는 닫힌다** — 공개 라우터마다 `router.param('token', workspaceAliveParam(...))`(하위 PDF·다운로드까지). 새 공개 라우터도 같은 줄을 붙인다.
- **«나만 보기» 는 owner/admin 에게도 닫힌다** (2026-10-09 D2, Irene «권고대로») — 문서·파일·**Q info·일정·업무** 모두 같은 선(관리 행위 중 볼 수 없는 것은 수정·삭제도 못 한다).
- **업무도 문서와 같은 공개 범위·보안등급이다** (2026-10-12, Irene *"문서랑 일정처럼 … 기존 기능 그대로 반영해야지"*) — `tasks.vlevel`·`target_member_ids`·`security_level`.
  업무에 이름이 박힌 사람(작성·담당·요청·컨펌)은 범위와 무관하게 본다(일정 참석자 규칙). 판정 `access_scope.canAccessTask`/`taskListWhere` 한 곳,
  값 정규화 `services/taskVisibility`, 실시간은 **`services/taskRoom.emitTask` 한 문**(L1·L2 행은 볼 수 있는 사람 개인 방에만).
  업무 제목을 내보내는 새 화면·보고서·AI 문맥은 `taskListWhere` 를 건다(보는 사람을 모르면 L3·L4 만). 설계 `docs/TASK_SECURITY_LEVEL_DESIGN.md`.
  예외: 개인 주간회고는 **대표가 본다**(보고 내용 — Irene).
- **프로젝트·고객 없는 팀 대화는 참여자만** (2026-10-09 D3) — 정의 `access_scope.isPrivateConversation` 하나, 판정 `canAccessConversation`/`conversationListWhere`.
  워크스페이스 전체로 알리는 대화 사건(새 메시지·반응·업무 후보)은 **`services/convBroadcast.emitConvWide` 한 문**(사적 방은 참여자 `user:` 방) — 가드 checkConvBroadcast.
  참여자 행을 **만드는** 문(핀·읽음·참여자 추가)은 반드시 술어를 먼저 본다(findOrCreate 가 곧 끼어들기다). 설계 `docs/PRIVATE_CHAT_DESIGN.md`.
- **Q talk «열어 봄» ≠ «참여»** (2026-10-15 Fable A) — 읽음·핀이 만드는 행은 `conversation_participants.is_viewer=1`(내 읽음 커서·핀만).
  모델 defaultScope 가 참여자만 보이게 해 참여자 목록·@·메시지 알림·읽음 분모·사적 방 접근권에서 빠진다. 쓰는 문은 `services/convParticipants.js` 하나
  (`touchOwnRow` viewer · `joinParticipant` 초대·생성·승격 · `promoteSpeaker` 말하면 참여자 · `removeRows`). 가드 `--category=convparticipants`.
  목록에 보이는 범위(멤버 이상은 프로젝트·고객 방)는 그대로. 운영: `migrate-conv-viewer.js`(배포 슬롯) · 옛 행 `backfill-conv-viewer.js`(dry-run 기본, 수동). 설계 `docs/QTALK_PARTICIPATION_DESIGN.md`.
- **멤버는 참여한 프로젝트 ∪ «전체 공개» 프로젝트만 본다** (2026-10-16, Irene *"관리자 아닌데 모든 프로젝트가 나오고 있어 … 자기가 들어가 있는 프로젝트와 그와 연결된 업무들과 일정들만 … 아니면 전체공개분만"* · Fable 설계) —
  `projects.visibility`(members 기본·기존 행도 / workspace). owner·admin·platform_admin 은 전부. 판정은 `access_scope` **한 곳**:
  `scope.visibleProjectIds`(null=제한 없음) · `canSeeProject` · `projectScopeWhere` · 쓰기 문 `userCanSeeProject` — `visibility` 칸을 다른 곳에서 직접 읽지 않는다.
  프로젝트에 달린 항목 = 이름 박힌 사람 ∨ (프로젝트 보임 ∧ 기존 vlevel). 목록·상세·업무·일정·대화·파일·문서·Q info·검색·AI 앱·Cue·소켓 `project:<id>`·만들기/옮기기가 같은 판정.
  바꾸는 것은 관리자·PM(`PUT /api/projects/:id visibility`). 배정해도 프로젝트 멤버로 자동 추가하지 않는다. 운영 `migrate-project-visibility.js`(배포 슬롯, 숨겨지는 쌍 수 출력). 설계 `docs/MEMBER_PROJECT_SCOPE_DESIGN.md`.
- **고객이 같은 계정으로 멤버가 되면 «멤버가 이긴다»** (2026-10-16, Irene *"고객이었는데 … 멤버 가입했는데 그대로 고객이야"*) — `services/clientToMember.promoteClientToMember` 한 곳
  (멤버 초대 수락이 부른다): 고객 행 보관(`archived`+`member_converted_at`, 이력 유지) · 프로젝트 고객 행 → 같은 프로젝트 멤버 · 대화 역할 client→member.
  멤버 해제는 고객으로 되돌리지 않는다. 활성 멤버를 고객으로 붙이는 문(프로젝트 고객 추가·고객 초대 수락)은 409 `already_member`. 옛 데이터 `migrate-client-to-member.js`(기본 읽기만, `--apply`).
- **사람 이름은 워크스페이스 표시명이다**(2026-10-23, Irene *"Q sales 고객탭 담당이 실명이 나와 … 다시는 이런 요청 안하게"*) — 응답에 사람을 실을 때
  `users.name`(계정 이름)을 그대로 내보내지 않는다. `services/displayName.applyMemberDisplayName` 으로 덮거나 `display_name` 을 같이 싣는다.
  dev 시험 워크스페이스는 표시명이 비어 있어 **화면으로는 안 보인다** — 판정은 `health-check --category=displayname`(계정 이름·표시명을 서로 다른 고유 문자열로 두고
  응답 원문으로 · 대조군 = 표시명이 실렸는가). 사람이 실리는 새 화면 API 는 `scripts/health-access.js displayname_wide` 의 목록에 한 줄 더한다.
- **관리자는 남의 개인 메일 계정을 끄기만 한다**(공용 전환은 주인만, 2026-10-09 D4).
- **멤버 초대는 수락할 때만 계정을 붙인다** (2026-10-15 Fable D1) — 멤버십을 읽는 곳은 `user_id` 로 찾고 `joined_at` 을 안 보므로,
  초대 순간 `business_members.user_id` 를 채우면 **수락 전부터 멤버**다(거절 불가·만료 뒤에도). 초대 행은 `user_id NULL` 로 만들고
  `services/invites.acceptInvite` 만 채운다. 옛 행은 `scripts/migrate-invite-prefill.js`(기본 읽기만 · `--apply` 따로).
  기존 계정에게는 앱 안에서도 알린다 — **`services/inviteNotify` 한 벌**(멤버·고객·프로젝트 고객 초대 5곳, 범위 NULL·링크 `/invite/<token>`,
  메일·재알림 메일 끔, 수락·취소 때 읽음). 알림 클릭은 `utils/notificationLink.openNotificationTarget`(앱 셸 밖 경로는 문서 이동). 회귀 `--suite invitenotify`.
- **「같은 서버에서 왔나」를 접속 IP 로만 보지 않는다** — nginx 도 127.0.0.1 에서 프록시한다. q-note 는 `X-Real-IP`/`X-Forwarded-For` 가 있으면 바깥으로 본다(`main.py _internal_gate`), Node 는 `trust proxy` 로 본 `req.ip`(`utils/internalAuth`).

