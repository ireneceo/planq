---
paths:
  - "dev-backend/routes/calendar*.js"
  - "dev-backend/routes/booking_admin.js"
  - "dev-backend/routes/guest_booking.js"
  - "dev-backend/routes/personal_calendar.js"
  - "dev-backend/routes/customer_entry.js"
  - "dev-backend/services/booking.js"
  - "dev-backend/services/calendar*"
  - "dev-backend/services/event*"
  - "dev-backend/services/actions/event_actions.js"
  - "dev-frontend/src/pages/QCalendar/**"
  - "dev-frontend/src/components/Calendar/**"
  - "dev-frontend/src/pages/ClientHome/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 캘린더·상담 예약

**상담 예약 (2026-09-25, 고객 창구 P2):** `calendar_events.booking_status` ENUM('requested','proposed','confirmed','declined','canceled') **NULL**
(NULL = 보통 일정 · 끝남은 값이 아니라 `confirmed && end_at < now` 파생). 새 표 없음 — 설정은 `permissions.customer_entry.booking`,
받는 시간은 `businesses.work_hours`(모양 `{mon:[9,18],…,sat:null}` — `services/booking.js serializeWorkHours` 한 곳이 정하고 PUT /settings 가 400 으로 막는다).
- **상태를 바꾸는 문은 `services/booking.js` 하나다** — 감사·실시간·팀 알림·고객 메일(.ics)·영업 단계가 전이 함수 안에 있다.
  일반 일정 수정(PUT)은 예약의 시간·참석자·공개범위를, 삭제는 살아 있는 예약을 **409 `booking_use_actions`** 로 막는다.
- **고객은 일정을 «만들지» 않는다** — 신청은 `created_by = 담당 멤버`(고객 담당 → 설정 담당 → 오너) · vlevel L1 행이다.
  Meet 은 담당 멤버 **본인** 구글 연동으로만(워크스페이스 토큰 = 오너 캘린더에 고객 이름이 올라간다).
- 무인증 표면 `routes/guest_booking.js` — **창구의 확인된 개인 링크만**(공유 링크 403). 슬롯 응답은 시각 배열·길이·시간대뿐.
- 한 건 = 한 버킷: 신청은 확인필요 `type:'booking'`(담당 멤버)만 센다 — `collectEvents`·saleBucket ①③ 에서 뺀다.
- 확인창의 받는 주소와 실제 발송 주소는 **같은 함수**(`recipientLinkOf`). 운영: `migrate-calendar-booking-status.js`(멱등, 배포 슬롯 등록).
- **신원은 둘, 함수는 하나** — 게스트 링크 방문자(`guestActor`)와 로그인 고객(`accountActor`, Client.user_id = 나, P3 `/home`)이
  같은 전이 함수를 부른다. «내 문의» 축은 client_id 라 어느 입구로 신청했든 같은 건이 보인다. 받는 사람은 `recipientOf`
  (확인된 창구 링크 → 없으면 계정 이메일). 계정 고객 앱 알림은 `skipChannels:['email']` — `notify()` 는 기본으로 메일까지 태워 **두 통**이 됐다.
- 회귀: `--suite bookingapi`(서버) · `--suite booking`(화면 3폭) · `--suite clienthome`(로그인 고객 홈).

> **캘린더 «누가 보나» 는 `attendedEventIds` 한 원천이다 (2026-09-21).** 초대받은 참석자는 공개 범위와 무관하게 본다.
> 목록(`calendarListWhere`)·상세·RSVP·확인필요가 같은 함수를 쓴다. 고객 참석자는 **`client_id` 로 저장**되므로
> `user_id` 로만 찾으면 영영 안 보인다(실제로 그랬다). ★ `sequelize.literal` 안의 컬럼은 **표 이름을 붙인다** —
> include 가 늘면(9/17 File·Post JOIN) 같은 이름 컬럼이 생겨 `ambiguous` 500 이 된다. owner/admin 은 다른 분기라
> 멀쩡해 보여서 멤버 전원이 4일간 캘린더를 못 열었다.
>

**일정 분류는 워크스페이스가 만든다 (2026-11-27, Irene «일정 등록할 때 분류를 커스텀 … 직접 넣고 삭제 바꾸고 다 되게» · Fable 설계 `docs/CALENDAR_CATEGORIES_DESIGN.md`)** —
정본 `calendar_events.category_id` → `calendar_categories`. 옛 `category` ENUM 은 거울(시스템 code / 커스텀 'other') — 롤백·옛 번들 호환이라 지우지 않는다.
- **분류를 해석·검사하는 문은 `services/calendarCategories` 하나** — 화면 POST/PUT·반복 분리·행동 계층(`event_actions`)·예약(`resolveByCode('meeting')`)·AI 도구·내보내기·공개 공유가 같은 함수. `CATEGORY_SET` 같은 고정 목록을 다시 두지 않는다.
- 응답 일정에는 `category_ref {id,code,name,color,is_active}` 를 `attachCategory` 가 붙인다(business 당 1회 조회, JOIN 안 함). 라벨은 화면 `calendarCategories.categoryLabel`(이름 → 없으면 기본 번역), 색은 `getEventColors`(일정 색 > 프로젝트 색 > 분류 색 > 기본 팔레트).
- 권한: 추가 = 멤버 누구나 · 이름·색·켜고 끄기·순서·삭제 = 대표/관리자(`canManage`) · 고객 403. 기본 5개는 삭제 불가(끄기만) · «기타» 는 끌 수도 없다. 커스텀 삭제 = 그 일정들을 «기타» 로 옮기고 지운다(한 트랜잭션).
- 꺼진 분류는 새로 고를 수 없다(400 `category_inactive`) — 지금 값 유지는 통과. AI 도구 `category` = 이름 또는 code(모르는 이름·꺼진 분류는 거절 + `available_categories`), 분류를 만들거나 지우는 도구는 없다.
- 화면: `QCalendar/CategoryPicker`(새 일정 창·상세 같이 · «＋ 분류» · 대표에게 «관리») + `CategoryManager`(공용 `DictManageModal`). 실시간 `calendar_category:updated`(신호만).
