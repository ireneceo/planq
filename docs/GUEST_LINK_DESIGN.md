# 무로그인 게스트 링크 설계 (운영 피드백 #259)

> 작성: 2026-08-18 · **Fable 설계 게이트 산출물** (보안 경계 변경 = 고위험 — 설계·구현·배포 3단 전부 Fable 게이트)
> 상태: **설계 초안 — Irene 승인 대기** (하단 §12 미결 질문 6건)
> 근거 코드는 전부 실제로 열어 확인했다. `파일:줄` 표기. 확인 못 한 것은 `[미확인]`.

---

## 1. 목적과 범위

**Irene 확정 범위 (2026-08-18):**
- 초대 토큰 링크(만료·회수·횟수 제한)로 **로그인 없이** 해당 대화방 + 프로젝트 개요를 **열람·작성**.
- 카톡/메일로 링크를 받은 고객이 눌러서 바로 채팅에 참여 — "고객사를 하나도 불편하지 않게".
- **파일 다운로드만 로그인 유도.**
- 게스트 → Client 승격 경로 포함.
- 더 나아가 영업/상담 유입 연결 (이번 구현 범위 아님 — §10 스케치만).

**비범위 (v1):**
- 게스트의 파일/이미지 **업로드** (쓰기는 텍스트만 — 남용 상한)
- 게스트의 메시지 수정/삭제/핀/리액션
- 게스트 소켓 실시간 (v1 은 폴링, §7.4 — 소켓 인증 경계 변경은 Phase 2 로 분리)
- 비밀번호 보호 옵션 (share_helper 에 있으나 "고객 불편 0" 목적과 상충 — 옵션으로도 v1 제외)

---

## 2. 위협 모델 — "링크를 아는 사람 = 접근 가능" 을 전제로 피해 상한을 구조로 묶는다

링크가 카톡방에 공유되는 것이 **정상 사용 시나리오**다. 따라서 토큰 유출을 "막는" 설계가 아니라, 유출됐을 때 **열리는 것의 상한**을 구조로 고정한다.

### 2.1 토큰 하나로 열리는 것 (전부)
| 열림 | 안 열림 (구조적 차단) |
|---|---|
| 지정된 대화방 1개의 고객-노출 메시지 (is_internal=false·삭제 아님·미승인 AI draft 아님) | **다른 어떤 대화방도** — conversation_id 는 항상 링크 row 에서 나온다. 요청 파라미터의 대화방 id 를 절대 신뢰하지 않는다 (§6.1) |
| 그 대화방에 텍스트 메시지 작성 (rate-limit 하) | 내부 메모(is_internal)·직원 전용 internal/group 채널·다른 워크스페이스 |
| 연결된 프로젝트 1개의 **개요 화이트리스트 서브셋** (§5.2) | 프로젝트의 업무 목록·노트·이슈·재무(월 청구액·자동청구 설정)·멤버 이메일 |
| 메시지 안의 이미지 표시 (기존 공개 이미지 경로 — §5.4) | 비이미지 첨부 다운로드 (로그인 유도), Q File/Q Docs/Q Bill 등 다른 표면 전부 |

### 2.2 위협별 대응
| 위협 | 대응 |
|---|---|
| 토큰 무차별 추측 | 32바이트 crypto random (2^256) + 조회 실패 일률 404 + IP 레이트리밋 (§6.2). SignatureRequest 토큰과 동급 (models/SignatureRequest.js:71 — 32바이트 hex 64자) |
| DB 유출 시 토큰 도용 | **토큰은 sha256 해시로 저장** (§4). 기존 share_token 계열은 평문 저장인데, 게스트 토큰은 **쓰기 권한**이라 상향. (SignatureRequest 의 otp_code_hash 가 같은 원칙 — models/SignatureRequest.js:76) |
| 링크가 의도보다 넓게 퍼짐 | 만료(기본 30일)·회수(revoked_at)·워크스페이스 일괄 회수·플랫폼 킬스위치 4단 (§11.2). 사용 이력(use_count·last_used_at·last_used_ip)으로 이상 사용 가시화 |
| 게스트 사칭 (기존 가입 고객으로 위장) | 게스트 메시지의 sender 는 **링크 전용 그림자 계정** — 절대 기존 사용자·기존 Client.user_id 에 붙이지 않는다 (§7.1). 화면에 항상 "게스트" 뱃지 |
| 멤버에게 push 폭탄 / 외부 비용 | 쓰기 rate-limit 토큰당+IP당 이중 (§6.2), 입력 4,000자 캡, Cue 자동응답은 게스트 메시지에 v1 미발화 (§7.3) |
| 서버 로그에 토큰 잔존 | URL 경로에 토큰이 실리므로 nginx access log 에 남는다. **막을 수 없다** — 기존 `/public/*`·`/sign/*` 전부와 동일한 노출이며, 만료·회수·해시저장으로 피해 시간창을 줄이는 것이 상한이다 |
| OG 크롤러가 내용 유출 | 카톡 미리보기(ogMeta.js:21 Kakaotalk-scrap)는 **워크스페이스 브랜드명 + 일반 문구만**. 대화 내용·프로젝트명은 OG 에 싣지 않는다 (§9.4) |
| 삭제된 워크스페이스의 좀비 링크 | invites.js:33-38 `isBizAlive` 패턴 그대로 — 토큰 해석 단일 착지점에서 차단 (§6.1). 게스트 라우트는 authenticateToken 을 안 타므로 auth.js:80-95 의 workspaceAlive 단일 관문이 적용되지 않는다는 사실을 명시적으로 보완 |

### 2.3 막지 못하는 것 (정직하게)
- **링크를 아는 사람이 곧 그 고객이라는 보장은 없다.** 카톡방의 제3자도 같은 대화를 읽고 쓸 수 있다. 이것은 이 기능의 본질적 트레이드오프이며, Irene 이 수용한 전제다. 상한: 그 대화방 하나, 고객-노출 메시지만.
- **nginx access log 의 토큰** (위 표).
- **게스트 명의의 스팸**: rate-limit 으로 속도만 제한. 회수 버튼이 최종 수단.

---

## 3. 기존 공유 시스템 재사용 설계 — 무엇을 그대로 쓰고 무엇을 확장하는가

이 저장소의 공유/토큰 표면은 이미 **3계열**이다. 넷째 계열을 만들지 않는다.

| 계열 | 정체 | 재사용 판정 |
|---|---|---|
| **A. share_token 컬럼** (entity 당 1개, 평문, read-only) — posts/docs/tasks/files/kb/calendar/invoices. share_helper.js + shareTokenCleanup.js(30일 미사용 NULL) + docs/SHARE_PREVIEW_POLICY.md 4중 정책 | 웹 미리보기 read-only 계약 | **패턴·계약 재사용, 컬럼 방식은 부적합.** 이유 3가지: ① entity당 토큰 1개 = 수신자별 회수 불가(고객 A 회수하면 B 도 끊김) ② read-only 계약 + 30일 미사용 자동 NULL cron(services/shareTokenCleanup.js:16) 이 **쓰기 가능한 장수 링크**와 정면 충돌 ③ 평문 저장 — 쓰기 토큰엔 해시 필요. **410 share_expired 응답 계약(share_helper.js:70-89)·토큰 생성 유틸(crypto.randomBytes base64url, share_helper.js:24)·Public 페이지 디자인/SharePasswordPrompt·ogMeta 파이프라인은 그대로 재사용** |
| **B. 수신자별 토큰 테이블** — DocumentShare(models/DocumentShare.js: document_id+share_token+expires_at+viewed_count, 수신자별 추적) · SignatureRequest(polymorphic+OTP+만료+audit+cron) | 수신자별 발급/추적/회수 | **이 계열이 정답 모양.** guest_links 는 DocumentShare 의 "수신자별 토큰 row" 를 대화방에 적용한 것 — 새 체계가 아니라 기존 계열의 확장이다 |
| **C. 초대 토큰** — clients.invite_token(Client.js:31, unique 인덱스) + invites.js resolveToken(3종 분기)·isBizAlive·수락 트랜잭션·ensureWelcomeConversation | 가입 유도 + 신원 귀속 | **승격 합류점으로 재사용** (§8). resolveToken 에 guest_link 를 4번째 분기로 넣지 않는 이유: invite 는 "수락하면 소멸하는 1회성", guest_link 는 "수락 없이도 계속 쓰는 상시 통로" — 의미가 달라 상태기계가 다르다. 대신 승격 시점에 invites 의 workspace_client 수락 로직(중복 흡수·user_id 연결·상태 active)을 서비스 함수로 추출해 **같은 코드**를 탄다 |

추가 재사용 (전부 실존 확인):
- **그림자 계정 선례 = Cue.** 워크스페이스 생성 시 `cue+{biz}@system.planq.kr` + 랜덤 해시 비번 + is_ai=true 인 User row 를 만들고(routes/auth.js:340-350), 로그인은 `if (user.is_ai)` 로 차단(routes/auth.js:458). 게스트 그림자 계정은 이 선례의 복제다 (§7.1).
- **client 메시지 필터 술어** — conversations.js:598-604 (is_internal + 미승인 draft 필터). 게스트 read 는 **같은 함수**를 써야 한다. 현재 인라인이라 이번에 `services/message_visibility.js` 로 추출해 두 소비처가 공유 (memory: 같은 값의 공식이 여러 벌이면 이미 갈라져 있다).
- **costGuard** (middleware/costGuard.js:16-24) — keyGenerator 가 미인증이면 IP 버킷. 게스트용으로 토큰 버킷 keyGenerator 추가 (§6.2).
- **AuditLog** — createAuditLog 그대로.

**결론: 신규 테이블은 `guest_links` 1개, 신규 라우트 파일 1개(`routes/guest.js`), 신규 페이지 1개(`/g/:token`). 그 외 전부 기존 부품.**

---## 4. 데이터 모델

### 4.1 신규 테이블 `guest_links`

```sql
CREATE TABLE guest_links (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  business_id   INT NOT NULL,              -- 멀티테넌트 격리 축. FK businesses
  conversation_id INT NOT NULL,            -- 열람·작성 범위 = 이 대화방 하나. FK conversations
  project_id    BIGINT NULL,               -- NULL = 개요 탭 없음. FK projects (같은 business 강제 검증)
  client_id     INT NOT NULL,              -- 게스트의 명함 = 기존 Client row. FK clients
  token_hash    CHAR(64) NOT NULL UNIQUE,  -- sha256(원문). 원문은 발급 응답에 1회만 노출
  token_hint    CHAR(6) NOT NULL,          -- 원문 앞 6자 — 관리 UI 식별용 (원문 복원 불가)
  guest_name    VARCHAR(100) NOT NULL,     -- 화면 표시명 ("김고객 (게스트)")
  can_write     BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE = 열람 전용 링크
  expires_at    DATETIME NOT NULL,         -- ★ 개정: **마지막 사용 후 90일 슬라이딩** (아래 참조)
  message_count INT NOT NULL DEFAULT 0,    -- 게스트가 쓴 메시지 수 (남용 가시화)
  last_used_at  DATETIME NULL,
  last_used_ip  VARCHAR(45) NULL,
  created_by    INT NOT NULL,              -- 발급자. FK users
  revoked_at    DATETIME NULL,             -- 회수 (단건)
  revoked_by    INT NULL,
  claimed_at    DATETIME NULL,             -- 승격 완료 시각
  claimed_user_id INT NULL,                -- 승격된 실사용자
  created_at / updated_at,
  INDEX (business_id), INDEX (conversation_id), INDEX (client_id),
  INDEX (expires_at)                        -- cron 정리용
);
```

Sequelize 모델 컨벤션은 SignatureRequest.js 와 동일 (class X extends Model, underscored: true).

> ## ★ 2026-09-02 개정 (Fable 설계 판정) — 초안과 **다르게 정한 것 4가지**
>
> 이 문서 초안(2026-08-18)은 §12 에 "Irene 이 정해야 할 것 6건" 을 남기고 멈췄고, 그 미결이
> 그대로 답글로 되돌아갔다. Irene: *"fable이 이대로 제대로 판단할 수 있을까?"*
> 이번 판정은 그 6건을 **전부 결정**했다. 초안과 달라진 곳:
>
> **① 신원 단위 — 링크당(lazy) → 고객당(발급 시점)**
>   초안은 링크마다 그림자 User 를 첫 **작성** 시 만들었다. 두 가지가 깨진다:
>   · 회수 후 재발급하면 그림자가 둘 = **같은 고객이 두 사람으로 갈라진다.** 영업 히스토리
>     축적(#381)을 정확히 막는 결정이다.
>   · 이미지 보안 Stage 2 가 켜지면 이미지 접근 판정이 `canAccessConversation(viewer, conv)` 가
>     된다(middleware/imageViewer.js). 게스트는 **열람만 해도** 신원이 있어야 그 문을 지난다.
>   → `clients.guest_user_id` (고객당 1개), **발급 시점** 생성. `shadow_user_id` 컬럼 삭제.
>
> **② 만료 — 고정 30일 → 마지막 사용 후 90일 슬라이딩**
>   고정 만료는 두 달 전 카톡 메시지의 링크를 누른 고객에게 "만료" 화면을 보여준다 = 불편 =
>   Irene 이 말한 **영업 손상**. 무기한은 퍼진 뒤 회수할 계기가 없다.
>   슬라이딩은 "쓰는 고객은 안 끊기고 떠난 고객의 링크는 죽는" 절충이다.
>   죽은 링크를 눌러도 "담당자에게 요청" 이 아니라 **다음 알림 메일에 새 토큰이 자동으로 실린다**
>   (메일 = 이미 검증된 채널로만 재발급).
>
> **③ 횟수 제한·기기 바인딩 — 삭제**
>   폴링·다기기·"폰 카톡에서 열고 사무실 PC 에서 다시 열기" 에서 정확히 셀 수 없다.
>   초안 §6.3 스스로 "우회 가능·가시화 장치" 라고 인정했다. 없는 편이 낫다.
>   → `max_uses`·`use_count` 컬럼 삭제. 남용 가시화는 `message_count` + rate-limit 이 한다.
>
> **④ 이미지 — 게스트에게 이미지 쿠키를 발급한다**
>   `services/authTokens.js setImageCookie()` 를 게스트 GET 에서 호출한다. `IMAGE_COOKIE_PATHS`
>   에 `/api/message-attachments/public` 이 이미 있어 경로 변경은 없다.
>   이걸 안 하면 Stage 2 를 켜는 날 게스트 화면의 이미지가 전부 깨진다.

### 4.2 기존 테이블 변경 (최소 3건)

| 테이블 | 변경 | 이유 |
|---|---|---|
| `clients` | `guest_user_id INT NULL FK users` 추가 | ★개정 — 그림자 User 를 **고객당 1개**로. 회수·재발급해도 같은 사람 |
| `users` | `is_guest BOOLEAN NOT NULL DEFAULT FALSE` 추가 | 그림자 계정 식별. 로그인/비번재설정/OAuth 매칭 전부 `is_guest` 차단 (is_ai 차단 auth.js:458 과 나란히). 화면 "게스트" 뱃지 근거 |
| `businesses` | `guest_links_enabled BOOLEAN NOT NULL DEFAULT TRUE` 추가 | 워크스페이스 킬스위치 |
| `platform_settings` | `guest_links_enabled BOOLEAN NOT NULL DEFAULT TRUE` 추가 | 플랫폼 전체 킬스위치 (maintenance_mode 와 같은 자리) |

**변경하지 않는 것 (중요):** `messages.sender_id` 는 NOT NULL FK users 그대로 둔다(models/Message.js:17-24). nullable 로 풀면 unread 집계(conversations.js:65-73 `m.sender_id != :uid`)·표시명 enrichment·프론트 sender 소비처 전체가 NULL 분기를 새로 필요로 하는 대수술이다. 그림자 계정이 이 문제를 0 비용으로 흡수한다.

### 4.3 audit
- 발급/회수/일괄회수/승격: `createAuditLog` — action `guest_link.create` / `guest_link.revoke` / `guest_link.revoke_all` / `guest_link.claim` (old/new JSON).
- 게스트 메시지 작성: 기존 `message.create` 패턴(conversations.js:672-678) + `meta.via='guest_link'`. 게스트 조회는 audit 미기록 (row 폭증 방지) — guest_links 의 use_count/last_used_* 가 그 역할.

---

## 5. 접근 제어 규칙표 — 엔티티 × 필드 (fail-closed)

**원칙: 게스트 응답은 전부 화이트리스트 serializer.** 모델 toJSON 후 exclude 가 아니라, **나열한 필드만 담는 전용 함수** (`serializeGuestConversation` / `serializeGuestMessage` / `serializeGuestProject`). 새 컬럼이 생겨도 게스트에게 자동으로 새지 않는다. 판단 불가 = 미노출.

### 5.1 Conversation / Message

| 필드 | 게스트 | 근거 |
|---|:-:|---|
| conversation: title(display_name), business 브랜드명 | ✅ | |
| conversation: cue_* · translation_* · last_extracted_* · archived_by 등 운영 필드 | ❌ | 화이트리스트 밖 |
| message: id, content, kind, created_at, is_edited, edited_at, sender 표시명+is_ai+is_guest, reply_to_message_id | ✅ | |
| message: `is_internal=true` (내부 메모) | ❌ **행 자체 제외** | conversations.js:598-604 의 client 필터와 **같은 추출 함수** 사용 (§3) |
| message: `is_deleted=true` | ❌ 행 제외 | 동일 함수 |
| message: 미승인 Cue draft (`is_ai && ai_mode_used='draft' && ai_draft_approved !== true`) | ❌ 행 제외 | 동일 함수 |
| message: ai_confidence·ai_sources·ai_model·cue_rating 등 AI 내부 메타 | ❌ | 화이트리스트 밖 |
| message: sender 의 email·user_id 원값 | ❌ | 표시명만. 멤버 이메일은 게스트에게 자산이 아니라 부채 |
| card 메시지 (kind='card') | ✅ 제목+card_type 만 | meta 의 share_url 은 그 자체가 별도 토큰 게이트라 노출 가능하나, v1 은 보수적으로 **제목만** 렌더 + "로그인 후 열람" [Irene 취향 반영 여지] |
| 첨부: 이미지 (mime image/*) | ✅ inline 표시 | 기존 무인증 공개 경로 재사용 — message_attachments.js:271-313(raw)·315-341(public, image MIME only 게이트). **이미 로그인 없이 열리는 표면**이므로 새 구멍이 아님 |
| 첨부: 비이미지 (pdf/zip/...) | ❌ 파일명+크기만, 다운로드 = 로그인 CTA | Irene 확정 비범위. 기존 인증 다운로드(message_attachments.js:246-266) 그대로 |
| 리액션·핀 목록·참여자 전체 목록 | ❌ (v1) | 참여자 이메일 노출 경로 차단. 대화 상단에 "OO팀과의 대화" 워딩만 |

### 5.2 Project (개요 서브셋)

`loadProjectDetail`(projects.js:2758-2773)은 **재사용 금지** — ProjectMember include 에 `User.email` 이 실려 있다(projects.js:2765). 전용 serializer 로 아래만:

| 필드 | 게스트 | 비고 |
|---|:-:|---|
| name, description, status, start_date, end_date, color, client_company | ✅ | |
| 멤버: 워크스페이스 표시명 + 역할 라벨만 | ✅ | email·user_id ❌ |
| 진행 요약: 업무 총수/완료수 (집계 숫자만) | ✅ | 개별 업무 제목·담당자 ❌ |
| project_stages: kind·label·status (거래 시퀀스 타임라인) | ✅ | linked_entity_id ❌ |
| 재무 전부 (monthly_fee·billing_*·auto_invoice_*), invite_token 류, project_notes, project_issues, 업무 목록 | ❌ | notes 는 visibility ENUM(personal/internal/shared, ProjectNote.js:13-20)이 있어도 **행 단위 오판 리스크가 있으니 통째로 미노출** (fail-closed) |

### 5.3 그 외 전부 ❌
Q Task 상세·Q File·Q Docs·Q Bill·KB·멤버 목록·다른 대화방 — 게스트 라우트에 endpoint 자체가 없다. 없는 라우트가 가장 강한 차단이다.

### 5.4 visibility 4단계와의 정합
docs/VISIBILITY_VOCABULARY.md 기준 게스트 = **L4 (외부)** 소비자다. L4 로 명시 공유된 것(이 링크가 가리키는 대화방 + 개요 서브셋)만 보이고, L1(개인)·L2(팀)·L3(워크스페이스) 자산은 게스트 표면에 라우트가 없어 구조적으로 닿지 않는다. Cue audience 절단과 같은 원칙: **수신자(게스트) 기준으로 자르는 지점이 serializer 화이트리스트 + 메시지 필터 함수 딱 두 곳**이고, 두 곳 다 fail-closed 다.

---

## 6. API 설계

### 6.1 토큰 검증 단일 착지점

```
services/guest_link.js :: resolveGuestLink(rawToken)
  1. hash = sha256(rawToken) → GuestLink.findOne({ token_hash: hash })   // 없으면 404
  2. revoked_at !== null            → 404 (무엇이 있었는지 누설 X — SHARE_PREVIEW_POLICY §1 ③ 동일)
  3. expires_at < now               → 410 { code:'share_expired' } (share_helper.checkShareExpiry 계약 재사용)
  4. max_uses && use_count >= max   → 410
  5. PlatformSetting.guest_links_enabled === false → 404   // 플랫폼 킬스위치 (5분 캐시, ogMeta 패턴)
  6. Business alive + guest_links_enabled          → 404   // invites.js isBizAlive 패턴
  7. Conversation 존재 + business_id 일치 + archived_at IS NULL → 404
  8. project_id 있으면 Project 존재 + business_id 일치 확인 — 불일치면 개요만 조용히 제외 (fail-closed)
  → { link, conversation, business, project|null }
```

**IDOR 불가 구조**: 모든 게스트 라우트의 대화방·프로젝트는 **이 함수의 반환값에서만** 나온다. `req.params`/`req.body` 의 conversation_id·project_id·business_id 는 어떤 게스트 라우트에도 존재하지 않는다. (standalone 대화 IDOR 전례 — memory feedback_standalone_conv_access_check — 의 재발 차단은 "검사를 잘 하는 것"이 아니라 "파라미터를 아예 안 받는 것"으로 한다.)

### 6.2 공개 라우트 목록 (신규 `routes/guest.js`, 마운트 `app.use('/api/guest', ...)`)

| 라우트 | 인증 | rate-limit | 입력 캡 |
|---|---|---|---|
| `GET /api/guest/:token` — 링크 검증 + 대화방 메타 + 개요 서브셋 | 없음 (토큰이 자격) | IP 30/분 + 토큰 60/분 | — |
| `GET /api/guest/:token/messages?after_id=` — 필터된 메시지 (폴링용, limit 100) | 없음 | 토큰 30/분 (5초 폴링=12/분 여유) + IP 60/분 | after_id 정수 검증 |
| `POST /api/guest/:token/messages` — 텍스트 작성 | 없음 + `can_write` 검사 | **토큰 10/분·300/일 + IP 20/분** (costGuard.perUserDaily 에 guest keyGenerator 추가) | content ≤ 4,000자 (capText), 빈 문자열 400, 제어문자 strip |
| `POST /api/guest/:token/claim` — 승격 (§8) | **authenticateToken 필수** | 토큰 5/분 | — |
| 관리 (멤버용, 기존 인증 체계): `POST/GET/DELETE /api/conversations/:businessId/:id/guest-links[/:linkId]` + `POST /api/businesses/:id/guest-links/revoke-all` | authenticateToken + attachWorkspaceScope, **member 이상** (scope.isClient 거부) + 대화방 접근 canAccessConversation | 발급 10/분 (perUserLimiter) | guest_name ≤ 100자, expires ≤ 180일 |

- 전 라우트에 전역 apiLimiter 600/분(middleware/security.js:227-248)이 추가로 얹힌다.
- 발급 응답에만 원문 토큰 1회 포함: `{ url: APP_URL + '/g/' + token, expires_at, ... }`. 이후 조회는 token_hint 6자만.

### 6.3 사용 횟수의 정의
"횟수 제한"(Irene 원문)의 단위는 **신규 브라우저 세션 진입**으로 정의한다 (요청 수로 세면 폴링이 곧 소진). 구현: `GET /api/guest/:token` 성공 시 use_count+1 + 프론트가 sessionStorage 에 진입 마크 → 같은 세션 재검증은 `?revisit=1` 로 카운트 제외. 우회 가능(마크 지우기)하지만 max_uses 는 보안장치가 아니라 **운영 가시화 장치**다 — 보안은 만료·회수가 담당. [이 정의는 Irene 확인 필요 §12-Q5]

### 6.4 라우터 마운트 순서 주의
- `/api/guest` 는 **고유 prefix** — 기존 어떤 라우터와도 경로가 겹치지 않는다. server.js:352-435 사이 어디든 안전하나, 공개 라우트 선례(server.js:353-354 app_download·platform_public) 옆에 나란히 두어 "공개 표면 목록"이 한 곳에 보이게 한다.
- 라우트 파일 내부: `/:token` 이 광범위 매칭이므로 **구체 경로 없음 확인** — guest.js 안에 다른 GET 라우트를 추가할 일이 생기면 `/:token` 보다 위에 (feedback_express_route_order).
- errorHandler(server.js:438) 앞. maintenance 미들웨어(server.js:278)는 게스트 라우트에도 적용됨 — 점검 모드 시 게스트도 차단 (의도된 동작).

---

## 7. 메시지 작성 규약

### 7.1 sender = 링크 전용 그림자 계정 (Cue 선례 복제)

- **첫 작성 시점에 lazy 생성** (열람만 하는 링크는 users row 를 만들지 않는다):
  ```
  User.create({
    email: `guest+gl${link.id}@guest.planq.kr`,   // Cue 의 cue+{biz}@system.planq.kr 패턴 (auth.js:340-350)
    password_hash: bcrypt(random),                 // 로그인 불가
    name: link.guest_name, is_guest: true, is_ai: false,
    platform_role: 'user', status: 'active',
  })
  → link.shadow_user_id 저장 (트랜잭션, 동시 첫-작성 race 는 link row FOR UPDATE 로 직렬화)
  → ConversationParticipant.create({ conversation_id, user_id: shadow, role: 'client' })
  ```
- 왜 그림자 계정인가: `messages.sender_id NOT NULL FK users`(§4.2) 를 건드리지 않고, unread 집계·표시명·client 필터·참여자 목록 등 **기존 파이프라인 전체가 무변경으로 동작**한다. 선례는 Cue(is_ai)로 이미 운영 검증됨.
- **절대 규칙: 기존 사용자(가입 Client 포함)를 sender 로 쓰지 않는다.** 링크 소지 = 그 사람이라는 보장이 없으므로, 게스트 메시지는 영원히 "게스트 명의"다. 승격(§8)만이 명의를 실사용자로 바꾼다.
- 로그인 경계 보강 (보안 경계 변경 diff 에 포함): `routes/auth.js` 로그인(:458 is_ai 차단 옆)·forgot-password·OAuth 이메일 매칭·refresh 에 `is_guest` 차단 추가. `@guest.planq.kr` 도메인은 메일 발송 대상에서 제외 (memory feedback_no_automail_unverified 정합).

### 7.2 작성 경로 — 기존 메시지 파이프라인과 한 몸

CLAUDE.md 운영 안정성 13번(notify 강제)·16번(실시간 5요소) 준수를 위해, conversations.js POST(:624-745) 의 **메시지 생성+emit+notify 블록을 `services/message_send.js::sendConversationMessage()` 로 추출**하고 기존 라우트와 게스트 라우트가 같은 함수를 탄다 (두 벌 금지). 게스트 호출 시:
- `is_internal` 강제 false (client 와 동일 — conversations.js:640 술어 재사용)
- socket: `io.to('conv:{id}')` + `io.to('business:{bizId}')` 에 `message:new` (conversations.js:664-668 그대로) — **멤버 쪽 실시간은 기존 그대로 즉시 반영**
- notify: 참여자 fan-out eventKind='message' (conversations.js:724-731). 멘션 resolve 는 게스트 입력에도 동작하나 **v1 은 게스트 발 멘션 알림을 일반 message 로 강등** (게스트가 @owner 폭탄으로 강조 알림 남용 방지)
- `Message.meta = { via: 'guest_link', guest_link_id }` — 운영 추적 + 프론트 뱃지 근거
- link.message_count+1, last_used_at 갱신

### 7.3 Cue
cue_orchestrator 의 자동응답은 고객 발화 트리거인데(memory feedback_cue_client_only), 게스트 메시지에 Cue 가 자동 응답하면 **무로그인 표면에서 LLM 비용이 발생**한다. v1 은 게스트 메시지에 Cue 자동응답 **미발화** (sendConversationMessage 에 suppress 플래그). Irene 이 영업 시나리오에서 원하면 Phase 2 에서 별도 rate-limit 과 함께 개방 [§12-Q6].

### 7.4 게스트 쪽 실시간
소켓 인증(server.js:45-51)은 JWT 전제라 게스트는 못 탄다. **v1 = 5초 폴링** (`GET .../messages?after_id=`). 게스트 JWT 를 발급해 소켓에 태우는 안은 기각 — 같은 JWT_SECRET 으로 서명된 토큰이 authenticateToken(auth.js:29)을 그림자 계정 명의로 **통과해 버릴 수 있는** 위험(decoded.userId 가 실존 user 를 가리키면 전체 client API 가 열림)이 있어, 소켓 경계를 손대는 것은 Phase 2 의 독립 설계·게이트 대상으로 분리한다.

### 7.5 워크스페이스 사용자에게 보이는 것
- 채팅: 이름 옆 **회색 "게스트" 뱃지** (`sender.is_guest`) + participant 목록에 "김고객 (게스트)".
- 링크 관리 패널(대화방 우측): 활성 링크 목록 (guest_name·token_hint·만료·use_count·message_count·[회수]).
- 알림 문구: "김고객 (게스트) · {대화방}" — 표시명 파이프라인(getMemberDisplayName)이 User.name 폴백으로 자동 처리, 스윕에서 뱃지 누락만 확인.

---

## 8. 게스트 → Client 승격

**전제 정합**: 링크 발급 시점에 이미 Client row 가 있거나 만든다 (memory: 고객 초대 = Client 즉시 생성). 발급 UI 에서 기존 Client 선택 또는 새 Client 즉시 생성(display_name = guest_name, status 'invited') → `guest_links.client_id`.

**승격 트리거**: 게스트 화면 상단 배너 "계정을 만들면 파일 다운로드와 알림을 받을 수 있어요" → `/register?guest_token=...`(또는 로그인) → 가입/로그인 완료 후 프론트가 `POST /api/guest/:token/claim` (인증됨).

**claim 트랜잭션** (invites.js workspace_client 수락 분기 :266-289 의 로직을 서비스로 추출해 공유):
1. resolveGuestLink 재검증 (만료·회수면 승격도 불가 — fail-closed)
2. Client 귀속: `client.user_id = req.user.id, status 'active', accepted_at` — 같은 (business_id, user_id) 중복 Client 있으면 invites.js:269-277 과 동일하게 흡수. **단 client.user_id 가 이미 다른 실사용자면 409 거절** (남의 Client 를 링크로 탈취 금지)
3. 그림자 이력 이관 (있으면): `messages.sender_id: shadow → real`(이 링크 발 메시지만 — meta.guest_link_id 기준), ConversationParticipant shadow row 를 real 로 교체(이미 참여 중이면 shadow row 삭제), shadow User `status='deleted'`
4. `guest_links.claimed_at/claimed_user_id` 기록 + **revoked_at = NOW()** — 승격 후 링크는 소멸, 이후 접근은 로그인으로 (같은 링크가 카톡방에 남아 제3자가 계속 쓰는 것 차단)
5. audit + `client:updated` broadcast (invites.js broadcastAccept 패턴) + 초대자 notify
6. 응답 redirect '/talk' — 이후는 정식 Client 경로 (환영 대화방 로직 ensureWelcomeConversation 은 이미 대화방이 있으므로 미호출)

주의: 4번 때문에 **한 링크를 여러 사람이 쓰다 한 명이 승격하면 나머지는 끊긴다.** 이것은 의도된 수렴이다 — 나머지가 필요하면 멤버가 새 링크를 발급한다.

---

## 9. UI / 화면 (모바일 우선 — 카톡에서 눌러 들어온다)

### 9.1 게스트 페이지 `/g/:token` (신규 `pages/Guest/GuestConversationPage.tsx`)

```
┌──────────────────────────────┐
│ {워크스페이스 브랜드}         │  ← PanelHeader 아님 — Public* 페이지 톤 (SHARE_PREVIEW_POLICY §3)
│ {대화방 이름} · 게스트로 참여 │
├──────────────────────────────┤
│ [배너] 계정 만들면 파일 다운로드·알림 → [시작하기]   (dismiss 가능, role=complementary)
├──────────────────────────────┤
│ [대화] [프로젝트 개요]        │  ← project_id 있을 때만 탭 2개
│                              │
│  메시지 리스트 (5s 폴링)      │  이미지 inline · 비이미지 = 파일명 + 🔒 로그인 후 다운로드
│  …                           │
├──────────────────────────────┤
│ [입력창          ] [보내기]   │  ← can_write=false 면 "열람 전용 링크입니다"
└──────────────────────────────┘
```
- 풀스크린 단일 컬럼, 인증 SPA 셸(사이드바) 미노출. App.tsx:186 공개 경로 판정에 `/g/` 추가, 라우트는 :551-560 Public 블록 옆에.
- 상태 화면 3종: 만료(410 share_expired — 기존 만료 페이지 패턴), 회수/무효(404 — "링크가 더 이상 유효하지 않습니다 + 담당자에게 새 링크 요청"), 점검 모드.
- 입력 UX: 모바일 키보드 가림 규칙 준수(body[data-keyboard-up]), 중복 제출 가드, Enter 단독 전송은 채팅 표면이라 허용(기존 ChatPanel 과 동일 동작 [미확인 — 구현 시 ChatPanel 정책 확인]).
- i18n: 신규 네임스페이스 `guest` ko/en 동시 작성, i18n.ts ns 등록.

### 9.2 발급 모달 (멤버용 — ShareModal 계열 디자인 복제, bespoke 금지)
Q Talk 대화방 헤더 "게스트 링크" → 모달: 게스트 이름(필수) / 기존 고객 연결 or 새로 만들기 / 만료 7·30·90일 / 열람전용 토글 / 프로젝트 개요 포함 토글 → [발급] → URL 1회 표시 + 복사 버튼 + "이 링크를 아는 사람은 누구나 이 대화방을 보고 쓸 수 있어요" 경고문.

### 9.3 관리 화면
대화방 상세 패널 내 "게스트 링크" 섹션(목록+회수) + 워크스페이스 설정 > 보안에 `guest_links_enabled` 토글 + [모든 게스트 링크 회수] (Danger, 확인 모달 — window.confirm 금지, 기존 확인 모달 컴포넌트).

### 9.4 링크 → 앱/OG
- **ogMeta**: `/g/:token` 봇 요청 시 워크스페이스 브랜드명 + "대화에 초대되었습니다" 일반 문구만. 토큰 resolve 실패 시 플랫폼 기본 OG (존재 여부 누설 없음).
- **UL/AL**: `/g/*` 는 `/public/*`·`/sign/*` 과 같은 "브라우저 유지" 분류 — memory project_link_app_open_prelaunch 의 출시 전 정비 목록(iOS AASA exclude·Android pathPrefix allowlist·NativeBridge Browser.open 위임·OpenInAppBanner 숨김)에 `/g/` 추가를 **이 설계와 함께 박제** (지금 앱 미출시라 실효 0이지만, 목록에 안 넣으면 출시 순간 게스트 링크가 앱을 열어 Irene 예외 위반).

---

## 10. 영업·상담 확장 경로 (다음 단계 스케치 — 이번 구현 범위 아님)

Irene 의 킥 포인트: "영업/상담까지 연결". 이 설계가 그 기반이 되는 이유 — 게스트 링크는 "대화방을 밖으로 여는 문"인데, 영업은 같은 문을 **밖에서 두드리는 방향**이다.

1. **상담 시작 링크 (워크스페이스 공개 문)**: `/w/{slug}/contact` 공개 폼(이름+연락처+용건) → Client(kind='customer') 자동 생성 + customer 대화방 자동 생성 + **게스트 링크 자동 발급** → 방문자는 가입 없이 즉시 채팅 시작, 팀은 Q Talk 에서 응대. 스팸 방어(캡차+IP 리밋) 필수라 별도 설계 게이트.
2. **Cue 1차 응대**: 상담 대화방에 한해 Cue 자동응답 개방(§7.3 플래그 역전) + KB RAG — "영업 시간 외에도 첫 응답".
3. **승격 퍼널 계측**: guest_links 의 use_count → message_count → claimed_at 이 그대로 전환 퍼널 데이터다. /insights 에 "게스트 유입 → 가입 전환" 위젯.
4. **랜딩/제안서 연결**: Q Docs 제안서 public 페이지 하단 CTA "이 제안에 대해 바로 채팅하기" → 1번 문으로 합류.

---

## 11. 리스크 · 구현 순서 · 킬스위치

### 11.1 구현 순서 (중간 어느 지점에서 멈춰도 안전)
| 단계 | 내용 | 멈춰도 안전한 이유 |
|---|---|---|
| **1. 읽기 전용** | guest_links 테이블 + resolveGuestLink + GET 2종 + `/g/:token` 열람 화면 + 발급/회수 UI + 킬스위치 3종 + audit | 쓰기 없음 = 기존 `/public/*` 미리보기와 동급 리스크. 메시지 필터 함수 추출(§3)이 이 단계 — 기존 client 필터 회귀 검증 포함 |
| **2. 작성** | sendConversationMessage 추출 + 그림자 계정 + POST messages + rate-limit + is_guest 로그인 차단 스윕 | 1단계가 이미 운영 중이어도 POST 라우트만 미배포 상태 유지 가능 |
| **3. 승격** | claim + invites 수락 로직 서비스 추출 + register 핸드오프 | 없어도 1·2는 완결 (승격 배너만 숨김) |
| **4. (Phase 2, 별도 게이트)** | 게스트 소켓 실시간 · Cue 개방 · 상담 시작 링크(§10) | 각각 독립 보안 설계 필요 |

### 11.2 킬스위치 (사고 시 즉시 차단 — 4단)
1. `platform_settings.guest_links_enabled=false` — **플랫폼 전체 즉시 차단** (admin 토글, 캐시 5분이므로 invalidate 훅 포함)
2. `businesses.guest_links_enabled=false` — 워크스페이스 단위
3. [모든 게스트 링크 회수] — `UPDATE guest_links SET revoked_at=NOW() WHERE business_id=?`
4. 단건 회수
- 전부 resolveGuestLink 단일 착지점에서 판정되므로 **우회 경로가 없다.** 롤백: 신규 테이블+신규 라우트라 코드 롤백만으로 표면이 사라진다 (스키마 롤백 불요 — 테이블 잔존 무해).

### 11.3 주요 리스크와 검증 계획 (구현 게이트에서 Fable 이 실측할 것)
| 리스크 | 검증 |
|---|---|
| 메시지 필터 추출 회귀 — 기존 client 화면에 내부 메모 노출 | 추출 전후 client 계정 실HTTP 응답 diff 0 + **반증**: is_internal 메시지 심고 member/client/guest 3 관점 응답 확인 |
| serializer 화이트리스트 누수 | 게스트 응답 JSON 전 키 스냅샷을 규칙표(§5)와 대조 + email 문자열 grep 0건 |
| IDOR | 타 워크스페이스 conversation_id 로 만든 위조 요청 전수 404 (파라미터 자체가 없음을 코드 리뷰로도 확인) |
| 그림자 계정 로그인 우회 | guest+ 이메일로 login/forgot/OAuth 시도 → 전부 거부 실측 |
| rate-limit fail-open | 11회째 POST 429 실측 (가드는 깨뜨려 확인 — feedback_guard_must_be_falsified) |
| 킬스위치 | 토글 후 기존 유효 링크 404 실측 (양성 대조군: 토글 전 200) |
| notify/broadcast | 게스트 POST 후 3초 내 push_logs row ≥1 + 2탭 시나리오 (CLAUDE.md 13·16번 패턴) |

---

## 12. Irene 이 정해야 할 것 (6건)

1. **게스트 표시명** — 발급자가 지정(현 설계)으로 충분한가, 게스트 본인이 첫 진입 때 이름을 입력/수정하게 할까? (카톡방 다수 인원이 한 링크를 쓰는 경우 후자가 자연스러움 — 단 링크당 명의 1개 원칙은 유지)
2. **card 메시지** — 게스트에게 제목만(현 설계) vs 카드의 공개 미리보기 링크까지 개방? (각 카드는 자체 share_token 게이트가 있어 개방해도 상한은 있음)
3. **만료 정책** — 기본 30일·최대 180일로 제안. 영업 통로로 쓰려면 "무기한 + 회수로 관리" 허용이 필요한가?
4. **열람 전용 링크 옵션**(can_write 토글) — 발급 UI 에 노출할까, v1 은 항상 쓰기 허용으로 단순화할까?
5. **횟수 제한의 단위** — "신규 브라우저 세션 진입" 정의(§6.3)로 갈지, 아예 v1 에서 횟수 제한을 빼고 만료+회수만 둘지 (내 권고: **빼는 것** — 정확히 셀 수 없는 숫자는 없는 게 낫다)
6. **Cue 자동응답** — 게스트 메시지에 v1 미발화(현 설계) 동의 여부

---

## 부록 — 근거 코드 인덱스
| 항목 | 위치 |
|---|---|
| 라우터 마운트 순서·공개 라우트 선례 | dev-backend/server.js:352-435 (:353-354 공개, :431 share, :438 errorHandler) |
| authenticateToken·optionalAuth·workspaceAlive 단일관문 | dev-backend/middleware/auth.js:14-116, 118-146, 80-95 |
| canAccessConversation / conversationListWhere | dev-backend/middleware/access_scope.js:157-170, 172-190 |
| 대화 상세 client 필터 (추출 대상) | dev-backend/routes/conversations.js:598-604 |
| 메시지 POST + emit + notify (추출 대상) | dev-backend/routes/conversations.js:624-745 (:640 internal 차단, :664-668 socket, :685-732 notify) |
| messages.sender_id NOT NULL FK | dev-backend/models/Message.js:17-24 |
| Cue 그림자 계정 생성·로그인 차단 | dev-backend/routes/auth.js:340-350, :458 |
| Client invite_token·수락 트랜잭션·isBizAlive | dev-backend/models/Client.js:31 · routes/invites.js:33-38, 118-289 |
| share_helper (토큰 생성·만료 410 계약) | dev-backend/services/share_helper.js:24, 70-89 |
| share_token 30일 미사용 cron (재사용 불가 사유) | dev-backend/services/shareTokenCleanup.js:16 |
| DocumentShare 수신자별 토큰 선례 | dev-backend/models/DocumentShare.js |
| SignatureRequest 해시·audit 선례 | dev-backend/models/SignatureRequest.js:71-108 |
| costGuard keyGenerator | dev-backend/middleware/costGuard.js:16-24 |
| 전역 apiLimiter 600/분 | dev-backend/middleware/security.js:227-248 |
| 첨부 이미지 무인증 공개 / 비이미지 인증 다운로드 | dev-backend/routes/message_attachments.js:271-341, 246-266 |
| ogMeta 봇 UA·skip prefix | dev-backend/middleware/ogMeta.js:21, 24 |
| public by-token 라우트 패턴 | dev-backend/routes/posts.js:1246-1305 |
| loadProjectDetail 의 email 노출 (재사용 금지 사유) | dev-backend/routes/projects.js:2758-2773 (:2765) |
| 프론트 공개 경로 판정·Public 라우트 블록 | dev-frontend/src/App.tsx:186, 551-560 |
| 소켓 JWT 인증 (게스트 소켓 보류 사유) | dev-backend/server.js:45-51 |
| 정책 문서 | docs/SHARE_SYSTEM_UNIFIED.md · docs/SHARE_PREVIEW_POLICY.md · docs/VISIBILITY_VOCABULARY.md |
