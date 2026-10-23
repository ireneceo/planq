# 멤버 권한 보완 — 알림 받는 사람 · 역할별 기본값 · 멤버 상세 권한 (2026-10-23, [Opus] 설계 → Fable OK-WITH-CHANGES → 구현)

> Irene: *"권한 설정에서 빠진 부분들이 있는 것 같아. 서명 받았다 등은 어느 권한에서 나와? 그냥 멤버인데 알림이 온대.
> 그리고 기본 디폴트가 관리자냐 아니냐에 따라 달라야 하지 않아? 그리고 멤버 권한은 멤버 상세에도 나오게 하거나
> 멤버 설정에도 나와서 동기화하거나 어떻게 더 보기 쉬운 ui로 보완 가능해?"*

## 0. 사실 (dev 실측 · 코드)

### 0-1. 서명 알림은 «어느 권한에도» 묶여 있지 않다
- `services/signatureCore.notifyWorkspaceMembersOnSignature` — 받는 사람 = **워크스페이스 활성 멤버 전원**(owner·admin·member).
  메뉴 권한(qdocs)·문서 읽기 판정(`postAccess.canReadPost`)·요청자 여부를 보지 않는다. 본문에 **문서 제목**이 실린다.
- 끌 수 있는 곳은 개인 알림 설정의 `signature` 한 줄뿐(기본 ON).
- dev 원장: 일반 멤버에게 간 서명 알림 768건. 문서가 남아 있는 187건 중 **4건은 그 멤버가 읽을 수 없는 문서**(L1 등) — 제목이 샜다.
- 같은 모양(활성 멤버 전원 fan-out, 메뉴 권한 무시)이 청구 쪽에 4곳 더 있다:
  - `routes/invoices.js` 증빙 신청 도착(무인증 고객 제출) · 세금계산서 발행 마킹 — `tax_invoice`
  - `services/recurring_invoice.js` 정기 청구 초안 검토 · `services/clientSubscriptionBilling.js` 구독 청구 초안 검토 — `invoice`
  - 이미 좁힌 선례: `services/billingRecipients.resolveBillingRecipients`(owner/admin + 청구서 담당 + 기본 청구 담당) — 송금 알림·연체가 쓴다.
    주석: *"권한 없는 일반 멤버에게 알리면 눌러도 403 — 알림이 곧 막다른 길"*.

### 0-2. «기본값» 은 역할과 상관없이 전부 «쓰기» 하나다
- `requireMenu`: owner/admin = 전권, member = 행 없음 → **write**(열린 문화). 새 멤버는 모든 메뉴(Q bill 포함) 쓰기로 들어온다.
- 워크스페이스가 «멤버는 기본 이 정도» 를 정할 곳이 없다 — 사람마다 표에서 한 칸씩 바꿔야 한다. dev 권한 행은 전체 4건(사실상 안 쓰임).
- **표가 거짓을 말하는 곳 2개**: `getMemberMenuLevels` 가 행 없는 메뉴를 전부 `write` 로 내보낸다.
  - `weekly_team` 은 서버(`weekly_reviews.js`)가 행 없음 = **none** 으로 막는데 표에는 «쓰기» 로 보인다.
  - `insights` 는 조회 전용(read/none)인데 표 값은 «write» — 고를 수 없는 값이 칸에 앉아 있다.

### 0-3. 멤버 상세와 권한 표가 따로 논다 — 같은 «관리자» 가 서로 다른 역할이다
- 권한 표(설정 > 권한): 역할 `member ↔ admin`(PUT `/members/:userId/role`, owner·admin 이 바꿈) + 메뉴 12칸.
- 멤버 상세(설정 > 멤버 › 상세 › Danger Zone): 역할 셀렉트 옵션이 «멤버 / **관리자**» 인데 «관리자» 의 값은 **`owner`**
  (PATCH `/:id/members/:memberId/role`, owner ↔ member). → 상세에서 «관리자» 를 고르면 **소유자 권한**(재무·삭제·소유자 전용)이 확인 없이 붙는다.
  대상이 `admin` 이면 셀렉트가 빈 칸이다. 메뉴 권한은 상세에 한 줄도 없다.

## 1. 제안

### D1. 알림 받는 사람 = «그 알림을 눌러 할 수 있는 사람» — 사건별 받는 사람 함수 한 곳
- 서명(`signature`): **요청자 + 문서 작성자 + owner/admin**, 각자 `canReadPost` 통과자만, 그리고 qdocs 가 `none` 이면 뺀다.
  (일반 멤버는 관련자일 때만 — 요청자·작성자.) 앱 안 직접 서명자 제외(opts.excludeUserId)는 그대로.
- 청구 4곳(`tax_invoice`·`invoice` 초안 검토): `resolveBillingRecipients` 를 쓴다(이미 송금·연체가 쓰는 한 벌).
- 받는 사람 판정은 `services/notifyAudience.js`(신설) 한 곳: `signatureAudience(sr)` · 청구는 기존 함수 재사용.
  최종 단계에서 공통 필터 `dropMenuNone(userIds, businessId, menu)` — 메뉴가 `none` 인 멤버는 그 메뉴 알림을 받지 않는다.

### D2. 역할별 기본값 — «멤버 기본 권한» 을 워크스페이스가 정한다
- `businesses.permissions.member_defaults = { qbill: 'none', ... }`(새 컬럼 없음 — permissions JSON 칸). 없으면 지금과 같은 값
  (전 메뉴 write · insights read · weekly_team none) — 기존 워크스페이스 동작 불변.
- 판정: member 의 메뉴 수준 = **개인 행 > 워크스페이스 기본값 > 시스템 기본값**. owner/admin 은 그대로 전권.
  `requireMenu` 와 `getMemberMenuLevels` 가 같은 함수(`resolveMemberLevel`)를 쓴다 — 두 벌이던 «행 없음 = write» 를 한 곳으로.
  weekly_team 의 «행 없음 = none» 도 이 시스템 기본값 표로 옮긴다(weekly_reviews.js 는 그 함수를 부른다).
- 화면: 설정 > 권한 표 맨 위에 «새 멤버·따로 정하지 않은 멤버의 기본값» 한 줄(같은 칸 모양). 칸마다 «기본값» / «따로 정함» 표시,
  따로 정한 칸에는 «기본값으로 되돌리기»(행 삭제). 바꾸면 행 없는 멤버 전원에게 즉시 적용 — 화면 문구가 그렇게 말한다.
- 권장 시작값은 바꾸지 않는다(열린 문화 유지) — 원하는 워크스페이스가 Q bill 등을 «없음» 으로 내리게.

### D3. 멤버 상세에 «권한» 절 — 표와 같은 판정·같은 API·같은 칸
- 상세 본문에 «권한» 절: 역할(멤버 / 관리자 / 소유자 표시) + 메뉴 12칸(그 멤버 한 줄). 표의 한 줄을 그리는 칸 모양을
  공용 조각(`MemberMenuLevelRow`)으로 빼서 표와 상세가 같이 쓴다. 저장 API·감사·`permissions:updated` 그대로.
- 동기화: 저장하면 같은 창 안에서 `permissions:changed` 신호(window) — 표·상세가 다시 읽는다. 다른 사람 창은 기존 소켓.
- 상세의 역할 셀렉트 수리: 옵션 = 멤버 / 관리자(`admin`, PUT role) — 표와 같은 문·같은 확인창.
  소유자 임명(공동 소유)은 상세에서 빼고 «소유권 이전» 버튼만 남긴다(소유자만, 확인창 있음).
  → 옛 «관리자 = owner» 오표기·확인 없는 소유자 임명이 사라진다.
- 볼 수 있는 사람: 상세의 권한 절은 owner·admin 은 고치고, 본인은 자기 권한을 읽기로 본다. 다른 일반 멤버의 권한은 안 보인다.

## 1-F. Fable 설계 판정 반영 (OK-WITH-CHANGES)
- D1: 프로젝트 PM·멤버는 넣지 않는다. `dropMenuNone` 은 getMemberMenuLevels 를 써서 owner/admin 자동 통과.
  청구 fan-out 은 4곳 + 같은 계열 2곳(증빙 발행 완료·정정 발행 알림, `tax_invoice`)까지 `resolveBillingRecipients` 로.
  `resolveBillingRecipients` 끝에 `dropMenuNone(qbill)`(담당으로 지정된 뒤 Q bill 이 숨김이 된 사람 제외).
  안 바꾼 fan-out(이유): projects.js·tasks.js·conversations.js·invoiceDelivery = 참여자·담당자 대상(이미 관련자) ·
  payrollTransition = payrollAccess 가 좁힌다 · saleNotify = 고객 담당 → owner/admin.
- D2: 즉시 적용(live) · 시작값 전 메뉴 write 유지 · 판정 `menu_permission.resolveMemberLevels` 한 곳
  (requireMenu·getMemberMenuLevels·주간보고·청구 담당 후보 2곳) · `|| 'write'` 폴백 제거 + 가드 `--category=menudefault` ·
  기본값 PUT 은 일반 멤버 전원 개인 방에 `permissions:updated`. 라우트는 `routes/member_permissions.js`(businesses.js 에서 옮김).
- D3: 상세의 소유자 임명 방향은 없애고, 오너가 공동 오너를 «멤버로» 내리는 길은 남김(PATCH 그대로). 역할 글자 오너/관리자/멤버 통일
  (`members.roleOwner` 신설, admin 배지 색 추가, 프런트 타입에 admin 추가).

## 1-G. 후속 (2026-10-23) — 알림 전반으로 넓힘
- Irene: *"멤버 기본 권한이 없는 곳들의 워크스페이스 알림은 각 권한에 맞게 제한해야 해. 되고 있어?"* → 서명·청구 말고는 안 되고 있었다
  (회사 메일함 알림 = 멤버 전원, 업무·일정·채팅·문서 댓글·설문·Q sale 담당도 메뉴 무시).
- `services/notifyMenuGate` — `notify()` 한 곳에서 **알림 링크가 여는 화면의 메뉴**(navMenus permKeyForPath 와 같은 표)가 그 사람에게 `none` 이면
  모든 채널 생략(`skipped menu_none:<menu>`). 개인 칸·워크스페이스 기본값 둘 다(같은 getMemberMenuLevels). owner/admin·고객·메뉴 밖 화면(프로젝트·서명 링크·근태·급여)은 그대로. 판정 실패 = 막음.
- Fable 완료 PASS. 남김(비차단): notifyMany 에서 기본값 한 번 구해 넘기기 · PATH_MENUS ⊂ navMenus 가드 · notifications.js 정확히 500줄(다음 추가 전 notify 분리) ·
  qtalk·qnote·qdocs·qinfo·qfile 은 서버 requireMenu 0 — 숨김이 화면에서만 막힌다(별건).

## 2. 하지 않는 것
- 알림 개인 설정 화면의 기본 ON/OFF 를 역할별로 갈라 놓기(D1 로 받는 사람이 좁아지면 필요 없다).
- 운영 데이터 백필 — 새 컬럼·행 없음. 기본값 없음 = 지금 동작.
- 이미 저장된 옛 알림은 소급하지 않는다.

## 3. 검증 계획
- 서명 알림: 일반 멤버(비관련) 0건 · 요청자 1 · 작성자 1 · owner 1 · L1 문서면 못 읽는 owner/admin 0 · qdocs none 멤버 0 (양성 대조: 옛 함수로 되돌리면 비관련 멤버가 받는다).
- 청구 4곳: 받는 사람 = resolveBillingRecipients 집합.
- 기본값: 기본값 qbill none → 행 없는 멤버 GET /api/invoices 403 · 행 write 인 멤버 200 · admin 200 · 표/상세가 «기본값» 표시 ·
  weekly_team 표 값 = none(서버 판정과 같음) · insights 표 값 = read.
- 상세: 3폭에서 권한 절 보임 · 상세에서 바꾸면 표가 같은 값 · 역할 셀렉트에 owner 값 없음.
