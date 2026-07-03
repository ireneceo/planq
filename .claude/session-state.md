# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-03 (2차)
**작업 상태:** 트랙 B(과금) + 트랙 A(보안 하드닝) 코드완료+검증 · live WS E2E(mock)만 남음 · **운영 미배포**

### ✅ 완료 (2026-07-03 2차 세션) — C1 트랙 A 보안 하드닝
실측 노출 재확인: 외부IP `:3003`→200 · `:8000`→404 (둘 다 인터넷 직접 도달). 3중 방어 적용·검증:
- **Node** `server.js` → `server.listen(PORT, BIND_HOST, ...)` (`BIND_HOST` env 기본 `127.0.0.1`). pm2 restart.
- **uvicorn** `--host 127.0.0.1` + `planq-qnote`를 `ecosystem.config.js`에 정식 등록(interpreter=venv python, cwd=/opt/planq/q-note, .env는 main.py load_dotenv 자체 로드). `pm2 delete` 후 ecosystem 재기동 + `pm2 save`.
- **nginx** `location /api/internal { deny all; }` — **서빙 파일은 `/etc/nginx/sites-enabled/dev.planq.kr`(심링크 아닌 별도 복사본!)** + repo `scripts/nginx-planq.kr.conf`(운영용). ⚠️ 함정: nginx backup 파일을 sites-enabled/ 안에 두면 `include sites-enabled/*`가 중복 로드 → "duplicate listen" emerg. backup은 `/etc/nginx/backups/`로 이동함.
- **검증 전부 PASS:** 외부IP :3003/:8000 직결 → 000(refused) · nginx health 200 / internal 403(nginx HTML deny, valid key여도 차단) / qnote health 200 · localhost 3003/8000 내부호출 200(q-note→Node key 통과 200) · health-check 29/29 · PM2 둘 다 online.
- ⚠️ **운영 배포 체크:** 운영 nginx는 3002/8001. q-note `.env` `PLANQ_NODE_BASE_URL`이 운영에선 :3002여야 함. ecosystem `planq-qnote` port는 운영 8001로 조정 필요(현 dev 8000).

### 진행 중인 작업 (다음 섹션 이어서)
- **C1 live WS E2E** — mock WebSocket: 진입 hard-block(quota 4030 / non-member 4031), 5분 flush 롤포워드, 재연결 stream_id 합산. (실 STT 분은 운영 배포 후 샘플. dev는 Deepgram 키 유효 확인됨 → 실녹음도 가능)

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
1. ~~C1 트랙 A 보안 하드닝~~ ✅ 완료 (2026-07-03 2차)
2. C1 live WS E2E (mock)
3. cost-guard 남은 것: H-f 잔여 q-note generate-keywords LLM rate-limit + create_session rate-limit (q-note에 slowapi 없음 → 신규 패턴 설계 승인 후)
4. **운영 배포는 Irene의 명시적 `/배포` 명령 필요** (미푸시분 다수 누적: 이전 세션 cost-guard 3커밋 + C1 트랙B/트랙A)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

관련 메모리: `project_cost_guard_audit` (C1 상세 재개 노트 박제됨), `feedback_no_options_just_fix`.
