# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-05 04:35
**작업 상태:** 중단 (이어서 재개 예정) · **미배포 3건 대기**

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 지금 중단 지점

**마지막 작업:** 초대 고객 캔버스/채팅 안 됨 버그 — **진단 완료, 코드는 아직 안 들어감**. 모델 필드 읽던 중 중단.

**바로 다음 작업 (재개 시 첫 할 일):**
1. **초대 고객 채팅 fix 구현** — `routes/invites.js` project_client accept 블록(112-145). 문제: workspace_client는 `ensureWelcomeConversation`(services/clientOnboarding.js) 호출해 대화방+참여자 보장하는데 **project_client는 안 함** → 프로젝트 초대 고객이 /talk 착지 시 빈 채팅. **수정:** commit 후 pc.client_id 있으면 `ensureWelcomeConversation(client)` 호출(workspace_client 패턴 대칭) + 기존 project customer 대화방에 client_id(null일때만)+participant(role 'client') 등록. pc.client_id null(프로젝트 생성경로)이면 contact_name/contact_email로 Client findOrCreate. **멀티테넌트: 반드시 그 프로젝트/비즈니스 대화방만.**
2. **초대 고객 캔버스 fix (옵션 A 확정)** — 캔버스 API는 client role 403(`routes/projects.js:1174`, 정상 유지). 프론트 `QProject/QProjectDetailPage.tsx`(탭 기본 'dashboard'=캔버스, 87-88/379)에서 **client role이면 캔버스 탭 숨기고 허용 탭(문서/업무요청/채팅)으로 기본**. `my_role_in_project`(GET /:id 응답 320)로 게이트.
3. **검증(/검증 진행 중이었음)** → **배포(/배포)**: 스팸From정렬 + 청구서404 + 초대고객 3건 한 번에.

**맥락 유지할 것:**
- **스팸 fix 적용됨(dev, 미배포):** `dev-backend/.env` `SMTP_FROM` `help@planq.kr`→`help@irenewp.com` (인증계정과 정렬 → 사칭플래그 제거 → 스팸 회피). 백업 `.env.bak-smtp-*`. 표시명 "PlanQ" 유지. **운영 .env도 배포 시 같이 바꿔야 실제 반영**(prod는 아직 help@planq.kr = 여전히 스팸). **영구 브랜딩 유지 원하면 planq.kr DKIM(Irene 콘솔: Google관리자 Gmail 이메일인증 DKIM생성 → Cafe24 `google._domainkey.planq.kr` TXT) 켠 뒤 From을 help@planq.kr로 되돌림.** 실측: planq.kr·irenewp.com 둘 다 DKIM 미게시, SPF는 양쪽 있음.
- **청구서 404 fix = a17758b (커밋·푸시됨, 미배포)** — 이메일 링크 `/invoice/{token}`→`/public/invoices/{token}` 7곳 전부 수정 확인. 검증: health29/29·빌드EXIT0·링크grep 7곳✓. 배포 후 INV-2026-0003 고객(jwchoi@kiyul.co.kr) 재발송.
- 옵션 묻지 말고 직접 fix (feedback_no_options_just_fix). 초대고객 캔버스=A 확정.

---

## 📦 이번 세션 작업 요약

- 스팸 원인 진단 + dev 즉시처방(From 정렬) 적용
- 초대 고객 캔버스/채팅 버그 근본원인 규명(Explore)
- 청구서 404 fix 검증(3차 세션 커밋 a17758b)

**커밋:** a17758b fix(qbill) 청구서 이메일 404 (미배포) · .env 변경은 git-ignored(미커밋)

---

## 📂 다음 할 일 (우선순위)
1. 초대 고객 채팅+캔버스 fix 구현 → 검증
2. 배포: 스팸From + 청구서404 + 초대고객 (운영 .env SMTP_FROM도 같이 변경)
3. 배포 후 INV-2026-0003 재발송
4. (Irene) planq.kr DKIM 콘솔 설정 → 이후 From을 help@planq.kr로 복귀
5. 운영 백로그: #108·#91·#92·#87·#98·#106(보안)·#97·#100~105 등

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
관련 메모리: `project_email_personal_unify`, `project_smtp_pending`(DKIM), `feedback_project_invite_creates_client`, `feedback_no_options_just_fix`.
운영 백로그 전문: scratchpad/prod-backlog.txt
