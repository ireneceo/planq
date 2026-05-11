# PlanQ Survey 시스템 — 설계 (MVP 최소 확장)

> 작성: 2026-05-11 (사이클 N+8 follow-up)
> 상태: **기획·설계 박제** — 코드 구현은 일정 결정 후 별도 사이클
> 작업 분량: MVP 4 사이클
> 검토: signature 인프라 50% 재사용 + 응답 수집·집계 신설

이 문서는 "서명을 보내듯이 설문을 보내는" 기능의 최소 확장 범위 설계. 30년차 솔루션 기획 관점에서 빌더 복잡도와 사용 빈도 트레이드오프 분석 후 MVP 항목 확정.

---

## 1. 본질 정의

**설문** = PlanQ 안에서 워크스페이스 owner/member 가 질문지를 작성·발송하고 응답을 수집·집계하는 독립 자산.

- SignatureRequest 와 패턴 유사 (token + 메일/SMS + OTP + 만료 + audit)
- 본질 차이: 응답이 구조화 데이터 (질문별 답) + 집계 필요
- Q docs / Q project / Q Talk 에 포함되는 게 아니라 **독립** (사용자 지적: 문서 자체가 설문이 될 수 없음. 별도 자산)

---

## 2. 사용 사례 (예측 빈도)

| 사용 사례 | 익명 | 식별 | 응답 수 | 빈도 |
|---|:-:|:-:|:-:|:-:|
| 프로젝트 종료 만족도 (외부 고객) | ✅ | | 1~5 | ★★★ |
| 팀 회고 / 분기 설문 (내부 멤버) | ✅ | ✅ | 5~20 | ★★ |
| 사전 인터뷰 질문지 (신규 고객) | | ✅ | 1~10 | ★★ |
| 외부 인사이트 수집 (공개 링크) | ✅ | | 50+ | ★ |
| 업무 우선순위 투표 | ✅ | | 3~10 | ★ |

→ 워크스페이스당 월 5~20건 추정. MVP 5 질문 타입 + 익명/식별 둘 다 지원으로 90% 커버.

---

## 3. MVP 범위 (확정)

### 포함 ✅

| 항목 | 비고 |
|---|---|
| 5 질문 타입 | 단답 / 장답 / 단일선택 / 다중선택 / 평점 1-5 |
| 익명/식별 둘 다 | survey 단위 토글 (`anonymous BOOLEAN`). 기본값 = 식별 |
| 발송 채널 3종 | 이메일 / SMS / 공개 링크 |
| 권한 보호 | 비번 (signature 패턴 재사용) + 만료 |
| 응답 집계 | 응답률 + 질문별 단순 차트 (radio·checkbox 카운트 / 평점 평균) |
| CSV export | 응답 list + 응답자 정보 |
| 발송 진입점 2종 | `/surveys` 메뉴 (신규) + Q Talk 채팅방 카드 발송 |
| Q project 연계 | `survey.project_id` FK 옵션 — 프로젝트 종료 시 자동 발송 트리거 (후속 v1.1) |
| 응답 1회 제한 / N회 허용 | survey 단위 토글 (`multiple_responses BOOLEAN`) |
| 만료 + 리마인더 | 응답 안 한 recipient 에게 D-3 / D-1 자동 메일 |
| OTP 인증 (식별 모드) | recipient 이메일 매칭 또는 OTP 코드 |
| 모바일 최적화 | 응답 페이지 풀스크린, 터치 타겟 44+ |

### 제외 ❌ (v2 / v3 / 영구)

| 항목 | 이유 |
|---|---|
| Conditional logic (분기) | 빌더 복잡도 ×2~3, 사용 빈도 10% 미만. v2 |
| File upload question type | 별도 스토리지 가드 필요. v2 |
| Matrix / grid 질문 | 사용 빈도 낮음. v3 |
| Date / time picker 질문 | MVP 의 5 타입으로 단답 대체 가능. v2 |
| 응답 부분 저장 | 모바일 떠나도 살아남기. v2 |
| 응답 후 분석 자동 차트 (advanced) | 단순 카운트로 충분. v2 |
| 응답자 segmentation | 사용 빈도 낮음. v3 |
| Q docs 문서에 설문 첨부 | 사용자 지적: 문서 자체가 설문. 별 의미 없음 |
| 응답 알림 (응답이 들어왔을 때 notify) | 즉시 알 필요 없음, 일/주 집계로 충분. v2 |

---

## 4. 데이터 모델 (확정)

```sql
-- ─────────────────────────────────────────────────────────────
-- surveys — 설문 정의
-- ─────────────────────────────────────────────────────────────
CREATE TABLE surveys (
  id INT PRIMARY KEY AUTO_INCREMENT,
  business_id INT NOT NULL,                    -- workspace 격리 (필수)
  owner_user_id INT NOT NULL,                  -- 작성자
  title VARCHAR(200) NOT NULL,
  description TEXT,
  status ENUM('draft', 'active', 'closed') DEFAULT 'draft',
  questions JSON NOT NULL,                     -- [{id, type, label, options?, required, helpText?}]
  anonymous BOOLEAN DEFAULT FALSE,             -- 익명 응답 허용
  multiple_responses BOOLEAN DEFAULT FALSE,    -- 동일인 다중 응답
  expires_at TIMESTAMP NULL,
  share_token CHAR(36) UNIQUE,                 -- 공개 링크 (signature 패턴)
  share_password_hash VARCHAR(255),            -- 옵션
  project_id INT NULL,                         -- Q project 연계 (옵션)
  client_id INT NULL,                          -- Q client 연계 (옵션)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  INDEX idx_business_status (business_id, status),
  INDEX idx_share_token (share_token)
);

-- ─────────────────────────────────────────────────────────────
-- survey_recipients — 개별 발송 대상 (1:N)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE survey_recipients (
  id INT PRIMARY KEY AUTO_INCREMENT,
  survey_id INT NOT NULL,
  channel ENUM('email', 'sms', 'client_link') NOT NULL,
  target_email VARCHAR(255),
  target_phone VARCHAR(50),
  target_client_id INT NULL,
  recipient_token CHAR(36) UNIQUE NOT NULL,    -- 개별 응답 링크
  sent_at TIMESTAMP NULL,
  viewed_at TIMESTAMP NULL,
  responded_at TIMESTAMP NULL,
  reminded_count INT DEFAULT 0,
  last_reminded_at TIMESTAMP NULL,
  status ENUM('pending', 'sent', 'viewed', 'responded', 'expired', 'revoked') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
  FOREIGN KEY (target_client_id) REFERENCES clients(id) ON DELETE SET NULL,
  INDEX idx_survey_status (survey_id, status),
  INDEX idx_recipient_token (recipient_token)
);

-- ─────────────────────────────────────────────────────────────
-- survey_responses — 응답 row
-- ─────────────────────────────────────────────────────────────
CREATE TABLE survey_responses (
  id INT PRIMARY KEY AUTO_INCREMENT,
  survey_id INT NOT NULL,
  recipient_id INT NULL,                       -- NULL = 익명 공개 링크
  answers JSON NOT NULL,                       -- { qid: answer, ... }
  ip_address VARCHAR(64),
  user_agent VARCHAR(500),
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES survey_recipients(id) ON DELETE SET NULL,
  INDEX idx_survey_submitted (survey_id, submitted_at)
);
```

### questions JSON 형식

```json
[
  {
    "id": "q1",
    "type": "short_text",                     // short_text|long_text|radio|checkbox|rating
    "label": "회의 만족도 한 줄로 적어주세요",
    "required": true
  },
  {
    "id": "q2",
    "type": "rating",
    "label": "전체 만족도 (1-5)",
    "scale": 5,
    "required": true
  },
  {
    "id": "q3",
    "type": "radio",
    "label": "가장 인상깊었던 부분?",
    "options": ["기획", "디자인", "개발", "기타"],
    "required": false
  },
  {
    "id": "q4",
    "type": "checkbox",
    "label": "다음에 다루고 싶은 주제 (복수 선택)",
    "options": ["A", "B", "C", "D"],
    "required": false,
    "helpText": "최대 3개까지"
  },
  {
    "id": "q5",
    "type": "long_text",
    "label": "자유 의견 / 추가 코멘트",
    "required": false
  }
]
```

### answers JSON 형식

```json
{
  "q1": "굉장히 좋았어요",
  "q2": 5,
  "q3": "디자인",
  "q4": ["A", "C"],
  "q5": "다음번엔 결정 시점을 더 일찍 했으면 좋겠어요"
}
```

---

## 5. 백엔드 라우트 (확정 13개)

### CRUD (workspace member 이상)
| 메서드 | 경로 | 가드 | 설명 |
|---|---|---|---|
| POST | `/api/surveys` | member | 생성 (status='draft') |
| GET | `/api/surveys` | member | list (workspace, status 필터) |
| GET | `/api/surveys/:id` | member | 상세 + 응답률 |
| PUT | `/api/surveys/:id` | owner OR creator | 수정 (draft 만 questions 변경 가능) |
| DELETE | `/api/surveys/:id` | owner OR creator | 삭제 (응답 0 일 때만) |

### 발송 + 종료 (workspace owner OR creator)
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/surveys/:id/send` | recipients 추가 + 메일/SMS 발송 (status='active' 전환) |
| POST | `/api/surveys/:id/close` | status='closed' (응답 차단) |
| POST | `/api/surveys/:id/share-link` | 공개 링크 토큰 발급 |
| DELETE | `/api/surveys/:id/recipients/:rid` | 발송 취소 (status='revoked') |

### 응답 조회 (creator OR owner)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/surveys/:id/responses` | 응답 list (page) |
| GET | `/api/surveys/:id/responses.csv` | CSV export |

### 공개 응답 (인증 없음)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/surveys/public/by-token/:token` | 공개 링크 미리보기 (질문지 + 응답 폼) |
| POST | `/api/surveys/public/by-token/:token/respond` | 응답 제출 (익명 또는 OTP) |
| GET | `/api/surveys/recipients/:token` | 개별 link 미리보기 |
| POST | `/api/surveys/recipients/:token/respond` | 개별 응답 제출 |

---

## 6. UI 페이지 (확정)

| Route | 페이지 | 권한 |
|---|---|---|
| `/surveys` | 리스트 (drafts/active/closed) | member |
| `/surveys/new` | Builder — 제목·설명 + 질문 추가 | member |
| `/surveys/:id` | 상세 — 응답 현황 + 집계 + recipients tab | creator OR owner |
| `/surveys/:id/responses` | 응답 list + filter + CSV | creator OR owner |
| `/public/surveys/:token` | 공개 응답 페이지 (공개 링크 모드) | 공개 |
| `/surveys/r/:recipientToken` | 개별 응답 페이지 (메일/SMS 링크) | 공개 + OTP |

### Builder 화면 구조 (`/surveys/new`)

```
PageShell title="새 설문"
  ┌────────────────────────────────────┬──────────────────┐
  │ 제목 [..............................] │                  │
  │ 설명 [장문..........................] │  미리보기         │
  │                                    │  (응답자 시점)    │
  │ ─── 질문 ───                       │                  │
  │ ① 단답  "회의 만족도..."     [⋮]   │                  │
  │ ② 평점  "전체 만족도"         [⋮]   │                  │
  │ ③ 다중선택  "주제"            [⋮]   │                  │
  │                                    │                  │
  │ + 질문 추가  [단답][장답][▼5 타입]  │                  │
  │                                    │                  │
  │ ─── 설정 ───                       │                  │
  │ ☐ 익명 응답 허용                    │                  │
  │ ☐ 동일인 다중 응답 허용              │                  │
  │ ⏱ 만료일  [선택]                    │                  │
  │ 🔒 비밀번호  [선택]                  │                  │
  │                                    │                  │
  │ [Draft 저장]  [활성화 → 발송하기]   │                  │
  └────────────────────────────────────┴──────────────────┘
```

질문 추가 시 미리보기 즉시 갱신 (auto-save 30s). draft 단계에서는 자유롭게 수정.

### 응답 페이지 구조 (`/public/surveys/:token` 또는 `/surveys/r/:recipientToken`)

```
┌─ workspace logo + 발송자 이름 ──────────────────────┐
│                                                   │
│  [Title]                                          │
│  [Description]                                    │
│                                                   │
│  ─── 질문 1 / 5 (progress bar) ───                │
│  Q1. 회의 만족도 한 줄로...  ★required             │
│  [text input]                                     │
│                                                   │
│  Q2. 전체 만족도 (1-5)  ★required                  │
│  ☆ ☆ ☆ ☆ ☆                                       │
│                                                   │
│  Q3...                                            │
│                                                   │
│  [응답 제출하기]                                   │
│                                                   │
│  PlanQ — 일이 일이 되지 않게                       │
└───────────────────────────────────────────────────┘
```

- single-page 또는 step-by-step (사용자 옵션). MVP = single-page (구현 단순)
- 모바일: 풀스크린, 터치 타겟 44+
- 응답 후: "감사합니다" 페이지 + (옵션) 결과 통계 요약 보기 (anonymous 면)

### 상세 + 집계 (`/surveys/:id`)

```
┌─ 제목 / status pill / 발송 버튼 / 종료 버튼 ──────┐
│                                                  │
│  📊 응답률  18/25 (72%)                          │
│  ⏱ 만료까지  3일                                  │
│                                                  │
│  ─── 질문별 집계 ───                              │
│  Q1 [단답]  18 응답  →  [응답 list]              │
│  Q2 [평점]  평균 4.2 / 5  ⭐⭐⭐⭐                  │
│  Q3 [단일선택]  디자인 8 / 기획 5 / 개발 4 / 기타 1  │
│  Q4 [다중선택]  A 12 / C 10 / B 6 / D 3           │
│                                                  │
│  [응답 list 보기]  [CSV export]                  │
│                                                  │
│  ─── 발송 ───                                    │
│  📧 a@x.com  ✅ 응답완료 (1일 전)                  │
│  📧 b@x.com  📬 발송됨 (3일 전)                   │
│  📱 010-...   👁 열어봄 (2일 전)                   │
│  + 받는 사람 추가                                  │
└──────────────────────────────────────────────────┘
```

---

## 7. 발송 흐름

### 이메일 / SMS 발송 (메인)
```
[발송하기] 클릭
  → 모달: 받는 사람 입력 (이메일·전화 N개 + client 선택)
  → POST /api/surveys/:id/send
  → 각 recipient row 생성 + recipient_token UUID
  → emailService.sendSurveyInvite (signature emailWrap 재사용)
       또는 SMS 발송 (Cool SMS / Twilio — 후속 통합)
  → status='active'
  → 카드 받는 사람: 메일 → 응답 페이지 → 제출
```

### 공개 링크
```
[공개 링크 생성] 클릭
  → POST /api/surveys/:id/share-link
  → share_token UUID 발급
  → 링크 복사: https://planq.kr/public/surveys/:token
  → 누구나 응답 가능 (anonymous 옵션)
```

### Q Talk 채팅방 카드 (후속)
```
ShareModal → "채팅방 발송" 탭
  → conversation_id 선택
  → message card_type='survey' (signature 카드 패턴)
  → 채팅방 멤버가 카드 클릭 → 응답 페이지
```

### Q project 만료 시 자동 (후속 v1.1)
```
project status='completed' 트리거
  → 워크스페이스에 "만족도 설문 자동 발송" 설정 있으면
  → project.client_id 에게 만족도 설문 발송 (template 기반)
  → recipient 자동 추가
```

---

## 8. 사이클별 작업 분량 (4 사이클)

### 사이클 1 — 백엔드 + 발송 인프라
- 모델 3개 (`Survey`, `SurveyRecipient`, `SurveyResponse`) + 인덱스
- 라우트 13개
- emailService.sendSurveyInvite (signature emailWrap 패턴 재사용)
- SMS 발송 stub (실 통합은 후속)
- 권한 가드 (creator / owner / member 매트릭스)
- E2E: 생성·발송·응답·집계 라이프사이클

### 사이클 2 — Builder UI
- `/surveys` 리스트
- `/surveys/new` Builder
- 5 질문 타입 input 컴포넌트
- 미리보기 실시간 (split layout 또는 toggle)
- 자동 저장 (draft, 30s debounce)
- i18n ko/en

### 사이클 3 — 응답 페이지 + 발송 진입점
- `/public/surveys/:token` (공개)
- `/surveys/r/:recipientToken` (개별, OTP 옵션)
- "감사합니다" 페이지
- ShareModal 의 발송 탭 (메일/SMS/공개링크)
- LeftPanel "새 설문" 진입점
- 모바일 풀스크린 최적화

### 사이클 4 — 집계 + Q project 연계
- `/surveys/:id` 상세 페이지 (질문별 집계 차트)
- `/surveys/:id/responses` 응답 list
- CSV export (한국어 utf-8 BOM 포함)
- Q project 종료 시 자동 발송 트리거 (워크스페이스 설정)
- 만료 / 리마인더 cron (D-3 / D-1)
- 분석 페이지 통합 (`/insights` 에 설문 응답률 카드)

---

## 9. 통합 / 후속 (v1.1+)

| 항목 | 사이클 | 이유 |
|---|:-:|---|
| Q Talk 채팅방 카드 발송 | +0.5 | message card_type 추가 |
| Q project 자동 발송 | +0.5 | workspace 설정 + project status 트리거 |
| 통합 공유 시스템 통합 (share_token 일관) | +0.3 | SHARE_PREVIEW_POLICY 패턴 |
| 응답 알림 (응답 들어오면 notify) | +0.5 | notifications.event_kind='survey_response' |
| 응답 부분 저장 (모바일 떠나도 살아남기) | +1 | localStorage + survey_responses.is_partial |
| Conditional logic (분기) | +2 | builder 복잡도 ×2~3 |
| File upload question type | +1 | 스토리지 가드 |

---

## 10. 결정 매트릭스 (30년차 기록)

### 익명/식별 — 둘 다 지원
- `surveys.anonymous BOOLEAN` 한 컬럼만 추가
- 복잡도: builder 토글 1개 + 응답 페이지 분기 (anonymous → 그냥 폼 / 식별 → 이메일 또는 OTP)
- 기본값 = false (식별) — 식별이 일반적이고, 익명은 특수 케이스 (만족도·외부 인사이트)

### Conditional logic — MVP 제외
- 사용 빈도: 단순 선형 설문 90% 차지
- 빌더 복잡도 ×2~3
- 필요시 v2 추가

### Q docs 연계 — 제거
- 사용자 지적: "문서 자체가 설문" — 문서에 첨부 의미 없음
- 설문 = 독립 자산 (signature 패턴과 동일)

### MVP 4 사이클 — 묶음 / 분리
- 묶음 (한 PR) → 검증 어려움
- 분리 (4 PR) → 사이클별 라이브 가능. MVP1 = 사이클 1~2 후 dev 라이브 가능 (응답 페이지 부재)
- **권장**: 분리. 사이클 1+2 끝나면 "draft + 발송 stub" 단계로 internal dogfooding

---

## 11. 이력
- 2026-05-11 사이클 N+8 follow-up: 본 설계 박제. 코드 미구현. 일정 결정 시 사이클 1 부터 진입.
