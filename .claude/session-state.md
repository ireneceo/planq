# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-19 (2)
**작업 상태:** 완료 — D 클러스터 착수 (D1 Q조직 운영 라이브 + D2-a 유형 dev)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- **운영 피드백 #57~#70 전량 처리 + 운영 배포** (v1.42.0~): F6·F7·F8(Q위키 진입점)·#70(내 문의·피드백 master-detail+추가문의)·#69(미수금 배너 문구)·A1/A2(AdminWikiPage)·#61(Cue 전방위 검색·권한격리)·#66(프로젝트 고객 명단 연동버그)·#68(Q talk @멘션 프론트). #60(모바일 push)=기기측 진단(코드無).
- **D 클러스터 설계** — `docs/Q_ORG_DESIGN.md` 4페이즈 로드맵 + D1·D2 상세. 메모리 `project_d_cluster_org_design` 박제.
- **D1 #67 Q조직 — 운영 라이브**: `departments`/`teams` 테이블 + `business_members.department_id/team_id` + `routes/org.js`(CRUD·배정·overview, E2E 11/11) + `OrgPage`(/business/org) + 대시보드 3단 토글(`OrgScopeOverview`) + 사이드바 "조직" + 저장✓ 피드백.
- **D2-a #66 외부파트너 유형 — dev 검증(미배포)**: `clients.kind` ENUM(customer/vendor/freelancer/other) + clients 라우트 + ClientsPage 배지·초대선택·드로어편집 + 메뉴/제목 "고객·파트너". kind E2E 5/5.

### 다음 할 일
1. **미배포 D2-a `/배포`** — `clients.kind` ENUM 컬럼(운영 sync 시 자동 생성). 그 후 ClientsPage 유형 운영 반영.
2. **D2-b 외부인 담당자 picker (보안민감, B중간):** 업무 assignee/reviewer 선택에 프로젝트 참여 외부인(user 계정 client) 포함. 배정은 그 프로젝트 참여 client 로 제한(임의 내부 업무 배정 차단). `taskListWhere` 가 이미 client assignee/reviewer 접근 허용·`TaskReviewer.is_client` 존재 → 기반 마련됨. taskClientView 로 내부데이터 격리 유지. **외부인 배정→격리 E2E 필수.** TaskDetailDrawer assignee/reviewer picker 확장.
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
