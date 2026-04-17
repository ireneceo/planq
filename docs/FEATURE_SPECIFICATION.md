# 08. 개발기능 정의서

---

## Phase 2: 인증 시스템

### F2-1. 회원가입 (사업자 등록)
| 항목 | 내용 |
|------|------|
| 화면 | /register |
| 입력 | 이메일, 비밀번호, 이름, 사업자명, slug |
| 처리 | User 생성 → Business 생성 → BusinessMember(owner) 생성 → JWT 발급 |
| 유효성 | 이메일 중복 확인, 비밀번호 8자 이상, slug 중복 확인 |
| 결과 | 자동 로그인 → 대시보드 이동 |

### F2-2. 로그인
| 항목 | 내용 |
|------|------|
| 화면 | /login |
| 입력 | 이메일, 비밀번호 |
| 처리 | 이메일/비밀번호 검증 → Access Token(15분) + Refresh Token(7일) 발급 |
| 소속 사업자가 여러 개 | 로그인 후 사업자 선택 화면 표시 |
| 결과 | 대시보드 이동 |

### F2-3. 토큰 갱신
| 항목 | 내용 |
|------|------|
| 트리거 | Access Token 만료 시 Axios interceptor에서 자동 호출 |
| 처리 | Refresh Token으로 새 Access Token 발급 |
| 실패 시 | 로그인 페이지로 리다이렉트 |

### F2-4. 비밀번호 재설정
| 항목 | 내용 |
|------|------|
| 화면 | /forgot-password |
| 처리 | 이메일 입력 → 재설정 링크 발송 → 새 비밀번호 설정 |
| 토큰 유효기간 | 1시간 |

### F2-5. 역할 기반 접근 제어
| 역할 | 접근 범위 |
|------|----------|
| platform_admin | 모든 API + /admin 라우트 |
| Business Owner | 자기 Business 전체 + 설정/팀 관리 |
| Business Member | 배정된 고객/대화/할일 |
| Client | 자기 사업자와의 대화/할일/자료/청구서 |

---

## Phase 3: 사업자 + 고객 관리

### F3-1. 사업자 프로필 관리
| 항목 | 내용 |
|------|------|
| 화면 | /app/settings/profile |
| 기능 | 사업자명, 로고, slug 수정 |
| 권한 | Owner만 |

### F3-2. 멤버 초대
| 항목 | 내용 |
|------|------|
| 화면 | /app/team |
| 입력 | 이메일, 역할(member) |
| 처리 | 초대 이메일 발송 → 수신자가 가입/로그인 → BusinessMember 생성 |
| 권한 | Owner만 |

### F3-3. 고객 초대
| 항목 | 내용 |
|------|------|
| 화면 | /app/clients → [고객 초대] 버튼 |
| 입력 | 이메일, 표시이름, 회사명 |
| 처리 | Client(status:invited) 생성 → Conversation 자동 생성 → 초대 이메일 발송 |
| 초대 수락 | 링크 클릭 → 간편 가입 (이름/이메일/비밀번호) → Client.status → active |
| 핵심 | **웹 링크 클릭 즉시 채팅 가능해야 함. 카톡만큼 쉬워야 함.** |

### F3-4. 고객 목록/상세
| 항목 | 내용 |
|------|------|
| 화면 | /app/clients |
| 표시 | 이름, 회사명, 상태, 최근 대화, 미결 할일 수 |
| 필터 | 상태 (active/invited/archived) |

---

## Phase 4: Q Bill (청구서)

### F4-1. 청구서 생성
| 항목 | 내용 |
|------|------|
| 화면 | /app/bills/new |
| 입력 | 고객 선택, 제목, 항목(품목/수량/단가), 납부기한, 비고 |
| 자동계산 | 소계(합계), 부가세(10%), 총합계 |
| invoice_number | 자동생성 (INV-YYYY-NNNN) |
| 저장 | status: draft |

### F4-2. 청구서 이메일 발송
| 항목 | 내용 |
|------|------|
| 트리거 | 청구서 상세 → [발송] 버튼 |
| 처리 | Nodemailer로 HTML 청구서 이메일 발송 |
| 이메일 내용 | 청구 제목, 항목 테이블, 금액, 납부기한, 입금 계좌 |
| 상태 변경 | status: draft → sent, sent_at 기록 |

### F4-3. 입금 확인
| 항목 | 내용 |
|------|------|
| 처리 | 수동으로 [입금 확인] 클릭 |
| 상태 변경 | status: sent → paid, paid_at 기록 |

### F4-4. 청구서 목록
| 항목 | 내용 |
|------|------|
| 화면 | /app/bills |
| 필터 | 전체/미결(draft+sent+overdue)/완료(paid) |
| 표시 | 번호, 고객명, 금액, 상태, 발행일, 납부기한 |

---

## Phase 0: 기초 정비 (Q Talk 선행 작업)

Q Talk 본격 개발 전에 반드시 선행되어야 하는 토대 작업.

### F0-1. 네이밍 i18n 교체
- `locales/{ko,en}/*.json` 에서 `사업자 / Business Owner` → `워크스페이스·관리자 / Workspace·Admin` 일괄 교체
- `role.business_owner` → 표시 "관리자 / Admin"
- `role.business_member` → "멤버 / Member"
- `businessName*` 라벨 → "워크스페이스 이름 / Workspace Name" 등
- DB·코드 내부 명칭은 그대로 (SYSTEM_ARCHITECTURE 8. 네이밍 정책)

### F0-2. 워크스페이스 정보 확장 (DB)
- `businesses` 테이블에 brand/legal 컬럼 추가 (DATABASE_ERD 5. 마이그레이션 노트)
- 기존 `name` 데이터를 `brand_name` 에 복사 후 `name` 컬럼 drop
- `default_language` 가입 시점부터 필수

### F0-3. 워크스페이스 설정 페이지
- 신규 페이지 3개:
  - `/app/settings/brand` — 브랜드 카드 (AutoSaveField): 로고, brand_name, brand_name_en, tagline, color
  - `/app/settings/legal` — 법인 정보 카드 (AutoSaveField): legal_name, tax_id, representative, address, contact
  - `/app/settings/language` — 기본 언어 · 타임존 · 근무시간
- `default_language='en'` 일 때는 `_en` 필드 섹션 자동 숨김

### F0-4. Cue 시스템 계정 생성
- `POST /auth/register` 내부 트랜잭션에 Cue 계정 생성 포함
  1. `users` insert (is_ai=true, email=null, name='Cue', avatar_url='/static/cue.svg')
  2. `business_members` insert (role='ai')
  3. `businesses.cue_user_id` 업데이트
- 기존 워크스페이스에는 마이그레이션 스크립트로 일괄 Cue 계정 주입

### F0-5. 가시성 인프라
- `checkVisibility` 미들웨어 신규 (SECURITY_DESIGN 3.6)
- 각 리소스 테이블에 `visibility` enum / `owner_user_id` / `shared_with` 컬럼 필요 시 추가 (Phase 0 에서는 기본 구조만, 실제 적용은 해당 메뉴 Phase 에서)

### F0-6. 멤버 관리 페이지 확장
- `/app/settings/members` 에 Cue 카드를 고정 상단에 표시
- Cue 카드: 상태(활동/대기), 모드(smart/auto/draft), 월 사용량 바, "설정으로 이동" 링크
- Cue 는 초대/제거 불가, 이름·프로필 변경 불가 (브랜드 고정)

### F0-7. 설계 문서 완성
- FEATURE_SPECIFICATION, SYSTEM_ARCHITECTURE, DATABASE_ERD, API_DESIGN, SECURITY_DESIGN, INFORMATION_ARCHITECTURE 완성
- 본 섹션 완료 상태

---

## Phase 5: Q Talk (프로젝트 중심 협업 채팅)

> **2026-04-15 전면 재작성.** 이전 "고객 1:1 persistent thread" 모델에서 **프로젝트 중심 + 다채널 + 자동 업무 추출** 모델로 전환. Cue(AI 팀원) 재사용 가능, 엔진 동일, UX/IA 완전히 갈아엎음. 이전 F5-0 ~ F5-16 의 의도는 F5-0 ~ F5-24 에 흡수됨.

### F5-0. 설계 철학 3원칙

1. **프로젝트 중심(Project-centric)** — 모든 정보(대화·업무·메모·이슈·파일)는 프로젝트 단위로 수렴/발산. 대화 채널은 "이 프로젝트의 소통 방식" 이지 독립 단위가 아님.
2. **결정론 우선(Deterministic-first)** — AI 는 자연어 → 구조화 데이터 변환 1회만 담당. 저장된 결과의 재조회·재표시에 AI 재호출 금지. 기존 데이터로 가능한 기능은 DB 쿼리로 해결 (메모리 `feedback_ai_minimal_usage.md` 준수).
3. **두 얼굴, 같은 뼈대(One skeleton, two faces)** — 고객과 멤버는 같은 화면 구조에 **권한 필터**만 다름. 완전히 별도 뷰 만들지 않음.

### F5-0b. 개요 및 스코프

**포지셔닝**: 고객(Client)과 워크스페이스의 **사람 팀원 + Cue(AI 팀원)** 가 함께 일하는 **프로젝트 단위 협업 공간**. 한 프로젝트에 최소 2개 채널(내부 논의 + 고객 소통) 이 자동 생성되고, 대화에서 업무 후보가 자동 추출되어 Q Task 로 이어짐.

**제외 (Out of scope — Phase 1)**
- 익명 방문자 위젯, 마케팅 퍼널
- 음성·영상 통화
- 외부 채널 연동 (카카오톡, 인스타 DM 등)
- B2B2B 다자 대화 (사업자-사업자 공유)

**후순위 (Phase 2 로 연기, 데이터 모델·API 는 Phase 1 에 완결)**
- 이메일 초대 발송 (nodemailer 연동) — Phase 1 은 초대 링크 복사까지만
- 고객사 전용 관리 페이지 `/clients` — Phase 1 은 프로젝트 생성 시 inline 추가
- 파일 첨부 UI (드래그앤드롭) — `message_attachments` 테이블/API 유지, UI 만 연기
- 반복 업무 자동 감지 — Phase 1 은 사용자가 Q Task 에서 수동 설정

---

### F5-1. 프로젝트 도메인 모델

```
Business (워크스페이스, 기존)
  └─ Project (1급 개체, 신규)
       ├─ ProjectMember (멤버 + 역할 매핑, 신규)
       ├─ ProjectClient (고객 참여자, 신규)
       ├─ Conversation (확장: project_id, channel_type, auto_extract_enabled, last_extracted_message_id)
       │    └─ Message (확장: reply_to_message_id + FULLTEXT 검색 인덱스)
       │         └─ DetectedQuestion → CueDraft (기존 재사용 + processing_by/processing_at 낙관적 잠금)
       ├─ TaskCandidate (신규, 추출 후보 히스토리 영구 저장)
       ├─ Task (Q Task, project_id FK 추가)
       ├─ ProjectNote (신규, 개인/내부 메모)
       ├─ ProjectIssue (신규, 주요 이슈 수동 CRUD)
       ├─ File (project_id FK 추가)
       └─ Invoice (project_id FK 추가)
```

**핵심 원칙**
1. 프로젝트당 대화 채널 **최소 2개 자동 생성**: "내부 논의" + "{고객사명} 과의 소통"
2. 고객 DM 없음 — 고객과의 모든 소통은 프로젝트의 고객 채널을 통함 (감사·인수인계 보존)
3. 멤버끼리 1:1 DM 은 허용 (내부 효율)
4. 프로젝트 : 고객사 = 1 : 1, 고객사 참여자는 N 명
5. 한 사용자가 여러 워크스페이스에 속할 수 있음 (내 회사 = 멤버, 거래처 = 고객)
6. Cue 는 팀원 한 명 — 사람과 동시에 응대, 명시적 지시로만 멈춤 (Phase 0 원칙 유지)
7. 모든 Cue 답변은 출처 `ai_sources` JSON 에 기록 + UI 표시

---

### F5-2. 프로젝트 생성 (단일 모달, 위저드 없음)

| 항목 | 내용 |
|------|------|
| UX | 모달 1개, 단계 분할 없음 — 30초 내 생성 가능 |
| 입력 | 프로젝트명 *필수 / 고객사(기존 선택 or 신규 이름+이메일) / 기간(선택) / 설명(선택) / 멤버 선택 + 역할 매핑 |
| 역할 풀 | 기본 6종: 기획·디자인·개발·영업·운영·기타 (+ 자유 추가 가능) |
| 역할 매핑 | 멤버 추가 시 역할 드롭다운. 같은 역할 중복 가능 (디자이너 2명 등) |
| 기본 담당자 | 생성자(owner)가 자동 세팅, 변경 가능. 자동 추출 매핑 실패 시 fallback |
| 채널 자동 생성 | 생성 완료 즉시 `conversations` 2행 자동 생성 (internal + customer) |
| 고객 초대 | 모달 안에 이메일+이름 추가 UI, 저장 시 **초대 링크 클립보드 복사** (메일 발송은 Phase 2) |

**설계 근거**: 위저드 3단은 생성 빈도가 낮다는 착각. 에이전시 대행사 기준 주 5개 이상 생성될 수 있어 가볍고 즉각적인 단일 모달이 실무에 맞음.

#### F5-2b. 고객 초대 링크 처리 (기가입 vs 신규 가입, 2026-04-15 추가)

초대 링크는 `project_clients.invite_token` (32바이트 랜덤 + base64url) 로 1회성 토큰 발급. 링크 클릭 시 다음 분기:

**1. PlanQ 미가입 (이메일이 `users` 테이블에 없음)**
- 초대 랜딩 페이지 → "가입하고 {프로젝트명} 에 참여하기" 버튼
- 클릭 → 최소 가입 폼 (이메일 prefilled / 이름 / 비밀번호)
- 가입 완료 → `users` insert → `project_clients.contact_user_id` 업데이트 → 해당 워크스페이스의 `clients` 레코드 자동 생성 → 프로젝트의 고객 채널로 즉시 진입
- `invite_token_used_at = NOW()` 로 토큰 소진

**2. PlanQ 기가입 (이메일이 `users` 에 있고 활성)**
- 초대 랜딩 페이지 → 로그인 상태 확인
  - 로그인 안 됨 → 로그인 페이지 → 로그인 후 초대 수락 플로우 재진입
  - 로그인 됨 → 그 user_id 가 초대 이메일의 소유자인지 검증 (다르면 "다른 계정으로 로그인하세요" 안내)
- 검증 통과 → `project_clients.contact_user_id = user.id`, `clients` 레코드 없으면 생성 → 프로젝트의 고객 채널로 진입
- `invite_token_used_at = NOW()` 로 토큰 소진

**3. 토큰 만료/사용됨 (TTL 7일, 1회성)**
- 랜딩 페이지에서 "만료/사용됨" 안내 + "워크스페이스 담당자에게 새 링크 요청"

**4. 멀티 역할 대응**
- 이미 해당 사용자가 **다른 역할** (owner/member) 로 같은 워크스페이스에 속해있다면: 고객으로도 등록 가능 (동일 워크스페이스에서 owner + client 양쪽 레코드 공존)
- 드문 케이스이지만 (예: 본인 거래처 프로젝트에 고객으로 참여) 지원
- UI 상 워크스페이스 스위처에선 역할 우선순위 표시 (owner > member > client)

**DB 필드** (`project_clients`):
- `invite_token` VARCHAR(64) / `invite_token_used_at` DATETIME — Phase 1 에서 이미 생성/저장
- 랜딩 페이지 + 검증 로직은 Phase 2 (이메일 발송과 함께)

**보안**:
- 토큰 32바이트 랜덤 (`crypto.randomBytes(24).toString('hex')` — 48자)
- TTL 7일 (초대 시점부터), 1회성 소멸
- 로그인된 사용자 이메일과 `contact_email` 일치 검증 필수 (피싱 방어)
- 같은 워크스페이스의 멤버가 다른 사람 토큰으로 자기 계정 연결 시도 차단

---

### F5-3. 대화 채널 (Conversation 확장)

| 필드 | 설명 |
|------|------|
| `project_id` | 프로젝트 FK (신규) |
| `channel_type` | `customer` / `internal` / `group` (3채널 이상은 group) |
| `auto_extract_enabled` | 자동 업무 추출 on/off. 기본 customer=true, internal=false |
| `last_extracted_message_id` | 마지막 업무 추출 커서 — 이후 메시지만 다음 추출 대상 |
| `last_extracted_at` | 마지막 추출 시각 |

프로젝트 상세 화면에서 관리자가 group 채널 추가 가능 (드문 케이스).

---

### F5-4. 대화 자료 (Cue 답변 소스) — 사용자 표기 "대화 자료" / 내부 `KB`

| 항목 | 내용 |
|------|------|
| 용어 | 사용자 UI: "대화 자료" / "Cue 자료실". "KB" 약어는 코드·DB 내부만 |
| 진입 | `/talk/p/:id/kb` (프로젝트 스코프) — 프로젝트별 자료실 |
| 업로드 | 매뉴얼, FAQ, 가격표, 정책 문서. pdf, docx, xlsx, pptx, txt, md |
| 엔진 재사용 | Q Note 의 `embedding_service` + FTS + chunk splitter + LLM 2차 매칭 그대로 |
| 인덱싱 | 업로드 즉시 비동기 인덱싱. pending → indexing → ready |
| Pinned FAQ | 관리자 직접 등록 Q&A (단건 폼 + CSV 일괄). Tier 1 우선 매칭 |
| 버전 | 문서 갱신 시 `kb_documents.version` 증가 |
| 가시성 | 멤버만 (고객 접근 불가) |
| 임베딩 모델 | text-embedding-3-small (1536d, cosine sim, BLOB 저장) |

---

### F5-5. Cue 답변 Tier + Auto/Draft/Smart 모드 (Phase 0 기존 유지)

**Tier (매칭 우선순위)**
| Tier | 설명 | 신뢰도 |
|---|---|---|
| 1. Pinned FAQ | 관리자 직접 등록 Q&A (paraphrase 매칭 + 임베딩 rerank + LLM 2차 검증) | 높음 |
| 2. KB RAG | 대화 자료 문서 청크 검색 (FTS + 임베딩 하이브리드) | 중간~높음 |
| 3. Session Reuse | 같은 고객 과거 대화에서 유사 답변 재활용 | 중간 |
| 4. LLM General | KB 없음 — 워크스페이스 브랜드 톤으로 일반 답변 or 폴백 | 낮음 |

**Auto / Draft / Smart 3 모드**
| 내부 | UI 라벨 (ko) | 동작 | 기본값 |
|---|---|---|:---:|
| `smart` | 잘 아는 것만 답변한다 | Tier 1~2 + confidence ≥ 0.85 → Auto, 아니면 Draft | ✓ |
| `auto` | 일단 답변을 시도한다 | 모든 Tier 자동 발송 | |
| `draft` | 내가 확인한 뒤 보낸다 | 전부 Draft, 사람 승인 필요 | |

**민감 키워드 강제 Draft**: 환불·계약해지·위약금·법적·금액 100만원 이상·감정 부정어 → Auto 모드라도 Draft 강제.

**출처 표시 의무**: 모든 Cue 답변은 `ai_sources` JSON 에 [{doc_id, title, section, snippet}] 기록 + UI 노출.

**자기부정 금지**: "저는 AI라서..." 같은 표현 프롬프트 차단 — 워크스페이스 팀원 관점으로 답변.

---

### F5-6. Cue 답변 처리 + 낙관적 잠금 (신규)

담당자가 여러 명일 때 같은 Draft 를 동시에 처리하는 충돌 방지.

| 항목 | 내용 |
|------|------|
| 위치 | 질문 메시지 바로 아래에 "Cue 답변 대기" 소형 카드 (담당자만 표시) |
| 담당자 입력창 | "Cue 답변 대기 N개 ↑" 뱃지 (클릭하면 첫 번째 draft 로 이동) |
| [처리 시작] | `messages.cue_draft_processing_by = me, cue_draft_processing_at = now`. TTL 5분. |
| [수정] → [전송] | 편집 후 전송 — 새 메시지 insert with `reply_to_message_id = 원질문.id` |
| [그대로 전송] | 즉시 전송 |
| [거절] | draft 상태 = rejected |
| 충돌 | `processing_by` 이미 있으면 [처리] 버튼 disabled + "xxx 가 처리 중" 표시 |
| TTL 만료 | 5분 경과 시 자동 해제 (abandon) → 다른 담당자 사용 가능 |
| WS 이벤트 | `cue:draft_locked` / `cue:draft_released` / `cue:draft_sent` |

---

### F5-6b. 업무 네이밍 규칙 (필수 — 모든 업무에 적용)

**원칙**: 모든 업무 제목은 **결과물이 있는 완료 시점을 명확히 아는 형태**로 작성해야 한다.

"이 업무가 끝났을 때, 어떤 산출물/파일/문서가 만들어져 있는가?"를 제목에 담는다.

| 금지 (프로세스형) | 올바른 (결과물형) |
|---|---|
| 시장조사 | 경쟁사 3곳 비교분석표 작성 |
| 디자인 작업 | 로고 시안 3종 PDF 제작 완료 |
| 검토 | 폰트 후보 3종 상업 라이선스 확인서 작성 |
| 준비 | 웹사이트 리뉴얼 견적서 작성 전달 |
| 성능 개선 | 웹사이트 성능 감사 보고서(Lighthouse) 작성 |
| 미팅 | 주간 진행 현황 리포트 제출 |
| 논의 | 컬러 시스템 제안서(Primary+Secondary) 완성 |

**적용 범위**:
1. **LLM 자동 추출** — `task_extractor.js` 프롬프트에 CRITICAL NAMING RULE 로 강제
2. **사용자 수동 등록** — UI placeholder/가이드 텍스트로 안내
3. **시드/데모 데이터** — 모든 업무/업무 후보에 동일 규칙 적용
4. **Cue 제안** — Cue가 업무를 제안할 때도 동일 규칙

**패턴**: `[대상] [산출물] [동사]` — "경쟁사 비교분석표 작성", "로고 시안 3종 PDF 납품", "최종 납품 패키지 정리(CMYK+RGB)"

---

### F5-7. 자동 업무 추출 (신규 — Cue 의 구조화 기능)

**트리거**
1. **자동 제안 배너** (AI 호출 아님, 조건 감지만)
   - `auto_extract_enabled=true` + `last_extracted_message_id` 이후 새 메시지 ≥ 5개 + 마지막 메시지 20분 경과
   - 입력창 위 배너: `"5개의 새 메시지가 있습니다 — [업무 추출] · [Q Task 에서 직접 등록]"`
2. **수동 버튼**: [업무 추출] 버튼 상시 노출
3. **Cue 명령**: 메시지에 "Cue, 이 내용 업무로 정리해줘" 입력 시 1회 실행 (토글 off 여부와 무관)

**추출 파이프라인 (AI 호출 1회)**
1. 컨텍스트 수집:
   - `last_extracted_message_id` 이후 메시지 목록
   - 프로젝트의 open 상태 `tasks` 리스트 (제목·설명만, 유사 업무 dedupe 용)
   - 프로젝트 역할 매핑 + 기본 담당자
   - 프로젝트 정보 (이름·기간·설명)
2. LLM 호출 — 반환 JSON:
   ```json
   [{
     "title": "로고 시안 3종 PDF 제작 완료",
     "description": "...",
     "source_message_ids": [123, 124, 127],
     "guessed_role": "디자인",
     "guessed_due_date": "2026-03-15",
     "similar_task_id": 88,
     "recurrence_hint": null
   }]
   ```
3. **결정론적 후처리** (AI 아님)
   - `guessed_role` → `project_members` 역할 매핑 조회
     - 1명이면 자동 확정
     - 2명 이상이면 `role_order` 기준 첫 번째 자동 선택
     - 0명이면 `project.default_assignee_user_id` 로 fallback
   - 마감일 검증 (과거·미래 1년 초과 거절)
   - 유사 업무 유사도 검증 (제목 트라이그램 similarity ≥ 0.6)
4. `task_candidates` 테이블에 bulk INSERT (status=pending)
5. `conversations.last_extracted_message_id`, `last_extracted_at` 업데이트
6. WS 이벤트 `candidates:created` 발행

**확인 UI — 우측 탭 임시 섹션 "업무 후보 N개"**

각 후보 카드에 3 버튼:
- **[등록]** — Q Task 에 INSERT (상태 `task_requested`), `task_candidates.status = registered`, `task_candidates.registered_task_id` 연결
- **[내용 추가]** — 유사 기존 업무에 후보 내용을 코멘트로 추가, `status = merged`
- **[거절]** — `status = rejected`

카드 클릭 시 원본 메시지로 스크롤 + 3초 하이라이트.

**히스토리 조회 (AI 재호출 없음)**
- 우측 탭 [과거 후보 보기] 링크 또는 `/talk/p/:id/candidates` 화면
- `task_candidates` 쿼리 그대로 표시 — 저장된 데이터만 사용
- 거절한 후보도 "다시 등록" 가능 (AI 호출 X, 저장된 카드에서 바로 등록)

**중복 방지**: 동일 `conversation_id` 에 `extraction_in_progress_at` (TTL 2분) 로 동시 호출 차단.

---

### F5-8. 프로젝트 메모 (ProjectNote, 신규)

| 항목 | 내용 |
|------|------|
| 스코프 | **프로젝트 단위** (대화방 스코프 아님). 어느 채널에서 작성해도 모든 채널에서 동일 노출. Q Task 프로젝트 상세에서도 동일 노출 |
| visibility | `personal` (작성자 본인만) / `internal` (멤버만, 고객 숨김) |
| 작성 | 우측 탭 하단 입력창 + 토글 [개인/내부] (기본 개인). 고객 뷰는 토글 자체 없음, 항상 개인 |
| 렌더링 | 최신 3개 노출 + 스크롤 올리면 무한 로드 과거 |
| 편집/삭제 | 본인만 가능 |
| DB | `project_notes` 테이블 (project_id, author_user_id, visibility, body, created_at) |

**설계 근거**: 메모가 대화방 스코프면 고객 채팅/내부 채팅에서 따로 쌓여 인수인계 시 누락. 프로젝트 스코프로 승격하면 한 곳에서 관리.

---

### F5-9. 주요 이슈 (ProjectIssue, 신규 — AI 없음)

| 항목 | 내용 |
|------|------|
| 목적 | 프로젝트의 현재 이슈·상태를 간략히 유지 |
| 생성 | 우측 탭 "주요 이슈" 섹션의 **[+ 추가]** 버튼, 인라인 입력창 |
| 편집 | 이슈 텍스트 클릭 → `contenteditable` 인라인 편집 → blur 시 자동 저장 |
| 삭제 | 각 이슈의 [삭제] 버튼 |
| 렌더링 | 날짜 역순 최신 3개 기본 노출, [더보기] 클릭 시 과거 표시 |
| LLM | **자동 생성·재요약 없음** — 완전 수동 CRUD (메모리 `feedback_ai_minimal_usage.md`) |
| DB | `project_issues` 테이블 (project_id, body, author_user_id, created_at, updated_at) |

---

### F5-10. 채팅 통합 검색 (신규, 모달 없음)

| 항목 | 내용 |
|------|------|
| 진입 | 좌측 리스트 상단 검색 바 + Ctrl+K / Cmd+K 포커스 단축키 |
| UX | **모달 없음**. 검색어 입력 시 **좌측 리스트 영역이 결과 뷰로 전환** (프로젝트 리스트 일시 대체). 초기화 시 리스트 복귀 |
| 필터 | 검색어 입력 시 상단 필터 바 나타남 — 프로젝트 / 채널 / 발신자 / 기간 |
| 기술 | MySQL `FULLTEXT INDEX` with `ngram` parser (한국어 대응) |
| 권한 필터 | 멤버는 참여 프로젝트 전체, 고객은 참여 채널만 |
| 결과 클릭 | 가운데 채팅 영역이 해당 메시지로 스크롤 + 3초 코랄 하이라이트 |
| 하이라이트 스니펫 | 서버에서 매칭 위치 기준 전후 40자 스니펫 추출, 검색어 `<mark>` 강조 |

---

### F5-11. 실시간 메시지 + 상태 피드백 (Phase 0 확장)

| 항목 | 내용 |
|------|------|
| 전송 기술 | Socket.IO |
| 이벤트 | `message:new`, `message:updated`, `message:deleted`, `cue:thinking`, `cue:draft_ready`, `cue:draft_locked`, `cue:draft_released`, `candidates:created`, `note:new`, `project:updated` |
| 고객 send | 즉시 "받았어요" 상태 → "관련 자료 찾는 중..." → AI 답변 도착 |
| 타이핑 | 양쪽 타이핑 인디케이터 (Q Note UI 재사용) |
| 자동 상태 | AI 확정 못하면 "담당자에게 전달했어요 · 평균 응답 N분" 자동 시스템 메시지 |
| 스크롤 | sticky-to-bottom (위 스크롤 시 자동 스크롤 정지) |
| Rate limit | 같은 프로젝트 이벤트 버스트 초당 20개 제한 |

---

### F5-12. 3단 레이아웃 + 접기/펼치기

| 영역 | 설명 | 모바일 |
|---|---|---|
| 좌측 리스트 | 프로젝트 리스트 + 검색 바 + 필터 + 워크스페이스 스위처. Q Note 스타일 접기/펼치기 | 햄버거 메뉴 |
| 가운데 | 채널 탭 + 메시지 흐름 + 입력창 + 자동 추출 토글 + 업무 추출 버튼 | 풀스크린 |
| 우측 탭 | 주요 이슈 / 내 할 일 / 프로젝트 업무 / 프로젝트 메모 / 프로젝트 정보 (아코디언) | 하단 시트 |

**우측 탭 리사이즈**: 가로 핸들 드래그로 폭 조정. **2열 확장 없음** — 각 섹션에 max-height + 독립 스크롤로 높이 부담 해결.

**반응형 breakpoint**:
- ≥1200px: 3단 풀 노출
- 992~1199px: 좌측 접힘 기본
- 768~991px: 좌측 햄버거, 가운데+우측 2단
- <768px: 가운데 풀스크린 + 좌우 각각 하단 시트

---

### F5-13. 우측 탭 섹션 상세 (5 아코디언)

| 섹션 | 기본 상태 | 콘텐츠 | 높이 |
|---|---|---|---|
| 주요 이슈 | 펼침 | 최신 3개 + [+] 추가 + 인라인 편집 | max 180px |
| 내 할 일 | 펼침 | 현재 프로젝트 본인 담당, 체크박스 즉시 처리, 상태 뱃지, 반복 아이콘, [Q Task 전체 보기] | max 280px, 내부 스크롤 |
| 프로젝트 업무 | 접힘 | 프로젝트 전체 업무 최신순, 담당자 표시 없음, 반복 아이콘, 펼치면 완료 포함 | max 320px |
| 프로젝트 메모 | 펼침 | 최신 3개 + 입력창 + 개인/내부 토글 + 스크롤 과거 로드 | max 260px |
| 프로젝트 정보 | 접힘 | 이름/고객사/기간/상태/기본 담당자/역할 매핑 요약 + [상세 보기] | 자동 |

**중요**: 각 섹션 헤더 클릭으로 접힘/펼침 토글, localStorage 상태 저장.

---

### F5-14. 프로젝트 상태 (3 종)

| 상태 | 의미 | 자동 추출 | 리스트 노출 |
|---|---|---|---|
| `active` | 진행 중 | on | 기본 |
| `paused` | 일시 중단 | off | 기본 |
| `closed` | 종료/중단 | off | 필터 토글로 숨김/노출 |

**archived 제거**: closed 와 구분 가치 없음. 완전 숨김은 필터 토글로 해결.

---

### F5-15. 워크스페이스 선택 (로그인 직후, 공통)

| 조건 | 동작 |
|---|---|
| 사용자가 속한 워크스페이스 1개 | 자동 진입 |
| 2개 이상 | 카드 리스트 선택 화면 — 각 카드에 로고/이름/내 역할/진입 버튼 |
| 전환 | 우측 상단 드롭다운으로 언제든 전환 (Slack 패턴) |

**근거**: 한 사용자가 자기 회사에서는 멤버, 다른 회사에서는 고객일 수 있음. `business_members` + `clients` 양쪽에서 조회.

---

### F5-16. 고객 vs 멤버 뷰 (동일 뼈대, 권한 필터)

**같은 화면 구조**를 쓰되 권한별 필터로 차이 생성:

| 항목 | 멤버 | 고객 |
|---|---|---|
| 사이드바 메뉴 | 전체 Q 시리즈 | 최소화 (언어/프로필/로그아웃) |
| 좌측 프로젝트 리스트 | 참여 전체 | 자기 참여만, 1개면 자동 접힘 |
| 채널 탭 | 모두 (customer + internal + group) | customer 만 |
| 내부 메모 | 읽기·쓰기 | 숨김 |
| 개인 메모 | 가능 | 가능 |
| 자동 추출 토글 | 노출 | 숨김 |
| [업무 추출] 버튼 | 노출 | 숨김 |
| Cue 답변 대기 카드 | 표시 | 숨김 |
| 업무 후보 섹션 | 표시 | 숨김 |
| 내 할 일 | 노출 | 자기 담당만 노출 (동일 위젯) |
| 프로젝트 업무 조회 | 전체 | 전체 (가시성 공유, 담당자 표시 없음) |
| 검색 | 참여 프로젝트 전체 | 참여 채널만 |

---

### F5-17. 데이터 모델 (최종)

`DATABASE_ERD.md` 섹션 참조. 요약:

**신규 테이블 6 개**
- `projects` — 프로젝트 1급 개체
- `project_members` — 멤버 + 역할 매핑
- `project_clients` — 고객 참여자
- `project_notes` — 프로젝트 메모 (개인/내부)
- `project_issues` — 주요 이슈 수동 CRUD
- `task_candidates` — 업무 추출 후보 히스토리

**기존 테이블 확장**
- `conversations`: `+ project_id`, `+ channel_type`, `+ auto_extract_enabled`, `+ last_extracted_message_id`, `+ last_extracted_at`, `+ extraction_in_progress_at`
- `messages`: `+ reply_to_message_id`, `+ cue_draft_processing_by`, `+ cue_draft_processing_at`, FULLTEXT ngram 인덱스 `ft_body`
- `tasks`: `+ project_id`, `+ from_candidate_id`, `+ recurrence`, `status` ENUM 확장 (task_requested / task_re_requested / waiting / not_started / in_progress / review_requested / re_review_requested / customer_confirm / completed / canceled)
- `files`: `+ project_id`
- `invoices`: `+ project_id`

**엔진 재사용**
- Q Note `embedding_service.py`, FTS, `_llm_match_question`, 프롬프트 템플릿 그대로
- Phase 0 `cue_orchestrator.js` 확장 — task 추출 서비스 `task_extractor.js` 신설
- Phase 0 `kb_service.js` — 그대로 유지

---

### F5-18. 자동 업무 추출 — 결정론 우선 원칙

**AI 호출 경계**
- **AI 사용**: 자연어 메시지 → 구조화된 업무 후보 (title/description/role/due) 로 변환 (1회)
- **AI 사용 금지**: 저장된 후보 재조회, 상태 전환, 담당자 매핑(결정론), 마감일 검증, 유사도 계산, 히스토리 표시

**사용자 체감**: 한 번 추출한 결과는 LLM 을 다시 호출하지 않으므로 **재현 가능** — 같은 메시지에 대해 다른 결과가 나오지 않음. 거절했다가 다시 등록하는 것도 LLM 없이 DB에서 직접 가능.

---

### F5-19. 권한 매트릭스

`SECURITY_DESIGN.md` 권한 매트릭스 참조. 요약:

| 액션 | Admin (Owner) | Member | Client |
|---|:---:|:---:|:---:|
| 프로젝트 생성 | ✓ | ✓ | ✗ |
| 프로젝트 편집/멤버 변경 | ✓ | ✓ (자기 프로젝트) | ✗ |
| 고객 채널 메시지 | ✓ | ✓ | ✓ |
| 내부 채널 메시지/조회 | ✓ | ✓ | ✗ |
| 업무 추출 트리거 | ✓ | ✓ | ✗ |
| 업무 후보 처리 | ✓ | ✓ | ✗ |
| 내부 메모 | ✓ R/W | ✓ R/W | ✗ |
| 개인 메모 (본인) | ✓ R/W | ✓ R/W | ✓ R/W |
| 주요 이슈 CRUD | ✓ | ✓ | 읽기만 |
| Cue 답변 처리 | ✓ | ✓ | ✗ |
| 검색 | 워크스페이스 | 참여 프로젝트 | 참여 채널 |

---

### F5-20. 메시지에서 업무 전환 (기존 F5-8 유지)

| 전환 | 트리거 | 결과 |
|---|---|---|
| → 할일 | 메시지 우클릭 → "할일 만들기" | Task 생성 + 대화에 인라인 카드 삽입 |
| → 일정 | "일정 잡기" | Q Calendar 이벤트 생성 (Phase 8) |
| → 청구서 | "청구서 만들기" | Q Bill 초안 생성 |
| → 자료 | "자료실에 저장" | Q File 로 첨부 이동 |

---

### F5-21. 메시지 수정·삭제 (Phase 0 유지)

- **수정**: 작성자 본인만, `is_edited=true` + `edited_at` 기록, UI "(수정됨)"
- **삭제**: 마스킹 (`is_deleted=true`, content 유지), UI "삭제된 메시지"
- **AuditLog**: 원본 content 전체 기록

---

### F5-22. 파일 첨부 (데이터 모델 완결, UI 는 Phase 2)

| 항목 | 내용 |
|------|------|
| DB | `message_attachments` (기존 유지) + `+ project_id` FK |
| API | 업로드·삭제·목록 엔드포인트 완결 — UI 만 연기 |
| 제한 | Free 10MB / Basic 30MB / Pro 50MB per 파일 (기존 유지) |
| 허용 확장자 | 기존 유지 |

---

### F5-23. 빈 상태 / 에러 / 로딩

| 상황 | UI |
|---|---|
| 프로젝트 0개 | 중앙 일러스트 + "새 프로젝트를 만들어 시작하세요" + [+ 새 프로젝트] |
| 메시지 0개 | 채팅 영역에 "{채널명}에서 첫 메시지를 보내세요" |
| Cue 생각 중 | 회전 스피너 + "답변 찾는 중..." |
| 업무 후보 0 | 우측 탭 섹션 자체 숨김 |
| 연결 끊김 | 상단 노란 배너 "연결이 끊어졌습니다. 재접속 중..." |
| 락 잠김 (Cue) | 버튼 disabled + "xxx 가 처리 중 · N:NN 남음" |
| 권한 없음 | 중앙 "이 대화방에 접근할 수 없습니다" |
| 로딩 | 3단 스켈레톤 (Q Note 패턴 재사용) |

---

### F5-24. 성공 지표

Phase 5 완료 후 추적:
- **응답 속도**: 고객 메시지 → Cue 첫 응답까지 평균 < 3초
- **Cue 자동 응답률** (smart 모드): 전체 고객 질문의 ≥ 60% 가 Cue 단독으로 해결
- **자동 업무 추출 품질**: LLM 제안 → 사용자 승인률 ≥ 70%, 거절률 < 20%
- **담당자 자동 배정 정확도**: 추출된 후보의 자동 배정 담당자를 사용자가 수정 없이 등록하는 비율 ≥ 80%
- **출처 정확도**: Pinned FAQ / KB 출처 클릭 시 답변 내용과 섹션 일치율 ≥ 95%
- **Draft 승인률**: 사람 수정 없이 승인되는 비율 ≥ 50%
- **비용 효율**: 액션당 평균 비용 ≤ $0.0008
- **채팅 검색 응답 속도**: 평균 < 200ms (FULLTEXT ngram 기준)
- **우측 탭 로딩**: 프로젝트 진입 시 주요 이슈/내 할 일/메모 동시 로드 < 500ms


---

## Phase 6: Q Task (할일)

> **업무 네이밍 규칙**: F5-6b 참조. 모든 업무 제목은 결과물 기반 완료 시점 명확 형태 필수. "시장조사" X → "경쟁사 비교분석표 작성" O

### F6-1. 할일 목록 + 필터
| 항목 | 내용 |
|------|------|
| 화면 | /app/tasks |
| 필터 탭 | 오늘 / 이번주 / 전체 |
| 필터 드롭다운 | 상태별, 담당자별, 고객별 |
| 정렬 | 마감일 순 (지연 → 임박 → 여유) |

### F6-2. 할일 상태 변경
| 상태 | 전환 가능 | UI |
|------|----------|-----|
| pending (대기) | → in_progress, completed, canceled | ⬚ 회색 |
| in_progress (진행) | → completed, canceled, pending | 🟡 노랑 |
| completed (완료) | → pending (재오픈) | 🟢 녹색 |
| canceled (취소) | → pending (재오픈) | ⚫ 취소선 |

### F6-3. 마감 지연 표시
| 조건 | 표시 |
|------|------|
| 마감일 지남 + 미완료 | 🔴 빨간 뱃지 + "지연" |
| 마감일 오늘 | 🟠 주황 뱃지 + "오늘 마감" |
| 마감일 3일 내 | 🟡 노란 뱃지 |

### F6-4. 우측 할일 패널 (Q Talk 화면)
| 항목 | 내용 |
|------|------|
| 위치 | Q Talk 대화방 우측 |
| 내용 | 해당 고객의 할일만 표시 |
| 기능 | 상태 변경, 클릭 시 상세보기 |

### F6-5. 원문 메시지 링크
| 항목 | 내용 |
|------|------|
| 할일 → 메시지 | 할일 상세에서 "💬 원문 보기" 클릭 → 대화방 해당 메시지로 스크롤 |
| 메시지 → 할일 | 메시지의 🔗 뱃지 클릭 → 할일 상세 모달 |

---

## Phase 7: Q File (자료함)

### F7-1. 파일 업로드
| 항목 | 내용 |
|------|------|
| 화면 | /app/files |
| 방법 | 드래그 앤 드롭 또는 파일 선택 |
| 제한 | 파일당 50MB, 요금제별 총 용량 제한 |
| 메타데이터 | 고객 선택, 설명 입력 |

### F7-2. 고객별 자료 정리
| 항목 | 내용 |
|------|------|
| 구조 | 고객별 폴더 형태로 표시 |
| 검색 | 파일명, 설명 검색 |

---

## Phase 8: Q Note (실시간 회의 전사 + AI 분석)

> 회의 중 실시간 음성 전사(STT) + 번역 + 질문 감지 + 문서 기반 답변.
> 회의 후 요약 생성 + 질문 목록 + 답변 찾기.
> **2026-04-10 갱신:** 언어 3원 분리 (메인/번역/답변), 화자 식별 (사전 등록 + 사후 매칭), 회의 안내(brief) + 참여자 컨텍스트 주입, RAG 자료 우선, 다중 캡처 모드(마이크/탭)

### 모드 구조

```
Q Note
├── 회의 시작 모달 (StartMeetingModal)
│   ├── 회의 제목
│   ├── 회의 안내 (선택, 2000자) — AI 모든 호출 system prompt에 주입
│   ├── 참여자 (선택) — 이름 + 역할/메모, 그룹 표현 허용
│   ├── 회의 메인 언어 (필수, 1개+) — 멀티 셀렉트, 2개+ 자동 코드스위칭
│   ├── 답변 언어 (필수) — 메인 언어 중 선택, "답변 찾기" 결과 + 회의 발화 언어
│   ├── 번역 언어 (필수) — 모든 언어, 디폴트 사용자 모국어, 보조 표시용
│   ├── 참고 자료 (선택) — 파일(10MB×5개) + 텍스트(10만자) + URL(공개 페이지)
│   └── 캡처 방식 (필수) — 마이크 / 브라우저 탭
│
├── 라이브 모드 (회의 중)
│   ├── [녹음 시작] → 선택한 캡처 소스로 오디오 캡처 (PCM16 16kHz mono)
│   ├── 실시간 STT (Deepgram Nova-3 WebSocket, diarize=true)
│   ├── 화자별 자동 분리 (Speaker 1, 2, ...) — 익명, 회의 도중 매칭 모달 절대 금지
│   ├── 발화 언어 == 사용자 모국어이면 번역 생략
│   ├── 본인 발화 (is_self) 질문은 [답변 찾기] 표시 안 함
│   ├── 질문 감지 시 코랄 강조 + [답변 찾기] 버튼 (다른 사람 발화만)
│   ├── 클릭 → RAG 검색 (자료 우선) → 답변 언어로 답변 생성
│   ├── 사이드바 접기 가능 (미팅 풀스크린)
│   └── [녹음 종료] → 전체 기록 + 자료 + 화자 매칭 보존
│
└── 리뷰 모드 (회의 후)
    ├── 저장된 세션 목록 + 열람
    ├── 화자 매칭 (Speaker → 사전 등록 참여자) — 한 번 매칭하면 같은 speaker_id 자동
    ├── "나"로 매칭 시 본인 질문 제외 규칙 소급 적용
    ├── 요약 생성 (핵심 bullet + 전체 요약)
    ├── 질문 목록 + [답변 찾기]
    └── 직접 질문 입력 + [답변 찾기]
```

### 언어 3원 분리

| 설정 | 의미 | 옵션 | 디폴트 |
|------|------|------|--------|
| 회의 메인 언어 | STT가 인식할 언어 | 멀티 셀렉트, 2개+면 코드스위칭 | (빈 상태 — 사용자 선택 강제) |
| 답변 언어 | 답변 찾기 결과 + 회의에서 말할 언어 | 메인 언어 중 선택 | 메인 언어 첫 번째 |
| 번역 언어 | 사용자 보조 번역 표시용 | 모든 언어 자유 선택 | 사용자 모국어 (프로필) |

### 화자 식별 (사전 등록 + 사후 매칭)

- 회의 시작 전: 참여자 자유 입력 (개별 + 그룹), "내 목소리 등록" 선택
- 회의 도중: Deepgram diarize → speaker_id 자동, 익명 표시, **모달 절대 금지**
- 사후 매칭: 화자 카드 클릭 → 사전 등록 참여자에서 선택, 한 번 매칭 = 자동 적용
- "나"로 매칭하면 isSelf=true → 본인 질문 제외 규칙 소급
- 음성 핑거프린트 등록 시 첫 발화 자동 매칭

### 답변 찾기 RAG 우선순위

1. 사전 업로드 자료 (PDF/DOCX/TXT/MD) → 청크 검색
2. 텍스트 직접 입력 자료
3. URL fetch 자료 (공개 페이지만, SSRF 방어)
4. 회의 안내 (brief) + 회의 트랜스크립트
5. AI 일반 지식 (마지막, "참고 자료 없음" 명시)

답변에 출처 표시 필수.

### 자료 한계

| 항목 | 한계 |
|------|------|
| 파일당 크기 | 10 MB |
| 회의당 파일 수 | 5개 |
| 파일 형식 | PDF, DOCX, TXT, MD (텍스트 PDF만, 스캔본 ❌) |
| 텍스트 직접 입력 | 100,000자 |
| URL 응답 크기 | 10 MB |
| URL 페이지 | 공개만 (Phase 1), Notion 공개·블로그·뉴스 OK / 비공개 ❌ |
| 회의당 합계 추출 글자 | 약 200,000자 |

---

### F8-1. 라이브 모드 — 실시간 STT

| 항목 | 내용 |
|------|------|
| 시작 | [녹음 시작] 버튼 클릭 |
| 오디오 캡처 | 브라우저 `getUserMedia` (마이크) |
| STT 엔진 | Deepgram Nova-3, WebSocket 스트리밍 |
| 언어 | `language="multi"` (한국어+영어 코드스위칭 자동 감지) |
| 지연시간 | 300ms 이하 (Deepgram 공식) |
| 연결 구조 | 브라우저 → FastAPI WebSocket 프록시 → Deepgram |
| 표시 | interim(중간) 결과: 원어 실시간 표시, final(확정) 결과: 번역 추가 |
| 종료 | [녹음 종료] → 전체 전사 기록을 세션으로 저장 |

**화면 구성:**
```
┌──────────────────────────────────────┐
│ LIVE                       [녹음 중]  │
│                                      │
│ 14:30:01                             │
│ The deadline should be moved to June │
│ 마감일을 6월로 옮겨야 합니다            │
│                                      │
│ 14:30:08                             │
│ 네 알겠습니다 확인해보겠습니다           │
│ Yes, I understand. I'll check.       │
│                                      │
│ 14:30:15                             │
│ What's the budget for this phase?    │
│ 이 단계의 예산이 얼마인가요?            │
│                        [답변 찾기 ->] │
│                                      │
└──────────────────────────────────────┘
```

**시스템 오디오 (2차 고도화):**
- 1차: 마이크만 캡처 (회의실 환경에서 상대방 목소리도 마이크에 잡힘)
- 2차: `getDisplayMedia`로 시스템 오디오 캡처 (Chrome/Edge 전용, 화면공유 동의 필요)

---

### F8-2. 라이브 모드 — 실시간 번역 + 질문 감지

| 항목 | 내용 |
|------|------|
| 트리거 | Deepgram final result (문장 확정) 수신 시 |
| LLM | GPT-4o-mini (속도 우선) |
| 처리 | **한 번의 API 호출**로 번역 + 질문 판별 동시 수행 |
| 번역 방향 | 원어가 영어 → 한국어 번역, 원어가 한국어 → 영어 번역 |
| 질문 감지 | 의문문, 요청형, 확인 요구 등 → `is_question: true` |
| 질문 표시 | 해당 문장 옆에 [답변 찾기 ->] 버튼 표시 |

**API 응답 형태:**
```json
{
  "translation": "이 단계의 예산이 얼마인가요?",
  "source_language": "en",
  "is_question": true,
  "question_text": "What's the budget for this phase?"
}
```

**비용 제어:**
- interim 결과는 번역 호출 안 함 (원어만 표시)
- final 결과만 GPT-4o-mini 호출 → 호출 횟수 최소화

---

### F8-3. 문서 기반 답변 (답변 찾기)

| 항목 | 내용 |
|------|------|
| 트리거 | [답변 찾기] 버튼 클릭 또는 리뷰 모드에서 직접 질문 입력 |
| 사전 작업 | 비즈니스별 문서 업로드 (PDF, DOCX, TXT 등) |
| 검색 | SQLite FTS5 전문 검색 (1차), 벡터 DB (2차 고도화) |
| 답변 생성 | 관련 문서 청크 + 질문 → GPT-4o-mini → 답변 |
| 출력 | 짧은 답변 + 근거 문서 표시 |

**문서 관리:**
| 항목 | 내용 |
|------|------|
| 업로드 | 비즈니스별 문서 업로드 (PDF, DOCX, TXT) |
| 처리 | 텍스트 추출 → 청크 분할 (500자) → SQLite FTS5 인덱싱 |
| 저장 | `/opt/planq/q-note/uploads/{business_id}/` |
| 격리 | 비즈니스별 문서 완전 분리 (멀티테넌트) |

---

### F8-4. 리뷰 모드 — 세션 열람 + 요약

| 항목 | 내용 |
|------|------|
| 세션 목록 | 날짜, 제목(수정 가능), 길이, 문장 수 표시 |
| 전체 기록 | 타임스탬프 + 원어 + 번역 스크롤 뷰 |
| 요약 생성 | [요약 생성] 버튼 → GPT-4o-mini → 핵심 bullet + 전체 요약 |
| 질문 목록 | 세션 내 감지된 질문 모아보기 + [답변 찾기] |
| 직접 질문 | 텍스트 입력 → 세션 내용 + 문서 기반 답변 생성 |

---

### F8-5. 결과 연동 (2차)

| 기능 | 설명 |
|------|------|
| 할일로 전환 | 요약 항목 → Q Task 할일 생성 |
| Q Talk 공유 | 요약/질문 결과를 대화방에 메시지로 전송 |

---

### 기술 스택 + 아키텍처

**STT 엔진: Deepgram**
| 항목 | 값 |
|------|-----|
| 모델 | Nova-3 |
| 방식 | WebSocket 실시간 스트리밍 |
| 한국어+영어 | `language="multi"` 코드스위칭 |
| 지연 | 300ms 이하 |
| 비용 | $0.0077/분 (스트리밍) |

**LLM: GPT-4o-mini**
| 항목 | 값 |
|------|-----|
| 용도 | 번역, 질문 감지, 요약, 답변 생성 |
| 교체 | `LLM_PROVIDER` env로 교체 가능 구조 |
| 비용 | ~$0.15/1M input tokens |

**데이터 저장: SQLite**
| 항목 | 값 |
|------|-----|
| 세션 기록 | sessions, utterances 테이블 |
| 문서 인덱스 | documents, document_chunks 테이블 (FTS5) |
| 요약/질문 | summaries, detected_questions 테이블 |
| 파일 위치 | `/opt/planq/q-note/data/qnote.db` |

**데이터 흐름:**
```
[브라우저]                    [FastAPI]                [외부 서비스]
마이크 캡처                        |                        |
    |-- WebSocket (오디오) ------->|                        |
    |                              |-- WebSocket ---------->| Deepgram
    |                              |<-- transcript ---------|
    |                              |                        |
    |                              |-- REST --------------->| GPT-4o-mini
    |                              |<-- 번역+질문감지 ------|
    |                              |                        |
    |<-- WebSocket (결과) ---------|                        |
    |   { original, translation,   |                        |
    |     is_question, timestamp } |                        |
```

**인증:**
- PlanQ 백엔드와 JWT SECRET_KEY 공유
- WebSocket 연결 시 토큰 검증
- 비즈니스별 데이터 격리

**비용 예측 (월 20시간 회의 기준):**
| 항목 | 비용 |
|------|------|
| Deepgram STT | ~$9 |
| GPT-4o-mini (번역+질문감지) | ~$3 |
| GPT-4o-mini (요약+답변) | ~$2 |
| **합계** | **~$14/월** |

---

## Phase 9: 알림 시스템

### 인앱 알림
| 이벤트 | 수신자 |
|--------|--------|
| 새 메시지 | 대화 참여자 |
| 할일 배정 | 담당자 |
| 마감 임박 (D-1) | 담당자 |
| 마감 지연 | 담당자 + Owner |
| 청구서 발송됨 | 고객 |
| 입금 확인됨 | 작성자 |

### 이메일 알림
| 이벤트 | 수신자 |
|--------|--------|
| 멤버/고객 초대 | 초대 대상 |
| 마감 임박 (D-1) | 담당자 |
| 청구서 | 고객 |

---

## Phase 10: 구독 관리 (SaaS 확장)

### 요금제
| 항목 | Free | Basic | Pro |
|------|------|-------|-----|
| 월 요금 | 0원 | ₩99,000 | ₩149,000 |
| 고객 수 | 5명 | 30명 | 무제한 |
| 담당자 수 | 2명 | 5명 | 무제한 |
| 저장공간 | 500MB | 2GB | 10GB |
| 파일당 용량 | 10MB | 30MB | 50MB |
| Q Note | 월 5회 | 월 30회 | 무제한 |
| 감사 로그 보관 | 30일 | 90일 | 1년 |

### 미납 처리 흐름
```
결제일 → 실패 → 7일 유예 (정상 사용)
              → 8일~14일 (읽기 전용)
              → 15일+ (접근 차단, 데이터 30일 보존)
              → 45일+ (데이터 삭제)
```
