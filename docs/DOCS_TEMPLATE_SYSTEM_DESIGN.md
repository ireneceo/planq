# PlanQ 문서·템플릿 통합 시스템 설계

> 작성: 2026-04-25 · 상태: 설계 (구현 대기)
> 결정: **옵션 B — Q Docs 별도 메뉴 + Q bill / Q Talk / 프로젝트와 양방향 임베드**
> 관련: `Q_BILL_SPEC.md` · `FILE_SYSTEM_DESIGN.md` · `INTEGRATED_ARCHITECTURE.md` · `FEATURE_SPECIFICATION.md`

---

## 0. 한 줄 요약

PlanQ 의 모든 정형/반정형 **문서**(견적서·청구서·계약서·제안서·SOW·NDA·회의록·SOP) 를 **단일 시스템**(Q Docs)에서 작성·템플릿화·공유. 각 도메인 메뉴(Q bill·Q Talk·프로젝트)는 자기 워크플로우에 맞는 문서 인스턴스를 임베드 형태로 다룸.

---

## 1. 비전 / 원칙

### 1.1 비전
- 같은 **고객·프로젝트·과거 데이터** 가 모든 문서에 자동 흘러들어가는 단일 진실
- **AI(Cue) 가 한 번에 초안 작성** — 사용자는 검토·수정만
- **에디터 + 폼 + 하이브리드** 모드 — 문서 종류에 맞는 입력 UX
- **공유는 한 종류만** — 워크스페이스 멤버 / 고객 (share_token) / 공개

### 1.2 원칙
1. **데이터는 한 곳, UI 는 컨텍스트별** — Quote/Invoice 데이터 모델은 그대로, 편집 UI 만 Q Docs 가 제공
2. **AI 는 옵션이지 강제가 아님** — 빈 문서·템플릿 시작·AI 시작 3가지 항상 가능
3. **고객은 로그인 없이도 열람·서명** (share_token), 워크스페이스 멤버는 풀 권한
4. **문서는 첨부가 아니라 1급 엔티티** — 검색·태깅·이력·권한 모두 1급
5. **포맷 록인 안 됨** — PDF·DOCX·Markdown export 항상 가능

---

## 2. 정보 구조 (IA)

### 2.1 좌측 메뉴 변경
```
기능
  Q Talk · Q Task · Q Note · Q Calendar
  Q docs ◀ (확장)  · Q file · Q bill
```

### 2.2 Q Docs 내부 구조
```
Q Docs (좌측 패널)
├ 📄 최근 문서 (전체)
├ 📁 폴더 (사용자 정의)
├ 📋 템플릿 라이브러리
│   ├ 시스템 — 견적서·청구서·세금계산서 (PlanQ 기본)
│   ├ 워크스페이스 — 사용자 정의 (계약서·NDA·제안서·SOW)
│   ├ + 새 템플릿
├ 🔍 종류별
│   ├ 견적서 (Q bill 와 sync)
│   ├ 청구서 (Q bill 와 sync)
│   ├ 계약서·NDA
│   ├ 제안서·SOW
│   ├ 회의록 (Q Note 와 sync)
│   └ SOP·운영 문서
├ 👥 고객별 / 프로젝트별 (필터)
└ ⭐ 즐겨찾기
```

### 2.3 다른 메뉴와의 관계 (양방향)
| 메뉴 | Q Docs 와의 관계 |
|---|---|
| **Q bill** | 견적서·청구서 인스턴스를 **결제 관점**(상태·금액·세금)으로 표시. 행 클릭 → Q Docs 편집기 (오버레이/풀페이지) |
| **Q Talk** | 채팅에서 `/문서` → 최근 문서 첨부 link (share_token) · `/cue 견적서 만들어줘` → AI 생성 → Q Docs 임베드 미리보기 |
| **Q Note** | 회의 종료 → "회의록 문서로 변환" → Q Docs 회의록 템플릿 인스턴스 (자동 화자·타임라인·결정사항) |
| **프로젝트 상세** | 기존 "문서 탭" 을 Q Docs 의 프로젝트 필터된 뷰로 교체. 신규 문서 시 템플릿 선택 모달 |
| **Q Task** | 업무 상세 결과물(`body`) 를 Q Docs 문서로 격상 가능. 업무 → 문서 링크 |

---

## 3. 데이터 모델

### 3.1 신규 테이블

```sql
-- 템플릿 (워크스페이스 라이브러리 + 시스템 기본)
CREATE TABLE document_templates (
  id BIGINT PK AUTO_INCREMENT,
  business_id INT NULL,                  -- NULL = 시스템 템플릿 (PlanQ 기본 제공)
  kind ENUM('quote','invoice','tax_invoice','contract','nda',
            'proposal','sow','meeting_note','sop','custom') NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  mode ENUM('form','editor','hybrid') NOT NULL,
  -- form 모드: 필드 정의 (label, type, required, validation, default_expression)
  schema_json JSON NULL,
  -- editor 모드: 본문 템플릿 (Markdown / HTML / TipTap JSON)
  body_template TEXT NULL,
  -- 변수 정의 — Cue 가 자동 채울 변수 ({{client.name}}, {{project.contract_amount}})
  variables_json JSON NULL,
  -- AI 생성용 시스템 프롬프트 (kind 별 기본값 + 사용자 커스텀)
  ai_prompt_template TEXT NULL,
  visibility ENUM('workspace_only','client_shareable') DEFAULT 'workspace_only',
  locale ENUM('ko','en','bilingual') DEFAULT 'ko',
  is_system TINYINT(1) DEFAULT 0,        -- PlanQ 기본 제공 여부
  is_active TINYINT(1) DEFAULT 1,
  preview_image VARCHAR(500),            -- 라이브러리 카드 썸네일
  usage_count INT DEFAULT 0,             -- 인기도 표시
  created_by INT,
  created_at DATETIME, updated_at DATETIME,
  INDEX(business_id, kind), INDEX(is_system)
);

-- 문서 인스턴스 (실제 작성된 문서)
CREATE TABLE documents (
  id BIGINT PK AUTO_INCREMENT,
  business_id INT NOT NULL,
  template_id BIGINT NULL,               -- 어느 템플릿 기반 (NULL = 빈 문서)
  kind ENUM(...) NOT NULL,                -- template kind 와 동일하지만 인스턴스 분기
  title VARCHAR(300) NOT NULL,
  status ENUM('draft','sent','viewed','accepted','rejected','signed','archived')
         DEFAULT 'draft',
  -- form 모드 데이터 (key-value)
  form_data JSON NULL,
  -- editor 모드 본문 (TipTap JSON / HTML)
  body_json JSON NULL,
  body_html TEXT NULL,
  -- 자동 변환된 PDF
  pdf_url VARCHAR(500),
  pdf_generated_at DATETIME,
  -- 연결 (선택적)
  client_id INT NULL,
  project_id BIGINT NULL,
  conversation_id INT NULL,              -- Q Talk 채팅에서 생성된 경우
  session_id BIGINT NULL,                -- Q Note 세션에서 변환된 경우
  task_id BIGINT NULL,                   -- 업무 결과물에서 격상된 경우
  -- 도메인 sync (Q bill 양방향)
  quote_id BIGINT NULL,                  -- documents ↔ quotes 1:1
  invoice_id BIGINT NULL,                -- documents ↔ invoices 1:1
  -- 공유
  share_token VARCHAR(64) UNIQUE,
  shared_at DATETIME, viewed_at DATETIME,
  signed_at DATETIME, signature_data JSON,
  -- AI 추적
  ai_generated TINYINT(1) DEFAULT 0,
  ai_model VARCHAR(50),                  -- gpt-4o-mini / claude-haiku
  ai_prompt TEXT,                        -- 사용자 1줄 요구
  -- 메타
  created_by INT NOT NULL,
  updated_by INT,
  created_at DATETIME, updated_at DATETIME,
  archived_at DATETIME NULL,
  INDEX(business_id, kind, status),
  INDEX(client_id), INDEX(project_id),
  INDEX(quote_id), INDEX(invoice_id),
  INDEX(share_token)
);

-- 문서 변경 이력
CREATE TABLE document_revisions (
  id BIGINT PK AUTO_INCREMENT,
  document_id BIGINT NOT NULL,
  revision_number INT NOT NULL,
  body_snapshot JSON,                    -- 변경 전 스냅샷
  changed_fields JSON,                   -- 변경된 필드만 (diff)
  changed_by INT,
  change_note VARCHAR(500),
  created_at DATETIME,
  INDEX(document_id, revision_number)
);

-- 문서 공유 / 발송 로그
CREATE TABLE document_shares (
  id BIGINT PK AUTO_INCREMENT,
  document_id BIGINT NOT NULL,
  share_method ENUM('link','email','qtalk') NOT NULL,
  recipient_email VARCHAR(200),
  recipient_name VARCHAR(100),
  share_token VARCHAR(64),               -- 한 문서가 여러 사람에게 다른 토큰으로 발송될 수 있음
  expires_at DATETIME,
  viewed_at DATETIME,
  viewed_count INT DEFAULT 0,
  signed_at DATETIME,
  shared_by INT,
  created_at DATETIME,
  INDEX(document_id), INDEX(share_token)
);
```

### 3.2 기존 테이블과의 sync
- `quotes.id ↔ documents.quote_id` 1:1 (견적서 도메인 데이터 + 문서 표현)
- `invoices.id ↔ documents.invoice_id` 1:1
- 신규 견적서 생성 시 `quotes` + `documents` 동시 생성 (트랜잭션)
- form_data 변경 → quotes 필드 자동 sync (ORM hook)

---

## 4. 작성 모드 3종

### 4.1 폼 모드 (Form)
- **대상**: 견적서·청구서·세금계산서·NDA — 정형 / 자동 계산 필요
- **렌더**: `schema_json` 정의에 따라 자동 폼 (LineItem 배열·합계·부가세 등)
- **저장**: `form_data` JSON
- **장점**: 자동 계산, 검증, PDF 일관성
- **예시 schema**:
```json
{
  "fields": [
    {"key": "client_id", "type": "client_picker", "required": true},
    {"key": "issued_at", "type": "date", "default": "today"},
    {"key": "valid_until", "type": "date", "default": "+30d"},
    {"key": "items", "type": "line_items", "schema": {
      "description": "string", "quantity": "number",
      "unit_price": "number", "subtotal": "computed"
    }, "required": true},
    {"key": "vat_rate", "type": "percent", "default": 0.10},
    {"key": "payment_terms", "type": "textarea"},
    {"key": "notes", "type": "textarea"}
  ],
  "totals": {
    "subtotal": "sum(items.subtotal)",
    "vat": "subtotal * vat_rate",
    "total": "subtotal + vat"
  }
}
```

### 4.2 에디터 모드 (Editor)
- **대상**: 제안서·계약서·SOW·회의록·SOP — 자유 작성
- **엔진**: **TipTap** (ProseMirror 기반) — Markdown 호환·확장 가능
- **확장**: 변수 자동 치환 (`{{client.name}}` 입력 → 발송 시 실제 값으로)
- **익숙한 도구**: Notion·Linear 사용자가 바로 적응
- **저장**: `body_json` (TipTap JSON) + `body_html` (rendered)

### 4.3 하이브리드 (Hybrid)
- **대상**: 계약서·SOW — 메타는 정형, 본문은 자유
- **상단**: 폼 (고객·프로젝트·시작일·종료일·금액)
- **본문**: 에디터 (조항·작업 범위·산출물)
- **PDF**: 폼 데이터 + 에디터 결과 결합 렌더

---

## 5. AI 자동 작성 (Cue 통합)

### 5.1 진입 지점
- Q Docs 신규 문서 → **`✨ AI 작성`** 버튼
- Q Talk 채팅에서 `/cue 견적서 만들어줘 — Acme 4월 외주`
- Q bill 신규 견적서 → "AI 작성" 옵션
- 프로젝트 상세 → "이 프로젝트 견적 만들기"

### 5.2 입력 (사용자 + 자동 컨텍스트)
**사용자 입력**:
- 고객 (필수)
- 1줄 요구 ("4월 외주 디자인 견적", "Acme 12개월 유지보수 계약서")
- 옵션: 프로젝트, 기간, 톤(공식/친근)

**Cue 자동 수집 컨텍스트**:
1. 고객 과거 문서 (최근 3건 — 평균 단가, 항목 패턴, 지급조건)
2. 프로젝트 데이터 — `tasks.actual_hours × member.hourly_rate` 집계 → 시간 기반 견적 자동
3. 워크스페이스 기본값 — 부가세율, 통화, 발행자 정보
4. 템플릿 — 같은 kind 의 가장 인기 템플릿
5. (계약서) 기존 계약서 조항 — 워크스페이스 표준 조항 모음

### 5.3 출력
- 자동 채워진 폼/에디터 (status=`draft`)
- AI 생성 영역은 시각 표시 (좌측 ✨ 마커)
- "이 부분 다시 생성" — 부분 재생성

### 5.4 모델 / 비용
| 문서 종류 | 1차 모델 | 2차(고품질) |
|---|---|---|
| 견적서 / 청구서 | gpt-4o-mini ($0.15/1M) | claude-haiku |
| 계약서 / SOW | gpt-4o-mini → 검수 단계 gpt-4o | claude-sonnet |
| 회의록 변환 | claude-haiku (Q Note 통합) | — |

토큰 한도: 워크스페이스 plan별 (Free 50K/월, Basic 500K, Pro 5M).

### 5.5 안전장치
- AI 생성 견적은 **반드시 사용자 검토** 후 send (`status=draft` 강제)
- 금액 자동 계산은 클라이언트 재계산 (AI 결과 검증)
- PII (고객 정보) 는 워크스페이스 안에서만 LLM 에 전달, 로깅 안 함

---

## 6. UX 핵심 화면

### 6.1 Q Docs 홈
```
┌──────────────────────────────────────────────────────────┐
│ Q Docs                                  [+ 새 문서]      │
├──────────────────────────────────────────────────────────┤
│ 최근                                                      │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐                             │
│ │견적│ │계약│ │제안│ │회의│ ...                         │
│ │Acme│ │NDA │ │로고│ │주간│                             │
│ └────┘ └────┘ └────┘ └────┘                             │
│                                                          │
│ 템플릿 라이브러리                          [라이브러리▸] │
│ 견적서·청구서·계약서·제안서·NDA·회의록·SOP              │
│                                                          │
│ 종류별                                                    │
│ • 견적서 (12)  • 청구서 (8)  • 계약서 (3)                │
│ • 제안서 (5)   • 회의록 (24)                              │
└──────────────────────────────────────────────────────────┘
```

### 6.2 신규 문서 모달 (3 진입)
```
┌─ 새 문서 ────────────────────────────────────────┐
│                                                   │
│  ✨ AI 로 시작 (추천)                              │
│  ┌──────────────────────────────────────────────┐│
│  │ 어떤 문서가 필요해요?                         ││
│  │ [예: Acme 4월 외주 디자인 견적]              ││
│  │ 고객: [선택...]    템플릿: [자동]            ││
│  │                              [✨ 생성하기]   ││
│  └──────────────────────────────────────────────┘│
│                                                   │
│  📋 템플릿에서 시작                                │
│  견적서 · 청구서 · 계약서 · NDA · 제안서 ...     │
│                                                   │
│  📄 빈 문서                                       │
│  폼 / 에디터 선택                                 │
└─────────────────────────────────────────────────┘
```

### 6.3 편집기 (3컬럼)
```
┌─ 좌측 (240px)─┬─ 본문 (flex)──────────┬─ 우측 (320px) ─┐
│ 변수          │                        │ PDF 미리보기    │
│ {{client}}    │  편집 영역              │ ┌─────────┐   │
│ {{project}}   │  (에디터 또는 폼)       │ │         │   │
│ ...           │                        │ │  실시간  │   │
│               │                        │ │  preview│   │
│ 옵션          │                        │ │         │   │
│ □ AI 생성     │                        │ └─────────┘   │
│ 공유          │                        │                │
│ 히스토리      │                        │ 액션           │
│               │                        │ [저장] [발송]  │
│               │                        │ [PDF] [공유]   │
└───────────────┴────────────────────────┴────────────────┘
```

### 6.4 공개 링크 (고객용)
- 인증 없이 열람 (share_token)
- 모바일 반응형 (결제·서명까지)
- 액션: 보기 · PDF 다운로드 · **수락** (견적) / **결제** (청구서) / **서명** (계약서)

---

## 7. 권한 / 보안

| 역할 | 템플릿 | 문서 | 공유 |
|---|---|---|---|
| Platform admin | R/W (system 포함) | R/W | R/W |
| Owner | R/W (workspace) | R/W | R/W |
| Member | R/W (workspace) | R/W | R/W (제한 가능) |
| Client | R (자기 share_token) | R/W (서명·결제만) | — |

- **share_token**: 64자 랜덤, 옵션으로 만료·일회용
- **PII**: 문서 본문에 포함된 고객 정보는 share_token 없이 접근 불가
- **PDF 워터마크**: draft 상태는 워터마크 자동 (실수 발송 방지)
- **서명**: 캔버스 서명 + IP/UA 기록 (signature_data JSON)

---

## 8. API 엔드포인트 (요약)

```
Templates:
  GET    /api/docs/templates?kind=&business_id=
  POST   /api/docs/templates
  GET    /api/docs/templates/:id
  PUT    /api/docs/templates/:id
  POST   /api/docs/templates/:id/duplicate
  DELETE /api/docs/templates/:id

Documents:
  GET    /api/docs/documents?business_id=&kind=&status=&client=&project=
  POST   /api/docs/documents                    (신규 — template/empty/ai)
  GET    /api/docs/documents/:id
  PUT    /api/docs/documents/:id
  DELETE /api/docs/documents/:id
  POST   /api/docs/documents/:id/duplicate
  POST   /api/docs/documents/:id/archive

  POST   /api/docs/documents/:id/render-pdf     (PDF 재생성)
  POST   /api/docs/documents/:id/share          (share_token + 이메일)
  GET    /api/docs/documents/:id/revisions

AI:
  POST   /api/docs/ai/generate                  (initial 생성)
  POST   /api/docs/ai/regenerate-section        (부분 재생성)

Public:
  GET    /api/public/docs/:token
  POST   /api/public/docs/:token/sign
  POST   /api/public/docs/:token/accept         (견적 수락)
  GET    /api/public/docs/:token/pdf
```

---

## 9. 구현 Phase (4주)

| Phase | 기간 | 내용 |
|---|---|---|
| **D-1** | 1주 | DB 스키마, document_templates / documents API CRUD, Q Docs 홈 + 폼 모드 (견적서) |
| **D-2** | 1주 | 에디터 모드 (TipTap), 변수 치환, 하이브리드 모드, 청구서·계약서 템플릿 |
| **D-3** | 1주 | AI 생성 (Cue 통합), 부분 재생성, 5종 템플릿 (NDA·SOW·제안서·회의록·SOP) |
| **D-4** | 0.5주 | 공개 링크·서명·PDF 렌더 (puppeteer), 모바일 |
| **D-5** | 0.5주 | Q bill / Q Talk / 프로젝트 / Q Note 양방향 통합 |

**Q bill Phase 1 와 병행 가능**:
- Q bill Phase 1.1 (견적서 UI mock — 완료) 단계에 Q Docs D-1 (폼 + 견적서) 시작
- Q bill 백엔드 + Q Docs 데이터 모델 동시 진행 → 1번에 견적서 시스템 통합

---

## 10. 30년차 관점 — 흔한 함정과 회피책

### 10.1 함정 1: "에디터 = 모든 문서" 의 욕심
- 실제 사용자는 **견적서·청구서는 폼**, **계약서·제안서는 에디터** 선호
- 회피: 모드 선택을 처음부터 분리, 변환은 옵션

### 10.2 함정 2: PDF 렌더의 사이드 이슈
- 한국어 폰트, 페이지 분할, 도장/서명 위치, 인쇄 vs 디지털
- 회피: **puppeteer + Pretendard 폰트** 표준 + 템플릿별 CSS 격리

### 10.3 함정 3: AI 가 만든 문서의 법적 책임
- 계약서 AI 생성은 **반드시 사람 검토 + 면책 조항** + 검토 이력 기록
- 회피: 계약서 종류는 ai_generated=true 일 때 발송 전 모달 강제

### 10.4 함정 4: 변수 치환 시 NULL 처리
- `{{client.biz_name}}` 이 없으면 빈 문자열? 에러? 사용자 경고?
- 회피: 변수 정의에 default + required 명시. 발송 전 빈 변수 검증.

### 10.5 함정 5: 동시 편집 충돌
- 멤버 A·B 가 같은 문서 편집 시
- 회피: 1단계는 **마지막 저장 우선** (revision 기록만), 2단계 (Pro 플랜) Yjs 협업

### 10.6 함정 6: 템플릿 버전 관리
- 템플릿 수정 시 기존 인스턴스에 영향?
- 회피: 인스턴스는 생성 시점의 템플릿 **스냅샷 복사**. 템플릿 변경은 새 인스턴스부터 적용.

### 10.7 함정 7: i18n
- 견적서 ko / en 양쪽 동시 발행 (해외 고객)
- 회피: 템플릿 `locale='bilingual'` 일 때 schema 에 ko/en 양쪽 라벨 + PDF 좌우 분할 또는 페이지 분리

### 10.8 함정 8: 검색
- 본문 검색 — JSON 안의 텍스트 검색 어려움
- 회피: documents 에 `search_text` 컬럼 (form_data + body_text 추출 → MeCab/MySQL FULLTEXT)

---

## 11. 마이그레이션 / 호환성

### 11.1 기존 quotes / invoices
- 1회성 마이그레이션: 모든 quote/invoice 에 대응 documents 행 자동 생성 (`form_data` 채우기)
- 이후 quotes 테이블의 변경은 documents.form_data 와 동기 (DB trigger 또는 애플리케이션 hook)

### 11.2 기존 프로젝트 문서 탭
- DocsTab.tsx 는 그대로 두되 데이터 source 를 `files` + `documents` 합쳐서 표시
- 외부 파일(Drive) 은 files, 정형 문서는 documents

### 11.3 Phase 9 통합 컨텍스트
- 고객 360° 화면에 "고객 문서" 섹션 자동 추가 (해당 client_id 의 documents)
- 프로젝트 360° 도 동일

---

## 12. KPI / 성공 지표

| 지표 | 목표 (3개월) |
|---|---|
| AI 자동 생성 견적서 수락률 | > 70% (수정 적게 발송) |
| 평균 문서 작성 시간 | 20분 → 5분 (4배 단축) |
| 멤버당 월 발행 문서 수 | +50% |
| 공개 링크 viewed_at 24h 내 비율 | > 80% |
| 계약서 서명 완료율 | > 60% |

---

## 13. 미해결 결정 사항 (Irene 검토 필요)

1. **Q Docs 메뉴 라벨**: "Q docs" / "Q 문서" 중 선택 (현재 layout.json: "Q docs")
2. **첫 출시 템플릿**: 견적서·청구서 + α (NDA / 회의록 / 제안서 중 우선)
3. **에디터 라이브러리**: TipTap (라이선스 MIT, 검증됨) / Plate / 자체 구현 — 추천 TipTap
4. **PDF 엔진**: puppeteer (서버) / @react-pdf/renderer (클라) — 추천 puppeteer (한국어 폰트·페이지)
5. **AI 모델 한도**: Free 플랜에서 AI 작성 허용 여부 (월 N회 제한)

---

## 부록 A — 견적서 템플릿 schema 예시 (시스템 기본)

```json
{
  "name": "표준 견적서 (KO)",
  "kind": "quote",
  "mode": "form",
  "locale": "ko",
  "is_system": true,
  "schema_json": {
    "header": {
      "issuer_logo": {"source": "business.logo_url"},
      "issuer_info": {"source": "business", "fields": ["name","biz_number","ceo","address","phone"]}
    },
    "fields": [
      {"key": "client_id", "type": "client_picker", "required": true, "label": "고객"},
      {"key": "title", "type": "text", "label": "제목", "ai_hint": "프로젝트/작업 한 줄 요약"},
      {"key": "issued_at", "type": "date", "default": "today", "label": "발행일"},
      {"key": "valid_until", "type": "date", "default": "+30d", "label": "만료일"},
      {"key": "currency", "type": "select", "options": ["KRW","USD","EUR"], "default": "KRW"},
      {"key": "items", "type": "line_items", "label": "품목", "required": true,
       "schema": {
         "description": {"type": "text", "ai_hint": "구체적 산출물 (예: 메인 페이지 리디자인)"},
         "quantity": {"type": "number", "default": 1, "step": 0.5},
         "unit_price": {"type": "number", "step": 1000},
         "subtotal": {"type": "computed", "formula": "quantity * unit_price"}
       }},
      {"key": "vat_rate", "type": "percent", "default": 0.10, "label": "부가세율"},
      {"key": "payment_terms", "type": "textarea", "default": "발행 후 14일 이내 계좌이체"},
      {"key": "notes", "type": "textarea", "label": "메모 (고객용)"}
    ],
    "totals": [
      {"key": "subtotal", "label": "공급가액", "formula": "sum(items.subtotal)"},
      {"key": "vat", "label": "부가세", "formula": "subtotal * vat_rate"},
      {"key": "total", "label": "합계", "formula": "subtotal + vat", "highlight": true}
    ],
    "footer": {
      "signature_zone": true,
      "qr_code": {"type": "share_link"}
    }
  },
  "ai_prompt_template": "고객 [{{client.name}}] 의 [{{title}}] 견적서를 작성해줘. 과거 견적 평균 단가는 [{{client.avg_unit_price}}], 일반적인 항목 패턴은 [{{client.common_items}}]. 사용자 요구: [{{user_input}}]. 항목은 3-5개로, 각 항목 description 은 결과물 기반(완료 시점 명확) 으로."
}
```

---

## 14. 합의 후 즉시 시작 가능한 단계

1. **이번 주**: 데이터 모델 마이그레이션 작성 + 시스템 견적서 템플릿 1종 (위 부록 A)
2. **다음 주**: Q Docs 페이지 골격 (`/docs` → 신규 메뉴 추가) + 폼 모드 견적서 편집기 (Q bill 의 QuoteEditor 를 Q Docs 로 이동)
3. **3주차**: AI 생성 (Cue 통합) — 견적서 우선
4. **4주차**: 공개 링크·PDF·Q bill 통합

— 끝 —
