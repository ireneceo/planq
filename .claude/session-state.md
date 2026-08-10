# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-10 19:20 UTC (Opus 5, 1M)
**작업 상태:** **완료 · 전부 운영 배포됨** (10커밋, `origin/main` push 완료)

> ## ⚠️ 이 파일이 낡으면 Fable 이 오판한다
> 지난 세션에서 Fable 이 옛 내용을 읽고 잘못 판정한 전례가 있다. 청크를 끝낼 때마다 갱신할 것.

---

## 🔴 다음 세션에서 가장 먼저 볼 것

### 1. Irene 이 해야 할 운영 조치 — Google 캘린더 재연결 (심사 선행조건)

운영 워크스페이스 연동 토큰에 **캘린더 권한이 없다.**
```
business_cloud_tokens  biz=1 provider=gcal
  scope=[userinfo.email  openid]        ← calendar.events 없음
  account_email=han.sj.lua@gmail.com
  last_error="Request had insufficient authentication scopes." (2026-07-31)
```
동의 화면이 항목별 체크박스라 "캘린더" 를 안 누르면 이렇게 저장된다. **코드로 못 고친다 — 재연결해야 한다.**
- **오너만 가능** (`routes/cloud.js requireOwnerForCloud` — owner 또는 platform_admin). 팀원은 403.
- **개인 연동은 별개다** — `/me/oauth/google/initiate` 는 `authenticateToken` 만 요구.
  운영 `external_connections` 2건(irene·lua) 모두 `calendar.events` 보유 → **팀원이 개인 계정으로 테스트하는 건 재연결 없이 지금도 된다.**
- Meet 링크 **실제 발급**은 아직 아무도 검증 못 했다(권한이 없어 시도 불가였음). 재연결 직후 실측할 것.

**심사 순서:** ①배포(완료) → ②재연결+캘린더 체크 → ③동영상 → ④제출
**심사 대상 스코프는 `calendar.events` 하나.** `drive.file` 은 비민감이라 대상 아님.
**Gmail restricted(`mail.google.com`) 제외 방침** — CASA 유료·매년 갱신인데 운영 사용처가 1계정(withMIN lab)뿐이고, Irene 본인 2계정은 이미 앱 비밀번호로 정상 동작 중.

### 2. 청크 2 — OAuth 권한 상태 표시 (Irene 요구 ③, 설계 승인 완료)

Irene 요구 3절 중 **①저장 측·②관측 측은 배포됐고 ③표시 측이 남았다.**
지금은 **이미 권한 없이 저장된 연결**(위 gcal)이 화면에서 여전히 "연동됨" 처럼 보인다.

Fable 확정 절단면 (설계 게이트 CONDITIONAL 승인):
- `services/externalConnectionSerializer.js` — `can_write_calendar` 를 provider-agnostic `permission_status`(`ok`|`read_only`|`insufficient`|`error`) 파생으로 확장. `googleScopes` + `last_sync_error` 기반. 기존 필드는 호환 유지
- `pages/Profile/ProfileIntegrationsPage.tsx` — 캘린더·드라이브 카드에 상태 뱃지 + `last_sync_error` 시 "다시 연결" CTA. 기존 `StatusBadge`/`ReconnectHint` 패턴 재사용(bespoke 금지). interface 에 필드 추가
- i18n profile ko/en **4상태** — 정상 / 읽기 전용(옛 readonly 보유) / 권한 부족(grant 전무) / 오류·만료.
  **★ "읽기 전용" 으로 뭉개면 안 된다** — 권한 전무인 연결에 그렇게 쓰면 읽기도 안 되는데 된다고 거짓 안내가 된다. `hasCalendarReadOnly` 로 구분
- **워크스페이스 카드는 이미 완료·배포됨**(`StorageSettings.tsx` `gcalBroken` 뱃지+재연결). 표적은 **개인 카드**
- 검증: dev row 의 scope 를 일시 조작해 4상태 실브라우저 확인 후 **원복**. DB 변경·마이그레이션 없음
- **위키 갱신도 이때 같이** (이번 사이클은 화면 변경이 없어 스킵했다)

### 3. 운영 미처리 피드백 **36건** (운영 DB 직접 조회)
```bash
ssh 87.106.78.146 'cd /opt/planq/backend && node -e "…FeedbackItem status not in (done,wontfix)…"'
```
신규(지난 목록에 없던 것): **#238**(Cue 업무추가 기능 산재) **#258**(팝아웃 핀) **#259**(채팅방 링크 — 고객 로그인 없이 접근) **#260**(메일 상세 풀버전/팝업) **#261**(메일 발신·수신 주소 기준 리스트업)
같이 볼 것: **#254 + #255** (같은 화면 주간 진척 그래프의 모순 신고) · **#256**(첨부가 업무결과물 아래로) · **#257**(문서 리스트가 열람만 해도 최신으로)
Irene 이 "fable 과 상의" 명시한 11건: #211 #213 #228 #229 #230 #233 #235 #236 #237 #239 #240

---

## ✅ 이번 세션 완료 (2026-08-10)

### 배포 1 — 미배포 9커밋 (`cc35d8f`, 백업 `20260810_175853`)
청크 A(#217a 증빙 뱃지·#241 번역 게이트·PWA 개행) · 청크 B(#221 메일 판정) · 청크 C(#217b 증빙 알림 메일) · 자동저장 재설계 · 죽은 SPA 링크·Google 스코프 방침 정정 등.

- **청크 C 게이트 PASS** — 5경로 실HTTP 15회(발행 4 + 정정 1 × 기본/false/true), 화면 표시 주소 == 실제 발송 주소, `notify_customer:false` 여도 팀 알림·타임라인 생존, 실발송 0, 커밋본 worktree 단독 빌드 `EXIT=0`, 반증 3건.
  **★ 게이트가 내 절차 결함을 잡았다** — 커밋 메시지의 "검증 데이터 전부 원복" 이 거짓이었고, 잔존 청구서 7건이 health-check 의 청구 원장 가드를 FAIL 로 깨뜨린 상태였다. **원복 주장은 정리 후 health-check 재실행으로 증명할 것.**
- **마이그레이션** — `migrate-posts-datetime-ms` · `migrate-task-tags` 는 `deploy-planq.sh` 자동 블록에 없지만 `sync-database.js` 가 이미 처리했다. 수동 실행 시 둘 다 skip, `posts` 시각 컬럼 `datetime(3)` 실측(Fable H-1 충족).
- **청크 B 메일 백필 `--apply`** — 운영 970 스레드 중 **10건 재분류**, 답변필요 해제 **0건**. DB 실측: 학생 문의·지원 요청 2건 `reply_needed=1`, Apple Developer 4건+대한항공 `uncertain`(확인 권장), LinkedIn `marketing`.

### 배포 2 — OAuth 승인 스코프 저장측 가드 (`d84bdcc`, 백업 `20260810_190922`)
Irene: *"openid email 만 저장되고 조용히 실패하는 일이 없어야지. 인지가능한 방식으로 제대로 안내되는 ui 해야지"*

- **근본 결함**: `scope: tokens.scope || 요청목록` 폴백이 **승인받지 않은 권한을 승인 기록으로 위조**했다. 판정 함수가 그 거짓말을 읽고 "가능" 이라 답했다. 개인 2곳 + 워크스페이스 2곳 전부 제거.
- **`services/googleScopes.js` 신설** — provider 5종 필수 grant 단일 원천. fail-closed · membership(`include_granted_scopes` 가 합집합을 주므로 동등 비교 금지) · `hasCalendarReadOnly` 로 (a)옛 읽기전용과 (b)권한 전무 구분.
- **가드 배치 규칙**: 토큰 교환 직후·모든 쓰기 이전. 거부 시 **기존 row 무변경 리턴**. 개인 경로는 `fail()` 경유(네이티브 복귀·로깅 내장).
- **불변식**: scope 는 콜백에서만 기록. 갱신(`on('tokens')`) 3경로는 access/refresh/expiry 만 쓴다(실측 확인).
- **`routes/cloud_oauth.js` 절출** — 가드 추가로 `cloud.js` 가 500줄 래칫 초과(489→513) → 콜백 분리(513→272 / 신규 269). 마운트는 같은 자리 `router.use()` 라 경로·순서 불변(Fable 라우트 표 16/16 대조).

### 📌 #252 — 배포 직전에 막아 세운 건
배포 스택의 `50530ca` 가 **"⛔ 배포하면 문서 저장이 깨진다"** 를 커밋 메시지에 달고 있었다. 6개 잔여 항목은 `eb36680`(청크 A)에서 **이미 닫혀 있었지만**, 청크 A 는 메시지가 말한 3건과 달리 **62파일 2,850줄**이고 #252 완성분이 **게이트 범위 밖에서 얹혀 갔다.**
→ 전용 게이트 PASS (실HTTP 29 · 실브라우저 19 · 소켓 실측 · 반증 2건). 운영 옛 posts 39건 전부 `published` 라 배포로 사라지거나 노출될 행 없음.

---

## 이번 세션에서 배운 것 (재발 방지)

1. **★ 커밋 메시지가 diff 크기를 대변하지 않는다.** 배포 스택은 `git show --stat` 으로 훑을 것. "배포 금지" 가 박힌 커밋은 그 경고가 **지금도 유효한지** 확인하고, 후속 커밋이 조용히 해결했다면 **그 후속분은 미검증**이다.
2. **★ 코드 이동은 실제 성공 경로를 태워야 회귀가 나온다.** 절출이 `Business` import 를 빠뜨려 **신규 Drive 연결만** 500 + 고아 row 가 됐는데, 실패 분기도 재연결 경로도 멀쩡해서 스모크·문법검사·가드 3축이 **전부 통과**했다. 누락 식별자는 grep 말고 **eslint `no-undef`**, 그리고 **스캐너 자체를 반증**할 것.
3. **★ 요청 목록은 승인 기록이 아니다.** OAuth 폴백 한 줄이 미승인 권한을 위조한다.
4. **★ 로그 키가 화이트리스트에 없으면 조용히 사라진다.** 조용한 실패를 없애려고 넣은 로그가 정작 조용히 죽어 있었다(`granted_scope` → `scope`).
5. **★ 판정 기계부터 의심하라 (이번 세션 5회).** `pkill -f "vite build"` 가 **자기 명령줄을 매치해 셸을 자살**(exit 144, 로그조차 안 생김) · 배포 로그에 NEL 제어문자가 섞여 **grep 이 바이너리로 판정하고 침묵**(`-a` 필요) · cwd 잔류 `MODULE_NOT_FOUND` 3회.
6. **★ `DEPLOY_EXIT=1` 은 부수 신호.** 판정은 `Deployment Complete` + verify 항목 + 운영 실측 3점(PM2 uptime · 프론트 산출물 시각 · 헬스 200)으로.
7. **정리했다는 주장은 정리 후 `health-check` 재실행으로 증명한다.** "지웠다" 는 증거가 아니다.

---

## Git 상태
- `origin/main` = `HEAD` (push 완료). 미배포 스택 **없음**.
- 자동저장 스냅샷: `refs/autosave/main` (브랜치 오염 없음)
- 운영 백업: `/opt/planq/backups/20260810_175853`, `/opt/planq/backups/20260810_190922`
- 검증 스크립트는 전부 scratchpad — 프로젝트 트리에 없음

## 복구 가이드
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
