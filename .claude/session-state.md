# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-15
**작업 상태:** 완료 — 사이클 N+15 Q Talk UX 통합 운영 라이브
**버전:** v1.10.0 (운영 라이브, commit `669a0c5`)

### 완료된 작업 (이번 세션)

**Irene 요청 16건 사이클 N+15-A ~ E 통합 fix:**

**A. 진입 로딩 점프 + 시간 개선:**
- 풀스크린 spinner 게이트 제거 + localStorage 캐시 (1h TTL, stale-while-revalidate)
- LeftPanel skeleton 4행 + ChatPanel 메시지 skeleton 3 bubble (shimmer)
- listProjects + listBusinessConversations 병렬 / 비활성 채널 메시지 lazy

**B. 모바일 키보드 UX:**
- visualViewport resize → `body[data-keyboard-up=1]` 토글 → safe-area override
- form wrap + autocorrect/autocomplete=off + inputMode=text + enterKeyHint=send (iOS 액세서리 바 회피)
- handleSend 후 requestAnimationFrame focus 강제 (키보드 유지)

**C. 메시지 읽음 표시:**
- backend GET messages 에 read_by_count + other_count
- mark-read 시 socket 'conversation:read' broadcast → 발송자 실시간 갱신
- 1:1 = 읽음/전송됨 / 그룹 = 읽음 N/M / 전체 읽음

**D. 채팅 리스트 WhatsApp 한 줄 + 실시간 동기화:**
- backend last_message_preview (subquery + User join)
- LeftPanel ChatRow 한 줄 (unread 시 진하게/굵게)
- 사이드바 unread 옵티미스틱 +1 (socket message:new) / debounce 200→50ms
- CustomEvent 'planq:unread-changed' detail.optimisticDelta → 진입 시 즉시 차감
- NotificationToaster path-param /talk/123 인식 (활성 conv 토스터 회귀 fix)

**E. 디테일 보강:**
- 발신자 클릭 → UserInfoPopover (BusinessMember + Client 통합, 1분 캐시)
- 메시지 옵티미스틱 local insertion (tempId 음수, API 응답 시 swap, 실패 시 제거)
- 우측 하단 floating ↓ 버튼 + pending +N 빨간 뱃지
- PinBtn/MenuBtn 항상 표시 (hover-only 폐지)

### 변경 파일 (12개)
| 파일 | 변경 |
|---|---|
| dev-backend/routes/projects.js | GET messages read_by_count + other_count |
| dev-backend/routes/conversations.js | last_message_preview SQL + mark-read socket emit |
| dev-frontend/src/pages/QTalk/QTalkPage.tsx | 캐시·loading 게이트·옵티미스틱 메시지·socket conversation:read |
| dev-frontend/src/pages/QTalk/ChatPanel.tsx | skeleton·읽음 라벨·form wrap·keyboard-up·focus 복원·floating ↓ |
| dev-frontend/src/pages/QTalk/LeftPanel.tsx | skeleton·last_message_preview·Pin/Menu 항상 표시 |
| dev-frontend/src/pages/QTalk/types.ts | read_by_count·other_count·last_message_preview |
| dev-frontend/src/services/qtalk.ts | ApiMessage·ApiConversation 타입 확장 |
| dev-frontend/src/hooks/useUnreadTotal.ts | 옵티미스틱·debounce 50ms·CustomEvent detail |
| dev-frontend/src/components/Common/NotificationToaster.tsx | path-param 인식 |
| dev-frontend/src/components/Common/UserInfoPopover.tsx | **신규** |
| dev-frontend/public/locales/{ko,en}/qtalk.json | read·userInfo·scrollToBottom·preview.you 키 |

### 메모리 박제

- 신규: `feedback_deploy_no_confirm.md` — /배포 받으면 인터랙티브 프롬프트에서 멈추지 말고 --auto 로 진행

### 운영 적용

- commit `669a0c5` (1,113 insertions, 130 deletions, 12 files)
- 운영 라이브: 2026-05-15 05:19 — planq-prod-backend 1.9.0 → 1.10.0 (PM2 reload)
- 백업: `/opt/planq/backups/20260515_051754` (on prod)
- 헬스: planq.kr/api/health 200 / 외부 HTTPS 200 / PM2 online
- dev verify: 28/28 헬스체크 + 8/8 API 검증 + 빌드 873ms TS 0

### 진행 중인 작업
- 없음

### 다음 할 일

**1순위 — Irene 디바이스 실 검증 (사이클 N+15 후속):**
- 데스크탑 PWA Cmd+Shift+R 새로고침 → 스피너 점프 0 / skeleton 자연스러움 / 입력 즉시성
- 모바일 PWA 키보드 빈 공간 0 / 전송 후 키보드 유지 / floating ↓ 버튼
- 다중 디바이스: 한쪽 메시지 → 토스터 + 사이드바 + 채팅 리스트 동시 갱신
- 활성 conv 토스터 차단 (path-param 진입 케이스)

**2순위 — Google Meet 실 OAuth 검증 (사이클 N+13 미완):**
- dev "Google Calendar (Meet 자동 생성)" 카드 연결 OAuth
- Calendar 연결 후 → Q Calendar 새 일정 → 실 meet.google.com 링크 발급 확인

**차순위:**
- ChatPanel 내부 messages skeleton 디테일 추가 보강 (필요 시)
- Q Note frontend — AI utterance "AI 보조" 텍스트 라벨
- Post.visibility 마이그레이션 (internal/public → L1-L4)
- Q Note L4 share_token UI

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
