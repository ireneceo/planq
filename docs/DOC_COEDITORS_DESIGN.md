# 문서 공동 편집자 (작성자 지정형) — 설계 (2026-10-23 · Fable DESIGN-OK)

> Irene 2026-10-22: «내가 만든 문서를 고객이 편집가능권한을 가진건지 어떤 멤버가 있는지 어떻게 알아? 모두 서로 서로 막 작성자 본인 아닌데 편집되는 건 아니지?»
> → «② 작성자가 공동 편집자를 지정(구글 문서처럼)» «권고대로 진행해 줘».

## 결정
1. **저장 — 표 `post_editors`**(post_id·user_id·added_by·created_at, UNIQUE(post_id,user_id), idx user_id). JSON 칸 아님 — 멤버 내보내기 정리가 한 줄, 누가 언제 넣었나가 행에 남는다.
   상세 GET 만 `co_editors:[{user_id,name,added_by,created_at,readable}]` + `can_manage_editors`. 감사 `post.editors_update`.
2. **편집 판정 `services/postAccess.canEditPost` 한 곳** — platform_admin ∨ 작성자 ∨ (post_editors ∧ 활성 멤버 이상 ∧ 지금 canReadPost).
   **owner/admin 편집 예외 없음**(업무 description/body 선례). 고아 문서는 owner 가 자기를 지정(명시·감사·알림).
3. **지정/해제 `canManagePostEditors`** = 작성자 ∨ owner ∨ admin ∨ platform_admin. 대상 = 활성 멤버 ∧ 지정 시점 canReadPost(고객 400 · 못 읽음/L1 409 `widen_visibility_first`).
4. **옛 문서** — 새 규칙 일괄 + 백필 1회(`post_revisions.editor_user_id ∪ posts.editor_id`, ≠작성자, 지금 활성 멤버). dry-run 기본, `--apply`. kind 차이 없음.
   표 문서의 **행 입력(routes/records.js)은 범위 밖** — 데이터 입력 축. posts PUT(제목·본문·칸)만 새 규칙.
5. canEditPost 호출처는 자동으로 새 규칙(이력 복원·서명 만들기/관리/회차·설문·presence·AI 쓰기). **첨부 추가/삭제도 canEditPost 로 올린다.**
   공동 편집자에게 안 주는 것: 공개 범위·보안등급·삭제·지정·**프로젝트 옮기기**(작성자 ∨ owner ∨ platform_admin).
6. 범위가 좁아져 못 읽게 된 공동 편집자는 행 유지·판정 차단·칩 회색(readable:false). 행 삭제는 명시 해제·멤버 내보내기 두 문.
7. 알림 `doc_editor`(ENUM append, 앱만·메일 없음) — 지정된 사람 + 지정자≠작성자면 작성자. 해제·백필은 알림 없음.
8. 실시간: `broadcastPost` 신호 + 해제된 사람 `user:<id>` 방 `post:editor_removed {id}`. 화면은 재조회해 can_edit false 면 편집 모드를 내린다(초안 보존).
9. 화면: 밴드2 좌측 ChipPopover `post-editors-chip` «편집: 작성자만 / 작성자 +n», 관리자만 추가·해제, 편집 불가 문구에 작성자 이름.

운영: `scripts/migrate-post-editors.js`(표·ENUM 2·백필 `--apply` 수동) — 배포 슬롯, 코드보다 먼저.
