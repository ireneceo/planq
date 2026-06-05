# Q Mail 맥락 지능 + 고객 통합 설계 (QMAIL_CONTEXT_DESIGN)

> 작성: 2026-06-05 (사이클 N+87 기획) · 상태: **설계 확정 대기 → Phase A 착수 예정**
> 한 줄: **메일을 Q Talk처럼 "맥락 있는 대화"로 끌어올리고, 채팅·메일·업무·청구를 한 고객 밑으로 통합한다.**

---

## 1. 핵심 원칙 2가지

### 원칙 ① "메일 스레드 = 대화"
Q Talk의 맥락 자산(업무후보·이슈·노트)은 전부 `conversation_id` OR `project_id` 스코프로 붙는다 (독립 대화도 1급 시민 — `project_qtalk_conversation_scope`). **메일 스레드도 동일한 대화 단위**다.
→ 기존 맥락 테이블에 **`email_thread_id`를 3번째 스코프**로 추가한다. 메일 전용 테이블을 새로 만들지 않는다.

### 원칙 ② "고객(Client) = 허브"
업무를 보는 우리 입장에선 채팅 고객과 메일 고객이 **같은 사람**이다. 채팅방·메일 스레드를 **직접 연결하지 않는다**(N:N 매핑 지옥). 둘 다 이미 가진 `client_id`(+`project_id`)로 **자동으로 같은 고객 아래 묶는다.**
- 메일: 수신 시 발신주소로 `client_id` **자동 매칭이 이미 작동**(`emailImapCron.js`).
- 채팅: 고객이 `client_id`로 연결.
→ 별도 링크 없이 "같은 고객"으로 cross-channel 표시·집계가 성립한다. 채팅방에 고객이 여럿이면 고객별로, 고객이 여러 프로젝트면 프로젝트로 필터 — 매핑이 엉키지 않는다.

---

## 2. 아키텍처 결정 (확정)

| # | 결정 | 선택 | 이유 |
|---|------|------|------|
| D1 | AI 추출/요약 트리거 | **on-demand 버튼 기본** (자동 X) | `feedback_ai_minimal_usage` · 비용 예측 · 노이즈 0. 운영 데이터 확인 후 reply_needed 메일 자동 검토 |
| D2 | 맥락 자산 저장 | **기존 테이블 통합** (`email_thread_id` 추가) | 메일 업무가 채팅 업무와 같은 Q Task에 모임 = "같이 파악"의 전제 |
| D3 | 채팅↔메일 연결 | **client_id 허브** (직접 링크 X) | 멀티프로젝트·멀티고객 안전. 양방향 자동 |
| D4 | 단계 | A(연결+패널+**고객 타임라인**) → B(업무추출) → C(요약·이슈·노트) | 고객 통합 타임라인을 Phase A로 당김 (차별화 무기 선행) |

> 예외(D3): 특정 메일을 특정 프로젝트 채팅 맥락에 **명시적으로** 꽂고 싶을 때만 수동 "이 메일 채팅방에 연결" 액션. 자동=고객 기준, 수동=예외용.

---

## 3. 데이터 모델 변경

### 3.1 기존 테이블에 email_thread_id 스코프 추가 (sync 자동)
```
task_candidates   + email_thread_id INT NULL,  + source_email_message_ids JSON NULL
                    conversation_id → NULL 허용 (이미 그런 경우 처리됨)
project_issues    + email_thread_id INT NULL
project_notes     + email_thread_id INT NULL
```
- 스코프 헬퍼 3원화: `project_id OR conversation_id OR email_thread_id`
- index: `(business_id, email_thread_id)` 각 테이블

### 3.2 EmailThread (요약 등 thread 레벨 맥락)
```
email_threads     + ai_summary TEXT NULL
                  + ai_summary_at DATE NULL
                  + ai_summary_model VARCHAR(50) NULL
```
- `client_id` / `project_id` / `labels` / `triage` / `reply_needed` / assignee(participant) — **이미 존재**, 재사용

### 3.3 좀비 필드 정리
`EmailMessage.ai_intent / ai_summary / ai_processed_at` (미사용 골격) → **개별 메시지 요약 안 함, thread 레벨로 통일.** 향후 마이그레이션에서 제거 또는 용도 재정의.

---

## 4. 기능별 설계 (Q Talk 재사용 맵)

| 기능 | 재사용 원천 | Q Mail 구현 | 재사용률 |
|------|-----------|-------------|:----:|
| **업무 추출** ★ | `services/task_extractor.js` (JSON모드·gpt-4o-mini·보수적 규칙·register/merge/reject·`candidates:created` broadcast) | `extractEmailTaskCandidates({emailThreadId})` — 같은 파이프라인, 프롬프트만 "메일 actionable vs FYI"로 보강. `task_candidates.email_thread_id` + `source_email_message_ids`. 담당자 추론: From/CC/명시 멘션 | 90% |
| **이슈** | `models/ProjectIssue.js` + routes (수동 등록) | 동일 테이블 `email_thread_id` 스코프. 메일 상세 "이슈로 등록" | 95% |
| **노트** | `models/ProjectNote.js` (visibility L1~L4) | 동일 테이블 `email_thread_id` 스코프 | 95% |
| **요약** | (Q Talk도 미구현 — net new) | `summarizeThread()` 신규: `cue_orchestrator.callLLM` + usage 트래킹 재사용. on-demand. 긴 스레드 접기 UI | LLM 인프라 |
| **프로젝트·고객 연결** | `EmailThread.client_id/project_id` 컬럼 + inbound 자동매칭 | (a) 연결 UI picker (b) AI/규칙 추천 (참여자·본문) | 컬럼 기존 |
| **KB / RAG** | `kb_service.hybridSearch(biz, q, {client_id, project_id, category})` | 추출·요약 시 thread 본문으로 RAG. FAQ 주입은 이미 `generateEmailReplyDraft` 사용 중 | 100% |
| **Cue 컨텍스트** | `services/cue_context.js buildCueContext` (고객 360° 골격) | 메일·채팅 양쪽 히스토리 합치도록 확장 (§6) | 확장 |
| **우측 맥락 패널** | `pages/QTalk/RightPanel.tsx` (CandidateEditCard·섹션 자동펼침·socket 리스너) | net-new UI, 패턴 이식 (§7) | UI 패턴 |

### 업무 추출 프롬프트 보강 (메일 특화)
- **추출 O:** 명시적 요청·약속·결정 ("~보내주세요", "금요일까지 회신드리겠습니다")
- **추출 X:** 단순 FYI·뉴스레터·자동알림(triage로 이미 분리됨) — automated/marketing triage 스레드는 추출 버튼 자체 숨김
- 담당자: 발신자 자신 약속 → 발신자 매칭 / 우리에게 요청 → 담당자 null(사용자 지정) / CC·명시 멘션 활용
- 마감일: EXPLICIT만 (`feedback_task_naming` 결과물 기반 제목 규칙 동일 적용)

---

## 5. 고객 통합 — Cross-channel (★ Phase A 핵심)

### 5.1 양방향 표시 (client_id 조인, 자동)
- **채팅방 우측 패널** → "이 고객의 최근 메일" 섹션: `conversation.client_id`로 `email_threads` 조회 (status 무관, 최근순 cap)
- **메일 우측 패널** → "이 고객과의 채팅·관련 업무" 섹션: `email_thread.client_id`로 `conversations` 조회
- 채팅방에 고객 여럿 → 고객별 그룹. 고객이 여러 프로젝트 → 프로젝트 칩으로 필터.

### 5.2 고객 통합 타임라인 (Customer 360) — Phase A 신규 페이지
고객 1명 클릭 → 채널 무관 시간순 한 화면:
```
[홍길동 / ABC회사]                          [필터: 전체 채널 ▾ | 프로젝트 ▾]
 ─────────────────────────────────────────
 💬 채팅   "견적서 확인했습니다"               6/4 14:20
 📧 메일   계약서 회신 (Re: 계약서)            6/3 18:05
 ✅ 업무   계약서 검토 — 메일에서 추출 · 진행중  6/3
 💰 청구   INV-2026-0042 발행 · 미결제         6/1
 📧 메일   미팅 일정 문의                      5/30
 ...
```
- 데이터 소스: messages(채팅) + email_messages + tasks + invoices + files + notes, `client_id` 기준 merge → 시간순
- 진입점: 고객 목록(ClientsPage) 드로어 "타임라인 보기", 메일/채팅 우측 패널의 고객 칩, 대시보드
- 권한: 멤버(워크스페이스 격리) · client 역할은 본인 데이터만(§8)

### 5.3 통합 맥락이 AI에 반영
`buildCueContext`를 확장해 메일 추출·요약 시 그 고객의 **채팅·메일·청구 히스토리**를 함께 근거로 주입. → "메일 업무 뽑을 때 그 고객의 전체 맥락을 본다."

---

## 6. AI · 비용 정책 (`feedback_ai_minimal_usage`)
- 추출·요약 = **버튼 기본**. automated/marketing/spam triage 스레드는 분석 버튼 숨김(human/open만)
- 연결 추천은 **규칙·임베딩 우선**, LLM 최소
- 모든 LLM 호출 = Cue 월 한도 카운터 공유 (`recordUsage`)
- cross-channel 표시·타임라인은 **LLM 0** (단순 client_id 조회·merge)

---

## 7. UI 설계

### 7.1 메일 우측 컨텍스트 패널 (신규 — 현재 메일 상세는 메시지+답장만)
```
[메일 스레드]              [우측 맥락 패널 — ⌘/ 토글]
 메시지 타임라인           📄 요약 (AI, 접기)
                          ✅ 업무 후보 (N) — 편집카드(담당·마감)
 [답장 컴포저]             ⚠️ 이슈 / 📝 노트
 [✨ AI 답변]              🔗 연결: 프로젝트 · 고객 (picker + 추천)
                          👤 이 고객의 채팅·관련 업무 (cross-channel)
                          [🧠 이 스레드 분석]
```
`RightPanel.tsx`의 CandidateEditCard·섹션 자동펼침·socket 리스너 패턴 이식.

### 7.2 고객 통합 타임라인 페이지 (§5.2)

---

## 8. 권한 · Visibility · 멀티테넌트
- 모든 신규 쿼리 `WHERE business_id = ?` 강제 (Sequelize 수동)
- 메일 개인 격리(`accessibleAccountIds`)는 cross-channel·타임라인에도 적용 — 남의 개인메일 노출 X

---

## 8.5 고객 공개 범위 (Client Visibility) — ★ 핵심 안전장치

> 예민한 내부 데이터(공수·원가·내부 소통)가 고객에게 새지 않게 명쾌히 분리. 신뢰 사고 0순위.

### 3겹 분리
| 겹 | 질문 | 기존/신규 |
|----|------|-----------|
| **1. 접근(메뉴)** | 고객이 이 메뉴를 보나? | 기존 — Client 권한 매트릭스 (Q Mail·Q Note·KB·Insights 차단, 자기 대화·공유파일·자기업무·자기청구만) |
| **2. 엔티티 공유** | 이 업무/파일/노트를 고객과 공유했나? | 기존 — Visibility L1~L4 (L4=외부) |
| **3. 필드 투영** | 공유한 엔티티 *안에서* 어떤 필드까지? | **신규 — 본 설계** |

### 원칙: "고객 뷰 = 화이트리스트" (safe-by-default)
내부 serializer에서 몇 개 빼는 blacklist 금지. **고객에게 보여줄 필드만 명시적으로 추리는 전용 serializer** `serializeTaskForClient()` / `serializeNoteForClient()` 등. → 새 내부 필드가 추가돼도 고객에게 자동 노출 안 됨.

### 업무(Task) 필드 매트릭스 — 3구역
| 필드 | 고객 노출 | 비고 |
|------|:----:|------|
| 제목 · 카테고리 · 의뢰 명세(description) | ✅ 항상 | 고객이 의뢰한 내용 |
| 상태(고객 관점 라벨 `taskLabel.ts`) · 마감일 | ✅ 항상 | |
| 결과물(body) — 완료/전달 시 | ✅ 항상 | |
| 공유 첨부 · 공유 댓글(visibility=shared) | ✅ 항상 | |
| **진행률 % · 담당자 이름 · 완료일** | ⚙️ 워크스페이스 토글, **기본 OFF** | 중간지대 — 안전하나 선택 |
| 🔒 **예측시간 · 실제시간 · 시간 이력 · AI 추정** | ❌ **절대(설정 불가)** | 공수/원가 = 단가 리스크 |
| 🔒 **내부 댓글(personal/internal) · 리뷰어 내부 메모** | ❌ **절대(설정 불가)** | 관계 리스크 |

→ 안전 코어(항상) + 🔒 하드 차단 코어(설정조차 불가) + 작은 중간지대(토글). 예민한 건 코드 레벨 차단이라 실수로 켤 수 없음.

### 댓글 — 기존 visibility + UI 명확화
`task_comments`는 이미 `personal/internal/shared`. 추가: 작성창에 명확한 시각 토글 "🔒 내부만 / 👥 고객에게 보임", **기본 내부만** (`feedback_visibility_signal_required`).

### 통합 타임라인 — **내부 전용 (확정)**
Customer 360 통합 타임라인은 **운영자용**. 고객 노출 X. 고객은 자기 공유 표면(공유 업무·자기 대화·공유 파일·자기 청구)을 각각 보며 위 필드 투영 적용. (후속: 필요 시 별도 "고객 포털 타임라인"을 고객 투영만으로 신설 가능 — 1차 범위 외.)

### 설정 위치
- **워크스페이스 설정 > 고객 공개 범위**: 토글 3개(`client_show_progress` / `client_show_assignee` / `client_show_completed_date`) — businesses 컬럼 3개, **기본 false**
- **건별**: 댓글·노트 visibility 선택자(기본 내부)

### 데이터 모델 추가 (8.5)
```
businesses + client_show_progress       BOOLEAN DEFAULT false
           + client_show_assignee       BOOLEAN DEFAULT false
           + client_show_completed_date BOOLEAN DEFAULT false
```

---

## 9. 실시간 (CLAUDE.md §16)
- broadcast 재사용: `mail:updated` + 신규 `email_candidate:created` / `email_thread:analyzed`
- 우측 패널 socket 리스너 + `useVisibilityRefresh` 안전망
- 타임라인: 채팅(`message:new`)·메일(`mail:new`)·업무(`task:new`) 이벤트 구독해 즉시 갱신

---

## 10. 단계 계획

### Phase A — 연결 + 패널 골격 + **고객 통합 타임라인** (저비용, AI 최소)
1. 메일 상세 우측 컨텍스트 패널 셸 (⌘/ 토글)
2. 프로젝트/고객 **연결 UI**(picker) + 규칙 기반 추천(참여자·본문)
3. **Cross-channel 양방향 표시** (채팅↔메일, client_id 조인)
4. **고객 통합 타임라인 페이지** (Customer 360) — messages+email+tasks+invoices merge
- DB: EmailThread 기존 컬럼 활용. 신규 스키마 최소(없거나 index만)

### Phase B — 업무 추출 ★ (검증된 파이프라인 재사용)
1. `task_candidates.email_thread_id` + `source_email_message_ids` (sync)
2. `extractEmailTaskCandidates()` (task_extractor 분기) + "이 스레드에서 업무 추출" 버튼
3. 편집카드 → 확정 → Q Task (채널 통합) + `email_candidate:created` broadcast

### Phase C — 요약 + 이슈 + 노트
1. `summarizeThread()` + `email_threads.ai_summary*`
2. `project_issues`/`project_notes`에 `email_thread_id` 스코프 + 메일 패널 섹션

---

## 11. 검증 기준 (각 Phase)
- 헬스 29/29 · 빌드 EXIT 0 · API 실호출 E2E · 멀티테넌트 cross-biz 403
- cross-channel: 2 고객/2 프로젝트 섞인 상태에서 매핑 정확성
- 업무추출: 메일→후보→확정→Q Task 노출 + 채팅 추출과 같은 리스트
- 타임라인: 채널·프로젝트 필터 정확 + client 역할 격리
- i18n ko/en · AI 비용(usage 카운터) 정상

---

## 12. 참조 (재사용 코드)
- `services/task_extractor.js` · `models/TaskCandidate.js` · `models/ProjectIssue.js` · `models/ProjectNote.js`
- `models/Conversation.js` · `models/EmailThread.js` · `routes/email_threads.js`
- `services/cue_context.js`(buildCueContext) · `services/cue_orchestrator.js`(callLLM·generateEmailReplyDraft) · `services/kb_service.js`(hybridSearch)
- `pages/QTalk/RightPanel.tsx` · `pages/QMail/MailPage.tsx` · `pages/Clients/ClientsPage.tsx`
- memory: `project_qtalk_conversation_scope` · `project_cue_teammate` · `feedback_ai_minimal_usage` · `project_client_permission_matrix` · `project_kb_engine_reuse`
