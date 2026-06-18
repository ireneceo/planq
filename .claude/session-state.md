# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-18
**작업 상태:** Q위키 구현 진행 중 — 백엔드 완료(검증 10/10), 프론트엔드 남음

### 진행 중인 작업
- **Q위키(Q Wiki) 구현** — `docs/Q_WIKI_DESIGN.md`. 6단계 중:
  - ✅ 1단계 DB — `models/HelpCategory.js`·`HelpArticle.js` + index.js 등록/association. `sync-database.js` 생성. `setup-wiki-schema.js`(멱등): help_articles FULLTEXT(ngram) + kb_chunks 재사용(business_id/kb_document_id nullable + source_type 'kb'/'wiki' + source_id + 인덱스). KbChunk 모델도 동기화.
  - ✅ 2단계 Backend — `routes/wiki.js`(공개+로그인 read: categories/articles/search/context, lang fallback, pagination, ETag/cache). `services/wikiSearch.js`(FULLTEXT+임베딩 하이브리드, SEM_THRESHOLD 0.30, indexArticle/removeArticleIndex). `middleware/auth.js`에 `optionalAuth` 추가. `routes/cue.js` qhelper→Q위키 RAG 승격(sources[] 반환, SYSTEM_PROMPT_QHELPER 근거 지시). `server.js` 등록(/api/wiki, /api/admin/wiki).
  - ✅ 3단계 Admin 백엔드 — `routes/admin_wiki.js`(카테고리·article CRUD + published + capture + reembed, requireRole platform_admin). `services/wikiScreenshot.js`(pdfService getBrowser 재사용, 캡처계정 쿠키로그인→캡처→File dedup→image블록. **env WIKI_CAPTURE_EMAIL/PASSWORD/BUSINESS_ID 필요 — 미설정 시 비활성**). pdfService에 getBrowser export.
  - ✅ 4단계 초기 콘텐츠 — `seed-wiki-content.js`(멱등): 카테고리 8 + article 20(실 사용법 ko/en, public 3·authenticated 17) + 임베딩 인덱싱. **dev DB 적재 완료**.
  - ✅ 백엔드 E2E **V1~V9 10/10 통과** (게스트격리/검색ko·en/맥락/Cue sources/admin 403/lang fallback). test-wiki.js 삭제 완료.
  - 🔶 **5단계 Frontend (부분 완료)**:
    - ✅ F2 WikiPage `/wiki` (오버뷰/검색/카테고리칩/카드, 첫접속 localStorage `planq_wiki_overview_seen`)
    - ✅ F3 WikiArticlePage `/wiki/a/:slug` (블록렌더 heading/text/step/callout/image, "이 화면 열기", 관련글)
    - ✅ F4 App.tsx 게스트 허용 lazy 라우트(`/wiki`, `/wiki/a/:slug` — public, ProtectedRoute 밖)
    - ✅ F10 locales `wiki.json` ko/en + i18n.ts ns `wiki` 등록
    - ✅ `services/wiki.ts` API 클라이언트 + `/api/wiki/image/:fileId` 공개 서빙(IDOR 가드)
    - ✅ **빌드 EXIT 0** (WikiPage/WikiArticlePage/wiki 청크 04:41 생성, index.html 갱신). **dev 라이브: https://dev.planq.kr/wiki (게스트 접속 가능)**
    - ✅ **F1 CueHelpDrawer 재구성 완료** — 타이틀 "Q helper" 유지. 탭 재라벨 Cue(workspace)/Q위키(qhelper)/문의(inquiry) + ModeDot 색(cue 코랄/wiki 틸/inquiry 회색). Q위키 탭: WikiPanel("이 화면에서" 맥락카드 GET /wiki/context + 카테고리칩→/wiki?category + "전체 Q위키 열기 →"/wiki) + 답변 아래 sources[] 칩(→/wiki/a/:slug). Turn.sources, cue:ask `detail.tab='wiki'|'cue'` 분기, openWikiPath(navigate+close). 빌드 EXIT 0, 데이터 흐름 스모크 OK(카테고리8/맥락3/Cue근거3).
    - ⬜ F6 HelpDot `cue:ask` 에 `tab:'wiki'` 분기 + popover "Q위키에서 더 보기 →"
    - ⬜ F8 진입점 9곳(QTask/QTalk/QNote/Knowledge/Docs/Todo/Dashboard) HelpDot → Q위키 탭 타겟
    - ⬜ F7 랜딩 헤더/푸터 "도움말" → `/wiki`
    - ⬜ A1 `pages/Admin/AdminWikiPage.tsx`(카테고리·article CRUD + RichEditor body + published + 1클릭 캡처 + 미리보기) + A2 Admin 사이드바 "Q위키 관리"
  - ⬜ **6단계 최종검증** — V8(캡처→File, env 필요), V10(첫접속 오버뷰 localStorage), V11(npm run build EXIT 0).

### ⚠️ 미해결/결정 필요
- **스크린샷 캡처 계정**: `wikiScreenshot.js`는 데모 데이터 보유 워크스페이스의 전용 계정(WIKI_CAPTURE_EMAIL/PASSWORD/BUSINESS_ID)이 .env에 있어야 동작. 미설정 시 캡처만 비활성(나머지 위키 정상). Irene 결정 필요.
- **PM2 위치 정정**: `planq-dev-backend`는 **irene** pm2(id 2)에 등록됨(lua 아님 — 메모리 `feedback_pm2_multi_user_scope`는 이 케이스에 해당 안 됨). `pm2 restart planq-dev-backend`로 충분.
- **운영 미반영**: 위 전부 dev만. 운영 배포 시 setup-wiki-schema.js + seed-wiki-content.js 순차 실행 필요.

### 완료된 작업 (이번 세션)
- **운영 #57·#58·#59 (포커스/주간업무진척 그래프) 수정·운영배포 완료** (v1.40.3, deploy 134초, index.html 00:42, 헬스 OK). daily-progress가 `FocusSession.computeActualSeconds()` 일별귀속 누적 반영 + act_used=max(스냅샷,포커스), 프론트 오늘 actual=max(라이브,포커스누적). E2E 6/6.
- **알림소리 톤다운** (`NotificationToaster.tsx`) — 맥북 귀아픔. mp3 에셋 부재로 항상 합성음(784+1174Hz·gain0.45·lowpass無). → C5 523+E5 659Hz(장3도)+lowpass 2kHz+볼륨0.16. **dev만 — 운영 미반영.**
- **Q위키 설계확정** `docs/Q_WIKI_DESIGN.md` — IA: "Q helper"=허브 버튼·타이틀 유지, 그 아래 Cue(내 워크스페이스)+Q위키(PlanQ 사용법)+문의. 전수지도+DB2+API+검증 V1~V11.
- **AI 전수검사 체크리스트** `docs/AI_FEATURE_AUDIT.md` — 22 AI기능 A~E.

### ▶▶ 다음 할 일 (다음 섹션 — 여기서 시작)
1. **Q위키(Q Wiki) 구현** — `docs/Q_WIKI_DESIGN.md` 완결. 순서: ①DB(모델2: HelpCategory/HelpArticle) →②Backend(routes/wiki.js + wikiSearch[FULLTEXT ngram+kb_chunks 임베딩 재사용] + cue.js qhelper→Q위키 RAG 승격) →③Admin(admin_wiki + AdminWikiPage + wikiScreenshot[pdfService Puppeteer 재사용]) →④초기콘텐츠(카테고리8+실사용법 article 시드, **mock금지**) →⑤Frontend(드로어 탭 Cue/Q위키/문의·타이틀 "Q helper" 유지·/wiki 페이지·진입점 분기·locales wiki ns·랜딩) →⑥검증 V1~V11. memory `project_help_center_plan`.
2. **모든 AI 기능 전수검사** — `docs/AI_FEATURE_AUDIT.md` 완결. **실 API 호출로 동작증명**(코드확인 금지). 1순위(고급): Cue A1·A2·A4 / AI업무 B1·B3 / 번역 C1 / Q Note E1~E3. Q Note는 `/qnote/api` 경유. 청크단위 검증·발견결함 직접fix·데이터 원복.

### ⚠️ 유료고객 테스트 관련 (오늘)
- #57·#58·#59 포커스 그래프 fix는 **운영 배포 완료**.
- **알림소리 톤다운은 dev만 — 운영 미반영.** 고객이 맥북이면 옛 날카로운 소리 그대로. 필요 시 `/배포`로 운영 반영(소리 커밋은 `2cb23ef` wip-autosave에 이미 포함, push 안 됨).

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
