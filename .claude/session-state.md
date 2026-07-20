# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-20 (Opus 4.8, 1M) — **v1.47.1 다통화 통화별 분리 + App Store 3.1.1 네이티브 봉쇄 운영 배포 완료** (Fable 설계·구현 게이트 양쪽 PASS, `d0cd84c` Complete 197s)
**작업 상태:** 완료 (배포·3점 실측 검증까지)

### 이번 세션 완료 (v1.47.1 · 운영 배포됨 · 5커밋)
1. **다통화 통화별 분리**(`6224858`·`d0cd84c`) — Insights `stats.js` 가 통화 구분 없이 raw 합산+프론트 fmtKRW → 외화 ₩오염($2,200=₩2,200). 4 build+trend 홈통화(businesses.default_currency)만 합산 + `by_currency` 브레이크다운 + P&L `has_foreign_currency` 플래그 + team revenue_share 홈통화만. 프론트 `fmtMoney`(통화별 소수, 홈=KRW fmtKRW 재사용=회귀0)+칩+뱃지·각주. 원천 Invoice.currency 단일화(mismatch 0). 실HTTP biz5 revenue=13,860,000+by_currency={USD:2200}.
2. **App Store 3.1.1 네이티브 봉쇄**(`d44b22e`) — Remote URL WebView 가 마케팅 랜딩(/pricing 가격표면) 도달하는 뒷문 차단. App.tsx 랜딩 8라우트→NativeMarketingRedirect, DownloadApp CTA→/inbox, TrialStatusBanner 네이티브 중립문구.
3. **cron 삭제 워크스페이스 가드**(`6fe31fb`) — soft-delete 워크스페이스가 cron 청구/리포트 계속 돌던 것 차단(clientSubscriptionBilling·reportUnitCron).
4. **순매출 환불 차감**(`08cfb7a`) — 매출 통계 refunded_amount 차감.

### 이번 세션 부수 발견/조치
- **Stripe 실상태 확인** — SaaS 카드구독(platform) Stripe 코드 완성이나 **키 미연결**(dev·운영 platform_settings 미입력). KRW 결제 코드는 OK(zero-decimal). 운영 워프로랩 업무 #142/#155 로 추적 중.
- **운영 워프로랩(biz1) 업무 추가** — `#160 Android Play Console 법인 등록($25)` Irene 담당(누락분만, 기존 115건 무손실→116).
- **★빌드/배포 kill 회피** — Bash 도구가 vite 를 프로세스그룹째 signal-16(exit 144)로 디스크쓰기 직전 kill(로그엔 성공·파일 미반영). `setsid` 완전분리로 해소(메모리 [[feedback_build_heap_4096_on_dev]] 갱신). 배포도 setsid 로 완주.

### [이전 세션] Q Bill + 소유권이전 + 계정삭제(앱 5.1.1) + 운영 피드백 5건 (2배포 · 16커밋)

### 이번 세션 완료 (전부 운영 배포됨 · 16커밋)
1. **게스트 퀵메뉴·Q helper 공개표면·/wiki 네비** — utils/publicSurface. Fable: useChromeNav no-op → RR navigate 주입.
2. **앱 심사 선제대응** — App.entitlements·결제봉쇄(canPurchaseInApp)·planq:// scheme·AASA/assetlinks·guard-native-release(17). Team ID/.p8 대기.
3. **Q Bill 결함 2건** — ①매출 0: invoice_payments write 0건인데 stats 6곳이 이걸로 계산 → 결제확정 3경로(markInstallmentPaid/markInvoicePaid/PATCH status) payment append + FOR UPDATE 락(webhook 이중계상) + paid→sent 400 차단 + 백필. ②구독 owner 가드(bill-now 우회 차단). health-check billing 불변식 가드.
4. **워크스페이스 소유권 이전** — POST /businesses/:id/transfer-ownership (owner_id + role 원자 스왑). 계정삭제 선행.
6. **운영 피드백 5건** (커밋 15906f4) — #189 카카오톡 인앱브라우저 랜딩 크래시(봇 오인→API가 HTML→wikiCats.length 크래시. 서버 SHARE_BOT_UA+/api스킵 + 프론트 content-type 가드 이중방어. 운영 nginx는 share-bot conf 없어 코드만으로 해소) · #188 게스트 말풍선 팝오버(우측패널→FAB위 챗봇위젯) · #191 OG 이미지(수익성엔진 태그 제거, 로고+슬로건 중앙) · #187 Q info 커스텀항목 편집+overflow · #190 안드로이드 답변. feedback_items #187~191 done. 남은 #126·#146=Irene.
5. **★계정 삭제 (App Store 5.1.1(v))** — soft delete(status='deleted')+30일 유예→익명화 cron. 스키마 마이그레이션(users 3+businesses.deleted_at+business_members.removed_reason) · preflight/request/복구(공개)/auth code분기 · services/accountAnonymize.js(users/business_members/clients/conversations PII+L1삭제+토큰purge) · q-note POST /internal/purge-user(음성지문·세션·물리파일) · 프론트 ProfilePage Danger Zone(이메일타이핑+비번)·LoginPage 복구. health-check account 가드.

### ★ 세션 최대 교훈 (메모리 feedback_guard_must_be_falsified 강화됨)
유령 컬럼이 3회 재현(EmailAccount.user_id→owner_user_id / speaker_embeddings.session_id 없음 / preflight). 전부 .catch(()=>{})가 Unknown column 삼켜 "성공+PII 잔존". **정적 필드검증도 EmailAccount 빠뜨림 — 실행(실HTTP/실DB)만이 잡았다.** Fable이 매 게이트 반증. 익명화 트랜잭션 catch 전량 제거(실패→rollback→재시도).

### 검증
Fable 게이트: 설계 검증 여러 회 + Q Bill 최종 PASS + 계정삭제 CONDITIONAL PASS(배포가능). 운영 3점(PM2 fresh·청크 CnkfYlEU·헬스200) + 마이그레이션 4컬럼 실적용 + 라우트 실동작(preflight401·recover400·qnote-purge401·transfer401·i18n서빙). 가드 4축(health33·invariants21·app-routes51·native17). 모든 검증 후 테스트데이터 원복.

### 🔴 남은 것 — Irene 액션 (앱 등록)
- **Apple Team ID · APNs .p8(+Key ID)** → AASA placeholder 치환 + 실푸시. **Firebase → FCM**. 조직 등록 시 D-U-N-S.
- 운영 nginx AASA content-type(application/json) — passwordless sudo 제한으로 Claude 불가. TestFlight 전까지.

### 비차단 후속 (다음 사이클)
- **OAuth 전용 계정 탈퇴(D9 OTP)** — 현재 400 안전차단. Google 로그인 켤 때 4.8 SIWA와 함께.
- **소유권 이전 UI** — API 완성, 워크스페이스 설정 버튼만.
- **businesses.deleted_at 필터**(access_scope/cron/socket) — 현 범위 노출 경로 없어 비차단.
- Q Bill 🟠: 단일 invoice unmark 라우트 부재 · refunded 미차감 · 외화 환산.

### 미푸시
로컬 16커밋 미푸시(배포는 rsync 모델이라 무관). origin=afd6098.

---

## 복구 가이드
새 세션: `/opt/planq/.claude/session-state.md 읽어줘`
### 참조
- 설계: docs/QBILL_PAYMENT_LEDGER_FIX.md · docs/ACCOUNT_DELETION_DESIGN.md(v3) · docs/qa/GUEST_QUICKMENU_WIKI_DESIGN.md · docs/MOBILE_APP_DESIGN.md
- 메모리: feedback_guard_must_be_falsified · project_native_app_capacitor_plan · project_subscription_payment_plan
