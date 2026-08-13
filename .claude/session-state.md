# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-13 (Opus 5, 1M) 2회차 — `/개발완료`. 배포 v1.48.2 완주 + **Q Calendar 역방향 동기화 결함 수정(Fable PASS, `d4c1896`)**
**작업 상태:** ✅ 개발·검증 완료 · 커밋·푸시 완료. 🔴 **남은 것 = Irene 의 `/배포` 단 하나** (아래 0번)

> ## ⚠️ 이 파일이 낡으면 Fable 이 오판한다
> 청크를 끝낼 때마다 갱신할 것.

---

## 🔴 다음 세션에서 가장 먼저 볼 것

### 0. ✅ Q Calendar 역방향 동기화(구글→PlanQ) 결함 수정 — **Fable PASS · 커밋 완료 · 미배포**

**운영 피드백(Irene, 2026-08-13):** "Q calendar 일정은 구글로 나가는데, **구글에서 수정하면 PlanQ에 안 돌아온다**. 아직 해결 안 됨."

**변경 파일: `dev-backend/services/calendarReverseSync.js` 1개 (58+/14−). 커밋 완료 — 운영에는 미반영.**

#### 원인 ① [코드] 최초 부트스트랩이 "이미 일어난 구글 수정"을 삼킨다 — 이번에 고친 것
`collectChanges` 의 `if (!bootstrap) items.push(...)` — 커서 없는 첫 회차는 변경을 **수집만 하고 버린 뒤
커서만 저장**했다. 연동 직후가 사용자가 반드시 테스트하는 순간이라 **첫 구글 수정이 항상 폐기**된다.

**운영 실측 증거 (2026-08-13, 읽기 전용 진단):**
- 개인연동 conn#14 생성 06:18:04 → PlanQ→구글 push 06:18:29 → **구글에서 제목 수정 06:19:37**
- 현재 Google `"PlanQ수정1234"` vs PlanQ `"연동 테스트_PlanQ수정"` (link#9 / event#31) — **영구 불일치**
- 증분 폴링 = **변경분 0건** (커서가 이미 지나감) · 운영 `audit_logs action='event.reverse_sync'` **누적 0건**

**수정 내용:** 부트스트랩도 items 를 적용. "구글 옛 상태로 덮어쓰기" 우려는 이미 3겹이 막는다
(①링크 없으면 무시 ②화이트리스트 diff 비면 no-op ③PlanQ 가 같거나 더 최신이면 skip).
추가로 `linkedGcalIds()` prefilter(전체훑기 DB 폭증 차단 + **남의 사생활 일정 미조회**),
truncated 여도 모은 만큼 적용, `sources===0` 로그(침묵으로 죽음이 가려지던 것), 테스트용 export 2개.

**✅ Fable 게이트 PASS (2026-08-13):**
- ①diff범위 — 1파일뿐, 절단면 이탈 0. 검증 후 md5 대조로 구현 무변경 확인
- ②가드 4축 EXIT 0 — health 34/34 · guard 22/22 · e2e tenant 실패 0 · `npm run build` BUILD_EXIT=0(`error TS` 0건, 별도 파일 박제)
- ③반증 16/16 — 스텁 주입 실동작. **양성 대조군: 옛 코드 사본이 `CTRL-T1 부트스트랩 변경을 삼킨다`로 FAIL** = 진단 재현 + 탐지기 유효성 증명
- ③실HTTP 8/8 — dev:3003 login→POST 201→PUT→재조회 일치→무토큰 401→타 biz 403→DELETE→404(데이터 원복 증명)
- ③운영 재확인 — 감사로그 0건 · 구글/PlanQ 제목 불일치 · 증분 0건, **Fable 이 독립 실측**
- ④배포안전 — 마이그레이션 0(models diff 0), 롤백 = 파일 revert + PM2 restart

**Fable 이 심문한 남은 구멍:**
- etag NULL 백필 링크(#3~8) 덮어쓰기 위험 = **현재 0, 재연결 후에도 안전** (diff no-op + etag 자가치유 + 시각 가드)
- 쿼터·소요 = 소스당 최대 20 req/회차, ~10s ≪ 5분 cron. prefilter 는 DB 만 줄인다(API 아님)
- truncated 재적용 = **멱등**. 단 >5000건 캘린더는 커서를 영영 못 만들어 매 회차 전체 재훑기(경고 로그로 가시화) — 수용된 트레이드오프
- ⚠️ 비-KST 워크스페이스 all-day 왕복 = **이 diff 밖의 기존 매핑 이슈**, 별도 추적 권장

#### 원인 ② [권한] 워크스페이스(팀) 캘린더 토큰이 죽었다 — **코드로 못 고침, Irene 조치 필요**
운영 `business_cloud_tokens#3` (biz 1):
- scope 가 `userinfo.email openid` 뿐 → `hasWriteScope=false`
- 실제 호출 `invalid_grant` (리프레시 토큰 폐기) · `last_error='Request had insufficient authentication scopes.'`
- **운영 링크 8건 중 6건이 이 워크스페이스** (`정기미팅`·`지메이트 대표님 미팅`·`구글 캘린더 테스트`·test 3건)
→ ①을 고쳐도 **이 6건은 양방향 모두 죽은 채**다. **오너가 재연결 + 동의화면 "캘린더" 체크 필수**
   (체크 안 해도 연결은 성공한 것처럼 보이는 게 함정 — memory `feedback_requested_scope_is_not_granted`).

#### 그 외 운영 실측 메모
- Irene 개인연동 conn#1: scope·상태 정상인데 **링크 0건** → `personalSources()` 의 `n>0` 에 걸려 **폴링 대상 아님**.
  그녀가 새 일정을 만들면 개인 캘린더로 push → 링크 생성 → 다음 회차 부트스트랩(수정 후엔 **적용됨**).
- link#1 은 삭제된 conn#12 를 가리키는 **고아 링크**(`updateAtLink` 가 graceful return 이라 무해, 정리는 미착수).

#### ▶ 다음 세션이 할 일 (순서대로) — **검증은 끝났다. 배포만 남았다**
1. **Irene 의 `/배포`** — 커밋 완료, 마이그레이션 0. 배포 없이는 운영은 계속 옛 코드다.
2. **배포 직후 운영 데이터 조치 (Fable 안전 판정 완료 · 권고)** —
   ```sql
   UPDATE external_connections SET gcal_sync_token = NULL WHERE id = 14;
   ```
   재부트스트랩이 돌아 **link#9 의 실제 불일치가 해소**된다(구글 `"PlanQ수정1234"` → PlanQ 반영).
   ★ 이게 "진짜 고쳐졌다" 의 실증이다. 리셋 없이는 그 이벤트를 구글에서 다시 건드리기 전까지 불일치 잔존.
   반영 확인: `SELECT title FROM calendar_events WHERE id=31;` + `audit_logs action='event.reverse_sync'` 1건 이상.
3. **Irene 에게 워크스페이스 구글 재연결 안내(원인 ②)** — 재연결 전엔 팀 캘린더 6건은 계속 죽어 있다.
   동의화면에서 **"캘린더" 체크박스를 반드시 누를 것**(안 눌러도 연결은 성공한 것처럼 보인다).

### 1. ✅ 오늘 탭 Fable 재검증 **PASS** (2026-08-13) — 해소됨
커밋 `6c833cb` 대상. ①diff 범위(13파일 734+/405−, 범위 밖 0) ②가드 3축(health 34/34 · guard 22/22 · e2e tenant 0실패 · BUILD_EXIT=0, TS 0) ③실호출 ④배포안전 **전부 PASS**.
   - **D1 PASS** — 실브라우저에서 오늘 탭 인사이트 렌더 + 주간 탭과 기간·polyline 좌표열·가용 라인 **완전 일치**
   - **D2 PASS** — 완료가리기 체크박스 **1개**, 토글 동작 + 토글해도 그래프 불변(#254 정본/보기 분리)
   - **D3 PASS** — 제목만 추가 → 즉시 표시. DB `due_date=2026-08-13` · `planned_week_start=2026-08-10` · `assignee_id=5`
   - 회귀 PASS — 주간/요청/전체/workspace 무변경, 담당자 체인 미리보기 생존(`resolved_default_assignee` 반환). 무토큰 401 · cross-tenant 403
   - ★ 부수: **이전 라운드가 원복 안 한 `FABLE-R2-*` 테스트 업무 8건(biz 6) + `test-fable-r2-setup.js` 잔존** 발견 → 공식 DELETE 라우트로 전량 정리(잔여 0). **검증 데이터 원복은 다음 라운드가 확인해야 한다.**
   - ★ 판정 기계 오탐 2회: 기본 뷰포트 800px 가 우측 패널을 숨김 · 아이콘 polyline 을 그래프로 오인. 앱 결함 아님

### 2. ✅ 운영 배포 완료 (2026-08-13 05:48~05:51) — 운영에 `5ad38c8` (v1.48.2) 반영, **미배포 0**
배포 스택 `4afd169 → 5ad38c8` (#254 진척 그래프 정의 통일 · 오늘 나의 업무 탭 · 팝아웃 2탭 · #237 Cue "완료로 추가").
백업 `20260813_054824`, 207초. 마이그레이션 **변경 0 실측**(pre-sync rename·idempotent 전부 skip).
3점 검증: 운영 PM2 `planq-prod-backend` v1.48.2 online · 프론트 청크 05:51(`version.json built_at 05:51:39`) · 외부 health 200.
`DEPLOY_EXIT=1` 은 알려진 부수 신호. `origin/main` push 완료(미푸시 0).
✅ `seed-wiki-content.js` **실행 불필요** — 운영 `help_categories` 15 / `help_articles` 42 실측(이미 시드됨).
롤백: `ssh irene@87.106.78.146 'tar -xzf /opt/planq/backups/20260813_054824/backend.tar.gz -C /opt/planq && pm2 reload planq-prod-backend'`

### 3. ⚠️ 세션 2회 중단 이력 (2026-08-13) — 복구 완료
`95f5c72f` 가 배포 3점 검증 직후 06:08 끊김(요약 미출력) → `0e986cbe` 가 복구 중 06:16 다시 끊김
(pm2 dev 재기동·git push 는 완료, session-state 갱신 도중 사망). 현 세션이 문서 기록까지 마감.
★ 교훈: **배포 완주 ≠ 기록 완료.** 세션이 죽으면 "미배포" 라고 적힌 낡은 상태 파일이 남아 다음 라운드가 오판한다.

### 4. ✅ 청크 3 완료 — Cue "완료로 추가"(#237) **Fable PASS (2026-08-13)**
14파일. `cue_tools.js` 스키마 `completed` → 마감 미지정 시 워크스페이스 tz 기준 **오늘** → 생성 후
**행동 계층 `complete()`**(직접 status 쓰기 0건). `aiTaskPlanner`·confirm 라우트 동일. 완료 ↔ 반복 **상호배타**.
실패해도 생성은 유지하고 사유(`completed_skipped`)를 응답+화면에 노출.
- Fable 실측: 실HTTP 21판정 + 실브라우저 2회 + 실LLM 1회. 불변식 4 + 타인담당 경로 전부 PASS
- 타인담당(biz 3/6 멀티멤버): 업무 생성 O / 완료 X / `only_assignee` 사유가 화면에 표시됨 실측
- 회귀: `completed:false + recurrence:'daily'` → RRULE·next_occurrence_at 생존 (**#262 회귀 없음**)
- 마이그레이션 0건(models 무변경). 검증 데이터 8건 전량 원복, 고아 0

> ★ **Fable 관찰(별건)**: 운영에 `status IN (completed,canceled) AND next_occurrence_at IS NOT NULL` 인
> 기존 row **7건**. `recurringTaskGenerator` 는 parent status 를 안 본다. 이 diff 는 신규 유입만 막는다 —
> 기존 7건의 의도(완료된 parent 의 시리즈 지속이 정책인가) 확인 필요.

### 4-B. 남은 청크 1개 (미착수)
- **청크 4: 팝아웃 핀 재구조화(#258)** — "항상 위 창"(PinHolderView)은 **실측된 물리 제약**의 산물:
  PiP 는 소유 창이 죽으면 같이 죽고, 팝아웃의 클릭은 메인 창으로 activation 이 전이되지 않는다.
  해법 = **도크에서 핀 진입**(메인 탭이 PiP 소유) → 홀더 창 불필요.
  ★ 스파이크 S1(메인 SPA 네비 중 PiP 생존) · S2(F5 시 사망 여부) · S3(PiP iframe 내 window.open) **선행 필수**.
  S1 실패 시 청크 중단 → 후퇴안(홀더 유지 + 문구를 "항상-위 창을 붙잡는 기술적 지지대" 로 교정).

### 5. Irene 결정 대기 (코드로 못 정함)
- **AI 업무추가 카드의 우선순위 표시** — `tasks.priority` 컬럼이 **없다**(`priority_order` 는 주간 랭킹용).
  죽은 write 는 제거했으나 **표시를 없앨지 / 컬럼을 만들지** 미결. Fable: `priority_order` 승격 비권장
- 운영 프로젝트 10번 "IRENE KIM Operating System" 대체/보존 · 월 루틴 "N주차" → "매월 N번째 X요일" 요일 지정 4건
- 버전은 **1.48.1 유지** (배포 후 올리면 운영 PM2 표시와 어긋난다 — 다음 배포 때 올릴 것)

### 6. 캘린더 / Google 심사 — **영상 촬영 가능** (운영 DB 실측)
- 개인 연동 #1 `irene@irenewp.com`: `calendar.events` + `calendar.readonly` + `drive.file` 보유, 오류 없음
- ⚠️ 워크스페이스 gcal 토큰 #3: scope `openid email` 뿐 + `insufficient authentication scopes` → 폴링 제외.
  팀 캘린더 링크 6건 역동기화 안 됨. **오너 재연결 필요**(동의화면 "캘린더" 체크). 심사에는 불필요
- 영상 순서: 동의화면 → PlanQ 일정 생성(구글 반영) → 구글에서 수정 → **5분 내** PlanQ 반영
  ※ irene 계정은 개인 링크 0건이라, 2번(일정 1건 내보내기) 하는 순간 링크가 생겨 그다음 주기부터 역방향 작동

### 7. 피드백 장부 정리 (platform_admin 만 가능 — Irene)
**해결·배포 완료인데 pending**: #232 #236 #241 #244 #245 #252 #255 #256 #257 #262 #263 #264 #265 #266 #268 #270 #272
**컨펌 필요해 미착수**: #225 #227 #228 #229 #230 #231 #233 #235 #238 #239 #240 #259 #260 #261 #267 #269 #271 #273 #274

---

## 이번 세션에서 배운 것 (재발 방지)

1. **★ 정화기가 입력 형태를 바꾼다.** DOMPurify `WHOLE_DOCUMENT:true` 는 조각도 `<html><body>` 로 감싸 준다 —
   **정화 후 결과로 "조각이냐" 를 판정하면 그 분기는 영원히 안 탄다.** 판별은 원문으로.
2. **★ 가드 오탐은 진짜 부채를 통과시킨다.** i18n 검사가 별칭 `tp(` 를 몰라 25건 오탐 → 오탐을 없애자
   그만큼 **slack** 이 생겨 진짜 하드코딩 카나리가 통과됐다. **오탐 수정 후엔 베이스라인을 조이고 다시 반증.**
3. **★ 후보 나열 함수 ≠ 선정 함수.** 실제 배정은 본인 short-circuit + 폴백까지 거쳐야 정해지고
   **보는 사람마다 다르다.** 화면이 배열 `[0]` 을 쓰면 미리보기≠실제 사고.
4. **★ 스냅샷 원장은 "일생 누적" 일 수 있다.** 주간 그래프에 그대로 합산하면 이월분이 첫날부터 실린다.
   기준선(기간 시작 이전 최신 행)을 빼는 정의를 **모든 소비처가 공유**해야 한다(3벌로 갈라져 있었다).
5. **★ 새 탭을 만들면 "주간 전용" 게이트를 전수 확장해야 한다.** 인사이트 렌더·중복 체크박스·생성 기본값
   3계열을 놓쳐 **추가한 업무가 즉시 사라지는** 결함이 났다(실브라우저로만 잡힘).
6. **★ 헤더/본문 정렬은 CSS 분기가 아니라 각 컬럼 prop 이 정한다.** `flex-basis:0`+`border-box` 에서
   한쪽에만 있는 패딩은 기본 크기로 잡혀 배분 비율까지 틀어진다(2:1 → 1.84:1).
7. **라우트 경로를 추측하지 말 것.** task 삭제는 `DELETE /api/tasks/by-business/:businessId/:id`.
   404 를 "삭제됨" 으로 오해하면 검증 데이터가 남는다. 로그인 응답 토큰 필드는 `data.token`.
8. **주석도 god-file 래칫을 깨뜨린다.** 주석을 깎아 통과시키는 건 속이는 것 — 절출로 해소.
   절출 시 `keyframes`·아이콘 import 누락이 나기 쉽다(빌드가 잡는다).

---

## Git 상태
- 브랜치 main. 운영 배포 지점 `4afd169` — 그 이후 커밋은 **미배포**
- 운영 백업: `/opt/planq/backups/20260812_194520`

## 복구 가이드
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
