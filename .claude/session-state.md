# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-05 11:30
**작업 상태:** ✅ 증빙 확인-뷰 배포 완료 (planq.kr, deploy 20260705_120338, commit e2fa7b1)

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 지금 중단 지점

**모두 완료·검증됨. 남은 것은 Irene 의 명시적 /배포 뿐.**

**미배포 배치 (origin/main 대비 5 commits ahead, 미푸시):**
1. `ff43ca8` **초대 고객 채팅+캔버스 근본수정** — 완료 (session-state 옛 최우선작업, 이미 커밋됨)
2. `a17758b` **청구서 이메일 404 근본수정** — 완료 (dev 검증, 미배포)
3. `4c90849` (wip auto-save) **QBill 증빙 발행 신청 "확인-only 뷰"** — 완료·검증됨. 프리필 충분(사업자 등록번호10+상호 / 개인 식별번호8+) 시 읽기전용 요약(confirm), "정보 수정" 토글로 전체 폼(edit). Fable 설계.
   - **실 공개 API 검증:** INV-2026-0018(business) → confirm ✓ · INV-2026-0017(individual, 식별번호 null) → edit ✓. 빌드 EXIT0/TS0, i18n typeRow/editCancel ko/en.
4. **`.env SMTP_FROM` 스팸 fix** (git-ignored, 미커밋) — dev 적용됨. **운영 배포 시 운영 .env 도 같이 변경해야 실제 반영.**

**참고:** M-c + H-f(q-note rate-limit, commit 1bd9e3b) 배포 갈래는 **7/3 운영 배포 완료** (deploy 20260703_155328). 7/3 Mac 세션 SSH 끊김과 무관하게 서버에서 완주됨.

**맥락 유지할 것:**
- **스팸 fix 적용됨(dev, 미배포):** `dev-backend/.env` `SMTP_FROM` `help@planq.kr`→`help@irenewp.com` (인증계정과 정렬 → 사칭플래그 제거 → 스팸 회피). 백업 `.env.bak-smtp-*`. 표시명 "PlanQ" 유지. **운영 .env도 배포 시 같이 바꿔야 실제 반영**(prod는 아직 help@planq.kr = 여전히 스팸). **영구 브랜딩 유지 원하면 planq.kr DKIM(Irene 콘솔: Google관리자 Gmail 이메일인증 DKIM생성 → Cafe24 `google._domainkey.planq.kr` TXT) 켠 뒤 From을 help@planq.kr로 되돌림.** 실측: planq.kr·irenewp.com 둘 다 DKIM 미게시, SPF는 양쪽 있음.
- **청구서 404 fix = a17758b (커밋·푸시됨, 미배포)** — 이메일 링크 `/invoice/{token}`→`/public/invoices/{token}` 7곳 전부 수정 확인. 검증: health29/29·빌드EXIT0·링크grep 7곳✓. 배포 후 INV-2026-0003 고객(jwchoi@kiyul.co.kr) 재발송.
- 옵션 묻지 말고 직접 fix (feedback_no_options_just_fix). 초대고객 캔버스=A 확정.

---

## 📦 최근 세션 작업 요약

- 초대 고객 채팅+캔버스 근본수정 구현·커밋 (ff43ca8)
- QBill 증빙 "확인-only 뷰" 구현·실 API 검증·커밋 (4c90849)
- 스팸 From 정렬(dev .env) · 청구서 404 fix(a17758b)

**미배포 배치:** ff43ca8 + a17758b + 4c90849 + .env SMTP_FROM (전부 dev 검증 완료)

---

## 📂 다음 할 일 (우선순위)
1. **(Irene) /배포** — 초대고객 + 청구서404 + 증빙 확인뷰 + 스팸From 일괄 (운영 .env SMTP_FROM 도 같이 변경)
2. 배포 후 INV-2026-0003 재발송(jwchoi@kiyul.co.kr, 정상 버튼)
3. (Irene) planq.kr DKIM 콘솔 설정 → 이후 From 을 help@planq.kr 로 복귀
4. 운영 백로그: #108·#91·#92·#87·#98·#106(보안)·#97·#100~105 등

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
관련 메모리: `project_email_personal_unify`, `project_smtp_pending`(DKIM), `feedback_project_invite_creates_client`, `feedback_no_options_just_fix`.
운영 백로그 전문: scratchpad/prod-backlog.txt
