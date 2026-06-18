# Q위키 (Q Wiki) — 설계 문서

> PlanQ 제품 도움말 시스템. Irene 2026-06-18 확정.
> 관련 메모리: `project_help_center_plan`, `project_cue_teammate`, `project_brand_concept`.

---

## 0. 개념·네이밍 (확정)

혼선의 근본 원인은 **"Q helper"라는 단어가 두 레벨에 겹친 것** — 허브(도우미) 이름이면서
동시에 콘텐츠 탭(제품 사용법) 이름이기도 했음. 해결은 이름을 없애는 게 아니라 **콘텐츠 탭에서만 빼는 것**.

> **Q helper = 도우미 허브 이름(우측 하단 버튼 + 드로어 타이틀) — 유지.** (Irene 2026-06-18 확정)
> 그 아래 두 방: **Cue**(내 워크스페이스) · **Q위키**(PlanQ 사용법). 사용법 탭이 더 이상 "Q helper"가 아니므로 겹침 해소.

질문의 *종류*로 두 방을 가른다.

| 구분 | **Cue** | **Q위키 (Q Wiki)** |
|------|---------|---------------------|
| 답하는 것 | "내 워크스페이스가 어떻게 돼가?" | "PlanQ를 어떻게 쓰지?" |
| 데이터 | 동적·워크스페이스별(내 업무/고객/일정) | 정적·누구에게나 동일(제품 사용법) |
| 형식 | 대화형 AI 팀원 | 문서(article) + 검색 + 근거 AI 답변 |
| 격리 | 워크스페이스 격리 | 공개(public)/로그인(authenticated) |

- **"Q helper" 허브 이름 유지.** 드로어 타이틀·우측 하단 버튼 = "Q helper". 그 안 탭이 Cue/Q위키/문의.
- Cue가 사용법 질문을 받으면 → Q위키 article 인용/연결(핸드오프). Irene의 "큐헬퍼 아래" = 허브 아래 두 방 구조로 구현.
- 기존 `qhelper` 모드(근거 없는 LLM 일반답) → **Q위키 검색 + article 기반 RAG 답변으로 승격**.

---

## 1. 변경 전수 지도 (모든 터치포인트)

### Frontend

| # | 파일 | 변경 |
|---|------|------|
| F1 | `components/Common/CueHelpDrawer.tsx` | **핵심 리팩토링**. 파일명 유지(import 17곳). **드로어 타이틀 "Q helper" 유지(허브)**. 탭 라벨만 `workspace→Cue` / `qhelper→Q위키` / `inquiry→문의`, 각 탭 부제·아이콘·색 구분. Q위키 탭 = 맥락 article 카드 + 검색 + RAG 답변 + "전체 Q위키 열기 →". QuickChips 를 Q위키 카테고리 칩으로. |
| F2 | `pages/Wiki/WikiPage.tsx` **(신규)** | 전용 `/wiki` 풀페이지. `PageShell`. 첫 접속 시 카테고리 요약 오버뷰(`planq_tour_` 패턴 재사용), 이후 검색·브라우즈. 게스트 접근(public만). |
| F3 | `pages/Wiki/WikiArticlePage.tsx` **(신규)** | article 상세 — body blocks 렌더 + 스크린샷 + "이 화면 열기"(linked_route) + 관련 article. |
| F4 | `App.tsx` | `/wiki`, `/wiki/:slug` lazy 라우트 추가(게스트 허용). `/help-popout` 유지(드로어 팝아웃). |
| F5 | `components/Common/RightDock.tsx` | **"Q helper" 항목·라벨 그대로 유지**(허브 이름). 변경 없음 — 팝아웃은 드로어(기본 Cue 탭). |
| F6 | `components/Common/HelpDot.tsx` | `cue:ask` 이벤트에 `tab:'wiki'` 추가 → 사용법 질문은 **Q위키 탭**으로 오픈. popover에 "Q위키에서 더 보기 →" 링크 추가. tourPageKey 유지. |
| F7 | `components/Landing/*` | 헤더/푸터 "도움말" 링크 → `/wiki`(공개 article). 선택: 랜딩 도움말 섹션. |
| F8 | 진입점 9곳(`cue:ask` dispatch) | QTask/QTalk/QNote/Knowledge/Docs/Todo/Dashboard 의 HelpDot `askCue` → Q위키 탭 타겟. 이벤트 핸들러만 분기, 호출부 무변경. |
| F9 | `App.tsx` 드로어 마운트 | `cue:ask` 리스너가 `detail.tab` 따라 mode 결정. |
| F10 | locales `wiki.json` ko/en **(신규)** + `common.json` qhelper.* 키 정리 | i18n.ts ns 배열에 `wiki` 등록. 탭 라벨·부제·빈상태·검색 ko/en. |

### Backend

| # | 파일 | 변경 |
|---|------|------|
| B1 | `models/HelpCategory.js` **(신규)** | help_categories. |
| B2 | `models/HelpArticle.js` **(신규)** | help_articles. association: belongsTo HelpCategory. |
| B3 | `routes/wiki.js` **(신규)** | 공개+로그인 read API (categories/articles/search/detail/context). pagination 표준. |
| B4 | `routes/admin.js` 또는 `routes/admin_wiki.js` **(신규)** | article·카테고리 CRUD + published 토글 + 스크린샷 캡처 트리거. requireRole('platform_admin'). |
| B5 | `routes/cue.js` qhelper 모드 | 질문 시 help_articles retrieval(FULLTEXT + KB 임베딩) → 컨텍스트 주입 + `sources[]`(article slug/title) 반환. `SYSTEM_PROMPT_QHELPER` 수정("아래 Q위키 문서 기반으로만, 출처 명시"). |
| B6 | `services/wikiSearch.js` **(신규)** | FULLTEXT(ngram) 키워드 검색 + KB 엔진(text-embedding-3-small) 재사용 임베딩 검색 하이브리드. (memory `project_kb_engine_reuse`) |
| B7 | `services/wikiScreenshot.js` **(신규)** | `pdfService.js` Puppeteer 재사용. dev 테스트계정 로그인 → 라우트별 캡처 → File 테이블 dedup 저장 → article 연결. 멱등 재캡처. |
| B8 | `server.js` | wiki·admin_wiki 라우트 등록. |
| B9 | `sync-database.js` | 신규 2모델 sync + FULLTEXT 인덱스(ngram) ALTER. |

### Admin

| # | 파일 | 변경 |
|---|------|------|
| A1 | `pages/Admin/AdminWikiPage.tsx` **(신규)** | 카테고리/article CRUD, body blocks 에디터(기존 RichEditor 재사용), published 토글, 스크린샷 1클릭 캡처, 미리보기. |
| A2 | Admin 사이드바 | "Q위키 관리" 메뉴 추가. |

---

## 2. DB 스키마

### help_categories
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | INT PK | |
| slug | VARCHAR(60) UNIQUE | URL·라우트 매칭 |
| title_ko / title_en | VARCHAR(120) | |
| summary_ko / summary_en | VARCHAR(300) | 첫 접속 오버뷰 한줄 요약 |
| icon | VARCHAR(40) | 아이콘 키 |
| sort_order | INT default 0 | |
| created_at / updated_at | DATETIME | underscored |

### help_articles
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | INT PK | |
| slug | VARCHAR(80) UNIQUE | `/wiki/a/:slug` |
| category_id | INT FK help_categories | |
| title_ko / title_en | VARCHAR(160) | |
| summary_ko / summary_en | VARCHAR(400) | 카드·검색결과 |
| body_ko / body_en | JSON | 블록 배열(heading/text/step/image/callout). image 블록은 `file_id` 참조(File 재사용) |
| visibility | ENUM('public','authenticated') default 'authenticated' | public=게스트·랜딩 노출 |
| linked_route | VARCHAR(120) NULL | "이 화면 열기" + 맥락 매칭 |
| est_minutes | INT NULL | 소요 시간 |
| sort_order | INT default 0 | |
| is_published | BOOLEAN default false | |
| view_count | INT default 0 | |
| created_at / updated_at | DATETIME | |

- **FULLTEXT** (`title_ko,summary_ko,title_en,summary_en`) WITH PARSER ngram — 한글 검색.
- 본문 임베딩은 **기존 `kb_chunks` 재사용**(source_type='wiki', source_id=article.id) — 새 테이블 안 만듦.
- 스크린샷은 **File 테이블 재사용**(image 블록 file_id). 별도 매핑 테이블 없음 (memory `feedback_inline_assets_as_files`).

> 설계 단순화 준수: **신규 테이블 2개만**(categories, articles). 학습경로·투표·미스로그·역할타겟 테이블 전부 제외(Irene 단순화 결정).

---

## 3. API 목록

### 공개+로그인 read (`routes/wiki.js`)
| METHOD PATH | 인증 | 설명 |
|---|---|---|
| GET `/api/wiki/categories` | optional | 카테고리 목록(게스트=public article 있는 것만) |
| GET `/api/wiki/articles` | optional | `?category=&q=&limit=&page=` 목록·검색. pagination 표준. 게스트=public만 |
| GET `/api/wiki/articles/:slug` | optional | 상세 + view_count++. 게스트 public만(아니면 401) |
| GET `/api/wiki/context` | authenticateToken | `?path=` 현재 화면 linked_route 매칭 article(드로어 "이 화면에서") |

### Cue 통합 (`routes/cue.js`)
| 변경 | 설명 |
|---|---|
| qhelper 모드 | 응답에 `sources:[{slug,title}]` 추가. retrieval 기반 답변. |

### Admin (`routes/admin_wiki.js`, requireRole platform_admin)
| METHOD PATH | 설명 |
|---|---|
| POST/PUT/DELETE `/api/admin/wiki/categories[/:id]` | 카테고리 CRUD |
| POST/PUT/DELETE `/api/admin/wiki/articles[/:id]` | article CRUD + published |
| POST `/api/admin/wiki/articles/:id/capture` | linked_route Puppeteer 캡처 → File → image 블록 |
| POST `/api/admin/wiki/reembed` | kb_chunks 재임베딩(검색/RAG 갱신) |

응답 표준: `{ success, data, pagination? }`.

---

## 4. UI 흐름

### 드로어 (CueHelpDrawer 재구성)
```
헤더: Q helper                              [피드백 보내기]   ← 허브 타이틀 유지
탭:  ◉ Cue        ○ Q위키        ○ 문의
      내 워크스페이스   PlanQ 사용법
─────────────────────────────────────────
Cue:   민트 sparkle. 칩(내 업무/고객/일정/문서). 워크스페이스 RAG 답변.
Q위키: 책 아이콘.
       ┌ 이 화면에서 ─────────────┐  ← GET /wiki/context?path=
       │ · {linked article} →     │
       └──────────────────────────┘
       🔍 검색 → GET /wiki/articles?q=
       질문 → cue.js qhelper(sources 링크)
       [ 전체 Q위키 열기 → /wiki ]
문의:  기존 inquiry 폼 유지.
게스트: [Q위키][문의] (Cue 없음).
```

### 전용 `/wiki`
```
PageShell title="Q위키"
─ 첫 접속(planq_tour_wiki 미설정): 카테고리 요약 오버뷰(복수 카드) ─
   [시작하기][Q Talk][Q Task][Q Bill][Q Note][Q docs][파일][설정·권한]
   각 카드: 아이콘 + 한줄요약 + article 수
─ 이후/검색: 🔍 + 카테고리 필터 + article 카드 그리드 ─
article 상세(/wiki/a/:slug): body blocks + 스크린샷 + "이 화면 열기" + 관련 article
```

빈/로딩/에러 상태 + i18n + 반응형(DetailDrawer/PageShell 표준) 준수.

---

## 5. 초기 콘텐츠 (실 데이터 — mock 아님)

큐레이션 도움말은 **production 콘텐츠**(실 사용법 ko/en)라 mock 금지 원칙과 무관.
초기 마이그레이션으로 카테고리 8 + 핵심 article 시드(실제 사용법 텍스트):

- **시작하기**: 워크스페이스 만들기 / 팀 초대 / 고객 초대 / 첫 화면 둘러보기
- **Q Talk**: 대화 시작 / 자동 업무 추출 / 번역
- **Q Task**: 업무 만들기·담당자 / 확인요청(컨펌) / 포커스·주간그래프
- **Q Bill**: 청구서 발행 / 결제 확인 / 세금계산서·현금영수증
- **Q Note / Q docs / 파일 / 설정·권한**: 각 핵심 2~3건

> 스크린샷은 B7 Puppeteer 자동 캡처로 채움.

---

## 6. 구현 순서 (5단계)

1. **DB**: 모델 2 + sync + FULLTEXT + kb_chunks source_type='wiki'
2. **Backend**: routes/wiki.js + wikiSearch + cue.js RAG + server.js
3. **Admin**: admin_wiki 라우트 + AdminWikiPage + wikiScreenshot
4. **초기 콘텐츠**: 카테고리·article 시드 + 스크린샷 캡처
5. **Frontend**: 드로어 재구성 + /wiki 페이지 + 진입점 분기 + locales + 랜딩
6. **검증**: E2E(공개/로그인 격리, 검색, 맥락, RAG sources, 권한) + 빌드 + /검증 스킬

각 단계 완료 후 보고.

---

## 7. 검증 시나리오 (6단계 E2E)

| # | 시나리오 | 기대 |
|---|---------|------|
| V1 | 게스트로 `GET /api/wiki/articles` | `public` article만, `authenticated` 0건 노출 |
| V2 | 게스트로 `authenticated` article slug 직접 요청 | 401/404 (격리) |
| V3 | 로그인 후 동일 호출 | public + authenticated 모두 |
| V4 | 검색 `?q=청구서` (ko) / `?q=invoice` (en) | ngram FULLTEXT 매칭 결과 ≥1 |
| V5 | `GET /api/wiki/context?path=/qtask` | linked_route='/qtask' article 노출 |
| V6 | Cue qhelper 질문 "청구서 어떻게 보내?" | 응답에 `sources[]` 비어있지 않음(근거 article) |
| V7 | Admin 비-platform_admin 으로 article POST | 403 |
| V8 | Admin 캡처 트리거 → File 생성 + image 블록 연결 | File row + dedup 동작 |
| V9 | article body ko 있고 en 없을 때 en 요청 | ko fallback(빈 화면 금지) |
| V10 | 첫 접속(localStorage 없음) `/wiki` | 카테고리 오버뷰 노출. 재방문 시 일반 뷰 |
| V11 | 빌드 | `npm run build` EXIT 0, 청크 해시 갱신 |

검증 패턴: `dev-backend/test-wiki.js` (login → 호출 → 검증 → 삭제). 테스트 데이터 정리 필수.

## 8. 보안·격리·캐시·실시간

- **격리:** wiki는 플랫폼 공통 콘텐츠(business_id 없음). 멀티테넌트 무관. 격리 축은 **visibility(public/authenticated)** 만. 게스트 라우트는 `is_published=true AND visibility='public'` 강제.
- **캐시:** article은 거의 불변 → 응답에 `ETag`(updated_at 해시) + `Cache-Control: public, max-age=300`. admin 수정 시 자연 만료. SPA HTML은 no-cache(memory `feedback_nginx_html_no_cache`).
- **실시간(항목16):** wiki는 정적이라 socket broadcast 불필요. admin 수정 즉시 반영은 클라 재요청(ETag)으로 충분. **단** admin 캡처/재임베딩은 비동기(fan-out) — 즉시 응답 + 백그라운드 처리(memory SaaS readiness 패턴).
- **rate-limit:** `cue.js` qhelper 는 기존 per-user rate-limit 유지(외부 LLM 비용). 검색/조회 read 는 일반 100/분.
- **i18n:** UI 라벨=`wiki.json`. 본문=DB ko/en. 한쪽 누락 시 반대 언어 fallback(빈 화면 금지, V9).
- **mock 금지:** 초기 article은 **실제 사용법 텍스트**(production 콘텐츠) — 마이그레이션 시드. 가짜/placeholder 본문 금지.
