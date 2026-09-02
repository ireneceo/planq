# Q sale — 영업·상담 통합 설계 (운영 피드백 #381 · #382)

> 작성: 2026-09-02 · **개정 v2 2026-09-02** (Irene 결정 3건 반영 + 추가 요구 5건 + 횡단 작업 12항목) · **Fable 설계 게이트 산출물**
> (신규 시스템 + 고객 데이터 모델 확장 + Q Note 경계 + 메뉴 권한 확장 = 고위험)
> 상태: **설계 v2 — Irene 승인 대기** (하단 §15 결정 3건). 구현·마이그레이션 실행 전.
> 근거 코드는 전부 실제로 열어 확인했다. `파일:줄` 표기. 확인 못 한 것은 `[미확인]`.
> 한 줄: **영업은 새 시스템이 아니다. 이미 있는 고객(clients)·타임라인·게스트 링크·Q mail·Q Note·거래 시퀀스·서명 위에 "단계 · 상담 원장 · 다음 행동 · 히스토리 요약" 네 겹을 얹는다.**

---

## 0. Irene 원문 (요약하지 않는다)

**#381 (2026-08-23)**
> 채팅을 게스트도 사용 가능해서 대화하게 하는 걸 물어봤어. 이메일은 게스트단위하고도 당연히 소통되니까 두고. 전화도 있어. 게스트 기준은 영업단계의 고객으로 보면 되거든. 영업/상담 과정에 탁월한 과정을 만들고 싶어.
> 게스트가 저장이 되고 고객처럼 정리되고 게스트나 고객이 프로필 정보에 상담 및 영업 정보가 추가되는 거야. 날짜 단위로 DB처럼. 그리고 모든 게스트나 고객단위의 내용이 저장되는 거야. 상담/영업 히스토리부터 대응해야 하는 다음 작업 그리고 업무추출부터.
> 채팅, 메일, 전화에서 정보들을 모아서 표시되고 자동리스트업 되고 담당자가 확인했는지 자동으로 불러진 내용인지 표시를 하는거지. 이걸 Q sale 이라고 할까? Q mail 아래에 넣어서 탁월한 구조를 만드는 거야.
> 이 고객이 프로젝트에 추가되면 히스토리에 고객 히스토리가 포함이 되서 표시되고. 그리고 팔라잉해야 할 일 알려주고 계약성사율을 높이기 위해 필요한 기능, 그리고 계약 진행 누르면 계약서와 서명 등 연결되게 하고 프로젝트 생성 필요하면 생성 연결하는 것도 추가해주고.
> fable 이 정말 성과있는 영업이 되게 고객만족부터, 고객대응을 체계적으로 전문가로 파악하고 우리 기능에 추가해줘.

**#382 (2026-08-23)**
> Q sale 추가하는 내용에 전화상담한 녹음파일을 추가하게 해줘. 추가하면 고객과 소통한 정보를 정리해서 Q note에 다 정리해서 넣고 파일도 저장시키고, 상담내용 요약되는 거 연결되게 하고 업무추출되게 하고 이미 Q note에 있는 기능과 불편하지 않게 한번에 점핑하듯이 되고 동기화되고 서로 다 알기 편하게 할 방법이 필요해.

**추가 지시 (2026-09-02, v1 검토 후)**
> Q sale은 업무들과 체계적으로 연동되고 다음으로 넘겨서 Q task나 Q project Q calendar 등 제대로 고객응대에 필요한 것들 총집합 해서 히스토리 제대로 구성해야 해.
> 그리고 여기에 저장되는 고객이 게스트로 정보만 넣은 것과 로그인한 상태의 고객의 경우 제대로 초대한거니까 분리가 되어야 해.
> 이 메뉴 고객에게는 안보이는거고.
> 그리고 AI 활용가능한 포인트 잘 살려서 Q mail처럼 일 수월하게(답장, 업무추출 등 편함) 검토하고.
> 그리고 히스토리 요약 특히 중요해.

> **"리드가 뭐야? 뭘 리드하는데?"** — 화면에 영어 은어(리드·파이프라인)를 쓰지 않는다. 단계마다 **한국어 이름 + 한 줄 기준**.
> **한도**: "주요이슈 아니면 권고대로 하고 **안내나 기준을 제대로 알게 UI/UX 구성**" — 정식 고객만 한도에 세고, 그 기준이 화면에서 바로 보여야 한다.

### 0.1 v1 → v2 에서 바뀐 것

| 항목 | v1 | v2 |
|---|---|---|
| 단계 코드·이름 | `lead` "리드", "파이프라인 바" | **`inquiry` "문의"**, "단계 요약 바". 모든 단계에 한 줄 기준 문구가 붙는다 (§1.2 · §5.6) |
| 플랜 한도 | 질문으로 남김 | **정식 고객(초대·활성)만 한도에 센다. 문의 고객은 별도 상한.** 기준이 4곳 화면에 보인다 (§3.6) |
| 통화 원문 공유 | 질문으로 남김 | **기본 ON, 업로드 화면에서 끄기 가능** (§7.2) |
| 메뉴 위치 | 질문으로 남김 | **Q mail 바로 아래 독립 메뉴** (§5.1) |
| 게스트 vs 정식 고객 | 언급만 | **접근 종류 3분류를 서버 한 함수로 파생, 배지·필터·승격 동선** (§4) |
| 업무 이관 | 프로젝트만 | **Q task · Q project · Q calendar · Q docs · Q bill 5갈래 이관 + 되돌아오는 경로 표** (§6) |
| AI | 지점 표 | **Q mail 부품 그대로 재사용 지점 + 쓰지 말 곳** (§9) |
| 히스토리 요약 | 한 줄 | **전용 절 — 입력·시점·저장·stale·비용·원문 내려가기** (§10) |
| 횡단 작업 | 없음 | **12항목 전수, 파일:줄, 1차/미룸** (§12) |

---

## 1. 업무 설계 — 영업이 실제로 어떻게 흐르는가

### 1.1 PlanQ 고객(대행·에이전시·컨설팅)의 영업은 "관계형 소량 영업"이다

`docs/design/B2B_AGENCY_FIT_REVIEW.md` 가 이미 진단한 대로, 이 타깃은 월 수십 건의 문의를 받아 그중 몇 건을 계약하는 구조다. 대량 콜드콜·점수 매기기·광고 귀속 같은 대기업 CRM 기능은 **필요 없다**. 이 규모에서 성사율을 결정하는 것은 다음 넷이고, 넷 다 "도구가 사람을 잊지 않게 하는가"의 문제다.

| # | 성사율을 움직이는 기제 | 근거 | PlanQ 에서의 구현(이 설계) |
|---|---|---|---|
| ① | **첫 응답 속도** — 문의 뒤 첫 응답이 시간 단위에서 분 단위로 짧아질수록 상담으로 이어질 확률이 급격히 오른다 (Oldroyd et al., HBR 2011 "The Short Life of Online Sales Leads" — 1시간 안 응답 시 약 7배 보고) | 문의는 대부분 **여러 업체에 동시에** 간다. 먼저 답한 쪽이 대화의 기준을 정한다 | 게스트 첫 메시지·미매칭 인바운드 메일·전화 문의가 **"답 안 한 문의"** 한 줄에 경과시간과 함께 모인다 (§4.3). 이미 있는 `reply_needed`(EmailThread.js:26)·unread 를 그대로 쓴다 |
| ② | **후속 끊김 방지** — 계약은 한 번의 접촉으로 닫히지 않는데, 사람은 두 번째 접촉 뒤에 잊는다 | "답 없으면 그냥 멈춤"(#384 원문) 이 이미 운영 호소로 들어왔다 | **"다음 할 일 없음 = 빨간 상태"** 를 목록 1급 컬럼으로. 메일 응답 없음은 이미 있는 `mailFollowUp.js` 판정을 **같은 함수로** 읽는다(§4.4). 단계별 정체 일수 배지 |
| ③ | **단계에 객관적 기준이 있는가** — "협상 중"이 사람 느낌이면 단계판은 거짓이 된다 | 단계 정의가 주관적이면 보고서도 예측도 무의미 | 제안·협상·성사는 **산출물 존재로 자동 판정**: 견적 post 발행 → 제안, 계약 post·서명 요청 → 협상, 양사 서명 완료 → 성사. 이미 `projectStageEngine.js:134-291` 이 같은 판정을 한다 — Q sale 은 그 결과를 **읽어** 고객 단계로 옮긴다(§6.3). 사람은 문의→상담과 종결만 손으로 바꾼다 |
| ④ | **맥락이 한 곳에 있는가** — 채팅에서 한 말을 메일에서 되묻는 순간 고객은 "관리 안 되는 곳" 이라고 느낀다 (고객만족 = 반복 설명 0) | Irene: "채팅, 메일, 전화에서 정보들을 모아서" · "히스토리 요약 특히 중요" | 고객 타임라인은 **이미 있다**(`services/clientTimeline.js`, chat·email·task·invoice 4채널). 전화·미팅·단계·일정·프로젝트 채널을 **같은 함수에** 추가하고(§4.1), 그 위에 **히스토리 요약**(§10)을 얹는다 |

### 1.2 단계 정의 — 화면 이름 + 한 줄 기준 (영어 은어 금지)

DB 코드도 은어를 피한다(`lead` 대신 `inquiry`). 화면에는 **이름과 그 옆의 한 줄 기준**이 항상 같이 다닌다 — 규칙을 설명하는 안내문이 아니라 상태 자체가 기준을 말한다(memory `feedback_rules_must_be_explained_briefly`).

| 코드 | ko 이름 | ko 한 줄 기준 | en 이름 | en 한 줄 기준 | 다음 단계로 가는 조건 | 누가 바꾸나 |
|---|---|---|---|---|---|---|
| `inquiry` | **문의** | 연락은 왔지만 아직 상담 전 | Inquiry | Contacted, not yet consulted | 통화·미팅·상담 메모가 1건 기록됨 | **사람** (기록 저장 시 "상담으로 올릴까요?" 한 줄 제안 — 자동 승격은 안 한다, 잡담도 메시지다) |
| `consulting` | **상담** | 요구를 듣고 있는 중 | Consulting | Understanding their needs | 견적·제안서(post category quote·proposal)가 **발행**됨 | 사람 → 다음은 **자동** |
| `proposal` | **제안** | 견적·제안서를 보냈다 | Proposal sent | Quote or proposal delivered | 계약서/SOW post 가 만들어졌거나 서명 요청이 나갔다 | **자동** (`projectStageEngine` quote/proposal 단계 completed) |
| `negotiation` | **협상** | 계약 조건을 다루는 중 | Negotiating | Working out contract terms | 양사 서명 완료 | **자동** (contract 단계 active → completed 가 성사) |
| `won` | **성사** | 계약 서명이 끝났다 | Signed | Contract signed by both sides | — (이후는 프로젝트가 주인) | **자동** + 사람 수동 허용(구두 계약 — `manual_locked` 와 같은 정신) |
| `lost` | **종결** | 진행하지 않기로 했다 (사유 기록) | Closed, no deal | Decided not to proceed (reason logged) | 재개 시 사람이 아무 단계로 | **사람만** (자동 종결 없음 — 조용한 고객이 곧 잃은 고객은 아니다) |
| `none` | **영업 외** | 단계 없이 관리하는 고객·협력사 | Not in sales | Managed without sales stages | 사람이 "영업 시작" 을 누르면 문의 | 사람 |

**사람이 하는 일 / 시스템이 대신하는 일**

| 사람 | 시스템 |
|---|---|
| 상담(듣기·말하기), 판단, 견적·계약 내용 결정, 종결 선언, 문의→상담 승격, 초대(정식 고객으로) | 접점 수집·정렬(채팅·메일·전화·일정), 산출물 기반 단계 자동 진행(제안·협상·성사), 다음 할 일 부재·정체·응답대기 감지, 통화 녹음 → 전사·요약·업무 후보, 히스토리 요약, 성사 시 프로젝트 거래 시퀀스로 인계 |
| **확인**(자동 기록을 읽고 "확인함" 누르기) | "확인 안 됨" 표시 유지 — 사람이 보기 전엔 정리된 것이 아니다 |

### 1.3 PlanQ 기존 흐름에 붙는 모양 (한 고객의 끝-끝)

```
[유입]  게스트 링크로 채팅 시작(#259)  /  모르는 주소에서 메일  /  전화가 옴
   │      GuestLink.client_id NULL         EmailThread.client_id NULL      (기록 없음)
   ▼
[문의]  멤버가 "고객으로 저장" 한 번  →  clients row (status=prospect, sales_stage=inquiry, access_kind=guest)
   │      · 게스트: guest_links.client_id + conversations.client_id 채움 → 채팅이 타임라인에 즉시 붙는다
   │      · 메일:  email_threads.client_id 채움 + invite_email=from → 이후 메일은 matchClient 가 자동 매칭(emailImapCron.js:123)
   │      · 전화:  Q sale [+ 문의 추가] (이름·전화·회사)
   ▼
[상담]  통화 녹음 업로드(#382) → File 저장 + Q Note 배치 STT → 요약·업무 후보 → 상담 기록 카드(미확인)
   │      미팅은 [일정 잡기] → Q calendar (attendee.client_id) → 끝나면 [기록 남기기]
   │      메모는 손으로 (occurred_at 을 사람이 정한다 = "날짜 단위 DB")
   ▼
[제안]  "계약 진행 →" 누름 → 프로젝트 생성(또는 기존 연결) → 거래 시퀀스 시드(quote→contract→invoice→tax)
   │      견적 post 발행 → 프로젝트 quote 단계 completed → 고객 단계 제안 (자동)
   ▼
[협상]  계약서 post + 서명 요청(routes/signatures.js:111) → contract 단계 active → 고객 단계 협상 (자동)
   ▼
[성사]  양사 서명 → onSignatureChanged(projectStageEngine.js:436) → 고객 단계 성사 (자동) + 이력 row
   │      다음은 프로젝트의 invoice 단계 = Q Bill (이미 있음). Q sale 은 여기서 손을 뗀다.
   │      이 시점에 아직 게스트면 → "초대 보내기" 제안 (정식 고객이어야 컨펌·앱 청구 열람이 된다, §4.4)
   ▼
[프로젝트] 프로젝트 고객 탭 → "고객 히스토리" = 같은 타임라인을 ?project= 로 필터해 연다
```

---

## 2. 기존 부품 지도 — 무엇을 그대로 쓰고 무엇을 늘리는가

넷째 타임라인, 둘째 고객 테이블, 셋째 토큰 체계를 **만들지 않는다.**

| 필요 | 이미 있는 것 (실존 확인) | 판정 |
|---|---|---|
| 고객 엔티티 | `models/Client.js` — `user_id` nullable(초대 전 허용, :17), `status` invited/active/archived(:73), `kind`(:101), `assigned_member_id`(:91), `email_aliases`(:113), Cue 자동 요약 `summary/summary_updated_at/summary_manual`(:77-88) | **재사용 + 영업 축 컬럼 추가** (§3.1) |
| 채널 통합 타임라인 | `services/clientTimeline.js:25 getClientTimeline` 4채널 merge · `routes/clients.js:72,88` · `pages/Clients/ClientTimelinePage.tsx` · `pages/QMail/MailContextPanel.tsx:443-472` 고객 섹션 | **같은 함수에 채널 추가**, 페이지는 컴포넌트로 추출해 Q sale 상세가 임베드 |
| 고객 AI 요약 | `services/cue_orchestrator.js:298 generateClientSummary` — 채팅 40건만 입력, 3~5 불릿, `checkUsageLimit`·`recordUsage('summary')` 게이트, `clients.summary` 저장 | **입력을 타임라인으로 교체 + 구조화 출력 + 근거 참조** (§10). 게이트·저장 컬럼은 그대로 |
| 게스트 = 영업 단계 고객 | `models/GuestLink.js` — `client_id` nullable(:163), 그림자 User 링크당 1개(:166), `account_requested_at/requested_email`(:183-184) · 그림자 계정 차단 `middleware/auth.js:69` | **"고객으로 저장" 액션 추가** — 링크·대화방에 client_id 채우기만 |
| 정식 고객 술어 | `middleware/access_scope.js:85-87` `Client{user_id=me, status='active'}` → isClient · `:98-108` `project_clients.contact_user_id=me` | **접근 종류 파생 함수가 같은 술어를 쓴다** (§4.1) |
| 초대·수락 | `routes/clients.js:263 POST /:businessId/invite` (이메일 중복 흡수 :288, status invited :301, `perUserDaily('invite-email')`) · `routes/invites.js:124-146` 수락 시 `user_id` 연결 + `status:'active'` | **승격 = 기존 초대 그대로** (§4.4) |
| 메일 ↔ 고객 | `emailImapCron.js:123 matchClient` (invite_email · billing_contact_email · email_aliases) · `EmailThread.client_id/project_id/reply_needed/follow_up_days` | **재사용**. 미매칭 발신자 "고객으로 저장" 은 invite_email 에 주소를 넣으면 이후 자동 |
| 응답 없음 판정 | `services/mailFollowUp.js` (결정론, `follow_up_days` 단일 판정점) | **같은 함수 호출** |
| Q mail AI | `routes/email_threads.js:1400 ai-suggest`(답장 초안, `perUserDaily('mail-ai-draft')` :52) · `:1796 extract-tasks` · `:1884 summarize` · `cue_orchestrator.js:403 generateEmailReplyDraft`(faqContext·threadContext) · `:499 summarizeThread` · `services/mailAutoExtract.js`(계정 단위 자동추출, 하루 20스레드 캡) · `emailTriage.js`(LLM 0 분류) | **그대로 호출** — Q sale 은 버튼과 링크만 (§9) |
| 업무 후보 3스코프 | `models/TaskCandidate.js` conversation_id / email_thread_id / qnote_session_id (:11-14), `business_id`(:15) · `routes/qnote_bridge.js:32-50` → `task_extractor.js:658 extractNoteTaskCandidates` · 공용 카드 `components/Common/TaskCandidateCard.tsx:26-34` | **재사용**. 고객 축은 후보에 컬럼을 늘리지 않고 **세션→상담기록→고객 / 스레드→고객 / 대화방→고객** 으로 해석 |
| 다음 할 일 | `models/Task.js` — `client_id`(:50), `created_via`(:144, display-only) | **다음 할 일 = Task**. 새 필드 없음 |
| 일정 | `models/CalendarEventAttendee.js:10 client_id` · `CalendarEvent.target_client_ids`(:81) · `project_id`(:9) | **미팅 잡기 = Q calendar 이벤트 + attendee.client_id** — 타임라인 `event` 채널이 이걸 읽는다 |
| 거래 단계 | `models/ProjectStage.js` + `services/projectStageEngine.js` (템플릿 :22-40, 판정 :134-291, next_action :293-308, 훅 :428-455) | **읽기 소비자 추가** — 고객 단계 동기화(§6.3). 판정식은 건드리지 않는다 |
| 계약·서명 | `routes/signatures.js:111 POST /api/posts/:id/signatures` · `SignatureRequest` 동결 스냅샷 | **재사용** |
| 프로젝트 생성 | `routes/projects.js:80 POST /api/projects` (clients:[{name,email}] → ProjectClient + Client 즉시 생성) | **재사용** — `client_id` 입력 분기 1개 추가 |
| 청구 | `invoices.client_id` · `source_post_id`(Invoice.js:139) · 공개 결제 페이지 | **재사용** — 게스트도 공개 링크로 청구서를 본다 |
| 녹음 → 전사 | `q-note/routers/audio_upload.py:77-166` (Deepgram 배치, 200MB·4h 캡, 과금 fail-closed :133-147, 완료 후 원본 삭제 :238) | **재사용**. 컨텍스트 필드 3개와 완료 콜백 1개 추가 (§7) |
| 플랜 한도 | `services/plan.js:309 Client.count({business_id})` · `config/plans.js:21,53,88,119,150 clients_max` 3/5/20/100/∞ · 화면 `PlanSettings.tsx:304-306`, `UsageWarningCard.tsx:71` | **계수 술어를 한 함수로 뽑고 정식 고객만 센다** (§3.6) |
| 상태 이력 패턴 | `project_status_history` · `invoice_status_history` · `task_status_history` | **같은 패턴**으로 `client_stage_history` |
| 파일 | `models/File.js` — `client_id`(:27), `security_level`(:144), `vlevel`(:150), soft delete·purge(:161-176) | **녹음 파일은 File** |
| 메뉴 권한 | `middleware/menu_permission.js:32-35 VALID_MENUS` · `routes/businesses.js:1006` 검증 · 프론트 `services/permissions.ts:7` · `MemberPermissionMatrix.tsx:17` | **`qsale` 키 1개 추가 — 5곳** (§12 항목 5) |
| 없는 것 | 영업·문의 개념 **0건** (grep 전수 — `aiTaskPlanner.js:234` 프롬프트 문자열만), 비고객 연락처 실체 **없음**(`routes/email_addresses.js:53` 는 즉석 집계), 사이드바 **중첩 메뉴 없음**(`MainLayout.tsx:1293-1344` 전부 flat NavItem), `Quote` 모델은 **라우트 없음**(docs.js:15 import 만), 배지 스토어 **없음**(`useInboxCount.ts` 가 `/api/dashboard/todo` 를 자른다) | 문의 = clients 확장으로 흡수. Quote 모델은 **쓰지 않는다** (견적은 post category='quote' 로 운영 중) |

---

## 3. 데이터 모델

### 3.1 결정 D1 — 영업 고객은 별도 테이블이 아니라 `clients` 다

**결정: `clients` 에 영업 축 컬럼을 추가한다. `leads`/`contacts` 테이블을 만들지 않는다.**

1. **허브 키가 이미 하나다.** `conversations` · `email_threads` · `tasks` · `invoices` · `files` · `guest_links` · `project_clients` · `calendar_event_attendees` 의 `client_id`, 그리고 `clientTimeline.js` 전부 `clients.id` 를 본다. 문의 테이블을 따로 두면 이 **아홉 지점마다 두 번째 FK 와 두 번째 술어**가 생긴다.
2. **"계정 없는 사람" 은 이미 표현된다.** `Client.user_id` nullable(:17-18), `invite_email` 로만 존재하는 고객이 운영에 있다.
3. **문의 → 정식 고객 전환에 데이터 이동이 없다.** 같은 row 가 초대·수락으로 `user_id` 를 얻는다(invites.js:137). 종결한 문의의 기록도 같은 자리에 남는다.
4. **마이그레이션 비용이 ADD COLUMN 으로 끝난다.** 백필 없음(기존 고객은 `sales_stage='none'`).

**대신 반드시 지킬 것:** `Client.status` 는 **계정·관계 축**이고 영업 단계는 **별도 컬럼**이다. 한 컬럼에 섞으면 "초대는 됐는데 협상 중" 을 표현할 수 없다.

```sql
ALTER TABLE clients
  MODIFY COLUMN status ENUM('invited','active','archived','prospect') NOT NULL DEFAULT 'invited',
  --  ★ 'prospect' 는 ENUM 끝에 append (순번 저장). prospect = 계정 없음 + 초대 안 함(게스트로 정보만).
  --    'invited' 로 두면 화면 라벨 "초대됨" 이 거짓말이 된다. 소비처 전수 grep 은 §13 검증 항목.
  ADD COLUMN sales_stage ENUM('none','inquiry','consulting','proposal','negotiation','won','lost')
        NOT NULL DEFAULT 'none',
  ADD COLUMN sales_stage_changed_at DATETIME NULL,
  ADD COLUMN sales_source ENUM('guest_link','email','phone','referral','web','event','manual','other') NULL,
  ADD COLUMN lost_reason ENUM('price','timing','competitor','no_response','fit','other') NULL,
  ADD COLUMN lost_note VARCHAR(500) NULL,
  ADD COLUMN phone VARCHAR(40) NULL,                 -- 상담 전화. billing_contact_phone(세금계산서 담당)과 다르다
  ADD COLUMN expected_amount DECIMAL(14,2) NULL,     -- 예상 규모(선택). 재무 아님 — 표시·집계 전용. AI 가 채우지 않는다
  ADD COLUMN expected_currency VARCHAR(3) NULL,
  ADD COLUMN last_touch_at DATETIME NULL,            -- ★ 파생(정렬·정체 배지 전용). 원천은 타임라인. 재계산 스크립트 동반
  -- §10 히스토리 요약 캐시 (summary/summary_updated_at/summary_manual 은 기존)
  ADD COLUMN summary_json JSON NULL,                 -- 구조화 요약 {situation, needs, decisions, open_issues, next_steps, refs}
  ADD COLUMN summary_as_of DATETIME NULL,            -- ★ 요약이 반영한 마지막 접점 시각 = stale 판정·증분 입력의 **유일한 기준선**
  ADD COLUMN summary_item_count INT NULL,
  ADD COLUMN summary_model VARCHAR(50) NULL,
  ADD INDEX clients_biz_stage (business_id, sales_stage),
  ADD INDEX clients_biz_touch (business_id, last_touch_at);
```

`last_touch_at` 은 **파생 컬럼**이다(memory `feedback_derived_field_not_source_of_truth`). 갱신 지점: 고객 대화방 메시지 생성(`services/message_send.js` 단일 경로) · 메일 수신/발송(`emailImapCron.js:608` 스레드 갱신 · 발송 라우트) · 상담 기록 생성 · 일정 종료. 어긋나면 `scripts/recompute-client-last-touch.js`(멱등).

**접근 종류(`access_kind`)는 컬럼이 아니다.** 기존 컬럼에서 파생한다(§4.1) — 새 컬럼을 두면 `user_id` 와 어긋나는 순간이 반드시 온다.

### 3.2 신규 `client_stage_history` — 단계 이력 (project_status_history 패턴)

```sql
CREATE TABLE client_stage_history (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  business_id  INT NOT NULL,
  client_id    INT NOT NULL,
  from_stage   VARCHAR(20) NULL,
  to_stage     VARCHAR(20) NOT NULL,
  origin       ENUM('manual','auto') NOT NULL,
  changed_by   INT NULL,                           -- auto 면 NULL
  reason       VARCHAR(500) NULL,
  source_ref   JSON NULL,                          -- auto 근거: {project_id, stage_id, signature_request_id, post_id}
  created_at   DATETIME NOT NULL,
  INDEX (business_id, client_id, created_at)
);
```
단계가 바뀌는 **모든 경로가 한 함수**를 지난다: `services/salesStage.js :: setStage(client, to, {origin, by, reason, source_ref, tx})` — 컬럼 갱신 + 이력 + `client:updated` broadcast + notify. 직접 `client.update({sales_stage})` 는 `guard-invariants` 래칫으로 차단(taskTransition 과 같은 정신, memory `project_agent_permission_model`).

### 3.3 신규 `client_interactions` — 상담 원장 ("날짜 단위로 DB처럼")

채팅·메일·업무·일정·청구는 원본 테이블이 있어 타임라인이 **실시간으로 읽는다**. 원본 테이블이 **없는** 접점 — 전화·미팅 기록·방문·상담 메모 — 만 여기 쌓는다.

```sql
CREATE TABLE client_interactions (
  id             BIGINT PRIMARY KEY AUTO_INCREMENT,
  business_id    INT NOT NULL,
  client_id      INT NOT NULL,
  project_id     BIGINT NULL,
  calendar_event_id INT NULL,                        -- 미팅 기록이 어느 일정에서 나왔나 (되돌아오는 경로 §6.2)
  kind           ENUM('call','meeting','visit','memo','other') NOT NULL,
  direction      ENUM('inbound','outbound') NULL,
  occurred_at    DATETIME NOT NULL,                  -- ★ 사용자가 정하는 접점 시각 (기본 now)
  duration_seconds INT NULL,
  title          VARCHAR(200) NULL,
  body           TEXT NULL,                          -- 사람이 쓴 메모 원문
  summary        TEXT NULL,                          -- 요약 (AI 또는 사람)
  key_points     JSON NULL,
  origin         ENUM('manual','auto') NOT NULL DEFAULT 'manual',
  source_kind    ENUM('manual','qnote','guest_link','email','chat','calendar') NOT NULL DEFAULT 'manual',
  reviewed_at    DATETIME NULL,                      -- origin=auto 인데 NULL = 미확인
  reviewed_by    INT NULL,
  qnote_session_id INT NULL,                         -- cross-DB — FK 없음
  file_id        INT NULL,                           -- 녹음 원본 (files)
  stt_status     ENUM('none','uploading','processing','completed','failed') NOT NULL DEFAULT 'none',
  stt_error      VARCHAR(300) NULL,
  created_by     INT NOT NULL,
  deleted_at     DATETIME NULL, deleted_by INT NULL,
  created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
  INDEX (business_id, client_id, occurred_at),
  INDEX (business_id, origin, reviewed_at),
  INDEX (qnote_session_id)
);
```

**"확인" 의 정의 (전 표면 공통, 새 읽음 컬럼 없음):** interactions `origin='auto' AND reviewed_at IS NULL` · 업무 후보 `status='pending'` · 메일 `email_thread_participants.last_read_message_id` · 채팅 `conversation_participants.last_read_at`. Q sale 은 **집계해 보여주기만** 한다.

### 3.4 q-note `sessions` (SQLite) — 컬럼 3개

```sql
ALTER TABLE sessions ADD COLUMN client_id INTEGER;            -- MySQL clients soft ref (project_id 와 동일 방식, database.py:127-137 옆)
ALTER TABLE sessions ADD COLUMN interaction_id INTEGER;       -- Node client_interactions.id (완료 콜백 대상)
ALTER TABLE sessions ADD COLUMN origin TEXT;                  -- 'sale_call' | NULL. ★ 종류로 못 박는다(§7.2)
```
`CAPTURE_MODES`(sessions.py:162) 에 `'upload'` 를 넣는다(지금은 `audio_upload.py:157` 의 직접 INSERT 만 그 값을 만든다).

### 3.5 `notification_prefs.event_kind` ENUM 끝에 `sale` append

현재 순서 `signature … system, leave`(NotificationPref.js:31-43). `sale` 을 **끝에** 붙이고 `scripts/migrate-qsale.js` 가 `migrate-task-hold-status.js:24-45` 패턴(SHOW COLUMNS → 빠진 값만 append, 멱등)으로 처리. 배포 체인 `deploy-planq.sh:251+` 블록에 한 줄.

### 3.6 플랜 한도 — 정식 고객만 센다, 그리고 기준이 화면에 보인다 (Irene 결정 1)

**계수 술어를 한 함수로 뽑는다.** `services/plan.js:160`(사용량) 과 `:309`(add_client 판정) 이 각자 `Client.count({business_id})` 를 부른다 — 같은 값의 공식 두 벌. 이번에 `services/clientQuota.js` 로 모은다:

```js
// 한도에 세는 고객 = 우리가 초대했거나 로그인하는 고객. 게스트로 정보만 넣은 문의(prospect)는 별도 상한.
billableClientWhere(bizId) = { business_id: bizId, status: { [Op.in]: ['invited','active'] } }   // archived 도 제외(옛 동작과 동일 여부는 구현 게이트에서 실측 — 지금은 archived 도 센다)
prospectWhere(bizId)       = { business_id: bizId, status: 'prospect' }
limits.prospects_max       = clients_max === Infinity ? Infinity : clients_max * 3     // config/plans.js 에 명시 컬럼으로 (계산식을 여러 곳에 두지 않는다)
```
`plan.can('add_client')` 는 정식 고객 생성·**초대(prospect→invited 승격)** 에서, `plan.can('add_prospect')` 는 문의 생성("고객으로 저장"·"+ 문의 추가")에서 검사한다.

**기준이 보이는 4곳 (전부 상태로, 안내문 아님):**

| 위치 | 무엇이 보이나 |
|---|---|
| 설정 > 구독 플랜 사용량 (`PlanSettings.tsx:304-306` 옆) | 두 줄: **"정식 고객 12 / 20"** · **"문의 고객 7 / 60"**. 각 줄 라벨 옆 회색 한 줄 "초대했거나 로그인하는 고객" / "게스트로 정보만 저장된 고객 — 초대하면 정식 고객으로 셉니다" |
| 고객 관리 목록·드로어 (`ClientsPage.tsx`) 와 Q sale 상세 프로필 | 접근 종류 배지(§4.2) 옆 **"한도: 포함"** / **"한도: 미포함 · 초대하면 포함"** 칩 |
| 초대 보내기 모달 (Q sale·고객 관리 공통) | 버튼 위 한 줄 **"초대하면 정식 고객 한도에 포함됩니다 (지금 12 / 20)"**. 초과면 기존 422 `clients_quota_exceeded` → `LimitReachedDialog` |
| Q sale 목록 헤더 count 옆 | **"정식 12/20 · 문의 7/60"** 칩 (클릭 → 플랜 설정) |
| `UsageWarningCard.tsx:71` | `prospects` 줄 추가 — 임박 경고도 두 줄 |

`GET /api/plan/:id/status` 응답에 `usage.clients`(정식) · `usage.prospects` · `limits.prospects_max` 추가. 프론트는 이 값만 표시하고 **직접 세지 않는다**.

### 3.7 마이그레이션 · 롤백

| 순서 | 무엇 | 방식 |
|---|---|---|
| 1 | `clients` ALTER (ENUM append + 컬럼 13) · `notification_prefs.event_kind` append | `sync-database.js:36 alter:true` 가 컬럼은 처리. **ENUM 은 못 한다** → `scripts/migrate-qsale.js`(멱등, ENUM append 2건) + `deploy-planq.sh:251+` 한 줄. 인덱스는 모델 `indexes` 배열로만(Too-many-keys) |
| 2 | `client_stage_history` · `client_interactions` CREATE | 모델 추가 → sync 가 생성 |
| 3 | q-note SQLite ALTER 3 + `CAPTURE_MODES 'upload'` | `database.py _run_migrations` 멱등 패턴 (:42-235) |
| 4 | `scripts/dump-schema.js` → `scripts/schema-snapshot.json` 재생성 | `guard-invariants schemacol`(:1464) 통과 조건 · memory `feedback_sync_drops_columns_not_in_model` |
| 롤백 | 코드 롤백만으로 표면이 사라진다. 컬럼·테이블 잔존 무해. **`UPDATE clients SET status='invited' WHERE status='prospect'` 를 롤백 절차에 명시**(옛 코드가 라벨을 못 찾아 기본값으로 떨어지는 것 차단) |

---

## 4. 게스트 vs 정식 초대 고객 — 분리 (Irene: "제대로 초대한거니까 분리가 되어야 해")

### 4.1 무엇이 둘을 가르나 — 코드로 확인한 사실

| 사실 | 근거 |
|---|---|
| 앱에 **로그인하는 고객**은 `clients.user_id = me AND status='active'` 인 row 로 판정된다 | `middleware/access_scope.js:85-87` |
| 또는 프로젝트 초대 수락으로 `project_clients.contact_user_id = me` 인 사람 | `access_scope.js:98-108` |
| 초대를 보내면 `status='invited'` + `invite_token` + `invite_email` + `invited_at` 이 채워지고, `user_id` 는 아직 NULL | `routes/clients.js:301-305` |
| 수락하면 `user_id` 연결 + `status:'active'` + `accepted_at` | `routes/invites.js:124-146` |
| **게스트는 Client 가 아니다.** 게스트의 신원은 `guest_links.guest_user_id`(그림자 User, `is_guest=true`) 이고, Client 는 링크에 `client_id` 로 **선택 연결**될 뿐 | `models/GuestLink.js:163,166` · `models/User.js:170` |
| 그림자 User 는 어떤 인증 표면에도 못 들어온다 | `middleware/auth.js:69` `guest_not_allowed` |
| 청구서·문서·서명 공개 링크는 **로그인 없이** 열린다 — 게스트에게도 보낼 수 있는 것 | `routes/invoices.js:123`, `routes/posts.js:1584`, `routes/signature_public.js:14` |

→ 지금 모델에서 **`user_id` 유무와 `invited_at` 유무 두 개**로 세 종류가 완전히 갈린다. 새 컬럼이 필요 없고, 만들면 어긋난다.

### 4.2 접근 종류 3분류 — 서버 한 함수, 프론트는 받은 값만 표시

```js
// services/clientAccess.js — ★ 술어 단일 원천. access_scope.js:85-87 과 같은 조건을 읽는다.
function accessKindOf(client) {
  if (client.user_id && client.status === 'active') return 'member';   // 정식 고객 (로그인)
  if (client.invited_at || client.status === 'invited') return 'invited'; // 초대 대기
  return 'guest';                                                       // 게스트로 정보만 (status=prospect)
}
```
모든 고객 응답(`GET /api/clients/*`, `GET /api/sale/*`, 타임라인 헤더, 프로젝트 고객 탭)에 `access_kind` 와 `has_guest_link`(활성 guest_links 존재) 를 **서버가 넣어 준다**. 프론트가 `user_id` 를 보고 스스로 판정하는 코드는 게이트에서 실패시킨다(memory `feedback_predicate_must_match_both_sides`).

| access_kind | ko 배지 | en 배지 | 한 줄 (툴팁·드로어) | 이 사람에게 **보낼 수 있는 것** | **안 되는 것** (버튼 disabled + 회색 한 줄 "정식 초대 후 가능") |
|---|---|---|---|---|---|
| `guest` | **게스트** (회색) | Guest | 정보만 저장됨 · 로그인 없음 | 게스트 링크 채팅(있으면), 메일(주소 있으면), 전화, 공개 링크(청구서·견적·서명) | 앱 알림, 업무 컨펌 요청(`requires_client_review`), 프로젝트 참여, 앱 안 청구서 열람 |
| `invited` | **초대 대기** (노랑) | Invited | 초대 메일을 보냈고 아직 수락 전 | 위 + 초대 재발송(`clients.js:336`) | 같음 |
| `member` | **정식 고객** (파랑) | Member | 로그인하는 고객 | 전부 | — |

**보이는 곳:** Q sale 목록 열 1개("접근"), Q sale 상세 헤더 이름 옆, 고객 관리 목록 행·드로어, 프로젝트 고객 탭 행, Q mail·Q Talk 우측 패널 고객 칩. **필터:** Q sale 목록 상단 "접근 ▾ 전체 / 게스트 / 초대 대기 / 정식 고객"("전체" 필수).

한 고객이 게스트 링크도 있고 정식 계정도 있으면 `member` + 작은 "🔗 게스트 링크 1" 보조 표시 — 종류는 하나, 채널은 여럿.

### 4.3 게스트가 Client 가 되는 순간 — "고객으로 저장"

```
POST /api/sale/:businessId/save-as-client
  { from: 'guest_link', guest_link_id }        // Q Talk 우측 패널 게스트 섹션
  { from: 'email_thread', email_thread_id }    // Q mail 컨텍스트 패널 (client_id NULL 스레드)
  { from: 'manual', display_name, phone, email, company_name, sales_source }   // Q sale [+ 문의 추가]
```
- 이메일·전화 **정확 일치**하는 Client 가 있으면 새로 만들지 않고 **그 고객에 연결**(중복 차단, LLM 0). 응답 `{ client, linked_existing: true }` → 화면 "기존 고객 ○○에 연결했어요".
- 없으면 `Client{ status:'prospect', sales_stage:'inquiry', sales_source, display_name(게스트는 마지막 `messages.meta.guest.name`), invite_email(메일이면 from, 게스트면 `requested_email` 있을 때) }` + `plan.can('add_prospect')`.
- 부수효과: `guest_links.client_id`, `conversations.client_id`(NULL 일 때만), `email_threads.client_id`(그 스레드 + 같은 발신 주소의 client_id NULL 스레드 백필) → 타임라인에 **즉시** 과거 대화가 붙는다.
- 게스트 화면(`GET /api/guest/:token`)은 **아무것도 달라지지 않는다** — 화이트리스트 무변경.

### 4.4 승격 — 게스트 → 초대 대기 → 정식 고객

| 동선 | 무엇을 부르나 | 결과 |
|---|---|---|
| Q sale 상세 헤더 **[초대 보내기]** (access_kind ≠ member 일 때만 표시) | 기존 `POST /api/clients/:biz/invite`(clients.js:263) — 같은 이메일 row 를 흡수(:288) | `status invited`, 초대 메일 발송, `plan.can('add_client')` 검사 + 모달에 한도 한 줄(§3.6) |
| 게스트가 "계정 요청하기" 를 눌렀을 때 (`guest_links.account_requested_at`, guest.js:144) | Q sale "확인 필요" 에 **"계정 요청 옴 — [초대 보내기]"**(requested_email prefill) | 멤버 한 번 클릭 |
| 성사(won) 전이 시 access_kind ≠ member | 다음 할 일 카드에 "정식 초대 보내기 — 컨펌·청구서 앱 열람에 필요" 제안 | 사람 클릭 |
| 프로젝트 고객 초대(`projects.js:164`) | 기존 경로 그대로 — 같은 Client row 에 `project_clients` 추가 | 수락 시 `invites.js:137` 로 active |
| 수락 | `invites.js:124-146` | `user_id` 연결 → access_kind `member`, 배지가 파랑으로 바뀐다. 이력·타임라인 그대로(같은 row) |

승격 뒤에도 게스트 링크는 살아 있다(카톡 공유 편의). 원하면 회수(guest_admin.js:117).

### 4.5 Q sale 은 고객에게 보이지 않는다 — 서버·프론트 같은 술어

- **서버**: `routes/sale.js` 전 라우트 체인 `authenticateToken → checkBusinessAccess(memberOnly, auth.js:176) → requireMenu('qsale', level)`. client 는 `checkBusinessAccess` 에서 이미 403 — 그래도 첫 줄 `if (req.businessRole==='client') 403` 이중. 게스트는 `authenticateToken` 자체를 못 지난다(auth.js:69). 타임라인 라우트는 이미 client 403(clients.js:73).
- **프론트**: NavItem 은 `hasBiz('owner','member')`(MainLayout.tsx:917 정의, :1293 사용 패턴) — client 를 **빼는 것**이 숨김 메커니즘의 전부다. `App.tsx` 라우트는 `<ProtectedRoute requiredRole={['business_owner','business_member']}>`(App.tsx:296-300 패턴), `appRoutes.tsx` 도 `roles: BIZ`(:78). `navMenus.ts` 항목 `roles: ['owner','member']`.
- 두 술어는 같은 것이다: 서버 `req.businessRole !== 'client'` ⇔ 프론트 `business_role ∈ {owner, member}`. 메뉴 레벨(`qsale` none) 로 더 좁힐 수 있고, 그건 서버 `requireMenu` 와 프론트 `permissions.ts` 레벨이 같은 값을 읽는다(businesses.js:975 GET 이 서버 목록을 내려준다).

---

## 5. 화면 · UX

### 5.1 IA — Q mail 바로 아래 독립 메뉴 (Irene 결정 3)

사이드바 "협업" 섹션, Q mail NavItem(MainLayout.tsx:1294) 바로 다음에 `Q sale` NavItem. 라우트 `/sale`, `/sale/:clientId`. 배지 = "확인 필요" 합계(§4.3 집계) — `InboxBadge`(MainLayout.tsx:335) 재사용, 값은 `useInboxCount` 의 새 필드 `sale`(§12 항목 4).

Q mail·Q Talk 에서 영업으로 넘어가는 문:
- `MailContextPanel.tsx:443` 고객 섹션: **단계 배지 + 접근 배지 + 히스토리 요약 2줄 + "Q sale 에서 보기"** (기존 `:472` 링크 목적지를 `/sale/:clientId` 로 — 옛 `/business/clients/:id/timeline` 은 리다이렉트)
- 미매칭 발신자 스레드(client_id NULL, triage human): 같은 섹션에 **[고객으로 저장]**
- Q Talk `RightPanel` 게스트 링크 섹션(`components/QTalk/GuestLinkButton.tsx` 옆): 링크에 client_id 없으면 **[고객으로 저장]**, 있으면 고객 칩 + 링크

기존 `/business/clients`(고객 관리 = 사업자·세금 정보·초대) 는 유지. **Q sale 은 같은 clients 의 영업 뷰**(Single Source / Multiple Views). 고객 관리 드로어에는 "영업 단계" 한 줄 읽기 표시 + Q sale 링크 + 한도 포함 칩.

### 5.2 `/sale` 목록 (PageShell — 관리 리스트 패턴, ClientsPage 를 베낀다)

```
PageShell title="Q sale"  count={단계 진행 중 고객 수}   [정식 12/20 · 문의 7/60]
actions: [🔍 검색] [담당자 ▾ 전체] [단계 ▾ 전체] [접근 ▾ 전체] [+ 문의 추가]
─────────────────────────────────────────────────────────────────────────────
단계 요약 바   문의 12 · 상담 5 · 제안 3 · 협상 2 │ 성사(이달) 4 · 종결(이달) 1 │ 영업 외 31
              (칩 hover = 그 단계의 한 줄 기준 · 클릭 = 필터 · "전체" 칩 항상)
확인 필요 스트립 ⏱ 답 안 한 문의 2 · ✉ 응답 대기 3 · ● 미확인 자동기록 4 · ⚠ 다음 할 일 없음 5 · ⏸ 정체 3 · 👤 계정 요청 1
              (클릭 = 그 조건으로 필터. 0 이면 칩 숨김)
─────────────────────────────────────────────────────────────────────────────
고객 / 회사           접근        단계        담당   마지막 접점            다음 할 일                  확인   예상
ACME · 김대리         [초대 대기] [제안]      이나   ✉ 2일 전 (응답대기)    견적 회신 확인  D-1           ●2    ₩12,000,000
게스트 (카톡 유입)    [게스트]    [문의]      —      💬 3시간 전 (미응대)   ⚠ 첫 응답 보내기             ●1    —
B사 · 박부장          [정식 고객] [협상]      이나   📞 어제 · 자동요약     프로젝트: 계약 서명 대기       —     ₩30,000,000
…                                                                            [더 보기]
```
- 단계 칩 hover 툴팁 = "제안 — 견적·제안서를 보냈다". 단계 select 의 각 옵션에도 같은 한 줄이 회색으로 붙는다.
- 행 클릭 → `/sale/:clientId`. 정렬 기본: 확인 필요 있는 것 → `last_touch_at` 오래된 순.
- `parsePagination` default 200 / max 500. 검색은 display_name·company_name·phone·invite_email.
- 모바일(≤640): 카드 리스트, 요약 바 가로 스크롤. `data-testid`: `sale-add-inquiry`, `sale-row-{id}`, `sale-stage-chip-{stage}`, `sale-access-filter`.
- 빈 상태: "아직 영업 중인 고객이 없습니다. 게스트 채팅·메일에서 '고객으로 저장' 하거나 문의를 추가하세요." + 단계 7개 이름·한 줄 기준 표(빈 상태에서만 — 규칙 설명은 여기 한 번).

### 5.3 `/sale/:clientId` 상세 (2컬럼 · ≤1024 스택)

```
PageShell title={고객명 · 회사} [정식 고객] [단계 PlanQSelect ▾ — 옵션마다 한 줄 기준]
  actions: [📞 통화 녹음 추가] [📝 기록 추가 ▾ 전화/미팅/방문/메모] [📅 일정 잡기] [✅ 할 일] [계약 진행 →] [초대 보내기]
┌ 좌 360px ─────────────────────────────────┬ 우 flex ───────────────────────────────────────────┐
│ 히스토리 요약 (AI) · 08-30 기준 · 새 접점 3건 반영 전 [갱신] │ 확인 필요 (3)                                  │
│  상황  예산 3천 이내·10월 오픈·경쟁 견적 있음   │  ┌ 📞 통화 12분 · 09-02 14:20 · 자동요약 · ● 미확인 ┐  │
│  결정  견적 v2 로 진행 (08-28 메일)  ⓘ근거 2   │  │ • 예산 3천 이내 • 10월 오픈 • 경쟁사 견적 받음    │  │
│  미해결  결제 조건 (선금 비율)        ⓘ근거 1   │  │ 업무 후보 2 [등록] [무시]   [원문 → Q Note] [확인함]│  │
│  다음  견적 회신 확인 (D-1)                     │  └─────────────────────────────────────────────────┘  │
│  [원문으로]  [직접 수정]                         │ ──────────────────────────────────────────────────── │
│ 프로필 (AutoSaveField)                          │ 타임라인 [전체|채팅|메일|전화·미팅|일정|할 일|문서·서명|청구|단계|프로젝트]│
│  이름·회사·전화·이메일(별칭+)·유입·담당·예상      │  09-02 📞 통화 (자동요약) ● …                          │
│  한도: 포함 (정식 고객)                          │  09-01 ✉ Re: 견적 문의 — 응답 대기 3일 [답장 초안] [후속]│
│ 단계  문의 ─ 상담 ─ [제안] ─ 협상 ─ 성사          │  08-31 📅 킥오프 미팅 (Q calendar) → [기록 남기기]      │
│  제안 — 견적·제안서를 보냈다 · 5일째 · 자동(견적 발행)│  08-30 💬 게스트: "견적 가능할까요"                     │
│  이력 ▾                                          │  08-30 🔗 게스트 링크 발급 (이나)                       │
│ 다음 할 일 (Q task)                              │  08-28 ↗ 단계 문의 → 상담 (이나) · "첫 통화 후"         │
│  ✅ 견적 회신 확인  D-1  이나   [+ 추가]          │  … [더 보기]                                            │
│  ⚠ 제안: 응답 없음 3일 → 후속 메일               │                                                        │
│ 연결 프로젝트  · ACME 리뉴얼 — 계약 서명 대기 [→] │                                                        │
│ 채널  💬 대화방 1 · ✉ 스레드 12 · 🔗 게스트 링크 1 │                                                        │
└────────────────────────────────────────────────┴────────────────────────────────────────────────────────┘
```
- 단계 select: won/lost 선택 시 확인 모달(lost 는 사유 필수). 자동 상향된 단계를 사람이 **내리는** 것도 허용(이력 origin=manual).
- "기록 추가" 폼: kind · occurred_at(SingleDateField+시간) · direction · 제목 · 메모 · 길이 · 프로젝트. Ctrl/Cmd+Enter 저장, 중복 제출 가드.
- 타임라인은 `ClientTimelinePage.tsx` 에서 **`components/Clients/ClientTimeline.tsx` 로 추출**한 같은 컴포넌트.
- 히스토리 요약 카드의 각 줄 `ⓘ근거 N` → 타임라인이 그 항목들로 필터·스크롤(§10.6).

### 5.4 통화 녹음 추가 모달 (기존 `pages/QNote/AudioUploadModal.tsx` 재사용 + 컨텍스트 행)

```
┌ 통화 녹음 추가 — ACME · 김대리 ───────────────────────────┐
│ [파일 선택 / 드롭]  m4a · mp3 · wav · … (최대 200MB · 4시간) │
│ 통화 시각  [2026-09-02] [14:20]    방향  (●) 받은 전화 ( ) 건 전화│
│ 프로젝트에 연결  [ACME 리뉴얼 ▾ / 없음]                       │
│ 예상 사용량  약 12분 · 이번 달 남은 Q Note 시간 48분           │  ← POST /api/plan/:id/qnote/estimate (기존)
│ ─────────────────────────────────────────────────────────── │
│ 팀 공유  요약·업무 후보는 Q sale 에 기록되어 팀이 봅니다.       │
│          전사 원문(Q Note)도 팀에 공유  [ON]   ← 기본 ON (Irene 결정 2)│
│ [✓] 내가 참여한 통화이며 당사자로서 녹음했습니다 (필수)        │
│                                    [취소]  [업로드 시작]      │
└─────────────────────────────────────────────────────────────┘
```
업로드 후 상세의 "확인 필요" 에 **즉시 카드**(stt_status=processing 스켈레톤). 완료·실패 모두 카드 상태로 보인다.

### 5.5 "계약 진행 →" 모달 · "일정 잡기" · "할 일" — 이관 진입점은 헤더 한 줄에 모인다 (§6)

### 5.6 단계의 한 줄 기준이 붙는 자리 (전수)

| 자리 | 형태 |
|---|---|
| 목록 단계 요약 바 칩 | hover 툴팁 "문의 — 연락은 왔지만 아직 상담 전" |
| 목록 행 단계 배지 | 같은 툴팁 |
| 상세 헤더 단계 PlanQSelect | **각 옵션 아래 회색 11px 한 줄** (옵션 = 이름 / 기준 두 줄) |
| 상세 좌측 스텝퍼 현재 단계 | 이름 옆 인라인 "— 견적·제안서를 보냈다 · 5일째 · 자동(견적 발행)" |
| 자동 전이 이력·알림 문구 | "제안으로 올라갔어요 — 견적 발행" (기준이 곧 이유) |
| 빈 상태 | 7단계 이름·기준 표 1회 |
| 종결 모달 | "종결 — 진행하지 않기로 했다" + 사유 select |

### 5.7 i18n — 네임스페이스 `qsale` (ko/en 동시, i18n.ts 등록) + `layout.nav.qsale` + `settings.menu.qsale` + `settings.notifications.eventLabel.sale`

| key | ko | en |
|---|---|---|
| nav.qsale (layout) | Q sale | Q sale |
| menu.qsale (settings) | Q sale | Q sale |
| page.title | Q sale | Q sale |
| stage.none | 영업 외 | Not in sales |
| stage.none_hint | 단계 없이 관리하는 고객·협력사 | Managed without sales stages |
| stage.inquiry | 문의 | Inquiry |
| stage.inquiry_hint | 연락은 왔지만 아직 상담 전 | Contacted, not yet consulted |
| stage.consulting | 상담 | Consulting |
| stage.consulting_hint | 요구를 듣고 있는 중 | Understanding their needs |
| stage.proposal | 제안 | Proposal sent |
| stage.proposal_hint | 견적·제안서를 보냈다 | Quote or proposal delivered |
| stage.negotiation | 협상 | Negotiating |
| stage.negotiation_hint | 계약 조건을 다루는 중 | Working out contract terms |
| stage.won | 성사 | Signed |
| stage.won_hint | 계약 서명이 끝났다 | Contract signed by both sides |
| stage.lost | 종결 | Closed, no deal |
| stage.lost_hint | 진행하지 않기로 했다 (사유 기록) | Decided not to proceed (reason logged) |
| stage.changed_auto | 자동 — {{reason}} | Automatic — {{reason}} |
| stage.reason.quote_published | 견적 발행 | Quote published |
| stage.reason.contract_started | 계약서 작성·서명 요청 | Contract drafted / signature requested |
| stage.reason.contract_signed | 양사 서명 완료 | Signed by both parties |
| stage.days_in | {{count}}일째 | Day {{count}} |
| stage.suggest_consulting | 상담으로 올릴까요? | Move to Consulting? |
| access.guest | 게스트 | Guest |
| access.guest_hint | 정보만 저장됨 · 로그인 없음 | Saved details only · no login |
| access.invited | 초대 대기 | Invited |
| access.invited_hint | 초대 메일을 보냈고 아직 수락 전 | Invitation sent, not accepted yet |
| access.member | 정식 고객 | Member |
| access.member_hint | 로그인하는 고객 | Logs in to PlanQ |
| access.requires_member | 정식 초대 후 가능 | Available after formal invitation |
| quota.counted | 한도: 포함 | Counts toward plan limit |
| quota.not_counted | 한도: 미포함 · 초대하면 포함 | Not counted · counts once invited |
| quota.header | 정식 {{clients}}/{{clients_max}} · 문의 {{prospects}}/{{prospects_max}} | Members {{clients}}/{{clients_max}} · Inquiries {{prospects}}/{{prospects_max}} |
| quota.invite_notice | 초대하면 정식 고객 한도에 포함됩니다 (지금 {{clients}} / {{clients_max}}) | Inviting counts toward your member limit (now {{clients}} / {{clients_max}}) |
| quota.plan_clients_label (settings) | 정식 고객 | Member customers |
| quota.plan_clients_hint (settings) | 초대했거나 로그인하는 고객 | Invited or logged-in customers |
| quota.plan_prospects_label (settings) | 문의 고객 | Inquiry customers |
| quota.plan_prospects_hint (settings) | 게스트로 정보만 저장된 고객 — 초대하면 정식 고객으로 셉니다 | Saved as guests only — counted as members once invited |
| source.guest_link | 게스트 채팅 | Guest chat |
| source.email | 메일 | Email |
| source.phone | 전화 | Phone |
| source.referral | 소개 | Referral |
| source.web | 웹 문의 | Web inquiry |
| source.event | 행사 | Event |
| source.manual | 직접 등록 | Added manually |
| source.other | 기타 | Other |
| lost.reason.price | 가격 | Price |
| lost.reason.timing | 시기 | Timing |
| lost.reason.competitor | 경쟁사 선택 | Chose a competitor |
| lost.reason.no_response | 응답 없음 | No response |
| lost.reason.fit | 요구 불일치 | Poor fit |
| lost.reason.other | 기타 | Other |
| lost.modal.title | 종결 — 진행하지 않기로 했다 | Close — not proceeding |
| lost.modal.reason_required | 사유를 선택해 주세요 | Please choose a reason |
| attention.title | 확인 필요 | Needs attention |
| attention.unanswered_inquiry | 답 안 한 문의 {{count}} | Unanswered inquiries {{count}} |
| attention.awaiting_reply | 응답 대기 {{count}} | Awaiting reply {{count}} |
| attention.unreviewed_auto | 미확인 자동 기록 {{count}} | Unreviewed auto records {{count}} |
| attention.no_next_action | 다음 할 일 없음 {{count}} | No next action {{count}} |
| attention.stalled | 정체 {{count}} | Stalled {{count}} |
| attention.account_requested | 계정 요청 {{count}} | Account requests {{count}} |
| badge.auto | 자동 | Auto |
| badge.unreviewed | 미확인 | Unreviewed |
| action.mark_reviewed | 확인함 | Mark reviewed |
| action.add_inquiry | + 문의 추가 | + Add inquiry |
| action.save_as_client | 고객으로 저장 | Save as customer |
| action.linked_existing | 기존 고객 {{name}}에 연결했어요 | Linked to existing customer {{name}} |
| action.add_record | 기록 추가 | Add record |
| action.add_call_recording | 통화 녹음 추가 | Add call recording |
| action.schedule | 일정 잡기 | Schedule |
| action.add_task | 할 일 | Task |
| action.proceed_contract | 계약 진행 | Proceed to contract |
| action.invite | 초대 보내기 | Send invitation |
| action.add_next | + 다음 할 일 | + Next action |
| action.follow_up_mail | 후속 메일 | Follow-up |
| action.reply_draft | 답장 초안 | Draft reply |
| action.leave_record | 기록 남기기 | Add notes |
| action.open_in_qnote | 원문 보기 (Q Note) | Open transcript (Q Note) |
| action.open_in_qsale | Q sale 에서 보기 | Open in Q sale |
| next.first_reply | 첫 응답 보내기 · {{hours}}시간 경과 | Send first reply · {{hours}}h elapsed |
| next.first_consult | 첫 상담 잡기 | Schedule first consultation |
| next.start_contract | 계약 진행 → 견적 준비 | Proceed to contract → prepare quote |
| next.none | 다음 할 일을 정하세요 | Set a next action |
| next.in_project | 프로젝트에서 진행 중 | In progress in project |
| next.invite_for_won | 정식 초대 보내기 — 컨펌·청구서 앱 열람에 필요 | Send formal invitation — needed for approvals and in-app invoices |
| record.kind.call | 전화 | Call |
| record.kind.meeting | 미팅 | Meeting |
| record.kind.visit | 방문 | Visit |
| record.kind.memo | 메모 | Memo |
| record.kind.other | 기타 | Other |
| record.direction.inbound | 받은 | Inbound |
| record.direction.outbound | 건 | Outbound |
| record.occurred_at | 접점 시각 | When |
| record.duration | 길이 | Duration |
| record.stt.processing | 전사 중… | Transcribing… |
| record.stt.failed | 전사 실패 — {{error}} [다시 시도] | Transcription failed — {{error}} [Retry] |
| record.candidates | 업무 후보 {{count}} | Task candidates {{count}} |
| record.transcript_private | 원문은 업로더만 볼 수 있어요 | Transcript visible to uploader only |
| upload.title | 통화 녹음 추가 — {{name}} | Add call recording — {{name}} |
| upload.estimate | 예상 사용량 약 {{minutes}}분 · 이번 달 남은 Q Note 시간 {{remaining}}분 | Est. {{minutes}} min · {{remaining}} Q Note min left this month |
| upload.share_notice | 요약·업무 후보는 Q sale 에 기록되어 팀이 봅니다. | Summary and task candidates are recorded in Q sale for the team. |
| upload.share_transcript | 전사 원문(Q Note)도 팀에 공유 | Also share the transcript (Q Note) with the team |
| upload.consent | 내가 참여한 통화이며 당사자로서 녹음했습니다 | I took part in this call and recorded it as a party to it |
| upload.quota_exceeded | 이번 달 Q Note 시간이 부족합니다 (필요 {{needed}}분 · 남음 {{remaining}}분) | Not enough Q Note minutes this month (need {{needed}} · {{remaining}} left) |
| contract.modal.title | 계약 진행 | Proceed to contract |
| contract.modal.new_project | 새 프로젝트 만들기 | Create a new project |
| contract.modal.link_project | 기존 프로젝트에 연결 | Link an existing project |
| contract.modal.template | 거래 방식 | Deal type |
| summary.title | 히스토리 요약 | History summary |
| summary.as_of | {{date}} 기준 | As of {{date}} |
| summary.stale | 새 접점 {{count}}건 반영 전 | {{count}} new touchpoints not yet included |
| summary.refresh | 갱신 | Refresh |
| summary.up_to_date | 최신 | Up to date |
| summary.section.situation | 상황 | Situation |
| summary.section.needs | 요구·조건 | Needs & terms |
| summary.section.decisions | 결정 | Decisions |
| summary.section.open_issues | 미해결 | Open issues |
| summary.section.next_steps | 다음 | Next |
| summary.evidence | 근거 {{count}} | Sources {{count}} |
| summary.open_sources | 원문으로 | Show sources |
| summary.edit | 직접 수정 | Edit |
| summary.manual_note | 직접 수정한 요약 — AI 갱신이 덮어쓰지 않습니다 [AI 로 다시] | Edited by you — AI refresh won't overwrite [Regenerate with AI] |
| summary.empty | 접점이 쌓이면 요약이 만들어집니다 | A summary appears once there are touchpoints |
| summary.unavailable | AI 를 잠시 사용할 수 없어요 | AI is temporarily unavailable |
| project.history_link | 고객 히스토리 | Customer history |
| timeline.channel.interaction | 전화·미팅 | Calls & meetings |
| timeline.channel.event | 일정 | Events |
| timeline.channel.doc | 문서·서명 | Documents & signatures |
| timeline.channel.stage | 단계 | Stage |
| timeline.channel.project | 프로젝트 | Project |
| timeline.channel.guest | 게스트 링크 | Guest link |
| qnote.client_chip | 고객: {{name}} | Customer: {{name}} |
| qnote.already_extracted | Q sale 에서 이미 추출됨 · 후보 {{count}} | Already extracted in Q sale · {{count}} candidates |
| empty.title | 아직 영업 중인 고객이 없습니다 | No customers in progress yet |
| empty.body | 게스트 채팅·메일에서 "고객으로 저장" 하거나 문의를 추가하세요. | Save a guest chat or email sender as a customer, or add an inquiry. |
| notifications.eventLabel.sale (settings) | 영업 | Sales |
| notifications.eventDesc.sale (settings) | 통화 전사 완료 · 단계 자동 변경 · 답 안 한 문의 | Call transcribed · stage changed automatically · unanswered inquiry |

(영어 없는 항목은 미완. `guard-invariants --category=i18n,parity` 로만 판정.)

---

## 6. 업무 총집합 — 넘기기와 되돌아오기 (Irene: "다음으로 넘겨서 … 히스토리 제대로 구성")

**원칙: 넘기기는 항상 `client_id` 를 들고 나가고, 되돌아오기는 타임라인이 그 `client_id` 로 읽는다.** 이관 대상마다 "어느 컬럼이 고객을 기억하는가 → 어느 채널이 그걸 보여주는가 → 어떤 확인 상태로 보이는가" 를 표로 못 박는다. 단방향은 하나도 없다.

### 6.1 이관 5갈래 + 되돌아오는 경로

| 넘기기 (Q sale 상세 헤더·카드) | 무엇을 부르나 (기존) | 고객을 기억하는 컬럼 | 되돌아오는 채널 (타임라인) | 확인 상태 |
|---|---|---|---|---|
| **✅ 할 일** — 다음 할 일 추가 / 업무 후보 [등록] | `POST /api/tasks` (`client_id`, `assignee_id`=나, `due_date`, `created_via='qsale'`) · 후보 등록은 기존 register 라우트(mail `email_threads.js:1840`, qnote `qnote_bridge.js:74`, chat) | `tasks.client_id`(Task.js:50) — 후보 등록 시 스코프에서 고객을 해석해 **서버가 채운다** | `task` (기존) — 생성·완료·마감 지연이 그대로 보인다. "다음 할 일" 패널 = `tasks WHERE client_id AND 활성` | 후보 `pending` 이 미확인 |
| **📅 일정 잡기** — 미팅·통화 예약 | `POST /api/calendar/:biz/events` (`attendees:[{client_id}]`, `target_client_ids`, `project_id`) — `CalendarEventAttendee.client_id`(:10) 이미 있음 | `calendar_event_attendees.client_id` | **`event` 채널 (신규)** — 예정·완료. 종료 시각이 지나면 항목에 **[기록 남기기]** → 상담 기록 폼이 `calendar_event_id`·`occurred_at`·kind=meeting prefill | 종료됐는데 기록 없음 = "확인 필요: 미팅 기록 없음" |
| **📁 계약 진행 →** 프로젝트 만들기/연결 | `POST /api/sale/:biz/clients/:cid/proceed-contract` → `projectCreate` 서비스(projects.js:80 추출) 또는 `ProjectClient` 추가 | `project_clients.client_id` | **`project` 채널 (신규)** — `project_stages` completed_at(견적 발행·계약 서명·청구 완료) + `project_status_history`. 단계 동기화는 §6.3 | 자동 단계 전이가 미확인 아님(산출물 사실) — 이력에 origin=auto 만 |
| **📄 견적·계약서 (Q docs)** | 프로젝트 거래 탭의 기존 next_action 링크(`projectStageEngine.js:308+` — 견적 post 만들기 · 서명 요청) | `posts.project_id` → `project_clients.client_id` | **`doc` 채널 (신규)** — 견적/계약 post 발행·공유·`signature_requests` sent/viewed/signed/rejected(`entity_type='post'`) | 서명 `viewed` 뒤 n일 미서명 = "확인 필요: 서명 대기" |
| **💰 청구 (Q bill)** | 프로젝트 invoice 단계 링크(`/bills?tab=invoices&new=1&from_post=…`, projectStageEngine.js 기존) 또는 프로젝트 없는 단발 청구 `POST /api/invoices`(client_id) | `invoices.client_id` | `invoice` (기존) — 발행·결제·연체 | 연체는 Q bill 소관(Q sale 은 표시만) |
| **✉ 답장 / 후속 메일** | Q mail 라우트 그대로(§9) — Q sale 은 링크 | `email_threads.client_id` | `email` (기존) | `reply_needed`·`awaiting_reply` |
| **💬 채팅** | Q Talk 대화방 링크 / 게스트 링크 발급(guest_admin.js:47) | `conversations.client_id` · `guest_links.client_id` | `chat` · `guest` | unread |

프로젝트 없이 견적을 보내고 싶다는 요구가 오면 → **프로젝트를 만든다**(계약 진행 모달의 "새 프로젝트" 가 30초). `posts.client_id` 를 새로 두는 안은 기각 — 문서 허브 키가 둘이 된다.

### 6.2 되돌아오기의 실시간 — 각 원본 라우트의 기존 broadcast 를 듣는다

Q sale 상세는 `task:*` · `event:*`(calendar) · `mail:updated` · `message:new` · `interaction:*` · `client:updated` · `project:*`(없으면 `inbox:refresh` 안전망) 를 250ms debounce silentLoad 로 듣는다. 새 이벤트를 만드는 곳은 `interaction:*` 하나뿐.

### 6.3 단계 동기화 — 프로젝트 → 고객 (`services/salesStageSync.js`)

`projectStageEngine` 훅 3개(`onPostChanged:428` · `onSignatureChanged:436` · `onInvoiceChanged:447`)가 `progressProject()` 뒤 **`syncClientsFromProject(projectId)`** 한 줄. 프로젝트의 `project_clients.client_id` 각각:

| 프로젝트 단계 상태 | 고객 단계 (올리기만) | reason |
|---|---|---|
| quote/proposal completed | ≥ 제안 | quote_published |
| contract active | ≥ 협상 | contract_started |
| contract completed (전원 signed 또는 `manual_locked`) | 성사 | contract_signed (`source_ref.signature_request_id`) |

- 종결(lost) 고객은 자동으로 올리지 않는다. 고객이 프로젝트 여럿이면 **가장 진행된 프로젝트**가 정한다. 이력 origin=auto.
- 계약 진행 버튼 자체의 부수효과: `sales_stage < consulting` 이면 상담으로(auto, `contract_started`).

### 6.4 프로젝트에서 고객 히스토리를 본다

- `QProjectDetailPage` `clients` 탭(:1121) 각 고객 행에 **접근 배지 + [고객 히스토리]** → `/sale/:clientId?project=:pid`(타임라인 `?project=` 필터 + "전체 히스토리" 토글).
- 대시보드 탭 "영업 이력" 미니 카드(단계 이력 최근 3 + 성사일 + 히스토리 요약 2줄) — `CLIENT_HIDDEN_TABS`(:148) 와 같은 방식으로 **client 역할 숨김**.
- `routes/clients.js:55` linked projects 는 `contact_user_id` 만 본다 → `project_clients.client_id OR contact_user_id` 로 고친다(게스트 고객의 프로젝트가 안 보이던 구멍).

### 6.5 프로젝트 없이 성사되는 경우
단발 청구만 하는 컨설팅은 won 을 사람이 수동으로. 청구서 paid 를 won 트리거로 쓰지 않는다 — 재무 이벤트를 영업 단계에 물리면 Cue 재무 봉쇄 경계와 얽힌다.

---

## 7. #382 전화 녹음 — Q Note 연결

### 7.1 흐름 (Node-first)

```
[Q sale 모달] ──multipart──▶ Node POST /api/sale/:biz/clients/:cid/call-recordings
                              ① plan.can('upload_file',{size}) + BusinessStorageUsage 집계 (files.js 패턴 — costGuard 규칙 1)
                              ② File 생성: client_id, project_id, folder "통화 녹음"(file_folders 자동), vlevel L3,
                                 security_level 'internal'(외부 공유 차단 — securityLevel.js:18), SHA-256 dedup
                              ③ client_interactions 생성: kind call, occurred_at, direction, file_id, origin auto,
                                 source_kind qnote, stt_status 'uploading'  ── 여기서 응답 (카드가 즉시 뜬다)
                              ④ 백그라운드: q-note POST /api/sessions/upload-audio 로 스트림 전달
                                 (Authorization = 사용자 JWT 그대로 — q-note 인증은 JWT 로컬 검증 auth.py:12-31)
                                 + fields: business_id, title, client_id, interaction_id, origin='sale_call',
                                   share_transcript(bool, 기본 true), consent(bool)
                                 ← { session_id } → interaction.qnote_session_id, stt_status 'processing'
                                 ← 402 quota / 429 rate / 4xx → stt_status 'failed' + stt_error (파일은 남는다, [다시 시도])
[q-note _process] (audio_upload.py:193-239 그대로) → STT → utterances → status completed → record_usage(기존 과금)
                              ⑤ ★ origin='sale_call' 이면 추가:
                                 · generate_summary(transcript) 즉시 실행 → summary_key_points/summary_full 저장 (기존 함수)
                                 · visibility = share_transcript ? 'L3' : 'L1', shared_consent = consent
                                 · Node POST /api/internal/sale/call-processed (x-internal-api-key, localhost)
                                   { interaction_id, session_id, business_id, user_id, duration_seconds,
                                     summary_full, key_points, transcript_text }
                              ⑥ 원본 로컬 파일 삭제 (:238 그대로 — Node 의 File 이 원본이다)
[Node internal]               ⑦ interaction: summary/key_points/duration, stt_status completed, reviewed_at NULL
                              ⑧ extractNoteTaskCandidates({ text, title, qnoteSessionId, userId, businessId }) (task_extractor.js:658)
                                 — 브라우저 없이 서버가 텍스트를 넘긴다. plan.can('use_cue') + recordUsage
                              ⑨ 히스토리 요약 갱신 (§10.3 — 통화는 가장 진한 입력이라 이 시점 1회 자동)
                              ⑩ broadcast interaction:updated + candidates:created + inbox:refresh, notify(eventKind 'sale') 담당·업로더
```
- 실패 지점마다 **카드 상태**가 있다(uploading/processing/completed/failed). 오류 없이 산출물만 0인 경로 금지.
- 요약 재생성(Q Note [다시 요약]) → q-note 가 ⑤ 콜백을 **같은 endpoint 로 다시**(session_id 기준 upsert). 같은 탭 안 갱신은 `window CustomEvent('qsale:refresh')`.
- 콜백 유실 안전망: `processing` 30분 초과 → cron 이 q-note `GET /api/sessions/:id` 재조회.

### 7.2 충돌 해소 — "Q Note 는 사적 공간" vs "영업 히스토리는 팀이 본다" (Irene 결정 2 반영)

**자원의 종류를 생성 경로로 못 박는다.**

| | 일반 Q Note 세션 | **Q sale 에서 만든 세션** (`sessions.origin='sale_call'`, `client_id` NOT NULL) |
|---|---|---|
| 성격 | 개인 도구. 기본 L1, 생성자가 개방 | **처음부터 팀 기록**. 업로드 화면 문구로 그 사실을 읽고 올린다 |
| 요약·업무 후보 | 세션 안에만 | **항상 Q sale 상담 기록에 복사** — 이것이 영업 히스토리다 |
| 전사 원문 | L1 | **토글 기본 ON → L3**(Irene 결정). OFF → L1, 카드에 "원문은 업로더만" 표시 |
| 삭제 | 생성자만 (`sessions.py` owner_only) | 상담 기록 삭제(작성자 또는 owner/admin) 시 Node 가 **internal `DELETE /api/sessions/internal/:id`**(신규, 키가드, `origin='sale_call'` 만 허용) 로 세션도 지운다. 일반 세션에는 이 문이 없다 |
| 기존 개인 세션을 고객에 연결 | — | **v1 비범위.** 사이클 4 에서 "먼저 visibility ≥ L3 로 개방" 선행 조건으로 |

`PERMISSION_MATRIX.md §5.8` 에 행 추가. `_load_session_or_403`(sessions.py:440-489) 술어는 **바뀌지 않는다**.

### 7.3 Q Note 쪽 화면
- 세션 헤더·목록에 **`📞 고객: ACME · Q sale 에서 보기`** 칩. 업무 추출 버튼(`QNotePage.tsx:3035`)은 sale_call 세션에서 "Q sale 에서 이미 추출됨 · 후보 N" 링크로.

### 7.4 STT 과금·한도 — 기존 경로 그대로 (`record_usage(stream_id=upload_job_id, seq 0)`, fail-closed 402 → 카드 failed + `upload.quota_exceeded`). 요약·추출 LLM 은 Cue 월 한도.

### 7.5 개인정보 — 녹음 = 음성 PII. File `security_level='internal'` 기본, 동의 체크는 주의 환기(법률 자문 문구 금지), 보존기간 자동 삭제는 사이클 4(방침 문안 동반), 데이터 내보내기·계정 삭제 익명화에 `client_interactions` 포함(§12 항목 11).

---

## 8. 권한 · 보안 · 멀티테넌트

| 표면 | owner/admin | member (qsale write) | member (qsale read) | client | guest | Cue |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Q sale 목록·상세·타임라인·요약 | ● | ● | ● | **✗** (사이드바 없음 + 라우트 403) | ✗ (인증 자체 불가) | 읽기 — `cue_context.js:332` 가 이미 getClientTimeline 호출 |
| 문의 추가 · 고객으로 저장 · 단계 변경 · 기록 추가 · 요약 갱신 | ● | ● | ✗ | ✗ | ✗ | ✗ (단계 쓰기 금지 — `setStage` principal 검사) |
| 상담 기록 삭제 | ● | 작성자 본인만 | ✗ | ✗ | ✗ | ✗ |
| 통화 녹음 업로드 | ● | ● | ✗ | ✗ | ✗ | ✗ |
| 전사 원문 | 세션 visibility 따름 | 동일 | 동일 | ✗ | ✗ | — |
| 초대 보내기 · 계약 진행 | ● | ● | ✗ | ✗ | ✗ | ✗ |
| 답장 초안·업무 추출(Q mail 부품) | Q mail 권한 따름 (`requireMenu('qmail','write')`) | 동일 | 동일 | ✗ | ✗ | 초안만, 발송 없음 |

- 모든 쿼리 `WHERE business_id = ?`. 신규 두 테이블에 `business_id` 직접 보유.
- **공개 표면 0.** 게스트 화면 무변경.
- AuditLog(`services/auditService.js:59 createAuditLog`): `client.stage_change` · `client.interaction.create/delete` · `client.save_from_guest` · `client.proceed_contract` · **`client.summary_regenerate`(old/new = 이전 요약 보존 = 요약 버전 이력)**. 조회는 기록하지 않는다.
- Cue 재무 봉쇄(`guard-invariants cuefinance`) 무접촉 — `expected_amount` 는 표시용, AI·Cue 가 쓰지 않는다.

---

## 9. AI 활용 — Q mail 부품을 그대로 (Irene: "Q mail처럼 일 수월하게")

### 9.1 재사용 지점 — 새 LLM 호출 코드 0, 버튼과 링크만

| Q sale 의 버튼 | 부르는 것 (기존, 그대로) | 게이트 (기존) | Q sale 이 더하는 것 |
|---|---|---|---|
| 타임라인 메일 항목 **[답장 초안]** | `POST /api/businesses/:biz/email-threads/:id/ai-suggest`(email_threads.js:1400) → `generateEmailReplyDraft`(cue_orchestrator.js:403 — FAQ·threadContext 주입) | `requireMenu('qmail','write')` + `perUserDaily('mail-ai-draft', 10/분·200/일)`(:52) + `checkUsageLimit` | `threadContext` 에 **히스토리 요약(§10) 2~4줄**을 얹어 넘긴다 — 메일 스레드 밖의 통화·미팅 맥락이 답장에 들어간다. 초안은 **Q mail 컴포저에서 열린다**(Q sale 은 컴포저를 만들지 않는다). 발송은 사람 |
| 타임라인 메일 항목 **[업무 추출]** / 자동 | `.../extract-tasks`(:1796) · 계정 단위 자동추출 `mailAutoExtract.js`(하루 20스레드 캡) | 동일 + 후보는 `pending` | 후보 카드를 Q sale "확인 필요" 에 모아 보여준다(`TaskCandidateCard` 재사용). 등록 시 `client_id` 서버 채움 |
| 타임라인 메일 항목 **[스레드 요약]** | `.../summarize`(:1884) → `summarizeThread`(:499), `email_threads.ai_summary` 캐시 | 동일 | 히스토리 요약 입력으로 **원문 대신 이 캐시**를 쓴다(비용 ↓) |
| 채팅 항목 **[Cue 초안]** | Q Talk 의 기존 Cue draft 모드(`ai_mode_used='draft'`, 승인 후 발송) | 기존 | 링크만 |
| 통화 카드 요약·후보 | q-note `generate_summary` + `extractNoteTaskCandidates` (§7) | Q Note 과금 + Cue 한도 | 서버측 트리거 |
| **히스토리 요약** | `generateClientSummary` 개조(§10) | `checkUsageLimit` + `recordUsage('summary')` + `perUserDaily('sale-summary', 3/분·60/일)` + capText | 유일한 "새" 호출 지점 — 입력·출력 계약만 바꾼다 |
| 분류 | `emailTriage.js`(LLM 0) · `MailSenderRule` | — | "답 안 한 문의" 는 `reply_needed` 를 읽는다. 새 분류기 없음 |

costGuard 3종(rate-limit + `plan.can('use_cue')` + 입력 캡) 은 위 라우트들이 이미 갖고 있다. Q sale 신규 라우트 중 LLM 을 부르는 것은 **요약 갱신 1개**이고 같은 3종을 단다.

### 9.2 AI 를 쓰지 않는 곳 (의도적)

| 곳 | 이유 |
|---|---|
| 단계 판정 | 산출물 존재로 결정론. 확률 출력으로 단계판을 만들면 보고서가 거짓이 된다 |
| 다음 할 일·정체·답 안 한 문의 | 기존 데이터로 계산(§4.4). memory `feedback_ai_minimal_usage` |
| 성사 확률·점수 매기기 | 학습 데이터 없음. 틀린 숫자는 없는 숫자보다 나쁘다 |
| 답장 **자동 발송**, 문의 **자동 응답** | 초안까지만. 게스트 방 Cue 자동응답은 GUEST_LINK §7.3 대로 미발화 유지 |
| 자동 종결(lost) | 조용한 고객 ≠ 잃은 고객 |
| 예상 규모(`expected_amount`) 추정 | 재무 인접 숫자를 AI 가 채우지 않는다 |
| 요약 **자동 재생성**(이벤트마다) | 비용·비결정성. 갱신 시점은 §10.3 세 가지만 |
| 중복 고객 추천 | 이메일·전화 정확 일치만 — 임계 0.80 논의 자체가 불필요 |
| 감정·태도 분석 | 관계형 소량 영업에서 사람이 더 잘 안다 |

---

## 10. 히스토리 요약 (Irene: "특히 중요")

### 10.1 무엇을 요약하나

- **입력 = 타임라인 그 자체**(§4.1 전 채널) — 채팅·메일·전화·미팅·일정·할 일·문서·서명·청구·단계 이력. 지금 `generateClientSummary`(cue_orchestrator.js:298-353) 는 **채팅 40건만** 넣는다 — 그래서 운영에서 "고객이 최근 행동한게 뭐야" 에 답을 못 했다(cue_context.js:330 주석).
- 항목별 표현: 채팅·메일은 타임라인 preview(140자) — 단, 메일 스레드에 `ai_summary` 캐시가 있으면 그것을(더 짧고 정확), 통화·미팅은 `interactions.summary`+`key_points`(각 600자 캡), 단계 이력은 "문의→상담 (사람, 사유)", 서명·청구·일정은 한 줄 상태.
- **분량**: 최근 **90일 또는 80항목** 중 먼저 닿는 것 + 그 이전은 **이전 요약 텍스트**를 "지난 요약" 으로 앞에 붙인다(증분). 총 입력 `capText(8000자)`. 출력 구조:

```json
{ "situation":  ["예산 3천 이내", "10월 오픈 목표", "경쟁사 견적 보유"],
  "needs":      ["반응형 필수", "유지보수 월정액 선호"],
  "decisions":  [{ "text": "견적 v2 로 진행", "refs": [{ "type":"email","id":812 }] }],
  "open_issues":[{ "text": "선금 비율 미합의", "refs": [{ "type":"interaction","id":31 }] }],
  "next_steps": [{ "text": "견적 회신 확인 (D-1)", "refs": [{ "type":"task","id":1602 }] }] }
```
프롬프트는 각 입력 항목에 `[#n type id at]` 인덱스를 붙이고 **모든 문장에 refs 인덱스를 요구**한다. refs 없는 문장은 저장하되 "근거 없음" 회색 표시 — 환각을 사용자가 보는 자리에서 걸러낸다. 자동 기록(origin=auto, 미확인)에서 나온 문장은 입력에 `(미확인)` 표기 → 출력에서 그대로 따라 붙는다.

### 10.2 어디에 저장하나 — 캐시다, 원장이 아니다

- 저장 = `clients.summary`(사람이 읽는 전문) + `summary_json` + **`summary_as_of`** + `summary_item_count` + `summary_model` + `summary_updated_at`(기존) + `summary_manual`(기존).
- **원장은 타임라인**이다. 요약은 언제든 버리고 다시 만들 수 있어야 하고, 실제로 그렇게 만든다. 요약을 별도 테이블에 회차별로 쌓지 않는다 — 회차 누적은 "어느 회차가 진실인가" 를 낳는다(memory `feedback_cumulative_ledger_needs_baseline`).
- **이전 요약이 필요한 두 경우** ①증분 입력의 "지난 요약" ②"전에는 뭐라고 했지" — 둘 다 `AuditLog client.summary_regenerate` 의 `old_value` 로 해결(auditService.js:59 old/new JSON, 기존 고객 history 라우트 clients.js:238 로 조회). 새 테이블 0.
- **기준선은 `summary_as_of` 하나.** stale 판정(§10.4)·증분 입력 절단·"새 접점 N건" 카운트가 **전부 이 값**을 읽는다. 두 공식을 두지 않는다(memory `feedback_same_value_multiple_formulas`).

### 10.3 언제 만드나 — 세 시점만

| 시점 | 누가 | 조건 |
|---|---|---|
| **요청 시** — 카드 [갱신] / 첫 열람에 요약 없음 | 사람 | `last_touch_at > summary_as_of` 가 아니면 "최신" 표시만(LLM 0) |
| **통화 녹음 처리 완료**(§7.1 ⑨) | 서버 1회 | 가장 진한 입력이 들어온 순간. 같은 흐름에 이미 LLM 2회가 돌았고 사용자가 명시적으로 올린 것 |
| **단계 자동 상향(제안·협상·성사)** | 서버 1회 | 산출물 사건 = 요약이 바뀔 사건. 하루 고객당 최대 1회 |
| 그 외(메시지·메일 도착마다) | **안 한다** | 비용·비결정성. stale 칩이 대신 말한다 |

배치(cron) 없음. 워크스페이스 야간 일괄 재요약은 하지 않는다.

### 10.4 원문이 바뀌면 — stale 을 상태로 보여준다

- 카드 헤더: **"08-30 기준 · 새 접점 3건 반영 전 [갱신]"** (`count = timeline items WHERE at > summary_as_of`) 또는 **"최신"**.
- 메시지 수정·삭제(마스킹)·기록 수정은 `updated_at` 이 기준선 뒤라도 "새 접점" 으로 세지 않는다(원문 편집은 흔하고 요약 의미를 바꾸는 일은 드물다) — 대신 삭제된 항목이 refs 에 있으면 그 문장에 "근거 삭제됨" 표시. 자동 재생성 없음.
- `summary_manual=true`(사용자가 직접 수정) 면 자동 시점(§10.3 2·3행)도 덮어쓰지 않는다. 카드에 "직접 수정한 요약 — [AI 로 다시]".

### 10.5 비용을 막는 것

`checkUsageLimit`(Cue 월 한도) + `recordUsage('summary')`(기존) + `perUserDaily('sale-summary', 3/분·60/일)` + `capText(8000)` + **고객당 하루 자동 갱신 1회** + stale 아니면 LLM 0. 모델은 기존 `MODEL_MINI`. 예상: 활발한 고객 1명당 하루 ≤ 2회.

### 10.6 요약이 틀렸을 때 — 원문으로 내려가는 길

1. 각 문장 옆 **ⓘ근거 N** → 클릭 = 타임라인이 그 refs 항목만 필터 + 첫 항목으로 스크롤(항목은 이미 `type/id` 를 가진다). 근거 없는 문장은 회색 "근거 없음".
2. 카드 하단 **[원문으로]** = 요약 기준선(`summary_as_of`) 이전 90일 구간으로 타임라인 필터.
3. **[직접 수정]** = 텍스트 편집 → `summary_manual=true`. **[AI 로 다시]** 로 복귀.
4. 이전 요약 = 고객 이력(AuditLog) 에서 "요약 갱신" 항목 펼치기.
5. 통화 요약이 틀리면 → 카드 [원문 → Q Note] 로 전사 원문(visibility 허용 범위).

### 10.7 어디에 보이나
Q sale 상세 좌측 최상단(§5.3) · Q mail·Q Talk 우측 패널 고객 섹션 2줄 + 링크 · 프로젝트 고객 탭 hover 카드 · Cue 컨텍스트(`cue_context.js` 가 `client.summary` 를 이미 읽는 자리에 `summary_json.next_steps` 추가).

---

## 11. 실시간 · 알림

- broadcast: `client:updated`(기존) 재사용 + 신규 `interaction:new/updated/deleted`. 후보는 `candidates:created`. `inbox:refresh` 도 같이(배지).
- Q sale 페이지: business room join, 위 이벤트 250ms debounce silentLoad, `useVisibilityRefresh`, 편집 중 재그리기 금지.
- notify `eventKind:'sale'`(§3.5): 통화 전사 완료(업로더+담당) · 자동 단계 변경(담당) · 답 안 한 문의 경과(담당, 1회) · 계정 요청(담당). 응답 대기 알림은 **Q mail 것**(`mailFollowUpCron.js`) 하나만. 링크 `/sale/:clientId`.

---

## 12. 새 메뉴가 유발하는 횡단 작업 — 12항목 전수 (파일:줄 · 1차 필수/미룸)

| # | 영역 | 지금 있는 것 (실측) | Q sale 이 해야 할 것 | 1차 |
|---|---|---|---|---|
| 1 | **알림** | `notify/notifyMany` `routes/notifications.js:105,296` · `isAllowed :70-83`(row 없음=ON) · ENUM `NotificationPref.js:31-43` · 설정 매트릭스 `NotificationSettings.tsx:24-30 EVENTS` 하드코딩 + 라벨 i18n `:133-134` · 아이콘 `NotificationTypeIcon.tsx:50-66` · 링크 테이블 **짝** `services/notification_link.js:22-47` ↔ `utils/notificationLink.ts:17-42` · 드롭다운 새 탭 `NotificationDropdown.tsx:49-52` | ENUM 끝 `sale` append(마이그레이션) · `EVENTS` 에 `'sale'` · eventLabel/Desc ko/en · 아이콘 case · **두 링크 테이블에 `client`/`client_interaction → /sale/:id` 동시 추가** · `NOTIFY_LOCKED`(guard-invariants.js:357-369) 에 `routes/sale.js` 등록 | **필수** |
| 2 | **확인 필요 / 오늘** | `GET /api/dashboard/todo` `routes/dashboard.js:924` — 수집기 `Promise.all :978-991`(`collectCandidates:400` 은 **비활성** :983-985), counts `:1015`, 응답 `:1077` · `TodoPage.tsx:191` drawer kind 분기 · `inbox:refresh` 리스너 10곳(TodoPage:128,133 · DashboardPage:78 · QBill* · FocusWidget:123 · useInboxCount:40,52) | `collectSale()` 추가(답 안 한 문의 · 미확인 자동기록 · 다음 할 일 없음 · 계정 요청 → item.kind 'sale', link `/sale/:id`) + `counts.sale` · TodoPage 에 kind 'sale' 렌더 분기 | **필수** (배지가 여기서 나온다) |
| 3 | **실시간** | 패턴 `io.to('business:…')` — `routes/tasks.js:50-51`, `services/taskTransition.js:50`, `services/mailBroadcast.js:16`; `BROADCAST_LOCKED` `guard-invariants.js:385+` | `routes/sale.js` 의 쓰기 라우트 전부 broadcast + `BROADCAST_LOCKED` 등록 · 상세 페이지 리스너(§6.2) · `useVisibilityRefresh` | **필수** |
| 4 | **뱃지** | 스토어 없음. `useInboxCount.ts:9 InboxCounts{total,bill,mail}` 가 `/todo` 응답을 자른다(:21-22) · `MainLayout.tsx:878-884` · `InboxBadge :335`, 렌더 :1299-1303(mail) · Talk 는 별도 `useUnreadTotal.ts:40` | `InboxCounts.sale` + `MainLayout saleMenuCount` + NavItem 배지 · `total` 에 합산할지는 **합산 안 함**(인박스 total 은 "내 할 일" 성격 — 영업 확인은 별도 숫자) | **필수** |
| 5 | **권한 게이트 전수** | 서버 `menu_permission.js:32-35 VALID_MENUS`(미등록 키는 **모듈 로드 시 throw** :51-53) · `businesses.js:1006` 검증(import 재사용) · `_subject.js:31 assertMenuWrite`(levels 자동) · `BusinessMemberPermission.js:29` 주석만(STRING — 마이그레이션 없음) · 프론트 `permissions.ts:7 MenuKey` · `MemberPermissionMatrix.tsx:17 MENU_LIST` · `settings.json:530-543 menu.*` ko/en · 사이드바 숨김 = `hasBiz`(`MainLayout.tsx:917`) · `navMenus.ts:36-83 WORKSPACE_MENUS`(:6 "사이드바 바꾸면 같이") · `App.tsx:296-300 ProtectedRoute requiredRole` · `appRoutes.tsx:78 roles: BIZ` · `guard-app-routes.js:22-27`(두 라우트 파일 불일치 = 빌드 실패) · `publicSurface.ts:24-30`(**넣지 않는다**) · `App.tsx:677 nonAppOther`(sale 미포함 확인) | 위 **11곳** 전부 `qsale`/`/sale` 추가. client 차단은 서버 `checkBusinessAccess`+명시 403, 프론트 `hasBiz('owner','member')`+ProtectedRoute+roles — 같은 술어(§4.5). Cue 액션이 Q sale 에 쓰기하려면 `assertMenuWrite(...,'qsale')` — v1 은 Cue 쓰기 없음 | **필수** |
| 6 | **탭·라우팅** | `MULTITAB_DESIGN.md:16` 탭 화이트리스트 행 · `tabStore.ts:12-14 TabKind`, `:38-53 PREFIX_KIND`(미등록 → 'other' 로 뭉친다), `openInNewTab :222-234` · `useDetailParam.ts:27`(정본은 `notificationLink.ts ENTITY_LINK`, :9-10) · App.tsx lazy import :68 패턴 | `TabKind 'sale'` + `[/^\/sale/, 'sale']` · 화이트리스트 문서 행에 "Q sale" · `/sale`·`/sale/:clientId` 를 App.tsx + appRoutes.tsx 둘 다 · 상세는 path param(드로어 아님)이라 `useDetailParam` 불필요 — 단 ENTITY_LINK 는 등록 | **필수** |
| 7 | **검색** | `routes/search.js:113` 응답 `{tasks,posts,records,files,conversations,knowledge,clients,projects}` · clients 는 **이미 검색**(:288-297, `:291` email 컬럼 없음 주의) · client 역할 gate `:162-164` · 프론트 `GlobalSearchModal.tsx:30 Category`, 매핑 `:149` → `/business/clients?client=` · 메뉴 이름 검색은 `navMenus.ts` | clients 결과 링크를 **access_kind·단계 배지 포함 + `/sale/:id`** 로(고객 관리 드로어와 이중 목적지면 Q sale 우선) · `client_interactions` 본문 검색은 **미룸**(FULLTEXT 설계 별도) · `navMenus` 항목 추가로 "Q sale" 메뉴 검색 | 링크·배지 **필수** / 기록 본문 검색 **미룸(사이클 4)** |
| 8 | **보고서·통계** | 개인 `weeklyReviewSnapshot.js:55` v1(:124) · 워크스페이스 `:190` v1(:277) 섹션 kpi/highlights/… · `InsightsPage.tsx:22-23 TabKey/ALL_TABS` · `routes/insights.js:9-239` · 사이드바 아코디언 `MainLayout.tsx:1421-1441` · `navMenus.ts:55-61 stats-*` | **미룸(사이클 4)**: 워크스페이스 스냅샷 `schema_version 2` 에 `sales{stage_counts, won_this_week, lost_reasons}` 추가(옛 v1 스냅샷은 그대로 렌더 — 버전 분기) · Insights 탭 `'sales'`(LLM 0 집계) · `/insights` 는 `READ_ONLY_MENUS` 그대로 | 미룸 |
| 9 | **i18n** | 가드 `guard-invariants --category=i18n,parity` · `i18n.ts ns 배열` · 네임스페이스 파일 위치 | `qsale` ns ko/en 신설(§5.7) + `layout.nav.qsale` + `settings.menu.qsale` + `settings.notifications.eventLabel/Desc.sale` + `clients.status.prospect` + `plan` ns 두 줄(§3.6) | **필수** |
| 10 | **하니스·헬스** | `scripts/e2e/run.js:7-43 SUITES`(:37 예) · `canary-detail-open.js:38-44 CASES` [라벨, url, 정상 id, 없는 id, 타 워크스페이스 id] · `INSPECTION_PLAYBOOK.md §5 :75-83` 라우트 분류 · `§6 :84-89` "입력 신규화면 = SCENARIOS 1줄" · `health-check.js:44-47 CATEGORIES`, `test(category,name,fn) :207-212` | `CASES` 에 `['영업 고객', id=>\`/sale/${id}\`, 정상, 99999901, 타biz]` · 통화 모달 키보드 시나리오 1줄(`--suite mobile`) · health-check `'realtime'` 또는 신규 `'sale'` 카테고리에 "client 계정 /api/sale 403" · "prospect 행 5표면 라벨" 은 e2e 가 아니라 구현 게이트 실측 항목 | **필수** |
| 11 | **감사·보존·내보내기** | `createAuditLog` `auditService.js:59`(민감키 마스킹 :19-21) · GDPR 내보내기 `routes/admin.js:854`, 모델 병렬 fetch `:862-868`, 응답 `:878-886` · 익명화 `services/accountAnonymize.js:42-44`(Client PII) · 파일 내보내기 워커 `exportJobWorker.js:9` 는 파일/문서 전용 | AuditLog 액션 5종(§8) · 내보내기에 `client_interactions(created_by=me)` + `client_stage_history(changed_by=me)` 1항목씩 · 익명화 step 3 에 `phone` 추가 + `client_interactions.body/summary` 는 **워크스페이스 자산이라 유지**(작성자 id 만 익명 사용자로) — ACCOUNT_DELETION 문서에 한 줄 · 녹음 보존기간 자동 삭제는 **미룸(사이클 4)** | 감사·내보내기·익명화 **필수** / 보존기간 미룸 |
| 12 | **마이그레이션** | `sync-database.js:36 alter:true`(실패도 exit 0 :54 — deploy-planq.sh:284 경고) · ENUM 은 못 함 → `scripts/migrate-task-hold-status.js:24-45` 패턴 · 배포 체인 `deploy-planq.sh:245`(sync) → `:251+` 마이그레이션 블록(:262 예) · `dump-schema.js`/`schema-snapshot.json`/`schemacol` 가드(guard-invariants.js:1464) | `scripts/migrate-qsale.js`(clients.status append 'prospect' · notification_prefs.event_kind append 'sale' · 멱등) + 체인 한 줄 · 신규 테이블·컬럼은 모델→sync · q-note SQLite ALTER 3 · 스냅샷 재생성 · 롤백 SQL 헤더에 명시(§3.7) | **필수** |

---

## 13. 절단면 — 사이클 분할 (각 사이클이 그 자체로 쓸모 있어야 한다)

| 사이클 | 범위 | 그 자체의 쓸모 | Fable 게이트 | 되돌리기 |
|---|---|---|---|---|
| **1. 단계 + 상담 원장 + 접근 분리 + 히스토리 요약** | `clients` ALTER · `client_stage_history` · `client_interactions`(녹음 제외) · `clientAccess.js`(3분류) · `clientQuota.js`(한도 술어 단일화 + prospects_max + 4곳 화면) · `routes/sale.js` · `/sale` 목록·상세 · 타임라인 채널 +interaction +stage +guest +event · 확인 필요 집계 · 다음 할 일 규칙 · 다음 할 일=Task · 일정 잡기(attendee.client_id) · **게스트/미매칭 메일 "고객으로 저장"** · 문의 수동 추가 · 초대 보내기(승격) · **히스토리 요약**(§10, 유일한 LLM) · Q mail·Q Talk 패널 배지·요약 2줄·링크 · 답장 초안·업무 추출 버튼(Q mail 라우트 링크) · 횡단 12항목 중 "필수" 전부 | 오늘부터 게스트·메일·전화 문의를 한 곳에서 단계별로 보고, 답 안 한 문의·응답대기·다음 할 일 없음이 보이고, 고객마다 요약이 있다. 게스트와 정식 고객이 구별된다 | **설계(이 문서) + 구현**: 마이그레이션(ENUM append 2) · 신규 시스템 · `status='prospect'` 소비처 전수 · 한도 계수 변경(돈 인접) · 멀티테넌트 · 게이트 11곳 | 코드 롤백 + `status prospect→invited` UPDATE. 테이블 잔존 무해 |
| **2. 프로젝트·문서 연동** | 계약 진행 → 프로젝트 생성/연결(`projectCreate` 추출) · `salesStageSync`(훅 3곳 한 줄) · 타임라인 +project +doc 채널 · `?project=` 필터 · 프로젝트 고객 탭 배지+[고객 히스토리] · 대시보드 영업 이력 카드(client 숨김) · linked projects 술어 수정(clients.js:55) · 단계 자동 상향 시 요약 갱신 | 제안·협상·성사가 손 안 대고 맞는다. 프로젝트에서 이전 상담을 본다 | **구현**: 엔진 훅 접촉 · client 노출 0 | 훅 한 줄 제거 |
| **3. 통화 녹음 (#382)** | Node-first 업로드 · File 폴더 · q-note 필드 3 + `CAPTURE_MODES 'upload'` + origin 분기(자동 요약·visibility 기본 L3·콜백) · internal `call-processed` · 서버측 추출 · internal 세션 삭제 · Q Note 칩·추출 버튼 분기 · 모달 · 카드 4상태 · 통화 완료 시 요약 갱신 | 통화 한 번 올리면 요약·후보·원문·파일이 한 번에 생기고 Q Note 와 왕복 | **설계 세부 재게이트(§7) + 구현 + 테스트**: 내부 API · 과금 원장 무변경 증명 · PII · 사적공간 예외 | 라우트 미마운트 |
| **4. 성과·운영** | 단계 보드 뷰 · Insights `sales` 탭 + 주간 스냅샷 v2 · 정체 임계 설정 · 녹음 보존기간 + 방침 · 기존 Q Note 세션 연결(visibility 선행) · 상담 기록 본문 검색(FULLTEXT) | 숫자로 영업을 본다. 운영 정책이 닫힌다 | 인사이트 Opus 가능 · 보존 삭제 Fable | 각 독립 |

**미루는 것(의도적 비범위):** 점수 매기기 · 콜드메일 시퀀스 · 외부 CRM 가져오기 · 고객 포털에서의 단계 노출(고객은 자기 단계를 보지 않는다) · CTI/자동 녹음.

### 13.1 리스크

| 리스크 | 대응 |
|---|---|
| `status='prospect'` 가 삼항 사슬 끝으로 떨어져 "초대됨/보관" 으로 보인다 | 구현 게이트: `Client.status` 소비처 **전수 grep + 양성 대조군**(prospect 행을 만들어 6표면 실측: 고객 관리 목록·드로어·초대 재발송·프로젝트 고객 탭·청구서 고객 선택·검색 결과) |
| 한도 계수 변경으로 기존 워크스페이스 사용량 숫자가 달라진다 | archived 포함/제외는 **옛 동작을 실측해 유지** 후 결정(§3.6 주석). 변경 시 릴리스 노트 1줄 + 플랜 화면 한 줄 문구가 곧 설명 |
| 접근 종류를 프론트가 따로 계산 | 응답 `access_kind` 만 쓰도록 게이트에서 `user_id` 기반 분기 grep 0건 확인 |
| `last_touch_at`·`summary_as_of` 어긋남 | 파생 명시 + 재계산 스크립트 + health-check 샘플 항목 |
| 자동 단계 상향이 사람 판단을 덮음 | 올리기만, 내리기는 사람만, lost 자동 불가, 이력 origin·근거 |
| 요약 환각 | refs 강제 + 근거 없음 회색 + 원문 내려가기 5경로(§10.6) + 직접 수정 |
| 요약 비용 | 세 시점 + 하루 자동 1회 + stale 아니면 LLM 0 + rate-limit |
| 통화 업로드 이중 전송 메모리 | 스트리밍 파이프, 200MB 선검사 |
| 콜백 유실 | 30분 cron 재조회 + [다시 시도] |
| 게스트 "고객으로 저장" 중복 | 이메일·전화 정확 일치 연결(§4.3), 링크에 client_id 있으면 버튼 없음 |
| 새 메뉴 게이트 누락 | §12 항목 5 의 11곳을 구현 게이트 체크리스트로 그대로 사용(memory `feedback_new_tab_needs_gate_sweep`) |

---

## 14. 검증 계획 (Fable 구현 게이트가 실측할 것)

1. **diff 범위**: §3·§6·§7·§10·§12 밖 변경 0. `projectStageEngine` 판정식(:134-291) 변경 0.
2. **가드**: `health-check.js` · `npm run build`(EXIT 직접 확인) · `guard-invariants` 전체(i18n·parity·spalink·routedrift·schemacol·cuefinance·cueauth·notify/broadcast locked).
3. **실호출 (dev)**:
   - 문의 추가 → prospect 행 → 6표면 라벨 실측 · `access_kind='guest'` · 플랜 status `usage.prospects` +1, `usage.clients` 불변
   - 초대 보내기 → `status invited`, `access_kind='invited'`, `usage.clients` +1 · 한도 초과 시 422 + 모달 문구 · 수락 → `member`
   - 게스트 방 메시지 → "고객으로 저장" → 타임라인 즉시 포함 · `GET /api/guest/:token` JSON 키 스냅샷 **변경 0** · 같은 이메일 재저장 → `linked_existing`
   - 미매칭 메일 "고객으로 저장" → 다음 수신 자동 매칭
   - 일정 잡기(attendee.client_id) → `event` 채널 · 종료 후 "미팅 기록 없음" 확인 항목 → [기록 남기기] prefill
   - 단계 수동 변경 → 이력 origin=manual · 2탭 broadcast · 종결 사유 필수 400
   - 계약 진행(new) → 프로젝트 + `project_clients.client_id` · 견적 발행 → 제안(auto) · 서명 2건 → 성사(auto) · lost 불변(음성)
   - 요약: 접점 5건 → [갱신] → `summary_json` refs 전 항목 실존 id · 접점 추가 → stale 카운트 1 · 다시 [갱신] 안 누르면 LLM 호출 0(usage 불변) · `summary_manual` 후 자동 시점 덮어쓰기 0 · AuditLog old_value 에 이전 요약
   - 답장 초안 버튼 → Q mail ai-suggest 호출(threadContext 에 요약 포함, 로그) · qmail read 멤버는 버튼 없음 + 직접 호출 403
   - 통화 업로드(사이클 3) → File(security internal) · interaction 4상태 · `qnote_usage_events` 1행 · visibility ON/OFF 양방향 · 타 멤버 원문 GET 200/403 · 삭제 캐스케이드 · 일반 세션 internal DELETE 403 · 한도 근접 402
   - 권한: client 계정 `/api/sale/*` 전부 403 · 사이드바에 Q sale 없음 · `/sale` 직접 진입 시 ProtectedRoute 리다이렉트 · qsale read POST 403 · 타 워크스페이스 id 404 · `qsale none` 멤버 사이드바 숨김 + 403
4. **화면**: 상세 카드 4상태 스크린샷 · 단계 select 옵션에 한 줄 기준 · 접근 배지 3종 · 플랜 화면 두 줄 · 모바일 640 목록 · 통화 모달 키보드(하니스 `--suite mobile`) · `canary-detail-open` 신규 행 통과.
5. **운영 옛 데이터 1건**: 운영 고객(sales_stage none) 이 "영업 외" 로 정상 표시 · 기존 4채널 무변경 · 기존 `clients.summary` 가 있으면 `summary_as_of NULL` → "기준 없음 [갱신]" 로 보임.

---

## 15. Irene 결정 — 확정 3건 · 남은 3건

### 확정 (2026-09-02)
1. **한도** — 정식 고객(초대·활성)만 플랜 한도에 센다. 문의 고객은 별도 상한. **기준이 4곳 화면에 상태로 보인다**(§3.6).
2. **통화 전사 원문** — 팀 공유 기본 ON, 업로드 화면에서 끄기 가능(§7.2).
3. **위치** — Q mail 바로 아래 독립 메뉴(§5.1).
4. **용어** — 화면에 "리드·파이프라인" 없음. 단계마다 한국어 이름 + 한 줄 기준(§1.2·§5.6).

### 남은 것 (3건)
1. **문의 고객 별도 상한의 배수** — 정식 한도 × 3 으로 두었다(Free 3→9 · Basic 5→15 · Pro 20→60). 주요 이슈 아니면 이대로 진행.
2. **히스토리 요약 자동 갱신 시점** — 요청 시 + 통화 처리 완료 + 단계 자동 상향, 세 가지로 좁혔다(§10.3). 메일 도착마다 자동으로 하지 않는 것에 동의하는지.
3. **고객 관리(`/business/clients`) 메뉴** — Q sale 과 같은 clients 의 두 뷰로 **둘 다 유지**(사업자·세금 정보는 고객 관리, 영업은 Q sale). 하나로 합치기를 원하면 사이클 2 에서 고객 관리를 Q sale 의 "정보" 탭으로 흡수하는 안을 낸다.

---

## 부록 — 근거 코드 인덱스

| 항목 | 위치 |
|---|---|
| Client 모델 (user_id nullable · status · kind · email_aliases · summary) | dev-backend/models/Client.js:17, 73, 101, 113, 77-88 |
| 정식 고객 술어 (user_id+active · project_clients.contact_user_id) | dev-backend/middleware/access_scope.js:85-87, 98-108 |
| 초대·재발송·수락 | dev-backend/routes/clients.js:263-305, 336 · routes/invites.js:124-146 |
| 고객 타임라인 서비스·라우트·페이지 | dev-backend/services/clientTimeline.js:25,136 · routes/clients.js:72,88 · dev-frontend/src/pages/Clients/ClientTimelinePage.tsx · pages/QMail/MailContextPanel.tsx:443-472 |
| linked projects 가 contact_user_id 만 봄 | dev-backend/routes/clients.js:55 |
| 고객 AI 요약 현행 (채팅 40건) | dev-backend/services/cue_orchestrator.js:298-353 · cue_context.js:330-337 |
| 메일 ↔ 고객 자동 매칭 · 응답 없음 판정 | dev-backend/services/emailImapCron.js:123 · services/mailFollowUp.js |
| Q mail AI 라우트·게이트·함수 | dev-backend/routes/email_threads.js:52, 1400, 1796, 1884 · services/cue_orchestrator.js:403, 499 · services/mailAutoExtract.js |
| 게스트 링크 모델·해석·라우트·관리 · 그림자 차단 | dev-backend/models/GuestLink.js:163,166,183 · services/guest_link.js:27 · routes/guest.js:53,74,144 · routes/guest_admin.js:47,117 · middleware/auth.js:69 · models/User.js:170 |
| 업무 후보 3스코프 · 브릿지 · 추출 · 공용 카드 | dev-backend/models/TaskCandidate.js:11-15 · routes/qnote_bridge.js:32-50,74 · services/task_extractor.js:658 · dev-frontend/src/components/Common/TaskCandidateCard.tsx:26-34 |
| Task.client_id · created_via | dev-backend/models/Task.js:50, 144 |
| 일정 고객 연결 | dev-backend/models/CalendarEventAttendee.js:10 · models/CalendarEvent.js:9, 81 |
| 거래 단계 엔진 | dev-backend/services/projectStageEngine.js:22-40, 134-291, 293-308, 428-455 |
| 프로젝트 생성 · 상세 탭·client 숨김 | dev-backend/routes/projects.js:80-97, 164-177, 225-230 · dev-frontend/src/pages/QProject/QProjectDetailPage.tsx:146-148, 1121 |
| 서명 요청 · 공개 표면 | dev-backend/routes/signatures.js:111 · routes/signature_public.js:14 · routes/invoices.js:123 · routes/posts.js:1584 |
| Q Note 업로드·과금·원본 삭제 · 접근 술어 · CAPTURE_MODES · 요약 함수 · 마이그레이션 | q-note/routers/audio_upload.py:77-166, 133-147, 193-239, 224, 238 · routers/sessions.py:440-489, 1105-1177, 162 · services/llm_service.py:970 · services/database.py:42-235, 127-137 |
| q-note → Node 내부 호출·키가드 | q-note/services/billing_client.py:56,74,92 · dev-backend/routes/internal.js:32, 117-136, 140-217 |
| 프론트 Q Note 업로드 모달·읽기 모드·추출 버튼 | dev-frontend/src/pages/QNote/AudioUploadModal.tsx:58 · QNotePage.tsx:925-928, 3035 · services/qnote.ts:720 |
| 파일 모델 · 외부 공유 차단 | dev-backend/models/File.js:27,144,150,161-176 · services/securityLevel.js:18 |
| 플랜 한도 계수·화면 | dev-backend/services/plan.js:160, 309 · config/plans.js:21,53,88,119,150 · dev-frontend/src/pages/Settings/PlanSettings.tsx:304-306 · components/Common/UsageWarningCard.tsx:71 |
| 메뉴 권한 키 5곳 + 사이드바 숨김 + 라우트 짝 | dev-backend/middleware/menu_permission.js:32-35,51-53 · routes/businesses.js:975,1006 · services/actions/_subject.js:31 · dev-frontend/src/services/permissions.ts:7 · components/Permissions/MemberPermissionMatrix.tsx:17 · public/locales/{ko,en}/settings.json:530-543 · components/Layout/MainLayout.tsx:917,1293-1344 · config/navMenus.ts:6,36-83 · App.tsx:68,296-300,677 · routes/appRoutes.tsx:78 · scripts/guard-app-routes.js:22-27 · utils/publicSurface.ts:24-30 |
| 알림 (함수·ENUM·설정·링크 짝·드롭다운) | dev-backend/routes/notifications.js:70-83,105,296 · models/NotificationPref.js:31-43 · services/notification_link.js:22-47 · dev-frontend/src/pages/Settings/NotificationSettings.tsx:24-30,133-134 · components/Common/NotificationTypeIcon.tsx:50-66 · utils/notificationLink.ts:17-42 · components/Common/NotificationDropdown.tsx:49-52 · scripts/guard-invariants.js:357-369,385 |
| 확인 필요 / 배지 | dev-backend/routes/dashboard.js:924,978-991,1015,1077 · dev-frontend/src/pages/Todo/TodoPage.tsx:128,133,191 · hooks/useInboxCount.ts:9,21-22,40,52 · components/Layout/MainLayout.tsx:335,878-884,1299-1303 |
| 탭 · 상세 파라미터 | dev-frontend/src/stores/tabStore.ts:12-14,38-53,222-234 · hooks/useDetailParam.ts:9-10,27 · docs/MULTITAB_DESIGN.md:16-17 |
| 검색 | dev-backend/routes/search.js:113,162-164,288-297 · dev-frontend/src/components/Common/GlobalSearchModal.tsx:30,149 |
| 보고서·인사이트 | dev-backend/services/weeklyReviewSnapshot.js:55,124,190,277 · routes/insights.js:9-239 · dev-frontend/src/pages/Insights/InsightsPage.tsx:22-23 |
| 하니스·헬스 | scripts/e2e/run.js:7-43 · scripts/e2e/canary-detail-open.js:38-44 · docs/qa/INSPECTION_PLAYBOOK.md:75-89 · scripts/health-check.js:44-47,207-212 |
| 감사·내보내기·익명화 | dev-backend/services/auditService.js:19-21,59 · routes/admin.js:854,862-868,878-886 · services/accountAnonymize.js:42-44 |
| 마이그레이션·배포 체인 | dev-backend/sync-database.js:36,54 · scripts/migrate-task-hold-status.js:24-45 · scripts/deploy-planq.sh:245,251,262,284 · scripts/dump-schema.js · scripts/schema-snapshot.json · scripts/guard-invariants.js:1464 |
| 정책 문서 | docs/QMAIL_CONTEXT_DESIGN.md §1·§5·§8.5 · docs/GUEST_LINK_DESIGN.md §0·§10 · docs/PERMISSION_MATRIX.md §4.5·§5.8·§7 · docs/VISIBILITY_VOCABULARY.md · docs/QNOTE_STT_BILLING_DESIGN.md · docs/MULTITAB_DESIGN.md · docs/design/B2B_AGENCY_FIT_REVIEW.md |
