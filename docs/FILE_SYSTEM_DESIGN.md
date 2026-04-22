# PlanQ 파일 시스템 설계 (최종안 2026-04-21)

## 0. 원칙

1. **하나의 허브, 여러 출처** — 직접 업로드 + Q Talk 첨부 + Q Task 첨부 + Q Note 자료를 프로젝트별 + 워크스페이스 전역 두 scope 로 집계한다.
2. **저장소는 교체 가능** — 자체 스토리지 / Google Drive 중 고객이 선택. UI 는 동일.
3. **PlanQ 는 유일 진입점** — 외부 클라우드를 쓰더라도 사용자는 PlanQ 안에서만 조작. 외부 앱 직접 열 필요 없음.
4. **편의성 우선** — 리스트·검색·필터·정렬은 PlanQ DB 인덱스로 처리 (외부 API 호출 최소화).
5. **운영비용 자동 조절** — 가입자·용량 임계치 도달 시 알림 → 단계적 인프라 도입.

---

## 1. 컴포넌트 아키텍처

### 1.1 범위 (scope)

| Scope | 경로 | 집계 범위 |
|---|---|---|
| `project` | `/projects/p/:id?tab=docs` | 해당 프로젝트의 모든 파일 |
| `workspace` | `/docs` (Q Docs 신규) | 워크스페이스(business) 전체 파일 |

동일한 `<DocsTab scope={...} />` 컴포넌트 재사용.

### 1.2 파일 출처 (source)

| source | 수집 경로 | PlanQ 에서 조작 |
|---|---|---|
| `direct` | 문서 탭에서 직접 업로드 | 업로드/삭제/이동/이름 변경 |
| `chat` | Q Talk 메시지 첨부 | 읽기만 (삭제는 원 메시지에서) |
| `task` | Q Task 업무 첨부 | 읽기만 (삭제는 원 업무에서) |
| `meeting` | Q Note 회의 자료 | 읽기만 (삭제는 원 회의에서) |

### 1.3 폴더 시스템

- **시스템 폴더 (자동)** — `/채팅`, `/업무`, `/회의` → 각 출처에서 자동 수집. 사용자 편집 불가
- **사용자 폴더 (커스텀)** — `/직접 업로드` 하위에만 생성 가능. 무한 중첩. 드래그앤드롭 이동
- 외부 연동 시에도 동일 구조가 외부 클라우드 루트 폴더 내에 그대로 반영

---

## 2. 데이터 모델

### 2.1 `files` 테이블 확장

```sql
ALTER TABLE files ADD COLUMN project_id INT NULL
  REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE files ADD COLUMN folder_id INT NULL
  REFERENCES file_folders(id) ON DELETE SET NULL;
ALTER TABLE files ADD COLUMN storage_provider ENUM('planq','gdrive') NOT NULL DEFAULT 'planq';
ALTER TABLE files ADD COLUMN external_id VARCHAR(255) NULL;           -- Drive file id
ALTER TABLE files ADD COLUMN external_url VARCHAR(500) NULL;          -- 다운로드 URL
ALTER TABLE files ADD COLUMN content_hash CHAR(64) NULL;              -- SHA-256 dedup
ALTER TABLE files ADD COLUMN ref_count INT NOT NULL DEFAULT 1;        -- 중복 참조 카운트
ALTER TABLE files ADD COLUMN deleted_at TIMESTAMP NULL;               -- 휴지통(soft delete)
ALTER TABLE files ADD INDEX idx_files_biz_project (business_id, project_id);
ALTER TABLE files ADD INDEX idx_files_content_hash (business_id, content_hash);
ALTER TABLE files ADD INDEX idx_files_deleted_at (deleted_at);
```

### 2.2 `file_folders` 테이블 (신규)

```sql
CREATE TABLE file_folders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  project_id INT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id INT NULL REFERENCES file_folders(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_folders_project (business_id, project_id, parent_id)
);
```

`project_id NULL` = 워크스페이스 전역 폴더.

### 2.3 `business_storage_usage` 테이블 (신규, 쿼터용)

```sql
CREATE TABLE business_storage_usage (
  business_id INT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  bytes_used BIGINT NOT NULL DEFAULT 0,
  file_count INT NOT NULL DEFAULT 0,
  storage_provider ENUM('planq','gdrive') NOT NULL DEFAULT 'planq',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### 2.4 `business_cloud_tokens` 테이블 (신규, OAuth)

```sql
CREATE TABLE business_cloud_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider ENUM('gdrive') NOT NULL,
  access_token TEXT NOT NULL,        -- 암호화
  refresh_token TEXT NULL,           -- 암호화
  expires_at TIMESTAMP NULL,
  root_folder_id VARCHAR(255) NOT NULL,   -- PlanQ 루트 폴더 external id
  connected_by INT NOT NULL REFERENCES users(id),
  connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, provider)
);
```

---

## 3. 플랜별 쿼터 (운영서버 기준)

| 플랜 | 파일당 최대 | 총 스토리지 | 외부 클라우드 |
|---|---|---|---|
| **Free** | 10 MB | 1 GB | 필수 권장 |
| **Basic** | 30 MB | 50 GB | 선택 |
| **Pro** | 50 MB | 500 GB | 선택 |
| **외부 연동 (모든 플랜)** | 50 MB | 외부 한도 | — |

**처리:**
- 업로드 전 `business_storage_usage.bytes_used + file.size ≤ plan.quota` 검사
- 초과 시 `413 Payload Too Large` + 한글 안내 "용량 초과. 플랜 업그레이드 또는 Google Drive 연동 필요"
- 휴지통 파일은 쿼터에 포함 (30일 후 영구 삭제되면 반환)

---

## 4. SHA-256 중복 해싱 (dedup)

**목표:** 팀 공유 파일(같은 PDF 여러 프로젝트 첨부) 1번만 저장

**플로우:**
1. 업로드 시 프론트/서버에서 SHA-256 계산
2. `WHERE business_id = ? AND content_hash = ?` 로 기존 파일 조회
3. 있으면 → `files.ref_count++` + 새 레코드에 같은 `file_path` 연결, 물리 업로드 생략
4. 없으면 → 정상 업로드
5. 삭제 시 `ref_count--` → 0 이 되면 물리 파일 삭제

**주의:** 외부 클라우드(Drive) 연동 시 dedup 비활성 (외부는 각자 정책)

---

## 5. Google Drive 연동

### 5.1 권한 (최소)

| 플랫폼 | Scope | 효과 |
|---|---|---|
| Google Drive | `drive.file` | **앱이 만든 파일/폴더만** 접근 |

사용자는 "PlanQ가 내 전체 Drive 보는 거 아닌가?" 걱정 없음.

### 5.2 폴더 구조 (외부 클라우드 내부)

```
📁 PlanQ - {워크스페이스명}/  (Drive 는 PlanQ 가 생성)
  📁 {워크스페이스명}/
    📁 {프로젝트명}/
      📁 직접 업로드/
        📁 {사용자 폴더}/
      📁 (채팅·업무·회의 파일은 원천에 보관, PlanQ 에서만 집계)
```

DB 매핑:
- `business_cloud_tokens.root_folder_id` = `/Apps/PlanQ/` 의 external id
- `file_folders.external_id` = 외부 폴더 external id (연동 시에만)

### 5.3 업로드 플로우 (Direct upload)

1. 사용자 드롭존에 파일 드롭
2. PlanQ 프론트가 백엔드에 OAuth 토큰 + 업로드 대상 폴더 id 요청 (`POST /api/cloud/upload-target`)
3. 프론트가 **직접 Drive API 에 PUT** (서버 경유 안 함 — 대역폭 절약)
4. 업로드 성공 후 external id 를 PlanQ 백엔드에 기록 (`POST /api/files` with storage_provider)
5. PlanQ DB 에 메타데이터(name, size, uploader, external_id) 저장 → 이후 리스트·검색 DB 로

### 5.4 변경 감지 (Webhook)

- Google Drive: `files.watch` API → 파일 삭제/이동/이름 변경 시 PlanQ 엔드포인트 호출 → DB 동기화
- 사용자가 외부 앱에서 실수로 삭제하면 PlanQ 에 "외부에서 삭제됨" 표시 + 관리자가 복구 가능

### 5.5 제한 (솔직한 한계)

| 한계 | 영향 | 대응 |
|---|---|---|
| 무료 계정 Google 15GB | 개인 계정은 금방 차임 | 팀은 Workspace 공유 드라이브 권장 |
| API 호출 한도 (10 req/s) | 소규모 OK | 대량 업로드는 batch + 큐 |
| OAuth 토큰 만료 | refresh token 으로 자동 갱신 | 재인증 UI 준비 |
| 사용자 수동 추가 파일 | PlanQ 는 인덱싱 안 함 | 의도된 설계 — PlanQ 유일 진입점 |

---

## 6. API 설계 (Phase 2A+2B)

### 6.1 자체 스토리지 (Phase 2A)

```
GET    /api/projects/:id/files              프로젝트 파일 집계 (source 필터 지원)
GET    /api/businesses/:bizId/files         워크스페이스 전체 파일 (Q Docs 용)
POST   /api/files/:bizId                    업로드 (project_id, folder_id optional)
DELETE /api/files/:bizId/:id                소프트 삭제 (휴지통)
POST   /api/files/:bizId/bulk-delete        대량 삭제 body: {file_ids:[]}
POST   /api/files/:bizId/:id/move           폴더 이동 body: {folder_id}
GET    /api/files/:bizId/:id/download       다운로드

GET    /api/projects/:id/folders            폴더 트리
POST   /api/projects/:id/folders            폴더 생성 body: {name, parent_id}
PUT    /api/folders/:id                     이름 변경 body: {name}
DELETE /api/folders/:id                     삭제 (재귀)

GET    /api/businesses/:bizId/storage       쿼터 상태 (used / quota / plan)
```

### 6.2 외부 클라우드 (Phase 2B/2C)

```
GET    /api/cloud/providers                  사용 가능한 provider 목록
POST   /api/cloud/connect/:provider          OAuth 시작 (redirect URL 반환)
GET    /api/cloud/callback/:provider         OAuth 콜백
DELETE /api/cloud/disconnect/:provider       연동 해제
POST   /api/cloud/upload-target              업로드용 토큰+폴더 id 반환 (Direct upload)
POST   /api/cloud/webhook/:provider          외부 변경 수신
```

---

## 7. UI 규칙

### 7.1 DocsTab 컴포넌트 구조

```
┌─ DocsTab ─────────────────────────────────────────┐
│ [Upload Dropzone]                                  │
│                                                    │
│ [출처 칩] [검색] [정렬] [선택 모드] [그리드/리스트] │
│                                                    │
│ ┌─ 폴더 트리 ─┬─ 파일 영역 ───────────────────┐   │
│ │ 📁 전체     │ [선택됨 N개 → 다운로드/이동/삭제] │   │
│ │ 📁 직접업로드│                                │   │
│ │  📁 계약서  │ 파일 카드 / 리스트 행            │   │
│ │ 📁 채팅    │                                │   │
│ │ 📁 업무    │                                │   │
│ │ 📁 회의    │                                │   │
│ └────────────┴────────────────────────────────┘   │
└────────────────────────────────────────────────────┘
```

### 7.2 대량 선택

- 툴바 "선택" 토글 → 체크박스 모드 진입
- 상단 플로팅 액션바 (sticky)
- Ctrl/Cmd+클릭 으로 추가 선택, Shift+클릭 으로 범위 선택
- 삭제 시 `direct` 파일만 가능

### 7.3 외부 연동 UI

- 설정 > "파일 저장소" 섹션
- "Google Drive 연동" / "PlanQ 자체" 선택
- 연동 상태 표시 (계정 이메일, 사용량)
- 해제 시 경고 모달 (외부 파일은 그대로 남음)

---

## 8. 검증 계획

### 자체 스토리지 (Phase 2A)
1. `sync-database.js` — 컬럼 추가 확인
2. 업로드 → DB 기록 → 물리 파일 존재 → 다운로드 파일명/크기 일치
3. 같은 파일 2번 업로드 → `ref_count=2`, 물리 파일 1개만
4. 쿼터 초과 → 413 응답 + UI 안내
5. 휴지통 → 30일 만료 → 영구 삭제 cron
6. 멀티테넌트 격리 — 다른 biz 접근 차단
7. 폴더 CRUD + 재귀 삭제
8. 대량 삭제 — 10개 이상 선택 → 1회 호출

### 외부 연동 (Phase 2B)
1. OAuth 동의 → 토큰 저장 → 루트 폴더 자동 생성 확인
2. 프로젝트 만들기 → Drive 폴더 자동 생성 확인
3. Direct upload → Drive 파일 존재 확인
4. Webhook 수동 트리거 → PlanQ DB 동기화 확인
5. 연동 해제 → 외부 파일 유지 / DB 에서만 제거

---

## 9. 롤아웃 순서

| Phase | 내용 | 예상 |
|---|---|---|
| Phase 1 (완료) | UI Mock 기본 | 0.5일 |
| Phase 1+ | UI Mock 보강 (대량·폴더) | 0.5일 |
| **Phase 2A** | 자체 스토리지 + 쿼터 + dedup + 폴더 + bulk | 2일 |
| Phase 2B | Google Drive 연동 | 4일 |
| Phase 4 | Q Docs 전역 페이지 | 1일 |

**OAuth 선결:** Phase 2B 시작 전 Irene 이 Google Cloud Console 에서 앱 등록 (15분).

---

## 10. 관련 문서

- `docs/OPS_ROADMAP.md` — 가입자·용량 임계치별 인프라 도입 타이밍
- `docs/QPROJECT_AUDIT.md` — Q Project 기능 감사 (문서 탭 미구현 원래 항목)
