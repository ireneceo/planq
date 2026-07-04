# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-04 (Opus 3차)
**작업 상태:** 완료 · **dev 반영·검증 완료, 운영 미배포 (배포 명령 대기)**

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션 — 2026-07-04 3차, Q Bill 청구서 이메일 실사고 대응)
- **청구서 이메일 버튼 404 근본수정** — 이메일 버튼이 `/invoice/{token}`(없는 경로)로 걸려 404. 실제 라우트는 `/public/invoices/{token}`. 계정/로그인 무관(share_token이 인증). 4곳 수정: `services/clientSubscriptionBilling.js`·`services/recurring_invoice.js`·`services/overdue_handler.js`·`routes/invoices.js`(send-reminder). 운영 실토큰 HTTP200 검증.
- **청구서 상세에 "발송 이메일" 표시** — `InvoiceDetailDrawer.tsx` 수신 카드에 발송 대상 이메일 상시 표시(recipient_email→client 이메일 폴백), 없으면 "이메일 없음·발송 불가". i18n ko/en.
- **"열람" 신뢰성 — 내부 조회 제외** — 공개 GET에 `optionalAuth` 추가, 멤버/platform_admin 조회는 viewed 미기록(고객 조회만). 프론트 `PublicInvoicePage` fetch→apiFetch. 실 HTTP 검증(외부 기록✓/내부 0건✓).
- **검증:** 헬스 29/29 · 프론트 빌드 EXIT0/TS0(built 1.20s) · 백엔드 문법·JSON 유효 · dev health 200.

### 미해결·후속 (선택/외부작업)
- **DKIM 미설정(메일 정크 근본 후보):** SMTP From=help@planq.kr인데 gmail(help@irenewp.com) 인증 + planq.kr DKIM 없음 → 외부 스팸격리 위험. **Google 관리자 콘솔서 planq.kr DKIM 생성 + Cafe24 TXT 게시(Irene 몫).** 상세 memory `project_smtp_pending`.
- **운영 배포 대기:** dev 검증 완료. `/배포` 시 → 이후 **INV-2026-0003 고객(jwchoi@kiyul.co.kr) 재발송**(정상 버튼).
- MEMORY.md 182줄 — 다음 세션 <140줄로 압축(hook 권고).

### 다음 할 일 (운영 백로그 남은 것)
- **Q Bill** #108 정기청구 알림·상태 / #91 결제완료 버튼 / #92 정기발송 표시 · **표시명** #87·#98 · **파일** #106 나만보기 유출(보안)·#97 이미지 리사이즈 · **통계** #100·101·103·105 주간그래프 · **Cue** #81·#90 외

---

## 복구 가이드

새 Claude 세션 시작 시:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

관련 메모리: `feedback_notify_link_must_match_route`, `project_smtp_pending`(DKIM 갭), `feedback_no_options_just_fix`.
