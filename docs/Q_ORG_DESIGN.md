# Q조직 (Workspace Org) — D 클러스터 통합 재설계

> 운영 피드백 #62~#67 (조직·고객·보고서·자료 거버넌스) 통합 설계.
> 작성 2026-06-19. 30년차 솔루션 개발 + 서비스 기획 + 경영컨설턴트 관점.

---

## 0. 포트폴리오 진단 & 의존성 로드맵

6개 영역을 한 번에 설계하면 토대 변경 시 뒤가 무너짐 → **의존성 기반 4페이즈**.

```
[토대]  D1 #67 조직 골격 ──┬──────────────→ D3 #64 보고서(통합뷰/부서뷰)
        D2 #66 외부파트너 ─┘   D3 #65 프로젝트 캔버스 ─┘
[횡단]  D4 #62 보안등급 ───────→ D4 #63 일괄 export/이동
```

| 페이즈 | 묶음 | 의존 | 결정사항 |
|------|------|------|------|
| **D1** | #67 조직(부서/팀)+소속+3단 대시보드 | 없음(토대) | **평면 부서+선택 팀** (다단계 트리 비범위) |
| **D2** | #66 외부파트너(고객/협력사/프리랜서)+담당자화 | 없음(토대) | **단일 메뉴 + client.kind 유형 필드** |
| **D3** | #65 프로젝트 전략필드+타임라인 / #64 통합·프로젝트 보고서뷰 | D1+D2 | — |
| **D4** | #62 보안등급 / #63 export·이동 | 보안등급이 export 게이트 | — |

**Right-sizing (컨설턴트):** PlanQ 초기 운영·소규모 팀 단계 → 엔터프라이즈 다단계 조직트리는 과설계. 평면 부서(+선택 팀)로 시작, 깊은 계층은 수요 시 별도 사이클.

---

## D1 — Q조직 (이번 구현)

### 1. 기능 정의

- **목적:** 워크스페이스를 조직 단위로 운영. 멤버 소속(부서·팀·직책) 일관 표시 + 회사/부서/개인 3단 대시보드 롤업.
- **핵심 사용자:** Owner/Admin(조직 구성), 부서장(부서 현황), Member(본인 소속·부서 조회).
- **유스케이스:** ① 부서 생성(+선택 팀) ② 멤버 부서/팀 배정·직책 ③ 멤버 표시 소속 노출 ④ 대시보드 3단 전환 ⑤ 부서 단위 집계(보고서 뷰 완성은 D3).
- **권한 스코프 (회귀 방지):** 부서 = **표시·집계 단위**, 권한 부여 축 아님. 기존 4-Layer 무변경. 대시보드 접근만: 회사=owner/admin · 부서=owner/admin+부서원 · 개인=본인.
- **비범위:** 다단계 트리 / 부서 기반 데이터 권한·visibility / 통합보고서 뷰 재구성(#64) / 부서 예산·원가.

### 2. API (`routes/org.js`, `/api/org/:businessId/*`)

| METHOD / PATH | 역할 | Body / 응답 |
|---|---|---|
| GET `/departments` | 전원(member↑) | 부서[] + teams[] 중첩 + member_count + lead |
| POST `/departments` | owner/admin | `{name, name_en?, color?, lead_user_id?, sort_order?}` → dept |
| PUT `/departments/:id` | owner/admin | 부분 수정 |
| DELETE `/departments/:id` | owner/admin | 소속 멤버 department_id/team_id=null detach 후 삭제 |
| POST `/teams` | owner/admin | `{department_id, name, name_en?, sort_order?}` |
| PUT `/teams/:id` · DELETE `/teams/:id` | owner/admin | 수정/삭제(멤버 team_id=null) |
| PUT `/members/:userId/assignment` | owner/admin | `{department_id?, team_id?, job_title?}` (team 은 dept 하위 검증) |
| GET `/overview?scope=company\|department\|personal&department_id=` | 스코프 가드 | `{members, activeTasks, doneThisWeek, overdue, byDepartment[], byMember[]}` |

표준: `successResponse/errorResponse`, 멀티테넌트 `business_id` 강제, 실시간 `io.to(business:N).emit('org:updated')`.

### 3. DB

**departments** (신규)
| 컬럼 | 타입 |
|---|---|
| id | PK |
| business_id | FK businesses, idx |
| name | STRING(100) NN |
| name_en | STRING(100) null |
| color | STRING(20) null |
| lead_user_id | FK users null (부서장 — 단일원천) |
| sort_order | INT default 0 |
| timestamps | underscored |

**teams** (신규)
| 컬럼 | 타입 |
|---|---|
| id | PK |
| business_id | FK businesses, idx |
| department_id | FK departments, idx |
| name | STRING(100) NN |
| name_en | STRING(100) null |
| sort_order | INT default 0 |
| timestamps | underscored |

**business_members** (+2 컬럼): `department_id` FK departments null · `team_id` FK teams null.
- `job_title`(기존) = 직책/직급. `organization`(기존) = legacy fallback(부서 미배정 시 표시).
- 부서장 = `department.lead_user_id === member.user_id` (파생, 별도 플래그 X).

associations: Department hasMany Team/BusinessMember; Team belongsTo Department; BusinessMember belongsTo Department/Team; Department belongsTo User(as lead).

### 4. UI

- **조직 관리** `/business/org` (PageShell, owner/admin 가드):
  - 부서 카드 리스트(이름·색 dot·부서장 배지·멤버수·팀 칩) + "부서 추가"(인라인/모달).
  - 부서 카드 내 "팀 추가" + 팀 칩 편집/삭제.
  - **멤버 배정 패널**: 전 멤버 행 — 이름 + 부서 select + 팀 select(부서 종속) + 직책 input, AutoSave(select 300ms / input 2s).
  - 삭제 = ConfirmDialog. 빈 상태 = EmptyState. mock 0.
- **대시보드 3단** (DashboardPage): 상단 세그먼트(회사/내 부서/개인). 회사·부서 = `org/overview` 롤업(멤버 stats·부서별 breakdown 바·금주완료·지연). 개인 = 기존 인박스/일정.
- **소속 표시** 공용 `components/Common/MemberAffiliation.tsx` (부서 dot+이름 · 직책 칩) → 프로필·업무 리스트 재사용.
- i18n `org` 네임스페이스 ko/en. 색상 COLOR_GUIDE 토큰. 반응형(≤768 1열).

### 5~6 구현/테스트 — D1 완료 (2026-06-19 운영 라이브: 골격+관리+대시보드3단+저장✓)

---

## D2 — 외부 파트너 (#66)

### 결정
- 담당자화 깊이: **B 중간** — user 계정 있는 외부 파트너를 task assignee/reviewer 지정 가능 + 인박스 표시, client 격리 유지(배정 업무만 접근). `taskListWhere`가 이미 `assignee_id=userId`·reviewer·project 기준 허용 → 모델 상당 부분 지원. `TaskReviewer.is_client` 기존 존재.
- 유형: `clients.kind` ENUM **customer/vendor(협력사)/freelancer/other**, default customer. 메뉴명 "고객·파트너".

### 증분
- **D2-a (토대):** `clients.kind` 컬럼 + clients 라우트(POST/PUT/invite/list) + ClientsPage 유형 배지·선택·필터 + 메뉴 라벨. 안전·독립.
- **D2-b (담당자 picker, 보안민감) — ✅ 2026-06-20 dev 검증:** 업무 assignee/reviewer 선택에 프로젝트 참여 외부인 포함. 배정은 그 프로젝트 참여 client 로 제한(임의 내부 업무 배정 차단). taskClientView 로 내부데이터 격리 유지.
  - **게이트키퍼 `assertAssignable(targetUserId, businessId, projectId)`** (`middleware/access_scope.js` 단일 출처) — 멤버(AI Cue 포함)=전체 / 외부 파트너(active client+user 계정)=그 프로젝트 참여자만 / 그 외 user_id=차단(타 워크스페이스·유령). project 없는 업무는 외부인 배정 불가. **기존 검증 부재(임의 assignee_id) 취약점 동시 차단.**
  - 적용 3곳: task POST(생성)·PUT(담당자 변경)·`POST /:id/reviewers`. reviewer `is_client` 는 **서버가 도출**(클라 입력 불신뢰).
  - 후보 API: `GET /api/tasks/by-business/:biz/assignable-externals?project_id=` (멤버 전용, 프로젝트 참여 외부인 user 계정만, kind 포함).
  - UI: 공통 `PartnerKindBadge`(ClientsPage 와 통일) — TaskDetailDrawer 담당자/컨펌자 picker + ProjectTaskList 인라인 picker 에 외부 파트너 유형 배지 노출, 컨펌자 행 `is_client` 배지 표시.
  - E2E 23/23(게이트 7케이스·is_client 도출·격리 증명·후보 누수 차단). **미배포(D2-a 와 함께 다음 `/배포`).**

### D2-a DB
`clients.kind` ENUM('customer','vendor','freelancer','other') NOT NULL default 'customer'. 기존 row 자동 customer.

### D2-a API
clients POST/PUT/invite 가 `kind` 수용·검증(화이트리스트), list 응답에 kind 포함. GET list `?kind=` 필터.

### D2-a UI
ClientsPage: 등록/편집 모달에 유형 PlanQSelect + 명단 행에 유형 배지(색) + 상단 유형 필터칩. 사이드바·헤더 "고객" → "고객·파트너"(i18n).


---

## D6 (#63) 데이터 내보내기 — 개인 자료 export / 워크스페이스 백업 (2026-06-22)

**오프보딩 핵심:** "솔루션 떠날 때 내 자료 못 가져갈까" 불안 해소. Phase 1 = export(zip). 워크스페이스 간 직접 이전(transfer) + Q note 메모 포함은 Phase 2.

### 범위 (Phase 1)
- **본인 export(member+):** 본인 올린 L1(나만 보기) 파일 + 본인 작성(created_by) 문서.
- **워크스페이스 백업(owner/admin):** L2/L3/L4 파일(+NULL legacy) + 전 문서. **L1 개인 파일은 백업에서도 제외**(사적 공간 보호 — 관리자도 침범 불가).
- 보안등급: 기밀(confidential)은 워크스페이스 백업에 포함되나 관리자 권한 + AuditLog 기록. 본인 자료는 본인 소유라 게이트 불필요.

### API (`routes/export.js`, mount `/api/export`)
| METHOD PATH | 권한 | 응답 |
|---|---|---|
| GET `/:bizId/me/preview` | member+ | `{files, documents, total_bytes, confidential_count}` |
| POST `/:bizId/me` | member+ | zip 스트리밍 (`files/` + `documents/*.html` + `manifest.json`) |
| GET `/:bizId/workspace/preview` | owner/admin | 위와 동일(기밀 포함 count) |
| POST `/:bizId/workspace` | owner/admin | zip (L1 제외, 기밀 포함) |

- archiver 스트리밍(메모리 안전) — `routes/files.js` bulk-download 패턴 재사용. 파일명 충돌 `(1)(2)` 접미사.
- 문서 → 단독 열람 가능한 HTML(`body_html`, 없으면 `body_json` pre). manifest.json = 항목 목록.
- AuditLog `data.export.self` / `data.export.workspace`. **신규 DB 테이블 없음.**

### UI
- `WorkspaceSettingsPage` 신규 탭 `data-export`(`/business/settings/data-export`). 카드 2개: 내 데이터(전원) + 워크스페이스 백업(isAdmin only).
- `pages/Settings/DataExportSettings.tsx` + `services/export.ts`. blob 다운로드 = files.ts bulkDownloadZip 패턴.
- 사이드바(아코디언+세컨더리) 권한 메뉴 옆 "데이터 내보내기" 링크(member+).
- i18n: `settings.dataExport.*` + `tabs.dataExport` + `layout nav.dataExport` (ko/en).

### 검증
- 백엔드 E2E: preview 200 / zip 200(PK 유효, files·documents·manifest 구조) / cross-tenant 403 / 미인증 401 / **L1 격리(워크스페이스 1143 ≠ 본인 0)**.
- 프론트: build EXIT 0(tsc 0), 청크 번들 4개 export 경로 포함, 서빙 200, i18n 하드코딩 0, health 29/29.

### Phase 2 (미착수)
- 워크스페이스 간 직접 이전(타겟 워크스페이스 재생성·소유권). Q note 메모(/qnote API) 포함. 비동기 대용량 export(job + 다운로드 링크).
