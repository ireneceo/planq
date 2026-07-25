# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-24 심야 (Opus 4.8, 1M) — /개발완료
**작업 상태:** **완료 (Fable 설계·구현 게이트 전건 PASS · 2배포 완주).** 이번 세션 5건(#209·#212·#210·#200·#203/#207) + 배포 heap OOM fix 전부 운영 반영. 다음 = 잔여 피드백.

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 이번 세션에 한 일 (전건 배포 완료)

### 배포 1 — #209·#212·#210·#200 (운영 20260724_172925, 커밋 51425f4, 225s)
1. **#209 Q Talk 연속 메시지 간격** — 근본원인 `MessageList` `flex gap:16px` 가 연속/비연속 구분 없이 강제. `gap:0`+행 margin(비연속 28·연속 0)+`data-cont`+안읽음 구분선 아래 그룹 끊기.
2. **#212 메일 검색 공백 토큰** — 공백 토큰(≤4) 쪼개 토큰별 OR(제목·미리보기·본문·제목·보낸사람)→AND + LIKE 이스케이프. `wordpress org` 1→33건.
3. **#210 통합검색 메뉴** — `config/navMenus.ts`(메뉴 41종, 사이드바 역할 게이팅) + ⌘K·탭`+`에 메뉴 노출 + searchAliases i18n + 멤버 표시명 헬퍼 통일(리스트+드로어).
4. **#200 메일 정렬·광고·부활** — (a) 서버순서+스크롤앵커 (b) 법정 `(광고)` 규칙 (c) `replied` reason+outbound 가드 부활차단 (d) participants clone-first. 카나리 2불변식(mailrt).
   - **후속 실행 완료**: 위키 seed(카테고리 14)·**파일 vlevel 백필 13건**(개인/팀 파일 노출 해소)·**메일 재판정 7건**(운영 답변필요 4→5, (광고) 잔존 0).

### 배포 2 — #203/#207 (운영 20260724_195322, 커밋 b2950e7, 208s)
5. **★ #203/#207 Q Mail 알림** — 여태 메일 도착 시 notify 호출이 아예 없어 알림 0건(§13 위반). `services/mailNotify.js` 단일 착지점 × 계정별 `notify_scope`(전체/확인권장+답변필요/답변필요만, 기본 recommended). 수신자 개인=본인만/회사=멤버전원(Cue·제거멤버 제외), 이메일 답변필요만+루프가드, 시간당캡 20, 본문=제목까지만. **잠복버그 2건 해소**: notification_prefs ENUM share_expiry 누락·system kind 미등록. 마이그레이션 migrate-mail-notify.js(멱등, ENUM append-only) → deploy 스크립트 등록.
   - 프론트: `MailNotifyScopeSection.tsx`(3택 라디오, 즉시저장+실패 롤백) + EmailAccountSettings 삽입 + NotificationSettings EVENTS+=mail + i18n ko/en.

### ★ 배포 heap OOM 부분배포 사고 (같은 세션 발견·수정)
- `deploy-planq.sh:269` 프론트빌드 `NODE_OPTIONS=8192` 가 dev 7.7GB 머신에서 **Terminated → 부분배포**(백엔드+마이그레이션만 착지, PM2 uptime 2h·청크 불일치로 검출). **4096 수정 후 재배포 완주**. Fable 배포게이트가 "죽은코드·정리권장"으로 예고했던 지뢰. 메모리 `feedback_build_heap_4096_on_dev`·`feedback_deploy_timeout_partial_state` 계열.

**맥락 유지:**
- Fable 게이트: #209/#212/#210 구현 PASS · #200 설계PASS→구현FAIL(선재 표시명)→수정 PASS×2 · #203/#207 설계CONDITIONAL→구현 PASS · 배포 세트 전체 PASS.
- 운영 실배포 기준점: 이제 **b2950e7**. (직전 세션 기준 c925d33)
- 신규 메모리: `feedback_sequelize_json_inplace_mutation`(JSON/배열 in-place push 저장 누락).

---

## ⚠️ 배포 시 반드시 수행 (코드 배포로 안 끝나는 것)

- **약관·처리방침 개정 공지** — 절차: `docs/LEGAL_UPDATE_2026-08-01_ROLLOUT.md`
  시행일 **2026-08-01** (처리방침 §10 = 시행 7일 전 공지 의무). 배포 시 `announcement_text` 공지 1회 +
  개정 안내 메일 1회. **`terms_version`/`privacy_version` 은 올리지 않는다**(재동의 미트리거 — 배포 전후 값 동일 확인).
- **#200(b') 메일 참여자 백필** — 운영 954행. dry-run → `email_threads` 스냅샷 → `--apply` → 재실행 변경 0 확인.
  `node scripts/backfill-thread-participants.js`

## 📂 다음 할 일 (우선순위)

1. **#200(b') participants 백필** — 운영 954 스레드 `participants=[]` 옛 데이터. to_emails 포맷 혼재(string 배열 vs 객체 배열) 정규화 필요, 멱등. 중복 스레드 병합은 하지 말 것(고위험·저가치).
2. **#206** Q Task 보류/외부컨펌 상태 — tasks.status ENUM 변경(#203 과 같은 sync-database 불가·수동 ALTER 계열). Fable 프로세스.
3. **#208** 출퇴근·휴가 관리 — 신규 시스템, Fable 기획설계부터.
4. **#211** B2B 에이전시 타깃 기능 제안 — Fable 기획.
5. **#192** 메일 AI 다듬기 확장(공통 AiRefineBar) · **#193** 캘린더 뒤로가기 · **#146** 검색 헤더 승격.
6. **Q위키 배치**: #210 메뉴 검색 · #207 알림 범위 아티클 추가(게이트는 이미 통과, 다음 배치에 묶음).
7. **후속 정비(비차단)**: `PostCategory.vlevel` dev 로그 경고(posts.js:238 선재).

---

## 🔑 환경변수 / 인증 현황

- 운영 = `irene@87.106.78.146`(planq.kr, port 3004, /opt/planq/backend, DB planq_prod_db). SSH passwordless(read-only 조회).
- 운영 실배포 기준 커밋 = **b2950e7**.
- 운영 feedback_items: content 아님 body 컬럼. 조회 `ssh … "cd /opt/planq/backend && node -e '...config/database sequelize...'"`.
- dev DB 접근 `cd /opt/planq/dev-backend` 후 node. e2e/가드는 `cd /opt/planq` 루트.
- 로그인 rate-limit 15분 8회. e2e 스위트 연달아 돌리면 login failed — 간격 두기.

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
### 참조
- 정책: CLAUDE.md "Fable 검증 게이트" · 메모리 `feedback_fable_all_design_verification`
- 메일 실시간 카나리: `cd /opt/planq && node scripts/e2e/run.js --suite mailrt` (내림·재정렬·스크롤앵커 불변식)
- 메일 알림: `services/mailNotify.js` classify/allowedByScope · 개인격리 flip 반증 필수
