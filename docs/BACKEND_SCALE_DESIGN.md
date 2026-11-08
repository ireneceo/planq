# 백엔드 확장 설계 — 고객이 늘 때 (2026-11-08 · Fable DESIGN-READY)

> 출처: 서버 방 737b0682 «11-08 서버 확장성 점검» · Irene «권고대로». 조사·실측 [Opus] 방 851e29f4, 설계 판정 Fable.
> 이 문서가 설계 정본이다. 0단계는 지금 착수 대상, 1·2단계는 아래 «트리거» 가 오면 한다.

## 0. 오늘 이미 한 것 (커밋됨)
| 항목 | 내용 | 근거 숫자 |
|---|---|---|
| 메모리 재시작 | **누수 아님.** V8 힙 상한(약 2,096MB)이 PM2 재시작 선(512MB)보다 커서 GC 를 미루다 PM2 가 먼저 죽였다. `node_args: --max-old-space-size=384`(dev) · 768(운영 설정 파일) | 재시작 137회(dev). all-files 20회 RSS 252→515MB(재시작 재현) · 강제 GC 453→211MB · 고친 뒤 60회 ≈300MB · 재시작 0 |
| 메일 실패 계정 | 끄지 않고 간격만 늘림 — 10번 연속 실패 뒤 3분부터 두 배씩, 상한 6시간(받은 적 있음)/24시간(없음). 그동안 IDLE 안 엶. 50개 자르기 전에 거름. 규칙 `services/emailAccountHealth.syncBackoff` 한 곳 | #647·#648 7,813번 실패 → 건너뜀 로그, 실패 수 멈춤 |
| 중복 인덱스 | Sequelize `sync({alter:true})` 가 `unique:true` 칸마다 같은 인덱스를 또 만든다 → 36개 표·326개, 4개 표는 상한 64 에 닿아 alter 실패(«Too many keys» — 배포에서 새 칸이 조용히 안 생김). `utils/dedupeIndexes.js` · `sync-database.js` 앞·뒤 패스 · 수동 `scripts/dedupe-indexes.js` | dev 1452→1118 행 |
| 배포 화면 | `sync-database.js` 요약을 맨 끝으로 — 배포는 `tail -20` 만 보여 줘 실패 표가 한 번도 안 보였다 | |
| 백업 | 교차 백업 scp 오류를 버리지 않고 기록 | 교차 백업은 매일 도착 중(11-08) |
| 인덱스 점검 | `business_id` 선두 인덱스 없는 표는 5개뿐이고 모두 작다(task_candidates 20행 — conversation·project 인덱스로 조회). Conversation 은 인덱스 있음. 추가 안 함 | |

## 1. 핵심 사실 — 설계를 정하는 것
**스케줄 작업이 소켓을 직접 쏜다** — `routes/notifications.notify(ioApp)` → `io.to('user:…').emit`, `emailImapCron` `mail:new`,
`invoiceDelivery` → `convBroadcast.emitConvWide(io…)`, `exportJobWorker`, `recurringTaskGenerator(io)`, `taskExtractorScheduler.setIo(io)`.
그래서 **별도 worker 프로세스는 Redis(어댑터 + emitter) 없이는 못 뗀다.** 0단계는 «프로세스 수와 무관하게 작업이 한 번만 도는 성질» 을 먼저 만든다.
지금은 web 1개(PM2 fork, instances 1)라 중복이 없지만, 설정 한 줄로 2개를 켜는 날 청구·메일이 두 번 나간다.

## 2. 0단계 (지금) — 잠금 래퍼 + 일자 키 claim + 메일 리더
`services/jobRunner.js` 신설(단일 원천):
- `runExclusive(name, fn)` — 짧은 작업. **전용 연결 하나를 고정**해 `GET_LOCK('planq:job:<name>', 0)` → 못 얻으면 즉시 skip(로그 1줄) → 끝나면 RELEASE.
  풀 연결을 쓰면 재사용되며 잠금이 떠돈다. 재시작·크래시 때 세션이 끊기며 저절로 풀린다. 선례 `retentionPurge`·`video/videoClaim`.
- `runOncePerPeriod(name, periodKey, fn)` — **돈·발송 작업**(청구 cron·체험 cron·정기청구·계약 청구 재시도·고객 구독 청구·메일 후속·공유 만료 알림·일정 알림·미읽음 에스컬레이션).
  `job_runs(name, period_key, started_at, finished_at, owner, result)` · `(name, period_key)` UNIQUE INSERT = claim. 시계가 어긋나 A 가 끝난 뒤 B 가 시작해도 두 번 안 돈다(GET_LOCK 만으로는 못 막음). 5분 알림은 `period_key = floor(now/5분)`.
- `holdLeader('planq:mail', onAcquire, onLose)` — 긴 보유. IMAP IDLE·폴링·reconcile 전체를 리더 한 프로세스만. 30초마다 획득 시도, 연결 error/end 면 IDLE 전부 닫고 재획득. Gmail 15연결 제한이 프로세스 수와 무관해진다.

단일 실행(래퍼 필수): 자정 체인 전부(스냅샷·SEO·청구들·반복업무 생성·워크스페이스 purge·업로드/휴지통 정리·메일 후속·공유 만료·cue 복구) · exportJobWorker 30초 ·
invoiceDelivery sweep · 반복업무 cleanup · node-cron 서비스(calendarReminder·booking·attendanceAutoClose·calendarReverseSync·gdriveWatch·emailFaqCluster·wikiQuestionCluster·cueKnowledge·candidateCleanup·unreadEscalation·taskExtractor 1분 fallback·weeklyReview·reportUnit).

프로세스마다 돌아도 되는 것: `ephemeralStore` sweep · `driveCache` · `imageViewer` 캐시 · `workspaceAlive` 30초 캐시(다른 프로세스 ≤30초 지연 — 소켓 `workspace:deleted` 가 보완) ·
`taskExtractorScheduler` 대화별 디바운스(받은 프로세스가 가짐 — 단 LLM 호출 직전 `conversation_id + last_message_id` claim 을 DB 에 한 번 써서 fallback 과 겹쳐도 1회).

부팅 1회성(cue 복구 +2분·invoice sweep +20초·seoArtifacts +15초·weeklyReview startup): `runOncePerPeriod(name, '<YYYY-MM-DD-HH>')`.

배포·롤백(`pm2 reload`): 새 프로세스는 «리더 대기» → 옛 프로세스 종료(kill_timeout 5초)로 잠금 자동 해제 → ≤30초 안에 획득. `job_runs` 는 `sync-database` 가 만들고 롤백 때 남겨도 무해. 롤백은 코드만.

같이 할 동작 불변 정리: `app.get('io')`/`ioApp` 경로를 한 곳(`services/realtime.js` getIo)으로 · 리미터 32개를 `middleware/security.js` store 팩토리(`makeStore(name)`) 한 곳으로.

기계 가드(guard-invariants): ① ecosystem 의 `instances` ≠ 1 이면 FAIL(1단계 완료 표시 전까지) ② server.js 가 부르는 `init*Cron`/`setInterval` 작업이 jobRunner 를 거치지 않으면 FAIL(`cronalive` 와 같은 결).

## 3. Socket.IO 어댑터 — web 2개가 되는 날(1단계) 필수, 그 전엔 불필요
- **Redis 어댑터**(`@socket.io/redis-adapter`, worker 는 `@socket.io/redis-emitter`). cluster-adapter 는 PM2 cluster 전용·sticky 못 풀고 worker 에 못 씀. MySQL 어댑터는 유지되는 것이 없다.
- **PM2 cluster 모드는 쓰지 않는다** — polling 핸드셰이크가 흩어진다. fork 2개를 다른 포트(3003·3004) + nginx `upstream` `ip_hash`(또는 쿠키 sticky) + Redis 어댑터. `socketRevoke.fetchSockets()` 는 어댑터가 있으면 전 프로세스 대상(그대로).

## 4. 요청 제한 저장소 — web 1개까지 메모리, 1단계에 Redis
- 반드시 공유: 로그인 실패(8/15분·계정당 30/시간) · 회원가입 · 초대 토큰 5/시간 · `costGuard` perUser/perUserDaily(돈) → `rate-limit-redis`.
- 프로세스별 허용: 일반 100/분(과부하 방지 목적) · 읽기 전용 경로. 사용자 기준(costGuard)은 IP 가 바뀌니 반드시 공유.

## 5. 단계·트리거
| 단계 | 할 것 | 트리거 |
|---|---|---|
| 0 (지금) | jobRunner · 모든 스케줄 작업 래핑 · getIo 단일화 · 리미터 store 팩토리 · instances=1 가드 | 지금 — 돈·발송 작업이 «프로세스 1개» 에 묶여 있는 것 자체가 위험 |
| 1 | Redis(같은 서버, maxmemory 128M, 영속 끔) → Socket.IO Redis 어댑터 → 리미터 Redis store → fork 2개·포트 분리·nginx sticky | 운영 단일 프로세스 이벤트루프 지연 p95 > 200ms 10분 지속 · node CPU > 70% 지속 · 힙 상한 재시작 하루 1회 이상(메모리만이면 상한 조정) |
| 2 | `PLANQ_ROLE=worker` PM2 앱 1개(HTTP 안 엶·redis-emitter) · web 은 `PLANQ_JOBS=off` · IMAP 리더 worker 고정 | IMAP 계정 100개 이상 또는 IDLE 메모리 > 150MB · LLM 클러스터링이 API 지연을 만들 때 |
| 지금 안 함 | Redis 설치 · PM2 cluster · worker 분리 · 리미터 32개 개별 개조 · 모든 서비스 claim 행(돈·발송만) · 두 번째 서버 | — |

## 6. 0단계 검증(완료 조건 — 기계로)
1. dev 에 같은 DB 로 2번째 인스턴스(다른 포트 3013 · 자정 체인 당기는 시험 훅)를 10분 → `SELECT name, period_key, COUNT(*) FROM job_runs GROUP BY 1,2` 전부 1 · 시험 정기청구 1건 → 인보이스 1장 · 알림 메일 1통.
2. 대조군: `PLANQ_JOBS_LOCK=off` 로 같은 시험 → 2건이 되어야 한다.
3. 메일 리더: `IS_USED_LOCK('planq:mail')` 이 한 connection · IDLE 연결 수 = 활성 계정 수(backoff 제외), 다른 프로세스 0.
4. 인수인계: 리더 `pm2 stop` → 30초 안에 다른 프로세스 획득 · IDLE 재수립 · 중복 0.
5. reload 창: 두 번 도는 period_key 0 · 60초 넘는 공백 0.
6. 가드 양성 대조군: instances 2 · 래퍼 없는 setInterval 하나 → FAIL.
7. 1단계 때: 다른 프로세스 브라우저에 `user:<id>` 알림 도착 · 로그인 실패 8회 합산 차단 · polling 핸드셰이크 400 = 0.

## 7. 운영 반영 때 배포 방이 할 것 (오늘 변경분)
- 힙 상한: 배포의 `pm2 reload <이름>` 은 node_args 를 안 읽는다. 또 `deploy-planq.sh` 신규 기동 분기는 ecosystem 파일을 안 쓰고 `pm2 start server.js …` 다 —
  운영 `pm2 describe` 로 script path·node args 확인 → `pm2 delete` → `pm2 start /opt/planq/scripts/prod-ecosystem.config.js` → `pm2 save`. 신규 기동 분기도 그 파일로 바꾸기 권고.
- 중복 인덱스: 운영에서 먼저 `node scripts/dedupe-indexes.js`(읽기만)로 개수·64 근처 표를 기록. 배포의 sync 가 앞·뒤 패스로 걷는다(잠금 대기 15초 · 못 하면 실패로 남고 다음 배포 재시도). mysqldump 가 sync 앞에 있다.
- 비차단 남은 것: 메일 backoff 기준 시각이 `updated_at` 이라 그 행의 다른 쓰기가 재시도를 미룰 수 있다 — 계정이 늘면 `last_fail_at` 칸으로 분리.
