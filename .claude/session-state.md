## 현재 작업 상태
**마지막 업데이트:** 2026-05-04
**작업 상태:** 완료 — Q-O + Q-P 사이클 운영 라이브

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션, 5 commit 운영 라이브)
- **`e88fbac`** — 인증 401/403 정석 분리 + 워크스페이스 task 누락 + 토큰 자동 refresh
- **`b96a258`** — Socket.IO 미연결 (실시간 채팅·업무) + room 이름 통일 + 채팅 핀 + 이미지 업로드/표시
- **`0690328`** — UI/UX 통합 (32 파일, +1345/-385): 업무 폼 재구성, 첨부 popup-on-popup 제거, 프로젝트 ↔ Q Talk 양방향, 워크스페이스 표시명 enrichment, 프로필 계정/닉네임 분리
- **`3ca0c35`** — 알림 4 채널 매트릭스 (인박스/인앱/디바이스/이메일) + 인앱 toaster (우측 상단, focus-steal 금지) + PWA 풀 (Service Worker register, share-target POST + multipart + files, install banner)

### 다음 할 일 (우선순위)

#### A. 알림 시스템 보강 (단기)
- 알림 그룹화 — 5 분 안에 같은 sender 의 메시지 1 개로 묶음 ("3 unread messages from 한수정")
- DND 시간대 — 22:00 ~ 09:00 자동 OFF (사용자 설정)
- 활성 conv 인 메시지 inline read receipt + 채팅창 안 mini-toast
- /activity 통합 알림 히스토리 페이지 (Slack 의 Activity 와 같음)

#### B. PWA 공유 통합 강화 (중기)
- 채팅·업무·문서 destination 도 파일 ID 함께 prefill (현재 텍스트만)
- 공유 시 자동으로 가장 최근 conv·project 추천

#### C. Phase 4 인프라 (트래픽 트리거 시)
- DAU 100+ → BullMQ + Redis worker
- 인스턴스 2+ 필요 → Socket.IO Redis adapter / multer → S3
- /insights 응답 1 초 초과 → read-replica

#### D. 운영 .env 보호
- `deploy-planq.sh` 의 .env sync 제외라 신규 환경변수 추가 시 누락 가능
- .env.example 동기화 또는 누락 시 경고 추가 검토

---

## 환경
- **운영 라이브**: https://planq.kr (`3ca0c35`, timestamp `20260504_091626`)
- **dev**: dev-backend port 3003 (planq-dev-backend), dev.planq.kr
- **운영**: backend port 3004 (planq-prod-backend), q-note port 8001 (planq-prod-qnote)
- DB: dev planq_dev_db, 운영 planq_prod_db (양쪽 sync)
- 백업: `/opt/planq/backups/20260504_091626` (운영서버)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
