# 약관·개인정보처리방침 개정 (시행 2026-08-01) — 운영 배포 절차

> 작성 2026-07-25. **코드 배포만으로 끝나지 않는다** — 아래 공지 절차가 남는다.
> 처리방침 §10 이 "변경 시 시행 7일 전 공지·이메일 안내"를 자기 규정으로 두고 있어 **기한이 걸린 작업**이다.

## 무엇이 바뀌었나

결제대행사 기재를 **실제 제공 중인 수단**에 맞게 정정했다. PortOne(아임포트)은 도입한 적이 없다
(`payments.method='portone'` row dev·운영 **0건**, 채널키 한 번도 미설정).

| 위치 | 변경 |
|---|---|
| `privacy.s1.items[3]` | 카드=Stripe 직접 처리 + **계좌이체 시 입금자명·금액만 확인, 계좌정보 미수집** 추가 |
| `privacy.s3.items[4]` | PortOne 제3자 제공 항목 → **워크스페이스 Q Bill 카드결제 구조**로 교체(개인정보처리자 = 워크스페이스 운영자) |
| `terms.s3.items[1]` | 카카오페이·네이버페이 등 미제공 수단 삭제 → **계좌이체 + Stripe(제공되는 경우)** |
| `PrivacyPolicy.tsx` · `TermsOfService.tsx` | `effectiveDate` `2026-04-22` → **`2026-08-01`** |

ko/en 양쪽 동일. 배열 인덱스 유지(교체이지 삭제 아님).

## ★ 약관 버전은 올리지 않는다 (재동의 미트리거)

`platform_settings.terms_version` / `privacy_version` 을 **건드리지 않는다.** 값이 바뀌면 전체 사용자에게
재동의 모달이 뜬다. 이번 변경은 제3자 제공의 **축소·정정**이고 포트원 제공 이력이 0건이라 이용자 권리
변화가 없다 — §10 기준의 '중요한 변경'(이용자에게 불리한 변경)이 아니다.

**배포 전후 확인 (실수 bump 차단):**
```sql
SELECT terms_version, privacy_version FROM platform_settings;   -- 배포 전후 동일해야 함
```

**이 판단이 뒤집히는 조건** — 하나라도 해당하면 그때는 버전 올리고 재동의를 받는다:
1. 새 PG·제공처 실제 도입 (포트원 재도입, 카카오페이 등)
2. 수집 항목 확대
3. Q Bill 구조가 바뀌어 PlanQ 가 워크스페이스 고객의 결제 개인정보를 **수탁 처리**하게 될 때
4. 국외 이전 대상 추가

## 배포 시 수행 (순서)

### 1. 코드 배포
`deploy-planq.sh` — locales·프론트 반영. DB 스키마 변경 0.

### 2. 개정 공지 노출 (1회) — **시행일 7일 전까지**
플랫폼 관리자 → 공지 설정에서 `announcement_text` 설정:
- ko: `개인정보처리방침·이용약관이 2026-08-01 자로 개정됩니다. 결제대행사 기재를 실제 제공 중인 수단(계좌이체·Stripe)에 맞게 정정했습니다.`
- `announcement_severity`: `info` / `announcement_dismissible`: `true`

### 3. 개정 안내 메일 (1회)
활성 사용자 대상. 기존 `sendEmail` 게이트 경유(예약 TLD·미인증 주소 자동 skip).
발송 후 `EmailLog` 에서 `status='sent'` 확인.
**dev 는 `EMAIL_SENDING_ENABLED=false` 라 발송되지 않는다 — 운영에서만 확인 가능.**

### 4. 시행일 표기 확인
`/privacy`·`/terms` 를 ko/en 양 언어로 열어 시행일 **2026-08-01** 표시 확인.

### 5. 시행일(2026-08-01) 경과 후
`announcement_text` 를 비운다(공지 목적 달성).

## 검증 항목 (배포 후)
- [ ] `terms_version`/`privacy_version` 배포 전후 동일
- [ ] 기존 사용자 로그인 시 재동의 모달 **미발생**
- [ ] `/privacy`·`/terms` ko/en 신규 문구 3곳 + 시행일 2026-08-01
- [ ] legal.json ko/en 에 `포트원|PortOne|아임포트|Iamport|카카오페이|KakaoPay|네이버페이|Naver Pay` 잔존 0건
- [ ] 공지 노출 + 안내 메일 `EmailLog status='sent'`
