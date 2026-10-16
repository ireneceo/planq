# 직접 관리 고객(비가입 고객) — 설계 (Fable 설계 판정 2026-10-15)

> Irene: *"플랜큐에 고객이 가입을 안해도 관리자가 정보를 넣고 직접 관리하는 고객도 포함하면 안돼? 청구서나 다양한 관리에 고객정보가 필요한데 고객들이 굳이 가입할 필요는 없어서."*
> 정찰 `.claude/plans/qmv7hp0uc.md` · 판정 Fable(설계 1회) · 구현 [Opus]

## 판정
1. **상태 = `clients.status` ENUM 끝에 `'managed'` append.** `active` 는 코드 전체에서 «계정이 연결된 고객» 이다 — 같은 값에 두 뜻을 주지 않는다.
   접근 종류(`accessKindOf`)는 그대로 `guest`(정보만·로그인 없음).
2. **한도 = 정식 고객(`clients_max`)에 센다.** `billableClientWhere`(≠prospect) 그대로. 생성 문이 `plan.can('add_client')`.
3. **초대 = 행 id 기준 승격이 정본**(`POST /invite` 에 `client_id`), 이메일 일치는 보조. 승격 판정 `canInviteClient`(prospect·managed). 승격은 한도 +0.
4. **이메일은 선택**(이름 또는 회사 필수). 컬럼은 `invite_email`. 중복(`findExistingByContact` 이메일·전화) → 409 `existing_client_id`.
   수정 허용 술어 `emailEditable` = 계정 없음 ∧ 초대 토큰 없음 ∧ status ∈ {prospect, managed}.
5. **보관 해제는 증거로 되살린다** — `reactivatedStatusOf`: 계정 → active · 초대 흔적 → invited · 그 외 → managed. prospect 보관은 409(종결은 Q sale lost).
   기존 «active + 계정 없음» 행은 마이그레이션 백필로 invited/managed.
6. won → managed 자동 착지는 안 한다. 사람이 누르는 문 `POST /:biz/:id/register-managed`(prospect → managed, 한도 검사).
7. 화면: 새 화면 없음 — 고객 추가 CreateDrawer 에(2026-10-16 부터 Q sale > 고객 탭 [+ 고객 추가] — docs/CLIENT_SCREENS_MERGE_DESIGN.md) «초대 보내기 / 직접 관리로 등록» 모드, 드로어에서 계정 없는 고객의 이메일·전화 자동저장 편집, «이 고객 초대».
8. PUT 의 `status` 입력 제거(아무 행이나 active 로 만들던 문) · resend-invite 는 invited 만.

## 술어 단일 원천
`services/clientAccess.js` — `accessKindOf` · `canInviteClient` · `emailEditable` · `reactivatedStatusOf`. 응답에 `can_invite`·`email_editable` 을 붙여 화면은 그 값만 본다.

## 운영
`dev-backend/scripts/migrate-client-managed.js` — ENUM append(멱등) + 백필(dry-run 기본, `--apply`). 배포 슬롯 PM2 reload 전.
롤백: 코드 revert + `UPDATE clients SET status='prospect' WHERE status='managed'`.

## 뺀 것
won 자동 전환 · 새 이메일 컬럼 · 고객 병합/CSV 가져오기 · 보관 행 한도 계수 변경 · managed 게스트 링크 · AI 고객 생성 도구 · invited 고객 정기청구.
