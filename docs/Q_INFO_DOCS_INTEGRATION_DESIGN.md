# Q info / Q docs / Q record 통합 설계

**작성:** 2026-05-03
**범위:** 이번 사이클 — Q info 진화 + Q docs 표 kind 추가 + Q record/process 탭 흡수

---

## 1. 결정된 방향 (Irene 합의 완료)

### 1.1 Q docs (변경 0 — 페이지 레이아웃 절대 안 건드림)
- 좌측·검색·카테고리·리스트·우측 drawer 등 전부 그대로
- **단 1 가지**: 새 문서 모달의 "종류 선택" 에 **표 (table)** 옵션 추가
- 표 선택 → Q record 그리드 컴포넌트 임베드 (post.kind='table' + post.q_record_id 연결)

### 1.2 Q record 메뉴 폐지
- 사이드바 메뉴 제거
- 기존 q_records → post (kind='table') 자동 마이그레이션
- `/records` → `/docs` redirect

### 1.3 프로젝트 process 탭 제거
- ProjectDetailPage 의 process 탭 UI 만 제거
- 데이터 (project_process_parts) 는 **이미 q_records 로 마이그레이션됨** → post 흡수
- 프로젝트 페이지 docs 탭에 자동 표시 (kind='table' 인 post 도 포함)

### 1.4 Q knowledge → Q info
- 메뉴·페이지 라벨: Q knowledge → **Q info**
- 등록 모달 라벨: 새 지식 등록 → **정보 등록**
- **레이아웃**: 좌측 메뉴 + 상단 필터만 Q record/Q file 패턴 (좌측 220px 카테고리 트리). 나머지(리스트·우측 drawer·등록 모달 본체) 건드리지 않음
- **커스텀 항목** 추가 — 자료별 자유. 노션 갤러리 패턴 (고정 항목 좌/우 + 커스텀 가운데 자동 배치)
- **우측 DetailDrawer 편집 모드** — Q task 패턴 (권한 있으면 인라인 수정·자동저장)
- **권한 라디오** — 전체/프로젝트/고객(다중)/운영진만

---

## 2. 데이터 모델

### 2.1 Post (Q docs) 변경
```sql
ALTER TABLE posts
  ADD COLUMN kind ENUM('doc', 'table', 'brief', 'template') NOT NULL DEFAULT 'doc',
  ADD COLUMN q_record_id INT NULL REFERENCES q_records(id);
```
- `doc` — 기존 일반 문서 (Tiptap 본문, content_json 사용)
- `table` — 표 (q_record_id 연결, 본문 = QRecord 그리드)
- `brief` — AI 자료정리 (기존 brief_meta 사용)
- `template` — 템플릿 (기존)

### 2.2 KbDocument (Q info) 변경
```sql
ALTER TABLE kb_documents
  ADD COLUMN columns JSON NULL,         -- [{ id, name, type, show_in_list, options? }]
  ADD COLUMN values JSON NULL,          -- { col_id: value }
  ADD COLUMN read_policy ENUM('all', 'owner') NOT NULL DEFAULT 'all',
  ADD COLUMN client_ids JSON NULL;      -- [client_id1, client_id2, ...] (scope='client' 일 때 다중)
```
- `columns`: 자료별 자유 정의 (Q record 와 동일 패턴)
- `values`: 그 자료의 컬럼별 값
- `read_policy='owner'`: owner+admin 만 read (단가표·내부 계정 등)
- `client_ids`: scope='client' 일 때 1명 또는 여러 명 (기존 `client_id` 단수 컬럼은 유지, 둘 중 하나)

### 2.3 QRecord — 그대로 유지
- `kind='table'` 인 Post 의 본문으로 재사용
- 기존 q_records 8개 → 자동으로 post 1:1 생성
- 마이그레이션 후에도 q_records 모델 유지 (Post 와 belongsTo 관계)

---

## 3. 마이그레이션 (자동, 1회)

### 3.1 q_records → posts
```js
// scripts/migrate-qrecord-to-post.js
for (const rec of QRecord.findAll()) {
  if (await Post.findOne({ where: { q_record_id: rec.id } })) continue; // 이미 매핑됨
  await Post.create({
    business_id: rec.business_id,
    project_id: rec.project_id,
    title: rec.name,
    category: rec.category,
    kind: 'table',
    q_record_id: rec.id,
    author_id: rec.created_by,
    content_text: rec.description,  // 검색 인덱싱용
  });
}
```
- 안전: 이미 연결된 post 가 있으면 skip (재실행 가능)
- 원본 q_records / q_record_rows 손대지 않음

### 3.2 process_parts 흐름
- 이미 q_records 로 마이그레이션 완료 (이전 사이클)
- 위 q_records → posts 마이그레이션이 자동으로 흡수
- 결과: project_process_parts (16건) → q_records (8개) → posts (8개, kind='table')

---

## 4. UI 변경

### 4.1 Q docs (PostsPage) — 1 줄 변경
- `PostAiModal.tsx` — 두 탭 구조 그대로, **세 번째 탭 "표"** 추가
- 표 탭 선택 + 제목 입력 → 빈 q_record 자동 생성 → post (kind='table', q_record_id) 생성 → 새 페이지로 이동
- 상세 진입 시 `kind === 'table'` 이면 본문 영역에 **QRecordGrid** 컴포넌트 임베드 (현재 QRecordDetailPage 의 그리드 부분 분리해서 재사용)

### 4.2 ProjectPostsTab — 영향 없음
- 기존 코드가 PostsPage 와 같은 컴포넌트 사용 중
- kind='table' 자동 표시
- 프로젝트 멤버는 그 프로젝트의 표 문서 보고 편집 가능

### 4.3 사이드바 메뉴 (MainLayout)
- "Q record" 메뉴 제거
- "Q knowledge" → "Q info"

### 4.4 라우트
- `/records` → `/docs` 리다이렉트
- `/records/:id` → `/docs/:postId` 리다이렉트 (post 의 q_record_id = :id 인 post 찾아 redirect)

### 4.5 ProjectDetailPage
- "process" 탭 제거 (탭 배열에서)
- ProjectProcessColumn / ProjectProcessPart 모델 자체는 보존 (롤백용)

### 4.6 KnowledgePage (Q info)
- 가로 Tabs (카테고리) → **좌측 TreePanel**
- Toolbar 영역 통일 (검색·필터·CSV·정보 등록 버튼)
- 리스트 Row 구조:
  - 좌: 제목 · 카테고리 chip
  - 가운데: 커스텀 항목 자동 배치 (`라벨: 값 · 라벨: 값`)
  - 우: 수정일
- Row 클릭 → 우측 DetailDrawer 열기 (편집 모드)
- 셀 영역 인라인 클릭 → 그 자리에서 수정 (권한 있을 때)

### 4.7 정보 등록·편집 모달 (KnowledgePage 내부)
- 라벨: "새 지식 등록" → "정보 등록"
- **항목 추가 영역**:
  - "+ 항목 추가" 버튼 → 인라인 입력 (이름 + 타입 + 표시여부 토글)
  - 타입: text / longtext / number / date / url / select / **secret** / checkbox
  - 항목 추가 후 그 자리에서 값 입력
- **공유 권한 라디오** (현재 scope 셀렉트 → 라디오 4 옵션):
  - 전체 워크스페이스
  - 특정 프로젝트 (선택)
  - 특정 고객 (다중 선택 — client_ids)
  - 운영진만 (owner + admin)
- 라디오 옆 "이 자료는 N명이 볼 수 있어요" 표시

### 4.8 DetailDrawer (Q info)
- 현재: read-only 표시
- 변경: **편집 모드 추가** (권한 있을 때만)
  - 제목 인라인 편집
  - 본문 인라인 편집
  - 커스텀 항목 인라인 편집·추가·삭제
  - secret 항목 마스킹 + reveal 버튼 (Q record 동일)
  - 자동저장 (onBlur PUT)

### 4.9 우측 패널 열기 (Q task 패턴)
- Row 클릭 → 우측 DetailDrawer 자동 열림
- 셀 인라인 영역 클릭 → 그 자리 수정 (drawer 안 열림)
- 우측 영역 토글 버튼 (⌘/, Ctrl+\) — Q task 와 동일

---

## 5. 검색 통합

### 5.1 글로벌 검색 (`/api/search`)
- post 검색 시 `kind='table'` 인 post 는 연결된 q_record_rows.values JSON 도 LIKE 매치
- KbDocument 검색 시 `values` JSON 도 LIKE 매치
- 결과 chip 에 `[표]` 또는 `[정보]` 표시
- 매칭된 셀 정보 (어느 row 의 어느 col 인지) 결과 sub 에 노출

### 5.2 SQL (MySQL JSON LIKE)
```sql
-- 표 셀 검색
SELECT p.* FROM posts p
JOIN q_record_rows r ON r.q_record_id = p.q_record_id
WHERE p.kind = 'table'
  AND p.business_id = ?
  AND JSON_SEARCH(LOWER(r.values), 'one', LOWER(?)) IS NOT NULL;

-- KbDocument 커스텀 값
SELECT * FROM kb_documents
WHERE business_id = ?
  AND (
    title LIKE ? OR body LIKE ? OR
    JSON_SEARCH(LOWER(values), 'one', LOWER(?)) IS NOT NULL
  );
```

### 5.3 권한
- 글로벌 검색 — getUserScope + listWhere 헬퍼 (이미 적용됨)
- KbDocument 검색 — `read_policy='owner'` 면 owner+admin 만, `client_ids` 가 있으면 그 client 또는 owner/member 만

---

## 6. 권한 매트릭스

### 6.1 Post (kind='table' 포함)
| 행위 | platform_admin | owner | member | client |
|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | 자기 client 자료만 |
| create | ✓ | ✓ | ✓ | ✗ |
| update (셀/제목) | ✓ | ✓ | author 본인 | ✗ |
| delete | ✓ | ✓ | author 본인 | ✗ |

### 6.2 KbDocument (Q info)
- 위 + read_policy / client_ids / scope 조합:
| 자료 설정 | 누가 read 가능 |
|---|---|
| scope='workspace' + read_policy='all' | owner + member (client 제외 — PERMISSION_MATRIX §7) |
| scope='workspace' + read_policy='owner' | owner + platform_admin 만 |
| scope='project' | 그 프로젝트 멤버 |
| scope='client' + client_ids=[N] | 그 N명의 client + owner + member |

### 6.3 secret 항목 reveal
- read 권한 있는 자만 reveal 가능
- 모든 reveal 은 audit_logs 에 기록

---

## 7. 작업 분할 + 순서

| # | 단계 | 파일/엔티티 | 검증 |
|---|---|---|---|
| 1 | DB 변경 + 마이그레이션 | posts.kind/q_record_id, kb_documents.columns/values/read_policy/client_ids, scripts/migrate-qrecord-to-post.js | sync-database 동작 + 마이그레이션 실행 |
| 2 | 백엔드 — Post 라우트에 kind 처리 + table 본문 응답 (q_record 포함) | routes/posts.js | API 호출로 kind='table' post 생성·조회 |
| 3 | 백엔드 — 검색 확장 (q_record_rows + kb_documents.values JSON_SEARCH) | routes/search.js | 검색 결과에 셀 매치 확인 |
| 4 | 프론트 — Q record 그리드 컴포넌트 추출 (재사용) | components/Records/RecordGrid.tsx | QRecordDetailPage + 새 위치 둘 다 동작 |
| 5 | 프론트 — Q docs 새 문서 모달에 "표" kind 옵션 + 그리드 임베드 | PostAiModal, PostDetailPage | /docs 에서 표 문서 생성 |
| 6 | 프론트 — Q record 메뉴 제거 + /records redirect | MainLayout, App.tsx | 사이드바 확인 |
| 7 | 프론트 — 프로젝트 process 탭 제거 | QProjectDetailPage, ProcessPartsTab(보존) | 프로젝트 페이지 탭 |
| 8 | 프론트 — Q knowledge → Q info 이름 변경 (라벨·페이지 제목·i18n) | layout.json, KnowledgePage, MainLayout | 메뉴 라벨 |
| 9 | 프론트 — KnowledgePage 좌측 트리 + Toolbar 통일 (Q record 패턴) | KnowledgePage | 좌측 카테고리 트리 동작 |
| 10 | 프론트 — 정보 등록 모달에 "항목 추가" UI + 권한 라디오 (4옵션) | KnowledgePage 내 Modal | 동적 항목 추가/편집 |
| 11 | 프론트 — DetailDrawer 편집 모드 (Q task 패턴) + 인라인 수정 + secret reveal | KnowledgePage Drawer | 우측 패널 편집 |
| 12 | 프론트 — 리스트 Row 에 커스텀 항목 자동 배치 + 표시여부 토글 반영 | KnowledgePage Row | 행 표시 |
| 13 | 검색 검증 — 글로벌 검색 + KnowledgePage 검색에서 셀·커스텀 값 매치 | API + UI | 끝까지 검색 |
| 14 | 9단계 검증 + 운영 배포 준비 | 전체 | 헬스체크·페이지·API·UI |

총 14 단계. 한 응답에 모두 다 못 끝나니 단계별로 진행하며 보고.

---

## 8. 안전 원칙 (30년차 관점)

- **DB 변경**: ALTER 만 추가. 컬럼 삭제 X (롤백 가능)
- **마이그레이션**: 멱등 (재실행 가능). 원본 데이터 보존
- **모델 보존**: ProjectProcessColumn, ProjectProcessPart 모델은 그대로 (탭만 제거)
- **API 호환**: 기존 /api/records 라우트는 유지 (/docs/:id 가 q_record 를 본문으로 가짐, 둘 다 동작 가능)
- **권한**: 기존 PERMISSION_MATRIX §7 (client 격리) 유지. 새 read_policy 추가만
- **검증**: 단계별 빌드 + API + 헬스체크 + 페이지 응답
- **롤백 경로**: 운영 배포 시 backup 1세트 자동, 문제 시 PM2 reload + 이전 backend 복원

---

## 9. 기존 사용처 영향 검사

| 컴포넌트 | 변경 전 | 변경 후 |
|---|---|---|
| PostsPage (Q docs) | post 만 표시 | post (모든 kind) 표시. 그리드는 detail 안에서 |
| ProjectPostsTab | 같음 | 같음 (자동으로 kind='table' 포함) |
| QFilePage (Q file) | 같음 | 영향 없음 |
| KnowledgePage (Q info) | 가로 Tabs | 좌측 트리 + 항목 추가 + 권한 라디오 + 편집 drawer |
| QProjectDetailPage | process 탭 | process 탭 제거 |
| Q record 메뉴 | 있음 | 제거 |
| GlobalSearchModal | 검색 결과 | 표 셀·커스텀 값까지 매치 |

---

## 10. 검증 체크리스트

- [ ] 헬스체크 27/27
- [ ] 빌드 타입 에러 0
- [ ] DB 마이그레이션 — q_records → posts 자동 적용
- [ ] /docs 에서 표 문서 생성·조회·수정·검색
- [ ] /docs 의 일반 문서·brief·표 모두 한 리스트
- [ ] /projects/p/:id?tab=docs 에서 표 문서 보임
- [ ] /records → /docs redirect
- [ ] /records/:id → /docs/:postId redirect
- [ ] /knowledge URL 도 그대로 동작 (이름만 Q info)
- [ ] Q info 좌측 트리 + 항목 추가 + 권한 라디오 + 편집 drawer 동작
- [ ] 글로벌 검색에서 표 셀·커스텀 값 매치
- [ ] secret 마스킹·reveal·감사로그 동작
- [ ] 권한 — client 가 못 보는 자료 차단
- [ ] 모든 페이지 i18n 0 하드코딩
