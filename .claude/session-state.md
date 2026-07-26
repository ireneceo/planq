# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-26 (Opus 5, 1M) — 저장
**작업 상태:** **⛔ 미완 — #206 UI/UX 사이클이 Fable 게이트 4차 판정 대기 중.**
약관 시행일 연기(`32af1a2`)는 **운영 배포 완료**. #206 기능(`e180352`)은 게이트 PASS·**미배포**.

---

## ⚠️ 기한 있는 작업 — Irene 조치 대기

- **약관·처리방침 개정 공지 — 마감 `2026-08-03`** (시행일 `2026-08-10` 의 7일 전)
  절차: `docs/LEGAL_UPDATE_2026-08-01_ROLLOUT.md` §2(공지)·§3(안내 메일).
  코드·운영 반영 완료(운영 `/privacy`·`/terms` 에 2026-08-10 라이브, 재동의 미트리거 실측 0명).
  **또 넘기면 시행일을 공지일+7일 이후로 다시 연기**한다 — 두 tsx 의 `effectiveDate` 만.
  `terms_version`/`privacy_version` 은 **올리지 않는다**(운영 실측 `1.0`/`1.0` 유지).

---

## ⚡ 빠른 재개

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 이번 세션에 한 일

### 1. 약관 시행일 연기 — 운영 배포 완료 (`32af1a2`, 211s)
공지 마감(7/25)을 넘겨 `effectiveDate` `2026-08-01` → **`2026-08-10`** (tsx 2줄).
폐기 스크립트 2건 삭제(`deploy-to-production.sh`·`rollback-production.sh`) — 운영에 `/opt/planq-prod` 경로가
**아예 없고** 백업은 tar 형식인데 디렉토리 rsync 를 가정해 실행돼도 롤백 불가였다(Fable 이 운영 SSH 로 반증).
3점 실측 + 재동의 미트리거(버전 불일치 사용자 0명) 확인. Fable 게이트 PASS.

### 2. #206 Q Task 보류/외부컨펌 — 기능 완료 (`e180352`, 미배포)
설계 `docs/TASK_HOLD_EXTERNAL_REVIEW_DESIGN.md` (Fable 설계 게이트).
- ENUM 2값 **끝 append** + `hold_prev_status`/`hold_reason` 2컬럼. 마이그레이션 `scripts/migrate-task-hold-status.js`(멱등 실측)
- 보류는 활성 5+1 단계 어디서든, 해제 시 `hold_prev_status` 복귀(컨펌자 0명이면 in_progress fallback)
- 외부컨펌은 in_progress 에서만 진입/복귀. 보류는 이번 주에서 퇴장, 외부컨펌은 잔류
- **★ `event_type` 은 반드시 `'status_change'`** — `'hold'`/`'resume'` 고유 타입으로 기록하면
  `taskActualHours.js:46` 필터에 안 보여 **보류 시간이 그대로 누적**된다(실측 4.0h vs 정답 3.0h).
  Fable 구현 게이트가 잡은 결함. 보류 구분은 from/to_status 가 담고 타임라인 라벨은 거기서 파생.

### 3. #206 UI/UX 사이클 — **미커밋, 게이트 대기**
설계 `docs/TASK_HOLD_UI_UX_DESIGN.md` (Fable UI/UX 설계 게이트, 표면 19곳 전수 조사).
**Fable 이 찾은 깨진 표면 7곳**: 공개 공유 페이지 raw `on_hold` 노출 · 워크스페이스 주간보고가 보류를
**"수정요청"으로 오표기** · 전역 검색 raw status(기존 전 상태가 그랬음) · QTalk/QMail 우측 dot 회색 폴백 ·
토스터 무반응 · 체크박스 완료 우회 3곳 · 개인 주간보고 코드 노출.
구현: 프론트 16파일 + `EmptyState.ctaTestId` + 백엔드 1건(PUT `hold_reason` 조건부 반영).
- 색만으로 구분 금지 → `StatusGlyph`(보류 `‖` / 외부컨펌 `↗`) 병행. COLOR_GUIDE 등록
- **소실 회귀 방어**: 주간 탭 `보류 N` 칩 + 전용 빈 상태 → 클릭 시 전체 탭+보류 필터 착지
- 배너를 제목 직하로 + `role="status"` + 사유 배너 내 AutoSave 편집. 보류 중 되돌리기 숨김
- 보류+마감지남 = 지연 뱃지 **유지**(보류 ≠ 마감 연장), 진행바 회색 탈색
- en 정정: `External review` / `Put on hold` / `Send for external review`
- 가드 위반 2건을 **베이스라인 대신 코드로** 해결(i18n 래칫 426 유지 · `ProjectTaskList` 798줄)

---

## ⛔ 지금 막혀 있는 것 — 접근성 1항목

**§2-10 "보류 확정 후 [보류 해제]로 포커스 이동"** 이 **3번 연속 죽은 코드**로 판정됐다.
Fable 이 매번 focusin 이벤트를 계측해 `task-resume` 등장 0건을 실증했다.

| 시도 | 방식 | 왜 죽었나 |
|---|---|---|
| 1 | `requestAnimationFrame` | rAF 가 React 커밋보다 먼저 → `querySelector` null |
| 2 | `useRef` 플래그 + `useEffect([status])` | 플래그 세팅이 `await callAction` **이후**라 effect 가 이미 지나감. 게다가 **소비 안 된 플래그가 남아 다음에 연 다른 업무의 포커스를 훔침** |
| 3 (현재) | `useState` 틱 + `useEffect([tick])` | setState 가 새 커밋을 만드므로 배너 커밋 이후 실행 보장 — **4차 판정 대기 중** |

**교훈(다음 세션 필독):** 렌더 후 DOM 을 만지는 코드는 "형태가 맞다"로 통과시키면 안 된다.
반드시 focusin/activeElement 같은 **관측 가능한 신호로 실측**하고, 무력화 빌드와 로그가 갈리는지 본다.
갈리지 않으면 죽은 코드다. `useFocusTrap` 이 첫 tabbable("돌아가기")로 회수해가는 경쟁도 확인 대상.

---

## 📂 다음 할 일 (우선순위)

1. **#206 UI/UX Fable 4차 판정 확인** → PASS 면 커밋 + `/개발완료` 재실행
2. **약관 개정 공지** (위 ⚠️) — Irene, 마감 2026-08-03
3. **#206 `/배포`** — ⚠️ **ENUM 변경이라 순서 강제: DB ALTER → 백엔드 → 프론트.**
   역전하면 새 코드가 옛 ENUM 에 `on_hold` 를 써서 truncation 저장 실패.
   운영 적용: `cd /opt/planq/backend && node scripts/migrate-task-hold-status.js`
4. **★ 시간 엔진 라운드 경계 결함 (별건, 운영 데이터 오염 확인됨)**
   `taskActualHours.js:46` 이 `event_type='status_change'` 만 집계하는데 액션 계층의
   `review_submit`·`completed`·`revision`·`revert`·`approve` 는 전부 고유 타입 → 라운드가 안 닫힌다.
   **운영 실측 3건**: task 24 저장 153.6h vs 실제 2.2h(**+151h**) · task 53 0h vs 67.7h · task 6 0.5h vs 1.0h.
   전부 워크스페이스 1(워프로랩) 내부, 외부 고객 유출 0. dev 영향 0(포커스 사용률이 높아 우선순위 1이 덮음).
   수정 방향: `to_status` 가 있는 전이 행을 경계로 인정 + 오염분 recompute 백필.
   **백필 전 쓰기측 전 경로 확인** 원칙 적용(memory `feedback_backfill_needs_write_side_fix`).
5. **죽은 컴포넌트 정리** — `WeeklyReviewView`/`WeeklyReviewWorkspaceView` 는 import 소비자 0
   (새 보고서 IA 로 대체됨). 이번에 F13/F14 로 고친 게 사실상 죽은 코드였다.
6. **#208** 출퇴근·휴가 (신규 시스템, Fable 기획설계부터) · **#211** B2B 타깃 제안 ·
   **#192** AiRefineBar · **#193** 캘린더 뒤로가기
7. **Stripe 키 입력**(Irene) — Secret + Webhook Secret 2개. 운영에 `stripe_publishable_key='irene'` 잔존(무해)
8. **회사 영문명 확정**(Irene) — 등기부 영문명 확인 후 랜딩 푸터·약관·Stripe 명의 일치

---

## 🔑 환경변수 / 인증 현황

- 운영 = `irene@87.106.78.146` (planq.kr, port 3004, `/opt/planq/backend`, DB `planq_prod_db`). SSH passwordless(**read-only 조회만**).
- **배포 정본: `./scripts/deploy-planq.sh --auto`** (백그라운드 실행 필수 — 포그라운드는 타임아웃 부분배포).
  롤백은 매 배포 끝에 스크립트가 tar 명령을 출력한다(별도 롤백 스크립트는 없음 — 신설 후보).
- 운영 백업: `/opt/planq/backups/{TIMESTAMP}` (이번 = `20260726_141759`).
- dev DB 접근 `cd /opt/planq/dev-backend` 후 node. **가드/e2e 는 `cd /opt/planq` 루트**(cwd 틀리면 즉시 크래시 — 이번에도 겪음).
- dev 테스트 계정: `health-check@planq.kr` / `HealthCheck2026!` (**business 5·73 owner — 실HTTP 검증은 이 계정**).
  `admin@test.planq.kr` / `Test1234!` 는 platform_admin 이지만 **business_members row 가 없어** 워크스페이스 검증 불가.
  로그인 응답 토큰 = `data.token`. rate-limit 15분 8회.
- 업무 PUT 라우트는 `/api/tasks/by-business/:businessId/:id` — `/api/tasks/:id` 는 **404**.
- `users` 비밀번호 컬럼은 `password_hash`. `business_members` 에 `status` 컬럼 없음(`removed_at IS NULL` 로 판정).
- 프론트 타입체크는 `npm run build` 로만(heap 4096). `npx tsc` 는 heap 옵션이 없어 **OOM**.
- dev 는 `EMAIL_SENDING_ENABLED=false`.

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
### 참조
- 정책: CLAUDE.md "Fable 검증 게이트" · memory `feedback_fable_all_design_verification`
- 이번 사이클 설계 문서: `docs/TASK_HOLD_EXTERNAL_REVIEW_DESIGN.md` · `docs/TASK_HOLD_UI_UX_DESIGN.md`
- 마이그레이션 재실행(멱등): `cd dev-backend && node scripts/migrate-task-hold-status.js`
