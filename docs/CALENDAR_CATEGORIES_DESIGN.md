# 일정 분류 커스텀 — 설계 (2026-11-27 · Fable design 판정 · 방 dd0e68e9)

Irene: «일정 등록할 때 분류를 커스텀할 수 있게 해줘. 직접 넣고 삭제 바꾸고 다 되게.»
정찰 계획: `.claude/plans/qmwyojgsb.md` · 선례: 휴가 종류(`docs/LEAVE_TYPES_DESIGN.md`)

## 1. 데이터 — 새 표 + category_id, 옛 ENUM 은 거울
- `calendar_categories`: id · business_id · code(시스템 5개만, 커스텀 NULL) · name(시스템 NULL = i18n 라벨, 커스텀 필수, 30자) · color(#RRGGBB, 시스템 NULL = 기존 팔레트) · is_active · sort_order · created_by · timestamps.
  UNIQUE(business_id, code) · INDEX(business_id, is_active, sort_order). 이름 중복은 서비스(NFC·trim·소문자, 시스템 ko/en 라벨 포함) → 409 name_taken.
- `calendar_events.category_id` NULL · FK RESTRICT · INDEX(business_id, category_id).
- 옛 `category` ENUM 은 지우지 않는다. 쓰기 때 같이 적는다: 시스템 = code, 커스텀 = 'other'.
- 읽기: category_id 있으면 그 행, NULL 이면 같은 business 의 code = category 행(안 고친 쓰기 경로 폴백).
- 씨앗: 지연 ensureDefaults + 운영 마이그레이션(전 워크스페이스 씨앗 + 백필). 둘 다 멱등.
- 기각: ENUM→VARCHAR(이름 바꾸기·삭제 정합이 문자열 키에 걸리고 ENUM ALTER 롤백 불가).

## 2. 범위 = 워크스페이스 공용 (개인 분류 없음)

## 3. 권한
읽기 멤버 전원(고객 403) · 추가 멤버 누구나 · 이름·색·켜고 끄기·순서·삭제 owner/admin(서비스 canManage 한 곳).
한도: 커스텀 30개(409 limit_reached), 이름 30자.

## 4. 삭제·비활성
- 커스텀 삭제 = 진짜 삭제. 한 트랜잭션에서 그 분류 일정을 «기타»(code other)로 옮기고 지운다. 응답 {moved:n}.
- 시스템 5개: 삭제 불가(409 system_category) · 이름(빈 값 = 기본 라벨)·색·끄기 가능. other 는 끌 수 없음(409 other_locked).
- 꺼진 분류: 기존 일정 라벨·색 그대로, 선택 칩에서만 빠짐(상세에선 현재 값이면 보임). 새로 고르면 400 category_inactive(현재 값 유지는 통과).
- 예약은 meeting 이 꺼져 있어도 meeting. 새 일정 기본 = work 활성이면 work, 아니면 첫 활성.

## 5. 색 — 고정 스와치 10색 중 하나. 우선순위 event.color > project.color > 분류 색(NULL 이면 code 팔레트).

## 6. API
- `routes/business_calendar_categories.js` `/api/businesses/:businessId/calendar-categories`: GET(멤버, ?include_inactive=1&with_usage=1) · POST {name,color?}(멤버) · PUT /order {ids} · PUT /:id {name?,color?,is_active?} · DELETE /:id (관리자). 남의 ws id → 404.
- 문 하나 `services/calendarCategories.js`: ensureDefaults · list · resolveInput · resolveByCode · resolveByName · attachCategory · CRUD · 감사 · 방송 `calendar_category:updated {business_id}`.
- 일정 입력: category_id(우선) 또는 category code. 응답: category(거울) + category_id + category_ref{id,code,name,color,is_active} — attachCategory 가 business 당 조회 1회.
- booking = resolveByCode('meeting') · 내보내기 category_name 칸 추가 · 공개 공유 = category + category_name + category_color 만.

## 7. AI 에이전트 — 표면 넓히지 않음
create_event/update_event category = 문자열(시스템 code 또는 분류 이름, 대소문자·NFC 무시, 시스템 ko/en 라벨 포함). id 안 받음.
모르는 이름·꺼진 분류 = 거절 + 쓸 수 있는 이름 목록. scope·risk·확인 단계 그대로. 분류 만들기/지우기 도구 없음.
list_events·미리보기는 표시명. get_context 에 event_categories(schedule scope 있을 때).

## 8. 화면
- `CategoryPicker.tsx` 칩 + «＋ 분류»(인라인 입력 + 스와치, Enter 저장 → 바로 선택). 관리자에게만 ⚙ «분류 관리».
- `CategoryManager.tsx` 행마다 색·이름·켜고 끄기·▲▼·삭제(커스텀)·쓰임 건수. 데스크탑 모달, 폰 전체 폭.
- 훅 `useCalendarCategories` 소켓 신호로 다시 받음. NewEventModal·EventDrawer 는 Picker 로 교체. 설정 화면 섹션 없음.
- 삭제 확인 ConfirmDialog: «“{{name}}” 분류를 삭제할까요? 이 분류의 일정 {{count}}건은 “기타”로 옮겨집니다. 되돌릴 수 없습니다.»

## 검증(★ = Fable 완료 검증 게이트)
1★ 마이그레이션 2회 멱등·백필 뒤 NULL 0·code별 건수 보존·옛 category 변화 0 · 2★ 테넌트 격리 · 3★ 권한 · 4★ 삭제 옮김·롤백·시스템 409·other 끄기 409 · 5 이름 반영·중복·한도 · 6 꺼진 분류 · 7★ 에이전트 해석·거절·scope 불변 · 8★ 공개 직렬화 3칸 · 9 회귀(bookingapi·deadline·분리 복제·옛 payload) · 10 화면 3폭 · 11 가드.
