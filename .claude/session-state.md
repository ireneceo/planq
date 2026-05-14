# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-14
**작업 상태:** 완료 — v1.9.0 운영 라이브 + 사이클 N+14 후속 hotfix 4건
**버전:** v1.9.0 (commit `8bb96ac` + hotfix 4건 + frontend rsync)

### 완료된 작업 (이번 세션)

**사이클 N+14 정식 라이브:**
- visibility 4단계 통합 (Q file/Q docs/Q info/Q note L1-L4 vocabulary)
- Q Note 공유 정책 변경 (기본 L1 + 명시 활성화 시 L2/L3/L4)
- Q info 프로젝트 스코프 활성화 (ProjectKnowledgeTab.tsx 신규)
- 개인 보관함 5탭 (Q note 추가)
- 라벨 통일 (Q knowledge → Q info)

**hotfix 4건 (운영 라이브 직후 사용자 보고):**
1. personal_vault 403 (platform_admin 누락) — isMemberOrAbove(scope) 헬퍼
2. task_extractor invalid date 500 — YYYY-MM-DD 유효성 검증 후 INSERT
3. 보관 conv 영구 삭제 FK 위반 — 트랜잭션 + 명시 cascade
4. 알림 클릭 진입 시각 점프 — Empty (100vh-56px) → Layout(100dvh) wrapper 통일

**검증:**
- 모바일 push 발송 — irene 4 디바이스 (iPhone 3 + Mac Chrome 1) sent code=201
- 9단계 검증 PASS (헬스 27/28, 빌드 TS 0, API 16/16)

### 진행 중인 작업
- 없음

### 다음 할 일

**1순위 — 사용자 모바일/데스크탑 검증:**
- 모바일/데스크탑 PWA 새로고침 (Cmd+Shift+R 또는 앱 재시작)
- 채팅 알림 클릭 → 시각 점프 0 확인
- 만약 ChatPanel 내부 "기본페이지 깜빡임" 여전하면 다음 사이클에 ChatPanel skeleton 작업

**2순위 — Google Meet 실 OAuth 검증 (사이클 N+13 미완):**
- dev 에서 "Google Calendar (Meet 자동 생성)" 카드 연결 OAuth
- Calendar 연결 후 → Q Calendar 새 일정 → Google Meet 자동 생성 체크 → 실 meet.google.com 링크 발급 확인

**차순위:**
- ChatPanel 내부 messages skeleton (loading 시 placeholder 위치 고정)
- Q Note frontend — AI utterance "🤖 AI 보조" 라벨
- Post.visibility 마이그레이션 (internal/public → L1-L4)
- Q Note L4 share_token UI

### 운영 적용 정리

- v1.9.0 정식 배포 (commit `8bb96ac`)
- 후속 hotfix 4건 적용
  - backend 3건: scp + pm2 restart
  - frontend 1건: rsync + nginx reload (Empty → CenteredHint+Spinner)
- 운영 dev 와 동일 build hash (`index-C2CMxPCp.js`)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
