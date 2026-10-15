# Q talk — «열어 봄» 과 «참여» 가르기 (2026-10-15)

> Irene: *"Q talk에서 채팅리스트에 어떻게 추가되는 거야? 관리자는 무조건 추가되는 거야? 초대 안했는데 들어가있고 그런데 왜 그래?"*
> 정찰 `.claude/plans/qmv7x6n6o.md` 1번 절 · **Fable 설계 판정 A**(2026-10-15) · [Opus] 구현.

## 원인
- **보이는 것**(가시성 축): 멤버 이상은 프로젝트·고객 채팅을 참여하지 않아도 목록에서 본다 — 열린 문화(2026-10-09 D3 에서 유지한 결정). 관리자만이 아니라 멤버 전원.
- **들어가 있는 것**(참여 축): 방을 **열기만 해도** 읽음 처리(`PUT /:biz/:id/read`)·핀이 `role:'member'` 참여자 행을 만들었다.
  그 순간 참여자 목록·@ 후보·메시지 알림·읽음 «N/M» 분모에 들어갔다 → «초대 안 했는데 들어가 있다».

## 결정 (Fable A — B «목록을 참여자만» 은 하지 않는다)
- `conversation_participants.is_viewer TINYINT(1) NOT NULL DEFAULT 0` — 1 = 열어 봤을 뿐(읽음 커서·핀만 담는 행).
  `role` ENUM 에 'viewer' 를 넣지 않는다 — «누구인가» 와 «보는 중인가» 는 다른 축이고, `role==='client'` 로 가르는 곳이 새 값을 기본값으로 떨어뜨린다.
- **모델 `defaultScope: { is_viewer: false }`** — findAll·findOne·count·include `participants` 가 전부 진짜 참여자만 본다.
  알림 팬아웃·참여자 패널·@ 후보·읽음 분모·목록 include·today_review·task_extractor·convBroadcast·taskRoom·소켓 join 이 코드 수정 없이 viewer 를 뺀다. 새 코드가 깜빡해도 «빠지는 쪽» 으로 틀린다.
- **쓰는 문은 `services/convParticipants.js` 하나**
  - `touchOwnRow` — 읽음·핀. 없으면 **viewer 로** 만든다(viewer 를 만드는 유일한 문). 접근 판정은 호출부가 먼저.
  - `joinParticipant` — 생성·초대·고객 채널·초대 수락·게스트·Cue. viewer 면 **참여자로 올린다**(joined_at 지금, 핀·커서 유지).
  - `promoteSpeaker` — viewer 가 그 방에 말하면(메시지 3 경로 + 카드 + 청구서 카드) 참여자. 감사 `conversation.participant_join`.
  - `ownRows` — 목록의 내 핀·읽음 커서(viewer 포함) · `removeRows` — 내보내기·대화 삭제(viewer 행까지, FK).
- **raw SQL** — 내 안읽음(내 읽음 커서)은 viewer 도 센다(`own-row` 표식). 사적 방 접근권은 `is_viewer = 0` 만(notifications 푸시 배지).
- **가드** `node scripts/guard-invariants.js --category=convparticipants`(하드) — helper 밖 unscoped/create/findOrCreate/bulkCreate/upsert/destroy 금지 · raw SQL 은 `is_viewer = 0` 또는 `own-row` 표식.
- **승격·강등**: 초대 → 참여자 · 말하기 → 참여자 · 내보내면 행 삭제(다시 열면 viewer) · 프로젝트 멤버 추가 → project_channel 이 joinParticipant 로 올림 · 자동 강등 없음.
- **화면**: viewer 는 어디에도 그리지 않는다(«보는 중» 칸 없음).

## 옛 데이터
- `scripts/migrate-conv-viewer.js`(멱등, 배포 슬롯 — 모델이 SELECT 하므로 코드보다 먼저).
- `scripts/backfill-conv-viewer.js` — 추정(role member · 지금 참여자 · Cue 아님 · 프로젝트 멤버 아님 · 감사 participant_add 없음 · 보낸 메시지 0 · 방보다 5초 넘게 늦게 생김 **전부**).
  기본 dry-run(워크스페이스·사유별 건수·표본) → `--apply` 가 장부(`scripts/out/`)를 남기고 `--revert <장부>` 로 원복. 사적 방 행은 viewer 가 되면 접근권이 사라진다(D3 의 뜻) — 건수 따로 보고.
  오판 비용 = 참여자 목록·@·알림에서 빠짐뿐(방은 보이고 초대 한 번·말 한 번이면 돌아온다). **운영 적용은 배포 때 수동**(dry-run 먼저).
  dev: 대상 8건(사적 방 7) — apply → 재실행 0 → revert 8/8 → 재apply.

## 검증 (2026-10-15 dev 실호출 23/23 · defaultScope 뺀 대조군 7건 뒤집힘)
비참여 멤버 열기 → viewer 행·참여자 목록 없음 · 핀 → viewer 유지·목록 핀 · 남의 메시지 → 알림 0·본인 안읽음 1 · 읽음 분모 viewer 제외 ·
말하면 참여자(감사 1, 두 번째 0)·이후 알림 1 · 내보내기 → 다시 열면 viewer → 초대 201 승격·감사 1 · 재초대 200 ·
사적 방 비참여 read 403/pin 404·행 0 · 사적 방 viewer 행 = 접근·목록 없음 / 참여자 = 있음 · 대화 삭제 viewer 행 포함 200.

## Irene 께 드리는 답
관리자(멤버 이상)는 **추가되는 게 아니라 볼 수 있는** 것이다(프로젝트·고객 방은 워크스페이스에 열려 있다). 그런데 지금까지는 열기만 하면 참여자로 박혀
초대 안 한 사람이 참여자 목록·@·알림에 들어갔다. 이제 열어 본 것과 참여한 것을 가른다 — **초대했거나 그 방에서 말한 사람만 참여자.** 목록에 보이는 범위는 그대로.
