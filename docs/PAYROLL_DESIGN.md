# 직원·계약·급여 관리 — 설계 (Fable 설계 판정 2026-10-15)

> Irene: *"급여처리 기능도 넣어줄 수 있어? 연차나 휴가도 연동하면 좋겠어. 일단 계약부터. … 급여항목이랑 공제항목 정하고 그걸 알아서 추가/수정할 수 있게 하면 나라랑 상관없게 되지 않아? … AI로 기존 틀 제공, 그다음 초안 작성된 거 공유, 그 다음 확정하면 급여명세 나오고 송금하라고 할일 목록 나오고."*
> 그리고 *"사용할지 말지 정해서 사용하게 할 수 있어?"*
> 정찰 `.claude/plans/qmv7o9zh4.md` · 판정 Fable(설계 1회) · 구현 [Opus] · 이 문서는 `docs/ATTENDANCE_LEAVE_DESIGN.md` §1 의 «급여 비범위» 결정을 Irene 승인(2026-10-15)으로 **넓힌다**.

## 판정 요약 (10줄)
1. **PlanQ 는 급여를 «계산» 하지 않고 «정리·대조·확정» 한다.** 법정 공제(4대보험·소득세·지방소득세·정산분)는 **세무사 대장 값이 정답**, PlanQ 가 만든 숫자는 «예상치(대조용)» 라고 화면에 적는다. 프리랜서 3.3% 같은 단순 정률만 PlanQ 가 계산한다.
2. **항목은 워크스페이스가 정의한다**(지급/공제 · 과세/비과세 · 계산방식 · 정산분 · 합계 포함 여부 · 반올림). 나라별 차이는 «기본 틀(프리셋)» 로만 들어온다 — 코드에 나라별 요율을 박지 않는다.
3. **기능 스위치는 워크스페이스 단위 `businesses.modules` JSON 한 칸** — `payroll`(기본 **끔**) · `attendance`(기본 켬, 이미 쓰는 중). 판정 함수 하나(`services/modules.js`)를 서버 가드·메뉴·`/api/auth/me`·알림·크론이 같이 읽는다. 끄면 **404**(없는 기능처럼), 데이터는 남는다.
4. **보는 사람 = 대표 + 지정 급여 담당자**(`permissions.payroll.manager_user_ids`). admin 자동 아님, platform_admin 백도어 없음. 직원은 **자기 명세서만**.
5. **표 8개**: 급여 대상자 · 계약 · 급여 항목 · 계약 금액줄 · 급여 회차 · 회차 사람줄 · 회차 금액칸 · 상태 이력. 주민번호 컬럼은 **없다**. 계좌는 `bank_account_enc`(전역 toJSON 이 지운다).
6. **상태 전이 한 문** `services/payrollTransition.js`: 초안 → 대조 → **확정(잠금)** → 지급완료. 확정 뒤 정정은 «정정 회차(seq 2+)» 로만. 명세서·송금 할 일·알림·감사·실시간은 확정 함수 안에서.
7. **월급 정본 충돌 = (a)안**: 유효 계약이 있으면 `memberCost` 가 계약을 읽고(`source:'contract'`), `BusinessMember.monthly_salary` 는 계약 없는 멤버용으로만 남는다. 파생값을 컬럼에 쓰지 않는다.
8. **대장 가져오기**: 엑셀/CSV 는 기계가 읽고(머리행 매칭), PDF 만 AI 가 표로 옮긴다. 사람·항목 매칭은 결정적 규칙(사번 → 이름 → 사람이 고름). AI 는 «틀 제안·추출» 만, 확정은 사람. LLM 으로 보내기 전 주민번호 모양은 가린다.
9. **요금제 Pro**. 체험 중 사용 가능. Pro 아래로 내려가면 **읽기는 남고 쓰기만 막힌다**(명세서를 못 보게 되면 직원 피해).
10. 단계 P0(계약서 템플릿 3종) → P1(스위치·대상자·계약·담당자·memberCost) → P2(항목·프리셋·이달 초안) → P3(대장 대조) → P4(확정·명세서·송금 할 일) → P5(연차수당·퇴직 정산·수익성 연결). 각 단계가 혼자 쓸모 있다.

---

## 1. 범위·비범위 — 책임선

| PlanQ 가 한다 | PlanQ 가 하지 않는다 (세무사·노무사 몫) |
|---|---|
| 계약 기록·이력(사람 × 기간 × 금액줄), 계약서 문서·서명 | 근로계약서 문구의 법적 검수(템플릿은 초안 — 노무사 검수 권고) |
| 이달 급여 **초안**: 계약 고정액 + 정률 항목 + 무급휴가 일할 | **법정 공제액 산출**(4대보험·간이세액표 소득세·정산분·두루누리·농특세) — 대장 값을 들여온다 |
| 세무사 대장 가져오기 → 칸별 차이 표시 → 채택 | 4대보험 신고·원천세 신고·연말정산 |
| 확정·잠금, 명세서, 송금 할 일, 월별 급여대장 목록, 이력·감사 | 은행 송금 자체(할 일만 만든다), 퇴직금 계산(P5 «표시» 까지) |
| 프리랜서 3.3%(소득세 3% + 지방 0.3%) 정률 계산 | 연차 **법정** 자동산정(근태 설계 그대로: 관리자가 부여) |

**화면 문구(책임선)** — 급여 회차 화면 상단 띠와 명세서 아래에 고정:
- ko: «법정 공제(4대보험·소득세)는 세무사 급여대장 값이 기준입니다. PlanQ 가 미리 채운 금액은 대조용 예상치입니다.»
- en: "Statutory deductions (social insurance, income tax) follow your tax accountant's payroll register. Amounts PlanQ pre-fills are estimates for comparison."
- 초안 칸에 PlanQ 가 채운 예상치는 회색 «예상» 뱃지, 대장에서 온 값은 «대장» 뱃지, 사람이 고친 값은 «입력» 뱃지. 뱃지 없는 숫자를 만들지 않는다(가짜 숫자가 돈 화면에서 가장 위험 — memberCost 결정과 같은 선).

---

## 2. 기능 사용 스위치 — 워크스페이스 «모듈»

지금 PlanQ 에는 워크스페이스 단위로 기능을 켜고 끄는 장치가 없다(`guest_links_enabled` 가 유일한 선례 — 컬럼 하나짜리 kill switch). 급여는 «안 쓰는 회사가 더 많은» 기능이고 근태도 같은 성격이라, **일반 장치 하나**를 만들고 둘을 거기 둔다.

### 2.1 저장·판정
- `businesses.modules JSON NULL` — 모양 `{ "payroll": true|false, "attendance": true|false }`. 키가 없으면 **모듈 기본값**: `payroll:false`, `attendance:true`(이미 쓰는 워크스페이스가 하루아침에 메뉴를 잃지 않게).
- 판정은 **`services/modules.js` 하나**: `moduleOn(biz, key)` · `MODULE_DEFAULTS` · `assertModule`. 다른 곳에서 `biz.modules.payroll` 을 직접 읽지 않는다(가드 §11).
- 켜고 끄기: **owner 만** `PUT /api/businesses/:id/modules {payroll:true}`. 감사 `business.module_toggle`(old/new). admin 도 못 켠다 — 급여는 «관리» 가 아니라 «대표의 결정» 이다(Irene: 보는 사람도 admin 자동 아님).
- 켤 때 요금제 검사 `plan.can('use_payroll')`(Pro/enterprise 또는 체험 중). 아니면 409 `plan_required` + 요금제 화면 안내. `attendance` 는 요금제 무관.

### 2.2 끈 상태의 동작 (어디에도 안 나온다)
| 표면 | 끄면 |
|---|---|
| 서버 API | `/api/payroll/*` 전부 `requireModule('payroll')` → **404** `module_off`(403 이 아니다 — 있는지도 말하지 않는다). `/api/attendance/*`·`/api/leave/*` 도 같은 미들웨어(기존 라우트에 한 줄). platform_admin 도 404. |
| 메뉴·주소 | `navMenus.ts` 항목에 `moduleKey` 를 달고 `visibleNavMenus` 가 `/api/auth/me` 의 `modules` 로 뺀다. 라우트는 `<ModuleGate module="payroll">` 이 감싸 NotFound 를 그린다(`DetailFallback` 처럼 «켜 달라» 안내가 아니라 **없는 화면**). 탭 kind 표(`PREFIX_KIND`)·`EXTRA_PAGE_LABELS` 에는 등록하되 가드가 먼저 막는다. |
| 사이드바 위젯 | 출퇴근 미니 위젯·모바일 출퇴근 카드는 `attendance` 꺼지면 안 그린다. Focus 연동 A(자동 출근)도 `moduleOn` 을 먼저 본다. |
| 알림 | 새 알림이 생기지 않는다(전이 함수가 못 돈다). 이미 쌓인 `payroll`·`leave` 알림은 `notificationScope` 가 **빼고** 센다(켜면 돌아온다). |
| 크론 | 미퇴근 자동마감·급여일 전 알림(P4)은 워크스페이스마다 `moduleOn` 을 보고 건너뛴다. |
| AI | 급여 도구는 **애초에 없다**(§7.4). 통합검색·`get_context`·`search_all`·Cue 문맥에 급여·계약·계좌는 한 번도 들어가지 않는다 — 모듈과 무관하게 0. |
| 가용시간 | `attendance` 를 끄면 `memberCapacity.getLeaveDaysInRange` 가 0 을 돌려 휴가 차감이 멈춘다(기록은 남는다). 급여 초안의 무급휴가 일할도 자동 0 → 직접 입력 칸만 남는다. |
| 멤버 메뉴 권한 | `business_member_permissions` 에 급여 키를 **만들지 않는다**(기본 write 인 체계와 반대라 어긋난다 — 근태 설계 §2.5 와 같은 결론). |

### 2.3 껐다 켤 때
- **지우지 않는다.** 표·행·파일 그대로. 끄는 순간 진행 중 회차(초안·대조)는 그대로 멈추고, 켜면 그 상태에서 이어진다.
- 끄기 확인창 문구: «급여 메뉴·명세서·계약 이력이 모두 숨겨집니다. 직원도 자기 명세서를 볼 수 없습니다. 기록은 지워지지 않으며 다시 켜면 그대로 보입니다.» (ConfirmDialog, 성공 토스트 없음).
- 켜기 첫 화면은 온보딩 3칸: ①항목 틀 만들기 ②급여 대상자 넣기 ③급여 담당자 지정(선택).

### 2.4 화면 자리
`/business/settings`(WorkspaceSettingsPage) 에 **«기능 사용» 섹션** — 토글 2개(급여·근태), `AutoSaveField type="toggle"`, owner 만 활성. 급여 토글 옆에 요금제 뱃지(Pro). 급여 담당자 지정은 `/business/settings/permissions` 의 새 섹션 `PayrollManagersSection`(모듈 켜졌을 때만 보임) — `DefaultBillingOwnerSection` 과 같은 껍데기.

---

## 3. 데이터 모델

전부 `business_id` 격리 · `underscored` · timestamps. 금액은 `DECIMAL(14,2)`, 통화는 `CHAR(3)`. **주민번호·여권번호 컬럼 없음**(세무사가 갖고 있다 — PlanQ 가 들고 있을 이유가 없다).

### 3.1 `payroll_people` — 급여 대상자 (멤버일 수도, 아닐 수도)
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id · business_id | | |
| user_id | INT NULL | 계정이 있으면 연결(멤버 아니어도 됨). **UNIQUE(business_id, user_id)** — NULL 은 여럿 허용 |
| display_name | VARCHAR(100) NOT NULL | 대장과 맞추는 이름. 계정이 있어도 따로 둔다(표시명과 급여대장 이름이 다를 수 있다) |
| employee_no | VARCHAR(30) NULL | 사번 — 대장 매칭 1순위. UNIQUE(business_id, employee_no) |
| email | VARCHAR(255) NULL | 계정 없는 사람의 명세서 발송처(P5) |
| income_kind | ENUM('employment','business','other') | 근로소득 / 사업소득(프리랜서) / 기타소득 |
| hired_on · left_on | DATEONLY NULL | 입사·퇴사 |
| job_title | VARCHAR(100) NULL · department_id INT NULL | 대장의 직위·부서(표시용, `departments` 참조) |
| bank_name | VARCHAR(60) NULL | 은행명(비밀 아님) |
| bank_account_enc | TEXT NULL | `encryption.encrypt(JSON{number, holder})` — `_enc` 접미사라 전역 toJSON 이 지운다. 보유 여부는 응답에 `has_bank_account` 로만 |
| status | ENUM('active','left') | 퇴사 = left + left_on. **삭제 없음**(회차 줄이 가리킨다). 줄이 0건이면 하드 삭제 허용 |
| note | VARCHAR(500) NULL | |

인덱스 (business_id, status) · (business_id, display_name).

### 3.2 `employment_contracts` — 사람 × 기간
| 컬럼 | 설명 |
|---|---|
| id · business_id · person_id FK | |
| kind | ENUM('regular','fixed_term','freelance') 정규 / 계약직 / 프리랜서 |
| start_date NOT NULL · end_date NULL | 프리랜서도 기간이 있다(없으면 NULL = 계속) |
| weekly_work_days TINYINT · daily_work_hours DECIMAL(4,1) | 근무조건(계약서 변수이자 일할 분모). 기본값은 `BusinessMember` 의 같은 칸 |
| currency CHAR(3) | 기본 `businesses.default_currency` |
| pay_day TINYINT NULL | 매월 지급일(1~31, 31=말일) — 회차 `pay_date` 기본값 |
| post_id BIGINT NULL | 서명한 계약서 문서(`posts`). 문서가 지워져도 계약은 남는다(FK 아님, 표시만) |
| signed_at DATETIME NULL | 양쪽 서명이 끝난 시각(§5.5 훅) |
| status | ENUM('draft','active','ended','superseded') |
| note · created_by | |

규칙: **한 사람에게 같은 날 유효한(active) 계약은 하나**. 새 계약을 active 로 만들면 겹치는 옛 계약은 자동 `superseded`(end_date = 새 시작 전날). DB 제약이 아니라 `payrollContracts.activate` 한 함수가 지킨다. 인덱스 (business_id, person_id, start_date) · (business_id, status).

### 3.3 `pay_items` — 워크스페이스 항목 정의 (나라와 무관한 틀)
| 컬럼 | 설명 |
|---|---|
| id · business_id | |
| code VARCHAR(40) | 안정 키(`base`, `meal`, `np` …). UNIQUE(business_id, code). 프리셋이 주고, 사람이 만든 것은 `custom_<n>` |
| name VARCHAR(100) · name_en VARCHAR(100) NULL | 표시명 |
| side | ENUM('earning','deduction') 지급 / 공제 |
| taxable BOOLEAN | 지급만 의미(과세/비과세). 공제는 무시 |
| calc | ENUM('fixed','rate','manual','external','unpaid_leave') — 고정(계약 금액줄) / 정률 / 직접 입력 / **외부(대장 값이 정답)** / 무급휴가 일할(§6.4) |
| rate DECIMAL(8,5) NULL · rate_base ENUM('taxable_total','gross_total','item') NULL · base_item_id INT NULL | 정률일 때 «무엇의 몇 %». `item` 이면 base_item_id 의 **최종 금액** |
| sign | ENUM('plus','minus') — 같은 편 합계에 더하나 빼나. 두루누리(국민연금 지원)는 공제편 `minus` |
| in_total BOOLEAN | 합계에 넣나. «미제출비과세» 같은 참고칸은 false |
| is_settlement BOOLEAN | 정산분(건보·장기요양·고용·국민연금 정산) — 항상 `external` |
| is_statutory BOOLEAN | 법정 — 화면이 «대장 기준» 뱃지를 붙이고, 대조 때 **대장 값 채택이 기본** |
| rounding ENUM('round','floor','ceil') · rounding_unit INT | 1 / 10 / 100 (원 단위 절사 등) |
| aliases JSON | 대장 머리글 별칭 `["건강보험료","건강보험"]` — 가져오기 매칭 |
| sort_order · is_active | 쓰인 항목은 지우지 못하고 `is_active=false` |
| preset_source VARCHAR(20) NULL | 어느 프리셋에서 왔나(`KR-2026` 처럼 표시만) |

### 3.4 `contract_pay_lines` — 계약이 정한 금액
`id · business_id · contract_id · pay_item_id · amount DECIMAL(14,2)` · UNIQUE(contract_id, pay_item_id). `calc='fixed'` 인 항목만 여기 온다(기본급·식대·수당·프리랜서 보수).

### 3.5 `payroll_runs` — 워크스페이스 × 귀속월 (× 정정 차수)
| 컬럼 | 설명 |
|---|---|
| id · business_id | |
| period_ym CHAR(7) · seq TINYINT DEFAULT 1 | `2026-09`. **UNIQUE(business_id, period_ym, seq)**. seq 1 = 정기, 2+ = 정정 회차 |
| kind | ENUM('regular','adjustment') |
| pay_date DATEONLY | 지급일 |
| status | ENUM('draft','reconciling','confirmed','paid') |
| statement_file_id INT NULL · statement_imported_at · statement_extract_json JSON NULL | 세무사 대장 파일(`files`, 업로드 라우트로 들어온 것) + 추출 결과(행·열·매칭·미매칭) |
| headcount · gross_total · deduction_total · net_total | 합계 캐시 — 전이 함수가 다시 센다(화면은 캐시만 읽는다). 통화가 섞이면 `totals_by_currency JSON` 에 통화별로 |
| confirmed_by · confirmed_at · paid_by · paid_at | |
| transfer_task_mode | ENUM('per_person','single') 송금 할 일을 사람별로 / 한 건으로 |
| note · created_by | |

### 3.6 `payroll_entries` — 회차 × 사람
`id · business_id · run_id · person_id · contract_id`(그 달 유효 계약, NULL 허용 — 계약 없이 직접 넣은 사람) · `display_name · employee_no · job_title · department_name`(**확정 때 동결** — 이후 사람 정보가 바뀌어도 대장은 그대로) · `unpaid_leave_days DECIMAL(4,1)` · `gross_total · taxable_total · nontaxable_total · deduction_total · net_total`(캐시) · `currency` · `transfer_task_id INT NULL` · `payslip_viewed_at DATETIME NULL` · `note`. UNIQUE(run_id, person_id).

### 3.7 `payroll_entry_lines` — 회차 × 사람 × 항목 (대조의 단위)
`id · business_id · entry_id · pay_item_id · draft_amount NULL · statement_amount NULL · final_amount NULL · final_source ENUM('draft','statement','manual') NULL · note`. UNIQUE(entry_id, pay_item_id).
- `draft_amount` = PlanQ 예상치(external 항목은 NULL), `statement_amount` = 대장에서 읽은 값, `final_amount` = 확정에 쓰는 값. **확정은 `final_amount` 가 NULL 인 `in_total` 줄이 하나라도 있으면 409 `line_unresolved`**(빈칸을 0 으로 간주하지 않는다).

### 3.8 `payroll_status_history`
`run_id · business_id · from_status · to_status · changed_by · note` — `invoice_status_history` 와 같은 모양. 정정 회차 생성도 여기 남긴다(from NULL → draft, note 에 원 회차 id).

### 3.9 기존 표 변경
- `businesses.modules JSON NULL`(§2) · `businesses.permissions.payroll` 키(JSON 안, 컬럼 변경 없음).
- `notifications.event_kind` · `notification_prefs.event_kind` ENUM 끝에 **`'payroll'` append**(두 표 순서가 다르므로 각각 append — `lib/enumAppend`).
- `BusinessMember` 무변경(월급 컬럼은 남긴다 — §8).
- `document_templates` 시드 3건(P0) — ENUM 변경 없음(kind `contract` 재사용).

### 3.10 운영 마이그레이션
`dev-backend/scripts/migrate-payroll.js` — 멱등: `CREATE TABLE IF NOT EXISTS` ×8 · `businesses.modules` 컬럼 `ADD COLUMN IF NOT EXISTS`(없으면 information_schema 로 검사) · ENUM append 2건. **배포 슬롯 등록**(`scripts/deploy-planq.sh`, PM2 reload 전 — 모델이 SELECT 하므로 먼저). 백필 없음(전부 새 표). 롤백 = 코드 revert(새 표·새 값 잔존은 무해). 시드 `seed-document-templates.js` 는 지금 배포 슬롯에 **없다** — P0 에서 같은 슬롯에 넣는다(kind+is_system+name upsert 라 매 배포 안전).
`sync-database.js` 가 모델 밖 컬럼을 DROP 하는 함정(memory) — 새 모델 파일은 마이그레이션과 **같은 커밋**에 둔다.

---

## 4. 권한 — 술어 한 곳 `services/payrollAccess.js`

| 함수 | 뜻 |
|---|---|
| `payrollManagerIds(biz)` | `permissions.payroll.manager_user_ids` ∩ **현재 멤버(owner/admin/member, removed_at NULL)**. 내보낸 멤버는 목록에 남아 있어도 자동으로 빠진다 |
| `canManagePayroll(scope, biz)` | `scope.isOwner` ∨ `userId ∈ payrollManagerIds`. **admin 아님 · platform_admin 아님 · client/ai 아님.** 보기·쓰기·확정 모두 이 하나(확정은 추가로 `plan.can('use_payroll')` 쓰기 자격) |
| `canReadOwnPayslip(userId, entry)` | `entry.run.status ∈ {confirmed, paid}` ∧ `entry.person.user_id === userId` |
| `canReadOwnContracts(userId, person)` | `person.user_id === userId` — 본인 계약 이력 열람(금액 포함) |
| `requireModule('payroll')` | §2 — 미들웨어. 모든 `/api/payroll/*` 의 첫 줄 |
| `requirePayrollWrite` | `canManagePayroll` ∧ `plan.can('use_payroll')`. 읽기 라우트는 요금제를 보지 않는다(§2 판정 9) |

- **미들웨어 체인 표준**: `authenticateToken → checkBusinessAccess → requireModule('payroll') → (읽기) assertPayrollReader | (쓰기) assertPayrollWriter`. 엔티티 id 라우트(`/entries/:id/payslip`)는 항목의 `business_id` 로 워크스페이스를 정하고 같은 술어를 다시 본다(워크스페이스 단일 정본 계약 4).
- **멀티테넌트**: 모든 조회 `WHERE business_id = ?` + include 에도. `person_id`·`contract_id`·`pay_item_id` 를 본문으로 받으면 **같은 business_id 인지 다시 찾는다**(남의 항목 id 를 섞어 보내는 경로가 바로 누수다).
- **응답 비밀값 0**: `bank_account_enc`(전역 toJSON) · 응답엔 `has_bank_account`·`bank_name` 만. 계좌번호를 보여주는 문은 **하나** — `GET /api/payroll/:biz/people/:id/bank-account`(관리자, 열람 감사 `payroll.bank_account_view`). 송금 할 일 본문·알림·실시간 신호·검색·AI·명세서 PDF 에 계좌번호를 싣지 않는다(명세서에는 «지급 계좌 ****1234» 끝 4자리만).
- **멤버 목록 라우트(`GET /:biz/members`)에 급여를 얹지 않는다**(단가 라우트 분리 결정 그대로).
- 감사: 사람·계약·항목 CUD, 회차 전이, 대장 가져오기, 계좌 열람, 명세서 열람(본인), 모듈 토글 — AuditLog old/new JSON(금액 포함, `_enc` 는 auditService 가 가린다).

---

## 5. 상태 전이 — `services/payrollTransition.js` 한 문

```
(없음) ─ createRun ───────→ draft        관리자. period_ym·pay_date. 같은 달 seq 1 이 있으면 409(정정은 createAdjustment)
draft  ─ buildDraft ──────→ draft        초안 다시 만들기(사람 추가·계약 갱신 뒤). 사람이 고친 final_source='manual' 줄은 보존
draft  ─ importStatement ─→ reconciling  대장 파일 → 추출 → statement_amount 채움(§7)
reconciling ─ importStatement → reconciling  다시 올리면 덮어쓴다(이전 추출은 감사에 old 로)
draft|reconciling ─ confirm → confirmed   잠금. §5.2 부수효과
confirmed ─ markPaid ─────→ paid         관리자(송금 끝났다고 사람이 누른다). 할 일 완료가 자동으로 바꾸지 않는다
confirmed|paid ─ createAdjustment → (새 run seq+1, draft)   정정 — 원 회차는 불변
draft  ─ deleteRun ───────→ (삭제)       줄까지 하드 삭제. reconciling 이상은 삭제 불가
```

### 5.1 잠금
`confirmed` 이후 회차·사람줄·금액칸·항목 정의 중 **그 회차가 쓰는 것은 수정 거부**(409 `run_locked`). 항목 이름을 바꿔도 지난 회차는 **확정 시점 이름**으로 보인다 — `payroll_entry_lines` 에 `item_name_snapshot VARCHAR(100)` 을 확정 때 채운다(3.7 에 추가). 사람 표시 정보도 3.6 처럼 동결.

### 5.2 확정(confirm) 안에서 — 한 트랜잭션 + 커밋 후 부수효과
1. 검사: 모든 `in_total` 줄 `final_amount` 있음 · 각 사람 `net_total ≥ 0`(음수면 409 `negative_net`, 정정 회차는 허용) · 쓰기 자격.
2. 합계 재계산(§6) → 캐시 저장 · 표시 정보 동결 · `status=confirmed` · 이력 행.
3. **(커밋 후)** 송금 할 일 — `task_actions.createTask`(행동 계층 한 문) · 제목 `[급여] 2026-09 홍길동 송금` · 설명에 **차인지급액·지급일·은행명만**(계좌번호 없음, 급여 화면 링크) · 담당자 = 확정한 사람(또는 확정창에서 고른 급여 담당자) · 마감 = pay_date · `vlevel 'L1'`(나만 보기 — 담당자는 이름이 박혀 본다) · `security_level 'confidential'`. `transfer_task_mode='single'` 이면 한 건에 사람별 줄. 생성된 id 를 `entries.transfer_task_id` 에. **이미 있으면 다시 만들지 않는다**(재시도 멱등).
4. 명세서: 파일을 만들지 않는다 — 동결된 줄에서 **그때그때 그린다**(§9 `/me/payslips`). 계정 있는 사람에게 알림 `event_kind:'payroll'` «2026년 9월 급여명세서가 준비됐습니다» 링크 `/me/payslips?entry=:id`, `preview_policy:'internal_only'`, `skipChannels:['email']`(금액이 메일로 나가지 않게 — 푸시·앱만). 계정 없는 사람은 P5 발송 전까지 관리자가 PDF 를 내려받아 전한다.
5. 급여 담당자 전원 알림(확정됨) · 감사 `payroll.run_confirm` · 실시간 `payroll:updated {run_id}` 를 **owner+담당자 개인 방(`user:N`)** 에만(business 방 금지 — 존재 자체가 급여 정보다) · 명세서 대상자 개인 방에 `payslip:new {entry_id}`.
6. 3~5 중 하나가 실패해도 확정은 유지(돈 상태가 정본) — 실패는 `[payroll] confirm side-effect failed` 로그 + 회차 화면 «할 일 다시 만들기» 버튼(멱등).

### 5.3 지급완료(markPaid)
`paid_by/at` · 이력 · 담당자 알림 없음(본인이 눌렀다) · 그 회차 송금 할 일 중 미완료가 있으면 확인창 «아직 완료 안 된 송금 할 일 n건 — 그래도 지급완료?» (강제 완료하지 않는다).

### 5.4 정정 회차(adjustment)
같은 달 seq 2+. 사람·항목을 골라 **차액만**(음수 허용) 넣는다. 확정 부수효과 동일(할 일·명세서 «정정분»). 월별 목록은 seq 를 접어 한 줄 + «정정 1건» 뱃지. 원 회차는 영영 불변 — 세무사 수정 대장도 같은 방식.

### 5.5 계약 전이 — `services/payrollContracts.js`
`draft → active`(activate: 겹침 정리) · `active → ended`(end_date 확정) · `superseded` 는 자동. **서명 완료 훅**: `signatures.js`·`signature_internal.js` 가 `projectStageEngine.onSignatureChanged(sr.id)` 를 부르는 자리에 `payrollContracts.onSignatureChanged(sr.id)` 를 **같은 줄에** 더한다(둘 다 catch 후 무시, 빈 `maybeUpdateEntityStatus` 는 손대지 않는다). 그 post_id 를 가리키는 계약이 있고 그 문서의 서명 요청이 **모두 signed** 이면 `signed_at` 을 찍는다. 서명은 계약 활성의 **조건이 아니다**(종이 서명·구두 계약도 급여는 나간다) — 미서명 계약은 뱃지 «서명 전».

---

## 6. 계산 정의 — `services/payrollCalc.js` 순수 함수 (DB 안 봄, 검산 가능)

입력: 항목 정의 목록 + 사람 한 명의 줄(`amount` 결정된 것) → 출력: 각 줄 금액 + 합계. 같은 함수를 초안 생성·대조 화면·확정·명세서가 쓴다(공식 한 벌).

### 6.1 순서
1. **고정(fixed)**: 계약 금액줄 그대로.
2. **무급휴가(unpaid_leave)**: §6.4.
3. **정률(rate)**: `rate_base` 순으로 — `item` 기준은 그 항목이 먼저 계산돼 있어야 한다(순환이면 409 `rate_cycle`, 항목 저장 때 막는다). `taxable_total`·`gross_total` 기준은 1·2 가 끝난 **지급편** 합으로 센다(공제는 지급 합에 영향 없음).
4. **외부(external)·직접(manual)**: 값이 있어야만 센다. 초안에서는 NULL(«—» 로 보임, 0 이 아니다).
5. 각 줄 **반올림**: `rounding`·`rounding_unit`(`floor` + 10 = 10원 미만 절사).
6. 합계: `taxable_total = Σ earning∧taxable∧in_total` · `nontaxable_total = Σ earning∧¬taxable∧in_total` · `gross_total = taxable + nontaxable` · `deduction_total = Σ deduction∧in_total × (sign plus:+1 / minus:−1)` · `net_total = gross_total − deduction_total`. **합계는 반올림된 줄의 합**(합을 따로 반올림하지 않는다 — 대장의 합계행과 같은 방식).

### 6.2 검산 사례 A — 정규직 (가상 인물 «[확인용] 김가상», KRW)
항목 프리셋(§7.1 KR) · 계약: 기본급 3,000,000 · 식대(비과세) 200,000. 무급휴가 0.

| 줄 | 종류 | 초안(예상) | 대장 | 확정 |
|---|---|---:|---:|---:|
| 기본급 | fixed · 과세 | 3,000,000 | 3,000,000 | 3,000,000 |
| 식대 | fixed · 비과세 | 200,000 | 200,000 | 200,000 |
| **지급합계** | | **3,200,000** | 3,200,000 | **3,200,000** |
| 국민연금 | external · 법정 | — | 135,000 | 135,000(대장) |
| 건강보험 | external · 법정 | — | 106,350 | 106,350(대장) |
| 장기요양 | external · 법정 | — | 13,770 | 13,770(대장) |
| 고용보험 | external · 법정 | — | 27,000 | 27,000(대장) |
| 소득세 | external · 법정 | — | 56,120 | 56,120(대장) |
| 지방소득세 | external · 법정 | — | 5,610 | 5,610(대장) |
| 건강보험 정산분 | external · 정산 | — | 12,340 | 12,340(대장) |
| 두루누리 | external · 법정 · **minus** | — | 0 | 0 |
| **공제합계** | | — | 356,190 | **356,190** |
| **차인지급액** | | — | | **2,843,810** |

- 공제합계 = 135,000+106,350+13,770+27,000+56,120+5,610+12,340 − 0 = 356,190 ✔ · 차인 = 3,200,000 − 356,190 = 2,843,810 ✔
- 대장 숫자는 **예시**다(요율·세액표는 매년 바뀐다). PlanQ 는 이 줄들을 계산하지 않으므로 초안 칸이 «—» 인 것이 정상이고, 확정은 대장 값을 채택해야 통과한다(§3.7).
- 선택: 사용자가 «예상치도 보고 싶다» 면 법정 항목을 `rate` 로 바꿔 요율을 직접 넣을 수 있다(`is_statutory` 는 그대로라 대조 때 대장 채택이 기본). 요율을 코드가 제공하지 않는다.

### 6.3 검산 사례 B — 프리랜서 («[확인용] 박가상», 보수 1,234,567)
프리셋 `KR-freelance`: 보수(fixed, 과세) · 소득세 `rate 0.03 · rate_base gross_total · floor 10` · 지방소득세 `rate 0.10 · rate_base item(소득세) · floor 10`.
- 소득세 = 1,234,567 × 0.03 = 37,037.01 → 10원 미만 절사 → **37,030**
- 지방소득세 = 37,030 × 0.10 = 3,703 → **3,700**
- 공제합계 40,730 · 차인지급액 **1,193,837** ✔ (2,000,000 이면 60,000 · 6,000 · 1,934,000)
- 경계: 보수 300 → 소득세 9 → floor 10 → **0**, 지방 0, 차인 300. 보수 0 → 전부 0(409 아님, 정정 회차에서 쓰인다).

### 6.4 무급휴가 일할 (항목 `unpaid_leave`, 공제편 plus)
- 분모 = **월 평균 소정근로일수** `weekly_work_days × 52 ÷ 12`(계약의 근무조건; `memberCost.WEEKS_PER_MONTH` 와 같은 상수 — 공식 두 벌 금지). 주 5일 → 21.6667.
- 분자 = 그 달에 **승인된 무급 휴가**(`leave_requests.leave_type='unpaid' ∧ approved`)의 `days_charged` 합(기간이 달을 걸치면 날짜 수로 일할 — `getLeaveDaysInRange` 그대로). `attendance` 모듈이 꺼져 있거나 사람에 user_id 가 없으면 0 + 직접 입력 칸.
- 금액 = `round(기본급(code 'base') × 무급일 ÷ 분모)` — 원 단위 반올림(항목 rounding 설정 따름).
- 사례: 기본급 3,000,000 · 주 5일 · 무급 2일 → 3,000,000 × 2 ÷ 21.6667 = 276,923.07… → **276,923**. 지급합계 3,200,000 그대로, 공제합계 +276,923. 반차(0.5일) → 69,231. 분모 0(근무일 0) → 계산 안 함 + 경고(가짜 0 금지).
- 왜 «기본급 차감» 이 아니라 «공제 줄» 인가: 대장의 기본급과 숫자를 그대로 맞춰 대조할 수 있고(세무사도 보통 공제로 적는다), 무엇이 빠졌는지 명세서에 보인다.

### 6.5 정산분·지원금
`is_settlement` 항목은 `external` 고정(저장 때 강제). 두루누리처럼 «공제를 줄이는» 항목은 `sign='minus'` — 대장에는 양수로 적혀 있으므로 **양수로 저장하고 부호는 정의가 정한다**(가져오기 때 부호를 바꾸지 않는다).

### 6.6 통화·소수
KRW/JPY 는 `rounding_unit` 기본 1(소수 없음), USD/EUR 는 소수 2자리 `round`. 통화는 계약이 정하고 회차 합계는 통화별로 따로(섞이면 `totals_by_currency`). 환산하지 않는다.

---

## 7. 세무사 대장 가져오기 · AI 의 자리

### 7.1 기본 항목 틀(프리셋) — «AI 로 기존 틀 제공»
- **정적 프리셋이 먼저**: `config/payrollPresets.js` 에 `KR-employee`·`KR-freelance`·`generic`(기본급·수당·소득세·기타공제 4줄). 나라 힌트는 `businesses.holiday_country`(없으면 화면에서 고른다). 프리셋은 **항목 이름·종류·계산방식·별칭·반올림만** 담고 **요율 숫자는 담지 않는다**(법정은 external). 프리랜서 3%·0.3% 와 두루누리 minus 같은 «구조» 만.
- **AI 제안은 프리셋이 없는 나라·형태에만**: `llm.callLLM({purpose:'payroll_preset', json:true})` 에 «나라·고용형태·대장 머리글(있으면)» 만 보낸다 → 항목 목록 초안(이름·side·taxable·calc·sign·aliases) → 사람이 고쳐 저장. 요율이 와도 **버린다**(external 로 강제). `plan.can('use_cue')` + `costGuard`. LLM 이 꺼져 있으면 `generic` 프리셋.

### 7.2 대장 파일 → 표
- 받는 형식: `.xlsx/.xls/.csv`(기계) · `.pdf`(AI) · 이미지는 받지 않는다(P5 검토).
- **엑셀/CSV = 기계가 읽는다** — `officeText.js` 안의 자체 xlsx 파서(`xlsxSheetRows`·`xlsxSharedStrings`, 지금은 내부 함수 → `extractXlsxRows(buf)` 로 내보낸다. SheetJS 는 보안 권고 때문에 **일부러 안 쓴다**, 새 의존성 금지)로 시트 셀을 행·열 그대로 → 머리행 찾기(«성명»·«기본급»·«차인지급액» 중 둘 이상 있는 행) → 열 = 항목, 행 = 사람. CSV 는 쉼표·따옴표만 다루는 작은 파서. **AI 를 거치지 않는다**(결정적·비용 0·개인정보 외부 전송 0).
- **PDF = AI 가 표로 옮긴다** — `fileText.extractFileText` 텍스트 → **주민번호 모양(`\d{6}-\d{7}`)·계좌번호 모양(`\d{10,16}`)을 `***` 로 가린 뒤** `callLLM({purpose:'payroll_extract', json:true})` → `{rows:[{name, employee_no, cells:{머리글: 숫자}}], pay_date, period}`. 숫자는 천단위 구분자 제거·괄호 음수 처리. `use_cue` 1회 계량.
- 결과는 `payroll_runs.statement_extract_json` 에 그대로 보관(무엇을 읽었는지 남는다). 파일 자체는 `files` 로 올라가되 **`vlevel 'L1'`·`security_level 'confidential'`**(Q file 목록에서 급여 담당자 외엔 안 보인다).

### 7.3 매칭 — 결정적 규칙, 사람이 마지막
- **사람**: ① `employee_no` 정확 일치 → ② `display_name` NFC·공백 제거 일치(동명이인이면 미정) → ③ 사람이 고른다(셀렉트). 대장에만 있는 사람 → «대상자 만들기» 한 번에(입사일·직위·부서 채움). PlanQ 에만 있는 사람 → «이달 제외» 또는 «대장에 없음» 뱃지(확정 때 경고, 막지 않음 — 중도 입사자 등).
- **항목**: 머리글 ↔ `pay_items.name`·`name_en`·`aliases` 일치(NFC·공백·«료» 꼬리 무시). 못 맞춘 열 → «항목 만들기(external)» / «무시». 사람이 맞춘 결과는 **별칭으로 저장**해 다음 달엔 자동.
- **합계행 검증**: 대장의 지급합계·공제합계·차인지급액 열이 있으면 PlanQ 가 다시 더한 값과 **대조**해 다르면 그 사람 줄에 경고(대장 자체의 오류·열 누락을 잡는다). 인원 합계행은 행 매칭에서 뺀다(이름 «합계»·«계»).

### 7.4 대조 화면과 채택
- 칸 = `payroll_entry_lines`. 상태: 같음(초안=대장) · 차이 · 대장만 · 초안만. 색이 아니라 **뱃지 글자**로(예상/대장/입력).
- 버튼: 「대장 값 전부 채택」(기본 — 법정 항목은 이것이 정답) · 행별 채택 · 칸별 채택 · 직접 입력(AutoSaveField, `final_source='manual'`). 초안 값을 쓰고 싶으면 「초안 유지」. 채택은 `final_amount`·`final_source` 만 바꾼다(초안·대장 값은 남아 이력이 된다).
- **AI 의 자리(확정)**: 틀 제안(7.1)·PDF 추출(7.2) **두 곳뿐**. 금액을 고치거나 채택하거나 확정하는 AI 경로는 없다. **AI 에이전트 도구(`services/agent/registry.js`)에 급여 도구를 두지 않는다**(HIGH — 가드 `agentsurface` 가 Payroll* 모델 참조 0 을 센다). `get_context`·`search_all`·통합검색 인덱스에 급여 표를 넣지 않는다.

---

## 8. 월급 정본 충돌 — (a)안 확정

- `memberCost.getMemberCostMap(businessId)`: 모듈이 켜져 있으면 `payrollContracts.activeMonthlyPayByUser(businessId, asOf)`(유효 계약의 **fixed 지급 줄 합**, user_id 있는 사람만)를 먼저 본다 → `source:'contract'`. 없으면 종전 순서(hourly → salary → null). **컬럼에 쓰지 않는다.**
- 단가 화면(`/business/settings` 멤버 단가)은 계약이 있는 멤버 줄에 «계약에서 옴 3,200,000 · 읽기 전용» + 계약 링크. `PUT /members/rates` 는 그 멤버의 `monthly_salary` 를 받으면 409 `salary_from_contract`(조용히 무시하지 않는다).
- 모듈을 끄면 `source:'contract'` 가 사라지고 컬럼으로 돌아간다 — 수익성 인건비가 바뀔 수 있다. 끄기 확인창에 한 줄(«수익성 인건비는 멤버 단가 설정값으로 돌아갑니다»).
- 프리랜서(계정 없음)는 memberCost 대상이 아니다(업무 담당자가 아니므로 시간이 없다).
- 수익성 탭의 «급여 확정분 → 인건비» 연결은 **P5**. 그때 `OverheadItem(category payroll)` 과 **같은 달 둘 다 있으면 경고**(이중 계상) — 같은 값 공식 두 벌 금지.

---

## 9. 화면 — 기존 껍데기만

i18n 네임스페이스 **`payroll`**(ko/en 동시, `i18n.ts` ns 등록) · 메뉴 라벨은 `layout`. 새 디자인 없음.

| 화면 | 껍데기 | 내용 |
|---|---|---|
| `/business/settings` «기능 사용» | 기존 WorkspaceSettingsPage 섹션 + `AutoSaveField type="toggle"` ×2 | §2.4 |
| `/business/settings/permissions` «급여 담당자» | `DefaultBillingOwnerSection` 과 같은 섹션 · 멤버 다중 선택(PlanQSelect 는 팝오버 밖이라 OK) · AutoSaveField | owner 만 |
| **`/payroll`** (features 섹션, `moduleKey:'payroll'`, roles owner·member — 서버 술어가 다시 거른다) | `PageShell` + `segmentedToggle`(급여 \| 대상자 \| 항목) + `filterBar` + `ListSortSelect` | 급여 탭 = 월별 회차 목록(귀속월·지급일·인원·지급합계·공제합계·차인·상태·정정 뱃지) · [+ 이달 급여] `CreateDrawer` |
| `/payroll/runs/:id` | 상세 **두 밴드**(`PanelHeader` + `DetailMetaBar`), 본문은 표(사람 × 항목, 가로 스크롤) — 폰은 사람 카드 목록 → 칸은 드로어 | 밴드2 액션 ≤3: [대장 가져오기] [확정] [지급완료] · ⋯ 에 초안 다시 만들기·정정 회차·삭제·CSV 내보내기. 초안 금액 칸은 `AutoSaveField`(PATCH 1건) · 확정은 `ConfirmDialog`(«n명 · 차인지급액 합계 · 송금 할 일 n건 만들기») |
| 대상자 탭 | 목록(`LetterAvatar` 라운드 박스) + `DetailDrawer` 상세: 기본정보(AutoSaveField) · **계약 이력** 탭(시간순, 현재 계약 뱃지) · 계좌(보유 여부 + [보기] 감사) | [+ 계약] `CreateDrawer`: 종류·기간·근무조건·금액줄(항목 셀렉트+금액, 행 추가)·지급일 · 「계약서 문서 만들기」 체크 → 템플릿 변수(`template_filler.renderTemplate`) 채워 `post_actions` 로 문서 생성 → 서명은 기존 Q docs 흐름 |
| 항목 탭 | 표(정렬 드래그 없이 sort_order 입력) + `DetailDrawer` 편집(AutoSaveField) · [프리셋 불러오기] 모달(나라·형태 → 미리보기 → 추가) · [AI 로 틀 제안] 2단 버튼 규약 | 쓰인 항목은 비활성만 |
| 대조(`/payroll/runs/:id?tab=reconcile`) | 같은 상세의 두 번째 탭 — 미매칭 사람·열 패널(상단) + 칸 표(뱃지) | «대장 값 전부 채택» Primary |
| **`/me/payslips`**(personal 섹션, `moduleKey:'payroll'`) | `PageShell` 목록 + `DetailDrawer` 명세서(줄·합계·지급일·사업자명·책임선 문구) + [PDF] — 문서 PDF 와 같은 생성기 | 본인 것만. 열람이 `payslip_viewed_at` 을 찍는다 |
| 멤버 상세(`/business/members?member=`) | 기존 드로어에 «계약 이력» 링크 한 줄(모듈 켜짐 ∧ 관리자) → `/payroll?person=:id` | 새 화면 없음 |
| Q docs 템플릿 선택 | 기존 그대로 — 근로계약서 3종이 목록에 보일 뿐 | |

- `data-testid`: `payroll-run-new` · `payroll-run-confirm` · `payroll-statement-upload` · `payroll-adopt-all` · `payroll-person-new` · `payroll-contract-new` · `payslip-pdf` · `modules-payroll-toggle`.
- 실시간: 회차 화면은 `payroll:updated` → 250ms silentLoad(서버 fresh 교체) + `useVisibilityRefresh`; 명세서 목록은 `payslip:new`. 둘 다 개인 방 수신(§5.2-5).
- 상세 URL 싱크 `?run=`·`?person=`·`?entry=`, 재클릭 토글, 뒤로 가기=패널 닫기(`useBackToClose`는 DetailDrawer 내장).

---

## 10. 단계 — 각 단계가 혼자 쓸모 있게

| 단계 | 내용 | 혼자 쓸모 | 검증(실HTTP · 양성/음성) |
|---|---|---|---|
| **P0** 계약서 템플릿 3종 | `seed-document-templates.js` 에 «표준 근로계약서(기간의 정함 없음)»·«기간제 근로계약서»·«프리랜서(업무위탁) 계약서» — kind `contract`, `workspace_only`, mode `editor`, 변수 슬롯(`{{employee_name}}`·`{{start_date}}`·`{{base_pay}}`·`{{weekly_work_days}}`·`{{daily_work_hours}}`·`{{pay_day}}`…) · 근로기준법 §17 필수기재(임금 구성·계산·지급방법 · 소정근로시간 · 휴일 · 연차) 섹션 · 양측 서명란. ko 본문 + en 본문(locale bilingual 1건이 아니라 ko 3 + en 3 = 6행) · 배포 슬롯에 시드 등록 | 오늘부터 계약서를 문서에서 만들고 서명받는다 | 시드 2회 실행 → 행 수 불변(멱등) · `GET /api/docs/templates?business_id=6` 에 6건 · 템플릿으로 문서 생성 → `renderTemplate` 미치환 슬롯 0 · 서명 요청→내부 서명→`--suite signature` 초록 · **노무사 검수 전** 템플릿 설명에 «검수 전 초안» 표기 |
| **P1** 스위치 · 대상자 · 계약 · 담당자 · memberCost | `modules`·`services/modules.js`·`requireModule`·`ModuleGate`·auth/me `modules` · 표 3.1·3.2·3.4(항목은 P2 — P1 의 금액줄은 `base` 하나를 시스템 기본 항목으로 먼저 만든다) · `payrollAccess` · `payrollContracts`(activate·서명 훅) · 담당자 섹션 · `/payroll` 대상자 탭 · memberCost (a) · 멤버 드로어 링크 · 마이그레이션 | 직원별 계약 이력과 서명 연결, 수익성 인건비가 계약을 읽는다 | ①모듈 끔: 관리자 `GET /api/payroll/6/people` **404**, 메뉴 없음, `/payroll` 직접 접근 NotFound ②켬: owner 200 · member 403 · admin 403 · 담당자로 지정한 member 200 · 내보낸 담당자 403 · 다른 ws owner 404/403 · client 403 · platform_admin 403 ③계약 activate → 겹친 옛 계약 superseded · 같은 날 둘 → 409 ④서명 전부 완료 → `signed_at` 찍힘(양성) · 한 명 미서명 → NULL(음성) ⑤`getMemberCostMap` source `contract` ∧ 값 = 금액줄 합 · 모듈 끄면 `salary` 로 복귀 ⑥응답 원문에 계좌번호 0 + `has_bank_account:true` 대조군(health-check `secrets` 추가) ⑦`/api/auth/me.modules` 가 토글을 따라간다 |
| **P2** 항목 · 프리셋 · 이달 초안 | 표 3.3·3.5~3.8 · `payrollCalc` · `payrollTransition`(createRun·buildDraft·deleteRun) · 프리셋 + AI 틀 제안 · 무급휴가 일할 · 회차 화면(초안 편집) | 매달 «누가 얼마» 초안을 PlanQ 가 만들어 준다(대장이 오기 전 예상) | 사례 A·B·6.4 를 **단위 검산**(`payrollCalc` 순수 함수, 반올림 경계 300·0·음수) · buildDraft 2회 → 줄 수 불변, manual 줄 보존 · 계약 없는 사람 제외 · 무급 2일 승인 → 276,923(양성) / 유급 2일 → 0(음성) · 정률 순환 → 409 · 쓰인 항목 삭제 → 409 · AI 끔 → generic 프리셋 · member 가 `POST /runs` → 403 |
| **P3** 대장 대조 | 업로드(xlsx 기계 / pdf AI) · 매칭 · 대조 탭 · 채택 · 별칭 학습 · 합계행 검증 | 세무사 대장과 PlanQ 가 한 화면에서 맞는지 보인다 | 가상 인물 3명 엑셀 픽스처(`__tests__/fixtures/payroll-register.xlsx`, 실명 금지) → 매칭 3/3 · 사번 없이 동명이인 → 미정 · 미매칭 열 → external 생성 · PDF 픽스처에 가짜 주민번호 모양 → LLM 요청 본문에 `***`(가로채서 확인, 양성 대조군 = 가리기 끔) · 합계행 ≠ 재합산 → 경고 · 채택 후 `final_source='statement'` · 다시 올리면 old 감사 · `statement_extract_json` 응답에 계좌 모양 0 |
| **P4** 확정 · 명세서 · 송금 할 일 · 지급완료 · 정정 | confirm/markPaid/createAdjustment · 할 일 생성(멱등) · `/me/payslips` + PDF · 알림 ENUM `payroll` · 실시간 · 월별 목록 · 잠금 · 이력 | 끝까지 한 바퀴 — Irene 의 흐름 전체 | 빈 final 줄 → 409 · 확정 2회 → 두 번째 409, 할 일 **1건만**(멱등) · 확정 뒤 PATCH 줄 → 409 `run_locked` · 항목 이름 바꿔도 명세서 옛 이름 · 본인 `GET /entries/:id/payslip` 200, 동료 403, 미확정 404 · 할 일 본문에 계좌번호 0 · 알림 `push_logs` ≥1 ∧ `email_logs` 0(skipChannels) · `business:` 방에 `payroll:*` 0건(소켓 음성 대조군) · 정정 회차 음수 차인 허용·원 회차 불변 · 모듈 끄면 `/me/payslips` 404 · **Fable 완료 검증(gate — 돈·개인정보)** |
| **P5** 심화 | 연차 잔여 → 연차수당 표시 · 퇴직자 정산 표시 · 수익성 인건비 연결(이중 계상 경고) · 계정 없는 사람 명세서 메일/링크 발송(확인창에 주소, 일회용 링크 30일) · 이미지 대장 | | 별도 설계 1회(계산 — 연차수당은 통상임금 정의가 필요) |

공통 게이트(매 단계): `npm run build` EXIT 0 · `node scripts/health-check.js` · `guard-invariants`(i18n·parity·autosave·drawerwidth·duproute·tenant·notify·broadcast·agentsurface + §11 새 것) · `--suite tenant`.

---

## 11. 위험 · 되돌리기 어려운 지점 · 막는 장치

| 위험 | 왜 되돌리기 어렵나 | 장치 |
|---|---|---|
| 급여 응답이 멤버에게 샘 | 본 것은 되돌릴 수 없다 | 술어 한 곳(§4) · `GET /:biz/members` 에 급여 0 · health-check `secrets`: 「급여 응답 원문에 계좌번호 0 + 보유 여부는 온다」·「member 토큰으로 /api/payroll 403, 모듈 끔 404」 · `--suite tenant` 에 payroll 라우트 추가 |
| 모듈 가드 빠진 라우트 | 끈 워크스페이스에서 열린다 | 가드 `--category=modulegate`: `routes/payroll*.js`·`attendance.js`·`leave.js` 의 모든 `router.<verb>(` 에 `requireModule(` 이 체인에 있나(없으면 FAIL, 하드) · `biz.modules` 직접 읽기 0(판정 함수 밖) |
| AI 가 급여를 읽거나 쓴다 | 외부로 나간 개인정보 | `agentsurface` 에 `Payroll*`·`EmploymentContract`·`PayItem` 참조 0 추가 · `get_context`/search 인덱스 소스 목록에 급여 없음(가드 `cuetools` 계열) · LLM 요청 전 마스킹 함수 1벌 + 양성 대조군 |
| 확정이 두 번·할 일 중복 | 돈이 두 번 나간다 | 트랜잭션 `LOCK.UPDATE` + status 재확인 · `transfer_task_id` 멱등 · 검증 «확정 2회 → 할 일 1건» |
| 빈칸을 0 으로 확정 | 공제 누락 = 과지급 | `line_unresolved` 409 · 예상/대장/입력 뱃지 없는 숫자 금지 |
| 요율을 코드에 박음 | 매년 틀어지고 책임이 우리에게 | 프리셋에 요율 없음 · 법정 항목 `external` 강제 · AI 제안의 요율 버림 · 책임선 문구 고정 |
| ENUM append 누락 | 알림 500 | `migrate-payroll.js` 배포 슬롯 · `lib/enumAppend` |
| 파생값 저장 | 월급 두 벌 | memberCost (a) · `PUT /members/rates` 409 |
| 소켓 business 방 방송 | 급여 존재가 전원에게 | `broadcast` 가드에 `payroll:` 이벤트는 `user:` 방만 허용 규칙 추가 |
| 템플릿 문구 오류 | 법적 문서 | 설명에 «검수 전 초안» · Irene 할 일: 노무사 검수(상황판) |
| 대장 파일이 Q file 에 노출 | 전 직원 급여 | 업로드 시 L1+confidential 강제 · `fileListWhereByLevel` 이 거른다(기존 술어) · 검증: member 토큰 파일 목록에 0 |
| 주민번호가 들어옴 | 저장 자체가 위험 | 컬럼 없음 · 추출 JSON 저장 전에도 같은 마스킹 · note 칸은 자유 텍스트라 입력 시 패턴 경고(막지는 않음) |

Fable 호출 계획: 설계 1(이 문서) + **P4 완료 검증 1**(돈·개인정보 gate). P1~P3 은 자체 검증 숫자로 보고(위 표의 양성/음성). P5 는 별도 설계 1.

---

## 12. Irene 에게 확인할 것
없음 — 모두 2026-10-15 결정 범위 안이다. 다만 **Irene 할 일 1건**: P0 템플릿 3종이 올라가면 노무사·세무사 검수(문구는 초안) — 상황판에 올린다.
