# 화상 업무설계·사용안내 신청 설계 (ONBOARDING_CALL_DESIGN) — 초안

> 2026-10-21 · [Opus] 초안 → Fable 설계 판정 대기. 구현 0.

## 0. Irene 원문
> *"화상으로 업무설계 간략히 받고 사용안내를 최적안내 받게 신청하는 거 넣자. 랜딩페이지랑 가입 후 테스트상태에 있는 고객에게 할까?"*

## 1. 사실 (조사)
- PlanQ 플랫폼 문의 원장은 **`contact_inquiries` 하나** — 랜딩 `/contact`(kind landing·enterprise)·자가진단(diagnosis)이 같이 쓴다.
  무인증 `POST /api/inquiries`(IP 시간·일 한도) → 접수 확인 메일(같은 주소 24시간 1통) + platform_admin 알림 → `/admin/inquiries` 에서 상태·메모 관리.
  토큰이 있으면 계정을 붙이고, 화면이 보낸 `business_id` 는 **멤버십일 때만** 적는다.
- 워크스페이스 «상담 예약»(`services/booking.js`, 슬롯·Meet·.ics)은 **워크스페이스 → 그 고객** 의 것이다. 확인된 게스트 개인 링크에서만 열린다.
  CLIENT_ENTRY_DESIGN §3-D3: 플랫폼 원장과 워크스페이스 원장은 섞지 않는다(랜딩은 PlanQ 의 것).
- 체험 상태: `/api/plan/:biz/status` 의 `in_trial`·`trial_ends_at`. 대시보드 `TrialStatusBanner`(체험 중 오너에게 카드).
- `VALID_KINDS = ['enterprise','general','landing']` — diagnosis 는 자가진단 라우트가 따로 만든다.

## 2. 제안 (A안 — 문의 원장에 «신청 종류» 하나를 더한다)
### 2-1 원장
- `contact_inquiries.kind` ENUM 끝에 **`onboarding`** append. 새 표 없음.
- 신청 내용(희망 시간·인원·지금 쓰는 도구·먼저 맞추고 싶은 일)은 **새 JSON 칸 `details`**(nullable) — 관리자 화면이 구조로 보여 줄 수 있게.
  자유 서술은 `message`(필수 아님 → onboarding 은 비어도 됨, 서버가 요약 줄로 채움).
- 희망 시간: 최대 3개, 각 `{date:'YYYY-MM-DD', part:'morning'|'afternoon'|'evening'}` + 신청자 시간대(`from_user_timezone` — 비로그인은 브라우저 값, IANA 형식 검사).
  정확한 시각 슬롯·자동 확정은 하지 않는다(PlanQ 운영자 달력과 연결된 엔진이 없다 — 3절).
- 운영: `scripts/migrate-onboarding-inquiry.js`(멱등, ENUM append + 칸 추가, 배포 슬롯 · 코드보다 먼저).

### 2-2 신청 문 (둘, 같은 라우트)
| 자리 | 누가 | 화면 |
|---|---|---|
| 랜딩 | 비로그인 | `/contact?type=onboarding` 모드(견적 모드처럼 같은 폼의 모드) + 홈·요금제의 보조 버튼 «화상으로 안내받기» |
| 앱 | **체험 중 워크스페이스의 오너·관리자** | 대시보드 체험 카드 아래 한 줄 카드 «화상으로 업무 설계·사용 안내 받기 (30분)» → 우측 `CreateDrawer` 폼(이름·이메일·워크스페이스는 계정에서 채움) |
- 서버 `POST /api/inquiries` 가 `kind:'onboarding'` 을 받는다 — 판정은 한 함수 `onboardingRequest.normalize(body)`(희망 시간 검증·길이 캡).
- 앱 카드 노출 판정은 서버: `/status.onboarding_call = { available, requested_at }`
  — available = in_trial ∧ 오너/관리자 ∧ 이 워크스페이스에 열린(new·in_progress) onboarding 신청 0건. 신청했으면 «신청됨 · 메일로 시간 안내드려요» 로 바뀐다.
  카드 닫기(×)는 사람별 로컬 기억(권한 아님).
- 같은 워크스페이스 열린 신청이 있으면 서버가 409 `already_requested`(중복 신청 막기). 비로그인은 IP 한도 + 같은 이메일 열린 신청 있으면 같은 응답(새 행 안 만듦, 존재 여부를 말하지 않게 201 동일 응답).

### 2-3 받는 쪽 (플랫폼 관리자)
- 알림 제목 `[화상 안내 신청] #id — 이름`, 본문에 희망 시간(신청자 시간대 + 관리자 시간대 둘 다).
- `/admin/inquiries` 종류 필터에 «화상 안내» · 상세에 details 표(희망 시간·인원·도구·하고 싶은 일·워크스페이스·체험 남은 날).
- 확정·회의 링크는 관리자가 메일로 직접(지금 답변 흐름 그대로). 상태 new → in_progress(시간 정함) → resolved(진행함).

### 2-4 신청자에게 가는 메일
- 기존 `sendInquiryReceivedEmail` 의 onboarding 문구판(«희망 시간 확인 후 1영업일 안에 회의 링크를 보내드려요») · ko/en · 24시간 1통 규칙 그대로.

## 3. 택하지 않은 것
- **B안: PlanQ 운영 워크스페이스의 상담 예약 엔진에 연결**(슬롯 자동·Meet 자동) — 무인증 공개 슬롯 표면이 새로 생기고(지금은 확인된 개인 링크만), 플랫폼 문의가 한 워크스페이스 원장(고객·영업 단계)에 섞인다(§3-D3 위반). 신청량을 본 뒤 2단계로.
- 외부 예약 도구(캘린들리 등) 링크 — 원장이 밖으로 나가고 체험 워크스페이스와 연결이 끊긴다.

## 4. 범위 밖
- 유료 전환 뒤 워크스페이스 · 팀원(멤버)·고객 역할 · 네이티브 앱 결제 규정과 무관(구매 유도 아님 — 앱에서도 보인다).

## 5. 검증 계획
- 실HTTP: 비로그인 신청 201 · 희망 시간 4개/잘못된 날짜/과거 날짜 400 · 로그인 오너 신청 → business_id 붙음 · 같은 워크스페이스 두 번째 409 · 남의 business_id 실으면 비움 · 멤버 신청은 business_id 붙지만 /status available false(멤버) · 응답에 내부 칸 없음.
- /status.onboarding_call 전후 · 관리자 목록 필터·상세.
- 화면 1440·834·390: 랜딩 폼 모드·앱 카드·드로어·제출 후 «신청됨».
- 가드 i18n·parity·secrets · build.
