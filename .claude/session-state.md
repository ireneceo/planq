# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-06 01:15 UTC (Opus 5, 1M)
**작업 상태:** **완료** (`/개발완료` 처리, Irene 외출). **운영 배포 완료 `6321f9d`** + **운영 PDF 전면 복구** + 백필 완주. 다음 섹션 착수분 확정(③④).

**완료 처리 시 가드**: health 33/33 · invariants 22/22 · tenant 0 · 위키 커버리지 ⛔0 · Fable 게이트 지문 일치(소스 변경 없음).

### 이어서 할 때 첫 할 일 — Irene 지시 "③④ 해. 다음 섹션에."

**③ 정기청구 메일 PDF 첨부가 처음부터 죽어 있다 (돈·발송 영역 → Fable 3게이트)**
- `services/recurring_invoice.js:195` · `services/clientSubscriptionBilling.js:257` 이 `require('./pdfBuilder')` 를 호출하는데 **`services/pdfBuilder.js` 는 git 이력 전체에 존재한 적이 없다.**
- 예외를 `catch { /* pdf 미지원 */ }` 가 삼켜서 **메일은 정상 발송되고 로그도 안 남는다.** → 고객이 받은 정기청구 메일에 **청구서 PDF 가 한 번도 붙은 적 없음**(shareUrl 링크는 들어감).
- 진짜 구현은 `routes/invoices.js:91 async function buildInvoicePdf(invoiceId)` 인데 **export 되지 않음**(`module.exports = router` 뿐). 라우트 내부 호출부 4곳(632·1047·1382·1467)은 정상 동작 중.
- **절단면**: `buildInvoicePdf` 를 공용 서비스(`services/invoicePdf.js` 등)로 추출 → 라우트 + 정기청구 2엔진이 공유. `catch` 가 조용히 삼키지 않도록 실패 로그 남기기(빈 catch 금지).
- 이 프로젝트 반복 패턴: memory `feedback_completed_but_dead_features` · `feedback_apifetch_no_throw_silent_save`.

**④ health-check 에 실제 PDF 1바이트 생성 항목 추가**
- 이번 #253 은 **운영에만 없는 시스템 의존성**이라 코드 검증·가드 3축 어디서도 안 잡혔다. dev 는 e2e 하니스 때문에 라이브러리가 있어서 통과.
- `scripts/health-check.js` 에 `renderPdfFromHtml` 실호출 → `%PDF-` 매직 확인 항목 추가. 배포 직후 자동 검출되게.
- **가드는 반드시 깨뜨려 확인**(memory `feedback_guard_must_be_falsified`) — LD_LIBRARY_PATH 를 일시 제거해 FAIL 나는지 실측 후 채택.

③④ 묶어서 Fable 게이트 → 배포.

---

## 이번 세션 완료

### ✅ 운영 배포 `6321f9d` (202s) — 3점 실측 통과
- PM2 uptime 78s(리셋) · 청크 `QBillPage-Cgg41Bez.js` **dev=운영 일치** · health 200
- 실린 것: **#244**(PWA 세션 증발) · **#245**(Q Talk 가로 흔들림) · **신규①**(정기청구 세금계산서 "발행 대상 아님") · **신규②**(청구서 상세 발송 버튼) · **드로어 React #310 크래시 수정**
- `DEPLOY_EXIT=1` 은 이 스크립트의 알려진 부수 신호 — Complete 줄 + 3점 실측으로 판정(memory `feedback_deploy_exit1_spurious`)

### ✅ 신규①② Fable 게이트 — 2라운드 (FAIL 1회 → PASS)

**★ 1라운드 FAIL 이 실제 킬러 회귀였다.** `InvoiceDetailDrawer.tsx` 의 `sendBusy` useState 가 `if (!invoice) return null`(171행) **아래**에 선언 → Rules of Hooks 위반. 드로어가 `InvoicesTab.tsx:295` 에서 `invoice={selected|null}` 로 **항상 mount** 되므로 여는 순간 훅 개수가 변해 **React #310 크래시**. 신규② 기능이 죽은 것에 더해 **기존 청구서 상세 전체가 파괴된 상태**였다.
- **tsc 도 가드 3축도 못 잡는다** — `react-hooks/rules-of-hooks` 린트가 빌드 파이프라인에 없다. Fable 의 **실브라우저 검증만이** 잡았다.
- 수정: 훅을 early return 위 `*Busy` 블록으로 이동(순수 이동, 로직 0).
- 2라운드 PASS: 딥링크·행클릭 `{"drawer":true,"crashed":false}` · **반증 실측**(훅 되돌려 재빌드 → #310 재현 → 백업 복원 md5 일치, `git checkout --` 미사용) · 발송 ConfirmDialog·`sendBusy` POST 정확히 1회·수신처 없으면 disabled · 레거시건 "세금계산서 · 발행 필요" · 백엔드 403 `owner_only` · 가드 33/33·22/22·tenant 0 · 빌드 REAL_EXIT 0

**백엔드는 1라운드부터 전부 PASS** — 술어 7케이스 × 목록/상세/public 3 serializer 일치 · **`clientSubscriptionBilling.js` 엔진 직접 실행**(Opus 미검증 지점) `tax_invoice/pending/NULL` · 반증으로 결함 재현 후 복원 · socket `invoice:updated` 실수신 · 백필 멱등·`updated_at` 보존.

### ✅ 운영 백필 완주 — `backfill-recurring-receipt-type.js`
- dry-run 1건 → `--apply` 1건 → **재실행 0건(멱등 실측)**
- 대상 = Irene 원 신고건 **INV-2026-0004 · 기율 법률사무소**
- 실측: `receipt_type='tax_invoice'` · `tax_invoice_status='pending'` · `receipt_profile=NULL` · **`updated_at` 2026-08-03 보존**(밀리지 않음)

### ✅ #253 운영 PDF 전면 사망 — 복구 완료 (코드 변경 0)

**Irene 원문(직원 신고):** "미리보기에서 pdf 다운로드 안돼. 전체 버튼들 작동 안하는 거 못 찾아?" (`/public/posts/847ca8da…`)

**근본 원인: 운영서버에 헤드리스 Chrome 실행용 공유 라이브러리 12개 결손.** dev 는 e2e 하니스 때문에 있어서 안 드러남.
```
Failed to launch the browser process: Code: 127
libatk-1.0.so.0: cannot open shared object file
```
**피해 범위는 미리보기 한 곳이 아니었다** — `services/pdfService.js` 단일 착지점이라 운영의 **모든 PDF** 가 500 이었다: 공개 미리보기(`routes/posts.js:1149`) · 청구서(`routes/invoices.js:104`) · 문서(`routes/docs.js:514`) · Q info(`routes/kb.js:1416`) · 보고서(`services/report_generator.js:143`) · 정기청구 메일(`services/billing.js:528`).

**조치 (root 없이 — sudo 는 nginx 명령만 NOPASSWD):**
1. dev(동일 Ubuntu 24.04)에서 `dpkg -S /usr/lib/x86_64-linux-gnu/<lib>` 로 **패키지명 역추적**(24.04 는 `t64` 접미사 전환이라 추측하면 틀린다)
2. 운영에서 `apt-get -s install` 로 폐쇄 50개 산출 → `apt-get download`(권한 불필요) → `dpkg -x ~/chrome-deps/root`
3. 운영 `/opt/planq/backend/.env` 에 `LD_LIBRARY_PATH=/home/irene/chrome-deps/root/usr/lib/x86_64-linux-gnu` 추가(백업 `.env.bak-chromelibs-20260806_005526`). dotenv 가 `process.env` 에 넣으면 puppeteer 가 띄우는 chrome **자식 프로세스가 상속**
4. `pm2 restart planq-prod-backend --update-env`

**실측:** `ldd` 결손 12 → **0** · `renderPdfFromHtml` 직접 호출 28,044B `%PDF-` · **운영 라이브 URL 200 / 207,690B / `%PDF-` / application/pdf**
**내구성:** 배포 rsync 가 `--exclude=.env --exclude=.env.*` 로 제외 → 다음 배포에도 유지. `~/chrome-deps` 도 배포 무접촉.
**안전성:** apt 시뮬레이션 `0 to remove, 0 upgraded` — 같은 서버 POS 무영향.

### ✅ 구글 캘린더 2건 — Fable 조사 완료 (구현 미착수)

**★ Fable 이 Opus 진단을 두 번 뒤집었다.**
- Opus 가설 1 "검증 미승인이라 스코프가 안 붙는다" → **반증.** 같은 구글 앱이 **개인 연동에는 `calendar.events` 를 이미 부여**하고 있다: `irene@irenewp.com`(7-27, +`calendar.readonly`) · **`han.sj.lua@gmail.com`(8-04)**. 미검증 앱도 "확인되지 않은 앱" 경고 통과 시 민감 스코프 동의 가능(제한은 신규 100명 캡).
- Opus 가설 2 "테스트 사용자 설정 필요" → **불필요.**
- **로그 라인 회계**: 운영 로그 7-27~8-6 전 구간 `[gcal callback]` **0건** → 워크스페이스 콜백이 code 교환 지점에 **도달한 적 없음**. `business_cloud_tokens` id3 의 `updated_at` 7-31 은 저장이 아니라 **`last_error_at`**(push 실패 기록, 초 단위 일치).

**★ Irene 의 결정적 지적: "구글 캘린더는 직원이 자기 쓰는 걸 연결해야지."**
- 확인 결과 **Meet 생성은 워크스페이스 토큰만 본다** — `routes/calendar.js:929` · `services/actions/event_actions.js:122` 가 `gcal.getTokenForBusiness(businessId)` 사용. 배너(`NewEventModal.tsx:423-429`)도 워크스페이스 `scope_ok` 만 본다.
- **직원(lua)은 이미 자기 계정을 연결해 뒀는데(8-04, `calendar.events` 보유) Meet 은 그걸 쳐다보지 않는다.** 신고 내용과 정확히 일치.
- **다음 절단면(설계 게이트 필요)**: Meet 생성을 **"일정 만든 사람의 개인 연동 우선 → 없으면 워크스페이스 폴백"** 으로. 직원 토큰이 이미 유효해서 **코드만 바뀌면 재연결 없이 즉시 동작**. 정할 것 — 팀 캘린더 동기화는 워크스페이스 유지할지 / 개인 연동 없는 사람 처리 / 배너가 어느 연동을 가리킬지.

**② 구글 → PlanQ 역방향 = 미구현 확정** (버그 아님). `events.watch`/`syncToken` 백엔드 전체 0건. `personalCalendar.listEvents` 는 개인 overlay **표시 전용**(`read_only:true`, DB 미기록).
- Fable 절단면: Irene 요구는 **에코백**(PlanQ 가 만든 일정을 구글에서 고치면 되돌아오게)이지 완전 양방향이 아니다 → 폴링+`syncToken`(watch 는 무인증 공개 콜백 = 보안 경계 변경) · 충돌은 **이벤트 단위 last-writer-wins** · **에코 루프 차단이 진짜 함정**(링크 row 에 `gcal_etag` 저장, 우리가 push 한 것을 되물어오는 것 skip) · 구글 삭제 시 **원본 삭제 X, 링크 해제 + 목적지 토글 off**(선행 정리: `calendarSync.js:176-179` 의 404 시 재생성이 삭제 의사를 되살린다) · 유입 쓰기 **필드 화이트리스트**(구글발 데이터가 `vlevel`/`visibility`/`business_id` 못 바꾸게). **규모 대** — ① 이후.

**검증 반려 트리거 발견(우리 쪽)**: `locales/{ko,en}/legal.json` 이 "캘린더 일정(**읽기 전용**)" 이라 기술하나 실제는 읽기·쓰기 `calendar.events`. 정확한 접근·사용 공개는 구글 심사 필수 요건 → **ko/en 정정 필요**(미착수).
**콘솔 쪽(Irene)**: Data Access 요청 스코프를 실사용과 일치시키기(과다 요청 = 반려 사유). 필요한 건 `calendar.events`·`drive.file`·openid/email/profile 뿐.
**데모 영상**: Fable 이 PlanQ 실화면 기준 8컷 대본 작성 완료(영어 내레이션·YouTube Unlisted). 5·6컷이 워크스페이스 또는 개인연동 Meet 동작을 전제 → 위 절단면 후 촬영 가능.

---

## 다음 우선순위

| 순위 | 내용 |
|---|---|
| **1** | **③ pdfBuilder 죽은 require + ④ health-check PDF 항목** (Irene 지시) |
| **2** | **Meet 을 개인 연동 우선으로** (Fable 설계 게이트 → 구현). 직원 즉시 해소 |
| **3** | `legal.json` 캘린더 "읽기 전용" 문구 정정 (구글 검증 반려 트리거) |
| **4** | gcal 콜백 조기 return 3경로 로그 + 배너에 워크스페이스/개인 구분 명시 |
| **5** | 직원 신고 잔여 — #246(공유 후 채팅방 안 열림) · #247/248(보류 버튼 위치, Fable 상의) · #249(업무명 잘림) · #250(업무 태그 미개발) · #251(메일 버튼 전 탭 노출) · #252(문서 임시저장) |
| **6** | #217(QBillPage socket 미청취) · #221 · #241 · iOS 트랙 |
| **P2+** | ② 캘린더 에코백 동기화(대규모) |

---

## Irene 확인 대기
1. Mac Chrome "모든 창을 닫을 때 쿠키 및 사이트 데이터 삭제" 설정/확장 (#244 삭제 주체)
2. #245 흔들릴 때 화면 가장자리 뒤로가기 화살표(←) 유무
3. 수동 청구서 모달 `taxOn` 기본 ON 여부
4. Google Cloud Console — Data Access 요청 스코프 정리 / 심사팀 반려 메일 원문

---

## 이번 세션에서 배운 것 (재발 방지)

1. **★ 훅 위치 위반은 tsc·가드 3축을 전부 통과한다.** `react-hooks/rules-of-hooks` 린트가 빌드 파이프라인에 없어 **실브라우저 검증만이** 잡는다. 항상 mount 되는 드로어에서 early return 아래 훅 = React #310.
2. **★ dev 에서 되고 운영에서 안 되는 계열은 코드 검증으로 영원히 안 잡힌다.** 시스템 의존성(공유 라이브러리)이 그 전형. 운영 실호출 항목을 health-check 에 넣어야 잡힌다.
3. **★ 단일 착지점은 피해도 단일이다.** `pdfService.js` 하나가 죽어 PDF 6개 기능이 동시에 죽었다. 신고는 한 곳에서 왔지만 범위는 전부였다 — **호출처 전수 확인 후 범위를 보고**할 것.
4. **★ 빈 `catch {}` 는 기능을 통째로 지운다.** `require('./pdfBuilder')` 가 없는 모듈인데 catch 가 삼켜 정기청구 메일 PDF 첨부가 **한 번도** 안 붙었다. 로그도 없어 무증상.
5. **★ 사용자가 "이것 때문에 배포한다" 고 하면 그것부터 끝낸다.** PDF 때문에 배포한다고 했는데 PDF 는 배포로 안 고쳐지는 건이었다. 순서를 거꾸로 해서 Irene 이 화났다.
6. **★ 내가 할 수 있는 일을 사용자에게 넘기지 말 것.** sudo 가 막혔다고 터미널 명령을 드렸는데, `apt-get download` + `dpkg -x` + `LD_LIBRARY_PATH` 로 **root 없이 내가 할 수 있었다.** 게다가 여러 줄 명령은 복사 시 개행이 깨져 쓰지도 못한다 — 명령을 드려야 하면 **한 줄로**.
7. **★ 진단은 두 번 뒤집혔다.** "검증 미승인" → 개인 연동이 이미 스코프를 갖고 있어 반증 / "테스트 사용자 설정" → 불필요. **DB 실측이 추론을 이긴다.**
8. **idle autosave 가 Fable 의 작업 중 테스트 스크립트를 또 커밋했다**(`8dbd67f`). 이번 세션만 2회. Fable 에게 "작업 파일은 `/tmp` 에" 를 매번 명시할 것.
9. **패키지명은 역추적으로 확정한다.** Ubuntu 24.04 `t64` 접미사 전환 때문에 추측하면 틀린다 — 동작하는 서버에서 `dpkg -S` 로 뽑을 것.

---

## Git 상태
- HEAD: **`6321f9d`** fix(qbill): 청구서 드로어 React #310 크래시 + 증빙 표시·발송 버튼 마무리
- 직전: `9221835`(임시 스크립트 정리) · `8dbd67f`(idle autosave — Fable 스크립트 오염)
- 작업 트리: 클린
- **운영 배포 커밋: `6321f9d`** — 이번 세션 변경 전부 배포 완료
- 운영 백업: `/opt/planq/backups/20260806_004957` (롤백 경로)
- Fable 게이트 마커: `.claude/.fable-gate.json` — PASS 기록됨(clean tree 지문)

## 운영서버 변경 (코드 외)
- `/opt/planq/backend/.env` 에 `LD_LIBRARY_PATH` 추가 (백업 `.env.bak-chromelibs-20260806_005526`)
- `~/chrome-deps/` 신설 — deb 50개 + 추출 라이브러리 73개. 배포 무접촉
- **puppeteer 가 Chrome 버전을 올리면 라이브러리 재확인 필요**(현재 linux-147.0.7727.57)

## 복구 가이드
새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
