# PlanQ 다음 로드맵 — 역할별 할일 (2026-07-06 정리)

> Irene 질문: 안드로이드 완성도 / 네이티브 앱 완성도 체크 / 구독결제 붙이기. 아래로 최종 정리.

---

## A. 현황 진단 (사실)

### 네이티브 앱 (Capacitor)
- **iOS + Android 둘 다 scaffold됨** (remote URL 방식 — WebView가 planq.kr 로드, 웹 코드 재사용). 아이콘·스플래시 생성됨.
- **iOS**: APNs 푸시 코드 완료(Phase 0~5, dev). **단, 실제 배포는 Apple Developer 가입·Xcode 빌드·서명 필요 → Irene Mac 에서만 가능(Opus 는 Linux 서버라 iOS 빌드 불가).** 미완.
- **Android**: gradle·아이콘 있으나 **FCM 푸시 미설정**(`google-services.json` 없음 = Phase 4 미착수). 계획상 **iOS 다음 순서**. → **안드로이드 완성 아님.**
- 설계: `docs/NATIVE_APP_PLAN.md`, `docs/MOBILE_APP_DESIGN.md`.

### 구독결제 (플랫폼 SaaS 과금 — 워크스페이스가 PlanQ에 결제)
- **자체결제(계좌이체) 완성·라이브**: 플랜 catalog, 무료체험, 플랜 변경/강등, checkout, 입금 마킹(mark-paid), 결제내역·영수증 PDF, 애드온, 갱신/연체 cron. (`routes/plan.js`, `services/billing.js`)
- **PortOne 카드 자동결제 = 미구현**(Payment 모델에 `portone_imp_uid/merchant_uid/status/meta` 컬럼만 준비, billing.js 주석 "2순위 PortOne = P-7 마지막 단계").
- → **"구독결제 붙이자" = PortOne 카드 정기결제 연동** (새 대형 과제, Fable 게이트).

---

## B. Irene 할일 (외부·계정·결정 — 코드 아님, 선행)

| 우선 | 항목 | 내용 |
|------|------|------|
| 🔴 최우선 | **PortOne 가맹점 가입 + API 키** | 구독결제(카드) 개발 선행. 상점ID·API Secret·웹훅 시크릿 발급 → Opus에 전달(.env) |
| 🔴 | **Google OAuth 검증 제출** | GCP Console — #72·88·107·109. 제출 안 하면 일반 고객 구글 로그인/Gmail 차단. Gmail(restricted)은 검증 필수 |
| 🟠 | **Apple Developer Program 가입** ($99/년) | iOS 앱 배포·APNs·TestFlight 선행. 개인 가입 권장(1~2일). 네이티브 배포의 최우선 병목 |
| 🟠 | **DKIM 설정** | 구글 관리자 콘솔 + Cafe24 TXT — 외부 메일 스팸 격리 방지 |
| 🟡 | Google Play Console ($25) + Firebase 프로젝트 | Android 배포·FCM 선행 (iOS 다음) |
| 🟡 | 결정: #85 보고서 SCR 설계 승인 / #81 Cue 실작업 스코프 | 기획 결정 |
| 🟢 | 실기기 확인: #60 iOS푸시 · #84 팝아웃헤더 · #116/#118 우측패널 업무추가 키보드 | 모바일 실기기에서 눈으로 |

---

## C. Claude/Opus 할일 (코드 — 이 서버에서 가능)

### C-1. 구독결제 PortOne 연동 (대형, Fable 게이트) — Irene PortOne 키 받으면 착수
- billing key(카드 등록) 발급·저장(암호화) · 결제창(one-time) · **정기 자동결제(billing key 재결제 cron)** · webhook 수신(멱등·서명검증) · 실패/재시도/환불 · 멀티테넌트 격리
- UI: 결제수단 등록·변경, 자동결제 ON/OFF, 결제 실패 안내. 자체결제(계좌이체)와 공존(선택).
- 기존 Subscription/Payment/billing cron 재사용 — 결제 실행부만 계좌이체 → PortOne 분기.

### C-2. Android 완성 (FCM) — Irene google-services.json 받으면
- FCM 푸시 배선(`push_service.js` kind='fcm' 분기 — 코드 스텁 있음, Phase 4), google-services.json 배치, 토큰 등록·발송·배지
- Android 네이티브 완성도 스윕: safe-area, 딥링크, 공유타깃, 업데이트 배너, 백버튼, 스플래시/아이콘 검수

### C-3. 네이티브 앱 완성도 체크 (iOS/Android 공통, Opus 가능 범위)
- 웹 측 네이티브 분기 검수: push 등록·권한 동기화·safe-area·PWA vs native 문구·딥링크 라우팅·오프라인 fallback
- iOS 빌드/서명/TestFlight 은 **Irene Mac Xcode** (Opus 는 ios/ 디렉토리·설정까지, 빌드는 Irene)

### C-4. 잔여 소품 (선택)
- 공개(외부) KB raw-HTML 이미지 확대 · #116/#118 --vvh 커버 여부 코드 추적 확답

---

## D. Fable 할일 (설계 게이트·검증 — 고위험 전용)

| 대상 | Fable 검증 |
|------|-----------|
| **구독결제 PortOne** (C-1) | 돈 무결성 게이트: billing key 보안, 정기결제 멱등(중복청구 0), webhook 서명·재생공격, 환불·부분결제, 멀티테넌트 격리, 실패 재시도 폭주 차단, PCI 범위(카드정보 저장 금지·토큰만) |
| **네이티브 앱 완성도** (C-2/C-3) | 스토어 심사 기준(Apple 4.2/개인정보/권한 설명), 푸시 토큰 수명·좀비 정리, 딥링크 보안, 오프라인/업데이트 안전 |
| 운영 마이그레이션·보안경계 변경 | 기존 게이트 계속 (결제/증빙/task status 전이·인증 미들웨어·라우터 마운트) |

---

## E. 권장 순서

1. **Irene**: PortOne 가입 + Google OAuth 제출 (병렬, 둘 다 외부 선행)
2. **Opus**: PortOne 키 오면 → C-1 구독결제 설계 요약 → Fable 게이트 → 구현 → 검증
3. **Irene**: Apple Developer 가입 (iOS 배포 병목 해소)
4. **Opus**: iOS 설정·웹 네이티브 검수 → Irene Mac 빌드/TestFlight
5. **Irene**: Play Console + Firebase → **Opus**: C-2 Android FCM
6. 상시: Fable 게이트, 완성도 스윕

> 결론: **지금 코드로 바로 착수 가능한 최우선 = 구독결제(PortOne)**, 단 Irene의 PortOne 가맹점 키가 선행. 키 없으면 설계·스텁까지 진행 가능.
