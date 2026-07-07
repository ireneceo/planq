# Q위키 — 지속 업데이트 & 커버리지 전략

> 작성: 2026-07-06. Irene 요청 — "Q위키 문서화를 제대로 설계해서 저장하고, **개발마다 지속 업데이트**되게." 시스템 설계는 `docs/Q_WIKI_DESIGN.md`(구조·API·UI), 지식 자동화는 `docs/KNOWLEDGE_LOOP_DESIGN.md`. **이 문서는 콘텐츠 커버리지 계획 + 개발 연동 지속 업데이트 절차**를 규정한다.

---

## 0. 문제 정의

Q위키 시스템(모델·검색·시드·admin·드로어)은 완성돼 있으나, **개발이 끝나도 위키가 자동으로 갱신되지 않는다.**
- `/개발완료` 문서매칭 테이블에 `seed-wiki-content.js` 없음 → 기능 추가 시 위키 갱신 의무 없음
- `/배포`·deploy-planq.sh 가 `seed-wiki-content.js` 실행 안 함 → 위키 콘텐츠가 배포 파이프라인 밖
- 결과: **개발 속도 > 문서 속도 → 위키가 실제 제품보다 뒤처짐.** (2026-07-06 시점 미문서화: Q Calendar·Q Mail·Insights·Cue·Q Project·qinfo)

**목표:** 위키를 코드처럼 취급 — 사용자 대면 기능이 바뀌면 같은 사이클에 위키도 바뀐다. seed는 멱등이라 코드로 관리 가능.

---

## 1. 콘텐츠 커버리지 매트릭스 (단일 진실 원천)

**모든 사용자 대면 메뉴·기능은 최소 1개 위키 아티클을 가진다.** `scripts/wiki-coverage-check.js` 가 이 표를 코드로 검증한다(§3-b).

| 영역 | 카테고리 slug | 필수 아티클(핵심) | 상태(2026-07-06) |
|------|--------------|-------------------|------------------|
| 시작하기 | `getting-started` | 워크스페이스·팀초대·고객초대 | ✅ 3 |
| Q Talk | `qtalk` | 대화시작·업무추출·번역·(멘션) | ✅ 3 |
| Q Task | `qtask` | 업무만들기·컨펌·포커스/주간·(정기업무·관점상태) | ✅ 3 |
| **Q Calendar** | `qcalendar` | 일정 만들기·구글 캘린더/Meet·공유·나만보기 | ⛔ **신규** |
| Q Note | `qnote` | 녹음·요약·빠른메모·(STT 한도) | ✅ 2 |
| **Q Mail** | `qmail` | 메일 계정 연결·인박스·메일↔대화·답장 | 🟡 부분(1) → **카테고리 신규** |
| Q docs | `qdocs` | 견적/계약·서명·(표) | ✅ 2 |
| **Q info** | `qinfo` | 고객/멤버 360°·타임라인 | ⛔ **신규** |
| Q File | `qfile` | 파일 업로드·공유·지식(KB)·(보안등급·드라이브) | ✅ 2 |
| Q Bill | `qbill` | 청구서·결제·증빙·(분할·정정·정기) | ✅ 3 |
| Clients | `clients` | 고객 초대(getting-started)·고객 상세·구독 | 🟡 부분 |
| **Insights** | `insights` | 통계 7탭·수익성·**내부/고객 구분**·팀 | ⛔ **신규** |
| **Q Project** | `qproject` | 프로젝트 만들기·거래시퀀스·정렬/그룹·캔버스 | ⛔ **신규** |
| **Cue (사용법)** | `cue` | Cue란·업무 맡기기·채팅 자동응답·지식학습 | ⛔ **신규** |
| 설정·권한 | `settings` | 멤버권한·개인연동·메일계정·(플랜·백업) | ✅ 3 |

> 심화 항목(괄호)은 사용자 질문이 실제로 몰릴 때 KNOWLEDGE_LOOP(§3-d)가 초안을 자동 제안한다. **기본 1건은 개발 시 손으로 보장, 심화는 수요 기반 자동.**

---

## 2. 아티클 작성 표준 (개발자가 seed에 추가)

`dev-backend/seed-wiki-content.js` 에 코드로 추가. 헬퍼:
```js
const h = (ko,en) => ({ type:'heading', text_ko:ko, text_en:en });  // 소제목
const p = (ko,en) => ({ type:'text',    text_ko:ko, text_en:en });  // 문단
const s = (ko,en) => ({ type:'step',    text_ko:ko, text_en:en });  // 번호 단계
const note = (ko,en)=>({ type:'callout', text_ko:ko, text_en:en }); // 강조 팁
// image 블록은 admin 화면 캡처로만 (file_id) — seed 에 직접 X
```
아티클 필수 필드: `cat`(카테고리 slug), `slug`(고유, kebab), `visibility`('public' 랜딩노출 / 'authenticated' 로그인전용), `linked_route`(연결 화면 — 드로어 "이 화면에서" 맥락매칭 축, **정확한 SPA 경로**), `est`(분), `title:t()`, `summary:t()`, `body:[]`.

**규칙:**
1. **ko/en 둘 다** 필수 (i18n 원칙).
2. `linked_route` 는 실제 App.tsx 라우트와 대조 — 없는 경로 금지([[feedback_notify_link_must_match_route]] 계열).
3. 결과물 중심·단계형 서술(하지 말 것: 기능 나열. 할 것: "이걸 하려면 → 이렇게").
4. slug 는 영구 — 바꾸면 링크·검색 인덱스 깨짐. 내용만 갱신.
5. 멱등: 재실행 시 slug upsert(update). 안전하게 반복 실행 가능.

---

## 3. 지속 업데이트 메커니즘 (4축)

### (a) 개발 사이클 게이트 — `/개발완료` 의무 조항
**사용자 대면 기능을 추가/변경하면, 같은 커밋에 위키를 갱신한다.** `/개발완료` 스킬 문서매칭 테이블에 추가:

| 변경 성격 | 위키 조치 |
|-----------|-----------|
| 신규 메뉴/화면 | 카테고리(필요시) + 핵심 아티클 1건 seed 추가 |
| 기존 기능 UX/흐름 변경 | 해당 아티클 body 갱신 (slug 유지) |
| 신규 라우트(linked_route 대상) | 아티클 linked_route 연결·신설 |
| 버그픽스·내부 리팩터 | 위키 조치 불필요 |

체크: `/개발완료` 실행 시 `node dev-backend/scripts/wiki-coverage-check.js` 결과에 ⛔ 없어야 통과.

### (b) 커버리지 감사 스크립트 — `scripts/wiki-coverage-check.js`
§1 매트릭스를 코드로 검증. 메뉴 목록(PERMISSION_MATRIX 11메뉴 + cue/qproject/insights) 대비 카테고리·아티클 존재를 확인하고 **갭 목록 출력**. exit 1 시 게이트 실패.
```bash
node dev-backend/scripts/wiki-coverage-check.js   # 갭 있으면 ⛔ + exit 1
```

### (c) 배포 연동 — seed 를 멱등 배포
`seed-wiki-content.js` 는 slug upsert 멱등이므로 **배포 시 자동 실행 안전**. deploy 후 1회 실행으로 dev 에서 갱신한 위키가 운영에 반영된다.
- 운영 반영: `ssh …prod "cd /opt/planq/backend && node seed-wiki-content.js"` (setup-wiki-schema.js 는 스키마 변경 시에만).
- 향후 deploy-planq.sh 의 sync_database 다음 단계에 `seed-wiki-content.js` 추가 검토(옵션 — 콘텐츠가 코드에 있으므로 안전).

### (d) 수요 기반 자동 초안 (기존 KNOWLEDGE_LOOP)
개발 게이트(a)가 **공급측**(우리가 아는 기능)이라면, 질문 클러스터링은 **수요측**(사용자가 실제 막히는 곳):
- `services/wikiQuestionCluster.js` — 미답변·불만족 Q helper 질문을 임베딩 클러스터링(≥0.85 유사, ≥3건)해 초안 자동 생성(is_published=false, origin='auto_cluster'), 사람 승인 게이트. cron 05:00 KST(`server.js` initWikiQuestionCron).
- admin `/admin/wiki` "제안됨(suggested)" 카테고리에서 검토 → 발행.
- **개발 게이트로 못 채운 갭을 사용자 질문이 드러내면 여기서 보충.**

---

## 4. 운영 절차 요약

1. **기능 개발 중**: seed-wiki-content.js 에 아티클 추가/갱신 (§2 표준).
2. **/개발완료**: `wiki-coverage-check.js` 통과 확인(⛔ 0).
3. **dev 반영**: `node seed-wiki-content.js` → 위키 즉시 갱신(멱등).
4. **/배포 후**: 운영에서 `node seed-wiki-content.js` 1회 → 운영 위키 갱신.
5. **월 1회**: 질문 클러스터 "제안됨" 검토 → 발행(수요 갭 보충).

---

## 5. 이번 사이클 반영 (2026-07-06)

§1 갭 신규 카테고리·아티클을 seed 에 추가(첫 실행):
- `qcalendar`, `qmail`, `insights`, `qproject`, `cue`, `qinfo` 카테고리
- 최근 개발분 문서화: **내부/고객 프로젝트 구분**(insights), 프로젝트 정렬/그룹(qproject), 일정 시간칸 클릭·나만보기 공유(qcalendar), Cue 업무 맡기기(cue), 이미지 붙여넣기/확대(qtalk·qfile 갱신)
- `scripts/wiki-coverage-check.js` 신설 + `/개발완료` 게이트 추가

---

## 6. 랜딩 인사이트(/insights) 동기화 (2026-07-07)

**단일 소스 = Q위키.** 별도 CMS·블로그 DB 없음. 공개 마케팅 피드 `/insights`(옛 `/blog`, 301 리다이렉트 유지)는 `help_articles` 의 발행 서브셋을 그대로 노출한다 (`routes/blog.js`: `blog_published_at IS NOT NULL AND is_published AND visibility='public'`).

### 발행 방법 — `seed-wiki-content.js` 의 `BLOG_MAP`
- `BLOG_MAP = { slug: blog_category }` 한 곳에 매핑만 추가하면 seed 가 자동으로:
  1. `visibility='public'` 강제 (게스트 노출)
  2. `blog_category` 지정 (BlogPage 탭: `how-to`/`insights`/`cases`/`guide-video`/`brand-video`)
  3. `blog_published_at` 부여 — **멱등**(기존 발행일·관리자 수동 발행 보존, 없으면 `BLOG_BASE_TS` 기준 결정적 날짜 → 배포마다 동일, clock 비의존)
- ko/en 은 아티클 정의에 이미 양쪽 있으므로 인사이트도 **자동 이중언어**.
- 관리자 임시 발행/회수는 `/api/admin/wiki/articles/:id/blog` 토글로도 가능(seed 는 회수를 강제하지 않아 관리자 액션과 공존).

### 게이트 — `wiki-coverage-check.js` 확장
- `/insights` 발행 ≥ 6건 (public) 미만 → ⛔ exit 1
- 발행분 영어 누락(`title_en`/`summary_en`/`body_en`) 1건이라도 → ⛔ exit 1 (영어 서비스 필수)

### 개발마다 (§4 에 추가)
- 신규 how-to 성격 문서를 만들면 `BLOG_MAP` 에 등록 여부 판단 → 등록 시 인사이트에 자동 편입.
- `/개발완료` 시 coverage-check 통과(인사이트+이중언어 포함) → 배포 후 운영 `node seed-wiki-content.js` 1회.

**이번 반영:** how-to 11 + insights 3 = 14건 발행(공개), 전량 ko/en. `/blog`→`/insights` URL 이전(GNB·푸터·상세·admin 힌트·redirect).
