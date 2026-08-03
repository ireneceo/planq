# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-03 13:20 UTC (Opus 5, 1M)
**작업 상태:** 중단(Irene 취침). **#244·#245 완료(Fable 게이트 PASS, 미배포)** · 신규①② 구현완료·**Fable 검증 미완** · 총정리 로드맵 Fable 검토완료.

### 이어서 할 때 첫 할 일
1. **`/fable-검증` 재실행** — 신규①②(Q Bill 돈·증빙)는 Fable 구현 검증이 **끝나지 않았다**. 직전 실행이 API 529 로 죽었고 재실행분도 세션 종료로 중단됐다. **검증 없이 배포 금지.**
   - 특히 **`clientSubscriptionBilling.js` 는 Opus 가 코드만 넣고 실행 검증을 안 했다** — 가장 의심스러운 지점.
2. 그 다음 **#217** (아래 참조 — 원인 이미 특정됨, 소절단면)

---

## 이번 세션 완료

### ✅ #244 PWA 세션 증발 — Fable 게이트 PASS (33 assertion, 미배포)

**Irene 원문:** "planQ 앱모드로 사용하고 있을때, 사용자가 로그아웃 하지 않았는데, 로그인화면으로 돌아가면서 로그아웃됨" (user 3, Mac Chrome standalone 440×720)

**★ Fable 이 Opus 진단을 뒤집음:** 오늘분 error 로그가 **정확히 3줄**이라는 라인 회계로 "네트워크 실패설"을 반증. **요청은 서버에 닿았고 쿠키 없이 닿았다.** 429·서버측 삭제·백엔드 재시작 전부 배제(logout 이면 `revoked_reason='logout'` 이 남는데 27441 은 NULL).
**만성:** 이 Mac 에서 30일간 재로그인 22회(07-21 엔 28분 사이 4회). 재발일마다 마지막 토큰이 **미회전 고아**로 방치.
**미확정:** 쿠키를 무엇이 지웠는가 — 서버 데이터로 식별 불가. 유력 가설 = Mac Chrome "모든 창을 닫을 때 쿠키 및 사이트 데이터 삭제" 또는 확장. **Irene 확인 대기.**

**구현:** `routes/auth.js` · `auth_oauth.js` · `models/RefreshToken.js`(+`grace_successor_id`) · `middleware/security.js` · `contexts/AuthContext.tsx`
- **D1** `tryRefresh` → `{ok}|{ok:false, reason}`. **401 일 때만 종결**, network/server/**429** 는 `refreshWithRetry` 백오프(5s→15s→60s, cap 5분, `online` 이벤트 즉시 앞당김). **발행측(apiFetch 의 `planq:session-expired`)도 게이트** — 소비자만 고치면 우회된다.
- **D2** grace(15분) 창 **쿠키 자가치유** + **stale row 당 1회 캡**(`grace_successor_id`, FK/인덱스 없음 — 64키 회피). 서버는 raw 토큰을 해시로만 보관 → 새 발급이 유일한 치유법. 누적 `stale_reuse` 267건이 물증.
- **D3** 동반 쿠키 `has_session`(non-HttpOnly, path=/) → **"게스트 부팅"과 "표적 소실" 구분** · 401 기계판독 `code` · 로그 ISO 타임스탬프 · `POST /api/auth/session-diag` 비콘(무인증, IP당 60초 1건)
- **누락 동시 수정**: apiLimiter `p.id`→`p.userId` (payload 는 `{userId,email}` — **항상 IP 폴백이라 user 버킷이 침묵 사망 중**) / refresh 가 `remember` 무관 `maxAge` 를 붙여 **세션쿠키→영구쿠키 승격**되던 것을 JWT `persist` claim 승계로 차단
- **비채택**: access token 으로 쿠키 재발급(re-mint) — 보안 확대

**Fable 실측:** D2 반증 완주(치유 분기 무력화→재현→md5 일치 원복) · grace 경계 -16분 조작 → 401 `stale_reuse` → **원복 실측** · rate-limit 버킷 실증(같은 IP·두 계정: A 595 / B 599 / 무인증 IP 579) · 병렬 race 200/200

### ✅ #245 Q Talk 가로 흔들림 — Fable 게이트 PASS (미배포)

**★ Opus 의 `* { max-width: 100vw }` 가설 기각.** 진짜 메커니즘: **`overflow-y:auto` 만 선언하면 반대축 계산값이 visible→auto 로 강제**된다. 트랙패드 가로휠 `deltaX:120` → `scrollLeft` 120 실측. **소스에 `overflow-x` 글자가 없어 grep 으로 영원히 못 잡는다.**

**구현:** `MessageList`(ChatPanel) · `ChatList`(LeftPanel) · `Scroll`(RightPanel) 에 `overflow-x:hidden; overscroll-behavior-x:none` + `TranslatedText`·`CardNote` 줄바꿈 가드(잠복 버그) + `data-testid="qtalk-messages"` + **신규 카나리 `scripts/e2e/canary-qtalk-hlock.js`**(`run.js` 에 `hlock` 등록)

**★ 1차 카나리는 거짓 PASS 였다** — 440px 에서 `/talk` 진입 시 ChatPanel 이 마운트 안 되는데(대화를 클릭해야 열림) 휴리스틱으로 좌측 리스트를 굴리고 있었다. Fable 이 회귀를 라이브 번들에 올려놓고 통과함을 증명. → **testid 확정 지목 + fail-closed** 로 재작성, FAIL→PASS 플립 양쪽 실측.

**미확정:** 흔들릴 때 화면 가장자리 **뒤로가기 화살표(←)** 유무 → 보였으면 히스토리 스와이프 계열 확정. **Irene 확인 대기**(수정은 어느 쪽이든 봉쇄).

### 🔶 신규① 정기청구 세금계산서 "발행 대상 아님" — 구현완료, **Fable 검증 미완**

**Irene 원문:** "계속 정기발행되고 있는 건데 왜 세금계산서 발행 정보가 안들어오고 발행대상이 아니라고 하는 거야? 기율법률사무소 …"

**결함 2개:**
- (a) **쓰기측** — `recurring_invoice.js`·`clientSubscriptionBilling.js` payload 에 `receipt_type` 부재 → 기본값 `'none'`
- (b) **표시측** — 드로어가 단일원천 술어를 안 쓰고 `tax_invoice_status` 직독 (**"발행 대상 아님" 표기의 직접 원인**)

**중요:** `receiptsDue.js` 에 레거시 fallback 이 있어 증빙 큐는 이 건을 안 놓친다(paid 게이트). **운영 피해 1건 · 세무 실피해 0.**
**INV-2026-0004 는 08-03 10:54 Irene 이 직접 발송함**(= 신규② 경로). 편집 모달 `taxOn` 초기값이 고객 사업자정보를 안 봐서 `'none'` 유지 → **①②는 같은 흐름의 결함**.

**구현:** `receiptsDue.js` 에 `defaultReceiptTypeFor(client, currency)` 신설(공유 술어, **`biz_tax_id` 게이트 없음** — 사업자번호는 결제 후 고객이 입력하는 정식 흐름) → 두 엔진이 호출 + `tax_invoice_status='pending'` · `receipt_profile` 미기록 · 개인/외화 `'none'` · `routes/invoices.js` serializer 에 파생 `receipt_kind` · 드로어가 그것을 소비 · **`scripts/backfill-recurring-receipt-type.js`**(dry-run 기본·멱등·`updated_at` 보존·발행완료/취소 제외)

**Opus 자체 실측 18/18 PASS** (dev 정기청구 0건이라 합성 데이터로, 사후 삭제 확인). **Fable 검증 필요.**

### 🔶 신규② 청구서 상세 발송 버튼 — 구현완료, **Fable 검증 미완**

**단순 누락 확정** — 정기 draft_review 알림이 "검토 후 발송해주세요" 로 드로어를 여는데 발송 버튼이 없었다(자기 흐름과 모순).
**구현:** `isOwner && draft` Primary 버튼 + ConfirmDialog(비가역) + `sendBusy` 가드 + 수신처 부재 시 disabled+힌트 + i18n ko/en + **`POST /send` 에 `broadcastInvoice` 추가**(CLAUDE.md §16 위반이던 것)

### ✅ 총정리 로드맵 — Fable 검토 완료 (CONDITIONAL PASS)

**Fable 이 정정한 Opus 오류 4건:**
1. **#217 은 답변 대기가 아니다** — 원문 "샘플로 보내줘봐. 내용 확인하고 연결하자" = 개발측 선행. **뱃지 버그 원인 특정: `QBillPage.tsx:54` 가 window 이벤트만 듣고 socket 미청취**(옆 `TaxInvoicesTab` 은 socket 사용)
2. **이미 구현·장부만 안 닫힌 3건** — **#195**(운영 위키 카테고리 7-21 갱신 완료) · **#222**(email-drafts 자동저장 6-28 `394f4d4`, 잔여=리스트 클릭 이탈) · **#220**(백엔드 `sent_by_user_id` 기록됨, 프론트가 outbound 를 무조건 "나" 표기 `MailPage:1879`)
3. **#241 은 P1** — `translate_enabled` 컬럼이 있는데 **읽는 코드가 어디에도 없는 죽은 플래그**. 절단면 최소·짜증 반복
4. **iOS 누락 3건** — **4.8 Sign in with Apple**(Google 로그인 노출 시 요구 가능 → 네이티브에서만 숨기는 게 최저비용) · **2.1 심사용 데모 계정**(없으면 즉시 리젝) · App Store Connect 실무(앱 레코드·개인정보처리방침 URL·App Privacy·연령등급)

**#221 직접 원인:** `MailPage:1972` 가 `triage !== human/unknown` 이면 AI 초안 버튼을 숨긴다. **원문의 부가세 납부 메일·Apple Developer 메일 2통을 회귀 픽스처로 박제할 것.**

**#228 은 Electron 불필요** — `DataTransfer.setData('DownloadURL')` 로 Chrome/Edge(설치형 PWA 포함) 드래그 반출 가능. ⚠️ **`share_token` 재활용 금지**(L4 외부공유 의미 오염) → 드래그 전용 단수명 토큰 별도 설계.

**★ 26건 중 10건이 원문에 "fable이 검토/설계" 를 명시** — 설계 게이트가 Irene 의 지시사항 자체다.

---

## 실행 순서 (확정)

| 순위 | 내용 |
|---|---|
| **P0 즉시** | #244·#245 **배포** · **iOS 트랙 병렬 착수**(애플 심사 = 통제 불가 외부 리드타임) |
| **P0 돈(묶음A)** | 신규①②(Fable 게이트) → **#217①②** |
| **P1** | #221 메일 분류(**실 업무 미스 유일 건**) · #214+#240(묶음C, notify 착지점) · **#241 단독** · #213+#220+#222잔여(묶음B, MailPage) |
| **P2** | Q Task #236→237→238(태그 선행) · 프로젝트 #229+231 · 파일 #228+232 · #225 · **AI #227→#233→#230 순서 고정**(227 파일 RAG 가 인프라를 만듦, #235 편입) · #239 |
| **P3** | #208(Fable 기획설계 선행) · #211(Fable 의견서) · #195(확인 후 장부 닫기) |

---

## 네이티브 앱

### 데스크탑 방침 — **PWA. 네이티브 안 만든다** (Fable PASS)
- Q Note 웹회의 탭 오디오 캡처(`getDisplayMedia`)가 데스크탑 Chrome/Edge 전용 → PWA 면 그대로 동작, Electron 이면 재구현
- 배포=즉시반영 / Electron 은 자동업데이트·코드서명·보안패치 축만 늘고 얻는 게 없음
- 필요시 Windows=PWABuilder→Microsoft Store, macOS=Mac Catalyst

### iOS — 인프라는 거의 완성, 남은 건 자격증명
**완성:** Capacitor `ios/`·`android/`(Remote URL `app.planq`) · 네이티브 푸시 전 인프라(`PushSubscription.kind`·`device_token`·`subscribe-native`·APNs/FCM 발송·410 정리·프론트 `isNativeApp()` 분기) · `guard-native-release.js` **17/17**

**⚠️ 최대 리스크 — App Store 4.2(웹사이트 재포장).** Remote URL WebView 는 리젝 전형 패턴이고 Capacitor 공식 문서도 스토어 제출용 비권장. **리젝 시 로컬 번들 전환은 싸지 않다**(same-origin 상대경로 + HttpOnly 쿠키 전제라 API base·쿠키·CORS 축이 전부 열림). → 1차는 Remote URL 로 제출하되 심사 노트에 네이티브 푸시·딥링크·오프라인 fallback 명시.

**Irene 액션:** ①APNs `.p8` 발급(Key ID·Team ID·.p8 — 현재 env 3종 EMPTY 라 푸시 `skipped: no_apns_key`) ②Team ID(AASA 치환) ③App Store Connect 앱 레코드 ④Mac Xcode Archive→TestFlight ⑤심사 메타(스크린샷·개인정보처리방침 URL·App Privacy·연령등급·**데모 계정**) ⑥Sign in with Apple 도입 여부 결정

**Opus 액션(대기 없이 가능):** `ITSAppUsesNonExemptEncryption=false` 선반영 · 링크→앱 열기 화이트리스트 정비 · (Team ID 후)AASA 치환 · (.p8 후)dev APNs sandbox 실발송 검증

---

## Irene 확인 대기
1. Mac Chrome **"모든 창을 닫을 때 쿠키 및 사이트 데이터 삭제"** 설정/확장 (#244 삭제 주체)
2. #245 흔들릴 때 화면 가장자리 **뒤로가기 화살표(←)** 유무
3. 수동 청구서 모달 `taxOn` 기본 ON 여부 (신규① 후속, 이번 절단면 제외)
4. Google OAuth 검증 제출 · 워프로랩 Google Calendar 재연동(#242 Meet 선행)

---

## 이번 세션에서 배운 것 (재발 방지)

1. **★ 로그 라인 회계로 가설을 죽일 수 있다.** 로그가 적을 때는 **개수 자체가 증거**다(#244).
2. **★ 한 축만 `overflow-y:auto` 면 반대축이 auto 로 강제된다.** 소스에 `overflow-x` 글자가 없어 grep 불가 — computed style 런타임 카나리만 잡는다.
3. **★ 가드는 반드시 깨뜨려 확인.** 내가 만든 카나리가 회귀를 라이브에 올려도 통과했다. **검사 대상을 못 찾으면 통과가 아니라 실패(fail-closed)** + 휴리스틱 대신 `data-testid`.
4. **★ 사용자 표현을 코드 용어로 번역하지 말 것.** #214 "이메일 알림"은 email 채널이 아니라 "메일(도착) 알림"이었다(`email_logs` 0건).
5. **★ Sequelize 인스턴스 속성은 `updatedAt`(camelCase).** `updated_at` 은 toJSON 출력에만 — snake 로 읽으면 `undefined`→NaN 비교로 **항상 거짓 FAIL**. 여기서 두 번 헛짚었다.
6. **전수검사는 파서로.** grep 집계 13건이 실제는 7건(구현부·주석이 호출부로 잡힘).
7. **빌드 판정에 `grep -c` 를 마지막에 두지 말 것** — 0건일 때 exit 1 이라 성공이 실패로 통보된다.
8. **idle autosave 가 작업 중 파일을 커밋한다** — 임시 테스트 스크립트까지. Fable 에 diff 기준선을 명시할 것.
9. **백그라운드 대기 조건은 초기 상태 확인 후 작성** — 어제 마커가 남아 있어 루프가 즉시 종료됐다.

---

## Git 상태
- 최근: `4936b1a` wip auto-save (13:00) / `6af0df5`(12:30) / `9df3c8f`(11:58) — **모두 idle 자동저장**
- 기준선(직전 정식 커밋): **`48f5f8b`**
- 작업 트리: 클린
- 운영 배포 커밋: `37fb2f0` (#215) — **이번 세션 변경 전부 미배포**
- Fable 게이트 마커: `.claude/.fable-gate.json` — **#244/#245 시점 지문**. 신규①② 변경 후 지문이 달라져 **재검증 필요 상태**

---

## 복구 가이드

새 Claude 세션 시작 시:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
