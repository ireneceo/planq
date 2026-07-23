# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-23 18:05 (Opus 4.8, 1M) — /개발완료 처리됨
**작업 상태:** **완료 (전부 Fable 게이트 PASS, 미배포).** #146 랜딩 스크린샷 + 운영 피드백 5건 + **파일 격리 보안 결함**(개인/팀 파일이 전 멤버 노출 — 운영에 13건 실재, 전부 워프로랩 내부) 수정. 가드 3축 통과·커밋·백업 완료. 다음 = **/배포** + 파일 백필 운영 적용 + 미해결 피드백 잔여.

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 지금 중단 지점

**마지막 작업 (미배포, 로컬 커밋 13개):**

1. **#146 랜딩 /features 제품 스크린샷** (`406a5fc`·`0bd29bb`·`4c73ffe` 일부) — 데모 워크스페이스 "온무늬"(라온랩스에서 변경 — 실존 법인 회피) 시드 + 자동 캡처 파이프라인. 5장 라이브: https://dev.planq.kr/features
   - `dev-backend/scripts/seed-demo-workspace.js` — 멱등 시드(팀3·고객3·프로젝트3·대화3/메시지12·업무8·파일8(실바이트 10MB)·청구서9·수금7). fail-closed 격리 가드(DB화이트리스트·NODE_ENV·타워크스페이스소속·양방향).
   - `q-note/scripts/seed_demo_sessions.py` — Q Note SQLite 별도 시드(세션3).
   - `scripts/marketing-capture.js` — e2e lib 재사용, 1440×900@2x→webp≤150KB. 온보딩 배너 억제·프로젝트 열기.
   - `.env DEMO_CAPTURE_PASSWORD` 추가됨. 데모 계정 `capture@demo.planq.kr`, ws=105.
   - **데모 이름(Fable 검색 검증): 온무늬·노들커머스·모눈스터디·들녘테이블 / 김서연·이지민·박준호·정민아·강민재·윤소민.** 전화 02-1234-5678만 실가입 확인불가(Irene 판단 대기).

2. **운영 피드백 5건 수정** (`631d51f`) — Fable 14건 전수 판정 후:
   - **#198** 개인메일 등록 실패 — 앱비밀번호 4자4묶음 공백 → `services/email_credentials.js`(신규) `normalizeImapPassword`(앱비번 provider만 공백제거, 일반IMAP은 trim). 한수정 보고 건.
   - **#197/#202** 메일 번역 2분 실패 — 진짜 원인 LLM 양방향(2000토큰/20초). 단방향 `translateOne`+`translation_long`(45초/4000토큰)+잘린번역차단(finish_reason). **1300자 60초실패→7초성공**.
   - **#200(c)** 메일 이미지 원본크기 확대 — 전역 height:auto가 발신자 HTML height 무효화 → 크기미지정만 적용+max-height:60vh.
   - **#199** 노션형 탭 위로 드로어 — `--chrome-top` CSS변수 단일원천(MainLayout)→DetailDrawer·TaskDetailDrawer 탭아래.
   - **별건 파일 유출** — 프로젝트 비멤버가 L2 파일·첨부+무인증 download_url. `/projects/:id/files`·`all-files` 둘 다 vlevel/멤버십 필터(fileListWhereByLevel+myProjIds).

3. **★ 파일 격리 보안 결함** (`4c73ffe`) — **업로드가 visibility만 쓰고 vlevel 미기록→default L3→개인/팀 파일 전멤버 노출**. `routes/files.js` 4경로에 vlevel 동시기록 + `scripts/backfill-file-vlevel.js`(dry-run 기본). **운영 미적용 — 13건 실재(전부 워프로랩 내부, 외부유출0)**.

**맥락 유지할 것:**
- ★ **Fable 무조건 게이트**(CLAUDE.md). 이번 세션 Fable 게이트 여러 번(FAIL→수정→PASS 반복). god-file·all-files유출을 Fable이 잡아냄.
- **Fable 게이트 마커 지문 버그 수정**(`0bd29bb`): `/fable-검증` 문서가 `git status|sha256sum`(개행포함)인데 훅은 `printf '%s'`(개행없음)라 영원히 불일치→마커 무시되던 것. `printf '%s' "$(...)"` 로 통일.
- **버전 라벨**: 운영 PM2 아직 1.48.0/1.48.1. 다음 배포 시 반영.
- **#126 후속(OAuth 대기)**: 개인 구글캘린더 쓰기 = Irene Google 검증 대기.

---

## 📂 다음 할 일 (우선순위)

1. **/배포** — 로컬 커밋 13개 미배포. #146 스크린샷 + 피드백 5건 + 파일 격리 fix 포함.
   - **파일 백필 운영 적용**(배포 동반): `node scripts/backfill-file-vlevel.js`(dry-run 영향건수 확인)→롤백스냅 생성→`--apply`→"불일치0" 확인. 노출범위 좁힘(L3→L1/L2)=정상복원(Fable 판정). 운영 13건 대상.
2. **미해결 피드백 잔여** (Fable 후속 권고, 다음 사이클):
   - **#200(a)(b)** 메일 답변필요 정렬/과거메일 잔존 — 프론트 merge를 server-fresh로(앵커 보존). 옛 데이터 광고메일 재판정.
   - **#201** 캘린더 문구 — 개인연동 사용자에겐 현재 문구가 **거짓**(개인연동은 읽기전용인데 "자동 반영" 안내). 연동종류별 분기.
   - **#195** 도움말 qtalk/qinfo/settings 3카테고리 게스트 미노출(공개 아티클 0건). seed-wiki-content 승격.
   - **#196** HomePage.tsx:34 Hero 헤드라인 하드코딩(영어모드 한국어). t() 이관.
   - **#192** 메일 외 AI 다듬기 확장(공통 AiRefineBar). **#193** agenda 복귀. **#146** 검색헤더 승격.
3. **#203 메일 알림** (보류) — reply_needed 정확도(#200b) 선행 필수(지금 붙이면 광고 push). `notification_prefs` ENUM ALTER = **운영 마이그레이션 3단 게이트**.
4. **별건 미구현** (Fable 판정): `public-image` 무인증 게이트를 L3/share_token 한정+서명URL = 보안경계 재설계 3단 게이트. 프로젝트 자료탭 metadata 정책.
5. **#126 개인캘린더·OAuth** = Irene(Google 검증).

---

## 🔑 환경변수 / 인증 현황

- 운영 = `irene@87.106.78.146`(planq.kr, port 3004, /opt/planq/backend, DB planq_prod_db). SSH passwordless(read-only 조회·피드백 확인에 사용).
- **feedback_items 컬럼**: id,user_id,business_id,category,priority,title,body,attachments,page_url,status,admin_response,... (kind 컬럼 없음 — dev와 다름 주의). 미해결: pending 12+reviewing 2 = 14건.
- `.env DEMO_CAPTURE_PASSWORD` 추가됨(dev만, 데모 시드/캡처용).
- Google OAuth 검증 미완(Irene). Stripe SaaS 키 미연결(Irene).

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
### 참조
- 정책: CLAUDE.md "Fable 검증 게이트" · 메모리 `feedback_fable_all_design_verification`
- 운영 피드백 조회: `ssh irene@87.106.78.146 "cd /opt/planq/backend && node -e '...'"` (read-only, feedback_items에 kind 컬럼 없음)
- 운영 파일 격리 확인: `SELECT visibility,vlevel,COUNT(*) FROM files WHERE deleted_at IS NULL GROUP BY 1,2` (불일치=노출)
