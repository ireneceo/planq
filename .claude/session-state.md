# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-08 — **v1.33.3 운영 라이브** (deploy `20260608_195139`, commit `b714168`)
**작업 상태:** 완료 · 운영 배포 검증 3/3 OK · 빌링 갱신청구 fix + 운영 백필 검증

---

## ✅ N+94 완료 — 빌링 갱신 청구 자동 생성 fix (v1.33.3)

> 운영 호소: "유예 배너 '결제하러 가기' 가 결제 안 되고 플랜 선택으로만 감". 근본 원인 = cron 이 만료 구독을 past_due/grace 로 **상태만** 바꾸고 결제할 pending Payment 를 안 만들어, 배너가 띄울 청구 자체가 없었음.

### 완료된 작업 (이번 세션)
- **`ensureRenewalPayment(sub)` 멱등 헬퍼** — 같은 구독 pending 있으면 재사용, 없으면 sub.price(없으면 플랜표)로 bank_transfer pending 생성.
- **cron 백필 sweep** — past_due/grace 전 구독에 갱신 청구 보장 (전이분 + 레거시 모두 멱등 커버).
- **입금안내 메일 인증 owner 한정** — `notifyRenewalDue` 가 `email_verified_at` 있는 owner 에게만.
- **운영 백필** — biz=1 sub#2(starter 9900) → pending #4 생성, 운영 실 API `/api/plan/1/status` 노출 검증.
- **메뉴 위치 검증** — 워크스페이스 구독·결제·영수증 = 설정 → 구독 플랜(owner). 고객용 "청구 설정" 과 별개.

### 수정된 파일
- `dev-backend/services/billing.js`
- `dev-backend/package.json`, `dev-frontend/package.json` (1.33.2 → 1.33.3)

### 검증
- 헬스 29/29 · grace sub 갱신청구 6/6 · 운영 실 API pending #4 노출 · 배포 검증 3/3

---

## 진행 중인 작업 (다음 섹션 최우선)
- **구독 결제 = "관리자 입금확인" 방식으로 변경 + 배포** (Irene 결정 2026-06-08)
  - 현재: 고객(owner)이 `routes/plan.js:356` mark-paid 를 직접 눌러 활성화 → 증빙 없는 자가확인 (신뢰 공백 + 오활성화 사고 원인)
  - 변경: 고객 화면은 "입금했어요(통보)" 까지 → 상태 "입금 확인 대기중". 실제 활성화는 **플랫폼 관리자**가 `routes/admin.js:498` 에서 입금 확인 후. (markPaymentPaid 시 이미 platform_admin 알림 발송 구조 있음)
  - 가상계좌/오픈뱅킹/카드는 운영 본격화 때 ([[project_billing_automation_scope]] 로드맵)
- **dev 미배포 커밋 같이 배포 예정:** `6c1ba83` 빌링 갱신청구 가드(현재 플랜≠stale 구독 skip). 관리자확인 변경 완료 후 `/배포` 로 한 번에.

## 이번 섹션 운영 사고 + 정정 (완료)
- N+94 빌링 백필이 biz1(워프로랩)의 **stale starter 구독**에 9,900 청구 생성 → 결제 시 basic→starter 오강등.
- 정정 완료(운영): plan basic 복구(만료 6/10), starter sub#2 replaced, pay#4 canceled, plan_history admin_adjust 기록. 라이브 status 검증 OK.
- 가드 코드로 재발 방지(위 6c1ba83, 미배포).

## 다음 할 일
- **운영 피드백 reviewing 10건 기획/개발** (N+92 답변 완료, 개발 대기):
  ID 16#3 재개 버튼 · 14 업무 삭제 · 13 Q docs 리스트·Q info 수정삭제공유 · 12#2 Q Talk 입력란 흔들림 · 11 Q Task 실시간·프로젝트명 변경 · 10 단계 되돌리기 · 9 Q Talk 팝아웃 · 8 활성방 토스터·입장 스크롤 · 7 모바일 채팅 아이콘·간격 · 6 Q info 공유·다중전송·미리보기
- (선택) ProfileIntegrationsPage 의 `window.location.href` full-reload 링크 → SPA navigate

## 환경
- dev: 3003 (dev.planq.kr) / prod: planq.kr 3004 (**v1.33.3**)

## 참고 — 미푸시
- 운영엔 배포됐으나 GitHub `git push origin main` 은 미실행 상태(로컬 커밋만). 필요 시 푸시.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
