## 현재 작업 상태
**마지막 업데이트:** 2026-05-03 (저녁 — Q-N 사이클 운영 배포 완료. v1.1.0)
**작업 상태:** 운영 라이브 (commit `c2f9b4f`, v1.1.0). 10 commit 묶음 모두 운영 적용.

**남은 외부 의존성 1건:**
- 운영 q-note PM2 가동 — 운영서버 sudo 필요 (Irene 직접 ssh):
  ```bash
  ssh irene@87.106.78.146
  sudo apt install python3.12-venv python3-pip -y
  cd /opt/planq/q-note && rm -rf venv && python3 -m venv venv
  venv/bin/pip install --upgrade pip
  venv/bin/pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
  venv/bin/pip install -r requirements.txt
  pm2 start /opt/planq/q-note/venv/bin/uvicorn --name planq-prod-qnote \
    --interpreter /opt/planq/q-note/venv/bin/python -- \
    main:app --host 0.0.0.0 --port 8001 --app-dir /opt/planq/q-note
  pm2 save
  ```

---

## ⚡ 빠른 재개 (다음 세션)

```
session-state.md 읽고 메모 project_saas_readiness_2026_05_03.md 와
DEVELOPMENT_PLAN.md 의 v1.1.0 섹션부터 컨텍스트 복원.
운영 q-note 가동 안 됐으면 위 ssh 절차 안내. 그 외엔 다음 사이클 자유 진행.
```

---

## 📦 v1.1.0 사이클 — 10 commit 요약 (2026-05-03)

### 1차 묶음 (Q Note · Q Task · 백업)
- `9754b3a` Q Note interim 점진 표시 + chunking + 어절 분할 fallback / Q Task 정기업무 5 프리셋 + cron / 백업 양방향 크로스

### 2차 묶음 (운영 안정성 — SaaS 점검 후 진행)
- `c762165` 외부 API timeout (OpenAI 30s, SMTP 30s) + cron fan-out 비동기 + tasks pagination
- `5dff95f` AuditLog 헬퍼 + invoices/posts CUD 적용
- `3f0daf1` pino logger + request_id 미들웨어 + errorHandler 강화 + /api/health 확장 (db_pool/env)
- `fb7afd9` uploads cleanup cron (30일+ orphan File row + 물리 파일 sibling 검사)
- `21f3fc8` 권한 헬퍼 통일 (posts/docs assertMember → access_scope.assertMemberOrAbove)
- `2a0de3a` KB tag extraction 의 cue_usage 한도 enforce + 토큰 누적
- `2fa9841` audit helper 단일 모듈 (services/auditService.js)
- `dd84ee7` cue_task_executor + task_extractor 한도 enforce + message_attachments 권한 통일
- `c2f9b4f` translation_service 한도 enforce + 토큰 누적

**백엔드 모든 LLM 호출처 cue_usage 통합 추적**: answer / summary / task_execute / task_extraction / kb_embed / translation. 우회 0.

### 운영 배포 결과 (2026-05-03 09:18 KST 환산)
- planq-prod-backend reload 성공 (uptime 44s 시점 검증 OK)
- 외부 HTTPS health 200, db_pool/env 시그널 정상
- planq-prod-qnote 실패 (venv 의존성 미설치, sudo 필요 — 위 절차 참고)
- POS production-backend 영향 없음 (37h uptime 유지)

---

## 🔖 다음 할 일

### A. 운영 q-note 가동 (Irene 직접, 외부 의존성)
위 ssh 절차 1회 실행 → 502 자동 해결 → 다음 `/배포` 부터 자동 reload.

### B. 다음 사이클 후보 (Claude Code 진행 가능)
- 운영 사용량 지표 페이지 (cue_usage / qnote_usage 시각화) — `/insights` 확장
- Q Note 화면 UX 검증 후 미세 폴리싱 (interim 점진 표시 / chunking 동작)
- TaskDetailDrawer 의 정기업무 표시·편집 (parent rule 변경, 인스턴스 단독 수정)
- "이번 1회만 수정" vs "앞으로 모두 수정" UX
- conversations.js 의 `await createAuditLog` 6 곳 → fire-and-forget 자동 (audit 통합 후 동작 동일하지만 의미상 await 떼는 게 명확)

### C. Phase 4 트리거 (외부 의존성, 시점 결정)
- DAU 100+ 또는 메일 폭증 → BullMQ + Redis worker
- 인스턴스 2+ 필요 → Socket.IO Redis adapter
- /insights 응답 1초 초과 → read-replica
- 다중 인스턴스 또는 디스크 압박 → multer disk → S3/MinIO + signed URL

---

## 📂 주요 위치
- v1.1.0 운영 라이브 commit: `c2f9b4f`
- 첫 운영 진입 commit: `661b893` / Q-H 사이클: `024d368`
- 운영 백업: `/opt/planq/backups/{TIMESTAMP}/` (deploy 시점 코드 + DB)
- 일일 DB 백업 양방향 크로스: 메모 `project_backup_strategy.md`
- SaaS readiness 점검 + 10 commit: 메모 `project_saas_readiness_2026_05_03.md`
- 운영 배포: `scripts/deploy-planq.sh` (sync_qnote 가 PM2 미등록 시 자동 start 시도하지만 venv 의존성 부재 시 실패)

---

## 🔑 환경
- dev backend port 3003 (planq-dev-backend), POS port 3001
- 운영 backend port 3004 (planq-prod-backend), POS port 3002 공존
- 운영 q-note port 8001 (planq-prod-qnote, 미가동) — nginx 가 /qnote/* → 8001 proxy
- DB: dev planq_dev_db, 운영 planq_prod_db
- 운영 DB 비번: 운영서버 `/opt/planq/.db-password` (mode 600)
