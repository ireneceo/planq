# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-25 (Opus 5, 1M) — /개발완료
**작업 상태:** **완료 (Fable 게이트 6회 통과 · 운영 배포 + 백필 완주).** 이번 세션 전건 운영 반영.
**운영 실배포 기준 커밋:** `644ae95`

---

## ⚠️ 배포 시 반드시 수행 (코드 배포로 안 끝나는 것)

- **약관·처리방침 개정 공지 — ⏰ Irene 조치 대기(미완)**
  절차: `docs/LEGAL_UPDATE_2026-08-01_ROLLOUT.md`
  코드는 배포됐고(문구·시행일 2026-08-01 라이브), **공지 노출 + 안내 메일 1회가 남았다.**
  §10 "시행 7일 전 공지" 기준 **마지막 날 = 2026-07-25**. 넘겼으면 공지를 강행하지 말고
  `effectiveDate` 를 공지일+7일 이후로 연기(`PrivacyPolicy.tsx`·`TermsOfService.tsx` 두 파일만).
  **`terms_version`/`privacy_version` 은 올리지 않는다**(재동의 미트리거 — 배포 전후 값 동일 확인).

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 이번 세션에 한 일 (전건 운영 배포 완료 — `644ae95`, 222s)

### 1. ★ #200(b') 메일 참여자 백필 + 쓰기측 정합
- `services/emailAddress.js` 신설 — 주소 포맷 3형태(문자열/`{email,name}`/`{address,name}`) 흡수 단일 원천
- 술어: **계정 주소(+별칭)가 아닌 모든 from/to/cc**. bcc 는 은닉 수신자라 제외
  (Fable 이 최초 술어 "inbound to 를 버리는 비대칭" 을 실측 반려 → 대칭 술어로 개정. 참여자0 운영 235→17)
- **쓰기측 반쪽 해소** — 답장·작성·전달 3경로가 participants 미기록이라 백필해도 재축적되던 구조
- **`email_threads.js:696` 잠복 버그** — `x?.address` 가 저장 shape 을 흘려 별칭 답장 발신주소 선택이 죽어 있었다
- step3 후보 `order last_message_at DESC` (백필이 여는 매칭 표면의 착지점 고정)
- `participantsEqual` — MySQL JSON 키 길이순 재정렬 때문에 stringify 비교가 멱등을 깨던 것
- **운영 백필 완주**: dry-run 952 → 스냅샷 → apply 6s → 재실행 변경 0 → 빈 participants **954→17** · `updated_at` 990/990 보존

### 2. PortOne 걷어내기 (입력 경로만, 이력 보존)
관리자 섹션·GET 응답 필드·PUT 저장 4필드·i18n 키 제거. `Payment.method` ENUM `'portone'`·결제내역 라벨·DB 컬럼은 보존.

### 3. 결제 설정 화면 재구성 ("넣어야 하는 것만 딱" — Irene)
결과→입력 순서: 현황 카드(켜짐/꺼짐 + 부족 항목) → 2단계 체크리스트(Secret·Webhook, 출처·딥링크·엔드포인트 URL 복사) → 계좌이체 → 정책.
**Publishable Key 강등** — Stripe 호스티드 결제라 이 값을 쓰는 코드가 0건(운영에 `irene` 저장돼도 무해했던 이유).
웹훅 URL 은 `window.location.origin` 파생. 입력란 `width:100%`(15개 전부 630px 정렬 실측).

### 4. Stripe 키 형식 검증 + 활성 판정 단일화
`pk_`/`sk_`·`rk_`/`whsec_`, 빈값(삭제) 통과. 프론트+백엔드 양쪽. 활성 판정은 서버 계산 `stripe_enabled` 하나만
(암호화 키 회전 시 거짓 "켜짐" 차단 + 전용 경고).

### 5. 약관·랜딩 사실 정정
`legal.json` ko/en 3곳 교체(계좌이체 경로 신규 기술 · 워크스페이스 Q Bill 구조 = 개인정보처리자가 워크스페이스 운영자 · 미제공 수단 삭제).
랜딩 4곳 — "팝빌 자동발행"(실제는 외부 발행 후 마킹) · 연혁의 "PortOne 라이브"(그 시점에도 거짓) 제거.

**Fable 게이트 6회** (설계 CONDITIONAL PASS ×2 → 구현 FAIL ×2 → PASS). FAIL 사유가 전부 실제 결함:
i18n 래칫 427/426(영어 UI 에 `sk_ 또는 rk_` 한·영 혼합) · 약관 공지 절차 리포 미문서화 · 연혁 거짓 기재.

---

## 📂 다음 할 일 (우선순위)

1. **약관 개정 공지** (위 ⚠️ 섹션) — Irene 조치, 기한 있음
2. **Stripe 키 입력** (Irene) — 카드 결제를 켜려면 **Secret Key + Webhook Secret 2개**만 넣으면 된다.
   Publishable 은 현재 결제 흐름에서 미사용. 웹훅은 **2개 등록**:
   `https://planq.kr/api/stripe/webhook`(PlanQ 구독) · `https://planq.kr/api/stripe/webhook/ws/1`(워프로랩 Q Bill).
   이벤트 둘 다 `checkout.session.completed`, `payment_intent.succeeded`.
   현재 운영에 `stripe_publishable_key='irene'` 가 두 곳(platform·biz1) 저장돼 있어 화면에 형식 경고가 뜬다 —
   **자동 삭제하지 않았다**(사용자 자산). 교체하거나 비우면 된다.
3. **회사 영문명 확정 (Irene)** — 개발자 등록용. 확정 기록 없음.
   한국 법인 국문 = (주)아이린엔컴퍼니(운영 DB 예금주는 "아이린**앤**컴퍼니" — 표기 불일치 정리 필요).
   영문 `Irene & Company Inc.` 는 **설정 화면 placeholder 예시일 뿐 결정값 아님**. 말레이시아 법인 이름 미기록.
   등기부 영문명 확인 후 랜딩 푸터·약관·Stripe 명의 일치시킬 것.
4. **#206** Q Task 보류/외부컨펌 상태 — `tasks.status` ENUM 변경(수동 ALTER 계열). Fable 프로세스
5. **#208** 출퇴근·휴가 관리 — 신규 시스템, Fable 기획설계부터
6. **#211** B2B 에이전시 타깃 기능 제안 · **#192** AiRefineBar · **#193** 캘린더 뒤로가기 · **#146** 검색 헤더 승격
7. **정리 권장:** 리포 루트 `deploy-to-production.sh` 는 운영 경로를 `/opt/planq-prod/` 로 참조하는 **폐기본**
   (이번에 실수로 실행 → 3단계 중단, 운영 무영향). 정본은 `scripts/deploy-planq.sh --auto`

---

## 🔑 환경변수 / 인증 현황

- 운영 = `irene@87.106.78.146` (planq.kr, port 3004, `/opt/planq/backend`, DB `planq_prod_db`). SSH passwordless(read-only 조회).
- **배포 정본: `./scripts/deploy-planq.sh --auto`** (백그라운드 실행 필수 — 포그라운드는 타임아웃 부분배포).
  `DEPLOY_EXIT=1` 은 알려진 부수 신호 — "Deployment Complete" + 3점 실측으로 판정.
- 운영 백업/롤백: `/opt/planq/backups/{TIMESTAMP}` (이번 배포 = `20260725_181050`, participants 스냅샷 포함).
- dev DB 접근 `cd /opt/planq/dev-backend` 후 node. **가드/e2e 는 `cd /opt/planq` 루트** (cwd 틀리면 거짓 FAIL).
- dev 테스트 계정: `admin@test.planq.kr` / `Test1234!` (platform_admin), `health-check@planq.kr` / `HealthCheck2026!`.
  로그인 응답 토큰 필드 = `data.token`. rate-limit 15분 8회.
- dev 는 `EMAIL_SENDING_ENABLED=false` — 메일 발송 정지(흐름은 끝까지 탐).

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
### 참조
- 정책: CLAUDE.md "Fable 검증 게이트" · 메모리 `feedback_fable_all_design_verification`
- 이번 사이클 신규 메모리: `feedback_backfill_needs_write_side_fix` · `feedback_mysql_json_key_reorder`
- 백필 재실행: `cd /opt/planq/backend && node scripts/backfill-thread-participants.js` (dry-run 기본)
