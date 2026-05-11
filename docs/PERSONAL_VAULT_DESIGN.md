# 개인 보관함 (Personal Vault) — 설계 문서

> **사이클 N+1 합의 (2026-05-08)** — Q note 음성/텍스트, 개인 파일·문서·지식·메모를 한 곳에서 관리하는 사적 공간.
>
> 핵심 원칙: **Single Source of Truth + Multiple Views** — 데이터는 한 곳, 보는 메뉴는 여러 곳.

---

## 1. 철학

| 패턴 | 사례 | PlanQ 적용 |
|---|---|---|
| Single Source / Multiple Views | Apple Photos "All Photos" + Albums | Q file ⊃ 개인 보관함의 파일들 |
| Personal Space | Notion "Private", Apple iCloud Drive | 개인 보관함 = L1 (개인) 자산 모음 |
| GTD/PARA | David Allen, Tiago Forte | Capture(개인) → Sort(정리) → Promote(공유) |

**Notion 의 단점:** Private space 와 Team space 분리 → 사용자가 매번 결정 → 전환 비용. PlanQ 는 visibility 자동 분류 + 양쪽 메뉴에서 자유로 접근.

---

## 2. 데이터 정의

| 메뉴 | filter |
|---|---|
| Q file (협업) | 본인 접근 가능 **모든** 파일 (L1+L2+L3+L4) |
| Q docs (협업) | 동일 (모든 visibility) |
| Q info (협업) | scope 별 (project/business 만 — private 제외) |
| **개인 보관함 → 파일/문서/지식** | `user_id = me AND visibility = 'L1'` (project_id NULL) |
| **개인 보관함 → 노트/메모** | `qnote_sessions WHERE user_id = me` (Q note 본질적 L1) |

**핵심:** 같은 row 가 양쪽에서 보임. 이동·복사 X.

---

## 3. 페이지 구조 — 프로젝트 페이지 재사용

```
🗄️ 개인 보관함
[대시보드] [노트] [문서] [파일] [지식] [메모]
```

- 컴포넌트 재사용 (`DocsTab`, `FilesTab`, `KnowledgeTab` 등) + `scope='personal'` prop
- 모든 list/upload 자동 L1 default
- 첫 진입 시 dismiss 가능 explainer (위 빈틈 #7 보강)

### 탭별 데이터

| 탭 | 데이터 |
|---|---|
| 대시보드 | 최근 작성, 미정리 메모, 노트 통계, 정리하기 권장 항목 |
| 노트 | qnote_sessions WHERE user_id = me AND input_type='voice' |
| 문서 | posts WHERE user_id = me AND project_id IS NULL AND visibility='L1' |
| 파일 | files WHERE uploader_id = me AND project_id IS NULL AND visibility='L1' |
| 지식 | kb_documents WHERE uploader_id = me AND scope='private' |
| 메모 | qnote_sessions WHERE user_id = me AND input_type='text' |

---

## 4. 업로드 진입점 — 어디서든 가능

| 위치 | 동작 |
|---|---|
| Q file/Q docs 메뉴에서 업로드 | **프로젝트 미선택** → 자동 L1 (개인 보관함에도 보임) |
| 개인 보관함에서 업로드 | 자동 L1 (편의 진입점) |
| 프로젝트 페이지 → 문서/파일 탭 | 자동 L2 (그 프로젝트 멤버만) |
| 채팅방 첨부 | 채팅 권한 (참여자만 — 별도 정책) |

업로드 위치와 무관하게 **visibility 만 row 에 저장**, 이후 어떤 메뉴에서든 visibility 기준으로 노출.

---

## 5. 공유 (Promote) — L1 → 다른 visibility

L1 자산을 명시적으로 공개로 promote 할 수 있어야 함:

| 액션 | 결과 |
|---|---|
| **카드 visibility 배지 클릭** | 공유 변경 모달 → 프로젝트 선택 (L2) / 워크스페이스 (L3) / 외부 share_token (L4) |
| **채팅방 보내기** | 메시지 첨부로 공유 (visibility 변경 X — 그 메시지 권한 사용) |
| **정리하기 (Q note 의 분기)** | 업무·문서·지식으로 promote (별도 row 생성) |

**중요:** L1 → L2 promote 시 **같은 row 의 visibility 만 변경** (project_id 추가 + visibility='L2'). 데이터 복제 X.

---

## 6. 시각 시그널

- 개인 보관함 메뉴 아이콘: **`archive` (보관함)** — 자물쇠 아님 (자물쇠는 Q note·visibility 배지에만)
- 페이지 헤더 sub-line: _"본인만 보는 사적 영역"_
- 첫 진입 1회 explainer: _"같은 파일이 Q file 메뉴에도 보이지만 권한 표시(자물쇠)로 구분됩니다."_
- 모든 카드에 visibility 배지 (4단계 vocabulary 적용)

---

## 7. 권한 매트릭스

| 액션 | 본인 | 다른 멤버 | owner | platform_admin |
|---|:-:|:-:|:-:|:-:|
| L1 자산 list | ✅ | ❌ | ❌ | ✅ (AuditLog 강제) |
| L1 자산 read | ✅ | ❌ | ❌ | ✅ |
| L1 자산 write/delete | ✅ | ❌ | ❌ | ❌ |
| L1 → L2/L3/L4 promote | ✅ | n/a | n/a | n/a |

**owner 도 본인 L1 외엔 안 보임** — 옵션 A 정책. 운영 디버깅 필요 시 platform_admin 권한 (AuditLog 강제 기록).

---

## 8. 작업 범위 (사이클 N+9 구현 — 2026-05-11)

| # | 작업 | 상태 |
|:-:|---|:-:|
| 1 | DB: `files.visibility` ENUM('L1','L2','L3','L4') 컬럼 추가 | ✅ 청크 1 |
| 2 | DB: `posts.vlevel` 신규 (기존 `visibility` 컬럼 'internal/public' 유지 — legacy 격리) | ✅ 청크 1 |
| 3 | DB: `kb_documents.scope` ENUM 에 'private' 추가 | ✅ 청크 1 |
| 4 | 마이그레이션: 기존 데이터 → L3 백필 (운영 files 5, posts 3) | ✅ 청크 1 |
| 5 | access_scope.js: visibility 기반 필터 (ByLevel 헬퍼 6종) | ✅ 청크 1 |
| 6 | 라우트 `/api/personal-vault/*` 신설 (summary, files, posts, kb-documents) | ✅ 청크 2 |
| 7 | 페이지 `pages/PersonalVault/PersonalVaultPage.tsx` 4 탭 (대시·문서·파일·지식) | ✅ 청크 2 |
| 8 | 사이드바 협업/개인 섹션 + 개인 보관함 NavItem | ✅ 청크 2 |
| 9 | 첫 사용 explainer (localStorage dismiss) | ✅ 청크 2 |
| 10 | 카드 visibility 배지 (컴포넌트) + 변경 모달 | ⚠️ 청크 4 (컴포넌트만, 카드/행 적용은 청크 5 잔여) |

### 보강 (사용자 보고로 추가)
- editor-image File 테이블 통합 — 본문 이미지가 Q file 메뉴에 노출 + share-link 가능 (commit `da8c80f`)
- 인박스 task_candidate link → `/tasks` 후보 섹션 + archive 제외 + 카드 강조 (commit `d3e7f0a`)

### 잔여 (청크 5, 다음 사이클)
- VisibilityBadge 카드/행 적용 (Q file `DocsTab`, Q docs `PostsPage` 의 카드)
- VisibilityChangeModal 진입점 연결 (배지 클릭)
- 노트·메모 탭 (qnote_sessions.input_type 분리 후 v1.1)

---

**상태:** 사이클 N+9 핵심 청크 1~4 완료, 청크 5 (시각 시그널) 다음 사이클로.
