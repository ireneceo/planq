# PlanQ 세션 상태

**마지막 업데이트:** 2026-09-04 10:00 UTC
**상태:** 안드로이드 Play 내부 테스트 배포 완료 · iOS 앱 결함 5건 수정 배포 완료 · **배지 미해결**

---

## 오늘 운영에 나간 것

배포 2회 — `20260904_081758`(랜딩) · `20260904_094049`(앱 결함). 커밋 9건, Fable 게이트 2회 PASS.

| 커밋 | 내용 |
|---|---|
| `3679ce3d` | **iOS 앱 결함 5건** — 구글 로그인 · 브라우저 창 · 연결확인 · 언어 · 안전영역/배지 |
| `e79becd9` | 앱 다운로드 진입점 · "App Store"→"iPhone에 설치" · "베타는 무료" 문구 제거 |
| `27e0bb95` | 운영 FCM 설정 스크립트 |
| `d909739e` `8426be02` `d6c5c7bc` `c18e4f2c` `be3c9a58` | 안드로이드 빌드 결함 5건 + 가드 |
| `5d9569d3`(어제 커밋, 오늘 배포) | 랜딩 목적 문장 위치 이동 → **두 줄** 처리까지 완료 |

---

## ⛔ 미해결 — 다음 섹션 1순위

### 배지(앱 아이콘 숫자)가 앱을 내리면 사라진다

**Irene 재확인(2026-09-04, 배포 후): "앱에 알림 표시 없어지는 거 똑같아. 앱 내리면 없어져버려"**

오늘 한 수정은 **데이터 도착 전 삭제만** 막았다(`useGlobalBadge` `hasRealUpdateRef`).
Fable 이 그 경로는 대조군으로 재현·수정 확인했으므로 **그 경로는 원인이 아니었다**는 뜻이다.

**남은 원인 후보 2개 — 하나를 고르려면 아래 질문 답이 필요하다:**

1. **정의 문제(유력)** — 지금 배지 = `인박스 확인필요 + 채팅 안읽음` **합계**
   (`MainLayout.tsx:907` `useGlobalBadge(inboxCount, talkUnreadCount)`).
   앱을 열어 다 읽으면 합계가 0 이 되고 `Badge.clear()` 가 **정상 동작으로** 불린다.
   Irene 은 "온 알림의 수" 를 기대하는데 코드는 "안 읽은 것의 수" 다. **이건 버그가 아니라
   정의 불일치** — 무엇을 세는 배지인지 먼저 정해야 한다.
2. **카운트가 앱에서 0 으로 잘못 잡힘** — 인박스/채팅 카운트 fetch 나 socket join 이
   네이티브에서 실패하면 실제로는 있는데 0 이 되어 정당한 배지를 지운다.
   → `MainLayout` 의 `inboxCount`/`talkUnreadCount` 가 앱에서 실제로 몇인지 확인 필요.

**★ 다음 세션 첫 질문(이거 하나로 갈린다):**
> 배지가 사라지는 시점이 **(A) 앱을 열자마자** 인가, **(B) 앱을 열고 내용을 본 뒤** 인가?
> (A)면 후보 2, (B)면 후보 1(정의 문제).

관련 파일: `dev-frontend/src/hooks/useGlobalBadge.ts` · `components/Layout/MainLayout.tsx:907`
· `dev-backend/routes/notifications.js:238~285`(발송 시 badge 계산) · `capacitor.config.ts`
`presentationOptions: ['badge','sound','alert']`

---

## 지금 열려 있는 것

### 1) 안드로이드 마무리
- **운영 FCM** — `bash /opt/planq/scripts/setup-prod-fcm.sh` (Irene 실행. `!` 접두)
  안 하면 **안드로이드 앱 알림 0통**. `.env` 는 rsync 제외라 배포로 안 따라간다
- **Play 프로덕션 승격** — 같은 번들(versionCode 15) 그대로. 재빌드 불필요.
  Play Console → Production → Create new release → Add from library → 국가 선택 → 심사
- **`assetlinks.json` 지문 미치환** — 링크 눌러도 안드로이드 앱이 안 열린다.
  넣을 값은 업로드 키(`33:E1:4E:…`)가 **아니라** Play Console → App integrity 의
  **App signing SHA-256**. `node scripts/android-set-cert.js <SHA256>` → 빌드 → 배포

### 2) iOS 배포 범위 — Irene 결정 대기
지금은 **TestFlight 전용**이라 고객이 **TestFlight 앱을 먼저 깔고** 그 안에서 PlanQ 를 받는다.
90일마다 재설치, 애플이 "베타" 로 표시(우리가 못 바꿈), 10,000명 한도.
런북에 "앱스토어 정식 출시는 하지 않는다"(2026-08-24 결정)라고 적혀 있다 —
**"고객이랑 똑같게" 를 원하면 이 결정을 바꿔야 한다.** 안드로이드는 정식 경로로 갔다.

### 3) 앱 유도 (Irene: "안드로이드까지 끝나면 하자")
랜딩 방문자에게 앱 설치 유도가 **아무것도 없다**. 기존 `InstallPromptBanner` 는
**로그인 사용자만** 보이고 내용도 PWA 기준이다. 하단 고정 띠는 모바일 키보드가
입력줄을 덮는 회귀 전례가 있어 피할 것. 배너는 **하나만**(2026-08-25 결정).

### 4) 비차단 부채 2건 (오늘 Fable 지적)
- **연결확인으로 만든 세션이 30일** — `OauthConnectConfirmPage` POST 가 `X-Client-Kind` 미전송
  → `client_kind='web'`. `native-exchange`(ios 365일)와 불일치
- **"설치 화면으로 이동" → 애플 TestFlight 안내가 예고 없이 뜬다** — 문구에서 TestFlight 를
  다 걷어낸 결과. ②번 결정과 함께 정리

### 5) 개인정보처리방침 이행 (오늘 착수했다 중단)
`/privacy` 가 약속한 보관기간을 코드가 안 지킨다. **문구를 낮추지 말고 코드가 지키게 하는 것이 정석.**
- 감사 로그: `config/plans.js` `audit_log_retention_days`(30일~7년) 를 **읽는 코드 0곳**,
  `AuditLog.destroy` **0곳** → 영구 보관 중
- 휴지통: `trash_retention_days`(7~365일) 대신 **30일 하드코딩** 3곳
  (`routes/files.js:1132` · `routes/content_trash.js:24` · `services/uploadCleanup.js`)
- 착수 전 결정 필요: **플랜 다운그레이드 시 3년치가 즉시 삭제되는 절벽**을 어떻게 막을지

---

## 오늘 배운 것

- **`require` 한 줄이 없으면 기능은 조용히 죽는다.** `nativeReturnUrl` 을 import 하지 않고
  호출해 11일간 네이티브 구글 로그인이 ReferenceError 였다. 운영 에러 로그에 신고 시각과
  같은 예외가 남아 있었다 — **로그를 먼저 봤으면 5분이면 찾았다.**
- **런북의 낡은 ❌ 가 나를 틀리게 만들었다.** 8/24 기록을 그대로 옮겨 "iOS 푸시가 안 갑니다"
  라고 **운영에 반해** 보고했고 Irene 이 바로잡았다. 상태 표는 **볼 때마다 실측으로 대조**한다.
- **빌드 초록불 ≠ 올릴 수 있음.** targetSdk 미달·서명 없음·versionCode 중복은 전부
  빌드가 아니라 업로드에서 거부된다. 그래서 검사를 **빌드 시점으로 당겼다.**
- **`|| echo 0` 은 실패를 정상값으로 바꾼다.** 그 한 조각 때문에 versionCode 가 영원히 1 이었다.
- **재설치가 가려져 있던 것을 드러낸다.** 앱에 남은 언어 설정·세션이 지워지자
  "처음 오는 사람이 보는 화면" 이 처음 보였다. 어제 법적 페이지와 같은 계열.
- **만들어 놓고 연결하지 않으면 없는 것과 같다.** `/app` 페이지는 있었지만 링크가 0곳이었다.
- **`; echo` 를 붙이면 실제 종료코드가 가려진다.** 빌드가 heap OOM 으로 죽었는데(EXIT 134)
  알림에는 exit 0 으로 떴다. 로그를 안 봤으면 성공으로 보고할 뻔했다.
- **좀비 chrome 이 빌드를 죽인다.** 검증용 헤드리스가 남아 메모리를 먹어 tsc 가 OOM 났다.
  `pkill -f` 는 자기 셸을 죽이므로 PID 로 정리한다.

---

## 복구 방법

```
이전 세션 이어서 작업하고 싶어. /opt/planq/.claude/session-state.md 읽어줘.
배지 문제부터 보자.
```
