# 통합 공유 시스템 — 모든 항목 동일 흐름

> **사이클 N+1 (2026-05-08)** — Task / File / Info(KB) / Calendar 에 share_token 추가 + 통합 ShareModal + 미리보기 페이지 + Smart Routing 결합.

---

## 1. 현황 + 신규

| 항목 | share_token | 미리보기 | Smart Routing |
|---|:-:|:-:|:-:|
| Q docs (post) | ✅ 기존 | ✅ 기존 | 신규 적용 |
| Document | ✅ 기존 | ✅ 기존 | 신규 적용 |
| Quote / Invoice / Report | ✅ 기존 | ✅ 기존 | 신규 적용 |
| Q file | ✅ (있는데 라우트 X) | **신규** | 신규 |
| **Q task** | **신규** | **신규** | 신규 |
| **Q info (kb)** | **신규** | **신규** | 신규 |
| **Q calendar** | **신규** | **신규** | 신규 |

## 2. DB 변경

`tasks`, `kb_documents`, `calendar_events` 에 신규:
```sql
share_token VARCHAR(64) UNIQUE NULL,
shared_at TIMESTAMP NULL,
share_password_hash VARCHAR(255) NULL,    -- 비밀번호 보호 (선택)
share_expires_at TIMESTAMP NULL           -- 만료
```

기존 share_token 항목들도 동일 4 컬럼 통일 (이미 있는 곳은 누락만 추가).

## 3. 통합 API 패턴

```
POST   /api/{entity}/:id/share         → token 발급/조회
DELETE /api/{entity}/:id/share         → 무효화
POST   /api/{entity}/:id/share/chat    → 채팅방 발송
POST   /api/{entity}/:id/share/email   → 이메일 발송

GET    /public/{entity}/:token         → 미리보기 페이지 (read-only)
GET    /api/public/{entity}/:token/auth-check  → Smart Routing 용
```

`{entity}` ∈ { posts, files, tasks, kb-documents, calendar-events, ... }

## 4. 통합 ShareModal 컴포넌트

```tsx
<ShareModal
  entityType="task" | "file" | "kb_document" | "calendar_event" | "post" | ...
  entityId={42}
  entityTitle="..."
  previewable={true}
  onClose={...}
/>
```

내부 항목:
- 🔗 링크 복사 (token URL)
- ⏰ 만료 (7일 / 30일 / 무기한)
- 🔒 비밀번호 (선택)
- 💬 채팅방 보내기 (대화방 선택 + 메시지)
- 📧 이메일 (수신자 + 메시지)

## 5. 미리보기 페이지 (4 항목별 read-only)

| 항목 | 미리보기 내용 |
|---|---|
| Q file | 이미지 inline preview (PDF embed) + 메타 (이름·크기·업로더) + [다운로드] |
| Q task | 제목·설명·진행률·마감·담당자(이름) — 코멘트·내부 첨부 X (개인정보 보호) |
| Q info (kb) | 제목·내용·태그·작성자(이름) — 첨부 일부 |
| Q calendar | 제목·시간·장소·설명·참석자(이름) — 응답 X |

## 6. Smart Routing — App-First (★ 차별화)

미리보기 페이지 마운트 시 `auth-check` 호출:

```tsx
useEffect(() => {
  const token = getAccessToken();
  if (!token) return;
  apiFetch(`/api/public/${entityType}/${shareToken}/auth-check`)
    .then(r => r.json())
    .then(j => {
      if (j.success && j.data.canAccess) {
        // 0.3s delay → "PlanQ 에서 보기" 자동 redirect
        setTimeout(() => navigate(j.data.appUrl), 300);
      }
    });
}, [shareToken]);
```

PWA standalone 모드면 OS 가 자동으로 PWA 안에서 redirect 처리 (별도 작업 없음).

미리보기 페이지 항상 표시:
- [PlanQ 에서 보기 →] (인증된 사용자)
- [PlanQ 로그인] (비로그인)
- [무료로 시작하기] (외부 신규 사용자)

## 7. 모바일 보강

PWA 미설치 사용자에게:
- 작은 배너 [📱 홈 화면에 추가하기 →]
- 기존 InstallPromptBanner 재사용

## 8. 채팅방 보내기 — 동작

```
POST /api/{entity}/:id/share/chat
Body: { conversation_id, message? }

→ Message 신규 생성 (sender = 본인)
→ 본문에 share_url + 항목 카드 (preview embed)
→ Socket.IO message:new 발행
→ 받는 사람: 채팅방 카드 클릭 → /public/{type}/:token (Smart Routing 자동 진입)
```

## 9. 이메일 발송 — 동작

```
POST /api/{entity}/:id/share/email
Body: { recipients: ["a@b.com", ...], message? }

→ emailService.sendShareNotification 호출
→ EmailLog 기록
→ 발신자 = 워크스페이스 sender_name (PlanQ SMTP) 또는 Custom SMTP (Pro+)
→ 수신 메일에 [열기] 버튼 (share_url) → Smart Routing 자동
```

## 10. 작업 항목 (사이클 N+1)

- DB: tasks/kb_documents/calendar_events 에 share_token + shared_at + share_password_hash + share_expires_at
- 백엔드: 4 항목 share 라우트 신규 + 미리보기 페이지 라우트 + auth-check
- 백엔드: 통합 share/chat + share/email 액션
- 프론트: `components/Common/ShareModal.tsx` 신규 (통합)
- 프론트: 4 미리보기 페이지 (`/public/tasks/:token` 등)
- 프론트: 카드/상세에 [공유] 버튼 통일
- 프론트: Smart Routing redirect 로직
