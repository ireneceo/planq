# 고객→멤버 전환 · 멤버 프로젝트 가시성 설계 (Fable 설계 판정, 2026-10-16)

> Irene 2026-10-16: *"어떤 프로젝트에서 고객이었는데 같은 이메일로 멤버 가입했는데 그대로 고객이야. 전반적으로 표시가 고객이 아닌 것으로 바뀌어야지? 그리고 멤버들은 프로젝트에 들어가 있는 것만 프로젝트 리스트에 나와야 하는데 왜 다 나와? … 자기가 들어가 있는 프로젝트와 그와 연결된 업무들과 일정들만 나와야지. 아니면 전체공개분만 보여야지."*

## A. 멤버가 이긴다 — `services/clientToMember.js`
- `promoteClientToMember({businessId,userId,actorUserId,transaction})` 멱등. 부르는 곳: `invites.acceptInviteInner` workspace_member 두 분기(정상·dup).
- ① clients(biz,user,status≠archived) → 행 유지 · `status='archived'` · `member_converted_at=NOW()` (청구·상담 이력 유지). 옛 status 는 감사 `client.converted_to_member` old_value.
- ② project_clients(contact_user_id=U, 그 워크스페이스) → 삭제 + 같은 프로젝트 project_members 행(있으면 건너뜀). 삭제 행 전체를 감사 old_value.
- ③ conversation_participants role='client'(그 워크스페이스 대화) → 'member'.
- 실시간 `member:updated` + 프로젝트마다 emitProject `project:updated`.
- 역방향: 멤버십 해제는 고객으로 되돌리지 않는다. 활성 멤버를 고객으로 붙이는 문(프로젝트 고객 추가·Q sale 고객 초대·고객 초대 수락)은 `assertNotWorkspaceMember` 로 409 `already_member`.
- 옛 데이터: `scripts/migrate-client-to-member.js`(기본 읽기만, `--apply`) — 컬럼 `clients.member_converted_at` 추가 포함, 같은 함수 호출.

## B. 멤버는 «들어간 프로젝트 ∪ 전체 공개» 만
- `projects.visibility ENUM('members','workspace') NOT NULL DEFAULT 'members'` — 기존 행도 members(권고). `--existing=workspace` 로 바꿀 수 있다.
- platform_admin·owner·admin = 전부 · member·ai = project_members ∪ visibility='workspace' · client = 종전.
- `scope.visibleProjectIds`(null=제한 없음) · `canSeeProject(scope,id)` · `projectScopeWhere(scope,col)` — `access_scope.js` 한 곳. 다른 곳에서 `visibility` 컬럼을 직접 읽지 않는다.
- 프로젝트에 달린 항목 = 이름 박힌 사람 ∨ (프로젝트 보임 ∧ 기존 vlevel). 프로젝트 없는 항목 무변경.
- 숨은 프로젝트 업무의 담당자는 업무·프로젝트 이름은 보고 프로젝트 상세는 403.
- 배정해도 프로젝트 멤버로 자동 추가하지 않는다.

### Phase 1 (같이 나가야 새지 않는다)
getUserScope · GET /api/projects · loadProjectOrForbidden(+removed_at) · canAccessProject · 업무/일정/대화/파일·문서·Q info ByLevel · socket projectRoomRole · searchScope · agent directory · cue_context · 프로젝트 생성 visibility 입력.
### Phase 2 (이름만 새는 표면)
dashboard · today_review · event_stream · voice.js · survey_manage.js · posts.js:272.

### 실시간 (Fable 완료 검증에서 추가 — 2026-10-16)
- 워크스페이스 방(`business:<id>`)은 멤버 전원이 들어 있다. 숨은 프로젝트의 행·본문은 볼 수 있는 사람 개인 방으로만:
  `access_scope.hiddenProjectAudience`(현직 프로젝트 멤버 ∪ owner/admin, null=전체 공개) 를 `taskRoom.emitTask` · `convBroadcast.emitConvWide`(팀 메모 포함) · `projectRoom.emitBusinessForProject`(project:updated 이름·이슈) 가 쓴다.
- 좁히거나(visibility→members) 프로젝트 멤버를 빼면 `socketRevoke.leaveHiddenProjectRooms` 가 project·conv 방을 회수한다.
- 프로젝트 복사(`POST /:id/duplicate`)도 canSeeProject. Q sale 고객 초대도 활성 멤버 메일이면 409.

### 롤아웃
`scripts/migrate-project-visibility.js`(멱등·배포 슬롯·숨겨지는 쌍 수 출력) · UI 프로젝트 설정 «전체 공개» 토글(owner/admin/PM) + 목록 칩 + 멤버 빈 상태 문구 · PERMISSION_MATRIX §1 갱신.
