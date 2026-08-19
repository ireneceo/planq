# Gmail OAuth 재활성화 복원 절차

> **왜 꺼져 있나** — 2026-08-19, Irene 결정. Google OAuth 검증을 **캘린더만으로** 제출하기 위해
> `https://mail.google.com/`(RESTRICTED scope)을 Cloud Console 에서 제외했다. 이 scope 가 남아 있으면
> **CASA 보안 평가**가 붙어 심사가 몇 달 단위로 늘어난다.
>
> **끈 것은 "새 동의 요청" 뿐이다.** 기존 연결의 토큰 갱신·메일 수신·발송은 그대로 동작한다.
> Gmail 계정은 **앱 비밀번호(IMAP/SMTP)** 로 계속 연결할 수 있다 — 그쪽이 현재 기본 경로다.
>
> **이 문서는 나중에 Gmail OAuth 를 다시 켤 때 빠뜨리는 곳이 없게 하려고 만든다.**
> 켤 준비가 됐다면 아래를 **순서대로** 하고, 각 항목을 실제로 확인한 뒤 다음으로 넘어간다.

---

## 0. 선행 조건 (이게 안 끝나면 아래를 하지 말 것)

- [ ] **Google Cloud Console 에 `https://mail.google.com/` 재등록** 후 **CASA 보안 평가 통과**.
      Console 에 없는 scope 로 동의 화면을 띄우면 사용자는 "액세스 차단됨: 승인되지 않은 요청" 만 본다.
      코드를 먼저 켜면 그 화면을 사용자가 보게 된다 — 순서를 지킬 것.
- [ ] Redirect URI `https://planq.kr/api/businesses/email-accounts/oauth/gmail/callback`
      (+ dev 대응분) 이 Console 에 그대로 있는지 확인. 끌 때 지우지 않았으므로 보통 그대로 있다.

## 1. 코드 — 켜는 스위치는 두 개다

| # | 파일 | 지금 | 바꿀 값 |
|---|---|---|---|
| 1 | `dev-backend/services/googleScopes.js` | `const OAUTH_CONSENT_DISABLED = new Set(['gmail']);` | `new Set([])` — 집합에서 `'gmail'` 만 뺀다 |
| 2 | `dev-frontend/src/pages/Settings/EmailAccountSettings.tsx` | `const GMAIL_ONECLICK_ENABLED = false;` | `true` |

- **1번이 서버측 단일 원천이다.** 이 집합을 보는 곳은 `routes/external_connections.js`(개인 OAuth
  initiate)와 `routes/email_oauth_gmail.js`(회사 OAuth initiate) 두 곳뿐이다. 가드 코드는 지우지 말 것 —
  집합만 비우면 자동으로 통과한다. 다음에 다시 꺼야 할 때 같은 스위치를 쓴다.
- **2번은 화면 노출 스위치다.** false 인 동안 "원클릭 연결" 버튼과 재연결 CTA 가 숨겨지고,
  사용자는 앱 비밀번호 경로로 안내된다.

## 2. 개인정보처리방침 문구

`dev-frontend/public/locales/{ko,en}/legal.json` 의 **Gmail 조항**.

- 2026-08-19 시점 문구는 `mail.google.com 범위 · OAuth 토큰` 을 명시하는데, **그때는 사실이 아니었다**
  (연결이 앱 비밀번호였다). Fable 판정: 요청하지 않는 restricted scope 를 방침이 선언하면 심사 마찰이 된다.
- 그래서 **연결 방식에 의존하지 않는 문구**로 바꿔 둔다. OAuth 를 다시 켜도 **고칠 필요가 없게** 쓰는 것이
  이 항목의 목적이다:
  - ko: `이메일 주소, 메일 내용 및 첨부파일, 접속 자격증명(앱 비밀번호는 암호화 저장, OAuth 연결 시 OAuth 토큰)`
  - en: `email address, mail contents and attachments, access credentials (app passwords stored encrypted; OAuth tokens when connected via OAuth)`
- 즉 **1·2번을 되돌릴 때 이 문구는 손대지 않아도 된다.** 손대야 한다고 느껴지면 문구가 잘못 쓰인 것이다.

## 3. 되돌린 뒤 반드시 확인할 것

- [ ] 개인 Gmail 동의 요청: `POST /api/me/oauth/google/initiate {provider:'gmail'}` → **200 + auth_url**
      (끄기 상태에서는 400 `oauth_disabled_for_provider`)
- [ ] 회사 Gmail 동의 요청: `GET /api/businesses/:id/email-accounts/oauth/gmail/initiate` → **200**
- [ ] auth_url 에 `mail.google.com` 포함 · `access_type=offline` · `prompt=consent`
- [ ] **과잉 활성 반증** — 캘린더·Drive initiate 가 여전히 정상 200 인지 (같이 망가뜨리지 않았는지)
- [ ] 실제 동의 → 콜백 → `email_accounts` row 의 `auth_type='google_oauth'` + 토큰 암호화 저장
- [ ] 앱 비밀번호로 연결된 기존 계정이 그대로 수신되는지 (두 경로 공존)

## 4. 지금 살아 있는 OAuth Gmail 연결 (2026-08-19 운영 실측)

- `minky3018@gmail.com` (business 5 · `auth_type='google_oauth'` · 활성)
- 이 계정의 **토큰 갱신·수신 경로는 이 스위치를 지나지 않는다** → 끈 상태에서도 계속 동작한다.
- 다만 토큰이 만료·취소되면 **재연결이 불가능**하다. 그때는 앱 비밀번호로 재연결하면 된다.
- 되돌린 뒤에는 OAuth 재연결이 다시 가능해진다.

## 5. 관련 파일 한눈에

```
dev-backend/services/googleScopes.js        ← 스위치 ①  (OAUTH_CONSENT_DISABLED)
dev-backend/routes/external_connections.js  ← 개인 initiate 가드 (수정 불필요)
dev-backend/routes/email_oauth_gmail.js     ← 회사 initiate 가드 + 콜백 (수정 불필요)
dev-frontend/src/pages/Settings/EmailAccountSettings.tsx  ← 스위치 ②  (GMAIL_ONECLICK_ENABLED)
dev-frontend/public/locales/{ko,en}/legal.json            ← 방침 문구 (되돌릴 때 손대지 않는다)
```
