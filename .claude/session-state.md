# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-17
**작업 상태:** 완료 — 사이클 N+17 운영 라이브 (v1.12.0)
**버전:** v1.12.0 (운영 라이브, commit `3c1a98b`)

### 완료된 작업 (사이클 N+17)

**1) Q Note 메모 통합 (큰 기능)**
- MemoPopup 신규 — RichEditor (TipTap+lowlight, lazy) / 드래그·리사이즈 8방향 / 자동 이어쓰기 / 검색 / 별도창 (Chrome PiP + window.open)
- MemoFab 신규 — 우하단 FAB + ⌘+Shift+M / Ctrl+Shift+M
- MemoView 신규 — Q Note 페이지 우측 풀모드 panel
- NewSessionBtn dropdown (음성/메모)
- utils/qnoteBody — JSON ↔ legacy plain 호환 helper
- DB: sessions 5 컬럼 추가 (input_type/translate_enabled/linked_voice_session_id/summarized_at/body)
- API: text 메모 CRUD + recent-memos + owner_only edit

**2) 로딩 속도 — 첫 로드 실 전송 716KB → 181KB (75% 감소)**
- vite-plugin-compression .gz 미리 생성 (level 9)
- nginx gzip_static (dev 적용, 운영 nginx 는 sudo 수동 적용 필요)
- vendor-highlight 분리 (lowlight 318KB → lazy)
- App.tsx 9 overlay lazy
- Google Fonts 19→12 weight

**3) 채팅 모바일 4 회귀 fix**
- ChatPanel `<form>` 제거 (iOS 위/아래 화살표 차단)
- visualViewport → var(--vvh) JS sync
- send 후 scrollToBottom
- height 3중 fallback

**4) 로그아웃 회귀 fix (chain follow 폐지)**
- refresh route chain follow 제거 — stale row audit + 401, active 보존
- grace 5→15min
- CORS X-Client-Kind/X-Internal-Api-Key
- cookie sameSite strict→lax
- 진단 로그 4종

**5) PostEditor compact + 메모 popup 우측상단 default 위치**

### 변경 통계
- 22 files, 1977 insertions, 154 deletions

### 운영 적용
- v1.12.0 라이브: 2026-05-17 08:41 (commit `3c1a98b`)
- 백업: /opt/planq/backups/20260517_084014 (on prod)
- 운영 nginx gzip_static 패치만 사용자 sudo 수동 적용 필요

### 검증 결과
- 헬스체크 28/28 PASS
- 페이지 9/9 200
- 빌드 ~950ms TS 0
- API 17/17 PASS (RichEditor JSON 왕복 + legacy 호환 + 검색 + owner_only)
- 운영 헬스 OK + planq-prod-backend/qnote online

### 진행 중인 작업
- 없음

### 다음 할 일

**디바이스 실 검증 (Irene 직접):**
- 모바일 PWA 로그아웃 사라졌는지 (chain follow 폐지 효과)
- 메모 popup 별도창 (PiP/window.open) 동작
- Q Note 페이지 NewBtn 음성/메모 두 흐름
- 메모 popup compact toolbar 가로 스크롤
- /notes/240 모바일 반응형

**운영 nginx 추가 패치 (sudo):**
- /etc/nginx/sites-enabled/planq.kr 에 `gzip_static on;` 추가
- vendor-tiptap 148→121KB 등 추가 17% 절약

**다음 사이클 후보:**
- Service Worker precache (두 번째 방문 즉시 시작)
- brotli 모듈 nginx 설치 (추가 20% 절약)
- vendor-D55 react-is/immer 진짜 분리 (manualChunks 미작동 디버그)
- ?detached=1 분리 창 모드 (사이드바 숨김 + Q Note fullscreen)

### stale 메모리 정정 (이번 세션 발견)
- 없음

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
