# 자기강화 지식 시스템 설계 (Knowledge Loop)

> 2026-07-02 Irene 승인. 구현 순서: **축 2 (위키 루프) → 축 1 (Cue 지식) → 축 3 (블로그)**.
> 공통 원칙: **자동은 "제안까지만", 확정은 사람 승인** (이메일 FAQ 패턴을 표준 루프로 승격) + AI 최소 사용 (LLM 은 제안 생성 시점만, 배치·저비용 모델).
> 현황 전수조사: Cue 응답 컨텍스트(cue_context.js 7종)는 우수하나 축적 루프는 이메일 FAQ·TaskEstimation 2개뿐. Q위키 질문 로그 전무, /blog 는 빈 UI.

---

## 축 2 — Q위키 자기강화 루프 ("질문할수록 탄탄해지는")

### 루프 구조
```
사용자 질문 (Q helper / 공개 위키챗)
  → help_question_logs 전량 기록 (질문·근거 article·답변가능 여부)
  → 답변 하단 피드백 2버튼 (도움됐어요 / 아니요) → 로그에 기록
  → 주간 cron: 미답변·불만족 질문 클러스터링 (임베딩 유사도 ≥0.85, ≥3회 — emailFaqCluster 재사용)
  → 클러스터별 위키 초안 자동 생성 (gpt-4o-mini, is_published=false, origin='auto_cluster')
  → platform_admin 알림 → 검토·수정·발행 (기존 admin_wiki CRUD)
  → 발행 시 자동 재임베딩 (기존 wikiSearch.indexArticle 루프)
  → 같은 질문에 답 가능 ✓ (루프 닫힘)
```

### DB
**신규 `help_question_logs`**
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INT PK AI | |
| user_id | INT NULL | 공개(비로그인) 질문은 NULL |
| business_id | INT NULL | |
| mode | ENUM('qhelper','public') | routes/cue.js /help vs /help-public |
| question | VARCHAR(1000) | |
| lang | VARCHAR(5) | |
| answered | BOOLEAN | 근거 article 검색 hit 여부 |
| top_article_id | INT NULL FK help_articles | 최상위 근거 |
| feedback | ENUM('helpful','not_helpful') NULL | 2버튼 |
| feedback_at | DATETIME NULL | |
| processed_article_id | INT NULL FK help_articles | 클러스터 초안에 반영됨 표시 (재처리 방지) |
| created_at / updated_at | | INDEX(created_at), INDEX(answered, feedback) |

**help_articles 컬럼 추가**: `origin ENUM('manual','auto_cluster') DEFAULT 'manual'`, `origin_meta JSON NULL` (질문 샘플·건수·log_ids).

### API
| METHOD | 경로 | 인증 | 설명 |
|--------|------|------|------|
| (수정) POST /api/cue/help, /help-public | 기존 | 응답에 `log_id` 추가. 질문을 help_question_logs 에 fire-and-forget 기록 |
| POST /api/cue/help-feedback | optional auth + rate-limit | body `{ log_id, feedback }`. 이미 feedback 있으면 409 |
| GET /api/admin/wiki/question-logs | platform_admin | 필터: unanswered / not_helpful / 기간. 위키 개선 대시보드용 |

### 서비스
`services/wikiQuestionCluster.js` — 주 1회 (월 05:00 KST) cron:
1. 최근 30일 `(answered=false OR feedback='not_helpful') AND processed_article_id IS NULL` 로드 (상한 500)
2. 질문 임베딩 → 코사인 ≥0.85 클러스터, ≥3건만
3. 클러스터별 gpt-4o-mini 로 초안 생성 (title/summary/body ko+en, 위키 body 블록 JSON 형식)
4. `HelpArticle(is_published=false, origin='auto_cluster', origin_meta)` 생성 + 카테고리는 slug 'suggested'(자동 생성) + 로그에 processed_article_id 마킹
5. platform_admin notify ("위키 초안 N건 제안됨")

### UI
- CueHelpDrawer Q위키 탭: 답변 말풍선 하단 "도움됐어요 / 아니요" (선택 후 회색 고정, 재클릭 불가)
- admin wiki 목록: 미발행 + origin='auto_cluster' 항목에 "자동 제안" 배지 (기존 페이지 확장)

---

## 축 1 — Cue 워크스페이스 도메인 지식 (Workspace Memory)

### 지식 카드 테이블 `cue_knowledge`
| 컬럼 | 설명 |
|------|------|
| id, business_id (INDEX) | 워크스페이스 격리 |
| kind ENUM('work_pattern','client_trait','terminology','decision','custom') | |
| title VARCHAR(200), body TEXT | 카드 내용 (Cue 프롬프트 주입 단위) |
| source ENUM('auto_mined','user') | |
| status ENUM('pending','active','rejected') | 자동 채굴은 pending, 사람 수락 시 active |
| meta JSON | 채굴 근거 (통계 수치, 참조 entity) |
| created_by, decided_by, decided_at | |

### 자동 채굴 (주 1회 배치, LLM 최소)
1. **업무 패턴** (LLM 없이 순수 SQL): 카테고리별 완료 task 의 실측 시간(actual_hours, focus 기반) 평균·중앙값·표본수 — 표본 ≥5 인 카테고리만 카드 제안. 기존 TaskEstimation few-shot 과 별개로 "실측" 통계
2. **고객 특성**: 기존 `generateClientSummary` 산출물 재사용 (신규 LLM 호출 없음)
3. terminology/decision 은 자동 채굴 없이 **사용자 직접 등록만** (프로젝트 노트 자동 발췌는 오탐 위험 — 비범위)

### 루프 재연결 3건 (신규 테이블 불필요)
1. `cue_context.getClientSnapshot` 이 `client.summary` 를 다시 읽어 프롬프트 포함 (1줄 수정 급)
2. `aiTaskPlanner` / `callAiEstimate` 프롬프트에 워크스페이스 카테고리별 실측시간 통계 주입
3. Cue task 결과물(body) 컨펌 승인 화면에 "KB에 저장" 버튼 → KbDocument 생성 + indexDocument (사람 게이트)

### 주입 지점
- `buildCueContext` 에 `getKnowledgeCards(businessId)` 추가 — status='active' 카드 최대 10장을 `# 워크스페이스 지식` 섹션으로
- 설정 > Cue > "워크스페이스 지식" 관리 페이지: pending 제안 수락/수정/거절 + 직접 추가 (AutoSaveField)

---

## 축 3 — 랜딩 블로그 = Q위키 발행

### 원칙: 별도 CMS 없음. Q위키가 소스, 발행 여부만 글 단위 선택.

### DB — help_articles 컬럼 추가
`blog_published_at DATETIME NULL` (NULL=미발행), `blog_category VARCHAR(40) NULL` (guide/video/insight/case — BlogPage 칩 매핑), `blog_cover_file_id INT NULL`.
조건: 블로그 발행은 `visibility='public' AND is_published=true` 인 글만 허용 (내부용 유출 방지).

### API (public, 인증 없음, rate-limit)
| METHOD | 경로 | 설명 |
|--------|------|------|
| GET /api/blog/posts?category=&page= | blog_published_at NOT NULL 목록 (제목/요약/커버/날짜) |
| GET /api/blog/posts/:slug | 상세 (본문 블록 → 렌더) |
| (admin) PUT /api/admin/wiki/articles/:id/blog | 발행/해제 + 카테고리 |

### UI
- `BlogPage.tsx`: EmptyState → 실데이터 목록 (기존 카테고리 칩 재사용, 프리뷰 카드 디자인 유지)
- `/blog/:slug` 상세 페이지 신규 (위키 article 렌더러 재사용) + SEO meta(title/description/og)
- admin wiki 편집 화면에 "블로그 발행" 토글 + 카테고리 선택

### 자동 보완 흐름
축 2 루프로 위키가 자라고 → public 글 발행 시 관리자가 블로그 토글 → /blog 즉시 노출. (완전 무인 발행은 비범위 — 마케팅 페이지 품질 게이트)

---

## 테스트 계획 (구현 후 docs/KNOWLEDGE_LOOP_TESTS.md 로 결과 박제)
- 축2: /help 질문 → 로그 row 생성 확인 → feedback POST → 클러스터 cron 수동 실행 (시드 질문 3건) → 초안 article 생성 + admin 조회 → 발행 → 재질문 시 근거 hit
- 축1: 채굴 배치 수동 실행 → pending 카드 → 수락 → Cue /help(workspace 모드) 응답에 지식 반영 확인
- 축3: 발행 토글 → GET /api/blog/posts 노출 → 해제 시 미노출 → 비공개 글 발행 시도 400
