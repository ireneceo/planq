# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-20
**작업 상태:** 완료 — D2-b 외부인 담당자/컨펌자 picker (dev 검증 E2E 23/23, 미배포)

### 진행 중인 작업
- 없음

### 완료된 작업 (2026-06-20 — D2-b)
- **D2-b 외부 파트너 담당자/컨펌자 picker (보안민감) — dev 검증 E2E 23/23, 미배포**
  - 게이트키퍼 `assertAssignable(targetUserId, businessId, projectId)` 신설(`middleware/access_scope.js` 단일 출처): 멤버(AI Cue 포함)=전체 / 외부 파트너(active client+user 계정)=그 프로젝트 참여자만 / 그 외 user_id=차단. project 없는 업무는 외부인 배정 불가. **기존 assignee_id 무검증 취약점(타 워크스페이스·유령 배정) 동시 차단.**
  - 적용 3곳: `tasks.js` POST·PUT(담당자) + `task_workflow.js` POST `/:id/reviewers`. reviewer `is_client` 는 **서버 도출**(클라 입력 불신뢰). 자동 컨펌자 is_client 도 isClient 반영.
  - 신규 API: `GET /api/tasks/by-business/:biz/assignable-externals?project_id=`(멤버 전용, 프로젝트 참여 외부인 user 계정+kind).
  - UI: 공통 `components/Common/PartnerKindBadge.tsx` 추출 → ClientsPage 통일 + TaskDetailDrawer 담당자/컨펌자 picker(PlanQSelect icon 배지) + ProjectTaskList 인라인 picker + 컨펌자 행 is_client 배지. i18n qtask `detail.reviewers.external` ko/en.
  - 검증: 헬스 200·빌드 EXIT0·**E2E 23/23**(게이트 7케이스·is_client 도출·격리 증명[외부 user 본인 배정 업무만+내부 공수 stripped]·후보 누수 차단)·i18n 하드코딩 0·qtask ko/en 610/610.
  - **미배포: D2-a(clients.kind) + D2-b 함께 다음 `/배포`.**

### 완료된 작업 (이전 세션)
- **운영 피드백 #57~#70 전량 처리 + 운영 배포** (v1.42.0~): F6·F7·F8(Q위키 진입점)·#70(내 문의·피드백 master-detail+추가문의)·#69(미수금 배너 문구)·A1/A2(AdminWikiPage)·#61(Cue 전방위 검색·권한격리)·#66(프로젝트 고객 명단 연동버그)·#68(Q talk @멘션 프론트). #60(모바일 push)=기기측 진단(코드無).
- **D 클러스터 설계** — `docs/Q_ORG_DESIGN.md` 4페이즈 로드맵 + D1·D2 상세. 메모리 `project_d_cluster_org_design` 박제.
- **D1 #67 Q조직 — 운영 라이브**: `departments`/`teams` 테이블 + `business_members.department_id/team_id` + `routes/org.js`(CRUD·배정·overview, E2E 11/11) + `OrgPage`(/business/org) + 대시보드 3단 토글(`OrgScopeOverview`) + 사이드바 "조직" + 저장✓ 피드백.
- **D2-a #66 외부파트너 유형 — dev 검증(미배포)**: `clients.kind` ENUM(customer/vendor/freelancer/other) + clients 라우트 + ClientsPage 배지·초대선택·드로어편집 + 메뉴/제목 "고객·파트너". kind E2E 5/5.

### 다음 할 일
1. **미배포 D2-a + D2-b `/배포`** — `clients.kind` ENUM(운영 sync 자동) + D2-b 담당자 게이트/picker. dev 검증 통과(E2E 23/23), 운영 push 대기(명시적 `/배포`).
2. **D2-b 후속(선택):** QTaskPage 전역 리스트 인라인 quick-picker 는 멤버만 노출(프로젝트가 행마다 달라 외부 후보 fetch 복잡) — 외부 배정은 업무 드로어로. 필요 시 확장.
3. **D3:** #65 프로젝트 전략필드(목표·핵심메시지·추진배경·추진방식·실행방안)+종합 타임라인+금주/차주+산출물+업무연계도 / #64 통합보고서 통합뷰·프로젝트뷰 분리. (D1 조직 + D2 외부파트너 위에 얹힘)
4. **D4:** #62 자료 보안등급+외부공유/개인드라이브 제한 / #63 자료 일괄 export+워크스페이스 간 이동.
5. **D1 후속(선택):** 멤버 소속(`MemberAffiliation`) 표시를 업무리스트·채팅·프로필 전반 확산 (현재 OrgPage·대시보드만).
6. **기타 backlog:** AI 기능 전수검사(`docs/AI_FEATURE_AUDIT.md` 22기능), Q위키 스크린샷 캡처 env(`WIKI_CAPTURE_*`), Google OAuth 검증 제출, #60 iOS Capacitor 네이티브(대형 별도 트랙).

### 참고
- `planq-dev-backend`·`planq-qnote` 는 **irene** pm2. 운영 서버 `irene@87.106.78.146`(PROD_BE=/opt/planq/backend, port 3004), 운영 DB 읽기 ssh 경유.
- 배포: dev 검증 통과 후 `./scripts/deploy-planq.sh --auto` (인터랙티브 멈춤 방지). 미커밋이면 sync 스킵 — 커밋 필수.
- D 클러스터 결정 박제(재논의 금지): 평면 부서+선택 팀 · 단일 메뉴 "고객·파트너"+client.kind · 담당자화 B중간. (memory `project_d_cluster_org_design`)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
