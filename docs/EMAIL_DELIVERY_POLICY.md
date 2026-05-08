# 메일 발송 정책 — PlanQ 기본 + Custom SMTP (Pro+)

> **합의 (2026-05-08)** — 모든 메일 발송은 PlanQ SMTP 가 default. Pro+ 플랜은 자체 SMTP 등록 가능 (사이클 N+5).

---

## 1. 3 단계

| 단계 | 누가 | 발송자 | 플랜 |
|:-:|---|---|:-:|
| 1 | PlanQ SMTP (default) | `"{워크스페이스 이름}" <noreply@planq.kr>` | All |
| 2 | 워크스페이스 sender 커스텀 | `"{businesses.mail_from_name}" <noreply@planq.kr>` | All (이미 가능) |
| 3 | **Custom SMTP** (사이클 N+5) | `"{회사}" <send@회사도메인.com>` | Pro+ |

## 2. 왜 PlanQ 기본인가

1. **신규 사용자 friction 0** — 가입 즉시 사용. SMTP 설정 X.
2. **Deliverability** — PlanQ SPF/DKIM 검증됨. 신규 도메인은 reputation 0 → 스팸.
3. **브랜드 노출** — 외부 메일 받는 사람도 PlanQ 인지. Free 마케팅.
4. **Data 자산** — bounce / open rate 통계 누적.
5. **Lock-in** — 메일 인프라 PlanQ 의존.

## 3. Custom SMTP (사이클 N+5 Pro+ 기능)

```sql
ALTER TABLE businesses ADD COLUMN smtp_config JSON NULL;
-- { host, port, username, password (encrypted), tls, from_email }
```

- 워크스페이스 설정 → "메일 서버" 탭
- 발송 방식 ⦿ PlanQ 기본 / ○ 자체 SMTP
- 자체 SMTP 시 host/port/user/pass/tls + from_email
- [SPF/DKIM 가이드] [연결 테스트]
- 등록 후 emailService 가 워크스페이스 smtp_config 우선 사용

## 4. 현재 (사이클 N+1) 시점

- PlanQ SMTP 그대로 (이미 됨)
- 워크스페이스 sender 커스텀 (이미 됨)
- 모든 신규 발송 (공유 링크 이메일·청구·서명·등) PlanQ SMTP 사용
- emailWrap layout 통일 (메모리 박제)

## 5. 발송 항목 일관

모든 발송 메일에:
- 헤더: PlanQ 로고 + 워크스페이스 이름
- 본문: 항목별 내용
- 푸터: "이 메일은 PlanQ 에서 발송 — planq.kr"
- 수신 거부 (if applicable)

`services/emailService.js` 의 `emailWrap()` 함수에 통일.
