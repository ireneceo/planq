# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-18
**작업 상태:** 완료 — Q위키(Q Wiki) 핵심 운영 배포 (v1.41.0)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- **Q위키(Q Wiki) v1.41.0 운영 배포 완료** (commit `5a399f7`, deploy `20260618_053527` 129초, https://planq.kr 헬스 OK).
  - DB: `help_categories`/`help_articles` 2모델 + FULLTEXT(ngram) + **kb_chunks 재사용**(source_type 'kb'/'wiki' + source_id + business_id nullable, 워크스페이스 KB 비오염 검증). 운영은 `setup-wiki-schema.js`(멱등) 명시 실행.
  - Backend: `routes/wiki.js`(공개+로그인 read, optionalAuth, lang fallback, pagination, `/image` IDOR가드) · `services/wikiSearch.js`(FULLTEXT+임베딩 하이브리드 SEM_THRESHOLD 0.30) · `cue.js` qhelper→RAG sources[].
  - Admin: `routes/admin_wiki.js`(CRUD+캡처+재임베딩) · `services/wikiScreenshot.js`(Puppeteer, env-gated).
  - 콘텐츠: 카테고리 8 + article 20(ko/en) + 임베딩, dev/운영 시드(`seed-wiki-content.js` 멱등).
  - Frontend: `WikiPage`(/wiki) + `WikiArticlePage`(/wiki/a/:slug) 게스트허용 · `services/wiki.ts` · locales wiki ko/en(28/28).
  - 드로어 F1: 타이틀 "Q helper" 유지 + 탭 Cue/Q위키/문의 + 맥락카드 + 카테고리칩 + sources칩 + "전체 Q위키 열기".
  - 검증: 헬스 29/29, 빌드 EXIT0(8GB), API 10/10(격리·검색·맥락·RAG·권한403·KB비오염), 운영 /wiki·/wiki/a/:slug 200·게스트 격리 OK. 버전 v1.40.3→**v1.41.0**.

### 다음 할 일
1. **Q위키 프론트 마무리 (남은 F6/F8/F7/A1·A2 — 미배포):**
   - F6: `HelpDot` 의 `cue:ask` dispatch 에 `tab:'wiki'` 추가 (드로어 이벤트 분기는 이미 준비됨) → ⓘ 클릭 시 Q위키 탭으로
   - F8: 진입점 9곳(QTask/QTalk/QNote/Knowledge/Docs/Todo/Dashboard) HelpDot → Q위키 탭 타겟
   - F7: 랜딩 헤더/푸터 "도움말" → `/wiki`
   - A1/A2: `pages/Admin/AdminWikiPage.tsx`(카테고리·article CRUD + RichEditor body + published + 1클릭 캡처 + 미리보기) + Admin 사이드바 "Q위키 관리"
2. **스크린샷 자동캡처 활성화 (결정 필요):** `wikiScreenshot.js` 코드 완성. 데모데이터 보유 전용 계정 정해지면 운영/dev `.env` 에 `WIKI_CAPTURE_EMAIL`/`WIKI_CAPTURE_PASSWORD`/`WIKI_CAPTURE_BUSINESS_ID` 설정 → article `linked_route` 자동 캡처.
3. **AI 기능 전수검사** — `docs/AI_FEATURE_AUDIT.md` (22 AI기능, 실 API 동작증명). 1순위: Cue A1·A2·A4 / AI업무 B1·B3 / 번역 C1 / Q Note E1~E3. Q Note는 `/qnote/api` 경유.

### 참고
- `planq-dev-backend`·`planq-qnote` 는 **irene** pm2(메모리의 lua 정보는 이 케이스 해당 안 됨). `pm2 restart planq-dev-backend`.
- 운영 헬스의 버전 문자열은 다음 배포 때 v1.41.0 으로 갱신됨(이번 배포는 코드 5a399f7 기준, package.json 버전 커밋 c193af8 은 미배포).

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
