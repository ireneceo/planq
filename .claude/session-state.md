# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-03
**작업 상태:** 부분 완료 (트랙 B 코드완료+검증 / 트랙 A·live E2E 다음 섹션) · **운영 미배포**

### 진행 중인 작업 (다음 섹션 이어서)
- **C1 트랙 A — 보안 하드닝** (미착수):
  - Node `server.js` → `server.listen(PORT, '127.0.0.1', ...)`
  - uvicorn `--host 127.0.0.1` (ecosystem.config.js에 planq-qnote 앱 정식 등록)
  - nginx `location /api/internal { deny all; }` — dev site + `scripts/nginx-planq.kr.conf`
  - 검증: 외부IP `:3003`/`:8000` 직결 실패 + nginx/내부호출 정상 재확인
  - 실측 근거: ufw inactive, Node/uvicorn 0.0.0.0 바인드 → 외부 도달됨(공유시크릿만 방어)
- **C1 live WS E2E** — mock WebSocket: 진입 hard-block(quota 4030 / non-member 4031), 5분 flush 롤포워드, 재연결 stream_id 합산. (실 STT 분은 운영 배포 후 샘플)

### 완료된 작업 (이번 세션 — 2026-07-03)
- C1 q-note STT 실분 과금 **트랙 B 코드 전부** (커밋 989b359):
  - 설계 `docs/QNOTE_STT_BILLING_DESIGN.md` (Fable 계획검수 7수정 반영, BLOCK 2건 교정)
  - 마이그레이션 `setup-qnote-billing-schema.js` (dev 적용: `qnote_usage_events` 멱등원장 + `qnote_usage.seconds_used`)
  - `models/QnoteUsageEvent.js` + index 등록, `QnoteUsage.seconds_used`
  - `routes/internal.js` 4라우트 (qnote/can · qnote/usage 트랜잭션 멱등+FOR UPDATE rollup · business-membership · qnote/alert)
  - `services/plan.js` use_qnote 초 단위 + getQnoteSecondsThisMonth
  - q-note `services/billing_client.py`(tri-state fail-open) + `live.py`(stream_id·hard-block·flush) + `sessions.py`(create 멤버십 403)
  - 프론트 `qnoteLive.ts` close code 전달 + `QNotePage.tsx` i18n 매핑 + `qnote.json` ko/en 4키
- **검증:** usage 멱등/원자/재연결 6/6 PASS · 헬스 29/29(q-note 재시작 후 재검) · 프론트 빌드 EXIT0/TS0 · q-note 재시작 후 세션 CRUD 정상(멤버십 검증 라이브)

### 다음 할 일
1. C1 트랙 A 보안 하드닝 (위 상세)
2. C1 live WS E2E (mock)
3. cost-guard 남은 것: H-f 잔여 q-note generate-keywords LLM rate-limit + create_session rate-limit (q-note에 slowapi 없음 → 신규 패턴 설계 승인 후)
4. **운영 배포는 Irene의 명시적 `/배포` 명령 필요** (미푸시분 다수 누적: 이전 세션 cost-guard 3커밋 + 이번 C1)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

관련 메모리: `project_cost_guard_audit` (C1 상세 재개 노트 박제됨), `feedback_no_options_just_fix`.
