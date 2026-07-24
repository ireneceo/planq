# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-24 심야 (Opus 4.8, 1M) — /저장
**작업 상태:** **이번 세션 5건 완료 (Fable 게이트 전건 PASS).** #209·#212·#210·#200 은 **운영 배포 완료**(20260724_172925). #203/#207 은 **구현·검증 PASS, 미배포**(로컬 커밋). **다음 = #203/#207 /배포** → /개발완료.

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 이번 세션에 한 일

### 배포 완료 (운영 20260724_172925, 커밋 51425f4, Complete 225s)
1. **#209 Q Talk 연속 메시지 간격** — 근본원인은 `MessageList` 의 `display:flex; gap:16px` 가 연속/비연속 구분 없이 16px 강제. `gap:0` + 행 margin 이관(비연속 28px·연속 0). data-cont 속성. 안읽음 구분선 아래 그룹 끊기.
2. **#212 메일 검색 공백 토큰** — q 를 공백 토큰(≤4)으로 쪼개 토큰별 OR(제목·미리보기·본문·제목·보낸사람) → AND. LIKE 와일드카드 이스케이프. `wordpress org` 옛 1건 → 33건.
3. **#210 통합검색 메뉴** — `config/navMenus.ts` 신설(메뉴 41종, 사이드바와 동일 역할 게이팅). 탭 `+`·⌘K 검색에 메뉴 노출. searchAliases i18n. 멤버 표시명 헬퍼 통일(리스트+드로어).
4. **#200 메일 정렬·광고·부활** — (a) 서버 순서 채택+스크롤 앵커(prev-순서 병합 폐기) (b) 법정 `(광고)` 규칙 (c) 답장 `replied` reason + retriage outbound 가드로 부활 차단 (d) participants clone-first(운영 953 스레드 `participants=[]` 근본원인). 신규 카나리 2불변식(mailrt: 재정렬+스크롤 앵커, fail-closed).

**배포 후속 절차 실행 완료:** 위키 seed(카테고리 14) · **파일 vlevel 백필 13건 정정**(개인/팀 파일 노출 해소) · **메일 재판정 7건**(운영 답변필요 4→5, (광고) 잔존 0).

### 미배포 (로컬 커밋 — 다음 /배포 대상)
5. **★ #203/#207 Q Mail 알림** (Fable 설계 CONDITIONAL → 구현 PASS)
   - 여태 메일 도착 시 socket broadcast 만 하고 **notify 호출이 아예 없어 알림 0건**이었다(§13 위반).
   - `services/mailNotify.js` 신설 — inbound 저장 후 단일 착지점. 성격 판정(폴더 정의 동일 술어) × 계정별 `notify_scope`(전체/확인권장+답변필요/답변필요만, 기본 recommended).
   - 수신자 분기: **개인 계정=본인만 / 회사 계정=멤버 전원**(Cue AI·제거 멤버 제외). 이메일은 답변필요만+루프가드. 시간당 캡 20. 본문=제목까지만.
   - **잠복버그 2건 동시 해소**: notification_prefs ENUM 의 `share_expiry` 누락(끌 수 없는 알림), `system` kind 미등록(인앱 알림 조용한 실패).
   - 마이그레이션 `scripts/migrate-mail-notify.js`(멱등, ENUM append-only + email_accounts.notify_scope) — deploy-planq.sh 등록(PM2 reload 前).
   - 프론트: `MailNotifyScopeSection.tsx`(3택 라디오, 즉시저장+실패 롤백) + EmailAccountSettings 삽입 + NotificationSettings EVENTS += mail + i18n ko/en.

---

## 📂 다음 할 일 (우선순위)

1. **/배포** — #203/#207 (커밋 완료, 미배포). 배포 스크립트가 migrate-mail-notify.js 자동 실행(ENUM ALTER → 코드). 운영 3계정 자동 recommended.
2. **잔여 운영 피드백:**
   - **#200(b') participants 백필** — 운영 954 스레드 `participants=[]` 옛 데이터. to_emails 포맷 혼재 정규화 필요(별건, 중규모).
   - **#206** Q Task 보류/외부컨펌 상태 (tasks.status ENUM 변경 — #203 과 같은 "sync-database 불가·수동 ALTER" 계열, Fable 프로세스)
   - **#208** 출퇴근·휴가 관리 (신규 시스템, Fable 기획설계부터)
   - **#211** B2B 에이전시 타깃 기능 제안 (Fable 기획)
   - **#192** AiRefineBar 공통화 · **#193** 캘린더 뒤로가기 · **#199**(배포됨 확인) · **#146** 검색 헤더 승격
   - **#200(c)** 메일 이미지 확대 — 이전 사이클 수정됨(Fable 확인)
3. **후속 정비(비차단):** deploy-planq.sh heap 8192 죽은코드 정리 · `PostCategory.vlevel` dev 로그 경고(posts.js:238 선재)

---

## 🔑 환경변수 / 인증 현황

- 운영 = `irene@87.106.78.146`(planq.kr, port 3004, /opt/planq/backend, DB planq_prod_db). SSH passwordless(read-only 조회).
- **운영 실배포 기준점 정정:** ead59e4 아님 → **`c925d33`(v1.48.1)**. 이번 배포로 51425f4 까지 반영됨. #203/#207 은 그 이후 로컬 커밋.
- 운영 feedback_items: content 컬럼 없음(body). 미해결 pending 조회: `ssh … "cd /opt/planq/backend && node -e '...config/database sequelize...'"`.
- dev DB 접근 `cd /opt/planq/dev-backend` 후 node. e2e/가드는 `cd /opt/planq` 루트.
- 로그인 rate-limit: 15분 8회. e2e 스위트 연달아 돌리면 login failed — 간격 두기.

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
### 참조
- 정책: CLAUDE.md "Fable 검증 게이트" · 메모리 `feedback_fable_all_design_verification`
- 2탭 실시간 카나리: `cd /opt/planq && node scripts/e2e/run.js --suite mailrt` (재정렬+스크롤 앵커 2불변식 신설)
- 메일 알림 검증: mailNotify classify/allowedByScope 유닛 + 개인격리 flip 반증
