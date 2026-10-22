# 조직 규모 0단계 — 설계 (2026-10-19 · [Opus] 초안 → Fable 설계 판정)

> 근거: `docs/ORG_SCALE_REVIEW.md` 4절 0단계 · 5절 결정 1·2·3. Irene 2026-10-19 «권고대로 진행해 줘»(8건 모두 Fable 권고).
> 0단계 다섯 가지: 0-1 퇴사 인수인계 · 0-2 퇴사자 «나만 보기» 업무 · 0-3 대표용 변경 이력 · 0-4 여러 명 초대 · 0-5 Q task 목록 서버 거르기.

## 0. 조사로 바뀐 사실 (ORG_SCALE_REVIEW 이후)
1. **대표용 변경 이력은 이미 있다** — 설정 > 팀원 활동 기록(`pages/Settings/ActivityLogSection.tsx`, 2026-08-31) · `GET /api/activity/:biz`(owner/admin) · `services/event_stream.getWorkspaceStream`(감사·청구·프로젝트·업무 상태·청구 이벤트·메시지 7소스).
   ORG_SCALE_REVIEW S6 «보는 화면이 플랫폼 관리자뿐» 은 틀렸다. 지금 화면이 보여 주는 것은 **기계 코드**(`task.delete` · `task #785`)라 사람이 못 읽는다.
   그리고 7소스를 다 섞어 «메시지 보냄» 이 관리 행위를 덮는다. **제목은 하나도 안 싣는다**(audit 은 action·target 만 SELECT) → L1 제목 누출은 지금 없다.
2. **owner/admin 은 L2 를 전부 본다**(`access_scope.js:337-338`). 결정 2 «L1 업무 → 인수자 L2» 를 그대로 하면 **대표도 그 업무를 보게 된다** — 결정 문구의 취지(«인수자에게», 개인 범위 보호)와 다르다. 아래 0-2 에 대안.
3. 멤버 내보내기는 **owner 또는 본인**만(`routes/businesses.js:1488`). admin 은 못 한다. 초대도 owner 만(`:828`).
4. dev 실데이터 — 해제된 user 15(biz 3): 열린 담당 1 · 대기 컨펌 3 · 요청 4 · 프로젝트 0. 해제된 사람이 컨펌자로 남은 업무는 **아무도 컨펌할 수 없다**(승인 정책 all 이면 영영 막힌다).

## 0-1. 퇴사 인수인계 (R=0 · M)

### 무엇이 넘어가나 — «열린 것» 만 (완료·취소된 업무는 기록이라 그대로)
| 대상 | 조건 | 넘기는 방법 |
|---|---|---|
| 담당 업무 | `assignee_id = 퇴사자` ∧ 열린 상태 | 담당자 → 인수자. 이력 `assignee_change` + 감사. 인수자 알림은 **묶어서 한 통**(아래) |
| 컨펌 대기 | `task_reviewers.user_id = 퇴사자` ∧ `state='pending'` ∧ 열린 업무 | 컨펌자 행을 인수자로 바꾼다(이미 컨펌자면 퇴사자 행만 지운다). 이력 `reviewer_change`(없으면 note) |
| 요청한 업무 | `request_by_user_id = 퇴사자` ∧ 열린 상태 | `request_by_user_id` → 인수자(작성자 `created_by` 는 안 바꾼다 — 사실 기록). 확인·검토 알림이 갈 사람이 생긴다 |
| 프로젝트 | `owner_user_id` / `default_assignee_user_id` = 퇴사자 · `project_members.is_pm` | 인수자로. 인수자가 프로젝트 멤버가 아니면 멤버로 추가(PM 이었으면 PM 으로) |
| 고객 담당 | 이미 내보낼 때 비운다(종전) | 인수자를 지정하면 비우지 않고 인수자로 |

**넘기지 않는 것**: 대화방(주인 칸이 없다 — 참여자는 내보내면 방 접근이 닫힌다) · 문서·파일·Q note·Q info(작성자 사실, 공개 범위가 이미 정한다) · 일정(참석 기록).

### 문
- `GET /api/businesses/:id/members/:memberId/handover` → `{ counts: { assigned, assigned_private, reviewing, requested, projects, clients }, sample?: none }` — **수만**. 제목 목록은 싣지 않는다(L1 이 섞여 있다. 넘길 대상 제목은 넘기는 사람이 볼 수 있는 것만 보여 줄 수도 있지만 0단계는 수만).
- `POST /api/businesses/:id/members/:memberId/handover` `{ to_user_id }` → 위 표를 한 번에. 받는 사람 = 이 워크스페이스 활성 멤버(owner/admin/member, AI·고객·대기 초대 제외) ∧ 퇴사자 아님. 멱등(두 번 눌러도 두 번째는 0건).
- 내보내기(`DELETE`)는 그대로 둔다. 화면이 «넘기고 내보내기» 를 한 동작으로 묶는다(POST handover → DELETE). 넘기지 않고 내보내면 **확인창이 남는 수를 말한다**.
- 권한: **owner · platform_admin**(내보내기와 같은 술어 — 본인 탈퇴는 인수인계를 강제하지 않는다. admin 을 열지 여부는 Fable 판단 — 내보내기 권한과 갈라지면 «넘길 수는 있는데 내보낼 수 없는» 상태가 된다).
- 구현 위치: `services/memberHandover.js` 한 곳(집계 `summarize` · 실행 `apply`). 담당 변경은 행동 계층의 **이력·감사·broadcast 규칙**을 따르되 `reassign()` 을 그대로 부르지 않는다 — `reassign` 은 `fieldContext` 로 «넘기는 사람이 볼 수 있는 업무» 만 허락해(D2) 퇴사자의 L1 업무를 못 넘긴다. 인수인계는 «업무를 고치는 행위» 가 아니라 «사람 교체» 라 판정 축이 다르다 → 이 서비스가 직접 쓰고, 그 대신 **바꾸는 칸을 담당·컨펌자·요청자·프로젝트 주인 칸으로 고정**한다(제목·본문·범위는 안 건드린다).
- 알림: 인수자에게 **한 통** `«○○ 님의 업무 N건·컨펌 M건을 넘겨받았습니다»`(링크 = Q task «내 업무»). 업무마다 보내면 20건이면 20통. 메일은 안 보낸다(`skipChannels:['email']`).
- 실시간: 바뀐 업무마다 `taskRoom.emitTask`(L1 은 볼 수 있는 사람 방만 — 기존 문). 
- 감사: `business_member.handover` `{ from, to, counts }`.

### 화면 (멤버 관리 > 내보내기)
- [내보내기] 를 누르면 지금 확인창 대신 **우측 패널 `DetailDrawer`**: 남는 것 수(담당 N · 그중 나만 보기 n · 컨펌 대기 M · 요청 K · 프로젝트 P · 고객 C) → 넘겨받을 사람 셀렉트 → [넘기고 내보내기](Primary) / [넘기지 않고 내보내기](Danger, 확인창 «담당 N건이 주인 없이 남습니다»).
- 남는 것이 0이면 종전 확인창 그대로.
- ko/en i18n.

## 0-2. 퇴사자 «나만 보기» 업무 (R=1 · S)
결정 2(Irene «권고대로»): «업무 L1 만 인수자에게, 문서·파일·메모는 동결 + 약관 한 줄».

사실 2 때문에 «L1 → 인수자 L2» 는 대표에게도 열린다. 두 가지 방법:
- **(A) L1 을 유지하고 인수자를 «이름 박힌 사람» 으로** — L1 은 이름 박힌 사람(작성·담당·요청·컨펌)에게 보인다. 0-1 이 담당·요청·컨펌 칸을 인수자로 바꾸므로 **그 칸에 퇴사자가 있던 L1 업무는 별도 처리 없이 인수자에게 보이고 대표에게는 계속 닫힌다**. 남는 경우: 퇴사자가 **작성자로만** 박힌 L1 업무(담당이 다른 사람이거나 없음, 요청자 칸 비어 있음) → 그 업무의 `request_by_user_id` 를 인수자로 채운다(요청자 승계).
- **(B) 결정 문구대로 L2(대상 = 인수자)** — 단순하지만 owner/admin 이 본다(L2 전부 규칙).
- **권고 (A)** — 결정 취지(«인수자에게», 개인 범위는 대표에게도 닫힘 D2)를 지키고 새 전이 함수가 필요 없다. 화면 수에는 «나만 보기 n건은 넘겨받는 사람만 볼 수 있어요» 를 적는다.
- 동결: L1 문서·파일·Q note·Q info 는 손대지 않는다(계정이 살아 있으면 본인이 내보내기로 가져간다).
- 약관: 이용약관 «회원의 의무/콘텐츠» 쪽에 한 줄 — «워크스페이스에서 탈퇴·제외되면 그 워크스페이스의 업무 기록(나만 보기 업무 포함)은 워크스페이스가 지정한 인수자에게 넘어갈 수 있습니다.» (ko/en, `legal.json`). **버전을 올릴지(재동의 모달)는 Fable 판단** — 이용자에게 불리할 수 있는 변경이라 지난 «유리한 변경은 안 올림» 선례와 다르다.

## 0-3. 대표용 변경 이력 (R=1 · S) — 이미 있는 화면을 «읽히게»
결정 3: «관리 행위만 + 항목 이력은 항목 안에서».
- 서버 `GET /api/activity/:biz` 에 `scope=admin`(기본) | `all`. `admin` = 감사 소스 중 **관리 행위 화이트리스트**만:
  `business_member.*` · `member_role.*` · `member.*` · `*permission*` · `business.*`(설정·모듈) · `*.delete` / `*.deleted` / `*.purge` · `*.share_create` / `*.share_off` · `*visibility_change*` · `*security_level*` · `plan.*` · `payroll.run_export` · `data_export*` · `agent_grant.*` · `invite.*` · `guest_link.*` · `business_member.handover`.
  `all` = 지금 7소스 그대로(종전 동작).
- 응답에 `label_key`(= 행위 분류 i18n 키, 서버가 action → 분류 하나로 정한다 `services/activityLabels.js`)를 싣는다. 화면은 `t(label_key)` 로 «업무 삭제», «멤버 내보냄», «공유 링크 만듦» 처럼 읽는다. 모르는 action 은 코드 그대로(숨기지 않는다).
- **항목 이름은 싣지 않는다**(지금과 같다) — 대상은 «업무 #785» 로, 볼 수 있는 사람이 누르면 열린다(열기 판정은 각 상세 화면의 기존 술어). 이름을 싣지 않으므로 L1 이 새는 길이 없다. (지운 항목의 이름을 보여 주려면 감사 old_value 를 읽어야 하는데 거기엔 L1 제목이 있을 수 있다 → 0단계에서 하지 않는다.)
- 화면: 머리에 [관리 행위만 / 전체] 알약(`segmentedToggle`), 사람 필터(`actor`), 기존 «삭제만 보기» 유지.

## 0-4. 여러 명 초대 (R=0 · S, 외부 발송)
- `POST /api/businesses/:id/members/invite` 를 **배열도 받게** — `{ emails: string[], default_role?, department_id?, team_id? }`(옛 `{ email }` 도 그대로). 한 번에 최대 20명.
- 한 명 처리 = 지금 핸들러 본문을 `services/memberInvite.inviteOne()` 으로 옮긴 함수(중복·한도·역할 사전·메일·앱 알림·감사). 한도: 시작 전에 남은 자리 수를 보고, 넘는 사람은 `quota` 결과로 돌려준다(일부만 보냄 — 화면이 줄마다 말한다).
- 부서·팀: 초대 행(`business_members`, user_id NULL)에 `department_id`·`team_id` 를 저장 → 수락은 같은 행을 채우므로(`services/invites.acceptInvite`) 그대로 남는다. 이 워크스페이스 부서·팀인지 확인.
- 응답 `{ results: [{ email, status: 'invited'|'already_member'|'already_invited'|'quota'|'invalid' }] }`(단건 요청은 종전 응답 그대로).
- 레이트리밋: 기존 `perUserDaily('invite-email', 20/분 · 200/일)` 은 요청 1건을 센다 → 배열이면 사람 수만큼 세도록 같은 키로 추가 차감.
- 화면: 초대 창 이메일 칸을 여러 줄(쉼표·줄바꿈·공백으로 나눔) + 부서·팀 셀렉트 + 보내기 전 **확인창에 받는 주소 목록**(CLAUDE.md 외부 발송 규칙 — 멤버 초대는 «미적용» 으로 남아 있던 곳) → 결과 줄 목록.

## 0-5. Q task 목록 서버 거르기 (R=0 · S)
- 지금: 화면이 `all-tasks` 를 1,000 × 5쪽 = 5,000건까지 받고 넘으면 **말없이 잘린다**(`QTaskPage.tsx:606-615`). 완료·취소도 전부 받는다.
- 서버 `all-tasks` 에 `done=recent|all` — `recent` = 열린 업무 전부 + 완료·취소 중 `updated_at`(또는 completed_at) 최근 30일. 주간·오늘 탭의 «완료 포함» 은 이번 주라 30일 안이다.
- 화면: 첫 로드는 `done=recent`. **완료 가리기를 끄거나 · 상태 필터를 완료/취소로 고르거나 · 기간 필터가 30일보다 앞이면** `done=all` 로 한 번 더 받는다(받은 뒤엔 캐시).
- 상한: 5쪽 뒤에도 `has_more` 면 목록 위에 «업무가 많아 최근 5,000건만 보여요 · 검색이나 필터로 좁혀 보세요» 한 줄(조용히 잘리지 않게).
- 우선순위 재인덱스의 정본(`inWeekCanonical`)은 열린 업무 기준이라 영향 없음 — Fable 확인 요청.

## 검증 계획 (자체)
- 실HTTP(3003): handover 집계·실행(담당·컨펌 교체·요청·프로젝트·L1 업무가 인수자에게 보이고 owner 에게는 계속 403) · 멱등 · 비owner 403 · 받는 사람 검증(AI·고객·해제 멤버 400) · 초대 배열(성공·중복·한도 초과 혼합) · activity scope=admin 이 메시지·상태 소스 제외 · label_key · all-tasks done=recent 수 대조.
- 가드 health-check · guard-invariants(i18n·parity·autosave·drawerwidth) · `npm run build` · e2e tenant + 새 화면 3폭(멤버 내보내기 패널·초대 창·활동 기록).

## Fable 에게 묻는 것
1. 0-2 (A) vs (B) — (A) 로 결정 2 의 취지를 지키는 게 맞나. 약관 버전을 올려야 하나.
2. 0-1 인수인계가 `reassign()` 을 우회해 직접 쓰는 것(퇴사자 L1 업무 때문에)이 맞나 — 바꾸는 칸 고정으로 충분한가. 권한을 owner 로만 둘지 admin 도 열지.
3. 0-1 «요청자 승계»(`request_by_user_id` 교체)가 기록 왜곡인가 — 대안이 있으면.
4. 0-3 화이트리스트 범위 · 이름을 싣지 않는 것으로 충분한가.
5. 0-4 부분 발송(한도 넘는 사람만 거절)이 맞나, 전부 거절이 맞나.
6. 0-5 30일 기준·다시 받는 조건에 빠진 경로가 있나.

## 9. Fable 설계 판정 반영 (2026-10-22, 1회 — FAIL 차단 4 → 반영하면 PASS)
판정 원문 요지는 `docs/FABLE_GATE_QUEUE.md` 2026-10-22 항목. 위 본문과 다르면 **이 절이 정본**이다.

1. **해제된 멤버에게도 인수인계 문** — handover 두 라우트는 `BusinessMember.unscoped()` 로 찾는다(워크스페이스 일치·role≠ai). 집계 `summarize` = «해제됐든 아니든 그 user_id 로 남은 열린 것». 멤버 관리 화면에 «나간 멤버 — 남은 것 N건» 줄(남은 것 >0 인 해제 멤버만) → 같은 패널.
2. **`notify()` 수신자 멤버십** — `businessId` 가 있으면 받는 사람이 그 워크스페이스 활성 멤버(removed_at NULL) 또는 활성 고객(clients.user_id·status active)이 아니면 `skipped:'not_member'`(fail-closed). 해제된 멤버에게 이미 나가던 누출도 같이 닫힌다.
3. **업무 쪽 교체는 `task_actions.handoverNamedRoles(task, actor, {from, to})` 하나** — 검사는 «actor 가 owner/platform_admin ∧ from 이 해제 중·해제된 멤버» 만(FIELD_RULES 안 탐). 담당(이력 assignee_change) · 요청자(request_by = from 일 때만 교체, note «인수인계», NULL 은 채우지 않는다) · 컨펌자(pending 행 → 인수자, 인수자가 담당자면 넣지 않음 = 자기 컨펌 금지, 이미 컨펌자면 퇴사자 행만 지움) → `recalcStatusFromReviewers` → 컨펌 라운드인데 컨펌자 0 이면 `in_progress` + 이력 note · `broadcastTask` · 감사. `memberHandover.js` 는 집계·순회·한 통 알림·`business_member.handover` 감사만.
4. **L1 업무**: 담당이 퇴사자인 L1 은 담당 교체로 인수자에게 보인다(이름 박힌 사람). 담당 없는 L1 → 담당자 = 인수자. 담당이 다른 사람인 L1 은 그대로(패널에 수만). 단 **L1 분기는 `HANDOVER_L1_EFFECTIVE_AT` 이전엔 세기만 하고 넘기지 않는다** — 이용약관 버전을 올리고(재동의) 시행일 = 공지 + 30일(약관 제13조).
5. 권한 `canRemoveMember(req, member)` 한 함수를 DELETE·handover 가 같이 쓴다(owner·platform_admin). admin 은 1-3 때.
6. 활동 기록 `services/activityLabels.js` = action → {label_key, admin} 명시 표. `scope=admin` 은 표에서 admin:true 인 감사만(모르는 것 제외), `all` 은 종전. 사람·부서 대상은 `target_label`. 급여 행위는 보는 사람이 급여 담당일 때만.
7. 초대 배열: `dry_run:true` 로 줄별 판정만 → 확인창이 보낼 주소 k개·남은 자리를 적고 → 실제 호출은 k > 남은 자리면 422 `quota {remaining}` 로 **한 통도 안 보냄**. invalid·already_* 는 줄별. 레이트리밋은 사람 수만큼. `team_id` 가 오면 `department_id := team.department_id`.
8. Q task: 서버 `done` 생략 = all(종전), `recent` = 열린 것 + `updated_at` 30일 안 완료·취소. 화면은 완료 가리기 끔·상태 필터 완료/취소·기간 30일 앞·**검색어 있음** 이면 `done=all`. 칸반 완료 칸 제목에 «최근 30일». 5,000 상한은 상수 하나에서 문구 보간.
9. 비차단: 담당 메일·상담 예약은 패널에 수만 · 반복 업무 승계·project_members 해제 거르기 검증 · 고객 담당 교체는 Q sale 담당 변경과 같은 문.
