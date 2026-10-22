# 휴가 종류 설정 — 회사가 종류를 직접 등록·관리한다 (설계, 2026-10-22 · Fable)

> Irene: *«연차나 휴가종류 등록/관리 어디에 있어? 관리자 설정에 안보이는데»* → 선택지 ①(회사가 종류를 직접 추가·수정 — 이름·유급/무급·연간 기본 일수 + 설정 › 근태 관리 맨 위에 «휴가 설정» 칸) «권고대로».
> 상위 설계: `docs/ATTENDANCE_LEAVE_DESIGN.md` §3.3·§3.4·§4.2·§7.1 (잔여 파생·승인 시점 박제 원칙은 그대로다). 급여 연결: `docs/PAYROLL_DESIGN.md` §6.4.
> 이 문서는 **종류를 고정 ENUM 에서 워크스페이스 데이터로 옮기는 것**만 다룬다. 출퇴근·승인 흐름·차감일 환산은 바꾸지 않는다.

## 0. 한 줄 요약

`leave_types` 표를 새로 두고(워크스페이스별, 시스템 기본 5종은 `code` 로 식별), 부여·신청은 `leave_type_id` 로 종류를 가리킨다.
**유급/무급은 종류가 정한다**(신청자가 고르지 않는다). 신청 행의 `leave_type`(paid/unpaid) 은 그대로 남아 **신청 시점의 박제**가 된다 —
잔여·통계·급여 무급 일할은 지금처럼 그 박제만 읽으므로 **종류를 나중에 고쳐도 옛 신청·잔여·급여는 한 숫자도 움직이지 않는다.**
옛 `category` ENUM 컬럼은 한 릴리즈 동안 **이중 기록**으로 남겨 코드 롤백을 보장하고, 다음 정리 때 지운다.

## 1. 지금 구조와 바꾸는 이유

| 지금 | 문제 |
|---|---|
| `leave_requests.category`·`leave_grants.category` = ENUM('annual','sick','family','other') · 라벨은 i18n `leave.category.<key>` | 종류를 늘리거나 이름을 바꾸려면 **ENUM ALTER + 운영 마이그레이션 + 양쪽 i18n** 이 필요하다. «리프레시 휴가»·«보건휴가» 같은 회사별 종류를 넣을 길이 없다. 관리자 설정에 종류가 안 보이는 것이 당연했다 — 코드에 박혀 있었다 |
| `leave_requests.leave_type` = ENUM('paid','unpaid'), **신청자가 고른다** | «병가인데 유급인가» 를 신청자가 매번 정한다. 회사 규칙이 들어갈 자리가 없다 |
| 연간 부여(`leave_grants`)는 사람 × 연도 × 종류 × 일수를 관리자가 손으로 | 종류별 «기본 일수» 가 없어 15명이면 15번 똑같이 15 를 친다 |

바꾸지 **않는** 것: 잔여 = Σ부여 − Σ승인(paid).days_charged 의 파생 원칙 · `days_charged` 승인 시점 박제 · 전이 함수 하나(`leaveTransition`) · 근무일 기준 환산(#424) · 승인 권한(owner/admin) · 급여 §6.4 공식.

## 2. 결정

### 2.1 종류는 **표**다 — JSON 설정이 아니다
`businesses.permissions` 같은 JSON 에 넣지 않는다. 이유 셋: ① 부여·신청 행이 종류를 **FK 로 가리켜야** 이름을 바꿔도 옛 행이 따라오고 삭제가 막힌다(JSON 안의 id 는 아무것도 보장하지 않는다) ② 잔여·급여·통계가 `WHERE leave_type_id = ?` 로 같은 축을 센다 ③ 같은 모양의 선례가 셋 있다 — `pay_items`(쓰인 항목은 지우지 못하고 끈다) · `workspace_holidays`(국가 행은 지우지 않고 끈다) · `task_tags`(biz+name UNIQUE).

### 2.2 유급/무급의 정본은 종류 · 신청 행에는 **박제**
- `leave_types.pay` ENUM('paid','unpaid') 가 정본. 신청 화면의 유급/무급 셀렉트는 **없앤다**(종류 옆에 읽기 전용 칩으로 보인다).
- `leave_requests.leave_type` 컬럼은 **이름도 값도 그대로** 두되 뜻이 바뀐다: «신청 시점에 그 종류가 유급이었나». `createRequest` 가 종류에서 복사해 넣는다 — 본문의 `leave_type` 은 **무시**한다(옛 번들이 보내도).
- 잔여(`getBalance` 의 `leave_type='paid'`)·통계(`routes/attendance.js` stats)·급여(`getDeductionsInRange({leaveType:'unpaid'})`)·Cue 문맥은 **지금처럼 행의 박제만** 읽는다. 종류 표의 `pay` 를 읽는 곳은 신청 생성과 부여 검증 둘뿐이다.
- **쓰인 종류의 `pay` 는 바꿀 수 없다**(`409 pay_locked`). 바꾸면 «연차 잔여 13일» 이 하루아침에 없어진다(유급→무급) 또는 부여 없는 종류에 잔여 검사가 걸린다(무급→유급). 바꿔야 하면 새 종류를 만들고 옛것을 끈다. 이름·기본 일수·순서·사용 여부는 언제든 고친다.
- 무급 휴가를 쓰는 길 = 기본 종류 «무급휴가»(`code='unpaid'`, pay unpaid). 잔여가 모자랄 때 안내 문구는 «무급으로 신청» 이 아니라 «무급 종류로 신청» 으로 고친다(동작이 바뀌면 문구가 거짓이 된다).

### 2.3 «연간 기본 일수» 는 **부여 폼의 기본값**이다 — 자동 부여가 아니다
- `leave_types.default_days DECIMAL(4,1) NULL`. 부여 폼에서 종류를 고르면 일수 칸이 이 값으로 **미리 채워진다**(고칠 수 있다). 무급 종류는 NULL 고정(부여 자체가 없다).
- 1월 1일 cron 으로 전원에게 자동 부여하지 **않는다.** 부여는 원장(`leave_grants`)이고 사람이 쓴다 — 입사월 비례·회계연도·근속 가산을 모르는 채 자동으로 쓰면 틀린 행이 쌓이고 정정은 전부 음수 행이 된다.
- 2차(선택, 1차 없이도 완결): 부여 칸에 «올해 기본 일수로 아직 부여 안 된 멤버 전원 부여» 버튼 — 미리보기(대상 N명)를 보여주고 `(biz,user,year,type)` 에 부여 행이 하나라도 있으면 건너뛴다(멱등). 이것도 사람이 누른다.

### 2.4 기본 종류 5종 — `code` 로 식별, 라벨은 i18n 폴백
| code | pay | 뜻 | 라벨 |
|---|---|---|---|
| `annual` | paid | 연차 | `leave.category.annual`(기존 키) |
| `sick` | paid | 병가 | 기존 키 |
| `family` | paid | 경조사 | 기존 키 |
| `other` | paid | 기타 | 기존 키 |
| `unpaid` | unpaid | 무급휴가 | **새 키** `leave.category.unpaid` ko «무급휴가» / en «Unpaid leave» |

- 시스템 종류의 `name` 은 **NULL 로 시작**한다 → 화면은 `name ?? t('leave.category.'+code)`. 그래서 기본 종류는 ko/en 사용자에게 각자 언어로 보이고, 회사가 이름을 바꾸면 그때부터 그 글자가 **모든 사용자에게 같은 글자**로 보인다(사용자 데이터는 번역 대상이 아니다 — i18n 규칙의 «사용자 노출 문자열» 은 우리가 쓴 글자다).
- 서버가 글자를 만드는 곳(확인필요 `dashboard.js unitLabel`·Cue 문맥)은 `services/leaveTypes.displayName(type)` 하나 — `name` 이 있으면 그것, 없으면 code 별 ko 폴백표(지금 `TYPE = {paid:'연차', unpaid:'무급'}` 이 하던 일을 종류 기준으로).
- 왜 4종이 전부 paid 인가: 지금까지 부여는 종류별이고 잔여는 paid 만 셌다 — 4종 모두 «부여를 받을 수 있는 종류» 였다. 옛 행의 `leave_type` 박제는 그대로 남으므로 «병가·무급» 으로 신청했던 옛 행도 뜻이 변하지 않는다.
- 시스템 종류는 **지울 수 없고 끌 수만** 있다. 커스텀 종류는 쓰인 적이 없으면 지우고(hard delete), 쓰였으면 `409 type_in_use` → 끈다.
- 마지막 활성 종류는 끌 수 없다(`409 last_active_type`) — 신청 화면이 빈 셀렉트가 되면 기능이 죽는다.

### 2.5 권한
읽기 = 워크스페이스 멤버(고객 제외) — 신청 드로어가 목록을 읽는다. 쓰기 = owner·admin(+platform_admin). **`routes/business_holidays.js` 의 같은 술어**(`canWrite`·고객 제외)를 쓴다 — 두 파일이 각자 쓰지 않도록 그 둘을 `services/attendanceAdmin.js`(또는 holidays 파일 상단 export) **한 곳**으로 빼서 둘이 import 한다. 메뉴 키는 새로 만들지 않는다(상위 설계 §2.5).

## 3. 데이터 모델

### 3.1 `leave_types` (신규)
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INT PK AI | |
| business_id | INT NOT NULL FK businesses | |
| code | VARCHAR(20) NULL | 시스템 종류만(`annual`·`sick`·`family`·`other`·`unpaid`). 커스텀은 NULL. **UNIQUE(business_id, code)** — NULL 은 유니크에 안 걸린다 |
| name | VARCHAR(50) NULL | 회사가 정한 이름. `code IS NULL` 이면 NOT NULL(서비스가 검사). trim·NFC. 같은 워크스페이스 안에서 **대소문자 무시 중복 금지**(비활성 포함 — 이력에 같은 글자가 둘 보이면 안 된다) |
| pay | ENUM('paid','unpaid') NOT NULL | §2.2. 쓰인 뒤 불변 |
| default_days | DECIMAL(4,1) NULL | 부여 폼 기본값. pay unpaid 면 NULL 강제. 0 < x ≤ 366, 0.5 단위 |
| is_active | BOOLEAN NOT NULL DEFAULT 1 | 끈 종류는 신청·부여 셀렉트에서 빠진다. 옛 행 표시에는 남는다 |
| sort_order | INT NOT NULL DEFAULT 0 | 시스템 5종 0~4, 커스텀은 생성 순(id). 1차에서는 끌어서 바꾸지 않는다 |
| created_by | INT NULL FK users | 시스템 시드는 NULL |
| created_at / updated_at | | |

인덱스: UNIQUE(`business_id`,`code`) `leave_types_biz_code` · (`business_id`,`is_active`,`sort_order`) `leave_types_biz_active`. **이름을 반드시 명시한다**(TaskTag 주석 — 무명이면 sync 가 다른 이름으로 하나 더 만든다).

### 3.2 기존 표 변경
| 표 | 변경 |
|---|---|
| `leave_grants` | `+ leave_type_id INT NOT NULL FK leave_types` (백필 뒤 NOT NULL). 인덱스 (`business_id`,`user_id`,`year`,`leave_type_id`) `leave_grant_biz_user_year_type` — 잔여가 이 축으로 센다 |
| `leave_requests` | `+ leave_type_id INT NOT NULL FK leave_types`. `leave_type`(paid/unpaid) 유지 = 박제 |
| 둘의 `category` ENUM | **남긴다. 모델에도 남긴다**(`sync-database` 가 모델 밖 컬럼을 DROP 한다 — memory `feedback_sync_drops_columns_not_in_model`). 새 코드는 **읽지 않고 쓰기만** 한다: `category = legacyCategoryOf(type) = type.code ∈ 4종 ? code : 'other'`(«무급휴가» 도 'other'). 이유 = 롤백(§8). 다음 정리 사이클에 이중 기록·컬럼·`LEAVE_CATEGORIES` 를 함께 지운다 |

### 3.3 모델 선언
`models/LeaveType.js` 신규(`class X extends Model`, underscored). `models/index.js`: `LeaveType.belongsTo(Business)` · `LeaveGrant.belongsTo(LeaveType, {as:'type', foreignKey:'leave_type_id'})` · `LeaveRequest.belongsTo(LeaveType, {as:'type', foreignKey:'leave_type_id'})` · export 목록에 추가. `LeaveRequest`·`LeaveGrant` 의 `category` 주석을 «deprecated — 쓰기만, §3.2» 로 고친다.

## 4. 마이그레이션 (`dev-backend/scripts/migrate-leave-types.js`, 멱등 · **코드보다 먼저** · 배포 슬롯 등록)

순서(한 트랜잭션이 아니어도 각 단계가 멱등이라 끊겨도 다시 돌리면 된다):
1. `leave_types` 표가 없으면 CREATE(위 정의 그대로 — 모델 sync 에 맡기지 않는다. 운영은 sync 를 돌리지 않는다).
2. `leave_grants`·`leave_requests` 에 `leave_type_id INT NULL` 이 없으면 ADD(아직 NULL 허용).
3. **시스템 5종 시드** — 대상 = `leave_grants ∪ leave_requests` 에 행이 있는 `business_id` 전부(없는 워크스페이스는 §5.1 lazy ensure 가 처음 열 때 만든다). `INSERT … SELECT … WHERE NOT EXISTS(biz, code)`.
4. **백필** — `UPDATE leave_grants g JOIN leave_types t ON t.business_id=g.business_id AND t.code=g.category SET g.leave_type_id=t.id WHERE g.leave_type_id IS NULL`(requests 동일). `category` 는 4종 모두 code 와 같은 글자라 조인이 곧 매핑이다.
5. **검증(실패면 exit 1, NOT NULL 로 안 간다)**: ① 두 표에서 `leave_type_id IS NULL` = 0 ② 표별 `GROUP BY category` 건수 == `GROUP BY t.code` 건수(종류별 일치) ③ `GROUP BY leave_type`(paid/unpaid) 분포 **변경 0**(박제를 건드리지 않았다는 증거) ④ 시드된 워크스페이스마다 `code` 5종이 정확히 1행씩.
6. `MODIFY leave_type_id INT NOT NULL` + FK + 인덱스(이미 있으면 건너뜀).
7. 출력: 워크스페이스 수 · 시드 수 · 백필 수 · 종류별 분포. `tail -8` 에 들어가게 짧게.

- 배포 스크립트: `scripts/deploy-planq.sh` 의 `migrate-leave-category.js` 슬롯 **바로 뒤**에 같은 모양으로 등록(«코드보다 먼저 돈다 — 모델이 leave_type_id 를 선언한다»).
- dev 에서 먼저: 마이그레이션 **전**에 시험 사용자 3명(owner·member1·member2, ws 6)의 `GET /api/leave/balance` 응답을 JSON 으로 저장해 두고, 마이그레이션 + 새 코드 뒤 같은 호출의 `remaining`·`used`·종류별 값이 **바이트 단위로 같은지** 비교한다(§9 검산 0번).

## 5. 서버

### 5.1 `services/leaveTypes.js` (신규 — 종류를 읽고 쓰는 문 하나)
- `ensureDefaults(businessId, t?)` — 5종 `findOrCreate`(UNIQUE 가 경합을 막는다). `listTypes` 와 `resolveType` 이 먼저 부른다 → 새 워크스페이스도 처음 휴가 화면을 열면 기본 종류가 있다(가입 경로 여러 곳에 심지 않는다).
- `listTypes(businessId, { includeInactive=false })` — sort_order, id 순.
- `resolveType(businessId, leaveTypeId, { requireActive=true })` — **`business_id` 를 WHERE 에 건다**(남의 워크스페이스 종류 id 로 신청하면 `400 invalid_leave_type`). 비활성이면 `400 type_inactive`.
- `createType(businessId, actor, {name, pay, default_days})` · `updateType(businessId, actor, id, patch)` · `deleteType(businessId, actor, id)` — 규칙 전부 여기(§2.4·§3.1): 이름 정규화·중복(`409 name_taken`)·pay 불변(`isUsed(type)` = requests ∪ grants 1건 이상 → `409 pay_locked`)·시스템 삭제 금지(`400 system_type`)·`type_in_use`·`last_active_type`·unpaid 면 default_days NULL. 감사 `leave_type.create|update|delete`(old/new) · 방송 `leave_type:updated {business_id}` 신호만.
- `legacyCategoryOf(type)` · `displayName(type)`(§2.4) · `serializeType(t)` = `{id, code, name, pay, default_days, is_active, sort_order, in_use}`.

### 5.2 `services/leaveTransition.js` (수정)
- `createRequest`: `payload.leave_type_id` → `resolveType`. **호환**: 없고 `payload.category` 가 있으면 그 code 의 시스템 종류(옛 번들), 둘 다 없으면 `annual`. `leave_type = type.pay`(본문 `leave_type` 무시). `category = legacyCategoryOf(type)`. 나머지(겹침·근무일 0·단위 검증) 그대로.
- `getBalance(businessId, userId, year, leaveTypeId=null)`: 종류별 집계 축을 `leave_type_id` 로. 응답은 `{…합계 그대로, by_type: [{id, code, name, pay, granted, used, pending, remaining, remaining_after_pending}], by_category: {…}}` — `by_category` 는 **한 릴리즈 호환**(시스템 code 가 있는 종류만, 옛 번들·Cue 프롬프트) 뒤 삭제. 무급 종류는 `by_type` 에 넣되 숫자 0(«잔여 없음» 은 화면이 pay 로 판단).
- `approve`: `getBalance(..., request.leave_type_id)` 로 그 종류 잔여 검사(지금의 `cat` 자리). 그 외 불변.
- `LEAVE_CATEGORIES` export 삭제. 가드 §9.4.

### 5.3 라우트
- `routes/leave.js`: `POST /grants` — `leave_type_id` 필수(호환: `category` → 시스템 종류). `resolveType`(활성) + `pay==='paid'` 아니면 `400 type_not_paid`. `GET /balance?leave_type_id=`(호환 `category`). `serializeRequest`·grants 응답에 `leave_type_id` + `type: {id, code, name, pay}` 추가(`category` 는 한 릴리즈 유지).
- `routes/business_leave_types.js`(신규, `/api/businesses` 에 holidays 와 같은 방식으로 마운트 — `server.js` 한 줄): `GET /:businessId/leave-types?include_inactive=1`(멤버) · `POST`(쓰기) · `PATCH /:id`(쓰기 — name·default_days·is_active·pay(잠김 검사)) · `DELETE /:id`(쓰기). 응답 `{types:[…], can_edit}`. 같은 파일에 같은 method+path 둘 금지(가드 duproute).
- `routes/dashboard.js collectLeaveApprovals`: `include: [{model: LeaveType, as:'type'}]` → `unitLabel` 의 `base = displayName(r.type)`(유급 병가가 «연차» 로 보이던 것이 고쳐진다). `routes/attendance.js` stats 는 박제만 쓰므로 무변경.
- `services/cue_context.js`: `me.leave_requests` 에 `type_name` 추가, `me.leave_balance` 는 `getBalance` 결과 그대로(by_type 포함). AI 에이전트 도구(`services/agent/registry.js`)에는 **아무것도 더하지 않는다** — 휴가 도구가 원래 없고, 종류 설정은 관리 행위다(가드 agentsurface 영향 0). 검색 색인 대상 아님.

## 6. 화면

### 6.1 설정 › 근태 관리 — 맨 위 «휴가 설정» (`pages/Settings/LeaveTypeSettingsSection.tsx`, 신규)
`AttendanceAdminSettings.tsx` 에서 `<Desc>` 다음, `HolidaySettingsSection` **위**에 둔다. 껍데기·소켓·AutoSave 패턴은 `HolidaySettingsSection` 과 같은 것(새로 그리지 않는다 — 공통 Section/Row styled 가 그 파일 안에 있으면 `Settings/attendanceSectionShell.ts` 로 빼서 둘이 쓴다).

```
휴가 설정                                   (설명: 종류·유급/무급·연간 기본 일수. 유급/무급은 한 번 쓰인 뒤 바꿀 수 없어요)
┌ 이름(입력, AutoSave) ─ 유급/무급(스위치, 쓰인 종류는 비활성+이유 title) ─ 연간 기본 일수(숫자 0.5, 무급이면 «—») ─ 사용(토글) ─ 삭제(미사용 커스텀만) ┐
│ 연차            유급   15     ●     (시스템)                                                                                              │
│ 병가            유급    3     ●                                                                                                          │
│ 경조사          유급    —     ●                                                                                                          │
│ 기타            유급    —     ●                                                                                                          │
│ 무급휴가        무급    —     ●                                                                                                          │
│ 리프레시 휴가   유급    2     ●     🗑                                                                                                   │
└ + 종류 추가 : [이름] [유급|무급] [기본 일수]  [추가]                                                                                     ┘
```
- 이름 칸의 placeholder 는 `t('leave.category.'+code)`(시스템) — 비워 저장하면 **NULL 로 되돌아가** 폴백 라벨이 다시 보인다(«지우기 = 기본 이름으로»). 커스텀은 빈 이름 400.
- 각 칸은 `AutoSaveField`(input 2초·toggle 300ms) → `PATCH`. 실패는 던진다(`!` 뱃지). 추가 폼은 `// autosave-exempt: 액션 버튼(생성)`.
- `can_edit` 가 false 면 읽기 전용(멤버는 이 화면에 못 오지만 admin 권한 변동 중 열려 있을 수 있다).
- 폰(≤640): 행을 두 줄로 감싼다(이름 / 나머지 컨트롤). 컨트롤 높이는 머리줄 32·필터줄 36 규칙 그대로.
- 실시간: `leave_type:updated` → 250ms debounce reload · `useVisibilityRefresh`.
- `data-testid`: `leave-types-section` · `leave-type-row-<id>` · `leave-type-add`.

### 6.2 신청 드로어 `LeaveRequestDrawer.tsx`
- 종류 셀렉트 옵션 = 활성 종류(`useLeaveTypes(bizId)`). **유급/무급 셀렉트 삭제**, 그 자리에 읽기 전용 칩: 유급 → «유급 · 남은 N일(종류 이름)», 무급 → «무급 · 잔여를 깎지 않아요».
- 잔여 조회 `?leave_type_id=`. 모자람 문구 `leave.balance.short` → «…무급 종류로 신청하거나 관리자에게 부여를 요청하세요». `none` 문구의 `{{cat}}` 은 종류 라벨.
- 전송 본문 `{ leave_type_id, unit, … }` — `leave_type`·`category` 를 보내지 않는다.

### 6.3 연간 부여 `TeamTab.tsx` GrantForm
- 종류 셀렉트 = 활성 **유급** 종류만. 종류를 고르면 일수 칸에 `default_days` 를 채운다(이미 사용자가 값을 친 뒤면 덮지 않는다 — 시스템이 채운 값 ≠ 사용자 입력).
- 대기 목록 메타 `t('leave.'+r.leave_type)` → `labelOf(r.type) · 유급/무급` 로.
- 부여 이력·개인 잔여 카드(`AttendancePage`)는 합계 그대로(1차 무변경). 종류별 카드는 다음 요청에.

### 6.4 공용 조각 `pages/Attendance/leaveTypes.ts`(`leaveCategory.ts` 대체)
`useLeaveTypes(bizId, {includeInactive})`(fetch + 소켓 reload) · `labelOf(type, t)` = `type.name ?? t('leave.category.'+type.code)`. `LEAVE_CATEGORY_KEYS` 삭제 — 화면에 종류 목록을 적는 곳이 0 이어야 한다.

### 6.5 i18n(ko/en 동시)
- `attendance.json`: `leave.category.unpaid`(«무급휴가»/«Unpaid leave») · `leave.payChip.paid/unpaid` · `leave.balance.short` 문구 수정.
- `settings.json`: `leaveTypes.title`(«휴가 설정»/«Leave types») · `desc` · 열 머리 5 · `add` · `systemBadge` · `payLocked`(«이미 쓰인 종류는 유급/무급을 바꿀 수 없어요») · 오류 `name_taken`·`type_in_use`·`last_active_type`·`system_type`·`invalid_days`.
- 가드 `--category=i18n`·`parity` 통과.

## 7. 불변식 (구현자가 지킬 것)
1. **종류 표의 `pay` 를 읽는 곳은 `createRequest`(박제 복사)와 `POST /grants` 검증 둘뿐이다.** 잔여·통계·급여·Cue 는 행의 `leave_type` 박제만 읽는다. — 이 둘을 지키면 «종류를 고쳐도 옛 신청·잔여·급여 불변» 이 **구조로** 성립한다.
2. 종류 id 를 받는 모든 문은 `resolveType(businessId, id)` — `business_id` 를 WHERE 에 건다. 종류 목록을 코드에 적지 않는다(`LEAVE_CATEGORIES`·`LEAVE_CATEGORY_KEYS` 0건).
3. `days_charged`·`leave_type`(박제)·옛 행의 `leave_type_id` 는 어떤 종류 수정에도 UPDATE 되지 않는다(이름 변경은 JOIN 으로만 반영).
4. 쓰인 종류: `pay` 불변 · 삭제 불가(끄기만). 시스템 종류: 삭제 불가. 마지막 활성 종류: 끄기 불가.
5. `category` 는 한 릴리즈 동안 **쓰기만**(`legacyCategoryOf`). 읽는 코드가 새로 생기면 가드가 잡는다(§9.4).
6. 라벨: 화면은 `labelOf`, 서버는 `displayName` — 둘 다 `name ?? 폴백(code)`. 사용자 이름을 `t()` 에 넣지 않고, 폴백 키 외의 글자를 서버가 만들지 않는다.
7. 상태 전이·알림·감사·방송은 종전대로 `leaveTransition` 안. 종류 CUD 의 감사·방송은 `services/leaveTypes` 안. 라우트는 권한·입출력만.

## 8. 롤백
- 코드만 되돌린다. 옛 코드는 `category`(이중 기록으로 새 행도 채워져 있다 — 커스텀·무급휴가 종류 행은 'other')와 `leave_type`(박제, 뜻 동일) 만 읽으므로 잔여·급여가 그대로 맞는다. 유일한 차이: 그 사이 만든 커스텀 종류 신청이 «기타» 로 보인다(값은 보존 — 다시 전진하면 돌아온다).
- 표·컬럼은 지우지 않는다. `leave_type_id NOT NULL` 은 옛 코드가 INSERT 할 때 **막힌다** → 롤백 절차에 `ALTER … MODIFY leave_type_id INT NULL` 한 줄을 적어 둔다(`migrate-leave-types.js --rollback-nullable`). 전진 시 백필 단계가 다시 채운다.

## 9. 검증

### 9.0 마이그레이션 검산(dev → 운영 둘 다, 스크립트가 출력)
§4-5 ①~④ + 시험 사용자 3명 잔여 JSON 전후 동일.

### 9.1 검산 사례 (dev ws 6, `[확인용]` 데이터 · `node test-leave-types.js` → 삭제)
설정: 연차(paid, 기본 15) · 병가(paid, 3) · 무급휴가(unpaid) · 커스텀 «[확인용] 리프레시»(paid, 2). member1 부여: 연차 15 · 병가 3 · 리프레시 2.
| # | 행동 | 기대 |
|---|---|---|
| 1 | 연차 2일(월~화) 신청→승인 | 연차 remaining 13 · 병가 3 · 리프레시 2 · 합계 remaining 18 |
| 2 | 병가 1일 승인 | 병가 2, 연차 13 불변 |
| 3 | 무급휴가 2일(수~목) 승인 | 모든 remaining 불변 · 행 `leave_type='unpaid'` · `getDeductionsInRange(…,{leaveType:'unpaid'})` = 2 · `unpaidLeaveAmount(3,000,000, 2, 5)` = **276,923**(§6.4 사례와 같은 수) |
| 4 | 연차 이름 → «연차휴가» | 잔여 숫자 전부 불변 · #1 행의 `type.name`=«연차휴가» · `days_charged` 2 불변 |
| 5 | 병가 끄기 | 신청 드로어 옵션에서 사라짐 · #2 행은 여전히 «병가» 로 보임 · 병가 부여 POST → 400 `type_inactive` |
| 6 | 연차 pay → unpaid 시도 | 409 `pay_locked`, 잔여 불변 |
| 7 | 무급휴가에 부여 POST | 400 `type_not_paid` |
| 8 | 리프레시 삭제(쓰임 있음) | 409 `type_in_use`; 새 커스텀 «[확인용] 임시» 만들고 바로 삭제 → 200, 목록에서 사라짐 |
| 9 | 이름 «연차휴가» 로 커스텀 추가 | 409 `name_taken` (대소문자·공백 변형도) |
| 10 | ws 7 의 종류 id 로 ws 6 신청 | 400 `invalid_leave_type` · **양성 대조군**: `resolveType` 의 business_id 조건을 잠시 빼면 201 로 뒤집혀야 한다(뒤집히지 않으면 검사가 거짓이다) |
| 11 | 옛 번들 흉내: `{category:'sick'}` 만 보내기 | 병가(활성일 때) 종류로 201 · `leave_type='paid'` |
| 12 | 활성 종류를 하나만 남기고 끄기 시도 | 409 `last_active_type` |
| 13 | member 로 PATCH | 403 · 고객 계정으로 GET → 403 |

### 9.2 화면(실브라우저, 3폭 · 양성 대조군 1)
`scripts/e2e/canary-leave-types.js`(`--suite leavetypes`, 픽스처는 Node 에서 직접 — `canary-leave-deeplink.js` 패턴): ① `/business/settings/attendance` 에서 `leave-types-section` 의 y < `HolidaySettingsSection` 의 y(«맨 위») · 섹션 높이 > 1 · `elementFromPoint` 가 그 섹션(가려지지 않음) ② 이름 입력 후 2.5초 — `PATCH /leave-types/:id` **정확히 1건** · ✓ 뱃지 ③ 시스템 종류 이름 비우기 → 폴백 라벨 복귀 ④ 신청 드로어에 유급/무급 셀렉트 **없음** + 종류 옵션 수 == 활성 종류 수 + 칩 글자 ⑤ 부여 폼에서 종류 고르면 일수 칸 == default_days ⑥ 폰 390: 행이 넘치지 않음(가로 스크롤 0) · 양성 대조군: 섹션 순서를 코드로 뒤집었을 때 ① 이 FAIL 로 뒤집히는지 1회.

### 9.3 기존 회귀
`node scripts/health-check.js`(전체) · `npm run build` EXIT 0 · `node scripts/guard-invariants.js`(전체 — `--category` 단독 금지) · `--suite tenant` · `--suite leavedeeplink`(알림 링크 그대로) · `--suite teampresence` · 급여 `node scripts/check-payroll-calc.js`(공식 무변경 확인).

### 9.4 새 가드(정적, `guard-invariants` 한 카테고리 `leavetypes`)
- `dev-backend/{services,routes}` 에서 `LEAVE_CATEGORIES` · `['annual','sick','family','other']` 리터럴 · `.category` 를 **읽는** 코드(`r.category`·`where.category`·`g.category`) 0건(`migrate-*`·`legacyCategoryOf` 예외).
- `dev-frontend/src` 에서 `LEAVE_CATEGORY_KEYS` 0건 · `leave_type:` 를 본문에 싣는 호출 0건.
- 깨뜨려 확인: 금지 리터럴 한 줄을 심어 FAIL 이 나는지 1회(memory `feedback_guard_must_be_falsified`).

## 10. 구현 순서 (파일 단위 · 각 단계가 완결)
1. **모델** `models/LeaveType.js` 신규 · `models/index.js` 연관·export · `LeaveRequest.js`·`LeaveGrant.js` 에 `leave_type_id` + `category` deprecated 주석.
2. **마이그레이션** `scripts/migrate-leave-types.js`(§4) → dev 에서 실행·검산 0번 → `scripts/deploy-planq.sh` 슬롯 등록.
3. **서비스** `services/leaveTypes.js` 신규(§5.1) · `services/leaveTransition.js` 수정(§5.2) · `services/attendanceAdmin.js`(권한 술어 추출, holidays 라우트가 import 하도록 한 줄 바꿈).
4. **라우트** `routes/business_leave_types.js` 신규 + `server.js` 마운트 · `routes/leave.js` 수정 · `routes/dashboard.js` 라벨 · `services/cue_context.js` type_name.
5. **API 실호출 검증** `dev-backend/test-leave-types.js`(§9.1 1~13) → 삭제. `pm2 restart planq-dev-backend`.
6. **화면** `pages/Attendance/leaveTypes.ts`(대체) · `LeaveRequestDrawer.tsx` · `TeamTab.tsx` · `pages/Settings/LeaveTypeSettingsSection.tsx` 신규 · `AttendanceAdminSettings.tsx` 한 줄 · i18n ko/en 2 네임스페이스. `leaveCategory.ts` 삭제. 빌드(백그라운드).
7. **검사** §9.2 카나리 신규 · §9.4 가드 신규(+깨뜨려 확인) · §9.3 전체.
8. **문서** `docs/ATTENDANCE_LEAVE_DESIGN.md` §3.3·§3.4 머리에 «종류는 docs/LEAVE_TYPES_DESIGN.md» 한 줄 · CLAUDE.md DB 표 절에 `leave_types` 한 줄 · `.claude/session-state.md`.
9. (선택, 2차) 전원 일괄 부여 버튼(§2.3) — 별도 커밋.
10. (다음 정리 사이클) `category` 이중 기록·컬럼·`by_category`·`category` 호환 인자 제거 + 운영 DROP 스크립트.

**Fable 완료 검증(게이트)**: 운영 DB 마이그레이션·백필(§4)과 급여 연결(§2.2·§7-1)이 «되돌리기 어려운 변경» 이다 — 구현 뒤 §9.0·§9.1 숫자(특히 #3 276,923 · #10 양성 대조군)를 붙여 `/fable-검증` 1회. 화면(§6)은 자체 검증.
