# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-24 (Opus 4.8, 1M) — /개발완료 처리됨
**작업 상태:** **완료 (Fable 게이트 3회 PASS, 미배포).** 운영 피드백 6건(#201·#202·#195·#196·#204·#205) + 가드·하니스 결함 3건 수정. 가드 3축 통과·커밋·백업 완료. **다음 = /배포**(직전 세션 #146 스크린샷 + 피드백 5건 + 파일 격리 fix 까지 누적 미배포) + 파일 vlevel 백필 운영 적용 + 잔여 피드백.

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 이번 세션에 한 일 (미배포)

**운영 피드백 6건:**
1. **#201 캘린더 안내 거짓 문구** — 워크스페이스 연동(쓰기 O)과 개인 연동(`calendar.readonly` 읽기전용)을 한 문장으로 뭉쳐 개인 연동자에게 거짓. `CalendarSyncNotice` prop 2분기(`workspaceConnected`/`personalConnected`) + 문구 분리 + dismiss 키 `_v2`.
2. **#202 메일 번역 취소** — 로딩 중 버튼 disabled 라 긴 번역에 갇힘 → 메시지별 `AbortController` + "번역 취소" 버튼.
3. **#195 도움말 게스트 카테고리** — public 아티클 0건 카테고리는 게스트에게 소멸(`routes/wiki.js /categories required:true`). qtalk·qinfo·settings 대표 아티클 승격(`seed-wiki-content.js`). 게스트 카테고리 11→14. **dev seed 반영됨, 운영은 배포 시 `node seed-wiki-content.js` 필요.**
4. **#196 랜딩 영어** — 랜딩에 언어 전환 UI 부재 → `LandingLayout` GNB·모바일시트 KO·EN 토글. `HomePage.tsx` Hero 하드코딩 3키 이관.
5. **★ #204 모바일 PWA 메일 리스트** — `MailPage.sidebarCollapsed` 초기값 `innerWidth<900` → 모바일만 목록 접힘(실측 모바일 0행). 목록 우선 + 딥링크만 상세 우선 + 선택/해제 연동 + 문구 뷰포트 분기.
6. **★ #205 확인완료 2결함** — (a) `mark-handled`·`bulk-handled` 읽음(`unread_count`/`is_read`) 미갱신 → 두 경로 수정 (b) silent 병합이 "사라진 행 남김" → 다른 기기서 잔존+목록 30→31. fresh 없는 행 제거 + `listSeqRef` 응답순서 가드. **백엔드 변경 → 배포 시 pm2 restart 필요(DB 스키마 변경 0).**

**가드·하니스 결함 3건:**
- `guard-invariants.js` i18n 탐지기 JSX 주석 `{/*` 오탐 → 래칫 445→426 조임
- **★ `--category=X --update-baseline` 이 미실행 카테고리 베이스라인 통째 삭제** → `{...baseline}` 보존 (memory `project_guard_invariants_depersonalization` 박제)
- 하니스: `mobile-keyboard.js` 목록접힘 불변식 + **`canary-mail-realtime.js` 신규**(`--suite mailrt`, 2탭 §16 게이트)

**맥락 유지:**
- ★ **Fable 무조건 게이트**. 이번 3회 PASS, 매회 Fable 이 직접 코드 되돌려 재빌드→FAIL 확인→원복(#204·#205).
- 커밋 시 auto-save wip 2개(`94d4938`·`8de7535`)가 직전 사이클을 이미 커밋한 상태 — /개발완료 커밋으로 정리.

---

## 📂 다음 할 일 (우선순위)

1. **/배포** — 누적 미배포(직전 #146 스크린샷+피드백 5건+파일격리 fix + 이번 6건). 배포 시 동반:
   - 운영 위키 seed: `ssh …prod "cd /opt/planq/backend && node seed-wiki-content.js"` (#195 게스트 카테고리)
   - **파일 vlevel 백필**: `node scripts/backfill-file-vlevel.js` dry-run → 롤백스냅 → `--apply` (운영 13건 노출, 직전 세션 미완)
2. **잔여 운영 피드백:**
   - **#200(a)(b)** 메일 답변필요 정렬 흔들림 + 과거 광고메일 잔존 (server-fresh + 옛 데이터 재판정)
   - **#207** 메일 알림 범위 설정(전체/확인권장+답변필요/답변필요만, 기본=답변필요+확인권장). #203 과 묶음
   - **#203** 메일 답변필요 알림 (reply_needed 정확도 #200b 선행 필수, `notification_prefs` ENUM = 운영 마이그레이션 3단 게이트)
   - **#206** Q Task 보류/외부컨펌중 상태 (ENUM 변경, "fable 프로세스 확인")
   - **#208** 출퇴근·휴가 관리 (신규 시스템, "fable 기획설계" — Fable 설계 게이트부터)
   - **#192** 메일 외 AI 다듬기 확장(공통 AiRefineBar) · **#193** 캘린더 뒤로가기 · **#146** 검색 헤더 승격
3. **#126 개인캘린더·OAuth** = Irene(Google 검증 대기)

---

## 🔑 환경변수 / 인증 현황

- 운영 = `irene@87.106.78.146`(planq.kr, port 3004, /opt/planq/backend, DB planq_prod_db). SSH passwordless(read-only 조회).
- **feedback_items**: kind 컬럼 없음(dev와 다름). 미해결 pending 16 + reviewing 2 = 18건.
- 운영 위키 스키마: help_categories(title_ko/title_en), help_articles(is_published tinyint, visibility enum public/authenticated).
- dev DB 접근은 `cd /opt/planq/dev-backend` 후 node (dotenvx .env 그 디렉터리 기준). e2e/가드는 `cd /opt/planq` 루트에서.

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
### 참조
- 정책: CLAUDE.md "Fable 검증 게이트" · 메모리 `feedback_fable_all_design_verification`
- 운영 피드백 조회: `ssh irene@87.106.78.146 "cd /opt/planq/backend && node _fb.js"` (config/database 의 sequelize 사용, models.sequelize 아님)
- 2탭 실시간 카나리: `cd /opt/planq && node scripts/e2e/run.js --suite mailrt`
