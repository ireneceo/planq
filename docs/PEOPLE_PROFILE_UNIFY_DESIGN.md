# 멤버·고객 프로필 한 벌로 — 기본 정보·이메일 작성·프로젝트 고객 직접 입력·설정 통합 목록 (초안 · Fable 설계 판정 대기)

> 2026-10-21 Irene: *"모든 고객과 멤버를 넣으면 기본 정보가 나오고 회사 직책 그런 거? 나오고 이메일은 클릭하면 우리 이메일 작성이 새창으로 열리게 해줘.
> 모바일은 보내고 뒤로가게 해주고. 그리고 프로젝트>고객에서도 Q sales>고객탭처럼 그냥 고객을 초대 말고 입력도 하게 해줘. 다 공유되게 해주고,
> 고객도 프로젝트랑 업무들 잘 연동되게 해주고. 멤버프로필, 고객 프로필도 통합 좀 해서 구조짜구고 다 여기 저기 동기화 해줘.
> 설정/구성원에 고객리스트도 한번 통합으로 나오게 해줘. 멤버처럼. … Q sales도 설정>고객도 통합리스트인건 마찬가지야.
> 그냥 혼란스러우니 멤버랑 같이 설정에서도 추가하고 보게 해주면 좋겠어. 멤버도 연결된 프로젝트랑 업무리스트, 히스토리가 보이게 해주고
> 고객 정보 프로필과 총정리 좀 해줘. 이거 중요하니까 fable 로 해줘."*
> 작성 [Opus] · 같은 계열 대기: `docs/CLIENT_MEMBER_EMAIL_MATCH_DESIGN.md`(고객 목록에 남는 멤버 — 이메일 일치 전환)

## 1. 지금 (코드 사실)
| 무엇 | 멤버 | 고객 |
|---|---|---|
| 데이터 | `users`(이메일·전화·job_title·organization) + `business_members`(name·job_title·organization·bio·expertise·부서·팀) — 워크스페이스 값이 우선, 없으면 User | `clients` 한 벌(display_name·company_name·invite_email·phone·kind·사업자·청구 담당…). **직책 칸 없음** |
| 목록 | 설정 > 구성원 `/business/members` (`WorkspaceSettingsPage.tsx` 안 인라인) | Q sale > 고객 탭 `/sale?tab=clients` (설정 > 고객은 10-16 에 없애고 Q sale 로 넘김) |
| 상세 | 같은 파일 인라인 드로어(1514~1824): 프로필 · 워크스페이스 정보 · 가용시간 · 단가 · 위험 영역. **연결 프로젝트·업무·히스토리 없음** | `ClientPanel` + `/sale/:id` 가 같은 절: 요약·상태 배너·프로필 폼·연결(업무·파일·프로젝트)·사업자/청구/메모·변경 이력·통합 타임라인 |
| 멤버 쪽 API | `GET /api/businesses/:biz/members` 하나. 사람별 프로젝트·업무·활동 API 없음(쓸 수 있는 것: `GET /api/tasks/by-business/:biz?assignee_id=` · `GET /api/activity/:biz?actor=` owner/admin 전용) | `GET /api/sale/:biz/clients/:id` · `/timeline` · `/api/clients/:biz/:id/history` |
| 이메일 | 목록·드로어 평문. 아바타 팝오버(`UserInfoPopover`, Q talk 만)만 `mailto:` | 평문 (ClientPanel·프로필 폼·Q sale 목록·프로젝트 고객 탭) |
| 메일 작성 | `/mail?compose=1` 은 받는 사람을 못 받는다(`to=` 안 읽음). 메일 안에서만 주소 → `onCompose(email)` 로 받는사람 채움. **따로 뜨는 작성 창 없음** (팝아웃은 talk/task/note/help 만 — `utils/pinHost.openPopout`) |
| 프로젝트 > 고객 | `QProjectDetailPage.tsx:1244-1353` — «기존 고객 연결» 셀렉트 + «새로 초대» 폼, 둘 다 `POST /api/projects/:id/clients {name,email}`. **기존 고객을 골라도 client_id 를 안 보낸다**(서버는 받는다 — 이름·이메일로 다시 찾다가 계정 없는 고객이면 새 invited 행을 만들 수 있음). 직접 관리(가입 없이 정보만) 문 없음 |
| Q sale 직접 입력 | `ClientAddDrawer` «초대 / 직접 관리» — `POST /api/clients/:biz/managed`·`/invite`(client_id 승격) |
| 실시간 | 고객 `client:new/updated` (business 방) · 멤버 목록은 소켓 300ms 재조회 |

## 2. 제안
### 2-1. «사람 카드» 한 벌 (`components/People/`)
- **보이는 기본 정보 한 모양** — 이름 · 회사/소속 · 직책 · 이메일(눌러 작성) · 전화 · 종류 꼬리표(멤버 역할 / 고객 상태). 멤버 드로어·고객 패널·`/sale/:id`·아바타 팝오버가 같은 `PersonBasics` 를 쓴다.
- **값은 각자 원래 표에서** — 새 «사람» 표를 만들지 않는다(멤버 = 계정, 고객 = 고객사 연락처라 수명·권한이 다르다. 같은 사람이면 «멤버가 이긴다» 10-16 규칙이 이미 있음).
  서버가 화면용 모양 하나로 맞춘다: `services/personProfile.js` `memberBasics(bm,user)` · `clientBasics(client)` → `{kind, id, name, company, job_title, email, phone, avatar, status}`.
- **고객 직책 칸 추가** — `clients.job_title VARCHAR(100) NULL` (운영 `migrate-client-job-title.js` 멱등, 배포 슬롯). 직접 관리·초대·프로필 폼에서 입력. 계정 고객도 워크스페이스가 붙이는 값이라 편집 가능(멤버 job_title 과 같은 축).

### 2-2. 이메일 누르면 «우리 메일 작성»
- 공용 `components/People/EmailLink` 하나 — 이메일을 보여 주는 사람 화면 전부(멤버 목록·드로어·고객 패널·상세·Q sale 목록·프로젝트 고객 탭·팝오버).
- **데스크탑·태블릿(따로 창 열 수 있을 때)**: 새 창 `/mail-compose?to=<주소>`(MainLayout 없는 팝아웃 페이지 — `QTaskStandalonePage` 틀, `openPopout` 계열). 그 페이지는 Q mail 작성 폼 **같은 컴포넌트**를 얹는다(새로 그리지 않는다 — 작성 폼을 MailPage 에서 빼서 둘이 같이 쓴다). 보내면 창이 닫힌다.
- **폰(미러 모드)**: 같은 창 안에서 `/mail?compose=1&to=<주소>&back=1` 로 이동 → 보내기 성공(또는 취소) 시 `history.back()` 으로 보던 화면으로.
- **쓸 수 없을 때**: Q mail 메뉴 권한 없음 / 연결된 메일 계정 없음 → `mailto:` 로 떨어진다(막다른 길 금지). 고객 역할 화면에는 작성 링크를 두지 않고 평문.
- `MailPage` 가 `?to=` 를 읽게 한다(받는사람 채움, 주소 모양 검사 — 아닌 값은 버림).

### 2-3. 프로젝트 > 고객 = Q sale 고객 추가와 같은 문
- 고객 탭의 «+ 새로 초대» 자리에 `ClientAddDrawer` 를 그대로 연다(초대 / 직접 관리 두 모드). 만든 고객 id 로 `POST /api/projects/:id/clients {client_id}` 연결.
- «기존 고객 연결» 셀렉트도 `client_id` 를 보낸다(지금 이름·이메일만 보내 계정 없는 고객이면 중복 행 위험 — 버그).
- 서버 `POST /:id/clients` 의 `client_id` 경로: 같은 워크스페이스·보관 아님 확인 → project_clients(client_id, contact_email=고객 이메일, contact_user_id=고객 user_id) 생성. 직접 관리 고객은 초대 메일을 보내지 않는다(외부 발송 없음). 계정 고객이면 기존처럼 프로젝트 고객 채널에 들인다(`linkClientToProjects` 와 같은 함수).
- 행 표시는 사람 카드 줄(`PersonRow`) — 이름·회사·직책·이메일 링크·상태 칩, 누르면 고객 패널.

### 2-4. 설정 > 구성원 에 고객 목록 (멤버처럼)
- 머리에 알약 탭 `[멤버 | 고객]`(공용 `segmentedToggle`). 고객 탭 = **Q sale 고객 목록 본체를 그대로 얹는다**(`SalePage` 고객 탭을 `ClientList` 로 빼서 둘이 같이 쓴다 — 목록 필터·검색·패널 동일). [+ 고객 추가] = `ClientAddDrawer`. 행 클릭 = `ClientPanel`(같은 URL 싱크 `?client=`).
- 권한: 고객 탭은 `qsale` read 이상만 보인다(서버는 이미 requireMenu('qsale')). 메뉴 이름 «구성원» → «구성원·고객» (ko/en).
- Q sale 은 그대로(영업 단계·상담 축). 데이터·패널·추가 문이 같은 것이라 어디서 고쳐도 같은 행 + `client:updated` 로 양쪽 목록 갱신.

### 2-5. 멤버 상세에 연결 프로젝트·업무·히스토리
- 새 읽기 API `GET /api/businesses/:biz/members/:userId/overview` → `{ projects[], tasks{ active[], done_recent[], counts }, history[] }`.
  - **보는 사람 기준**(대상 멤버의 것이 아니라): 프로젝트 = 대상이 참여(project_members) ∩ `access_scope.projectScopeWhere(보는 사람)` · 업무 = 대상이 담당 ∨ 요청 ∩ `taskListWhere(보는 사람)` · 히스토리 = 대상의 업무 상태 이력·담당 변경·프로젝트 참여(`task_status_history`·`project_members.created_at`) 중 보는 사람이 볼 수 있는 업무의 것만, 최근 50.
  - 멤버 이상만(고객 403). 단가·급여 없음. pagination 표준(업무 default 200).
- 화면: 멤버 드로어에 «연결 프로젝트» · «업무»(진행 중 / 최근 완료, 누르면 업무 상세 새 탭) · «히스토리» 절 — 고객 패널의 `ClientLinksSection`·타임라인 모양을 같이 쓰는 `PersonLinks`·`PersonTimeline`. 위험 영역은 맨 아래 그대로.
- 멤버 드로어를 `WorkspaceSettingsPage.tsx` 인라인에서 `components/People/MemberPanel.tsx` 로 뺀다(파일 1800줄 — 아바타 팝오버 «프로필» 도 이걸 연다).

### 2-6. 동기화
- 멤버 프로필 저장(`PUT /:biz/me/profile`·역할·부서) 뒤 `member:updated {user_id}` 를 business 방에 신호만 → 설정 목록·팝오버 캐시·멤버 패널 재조회.
- 고객은 기존 `client:new/updated` — 설정 고객 탭·Q sale·프로젝트 고객 탭·팝오버 캐시가 같이 듣는다.

## 3. 판정 받을 것
1. 새 «사람» 표 없이 화면 모양만 하나(2-1) — 맞나? `clients.job_title` 추가가 맞나(대안: billing_contact 처럼 JSON)?
2. 이메일 작성 새 창(2-2) — 데스크탑 팝아웃 페이지 vs 새 탭(`openInNewTab('/mail?compose=1&to=')`). 폰 «보내고 뒤로».
3. 프로젝트 고객 직접 입력(2-3) — 직접 관리 고객을 프로젝트에 붙일 때 project_clients 에 무엇을 채우나(contact_user_id NULL). 고객 화면·가시성(`contact_user_id = 나`)에 영향 없음 확인.
4. 설정 > 구성원 고객 탭(2-4) — Q sale 목록 본체 공유 + 메뉴 이름. 10-16 «고객 화면은 Q sale 하나» 판정과 충돌하나(같은 컴포넌트를 얹는 것이라 «두 벌» 은 아님).
5. 멤버 overview(2-5) — 보는 사람 기준 술어가 맞나 · 히스토리 범위(활동 로그 `audit_logs` 를 owner/admin 에게만 더 보일지).
6. `CLIENT_MEMBER_EMAIL_MATCH_DESIGN.md`(이메일 일치 전환)를 이번에 같이 할지.

## 4. 검증 계획(판정 뒤)
- 서버: overview — member1 이 보는 owner 의 업무에 L1(나만 보기) 업무가 안 나옴 · 숨겨진 프로젝트(visibility members, 비참여) 안 나옴 · 고객 403 · 다른 ws 403.
- 프로젝트 고객 직접 입력 → clients managed 1행 + project_clients 1행(client_id) · 메일 0통(email_logs) · 기존 고객 연결이 새 행을 안 만듦(전후 clients 수).
- `clients.job_title` 저장 → Q sale·설정 고객 탭·프로젝트 고객 탭·팝오버 같은 값(재조회).
- 화면 3폭: 설정 [멤버|고객] · 멤버 드로어 세 절 보임 · 이메일 링크 → 데스크탑 새 창에 받는사람 채워짐 / 폰 보내고 뒤로(원래 경로) · 권한 없으면 mailto.
- 실시간: 두 브라우저 — Q sale 에서 고객 직책 수정 → 설정 고객 탭 ≤1초.
- 가드 전체 · health-check · npm run build · e2e tenant.
