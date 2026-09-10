## 이번 세션 (2026-09-10, 두 번째 — /개발시작)

**작업 상태:** 완료 · **운영 배포됨** — v1.48.18 / `aafd1192` / 2026-09-10 11:15 (313s, EXIT 0)
**롤백:** `ssh irene@87.106.78.146 'tar -xzf /opt/planq/backups/20260910_111006/backend.tar.gz -C /opt/planq && pm2 reload planq-prod-backend'`
**주제:** 서버가 만든 글자도 사용자의 언어다 — 영어 사용자에게 통계·Cue 카드가 한국어로 보였다

- 문구를 서버가 **문자열로 완성**해 내려보내고 프론트가 그대로 그렸다.
  i18n 가드는 `dev-frontend/src` 만 훑어 **백엔드 문자열은 처음부터 검사 밖**이었다.
- 프론트 t() 가 답이 아닌 이유: 소비처가 웹 카드 + **PDF 보고서** + **`reports.insights` 박제본** 셋이다.
  `services/notifyTitle.js`(알림 제목)가 같은 이유로 이미 서버 해석을 쓰고 있어 그 선례를 따랐다.
- 계약: 수집부는 `ins()`/`cueCard()` 로 **code + 원시값만**, 응답 경계가 `localize*()` 한 번.
  문자열은 `services/statsInsights.js` **한 파일**에만 (통계 26 + Cue 7 = 33 코드).
- 곁가지로 같이 닫은 것:
  · 통화 `'원'` 하드코딩 (USD 워크스페이스도 '원' 이었다) → `Intl.NumberFormat`
  · 타임존 `'Asia/Seoul'` 고정 → 보는 사람의 `User.timezone`
  · **`req.user.language` 가 아예 안 실려 있었다** — 읽던 곳(`routes/posts.js:477`)은 언제나 'ko'
  · 지출 카테고리 내부 코드(`project_saas`) 가 차트·표·PDF 에 그대로 노출 → `category_label`
  · **죽은 링크 1건** — `/insights?tab=people` 은 앱 화면이 아니라 **공개 마케팅 블로그**(App.tsx)
  · 영어 화면 KPI 가 `0원` → `₩0` (`fmtKRW` 가 '원' 을 무조건 붙였다)
- 신규 하드 게이트 `node scripts/guard-invariants.js --category=statstext` — **반증 12건 전부 빨간불**
- 검증: 실 HTTP 통계 45/45 · Cue 6/6 · 보고서 PDF 8/8 · 전수 렌더 54/54 · 실브라우저 10/10
  게이트: health 41/41 · 가드 42/43(문서 신선도 경고) · e2e tenant 0 · 빌드 EXIT 0 / error TS 0
- ⚠️ **Fable 미검증(자체 검증)** — R=0·F=1 판정(되돌릴 수 있고 기계가 판정한다). 스키마 변경 없음.

### 배포 검증 (2026-09-10 11:20 실측)
- 운영 PM2 `planq-prod-backend` **1.48.18** online (uptime 2m — 새로 떴다) · qnote · mcp 정상
- `https://planq.kr/api/health` ok · 프론트 200 · `index.html` 11:15 갱신(청크 새것)
- 새 파일 착지 확인 `backend/services/statsInsights.js` · `stats.js` 문구 리터럴 **0건**
- 마이그레이션 `review_round` — 컬럼은 이미 있었고 **백필이 이번에 돌았다**(영향 14행 / 전체 16)
- 릴리즈노트 `update-1-48-18` public 발행 · 개발 현황 id=72 발행

### ★ Irene 이 직접 해야 하는 것
**아이폰 앱을 지웠다 다시 설치**해야 설정 > 알림 > PlanQ 에 '사운드' 항목이 생긴다.
iOS 는 최초 인증의 옵션 집합을 고정하므로 이미 설치된 앱에는 항목을 늘려주지 않는다.
**배포는 끝났으니 지금 재설치하면 된다**(순서가 반대면 옛 JS 가 다시 배지-only 로 세운다).

---

## 이어서 한 것 — Google Picker (2026-09-10, **미커밋·미배포**)

**"코드 0줄" 이 아니었다.** 두 벽이 있었고 Irene 이 표준 방식을 골랐다.

- **CSP** — Picker 는 `https://apis.google.com/js/api.js` 가 필수인데 `script-src 'self'` 였다.
  두 벌(nginx snippet · middleware/security.js) 다 넓혔다 + Picker UI iframe 을 위해
  `frame-src` 에 docs/drive.google.com.
- **토큰** — Picker 는 브라우저에서 access token 을 요구한다. `GET /api/drive/picker-token`
  신설: 목록·가져오기와 **같은 함수**(resolveDrive)로 연결 판정, access token 만(refresh 절대 금지),
  만료 60분, 감사 로그, per-user rate limit(분 10 / 일 200).
- **scope 는 걸림돌이 아니었다** — `drive.file` 로 충분하다. Picker 에서 고르는 행위가
  접근을 여는 것이 Picker 의 요점이다. Drive 전체 권한·구글 재심사 **불필요** →
  2026-08-19 "캘린더만으로 검증 제출" 결정과 충돌 없음.
- **AttachmentField 에 Drive 를 다시 넣었다** — 2026-09-07 에 뺀 이유(목록이 곧 Q File 목록)가
  해소됐다. 들여온 결과는 `existingFileIds` 로 들어가 호출부 무변경.
- **문구도 같이 고쳤다** — `attach.drive.empty` 가 "PlanQ 가 볼 수 없습니다" 라고 **단언**하고
  있었다. 동작이 바뀌었으니 그대로 뒀으면 화면이 거짓말을 한다.

### ★ Irene 이 해야 하는 것 — nginx 헤더 적용 (이거 없으면 기능이 안 돈다)
```
sudo /opt/planq/scripts/apply-nginx-security-headers.sh dev
```
lua 에게 sudo 가 없다. **적용 전에는 Picker 가 CSP 에 막힌다**(실측 확인함 — 다만
조용히 죽지 않고 "브라우저가 구글 스크립트를 차단했습니다" 를 화면에 띄운다).
운영 배포 때도 `... prod` 로 같이 적용해야 한다.

### 검증
- picker-token 실 HTTP — 무인증 401 · 타 워크스페이스 403 · rate limit 429 · **refresh/시크릿 유출 0건**
  (응답 raw 전수 스캔) · 발급된 토큰이 **구글에 실제로 통한다**(drive/v3/about 200) · 12/12
- 실브라우저 — Drive 섹션 렌더 · 버튼 431×40 가려짐 없음 · 누르면 **이유를 말한다**
  (CSP 콘솔 차단 1건 = 양성 대조군) · 4/4
- 감사 경로 — retain_until 채워짐(2027-09-10) · 토큰 미기록 · 테스트 행 원복 · 6/6
- health 41/41 · 가드 43/44 · 빌드 EXIT 0 / error TS 0

### ★ 이번에 내가 만든 회귀 — 헬스체크가 잡았다
`AuditLog.create` 를 **직접** 불러 `retain_until` 스탬프와 `maskSensitive` 를 통째로 건너뛰었다.
그 행들은 **영구 보관**된다. 감사 기록의 입구는 `services/auditService.js` 하나다(logAudit).
→ 고쳤고, **정적 가드 신설** `--category=auditentry`(래칫, 반증 확인).

### ⚠️ 드러난 기존 부채 — 손대지 않았다
같은 방식으로 직접 만드는 곳이 **9파일 21건** 더 있었다 (내가 처음 쓴 22건은 주석 줄을 함께 센 것 — Fable 이 실측으로 정정했다)(admin·tasks·focus·leave·
personal_calendar·addonBilling·admin_credits·cue_task_executor·leaveTransition).
그 행들도 영구 보관된다. 래칫으로 **동결만** 했다 — 9파일 리팩터는 Picker 와 무관한 별도 스코프라
Irene 판단이 필요하다.

---

## 이어서 한 것 (2026-09-10, 미배포 커밋 3건)

### ✅ 감사 기록의 입구를 하나로 — **21건이 스탬프 없이 영구 보관되고 있었다**
`AuditLog.create()` 직접 호출은 `retain_until` 스탬프와 `maskSensitive` 를 통째로 건너뛴다.
Picker 작업 중 **내가 같은 실수를 해서 health-check 가 잡았고**, 훑어 보니 9파일 21건이 그 상태였다.
`services/auditService.js` 에 **await 가능한 입구** `writeAudit(opts, options)` 를 추가하고 전부 옮겼다
(호출부가 전부 `await` 이었으므로 **동작 불변** — fire-and-forget 으로 바꿨으면 CLAUDE.md 가
"AuditLog 강제" 라고 박제한 impersonate 의 보장이 사라진다).

단순 치환이었으면 조용히 깨졌을 것 셋:
- **`acting_for_user_id` 를 헬퍼가 안 받았다** — Cue 위임자 기록이 사라질 뻔
- **2번째 인자(Sequelize options)를 삼키고 있었다** — addonBilling 2곳이 `{ transaction: t }` 를 넘긴다.
  삼키면 본 작업이 롤백돼도 감사 행만 남는다(없던 일이 원장에 있는 상태)
- **`routes/admin.js` 에 import 가 안 들어갔다** — 문법검사·빌드·부팅 전부 통과하고 **그 분기만 죽는다**.
  실 HTTP 로 태워서 잡았다(`tasks.js` 주석이 정확히 그 경고를 하고 있었다)

신규 래칫 가드 `--category=auditentry` — **0 으로 조였다**(반증 확인).

### ✅ 발행인데 발행시각(`issued_at`)이 없는 청구서
비면 금액이 멀쩡해도 **발행 청구액 통계에서 조용히 빠진다.** 백필 대상이 아니라 **쓰기측**이 문제였다 —
채우는 술어가 4곳에 흩어져 있고 그중 하나는 `sent_at` 이 이미 있으면 안 채운다.
→ `models/Invoice.js` `beforeSave` 훅 한 곳에서 보장(draft·canceled 제외).
★ 시각은 `new Date()` 가 아니라 **sent_at → created_at** — '지금' 을 박으면 과거 발행분이
이번 달 매출로 옮겨간다. 실측 #79 는 6/13 으로, #11(canceled)은 NULL 유지. 양방향 반증 6/6.

### ✅ 좁은 데스크탑 카드 최소폭 — **이상 없음으로 확정**
1025px 최소 174px · 1280px 259px · 1680px 291~392px, 가로 스크롤 0.
★ 처음엔 구조 휴리스틱이 엉뚱한 요소를 집어 **1680px 에서도 114px** 이 나왔다.
`KpiCard` 에 `data-kpi-card` 표식을 달아 코드와 같은 렌즈로 재게 했다.
★ 그 과정에서 **빌드가 EXIT 2 인데 검사기가 "카드 0개" 를 25/25 초록으로 셌다** —
빈 결과를 통과로 세지 않도록 고쳤다.

### 다음
1. 남은 것: 프로젝트 "주요 이슈" 자동화(설계·승인 필요) · Google Picker(코드 0줄) ·
   좁은 데스크탑 카드 최소폭 실측 · 발행인데 `issued_at` 없는 청구서(운영 0건/dev 2건)
4. ★ **발견하고 안 고친 것** — `OverheadItem`·`ProjectExpense` 를 만드는 **라우트도 화면도 없다**.
   그래서 Finance 탭의 '고정비'·'지출' 은 구조적으로 영원히 0 이다. 별도 판단 필요.

---

## 현재 작업 상태
**마지막 업데이트:** 2026-09-10 (Opus 5, 1M)
**작업 상태:** **완료 · 미배포**
**커밋:** `634aca5f`(앱·채팅·결과물) + `71460102`(메일·통계·팝아웃·검색) + 이번 정리 커밋
**배포:** ❌ 하지 않음 — 운영은 여전히 **v1.48.17**. Irene 이 `/배포` 하면 나간다.

### 진행 중인 작업
- 없음

---

## 이번 세션에 한 것 (Irene 신고 8건 묶음)

1. **아이폰 알림에 Sounds 항목이 없던 것** — 권한을 요청하는 코드가 둘인데 하나가 **배지만** 요청한다.
   `@capawesome/capacitor-badge` 의 `Badge.set()/clear()` 는 호출마다
   `requestAuthorization(options: .badge)` 를 부르고(BadgePlugin.swift:64,100 · Badge.swift:27),
   우리는 그것을 확인필요·안읽음 숫자가 바뀔 때마다 부른다. iOS 는 **최초 인증의 옵션 집합을 고정**한다.
   → 배지는 푸시 권한 granted 일 때만 · `registerNative` 는 denied 아니면 항상 한 번 요청.
   서버 payload(`aps.sound='default'`)·foreground 옵션·entitlement 는 **원래 정상**이었다.
   ★ **앱 재빌드 불필요**(원격 껍데기). 단 **이미 설치된 기기는 iOS 가 옵션을 안 늘려주므로 재설치 필요** —
     순서가 중요하다: **배포 먼저 → 그다음 앱 삭제·재설치**(반대로 하면 옛 JS 가 다시 배지-only 로 세운다).
2. **채팅방을 열면 맨 아래가 아니던 것** — 시간창(2.5초)·증감방향(`grew`)·거리(240) 세 갈래 추정을
   **상태 하나(pin)** 로. 해제는 사람의 제스처만. 복원이 과거 페이지를 버리지 않는다.
   신규 카나리 `--suite chatbottom` 15/15(양성 대조군에서 3건 빨간불 확인).
3. **결과물 회차(#257)** — 버전 번호와 컨펌 라운드가 **두 계산기**라 승인/수정요청이 남의 회차에 붙었다.
   `review_round` 컬럼 + 백필(멱등, 배포 파이프라인에 코드보다 먼저). 카드에서 대화 텍스트 제거.
4. **메일 규칙** — 만들어도 **이미 받은 메일에 안 먹던 것**을 소급 적용으로. 되돌리기는 verdict 별로
   (확인권장 규칙을 지웠는데 답변필요가 켜지면 안 된다). 설정에 판정 기준 설명 + 프리셋 + **저장 전 미리보기**.
5. **임시 답변** — 답장 화면 맨 아래 체크박스(**기본 꺼짐**) → `reply_needed_reason='holding'` 으로 남고
   목록에 "임시답변" 칩. 재판정이 지우지 않는다.
6. **통계 카드 줄** — 열 6 고정 → 카드 수로 균형. 마지막 줄은 남은 칸을 채운다. 숫자는 clamp.
7. **통계 숫자 검증 — 결함 1건** — 업무 탭 완료 수가 `created_at` 집합에서 세어져 **기간 전 생성·기간 내 완료**가
   빠졌다(개요 가동률은 completed_at 기준 → 두 탭이 다른 공식). 라우트가 두 축으로 가져오게 고침.
8. **팝아웃 시작/중지** · **검색으로 연 항목이 목록에서 보이게**(공용 훅) · **문서 "공유 중" 칩 좌측으로** ·
   **SNS 미리보기**(서버는 최신 제목을 준다 — SNS 캐시라 "SNS용 링크 복사"로 키를 바꾼다).

---

## ▶ 다음 할 일 (Irene: "남은 거 다음섹션에 할게")

### 1. 배포 여부 결정
미배포 커밋 3건이 쌓여 있다. `/배포` 하면 마이그레이션(`migrate-deliverable-review-round.js`) → 코드 순.
★ **아이폰 소리 수정은 배포해야 효과가 있다**(그 뒤 앱 재설치).

### 2. 프로젝트 "주요 이슈" 자동화 — **답: 지금은 100% 수동이다**
> Irene: "채팅 많이 해도 주요이슈에 남는게 없네 … 지금 채팅이나 여기 저기 있는 주요이슈가 자동 아니야?"

`ProjectIssue` 를 만드는 곳은 **수동 POST 2곳뿐**(`routes/projects.js:2572,3082`)이고 메일에서 손으로
추가하는 경로 하나(`routes/email_threads.js:1961`). 자동 추출은 **업무 후보(task_candidates)** 에만 있다.

제안한 설계(2단):
- **(a) 기계가 아는 것부터 — LLM 0.** 업무 완료·지연, 새 문서·파일, 청구 발행·입금, 단계 전환
  (`project_stages`), 마감 변경 → 이미 DB 에 있는 사실이다. "주요 이슈" 가 아니라 **"이번 주 이 프로젝트에
  일어난 일"** 로 정직하게 부르고, 사람이 그중 하나를 이슈로 승격한다.
- **(b) 대화에서 뽑은 결론 — 후보로만.** "오픈일 X", "계약 진행 중" 같은 것은 LLM 으로 뽑되
  `task_candidates` 와 같은 방식으로 **후보**로 쌓고 사람이 확정한다. 바로 쓰면 틀린 이슈가 원장에 남는다.
- 규모: 중~대(새 추출 파이프라인 + 후보 UI). **Irene 승인 후 착수.**

### 3. 마저 못 본 것
- **통계 인사이트 카드 문구가 서버 하드코딩 한국어**(`services/stats.js` '연체 청구'·'가동률 초과'…) →
  영어 사용자에게 한국어가 보인다. i18n 키 계약이 필요(프론트 렌더는 `{ins.title}` 그대로).
- **좁은 데스크탑(1025~1280) 카드 최소폭** 재확인 — 마지막 줄 span 적용 뒤 실측을 한 번 더.
- 운영 데이터 불변식: 발행(초안 아님)인데 `issued_at` 없는 청구서 → 발행 청구액에서 조용히 빠진다
  (**운영 0건**, dev 2건).

### 4. 앞 세션에서 넘어온 것 (그대로)
- **Google Picker 붙이기** — 키 배선 완료(`VITE_GOOGLE_PICKER_API_KEY`·`VITE_GOOGLE_APP_ID`),
  Irene 이 API 키 리퍼러 제한 저장 완료("했어. api."). 코드는 0줄 — `AttachmentField.tsx:213` 주석 자리.
- **#407 나머지 두 축**(대화방 접근 좁히기 · 본문 암호화) — 둘 다 R=1, Irene 결정 대기
- **#381·#382 Q sale** — 설계 v2 재검토 먼저 권고
- **Fable 게이트 대기열** `docs/FABLE_GATE_QUEUE.md` — 5건 + 이번 회차 스키마 변경(review_round)

---

## 게이트 상태 (개발완료 시점)
- health-check **41/41** · 불변식 가드 **41/42**(미통과 1 = 문서 신선도 경고 전용) · e2e `tenant` 실패 0
- 빌드 **EXIT 0 / error TS 0**
- 실 API 검증: 결과물 회차 15/15 · 백필 6/6 · 메일 규칙 11/11 · 임시답변 3/3 · 통계 숫자 15/16(위 §3)
- 실브라우저: 신규 카나리 `chatbottom` 15/15 · 통계 7탭 × 7뷰포트 실측
- ⚠️ **Fable 미검증(자체 검증)** — 토큰 없음. 스키마 변경(R=1)이라 대기열에 올려야 한다.

## Git 상태
- `main` 커밋 완료 · 워킹트리 깨끗 · **로컬이 origin 보다 앞섬**(푸시는 아래 단계에서)

## 복구 가이드
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
운영이 이상하면 이번 세션 것이 아니다 — **배포한 적이 없다**(운영 = v1.48.17).
