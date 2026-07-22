# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-22 12:15 (Opus 4.8, 1M)
**작업 상태:** **v1.48.1 운영 배포 완료** (commit `d7148ab`+`2a7a51f`, Complete 200s, Fable 게이트 PASS ×2 + 3점 실측). ①알림 다이제스트 제목 `[PlanQ]`→워크스페이스별 분리 발송 ②#196 반복주기 영어 어순(`Every 3 weeks`)+qnote CSV 영어화 ③링크→앱 파악(메모리 `project_link_app_open_prelaunch` 박제, 앱출시 전 정비). 다음 = **#146 잔여(/features 캡처·빠진 기능)**.

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 지금 중단 지점

**마지막 작업:** **v1.48.1 운영 배포 완료**(`d7148ab`+`2a7a51f`, Complete 200s, 3점 실측 통과·청크 index-CkJ29FWy). ①**알림 다이제스트 접두어 버그** — 미읽음 에스컬레이션(`unreadEscalationCron.js`)이 제목 `[PlanQ]` 하드코딩 → 사용자×워크스페이스 그룹핑 분리발송 + `subjectPrefix(workspaceName)` 재사용 + EmailLog 귀속. 같은 업무댓글이 즉시=`[워프로랩]`/에스컬레이션=`[PlanQ] 외 N건`으로 갈리던 것 해소. ②**#196 반복주기 영어 어순** — `formatRRuleLabel` 4분기 접미사 연결(`3 week` 깨짐)→보간키 `recur.everyN*`(`Every 3 weeks`), qnote CSV 영어화. 둘 다 Fable 게이트 PASS.

**바로 다음 작업:** **#146 스크린샷 구현(Fable A′ 설계 확정) + Q Record 배포**. 
- **Q Record**(`aa24a90`): /features MORE 그룹에 누락됐던 Q Record(Notion-DB식) 추가 완료. Fable 게이트 통과 후 **미배포** — 다음 `/배포` 대상.
- **#146 스크린샷 = Fable A′ 채택**(데모 워크스페이스+자동캡처→git 정적asset). 실행설계: (1) `dev-backend/scripts/seed-demo-workspace.js` 멱등 시드(가상회사 "라온랩스"+데모유저 `demo-capture@planq.kr`/.env `DEMO_CAPTURE_PASSWORD`+가상 고객·대화·업무·파일·청구, 상대날짜) (2) `scripts/marketing-capture.js`(e2e lib `launch/login/gotoSPA` 재사용, 1440×900@2x, sharp→webp≤150KB→`dev-frontend/public/screenshots/features/q-{talk,task,note,file,bill}.webp`) (3) `FeaturesPage.tsx` MockBody→`<img onError fallback>`, aspect 16/10 (4) landing.json `q.{k}.shotAlt` ko/en. **격리 fail-closed 가드 필수**(데모계정 타 비즈 멤버십이면 abort·BASE dev만 화이트리스트, 반증테스트). **캡처 ko 단일**(시드 한글). **선결 2**: 데모 카피 Irene 1회 검수 + .env DEMO_CAPTURE_PASSWORD. 함정: Q Note 시드는 FastAPI/SQLite라 별도(데모유저 토큰 세션 or 1회 수동녹음). 규모 중, 스키마0·공개라우트0.

**맥락 유지할 것:**
- ★ **Fable 무조건 게이트**(CLAUDE.md): 모든 설계·구현검증·테스트 model:fable 독립수행. Stop 훅 강제. 메모리 `feedback_fable_all_design_verification`.
- **링크→앱 열기**: 파악 완료·메모리 `project_link_app_open_prelaunch` 박제. 앱 출시 전 정비 필수(Android host전체캡처=웹미리보기 예외 위반 지뢰·iOS AASA 과소). 앱 미출시라 지금 영향 0.
- **버전 라벨**: 운영 PM2 아직 1.48.0 표시(bump 커밋 `c925d33`이 배포 뒤). 기능은 라이브 정상, 라벨은 다음 배포 시 1.48.1 반영.
- **#126 후속(OAuth 대기)**: 개인 구글캘린더 쓰기 = `calendar.events` scope(Irene Google 검증 합산). 유출/IDOR 봉합 완료.
- 미푸시: 로컬 다수 커밋 미푸시(배포 rsync라 무관).

---

## 📦 이번 세션 작업 요약

- `d7148ab` 알림 다이제스트 접두어 `[PlanQ]`→워크스페이스별 분리발송 (Fable PASS, 운영 배포)
- `2a7a51f` #196 반복주기 영어 어순 `Every 3 weeks` + qnote CSV 영어화 (Fable PASS, 운영 배포)
- `c925d33` chore(release): v1.48.1
- `aa24a90` #146 features 페이지에 Q Record 추가 (Fable 게이트 후 미배포)
- 파악(개발 아님): 링크→앱 열기(메모리 박제) · #146 스크린샷 Fable A′ 설계 확정
- **①②는 운영 배포 완료(3점 실측)**. Q Record는 다음 `/배포` 대상.

**커밋:** `aa24a90` feat(landing): #146 features 페이지에 Q Record 추가

---

## 📂 다음 할 일 (우선순위)

1. **Q Record `/배포`** — `aa24a90` 운영 미배포. 다음 배포 시 함께(버전 라벨 1.48.1도 반영).
2. **#146 스크린샷 구현** — Fable A′ 설계 확정(위 중단지점). 데모 워크스페이스 시드 + 자동캡처 파이프라인. 선결: 데모 카피 Irene 검수 + .env DEMO_CAPTURE_PASSWORD. 구현 후 Fable 게이트(격리 반증 필수).
3. **링크→앱 열기** — 앱 출시 게이트와 묶임(메모리 `project_link_app_open_prelaunch`). 출시 전 iOS AASA 확장·Android host캡처 수정 필수.
4. #126 개인캘린더 쓰기·OAuth = Irene(Google 검증).

---

## 🔑 환경변수 / 인증 현황

- 운영 = 별도 서버 `irene@87.106.78.146`(planq.kr, port 3004, /opt/planq/backend, DB planq_prod_db). SSH passwordless 가능(피드백 read-only 조회·seed 실행에 사용).
- Google OAuth 검증 미완(Irene) — 캘린더 양방향·개인캘린더 쓰기·Gmail 원클릭 대기. `calendar.events` scope 합산 제안됨.
- Stripe SaaS 카드구독 키 미연결(Irene). Apple Team ID·APNs .p8 대기(Irene).

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
### 참조
- 정책: CLAUDE.md "Fable 검증 게이트 (전 설계·검증 무조건)" · 메모리 `feedback_fable_all_design_verification`
- #194 설계: (이 파일 맥락 섹션) — 구현 착수 시 docs 설계문서화 권장
- 운영 피드백 조회: `ssh irene@87.106.78.146 "cd /opt/planq/backend && node -e '...feedback_items...'"` (read-only)
