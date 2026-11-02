# 여러 계정 로그인·전환·알림 설계 (Fable 설계 판정 DESIGN-REVISE → 6건 반영 · 2026-11-02)

> Irene 2026-11-02: *"인스타처럼 멀티로그인하고 바꿔가면서 사용하고 알림도 아이디들 다 받을 수 있을가? 회사계정이랑 개인계정 있는데 왔다갔다하기 불편해서. Fable 검토 하자"*
> 작성 [Opus] 방 d5609fe9. 상태: **Fable 설계 판정 반영 완료 · Irene 승인 대기 — 구현 0줄.** 아래 2~5절과 7절이 다르면 **7절이 정본**.

## 0. 지금 있는 것 (실측 · 코드 근거)

| 영역 | 지금 | 근거 |
|---|---|---|
| 로그인 유지 | 기기(브라우저·앱 WebView)당 **refresh 쿠키 1개** `refresh_token`(HttpOnly · path `/api/auth` · Lax). 새로 로그인하면 덮어씀 | `routes/auth.js` 458·537 · `/refresh` 623 |
| 접속 토큰 | 창마다 메모리 변수 1개 `accessToken` | `contexts/AuthContext.tsx` 139 |
| 한 계정 · 여러 워크스페이스 | **이미 됨** — 전환(`active_business_id` 정본) · 다른 워크스페이스 도착 카드(9aee3ecd) · 푸시는 사람 단위라 모든 워크스페이스 것이 옴 | rules/workspace.md 7 |
| 푸시 구독 | `push_subscriptions.endpoint` **전역 UNIQUE** — 같은 기기에 다른 사람이 로그인하면 앞 사람 구독을 만료(기기 양도 처리) | `routes/push.js` 135~165 · 178~220 |
| 푸시 발송 | `sendPushToUser(userId)` = 그 사람의 살아 있는 구독 전부 | `services/push_service.js` 99 |
| 알림 클릭 | `sw.js` 가 `data.link` 로 이동 — **누구에게 온 알림인지 모른다** | `public/sw.js` 229 |
| 실시간 | 소켓 1개(창당) · 접속 토큰으로 인증 · `user:N` 방 | `services/socket.ts` 40 |
| refresh 쿠키 경로 | path `/api/auth` → **`/api/push/*` 에는 안 온다**(이번 FAIL 의 뿌리) · 이미지 쿠키 `pq_img` 는 `setRefreshCookies` 가 그 행의 사람으로 매번 다시 발급 | `services/authTokens.js` 137~144 |
| 화면 저장소 | 초안 키에 user id 포함(`planq:draft:{kind}:{uid}:…`) · 탭 키는 **워크스페이스 id 만**(`planq_tabs_v1::b5`) · 그 밖 `qmail_account` 등 사람 구분 없음 | `services/draftStore.ts` 39 · `stores/tabStore.ts` 61 |

**결론**: 회사·개인이 «워크스페이스 둘» 이면 지금도 한 계정으로 된다. **«이메일이 다른 계정 둘»** 이면 지금은 로그아웃 → 다시 로그인이고, 같은 기기에서 두 번째 계정으로 로그인하는 순간 **첫 계정 푸시가 끊긴다**(endpoint UNIQUE). 이것이 이 기능이 고칠 것이다.

## 1. 먼저 가를 것 — 두 계정을 정말 따로 둬야 하나 (D0)

| 안 | 무엇 | 장점 | 단점 |
|---|---|---|---|
| **0. 한 계정으로 합치기** | 개인 계정을 회사 워크스페이스에 멤버로(또는 반대로) — 기존 기능 | 개발 0 · 이미 알림·전환 됨 | 회사 쪽이 «회사 메일 계정» 을 요구하면 안 됨 · 퇴사 시 개인 계정에 회사 이력이 남음 · 로그인 이메일이 하나 |
| **A. 기기에 계정 여러 개(인스타식)** | 아래 2~6절 | 계정은 그대로 분리 · 탭 두 번으로 전환 · 알림 다 받음 | 인증·푸시 구조 변경(되돌리기 어려움 영역) |

→ Irene 원문(«회사계정이랑 개인계정 … 왔다갔다 불편»)은 **A** 를 말한다. 0 은 보고에 «지금도 되는 길» 로만 안내.

## 2. 로그인 묶음 — 기기에 계정 여러 개 (A 안 핵심)

### 2.1 쿠키
- 계정마다 refresh 쿠키 하나: **`rt_<userId>`** (HttpOnly · Secure · Lax · path `/api/auth` · 각자 TTL·회전·수령 확인 치유 그대로).
- 옛 `refresh_token` 은 «첫 계정» 으로 읽어 들여 `rt_<id>` 로 옮긴다(배포 직후 모두 로그아웃되지 않게). 옮긴 뒤 옛 쿠키 지움.
- 기기에 **최대 5계정**(쿠키 크기 · 남용). 넘으면 400 `account_limit`.
- **계정 목록 자체는 쿠키 이름이 정본**이다 — 화면 localStorage 에 목록을 따로 두지 않는다(갈라지면 «있는데 안 보이는» 계정이 생김). 화면은 서버에 묻는다.

### 2.2 API (전부 `/api/auth/*` — 쿠키 경로 안)
| 경로 | 하는 일 |
|---|---|
| `GET /api/auth/device-accounts` | 요청에 붙은 `rt_*` 쿠키를 **하나씩 검증만**(회전·발급 없음) → `[{user_id, name, email(가림), avatar, valid, unread_total}]`. 만료·폐기된 것은 `valid:false`(«다시 로그인») |
| `POST /api/auth/login?add=1` (+ 구글·애플 콜백 `add`) | 기존 쿠키는 그대로 두고 새 계정 쿠키만 더함. 이미 있는 계정이면 덮어씀 |
| `POST /api/auth/refresh` `{user_id}` | 그 계정 쿠키로 회전·접속 토큰. user_id 없으면 «마지막 계정» (옛 화면 호환) |
| `POST /api/auth/logout` `{user_id \| all}` | 그 계정 쿠키·refresh 행 폐기 + **이 기기의 그 계정 푸시 구독 삭제**. all = 기기 전체 |

- 「마지막으로 쓴 계정」 = 쿠키 `rt_last=<userId>`(HttpOnly 아님 · 값은 id 뿐) — 새 창·앱 재실행 때 어느 계정으로 뜰지.
- 비밀번호 재설정·정지·탈퇴 → 그 계정 refresh 전부 폐기(기존) → 다음 `device-accounts` 에서 `valid:false`. **다른 계정은 영향 없음.**
- 플랫폼 관리자 대리 로그인(impersonate)·게스트·AI 사용자는 묶음에 못 들어간다.

### 2.3 전환은 «기기 전체» 가 따라간다 (D1)
- **한 기기 = 지금 쓰는 계정 하나.** 전환하면 그 기기의 모든 창이 따라간다(워크스페이스 전환 `WorkspaceSyncGuard` 와 같은 방식 — BroadcastChannel/storage 신호 → 각 창 다시 부팅).
- 전환 = 접속 토큰 교체가 아니라 **앱 다시 부팅**(화면 상태·캐시·소켓을 다 버림). 이유: 화면 곳곳의 메모리 상태가 «사람 하나» 를 전제로 한다 — 일부만 비우면 앞 계정 자료가 뒤 계정 화면에 남는다(누수). 비용은 전환 1~3초.
- 대안 «창마다 다른 계정»(크롬 프로필식)은 하지 않는다 — localStorage·탭 키·초안·SW 가 창끼리 공유라 섞임 위험이 크고, 인스타도 기기 단위다.
- 화면 저장소: 탭 키·`qmail_account`·마지막 범위 등 **사람이 다르면 의미가 다른 키는 `u<id>` 를 붙인다**(탭 `planq_tabs_v1::u12::b5`). 초안은 이미 됨.

### 2.4 화면
- 좌측 아래 프로필 메뉴(데스크탑) · 내 정보(폰·앱)에 **계정 목록**: 아바타·이름·안읽음 점 · «계정 추가» · «이 계정 로그아웃» · «모두 로그아웃».
- 프로필 아바타 **길게 누르기 = 계정 고르기**(인스타와 같은 손버릇, 폰·앱).
- 계정 추가 = 로그인 화면(`/login?add=1`)에 «현재 ○○ 로그인 중 · 계정 추가» 머리줄.
- 다른 계정 안읽음: 목록을 열 때 + 60초마다(보일 때만) `device-accounts` 한 번.
- 문구 ko/en 동시.

## 3. 알림 — 계정 전부 받기 (D2)

### 3.1 푸시 구독: «기기 하나 × 사람 여럿»
- `push_subscriptions` UNIQUE 를 `endpoint` → **`(endpoint, user_id)`** 로 바꾼다(운영 마이그레이션 · 멱등).
- 구독 등록 때 «다른 사람 행 만료(기기 양도)» 규칙을 바꾼다:
  - 그 다른 사람이 **이 기기 묶음에 있으면**(요청에 그 사람의 유효 `rt_<id>` 쿠키가 붙어 있으면) 둘 다 유지.
  - 없으면 종전대로 만료(공용 PC·기기 양도 보호 그대로). **판정 근거를 화면 말이 아니라 서버가 보는 쿠키로** 둔다.
- 앱(APNs/FCM)도 같은 규칙 — 기기 토큰 하나에 사람 여럿.
- 같은 host 좀비 정리(`expireSameHostZombies`)는 **사람별 그대로**.

### 3.2 푸시 내용
- payload 에 `uid`(받는 계정)를 싣는다. 기기에 계정이 2개 이상이면 제목 앞에 계정 표시 «[개인] …» (기기 묶음 수는 서버가 그 endpoint 의 활성 행 수로 안다).
- 클릭 → `sw.js` 가 `/?as=<uid>&next=<link>` 로 연다 → 앱이 지금 계정과 다르면 **그 계정으로 전환 후** 링크(다른 워크스페이스 클릭 `enterWorkspaceLink` 와 같은 순서). 그 계정 쿠키가 없거나 무효면 로그인 화면(`add=1`, 그 이메일 채움).
- 앱 아이콘 숫자 = 계정 합(현재 계정만 세면 «숫자는 있는데 열면 0»).

### 3.3 앱 안 도착 카드(토스터)·종
- 소켓은 **지금 계정 하나만**(다른 계정 소켓을 붙이면 그 계정 자료가 이 화면 메모리로 들어온다 — 누수 표면). 다른 계정 소식은 **OS 푸시** + 계정 목록 안읽음 점으로.
- 종 목록·숫자는 그대로 지금 계정·지금 워크스페이스(Q7).

## 4. 보안·격리 (되돌리기 어려운 것)
- 쿠키 하나 = 계정 하나 — 서로의 세션을 대신 발급하지 않는다. `device-accounts` 는 검증만(회전 안 함 → 다중 탭 회전 경합 없음).
- `X-Workspace-Id`·`active_business_id` 는 계정마다 따로(이미 사람 단위 컬럼).
- 감사: `auth.account_add` · `auth.account_switch` · `auth.account_logout`.
- 로그인 제한(IP 8회/15분 등)은 계정 추가에도 그대로.
- 회귀: secrets(응답에 토큰 원문 0) · 두 계정 화면 섞임 0(전환 뒤 앞 계정 id 가 응답·DOM·localStorage 새 키에 0) · 한 계정 로그아웃이 다른 계정 푸시를 안 끊음 · 묶음 밖 사용자의 같은 endpoint 등록은 여전히 앞 사람을 만료(양성 대조).

## 5. 단계
1. 쿠키 묶음 + `device-accounts` + 로그인 `add` + 전환(기기 전체 재부팅) + 계정 목록 화면 + 저장소 키 `u<id>`.
2. 푸시 `(endpoint,user_id)` 마이그레이션 + 등록 규칙 + payload `uid` + sw 클릭 전환 + 앱 아이콘 합.
3. 다른 계정 안읽음 점.
- 앱: 웹 쪽만 바뀐다(앱은 planq.kr 을 불러옴) — 스토어 새 빌드 불필요. 단 iOS WebView 쿠키 여러 개 유지 실기기 확인 필요.
- 운영: 마이그레이션 `migrate-push-multi-account.js`(배포 슬롯, 코드보다 먼저).

## 6. 물어볼 것 (Fable 판정 대상)
- D0 A 안으로 가는가(0 은 안내만)?
- D1 전환 단위 = 기기 전체(재부팅) 가 맞는가, 창별이 필요한가?
- D2 푸시 «묶음 판정 = 서버가 본 유효 쿠키» 가 기기 양도 보호와 충돌 없는가?
- 쿠키 이름 방식(`rt_<id>`) vs 쿠키 하나에 서명된 묶음 — 어느 쪽?
- 옛 `refresh_token` 이관 순서(배포 직후 로그아웃 0).
- 최대 계정 수 5.

## 7. Fable 설계 판정 반영 (정본 — 2026-11-02 · VERDICT: DESIGN-REVISE → 아래 6건)

Fable 판정: D0 = A 안 맞음 · D1 = 기기 전체 전환·재부팅 맞음 · 쿠키 = `rt_<userId>` 맞음(묶음 쿠키는 Set-Cookie 한 번 유실이 계정 다섯을 함께 죽인다) · CSRF 는 Lax 로 충분 · 최대 5 적정. 고칠 것:

1. **묶음 증명은 서버 서명 토큰** — `GET /api/auth/device-accounts` 가 검증한 user_id 목록을 60초 HMAC 토큰 `device_proof` 로 같이 내린다. `subscribe`·`subscribe-native` 는 그 토큰으로 «다른 사람 행 유지» 를 판정(없거나 틀리면 종전대로 만료). 쿠키 경로를 `/api` 로 넓히지 않는다. (3.1 의 «요청에 붙은 쿠키로 판정» 은 폐기 — 쿠키가 안 와서 항상 거짓이었다.)
2. **일반 로그인은 기기 묶음을 비운다**(다른 `rt_*` 폐기 + refresh 행 revoke + 그 사람×이 기기 푸시 행 삭제) — 공용 PC 에서 남이 비밀번호 없이 앞 사람으로 전환하는 구멍. **`add=1` 은 지금 계정의 유효 접속 토큰이 있어야만.** 구글·애플 `add` 는 state 에 `add + 현재 uid` 를 싣고 `oauth/finish.js` 한 곳에서 처리.
3. **전환 문은 `POST /api/auth/switch {user_id}` 하나** — `rt_last`(HttpOnly) 를 바꾸는 유일한 곳 · 감사 `auth.account_switch` · 응답에 토큰. `/refresh {user_id}` 가 `rt_last` 와 다르면 **409 `account_stale`**(회전·`pq_img` 발급 없음) → 창은 `workspace_stale` 과 같은 길로 재부팅. `pq_img` 는 `rt_last` 계정으로만.
4. **롤백 길 — 한 배포 주기 이중 쓰기**: `rt_<id>` 와 함께 `rt_last` 계정의 옛 `refresh_token` 도 쓴다(옛 코드로 되돌려도 로그아웃 0). `has_session` 힌트는 남은 계정 ≥1 이면 유지, `all` 때만 지움. 옛 `refresh_token` 만 있는 기기는 refresh 1회로 `rt_<id>` 로 승격.
5. **로그아웃·발송 계약**: `logout {user_id|all, endpoint?, native?{kind,token}}` → 폐기하는 사람 × 그 기기 행만 삭제. payload `uid` · **앱 숫자 = 그 기기의 활성 계정들 안읽음 합(발송 때 계산)** · SW 클릭은 숫자를 0 으로 지우지 않고 합으로 다시 맞춤 · `next` 는 같은 출처 경로만.
6. **저장소 키는 래퍼 하나** — `services/scopedStorage.ts`(`u<uid>::` 접두, uid 없으면 쓰기 거절)로 사람 의미 키(qmail_account·qmail_folder·qtask_view_mode·planq_tabs_v1·planq:taskPopout:tab 등) 전부 이전 + `guard-invariants` 에 raw `localStorage.` 새 사용 래칫. (localStorage 를 직접 쓰는 파일 72개 — 손으로 고르면 빠진다.)

비차단: 계정 목록 안읽음은 60초 폴링 대신 «메뉴 열 때 + 탭 복귀» + 서버 30초 캐시 · 비밀번호 변경·워크스페이스 삭제·결제는 비밀번호 재입력이 있는지 구현 때 확인 · 5계정 초과는 «가장 오래 안 쓴 계정 로그아웃할까요» 확인창.

### 단계(반영본)
0. 마이그레이션 `migrate-push-multi-account.js`(UNIQUE (endpoint,user_id), 멱등, 배포 슬롯 코드보다 먼저)
1. 쿠키 묶음(이중 쓰기) + `switch` + `device-accounts` + `scopedStorage` + 계정 목록 화면
2. 푸시 등록 규칙(`device_proof`) + payload `uid` + SW 클릭 전환 + 앱 숫자 합
3. 다른 계정 안읽음 점
- **1 과 2 는 같은 운영 배포로** — 1 만 나가면 전환할 때마다 앞 계정 푸시가 끊긴다.

### 증명할 것 (실 HTTP 3003 + 브라우저 3폭)
① A 로그인 → B add → `rt_A`·`rt_B`·`rt_last=B` · device-accounts 2건 valid ② switch A → 응답 A · `pq_img` A(이미지 200) ③ A 옛 쿠키 15분 안 재사용 200 · B 무영향 ④ refresh{A} 인데 rt_last=B → 409 ⑤ logout{A,endpoint} → A 만 사라짐 · B·has_session 그대로 · all → 0 ⑥ 양성 대조: add 없는 로그인 → 기존 rt_A 폐기 · add 무인증 401 · 묶음 밖 C 같은 endpoint → A·B 행 만료 ⑦ 옛 refresh_token 만 → 200 + 승격 · 롤백 뒤 200 ⑧ 발송 payload uid · 숫자 = 합 · 브라우저: 창 2 + 팝아웃 전환 → 셋 다 재부팅 · 전환 뒤 DOM·응답·새 저장소 키에 앞 계정 0건 · iOS PWA·앱 강제 종료 후 쿠키 2개 생존 · 애플 add 경로.

## 8. 구현 (2026-11-02 · [Opus] 방 d5609fe9 — 단계 0~2 + 3 일부)
- 서버: `services/deviceAccounts.js`(쿠키 묶음 단일 원천 — rt_<id>·rt_last·옛 refresh_token 이중 쓰기·rt_add 서명 10분·rt_solo 미룬 정리·device_proof 60초) ·
  `services/authTokens.setRefreshCookies` 가 rt_<id>+rt_last+옛 쿠키를 같이 쓴다 · 로그인/가입/OAuth(`oauth/core.issueSessionCookie`)는 setRefreshCookies → `deviceAccounts.afterLogin` ·
  `/refresh` = housekeep → 지금 계정 쿠키 · body.user_id ≠ 지금 계정이면 409 `account_stale` · `/logout {user_id|all, endpoint?, native?}` ·
  `routes/auth_accounts.js` GET `/device-accounts` · POST `/switch` · POST `/accounts/add-intent`(접속 토큰 필요 · 5개 한도 409 `account_limit`) ·
  `routes/push.js settleOtherUsers`(증명에 본인이 있어야 유효) · `services/push_service`(같은 기기 다른 계정 있으면 제목 앞 [이름/이메일] · badge 합 · 링크 `pq_as=`) · `services/accountUnread`(다른 계정 안읽음 = 안 읽은 알림 30일, 30초 캐시).
- 운영 마이그레이션 `scripts/migrate-push-multi-account.js`(배포 슬롯 등록, dev 적용·멱등 확인).
- 화면: `services/accounts.ts`(목록·전환·추가 의도·scopedStorage) · `components/Common/AccountSyncGuard`(App 루트 — 다른 창 전환·409·탭 복귀·pq_as) ·
  `components/Layout/AccountSwitcher`(사용자 메뉴 — 다른 계정·계정 추가·모든 계정 로그아웃) · 로그인 `?add=1`(`pages/Login/addAccountMode.tsx`) ·
  탭 저장 키 `u<id>::`(stores/tabStore — 도장은 그대로) · 메일 마지막 메일함·폴더 계정별 · 초안 정리가 이 기기 다른 계정 초안은 남김 · 앱 아이콘 숫자 합 ·
  앱 알림 탭 `nativePush.hopAccountFor` · 가드 `--category=rawstorage`(localStorage 직접 사용 래칫, 양성 대조 확인).
- 안 한 것: 폰 아바타 길게 누르기(메뉴로 대신) · 접힌 사이드바의 계정 목록.
