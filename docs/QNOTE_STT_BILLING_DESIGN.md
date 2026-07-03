# Q Note STT 실분 과금 + 보안 하드닝 설계 (C1)

- 사이클: 비용폭탄 총점검 후속 (2026-07-03)
- 상태: 설계 확정 (Fable 계획검수 "조건부 가능" 7개 수정 반영)
- 관련 메모: `project_cost_guard_audit`, `feedback_ops_stability_7`, `feedback_external_dispatch_validation`
- 개발=Opus / 게이트=Fable(별도 검증) 분리 모델

---

## 0. 배경 / 문제

Q Note 음성회의는 Deepgram STT를 **종량과금**(분당)한다. 유료고객이 대량·장시간·다중 스트림으로 사용하면 Irene의 외부비용이 상한 없이 증가한다.

기존(커밋 21fe39a)에 **동시 스트림 원자적 예약**(per-user 2개)과 **세션 4h 캡**은 있으나, **실제 사용 분(minute)을 집계·기록하고 플랜 월 한도로 차단하는 경로가 없다.** 인프라(`QnoteUsage` 테이블, `plan.can('use_qnote')` 게이트, internal API 공유시크릿)는 준비돼 있으나 **연결하는 코드가 비어 있다**(호출처 0).

또한 조사 중 발견: q-note(:8000)가 nginx를 우회해 인터넷에 직접 노출, Node(:3003) internal API도 포트가 외부 도달 가능(공유시크릿만이 방어). → 보안 하드닝을 같은 사이클에 포함.

---

## 1. 목표

1. **실분 과금** — 세션 녹음 실제 분을 5분 단위로 집계, 월 rollup.
2. **한도 차단(hard-block)** — 월 한도 초과 시 Deepgram 연결 **전에** 차단(STT 비용 0원).
3. **정확히 한 번(exactly-once)** — 재시도·동시 flush·재연결에도 이중집계/유실 없음.
4. **멀티테넌트 격리** — 과금이 남의 워크스페이스로 기록되거나 우회되지 않음.
5. **보안 경계** — internal API를 외부에서 도달 불가하게(localhost 바인드 + nginx deny).

한도 소스: `plan.js` effective limits `qnote_minutes_monthly` (Free 60 / Basic 60 / Pro 900 / 상위 3600 / Infinity, addon `addon_qnote_minutes` 합산).

---

## 2. 트랙 A — 보안 하드닝 (별도 커밋, 선행)

조사 실측(2026-07-03):
```
:3003(Node)   외부IP 직결 → 403 (공유시크릿 fail-closed, 그러나 포트 도달 가능)
:8000(q-note) 외부IP 직결 → 404 (게이트 없이 인터넷 노출)
ufw           inactive
Node          *:3003 (0.0.0.0)   uvicorn 0.0.0.0:8000
```
모든 내부통신은 localhost 경유 확인: Node→q-note `localhost:8000`, q-note→Node `localhost:3003`, 브라우저→nginx→localhost. 공개 IP를 내부통신에 쓰는 코드 0건.

**수정:**
1. Node `server.listen(PORT, '127.0.0.1', ...)` — 외부 직결 차단, nginx/q-note 호출 무해.
2. uvicorn `--host 127.0.0.1` (PM2 args). `ecosystem.config.js`에 `planq-qnote` 앱 정식 등록(재현성).
3. nginx `location /api/internal { deny all; }` — dev site + `scripts/nginx-planq.kr.conf` 양쪽(심층방어).

**주의:** `/api/internal` prefix 밖의 키가드 라우트(`/api/files/internal/*`, `/api/cloud/qnote/sync`)는 nginx deny가 안 덮지만 공유시크릿으로 보호됨 → "internal 전부 차단"이라 주장 X. localhost 바인드가 근본 방어.

**운영 배포 체크:** 운영 nginx는 3003→3002 프록시. q-note `.env`의 `PLANQ_NODE_BASE_URL`이 운영에선 :3002여야 함(dev는 :3003). 배포 체크리스트에 명시.

---

## 3. 트랙 B — STT 실분 과금

### 3.1 스키마

**신규 멱등 원장 `qnote_usage_events`:**
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | INT PK AI | |
| stream_id | VARCHAR(36) | **연결마다 UUID** (세션 아님) |
| segment_seq | INT | flush 순번 (연결 내 0,1,2,…) |
| session_id | INT | q-note 세션(SQLite 소재 → **FK 안 검**) |
| business_id | INT | FK businesses |
| user_id | INT | |
| seconds | INT | **billed 초** (stereo 반영) |
| is_stereo | TINYINT | 감사용 |
| created_at | DATETIME | |

**UNIQUE(stream_id, segment_seq)** — HTTP 재시도 이중집계 차단. **연결마다 UUID**라 재연결(모바일 네트워크 끊김)해도 새 stream_id → 충돌·유실 없음. (session_id 기준이면 재연결마다 seq=0 리셋 → 최초 1회만 집계되는 **quota 우회 구멍** — Fable BLOCK1.)

**기존 rollup `qnote_usage`에 컬럼 추가:** `seconds_used INT NOT NULL DEFAULT 0` (source of truth). `minutes_used`는 `FLOOR(seconds_used/60)` 표시용으로 유지(하위호환). INT 반올림 유실 차단(Fable CONCERN — 0.4분 조각 유실 방지).

### 3.2 billed 초 환산

Deepgram linear16 / 16000Hz / 2bytes = **32000 bytes/s/channel**. `channels = 2 if capture_mode=='web_conference' else 1`.

```
wall_seconds   = delta_bytes / (32000 * channels)      # 벽시계
billed_seconds = wall_seconds * channels               # Deepgram은 채널별 과금
               = delta_bytes / 32000                    # (mono·stereo 동일 식)
```
stereo(웹회의)는 벽시계 ×2로 집계 — **한도 목적이 비용상한이므로 실비용(채널별) 기준**(Fable CONCERN 정책 확정).

### 3.3 flush 흐름 (q-note `live.py`)

- 연결 시작: `stream_id = uuid4()`, `segment_seq = 0`, `flushed_bytes = 0`, `last_flush = now`.
- 오디오 루프: `now - last_flush >= 300s`(5분)마다 flush 스케줄. delta = `bytes_received - flushed_bytes`.
- flush 성공 시에만 `flushed_bytes += delta`, `segment_seq += 1`. **실패 시 flushed_bytes/seq 미전진** → 다음 flush가 더 큰 delta를 같은 seq로 재전송(멱등키가 중복 흡수, 유실 0).
- 종료(`finally`): 남은 delta 최종 flush(await, 타임아웃).
- **비차단:** 주기 flush POST는 `asyncio.create_task`(오디오 파이프 정지 방지). 타임아웃 3s.

### 3.4 hard-block (Deepgram 연결 前)

`live.py` 스트림 예약 지점(Deepgram connect 직전)에서:
1. `GET /api/internal/business-membership/:userId/:businessId` → 멤버 아니면 `close(4031)`. (옛 무검증 세션이 남의 business_id로 녹음하는 구멍 차단 — Fable BLOCK2, `/ws/live` 시점 재검증.)
2. `GET /api/internal/qnote/can?business_id=&seconds=1` → 초과 시 quota 메시지 + `close(4030)`. **Deepgram 붙기 전** → STT 비용 0.

주기 flush 시에도 can 재검사(create_task) → 초과하면 `should_stop` 플래그 set → 루프가 graceful stop. overshoot 최대 ~5분 × 2스트림(4h 캡이 최후방어).

### 3.5 flush 실패 정책

- 각 flush POST **재시도 3회**(0.2·0.4s backoff).
- 최종 실패 시 delta 롤포워드(유실 0) + `ERROR` 로그.
- 연속 3회 flush 실패 → best-effort `POST /api/internal/qnote/alert` → `notifyPlatformAdmins`(운영 안정성 #8 패턴). Node 자체 다운이면 이 알림도 실패 → ERROR 로그가 최후 신호. **fail-open**(4h 캡·동시2 캡이 비용 백스톱).

### 3.6 Node internal 라우트 (`routes/internal.js`)

- `GET /qnote/can?business_id=&seconds=` → `plan.can(bizId, 'use_qnote', {seconds})` 위임. `{ ok, reason, limit, current }`.
- `POST /qnote/usage` `{ stream_id, segment_seq, session_id, business_id, user_id, seconds, is_stereo }` → **한 트랜잭션:** `qnote_usage_events` INSERT(UNIQUE 충돌=중복 skip, 이미 집계됨) → **신규 삽입일 때만** `qnote_usage` 월행 `FOR UPDATE` 잠금 후 `seconds_used += seconds`, `minutes_used = FLOOR/60`, (첫 seq면 `session_count += 1`). 데드락 3회 재시도(`storageUsage.js` 패턴). = 정확히 한 번.
- `GET /business-membership/:userId/:businessId` → `BusinessMember(removed_at IS NULL)` + workspace owner. **Client 제외**(Q Note 차단 정책).

### 3.7 plan.js 초 단위

`use_qnote` 케이스가 `ctx.seconds`(우선) 또는 `ctx.minutes` 지원. `getQnoteSecondsThisMonth`(seconds_used) 신설, 분은 파생. 초과 판정 `cur_seconds + needed_seconds > limit_minutes*60`.

### 3.8 create_session 검증 (`sessions.py`)

`body.business_id` 무검증 저장 → `GET /api/internal/business-membership` 확인(멤버 아니면 403). JWT claim 대조는 **불가**(실토큰 payload `{userId,email}`뿐, business_id claim 없음 — Fable BLOCK2).

### 3.9 프론트 close 코드 i18n

q-note live WS `close(4030)`(quota) / `close(4031)`(not member) / `4029`(too many) / `4004`(not found) 처리 + `qnote` 네임스페이스 ko/en 안내(무음 끊김 방지). 4030은 "이번 달 Q Note 한도 소진 — 업그레이드" CTA.

---

## 4. 마이그레이션

`dev-backend/setup-qnote-billing-schema.js` (idempotent):
1. `CREATE TABLE IF NOT EXISTS qnote_usage_events (...)` + UNIQUE(stream_id, segment_seq) + INDEX(business_id, created_at).
2. `qnote_usage`에 `seconds_used` 없으면 `ALTER TABLE ... ADD COLUMN seconds_used INT NOT NULL DEFAULT 0`.
- 신규 테이블이라 Too-many-keys 무관. session_id **FK 미설정**(SQLite 소재). 운영은 수동 실행 가이드 동반.
- 기존 minutes_used **백필 안 함**(지금부터 집계 — cost_guard 정책 일관).

`cost_usd` 이번 미채움 → **0 유지, 향후**(홈택스/팝빌 무관, 내부 원가 추정용 예약).

---

## 5. 검증 시나리오 (Fable 재게이트)

1. **정상 집계** — 세션 생성 → flush 2회 → `qnote_usage_events` 2행, `qnote_usage.seconds_used` = 합.
2. **멱등** — 같은 (stream_id, seq) 재전송 → rollup 불변(이중집계 0).
3. **재연결 이중 flush** — 녹음→끊고 재연결→녹음 → 2개 stream_id, rollup은 합산(유실 0).
4. **한도차단 진입** — seconds_used를 한도 근처로 세팅 → `/qnote/can` false → 진입 `close(4030)`, Deepgram 미연결.
5. **격리** — 남 workspace business_id로 create_session → 403. `/ws/live` 남 세션 business → 4031.
6. **초 단위** — 30초씩 여러 flush → 분 반올림 유실 없음(초 누적 일치).
7. **보안** — 외부IP `:3003`/`:8000` 직결 실패, nginx 경유·q-note→Node 내부호출 정상.
8. 프론트 `npm run build` EXIT 0 + 청크 해시 갱신.

test 스크립트는 `dev-backend/test-*.js`로 작성 후 **삭제**. 실녹음 STT 분은 dev Deepgram 미설정이라 fallback — bytes→초 경로는 mock WS로 검증, 실 STT 분은 운영 배포 후 샘플 1건.

---

## 6. 손대는 파일

**트랙 A:** `dev-backend/server.js`, `dev-backend/ecosystem.config.js`, nginx conf(dev + `scripts/nginx-planq.kr.conf`).

**트랙 B:**
- Node: `routes/internal.js`(+3 라우트), `models/QnoteUsageEvent.js`(신규), `models/index.js`(등록), `services/plan.js`(초 단위), `setup-qnote-billing-schema.js`(신규).
- q-note: `routers/live.py`(stream_id·hard-block·flush), `routers/sessions.py`(create 검증), flush 헬퍼.
- Frontend: q-note live WS close 핸들 + `locales/{ko,en}/qnote.json`.
