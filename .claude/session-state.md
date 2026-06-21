# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-21
**작업 상태:** 완료 — 운영 배포 2회 (D4 보안등급 확장 + 닉네임 누락 수정·소속 표시)

### 진행 중인 작업
- 없음 (미배포 0)

### 완료된 작업 (이번 세션)
1. **D4 보안등급 posts/kb/docs 확장 (#62)** — files 한정 `security_level`(general/internal/confidential)을 Post·Document·KbDocument 로 확장. 공통 `services/securityLevel.js`(blocksExternalShare). 외부공유 게이트(posts share/email/chat/L4전환·docs share·kb share+번들) + entity별 `PUT /security-level`(상향 시 토큰 무효화) + share.js 통합 게이트 일반화(옛 /chat 누락 갭 보완). 프론트 PostsPage·PostShareModal·KnowledgePage·DocumentEditorPage 배지·선택·hint·차단배너. 운영 DB ENUM 3테이블 확인. **commit cfb1abe·d679639 (v1.44.1), 배포 080734.**
2. **워크스페이스 닉네임 누락 전수 수정** — 멤버 이름을 계정명(User.name)으로 노출하던 회귀 14곳을 `applyMemberDisplayName` 으로 일괄 수정(posts·files·task_attachments·task_workflow·kb·email_threads·qnote_bridge, 공개뷰·PDF 포함). 커버리지 6→15 라우트. **commit 04183bb.**
3. **멤버 소속(부서·팀) 표시 확산** — `/members` Department/Team join + UserInfoPopover(채팅 hover) + TaskDetailDrawer(업무 상세 담당자) 표시(i18n 현지화). **commit 05b21b4·9f3b9cf.**
   - 운영 배포 ec8b721 (091155). 실데이터 검증: user3 닉네임[루아]/계정[한수정] → posts author '루아' 노출.

### 다음 할 일
- **소속 표시 잔여(선택):** 업무 리스트 행(밀집 노이즈 검토)·고객 상세. 현재 채팅·업무상세·OrgPage 적용됨.
- **AI 기능 전수검사** (`docs/AI_FEATURE_AUDIT.md`) — Cue·Q Note·자동분해 AI 호출 점검·최적화 (자율 착수 가능).
- **#63 워크스페이스 간 이동** (대규모, `/기능설계` 필요) — 퇴사자 자료 이동. 이동단위·권한·승인흐름 제품 결정 선행.
- **보고서 디자인 세부 보완** — Irene 화면 검토 후 추가 요청 대기.
- **기타 backlog:** 도움말(Help) 센터(`project_help_center_plan`), Google OAuth 검증 제출, #60 iOS Capacitor.

### 구조 박제 (절대 임의 변경 금지)
- memory `feedback_member_display_name_on_lists` — 멤버 이름 반환 라우트는 applyMemberDisplayName 필수(공개뷰·PDF 포함). 전수 커버리지 기록됨.
- memory `feedback_deploy_exit1_spurious` — 배포 exit 1 부수 신호, 운영 독립 검증으로 판정.
- memory `project_d_cluster_org_design` / `project_reporting_structure` / `feedback_copy_existing_design_not_bespoke`.

### 참고
- `planq-dev-backend`·`planq-qnote` 는 **irene** pm2. 운영 `irene@87.106.78.146`(PROD_BE=/opt/planq/backend, port 3004).
- 배포: 커밋 후 `./scripts/deploy-planq.sh --auto`. 빌드 8GB(`NODE_OPTIONS=--max-old-space-size=8192`). exit 1 떠도 운영 헬스/실데이터 통과면 성공.
- 닉네임 검증용 실데이터: dev biz3 user3 = 아이린/김미정, 운영 user3 = 루아/한수정.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
