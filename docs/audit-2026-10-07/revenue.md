# 제품 감사 — `revenue` (영업·고객·청구·구독) · 2026-10-07

> 독립 감사(Fable). 저장소·DB 무변경. 근거는 `파일:줄`, dev DB 는 SELECT 만. 실브라우저 미사용(코드·DB·API 근거만 — 화면 실측값은 «미확인» 으로 표기).
> R=1 영역이다. §5 의 심각도는 «돈이 틀리게 나가는가 / 결제 길이 막히는가 / 남의 자료가 새는가» 로 매겼다.

## 요약 (5줄)

1. **입구는 촘촘하고 출구는 수동이다.** 리드 수집(메일 판정·게스트 창구·상담 예약·Cue 추출 → `prospect`+inquiry)은 한 원장·한 전이 함수로 잘 묶여 있다. 그러나 제안→계약→청구→입금은 Q sale 단계와 **코드로 연결된 곳이 0** — 견적 발행·계약 서명·청구 결제가 고객 단계를 올리지 않고(`projectStageEngine.js` 에 `sales_stage` 참조 0건), `won` 이 되어도 아무 일도 안 생긴다. dev 실측 고객 39명 중 **38명이 단계 `none`** — 파이프라인 기능이 쓰이지 않고 있다.
2. **돈 길이 막히는 실제 결함 1건(HIGH)**: 일일 cron `shareTokenCleanup` 이 **상태를 안 보고** 30일 손 안 댄 청구서의 `share_token` 을 지운다 → 고객이 메일로 받은 결제 링크가 404. dev 에서 이미 `sent` 2건·`overdue` 1건이 토큰 NULL(§5-1). 발송 라우트 주석은 "무제한" 이라 적혀 있다(`invoices.js:1389`) — 서로 모순.
3. **외화 청구는 아직 쓰면 안 된다(HIGH)**: 금액 컬럼이 `DECIMAL(12,0)` 이라 USD 99.99 가 100 으로 저장·결제된다. 청구서 번호는 워크스페이스 교차 전역 채번(테넌트 간 번호가 섞임).
4. **고객 입장 화면(포털)** 은 P0~P3 가 전부 구현돼 있고(창구 4탭·예약·내 문의·로그인 고객 홈) 구조가 좋다. 다만 dev 에 예약 0건·창구 링크 0건 — 아직 걸은 사람이 없고, 창구 발급 자리가 «설정 > 권한» 안에 묻혀 있다.
5. **리포트**: 청구 개요는 클라이언트 집계(KRW 만·원장과 다른 공식)·에이징/고객별/CSV 없음. 영업 파이프라인 시각화는 단계별 건수 칩뿐(금액·전환율·차트 0).

UX 점수: Q sale 6.5 · 고객 관리 7 · 고객 창구/포털 7.5 · Q Bill 6.5 · 플랫폼 구독 5.5.
**구독 쪽 HIGH 3건**: 잠긴 워크스페이스가 송금해도 복구가 500 으로 막힘(dev 고아 pending 18건) · 다운그레이드 예약이 영영 적용 안 됨 · 애드온이 첫 달만 받고 영구 무료.

---

## 1. 구현 상태

### 1-A. Q sale (영업)

| 기능 | 상태 | 근거 |
|---|---|---|
| 단계 7종(none→inquiry→consulting→proposal→negotiation→won/lost) · 전이 한 문 `setStage` | ✅ | `services/salesStage.js:15-78`. 외부 `client.update({sales_stage` 0건. 호출 4곳(`routes/sale.js:306`, `sale_save.js:394`, `services/booking.js:625,813`) |
| 불발 사유(lost_reason/note) | 🟡 | 상세·패널은 `LostReasonModal` 연결(`SaleDetailPage.tsx:456`, `ClientPanel.tsx:695`). **상담 목록 칩에서 «불발» 고르면 사유 없이 보내 항상 400**(§5-7) |
| 예상 금액/통화 | 🟡 | 서버 5통화 검증(`sale.js:243-250`), 화면은 금액만·통화 선택 없음(`ClientProfileForm.tsx:80-84`). 목록 합계·가중 파이프라인 값 없음 |
| 다음 연락 일정 | 🟡 | `NextContactModal.tsx:51-69` → `calendar_events`. 만든 뒤 Q sale 어디에도 안 보임: 타임라인 채널에 `event` 없음(`clientTimeline.js:16,29`), 확인필요 «다음 할 일 없음» 은 tasks+booking 만 봄(`todo/saleBucket.js:84-108`) |
| 상담 원장 `client_interactions`(call/meeting/visit/memo/other · source manual/qnote/email) | ✅ | `services/saleInteraction.js`, `routes/sale_interactions.js`. dev: manual 6·qnote 4 |
| 통화 녹음·STT(설계 §7 `stt_status/file_id`) | 🔴 | 컬럼은 읽는 곳만(`clientTimeline.js`), 쓰는 곳 0 |
| 메일→상담 판정·승격·치우기·되돌리기(수동/자동 모드) | ✅ | `saleInbox.js:71-170`, `saleMailCriteria.js:36-52`, `sale_save.js:105-290`, `salesIntake.js` |
| Cue 바 / AI 추출(문의 글 → 고객 칸) | 🟡 | `saleExtract.js`, `SaleCueBar.tsx`. 미리보기 4칸 라벨 키 누락(§5-8) |
| 히스토리 AI 요약 | 🟡 | `saleSummary.js` 캐시·stale OK. 프롬프트·섹션 라벨 한국어 고정(`:107-119`) |
| 타임라인 8채널(chat/email/task/invoice/interaction/note/stage/guest) | ✅ | `services/clientTimeline.js:65-278`. 상세·패널·설정>고객 세 곳이 같은 `ClientTimeline` |
| prospect→고객 초대(같은 행 승격) | ✅ | `routes/clients.js:302-317`. 패널 [초대] 확인창에 주소 표시(`ClientPanel.tsx:680-689`) |
| 한도(정식 고객 / 문의 고객 ×3) | ✅ | `services/clientQuota.js`, `plan.js:322-327`, `sale_save.js:379-380` |
| 알림 | 🟡 | `saleNotify.js` 는 `notifyAccountRequested` 1종(`guest.js:275`). 단계 변경·담당 배정·불발 알림 없음 |
| 실시간 | 🟡 | 서버 broadcast OK. **상담 목록이 `client:updated` 를 안 듣는다**(`SaleInboxList.tsx:169`) → 동료가 단계를 바꿔도 행 칩이 안 바뀜 |
| 파이프라인 시각화(칸반·퍼널·금액·전환율) | 🔴 | 없음. 단계별 건수 칩(`SalePage.tsx:370-400`) + `GET /summary`(stage_counts·this_month)뿐 |
| 필터/정렬/검색 | ✅ | 단계·접근·담당·검색·답변필요·종료가리기(`sale.js:38-70`). 사용자 정렬 없음(서버 고정). 담당 필터 옵션이 **현재 페이지 행에서만** 수집(`SalePage.tsx:201-209`) |
| 상세→프로젝트/청구 만들기(고객 prefill) | ✅ | ⋯메뉴 `/projects?new=1&client=`(`QProjectPage.tsx:107-114`), `/bills?tab=invoices&new=1&client=`(`InvoicesTab.tsx:57-68`) |
| 상세→[계약서 만들기] | 🟡 | 제목만 가진 Post 생성(`ClientPanel.tsx:313-325`) — 고객·프로젝트 연결 0, 서명·발행이 타임라인으로 안 돌아옴(doc 채널 없음) |
| 프로젝트 단계→고객 단계 자동 동기화(설계 §6.3 `salesStageSync`) | 🔴 | 파일 없음·참조 0 |
| 모바일 | ⬜ | 코드상 ≤640 세로 스택·필터 접기(`SaleInboxList.tsx:684`, `SalePage.tsx:311-316`). 실측 안 함 |

### 1-B. 고객 관리 · 초대 · 온보딩

| 기능 | 상태 | 근거 |
|---|---|---|
| 고객 목록·드로어(프로필·사업자정보·청구 연락처·프로젝트·대화·초대 대기) | ✅ | `ClientsPage.tsx:605-850`, `routes/clients.js:157` |
| 초대(메일) · 재발송(주소 확인창) · 보관/해제 · 삭제(영향도 경고) | ✅ | `clients.js:277,384,421,445,62`. 재발송 ConfirmDialog 주소 표시 ✅ |
| CSV 내보내기 | ✅ | `ClientsPage.tsx:427` |
| 통합 타임라인 페이지 | ✅ | `ClientTimelinePage.tsx`, `clients.js:86` · `sale.js:318` (같은 `getClientTimeline`) |
| 수락 → 프로젝트 연결 · 고객 채널 참여 · 환영 대화방 | ✅ | `services/clientOnboarding.js:22,121,147` |
| 고객 구독(정기 청구 설정) | ✅ | `ClientSubscriptions.tsx`, `routes/client_subscriptions.js`(테넌트 검증 `:95`) |
| 멤버 메뉴 권한 `clients` 서버 강제 | 🔴 | `menu_permission.js:34` 에 키는 있으나 `routes/clients.js` 에 `requireMenu` 0건(그 파일 전수) — `clients=none` 멤버도 목록·초대·삭제 API 호출 가능. `sale.js`·`invoices.js` 는 강제함 |
| 신규 초대 실시간 | 🟡 | `clients.js:361-373` 신규 생성 경로는 `broadcastClient` 호출 없음(prospect 승격 경로 `:330` 은 있음) → 다른 창의 목록이 안 바뀜 |
| 초대 메일 실패 처리 | 🟡 | `clients.js:364-375` 실패를 `console.warn` 으로 삼키고 201 'Client invited' — 화면은 «보냈다» 로 읽는다. 받는 사람은 메일이 없다 |
| 초대 메일 언어 | 🟡 | `emailService.js:451-481` 한국어 고정(영어 고객에게도 «초대 수락하기») |
| 목록 페이지네이션 | 🟡 | `clients.js:35-62` `findAll` 전량(표준 `parsePagination` 미적용) |
| 목록 `project_count` | 🟡 | `contact_user_id` 축만 센다(`clients.js:44-53`) — `client_home.js:40` 은 `client_id OR contact_user_id` 두 축. 계정 없는 고객은 언제나 0 |

### 1-C. 고객 창구 · 예약 · 로그인 고객 홈 (CLIENT_ENTRY_DESIGN P0~P3)

| 기능 | 상태 | 근거 |
|---|---|---|
| 창구 링크(`scope='workspace'`) 발급·교체·미리보기·QR | ✅ | `components/Permissions/CustomerEntrySection.tsx:139-170`, `models/GuestLink.js:49` |
| 창구 화면 4+1탭(안내·문의·상담 예약·내 문의·프로젝트🔒) | ✅ | `pages/Guest/GuestWorkspacePage.tsx:52,130-170`, `EntryInfoView.tsx` |
| 예약 슬롯·신청·수락·취소·일정 변경(무인증, 개인 링크만) | ✅ | `routes/guest_booking.js`, `services/booking.js:496-739`. 신청 시 prospect 생성·inquiry 전이(`:625`), 확정 시 consulting(`:813`) |
| 팀 쪽 승인/제안/거절/취소 + 받는 주소 확인창 + Meet | ✅ | `pages/QCalendar/BookingActions.tsx:98-161`, `booking.js:826-878` |
| 끝남 cron → 상담 원장 | ✅ | `booking.js:878,918`, `server.js:764` |
| 로그인 고객 홈 `/home`(같은 컴포넌트·계정 신원) · 로그인 착지 | ✅ | `routes/client_home.js`, `pages/ClientHome/ClientHomePage.tsx`, `LoginPage.tsx:493` |
| 유입 퍼널(방문 확인→신청→확정→등록) | ✅ | `Insights/tabs/EntryTab.tsx`, `stats.js:216` |
| 예약 설정(담당·길이·리드타임·하루 상한·근무시간) | ✅ | `components/Permissions/BookingSettings.tsx:100-180` |
| 실사용 | ⬜ | dev: `booking_status` 행 **0** · `guest_links.scope='workspace'` **0**(conversation 44·project 12). 설계서 운영 실측(09-24)도 0 — 기능은 있으나 아무도 안 걸었다 |
| 창구 설정 위치 | 🟡 | `pages/Settings/PermissionsSettings.tsx:272` — «권한» 페이지 안. 처음 쓰는 오너가 «고객이 들어오는 문» 을 권한 설정에서 찾을 이유가 없다 |

### 1-D. Q Bill (고객 청구)

| 기능 | 상태 | 근거 |
|---|---|---|
| 생성/편집(draft·canceled 재편집) · 발송(채팅 카드+메일+공개링크) · 미리보기 · 재발송 · 독촉(6h 쿨다운) | ✅ | `routes/invoices.js:846,1216,1373,1456,1600,1488`, `services/invoiceDelivery.js:21-52` |
| 상태 6종 + 전이, 결제 되돌리기 차단 | ✅ | `models/Invoice.js:43`, `invoices.js:2229-2273` |
| 분할(≤12회, % 합 100) · 회차별 결제/세금계산서/현금영수증 마킹 | ✅ | `:869-888,946-962,1648,1680,1770,1833` |
| 결제 원장 `invoice_payments`(FOR UPDATE) | ✅ | `services/invoicePayments.js:108-190` |
| 증빙 정정(6사유) · 증빙 큐 | ✅ | `:2082`, `services/receiptsDue.js:113`, `TaxInvoicesTab.tsx` |
| 외화 5종 + SWIFT | 🔴 | 선택·표시는 됨(`NewInvoiceModal.tsx:46`, `PublicInvoicePage.tsx:535`)이나 **금액이 정수 컬럼**(§5-2) — 실제로는 쓸 수 없다 |
| 공개 결제 페이지(토큰·만료 410·Stripe 카드·입금 알림·증빙 요청) | ✅ | `:125-143,417,503,560`, `stripeWorkspaceWebhook.js:33`(서명검증·멱등 ✅). 비밀번호 보호는 없음(문서 공유와 다름) |
| 정기청구(프로젝트 월정액) · 고객 구독 청구 cron | ✅ | `recurring_invoice.js`(`server.js:637,684`), `clientSubscriptionBilling.js`(`server.js:688`). `invoiceRecurring.js` 는 표시 메타 — 둘 다 살아 있음 |
| 연체 처리 | 🟡 | `overdue_handler.js:36` 상태 overdue + 담당 알림. 회차 due_date 는 안 봄(§5-9). 고객 자동 독촉 없음(정책) |
| 결제내역 탭 | 🟡 | `PaymentsTab.tsx:36` 는 목록을 회차로 펼친 파생 뷰. `invoice_payments` 원장을 읽는 화면·라우트 0 |
| PDF(멤버·공개) · source_post(견적/계약→청구) · 복사 · 프로젝트 단계 엔진 연동 · 상태이력 · 감사 · 실시간 · 오너 전용 가드 | ✅ | `invoicePdf.js`, `:860-870,729,1166,621`, `onInvoiceChanged` 8곳, `invoiceCaps.ts:60`↔`:62` |
| 발송 확인창(받는 주소 명시) | 🔴 | `InvoiceDetailDrawer.tsx:368-371` 주소 없음(`:224` 에서 계산해 두고 안 씀). `NewInvoiceModal.tsx:519` [발행하고 보내기] 는 확인창 0 — 생성 직후 즉시 발송. 독촉 `:412`·재발송 `:445` 도 즉시. CLAUDE.md «외부 발송은 확인을 받는다» 위반 4곳 |
| 견적서(Quote 엔티티)·템플릿·할인·복수 세율·환불/크레딧노트·CSV 내보내기 | ⬜ | `Q_BILL_SPEC.md §4.2,§12` 설계만. `quote_id`·`payment_terms` 컬럼은 입력 경로 없음(죽은 칸) |
| 목록 페이지네이션 | 🟡 | `:671-703` 전량 — 개요·결제·증빙 탭이 전체 목록을 받아 클라이언트 집계 |

### 1-E. 플랫폼 구독 결제 (PlanQ 가 워크스페이스에 받는 돈)

| 기능 | 상태 | 근거 |
|---|---|---|
| 플랜·한도 단일 원천(starter/basic/pro/enterprise, free 폐지) | ✅ | `config/plans.js:7-179` |
| 체험 14일 → D-7 사전청구 → D+14 past_due(grace 7) → D+21 canceled(잠금) | ✅ | `services/trial.js:64-189`, 가입 `routes/auth.js:377` |
| 선결제 보너스(「지금 결제하고 1개월 추가」) | ✅ | `plans.js:306-322`, `billing.js:155-161,200-204,302-309`, `PlanSettings.tsx:165-177,312-336` |
| 계좌이체(안내 메일·입금 통보·관리자 입금 확인) · Stripe 카드 1회 결제(웹훅 서명검증·멱등) | ✅ | `billing.js:163-274`, `plan.js:473-554`, `admin_billing.js:160-183,347-373`, `stripeCheckoutService.js:514-552`, `stripeWebhook.js:451-494` |
| 갱신 청구 cron | 🟡 | `billing.js:500-554,735-743` — 만료 **뒤**(past_due/grace)에만 청구 생성. 유료 구독 사전 안내 없음(체험만 D-7), 독촉 1통 |
| 업그레이드(결제 확정 시 적용) | ✅ | `markPaymentPaid`, `/change` 비관리자 업그레이드 402(`plan.js:281-284`) |
| 다운그레이드 예약 | 🔴 죽은 기능 | `plan.js:252-273` 이 `scheduled_plan` 을 쓰지만 **적용하는 코드 0**(`services/*` 에서 읽는 곳 없음 — `plan.js:404` 쓰기만). 갱신은 `sub.price` 옛 가격(`billing.js:534-536`), `markPaymentPaid` 가 `scheduled_plan:null` 로 지움(`:373`) → 화면은 «전환 예약됨» 인데 옛 가격이 계속 청구 |
| 사용자 해지 | 🔴 없음 | `plan.js` 에 cancel 라우트 없음(cancel-schedule 만). 문구 «그 전에 해지하면 추가 청구 없음»(`PlanSettings.tsx:324`)에 해당하는 버튼이 없다 |
| 환불 | 🟡 | `admin_billing.js:319-338` Payment.status 만 refunded — 구독·플랜·기간 원복 없음, Stripe refund 호출 없음 |
| 애드온(좌석·Cue) | 🟡 | 신청→한도 즉시→일할 청구(`addonBilling.js:45-133`). **정기 갱신에 합산 안 됨**(주석 `:13` «다음 사이클» 은 거짓 — `billing.js:534-549` 는 `sub.price` 뿐). 미입금이어도 회수 없음(dev biz 1 멤버 애드온 155일 pending, 한도 적용 중) |
| 세금계산서 요청(수동 발행 마킹) · 청구 주체 2법인 고지 · 면제(내부·테스터) · 관리자 콘솔 | ✅ | `admin_billing.js:378-436`, `config/legalEntities.ts`, `CheckoutModal.tsx:287-307`, `services/plan.js:61-79`, `billing.js:79-150` |
| 사용량 시각화 | 🟡 | `plan.js:208-223`, `PlanSettings.tsx:390-407`. 사용량 바가 **기본 플랜 한도**로 그려진다(애드온 합산 `effective` 아님 — `PlanSettings.tsx:345-383`, `UsageWarningCard.tsx:53`; dev biz 1 은 10/1,500) |
| `plan.can` 게이트 | 🟡 | 실호출 7종(upload_file·use_cue·create_project·add_member/client/prospect·use_qnote·create_conversation). `feature`(data_export/api_access/sso)·`requireFeature` 호출 0 → 비교표(`PlanSettings.tsx:468-471`)의 기능 플래그는 장식 |
| 영수증 PDF | 🟡 | `plan.js:571-583`, `billing.js:757-808` — «발행자» 란에 **결제한 워크스페이스 자신의 사업자정보**를 찍는다(`:796-803`). 공급자(아이린앤컴퍼니/GIT CONSULTING)·VAT 구분·Stripe 영수증 링크 없음 |

dev 실측: payments `plan·pending·bank_transfer` **21건** / paid 1 — 체험 사전청구가 거의 전부 미결제로 남아 있다.

---

## 2. UX 점수 · 격차

| 영역 | 점수 | 근거 · 최고 수준(HubSpot·Pipedrive·Stripe Invoicing·Calendly) 과의 격차 |
|---|---|---|
| Q sale | **6.5** | 좋은 것: 단계 변경이 목록 행에서 0클릭, 확인창 전부 `ConfirmDialog`, 빈/로딩/에러 있음, ko/en 373키 패리티. 격차: ①«불발» 이 목록에서 늘 실패(§5-7) ②Cue 바 라벨 raw key 노출(§5-8) ③칩 줄에 두 기준이 섞임(진행 단계=전체 건수, 성사/불발=이번 달 — `SalePage.tsx:379-395` vs `sale.js:118-132`; 칩을 누르면 전체 기간 목록이라 숫자≠행수) ④서버가 만든 한국어 reason 이 타임라인에 그대로(`sale_save.js:393`, `booking.js:625,813` → `ClientTimeline.tsx:115-117`) ⑤파이프라인을 «보는» 화면이 없다 — 칸반·금액·전환율·이번 달 예상 매출 0 ⑥«다음 연락» 을 잡아도 돌아오지 않는다 ⑦동료의 단계 변경이 내 목록에 반영 안 됨. 설명 없이 첫 사용자가 «문의 → 상담 → 성사» 를 끝낼 수는 있다(입구 UX 는 좋다). |
| 고객 관리(설정>고객) | **7** | 드로어 한 장에 프로필·사업자·청구 연락처·프로젝트·대화·타임라인 버튼. 격차: 초대 실패가 «보냈다» 로 보임, 초대 메일 한국어 고정, 두 입구(설정>고객 / Q sale 고객 탭)가 같은 행을 다른 모양으로 — 이미 설계된 분리지만 첫 사용자는 «고객이 두 군데» 로 읽는다. 메뉴 권한 미강제(§5-5). |
| 고객 창구 · 포털 | **7.5** | 게스트/로그인이 같은 화면·같은 함수(P3), 예약 3단·내 문의·확인필요 한 줄·청구/프로젝트 문. Calendly 급 격차: ①슬롯이 담당 1명·30/60분 두 길이뿐 ②예약 확인 메일만 있고 **리마인더(전날/1시간 전)** 없음(`booking.js` grep `remind` 0) ③창구 발급이 «권한» 안에 묻힘 ④로그인 고객 홈에 «지금 내 상태»(미결 청구 금액·서명 대기·다음 미팅)가 숫자 한 줄(확인필요 N건)뿐 ⑤dev·운영 모두 실사용 0 — 온보딩에서 창구를 만들라고 권하는 문이 없다. |
| 플랫폼 구독(설정>요금제) | **5.5** | 좋은 것: 체험 잔여일·만료일·배너, 계좌이체 안내(금액·계좌 복사·입금자명·«입금했어요»→확인 대기), 선결제 보너스 문구, ko/en 220키 패리티. 격차(Stripe Billing/Paddle 급): ①**해지 버튼이 없다**(문구만) ②다운그레이드 «예약됨» 이 거짓(§5-13) ③`load()` 실패 시 에러 상태 없이 영원히 Skeleton(`PlanSettings.tsx:105-111`) ④체험 중 결제해도 «체험 N일 남음» 배지 유지(`services/plan.js:81` 이 trial_ends_at 만 봄) ⑤사용량 바가 애드온 미합산 ⑥입금 **기한** 표시 없음 ⑦확인창이 공용 `ConfirmDialog` 아님(`aria-modal` 없음 `:607-658`) ⑧영수증 PDF 공급자 정보 틀림 ⑨자동 갱신·카드 저장·인보이스 이력·단계별 독촉 없음(설계상 보류 — 재제안 아님). |
| Q Bill | **6.5** | 1화면 완결 생성·발송(좋음), 공개 페이지에 카드결제·입금알림·증빙요청·PDF. 격차: ①발송 확인 없음(4곳) ②`NewInvoiceModal.tsx:620-622,680-689,752,759,1042-1093`·`SettingsTab.tsx:109,340`·`PaymentsTab.tsx:94` 한국어 하드코딩 — 영어 사용자는 발송 섹션을 한국어로 본다 ③개요가 KRW 만·원장과 다른 공식(§5-10) ④에이징·고객별 미수금·DSO·캐시플로·CSV 없음 ⑤결제내역이 원장이 아님 ⑥`QBillPage.tsx`·`PaymentsTab.tsx` 미디어쿼리 0건(6열 고정폭 표 — 폰 가로 넘침 가능, 미측정) ⑦공개 페이지 에러가 서버 코드 문자열 노출 가능(`PublicInvoicePage.tsx:383`). Stripe Invoicing 급과의 핵심 격차는 «받을 돈이 언제 들어오나» 를 보는 화면이 없다는 것. |

---

## 3. 확장 기능 제안

| # | 문제(사용자 말) | 제안 | 기대효과 | 규모 | 위험 | 우선순위 |
|---|---|---|---|---|---|---|
| 1 | "계약서에 서명 받았는데 고객은 아직 «제안» 이네. 청구도 끝났는데 «협상» 이야." | **단계 자동 동기화 `services/salesStageSync.js`** (설계 §6.3 복원): 견적/제안 published → proposal, 계약 signed → won(origin auto, 상향만), `projectStageEngine.onPostChanged/onInvoiceChanged` 에서 호출. 수동 won/lost 는 그대로 | 파이프라인이 «사실» 이 된다(지금 38/39 none) | M | R=0(단계는 되돌리지 않음·auto 상향만) · setStage 한 문 | **P0** |
| 2 | "이번 달 들어올 돈이 얼마야? 어느 고객이 밀렸어?" | **청구 개요를 서버 집계 라우트로**: 에이징(0-30/31-60/61-90/90+)·고객별·프로젝트별 미수금·통화별·DSO·입금 예정(회차 due 기준)·CSV. 매출 공식은 `invoice_payments` 원장 하나(인사이트 재무탭과 같은 함수) | 수금 운영 가능·두 화면 숫자 일치 | M | R=0(읽기) | **P0** |
| 3 | "영업 상황을 한눈에 못 봐." | **파이프라인 보드**: Q sale 고객 탭에 `segmentedToggle` 로 목록/보드. 단계 열 × 카드(이름·예상금액·담당·마지막 접점·다음 연락). 상단 합계: 단계별 건수·금액·가중액(단계 확률은 `config` 고정표). 드래그 = `setStage`(lost 는 사유 모달) | HubSpot 급 가시성 | M | R=0 | **P1** |
| 4 | "won 했는데 다음에 뭘 해야 하는지 모르겠어." | **won 전이 후속**: 프로젝트 없으면 «프로젝트 만들기(고객 prefill)» + 거래 템플릿 선택을 한 확인창으로, 있으면 거래 단계 next_action 표시. 담당·오너 알림(`saleNotify`) | 출구가 생긴다 | S | R=0 | **P1** |
| 5 | "예약 당일 고객이 안 왔어." | **예약 리마인더**(전날 18시·1시간 전) 메일 + 고객 앱 알림 — `booking.js` cron 에 추가, 수신자는 `recipientOf` 같은 함수 | 노쇼 감소 | S | R=1(외부 발송) → Fable | **P1** |
| 6 | "견적을 먼저 보내고 승인받으면 그걸로 청구하고 싶어." | 새 엔티티 없이 **Post(category quote) 에 «승인» 공개 액션**: 공개 문서 페이지에 [견적 승인] → `post.meta.quote_accepted_at` + 알림 + salesStageSync(proposal→negotiation). 청구서 생성 모달 `source_post` 기본 선택 | 견적→청구 한 줄 | M | R=1(무인증 쓰기 표면) → Fable | **P1** |
| 7 | "고객 홈에 지금 뭘 해야 하는지가 안 보여." | 로그인 고객 홈 «내 상태» 카드: 미결 청구 금액·서명 대기 N·다음 미팅 — `fetchTodo` 항목을 종류별 3칸으로(새 API 없음) | 포털 체감 | S | R=0 | **P2** |
| 8 | "USD 로 청구하면 금액이 바뀌어." | 금액 컬럼 `DECIMAL(14,2)` 통일 + VAT 반올림을 통화별 소수 자리로(KRW 0 · USD 2) | 외화 청구 가능 | S(코드)/M(운영 마이그레이션) | **R=1**(운영 스키마·금액) → Fable | **P0**(§5-2 와 같은 건) |
| 9 | "내 번호가 다른 회사 청구서 때문에 건너뛰어." | 청구서 번호 `business_id` 축 + 트랜잭션 락(`SELECT … FOR UPDATE` 또는 `business_invoice_seq`) | 세무 연속번호·테넌트 격리 | S | **R=1**(번호 체계) → Fable | **P0**(§5-3) |
| 10 | "고객에게 보내기 전에 어디로 가는지 보고 싶어." | 발송 4곳 `ConfirmDialog` 에 수신 주소 명시(드로어·모달·독촉·재발송) — 주소 없으면 버튼 비활성+이유 | 오발송 방지, 규칙 준수 | S | R=0 | **P0** |

| 11 | "체험 끝나서 잠겼는데 송금했는데도 안 풀려요." | 잠금 복구 한 길: 잠금 때 pending 결제를 `replaced` 로 닫고 `/status` 가 canceled 구독의 pending 을 내리지 않게 + CheckoutModal 이 잠금 상태면 **새 checkout** 생성(`markPaymentPaid` wasFirst 경로로 구독 재생성). 관리자 [입금 확인] 도 같은 함수 | 잠금 메일의 약속이 사실이 된다 | S | **R=1**(구독 상태 전이·돈) → Fable | **P0**(§5-13) |
| 12 | "Basic 으로 바꿨는데 Pro 요금이 또 나왔어요." | `ensureRenewalPayment` 가 `scheduled_plan` 을 읽어 그 플랜 가격으로 청구하고 결제 확정 시 적용 + 애드온 수량을 갱신 금액에 합산 + 셀프 해지 라우트(사유 수집·기간 말 종료) | 청구 금액이 화면과 같아진다 | M | **R=1**(청구 금액 공식) → Fable | **P0**(§5-14·15) |

이미 있는 것이라 제안하지 않음: 분할 청구·증빙 정정·Stripe 카드·입금 알림·정기 청구·고객 구독·예약 창구·유입 퍼널·고객 CSV·타임라인·메일 판정.

---

## 4. 개선 설계 (바로 구현 가능한 수준)

### 4-1. 단계 자동 동기화 `salesStageSync` (제안 1)
- **문제**: 계약 서명·청구 결제가 고객 단계에 안 닿는다. `projectStageEngine.js` 는 `sales_stage` 를 모른다(grep 0).
- **설계**: `dev-backend/services/salesStageSync.js` 한 파일. `syncFromProject(projectId)`: 프로젝트의 `project_clients` → `clients` 행마다 `project_stages` 최고 완료 단계를 매핑(quote/proposal completed → `proposal`, contract completed → `won`), `setStage(client, to, { origin:'auto', reason:'stage_sync', sourceRef:{project_id, stage_kind} })`. 상향만(`salesStage.js` auto 규칙 그대로). 호출: `projectStageEngine.progressProject` 끝(`:66`)에 `await salesStageSync.syncFromProject(projectId)`.
- **reason 은 코드로**: `'stage_sync'`, `'booking_request'`, `'booking_confirm'`, `'mail_inquiry'`, `'guest_inquiry'`, `'manual_add'` — 화면이 `t('stageReason.<code>')` 로 그린다(기존 한국어 문자열 4곳 치환: `sale_save.js:393`, `booking.js:625,813`). ko: «계약 체결로 자동 전이» / en: "Advanced automatically: contract signed".
- **검증**: dev 에서 프로젝트 1건에 contract post 서명 완료 → `client_stage_history` 1행(origin auto, to won) · 이미 won 인 고객은 0행(멱등) · lost 고객은 건드리지 않음(음성 대조군).

### 4-2. 청구 개요 서버 집계 + 에이징 (제안 2)
- **문제**: `OverviewTab.tsx:313-325` 가 전체 목록을 받아 KRW 만, `paid_amount` 로 센다. 인사이트 재무탭은 원장(`services/stats.js:1116`). dev id 70·77 이 두 화면에서 다르다.
- **설계**: `GET /api/invoices/:biz/overview?range=` 신설(`requireMenu('qbill','read')`), 집계는 `services/stats.js` 재무 함수와 **같은 원장 함수**를 export 해 재사용. 응답: `{kpis:{revenue_by_currency, receivable_by_currency, overdue_count, draft_count, receipts_due}, aging:[{bucket:'0-30',amount,count}…], by_client:[{client_id,name,receivable,overdue}], upcoming:[{date,amount}] (회차 due 기준)}`. `OverviewTab` 은 그 응답만 그린다(현재 카드 유지·KPI 칸만 교체·에이징 막대 1개 추가 — `ChartCard` 재사용). CSV 는 `utils/csv.downloadRowsAsCsv`(인사이트가 이미 쓴다).
- **ko/en**: `qbill.overview.aging.title` «미수금 연령» / "Receivables aging" · 버킷 «30일 이내·31~60일·61~90일·90일 초과» / "0–30 · 31–60 · 61–90 · 90+ days" · `overview.byClient` «고객별 미수금» / "Receivables by client".
- **검증**: dev 원장 합 = 응답 revenue(통화별) · 인사이트 재무탭과 같은 수 · 분할 청구서 1건 잔금 회차가 upcoming 에 1행.

### 4-3. 파이프라인 보드 (제안 3)
- **와이어**(Q sale > 고객 탭, `segmentedToggle` «목록 | 보드»):
  ```
  [문의 3 · ₩4.5M] [상담 2 · ₩3M] [제안 1 · ₩8M] [협상 1 · ₩8M]   ▸ 이번 달 성사 2 · 불발 1   가중 예상 ₩7.9M
  ┌문의────────┐┌상담────────┐┌제안────────┐┌협상────────┐
  │ ㈜가나 ₩2M │ │ …          │ │ …          │ │ …          │
  │ 담당 lua   │ │            │ │            │ │            │
  │ 접점 3일 전│ │            │ │            │ │            │
  │ 다음 10/12 │ │            │ │            │ │            │
  └────────────┘└────────────┘└────────────┘└────────────┘
  ```
- **파일**: `pages/QSale/SalePage.tsx`(토글만), 새 `components/QSale/PipelineBoard.tsx`(카드는 `SaleInboxList` 행의 칩·아바타 그대로 — `LetterAvatar`·`ChipPopover`), 드롭 = `setSaleStage`(lost 는 `LostReasonModal`). 서버는 `GET /summary` 에 `stage_amounts`(통화별 합·가중) 추가(`sale.js:110`). 확률표는 `config/salesStages.js` 한 곳(inquiry .1 · consulting .3 · proposal .5 · negotiation .7).
- **ko/en**: `board.toggle` «보드»/"Board" · `board.weighted` «가중 예상»/"Weighted forecast" · `board.lastTouch` «접점 {{ago}}»/"Last touch {{ago}}".
- **검증**: 3폭 좌표(열 4개가 폰에서 가로 스크롤), 드롭 → `client_stage_history` 1행, lost 드롭 → 모달 없이는 요청 0건.

### 4-4. 발송 확인 4곳 (제안 10)
- `InvoiceDetailDrawer.tsx:368` 문구에 `:224` 의 주소 보간: ko «{{email}} 로 청구서를 보냅니다. 공개 링크가 포함됩니다.» / en "This will email the invoice to {{email}} (includes the public link)." · 주소 없으면 버튼 `disabled` + «받는 주소가 없습니다 — 고객 청구 연락처를 먼저 적어 주세요» / "No recipient address — add a billing contact first".
- `NewInvoiceModal.tsx:519` [발행하고 보내기] 는 `ConfirmDialog` 를 거친다(같은 문구). 독촉 `:412`·재발송 `:445` 동일.
- **검증**: 주소 있는 고객 → 창에 주소 · 없는 고객 → 버튼 비활성 · 확인 전 POST 0건.

### 4-5. 창구를 «고객이 들어오는 문» 자리로 (1-C)
- `CustomerEntrySection` 을 설정 > **고객**(`/business/clients`) 상단 카드로도 얹는다(같은 컴포넌트, 권한 페이지에는 링크만). 온보딩 체크리스트(있다면)에 «고객 창구 링크 만들기» 1줄. 고객 0명 빈 상태 문구에 «창구 링크를 명함·메일 서명에 붙이면 고객이 직접 문의·예약합니다» + [창구 만들기].
- **ko/en**: `clients.empty.entryCta` «고객 창구 만들기» / "Create your client entry link".
- **검증**: 고객 0명 워크스페이스에서 빈 상태에 버튼, 누르면 링크 발급 1건(`guest_links.scope='workspace'`).

### 4-6. 서버 문자열 → 코드 (Q sale 전반)
- 단계 이력 reason·AI 요약 섹션 라벨(`saleSummary.js:107-119`)을 코드/언어 인자로. 요약은 요청자 언어(`req.user.language`)로 프롬프트.
- **검증**: en 사용자로 타임라인 → 한글 0(응답 원문 grep).

---

## 5. 버그 · 위험 (심각도순)

| # | 심각도 | 내용 | 근거 |
|---|---|---|---|
| 1 | **HIGH (돈 길 막힘)** | **청구서 공개 결제 링크가 30일 뒤 조용히 죽는다.** 일일 cron `runShareTokenCleanup` 이 `share_token IS NOT NULL AND updated_at < 30일 전` 이면 **상태 무관** `share_token=NULL`. 첫 열람만 `viewed_at` 을 찍고(`:168-170`) 그 뒤 손 안 대면 토큰 소실 → 고객이 가진 메일 링크 404(`:134`). 발송 라우트 주석은 «기본 무제한 — 만료되면 사고»(`invoices.js:1389-1390`) 라 적혀 있어 두 코드가 모순. **dev 실측: `sent` 2/2 · `overdue` 1/1 이 토큰 NULL**(id 37·52·572). 운영도 같은 cron. 고쳐야 할 곳: `shareTokenCleanup.js:25` Invoice 는 `status IN ('paid','canceled')` 일 때만, 또는 대상에서 제외(`share_expires_at` 이 이미 만료를 담당). 지워진 토큰은 재발송(`:1613-1615`)이 새로 발급하지만 고객이 가진 옛 링크는 못 살린다 | `services/shareTokenCleanup.js:25,34-43`, `server.js:721-724`, `routes/invoices.js:134,168,1389` |
| 2 | **HIGH (금액)** | **외화 금액 정수 절단.** `total_amount/tax_amount/grand_total` DECIMAL(12,0), `InvoiceItem.unit_price/amount` DECIMAL(12,0) → USD 99.99 가 100 으로 저장·PDF·Stripe(`toStripeAmount` ×100) 결제. `subtotal/paid_amount/installment.amount` 는 (14,2) — 한 청구서 안에서 자릿수 혼재. VAT `Math.round` 정수(`:921,1305`). dev USD 1건·소수 0건이라 아직 안 드러남 | `models/Invoice.js:29-39`, `models/InvoiceItem.js:31,35`, `InvoiceInstallment.js:30`, `stripeCheckoutService.js:13` |
| 3 | **HIGH (세무·격리)** | **청구서 번호 전역 채번.** `generateInvoiceNumber` 가 `INV-YYYY-%` 를 business_id 없이 스캔(`recurring_invoice.js:22`, `clientSubscriptionBilling.js:14` 도 동일). dev 실측 biz 5: 0005~0044 · biz 105: 0034~0042 · biz 122: 0032~0033 — 테넌트끼리 번호가 섞인다(연속번호 요건 위반·타 테넌트 발행량 추정). 동시 생성 시 UNIQUE 충돌 재시도 없음(트랜잭션 안인데 번호 조회는 락 없음 `:908`) | `routes/invoices.js:107-120` |
| 4 | **HIGH (보안·방송)** | **단계 변경 broadcast 가 고객 행 전체를 뿌린다** — `invite_token`(계정 연결 열쇠)·lost_note·summary·expected_amount 포함, 받는 방은 멤버 전원(`qsale/clients` 권한 none 인 멤버 포함). CLAUDE.md «방송은 신호만»·«invite_token 노출» 두 규칙 위반. 같은 파일군의 다른 broadcast 는 `{id, business_id}` 만(`saleCommon.js:30`) | `services/salesStage.js:76`, `models/Client.js:22` |
| 5 | **MEDIUM (권한)** | `clients` 메뉴 권한이 서버에서 강제되지 않는다 — `routes/clients.js` 에 `requireMenu` 0건. 권한 매트릭스에서 `clients=none` 으로 막아도 API 로 목록·초대·삭제 가능 | `middleware/menu_permission.js:34`, `routes/clients.js` 전수 |
| 6 | **MEDIUM (격리·발송)** | 청구서 생성/PUT 이 `client_id`·`project_id` 의 business_id 를 검증하지 않는다(`source_post_id` 만 검증 `:861`). 남의 워크스페이스 client_id 를 넣으면 응답 include 로 그 고객 사업자정보가 나오고 메일이 그 주소로 간다. `client_subscriptions.js:95` 는 검증함 — 같은 술어 두 벌 | `routes/invoices.js:903-904,919,1265` |
| 7 | **MEDIUM (기능 불능)** | 상담 목록 단계 칩에서 «불발» 선택 = 항상 400(`lost_reason_required`) → 화면은 일반 «저장 실패». `LostReasonModal` 미연결 | `SaleInboxList.tsx:376-385`, `useInboxItemActions.ts:86-97`, `salesStage.js:46` |
| 8 | **MEDIUM (가시 결함)** | Cue 바 미리보기 4칸 라벨이 raw key(`inquiry.name/company/phone/email`) 로 뜬다 — ko/en 둘 다 그 키 없음(있는 건 `inquiry.nameLabel…`) | `SaleCueBar.tsx:184-191`, `locales/ko/qsale.json inquiry.*` |
| 9 | **MEDIUM (돈·독촉)** | 연체 판정이 회차를 모른다. 분할 청구서도 `invoice.due_date=오늘+14`(`NewInvoiceModal.tsx:190-191`)라 잔금이 35일 뒤여도 15일째 전체 overdue + 담당자에게 독촉 제안. 회차 `status='overdue'` 세팅 코드 0 → 결제내역 회차 연체 표시는 영영 안 뜸 | `services/overdue_handler.js:148` |
| 10 | **MEDIUM (숫자 불일치)** | 매출 공식 두 벌: 개요 `paid_amount`(`OverviewTab.tsx:325`) vs 인사이트 원장(`stats.js:1116`). dev id 70·77: status paid·paid_amount 0·원장 110,000/2,200 → 두 화면이 다르다. 개요는 KRW 외 통화를 버림(`:313`) | — |
| 11 | **MEDIUM (무인증 쓰기)** | 공개 토큰 소지자가 `receipt-request` 로 등록 고객의 `biz_name/biz_tax_id/tax_invoice_email…` 을 덮어쓴다(레이트리밋만). 링크가 전달되면 제3자가 고객 마스터·세금계산서 수신 메일을 바꿀 수 있다 | `routes/invoices.js:560-583` |
| 12 | **MEDIUM (격리)** | 상담 메모 라우트 `resolveConsultTarget`(email_thread) 가 business_id 만 보고 개인 메일 계정 격리(`accessibleAccountIds`)를 안 본다 — 다른 멤버 개인 스레드 id 로 메모 읽기/쓰기 | `routes/sale_interactions.js:126-175` (대조: `sale_save.js:124,187`) |
| 13 | **HIGH (돈·복구 불가)** | **잠긴 워크스페이스가 송금해도 복구되지 않는다.** 체험 만료 잠금은 Subscription 을 `canceled` 로 바꾸고 Payment 는 pending 으로 남긴다(`trial.js:172-181`). `/status` 는 그 pending 을 내려주고(`plan.js:76-79`) CheckoutModal 은 `existingPaymentId` 가 있으면 새 checkout 을 만들지 않는다(`CheckoutModal.tsx:86-89`) → 송금·통보 → 관리자 [입금 확인] → `markPaymentPaid` 가 `subscription_superseded` throw(`billing.js:296-298`) → 500. 잠금 메일의 «결제 후 자동 복구»(`trial.js:36`)가 거짓. **dev 실측: canceled 구독에 매달린 pending plan 결제 18건.** 관리자 우회(`PUT /admin/businesses/:id/plan`)도 `subscription_status` 를 안 바꾼다(`services/plan.js:396-410`) | `services/trial.js`, `services/billing.js:292-298` |
| 14 | **HIGH (돈)** | 다운그레이드 예약 미적용 — 화면 «전환 예약됨», 청구는 옛 가격 계속(§1-E). `scheduled_plan` 을 읽어 적용하는 코드 0 | `plan.js:252-273,404`, `billing.js:373,534-536` |
| 15 | **HIGH (돈)** | 애드온 영구 무료 — 첫 일할 결제 뒤 `Business.addon_*` 영구 유지, 갱신 금액에 미합산, 미입금이어도 한도 즉시 적용·회수 없음 | `addonBilling.js:13,95-100`, `billing.js:534-549` |
| 16 | **MEDIUM (돈)** | 체험 중 결제하면 남은 체험일 소멸(`periodStart = now`, `billing.js:302-304`) — D+3 결제 시 11일 손해. 선결제 보너스도 같은 공식 · 기간 공식 `setMonth` 월말 넘침(1/31+1M=3/3, `:29-34`) · 비교표 «VAT 별도»(`plan.json:83`)인데 청구 금액에 VAT 가 없다(`billing.js:176,220`) — 문구와 코드 중 하나는 틀림 · 환불이 구독·기간을 되돌리지 않음(`admin_billing.js:319-338`) | — |
| 17 | **MEDIUM (일관성)** | 유료 만료는 `downgradeToFree`(폐지된 free 한도로 계속 사용, `billing.js:439-494`, `planActive.js:17-19`), 체험 미결제는 잠금 — 같은 «안 냈다» 가 다른 결과 · 잠금의 실체는 `plan.can` 7종만(읽기·메시지·문서·메일·내보내기 그대로 — `routes/export.js` 플랜 게이트 0) | — |
| 18 | **LOW (구독)** | checkout `currency` 본문 자유 입력(`plan.js:372`) → USD 외 값은 가격 0 오류 문구 · 체험 메일 `eventKind: trial_pre_bill` 이 ENUM 밖(`trial.js:46`, 끌 수 없음) · `GET /:biz/payments` `toJSON()` 통째(`plan.js:566`, stripe id·tax_invoice_data) · `start-trial` 은 폐지된 free 전용 레거시(`plan.js:190-232`) · 웹훅 금액·통화·`business_id` 메타 대조 없음(`stripeWebhook.js:476-485`) | — |
| 19 | **LOW** | 초대 메일 실패를 삼키고 201(§1-B) · 신규 초대 broadcast 없음 · 문의 추가 모달 `duration_minutes` 전송인데 서버는 `duration_seconds` 만 읽어 조용히 유실(`SalePage.tsx:572` ↔ `saleInteraction.js:30`) · 공개 응답에 출처 문서 `share_token` 노출(`invoices.js:188,210`, 프론트 미사용) · `recordInvoiceStatusChange` setImmediate+빈 catch(`invoicePayments.js:24-37`), canceled→draft 부활은 이력 호출 없음(`:1289`) · 서버 TZ UTC 라 세금계산서 기한(`receiptsDue.js:20`)·연체 하루 경계가 KST 와 9시간 어긋남 · `salesStage.js:7` 주석의 가드 `salesstage` 는 존재하지 않음 · Stripe webhook 이 `payment_status` 미확인(카드만이라 실질 낮음) · 정기청구·구독 메일 한국어 고정(`recurring_invoice.js:139,206`, `clientSubscriptionBilling.js:247`) | — |

확인 못 함: 모바일 3폭 실측(코드 근거만) · 실HTTP 왕복(읽기 전용 범위) · 운영 DB 의 토큰 소실 건수(운영 접속 금지 — 같은 cron 이므로 **운영 확인 권고**: `SELECT COUNT(*) FROM invoices WHERE status IN ('sent','overdue','partially_paid') AND share_token IS NULL AND sent_at IS NOT NULL`).
