# 역할 사전 — 워크스페이스 공통 + 커스텀 (2026-10-15, Fable 설계)

> Irene: *"프로젝트에서나 여기 저기 역할들이 개발/디자인/기획 이런 식으로 개발팀 기준인데 이러지 말고 기본세팅은 공통으로
> 알게 해주고, 태그관리처럼 커스텀되게 해줘. 설정에서 하게 해주거나 각각 UI에서 동기화되서 추가되게 프로젝트나 다른 곳에서 동기화 되어야 해."*
> 정찰 계획 `.claude/plans/qmv7v6w4t.md` · 설계 판정 Fable (방 c8f9ad50)

## 원인
역할은 사전 없는 자유 글자였다. 새 프로젝트 모달만 개발팀 목록(기획·디자인·개발·영업·운영·기타)을 하드코딩했고,
프로젝트 상세·설정 «맡은 일» 은 자유 입력이라 같은 뜻이 자리마다 다른 글자로 쌓였다. 설정에서 관리하거나 한 곳에서 만든 것이
다른 곳에 보일 정본이 없었다.

## Fable 결정 (그대로)
1. **사전 표 `member_roles`** — TaskTag 모양에서 color 만 뺀다. id · business_id · name STRING(30) · sort_order · created_by ·
   UNIQUE(business_id,name) ai_ci · 인덱스 이름 명시. 워크스페이스당 50개(409 `role_limit`).
2. **저장은 글자 그대로(FK 없음) + 사전이 «쓰는 문» 을 감싼다** — `services/memberRoles.js` 한 벌:
   `ensureRole`(없으면 사전에 추가 — 프로젝트 멤버 저장·기본 역할 저장·초대·프로젝트 생성이 모두 경유) ·
   `renameRole`(트랜잭션 안에서 사전 + `project_members.role` + `business_members.default_role` 을 **같은 business_id 범위에서**
   `LOWER(TRIM(x)) = LOWER(old)` 로 일괄 UPDATE, 새 이름이 이미 있으면 409) · `deleteRole`.
   이유: 읽는 쪽(task_extractor·templateApply·LLM 프롬프트)이 전부 글자다.
3. **삭제 = 그 역할을 단 멤버는 비움(NULL)** — 확인 문구·응답에 인원수.
4. **공통 기본 세트 7개, 글자 시드** — 기획/Planning · 디자인/Design · 제작/Production · 영업/Sales · 마케팅/Marketing ·
   운영/Operations · 고객지원/Support. «개발»·«기타» 는 넣지 않는다. 워크스페이스 언어(`default_language`, 없으면 ko)로 글자를 시드.
   새 워크스페이스는 생성 때(Business afterCreate 훅 — 생성 문 3곳+스크립트 공통), 기존은 `migrate-member-roles.js`.
   «첫 조회 때 비었으면 시드» 는 쓰지 않는다(다 지운 사전을 되살린다).
   흡수: 워크스페이스별로 쓰인 `project_members.role`·`default_role` 을 사전에 넣는다. 잡값 5종 `기타·팀원·오너·owner·member` 는
   넣지 않고 그 행을 NULL 로. 컬럼 DEFAULT `'기타'` → NULL.
5. **설정 «기본 역할»(default_role) 과 프로젝트 역할은 같은 사전.** 멤버를 프로젝트에 넣을 때(나 포함) default_role 로 미리 채우고
   없으면 빈칸. 하드코딩 목록·`qtalk.newProject.role.*` 삭제.
6. 템플릿 `role_hint` 는 범위 밖(다른 축 — 후속: 사전을 제안으로만).
7. 권한: 추가 = 멤버 이상 · 개명·정렬·삭제 = owner/admin · 고객 사전 API 403.
8. 비움 허용, 기본값 NULL — 화면은 빈칸(«팀원»·«기타» 표시 폐기).
9. 피커·관리창은 태그 것을 공용으로 빼서 같이 쓴다(`components/Common/DictManageModal` · `DictPicker`).
   훅 `useMemberRoleDict` + `createMemberRole` 한 곳. 실시간 `member_role:updated`(biz 방).
   붙일 곳: 설정>멤버 «기본 역할» · 초대 폼 · 새 프로젝트 모달 · 프로젝트 상세>멤버. 관리 진입점 = 설정>멤버 탭 상단 «역할 관리».
10. 검증: member POST 200 / member PUT·DELETE 403 / client GET 403 / 다른 워크스페이스 403 · 개명 전후 개수 + 다른 워크스페이스 같은 글자
    불변(음성 대조군) · 삭제 인원수 = 실제 NULL 수 · 동기화 양방향 · 미리채움 · 마이그레이션 2회 멱등 · task_extractor null-safe.

## 운영
`dev-backend/scripts/migrate-member-roles.js` (멱등, 배포 슬롯 PM2 reload 전 — 모델이 표를 쓴다).
롤백: 코드 revert. 표 잔존 무해, NULL 로 바꾼 잡값(기타·팀원·오너…)은 되돌리지 않는다(표시만 빈칸이 된다).

## Fable 완료 검증 1차 FAIL → 고침 (2026-10-15)
- 차단: 배포 슬롯이 `sync-database.js` **뒤**라 sync 가 빈 `member_roles` 를 먼저 만들고, 스크립트는 «이미 있음» 으로 흡수·시드를 건너뛰었다
  → 운영 첫 배포에 전 워크스페이스 역할 0개 + 옛 '기타' 그대로(dev 재현 118/118 빈 사전).
- 고침: ① 슬롯을 `sync-database.js` **바로 앞**으로 ② 스크립트가 «표를 만들었거나 **표가 통째로 비어 있으면**» 흡수·시드(이중 방어)
  ③ 모델 FK 에 `onDelete`(business CASCADE · created_by SET NULL) — sync alter 가 FK 를 다시 만들어도 동작이 같다
  (FK 이름·`created_by` 인덱스는 sync 모양이 된다 — 다른 표와 같은 정상 상태).
- 재현(dev, 원복함): 스크립트→sync 순서 834행·빈 워크스페이스 0 · 옛 순서(빈 표 먼저)도 834행 · 재실행 skip.
- 비차단 반영: task_extractor 프로젝트 멤버 프롬프트에 역할 없으면 `(role: null)` 대신 생략 · seed-project-samples 의 '팀원' → NULL.
  남김: 사용자가 `기타` 를 직접 다시 만드는 것은 허용(사용자 글자) · health-check invite_mail 픽스처 낡음(이 변경 밖, 고객 초대 라우트 이동).
