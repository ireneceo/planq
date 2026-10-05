# 목소리 프로필 → Q Note 화자 자동 이름 — 설계 (2026-10-05, Fable)

> Irene 2026-10-04: *"팀원 고객 목소리들이 자기 프로필에 저장되어 있으면 사용하게 하면 되겠네. 좋다."* → *"2는 다음 개발 항목으로 하자."*
> 범위: 팀원·고객이 **자기** 프로필(고객은 `/home`)에 목소리를 등록하면, Q Note 회의(대면 마이크·화상 탭소리·녹음 업로드)에서
> 화자 블록에 이름이 자동으로 붙는다. Zoom/Meet 봇 연동은 **하지 않는다**(결정 완료). 생체정보라 **R=1** — 구현 전 이 문서가 정본.

## 0. 지금 상태 (코드 실측 — 전제가 문서와 달랐다)

| 항목 | 실측 | 앵커 |
|---|---|---|
| 목소리 등록 | 있다. 사용자 × 언어 1행, 256-d Resemblyzer 임베딩만 저장(원본 오디오 미저장) | `q-note/routers/voice.py` · `services/database.py:359` `voice_fingerprints(user_id, language, embedding)` |
| 라이브 «나» 자동 매칭 | **죽어 있다.** `_auto_match_self`(`live.py:132`)·`_load_user_fingerprints`(`:109`)는 정의만 있고 호출부가 없다 — 커밋 `a323e67d` 에서 호출을 뺐다 | `git show a323e67d -- q-note/routers/live.py` |
| 화상회의 «나» | 목소리가 아니라 **채널 0(마이크) = 나** 로 확정 | `live.py:706-714` |
| 화상회의 상대 | 채널 1 안 Deepgram 화자번호 → 키 `100+n`(«상대 1·2»). 2026-10-04 선행 완료 | `live.py:76,677` · `QNotePage.tsx:181-210` |
| 마이크 모드 라벨 | 수동 지정(`participant_name`·`is_self`)만 표시, 자동 라벨 없음 | `QNotePage.tsx:2127-2137` |
| `self-voice-sample` | 서버 라우트는 있으나 **프론트 호출 0건** | `sessions.py:1982` · `grep -rn self-voice dev-frontend/src` = 0 |
| 종료 시 화자 병합 | `speaker_embeddings`(세션 화자별 임베딩)로 군집 병합. **지문과 비교하지 않는다** | `services/speaker_clustering.py` · `sessions.py:1483` |
| 화상회의 서버 버퍼 | 스테레오 프레임을 **디인터리브 없이** 그대로 넣는다(`extract` 는 모노 가정) | `live.py:1102` · `services/audio_buffer.py:44` |
| 삭제 연동 | 계정 익명화 cron → `POST /api/sessions/internal/purge-user` 가 지문까지 지운다 | `services/accountAnonymize.js:109` · `sessions.py:376,413` |
| 데이터 규모 | dev 지문 2행(1명) · **운영 0행** · 운영 세션 30건 전부 L1 · `client_id` 연결 세션 0 | SQLite 실측 2026-10-05 |

→ 이 기능은 «나 자동 매칭을 N명으로 확장» 이 아니라 **라이브 매칭 경로를 다시 세우는 것**이다. 운영 지문이 0행이라 스키마 이전 부담은 없다.

## 1. 데이터 모델

### 1-1. 임베딩은 **q-note SQLite 에 둔다** (MySQL 로 옮기지 않는다)
- 인코더(Resemblyzer)·매칭·삭제 경로(`purge-user`)가 전부 q-note 에 있다. MySQL 에 BLOB 을 두면 매 발화마다 cross-DB 왕복이 생기고, 삭제가 두 DB 트랜잭션으로 갈라진다.
- **MySQL 에는 생체정보를 한 바이트도 두지 않는다.** Node 가 아는 것은 «등록 여부·동의 시각» 뿐이고 그것도 **q-note 에 물어서** 안다(아래 1-4). 두 벌 보관 금지.

### 1-2. 소유 = **사람(`user_id`)**, 워크스페이스가 아니다
- 목소리는 사람의 것이다. 두 워크스페이스에 속한 사람의 프로필은 하나이고, **어느 회의에서 후보가 되는가**는 매칭 시점에 Node 멤버십으로 가른다(§3-1). 워크스페이스별로 복제하면 삭제가 샌다.
- `voice_fingerprints` 에 열 추가(멱등 `ALTER`, `database.py` 의 `_column_exists` 패턴):

| 열 | 뜻 |
|---|---|
| `consent_version TEXT` | 동의 문구 버전(`VOICE_CONSENT_VERSION`, 예 `2026-10`). 현재 버전과 다르면 **매칭 후보에서 제외** + 화면이 재동의를 요구 |
| `consent_at TEXT` | 동의 시각 |
| `subject_kind TEXT NOT NULL DEFAULT 'user'` | `user`(팀원 계정) / `client`(고객 계정). 표시명을 어디서 읽을지 가른다 |
| `match_enabled INTEGER NOT NULL DEFAULT 1` | 사람이 «자동 인식 끄기» 를 고른 상태(등록은 두고 매칭만 끈다) |
| `last_matched_at TEXT` | 보관기간 판정용(§2-4) |

- `speakers` 에 열 추가:

| 열 | 뜻 |
|---|---|
| `matched_user_id INTEGER` | 자동/수동으로 고른 **사람**. 프로필 링크·재해석의 열쇠 |
| `matched_kind TEXT` | `user` / `client` |
| `name_source TEXT` | `voice_auto` / `manual` / `channel`(화상 채널0 = 나). NULL = 이름 없음 |
| `match_similarity REAL` | 자동 판정 당시 유사도(감사·튜닝용. 공개 응답에 싣지 않는다) |

- `participant_name` 은 **표시명 스냅샷**으로 그대로 쓴다(수동 이름과 같은 자리). 이름이 바뀌면 다음 회의부터 새 이름이다 — 회의록은 그날의 기록이다.

### 1-3. 고객은 **`Client.user_id` 가 있는 계정만**
- 등록 = 본인 동의다. 로그인이 없는 고객(초대 미수락·`prospect`·게스트 링크 방문자)은 **등록할 수 없고, 멤버가 대신 등록해 주는 것도 금지**(제3자 생체정보 수집). 화면에 그런 버튼을 만들지 않는다.
- 고객 로그인 토큰은 `role:'client'`(`routes/auth.js:134`). q-note `get_current_user`(`middleware/auth.py:12`)는 `user_id` 만 쓰므로 등록 라우트는 그대로 통한다. **단 세션 라우트(`/api/sessions/*`)는 고객에게 열지 않는다**(PERMISSION_MATRIX §5.8 client = `-`).

### 1-4. Node 는 «후보» 와 «표시명» 만 준다 — 한 함수
- 신규 `GET /api/internal/qnote/voice-candidates?business_id=&project_id=&client_id=&recorder_user_id=` (내부 키, `routes/internal.js` 의 `business-membership` 옆).
  구현은 `services/voiceCandidates.js` **한 벌** — 후보 집합과 표시명을 같이 돌려준다 `[{user_id, kind, display_name}]`.
- 반대 방향(«이 사람 지문 있나»)은 Node 가 묻지 않는다. 후보 목록에 지문 유무를 싣지 않는다(§4-2).

## 2. 동의 · 민감정보 (개인정보보호법 §23 민감정보 — 생체정보)

### 2-1. 본인 등록만, 명시 동의만
- `POST /api/voice-fingerprint` 에 `consent_version` 폼 필드 **필수**. 서버의 `VOICE_CONSENT_VERSION` 과 다르면 400 `consent_required` — 체크박스 없이 올린 요청은 저장되지 않는다.
- 동의 문구는 **별도 체크박스 1개 + 전문 펼치기**. 「서비스 약관에 포함」으로 갈음하지 않는다(민감정보는 별도 동의).
- 문구(정본은 i18n, §5-4). 한국어:
  > 「내 목소리의 특징값(숫자 벡터 256개)을 PlanQ 에 저장하는 데 동의합니다. 이 값은 **내가 속한 워크스페이스의 Q Note 회의에서 내 발언에 내 이름을 붙이는 데에만** 쓰이고, 원본 음성은 저장되지 않으며, 외부로 전송되지 않습니다. 언제든 삭제할 수 있고 삭제하면 즉시 매칭이 중단됩니다.」
  > 영어: "I agree that PlanQ stores a numeric signature of my voice (256 values). It is used **only to label my own speech with my name in Q Note meetings of workspaces I belong to**; no raw audio is kept and nothing is sent to third parties. I can delete it at any time, and deletion stops matching immediately."
- 문구와 코드는 **한 줄씩 대조**한다(memory `feedback_copy_must_match_code_line_by_line`): «원본 미저장» = `voice.py:_decode_audio_to_pcm16` 이 메모리에서만 다룬다 · «외부 미전송» = 임베딩은 로컬 CPU, Deepgram 에는 회의 오디오만 간다(지금도 그렇다) · «즉시 중단» = §2-3.

### 2-2. 원본 오디오는 **지금처럼 저장하지 않는다**
- 등록·확인·라이브 전부 메모리 PCM → 임베딩 → 폐기. 회의 PCM 버퍼는 WS 종료 시 `clear()`(`live.py:1193`). 「나중에 다시 임베딩하려고 원본을 두자」는 **하지 않는다** — 모델을 바꾸면 재등록을 요청한다(동의 버전을 올리면 자동으로 재동의·재등록 흐름이 된다).

### 2-3. 철회 = 즉시 삭제
- `DELETE /api/voice-fingerprint`(전체)·`/{language}` 는 지금처럼 행을 지운다. 추가로:
  - 삭제 직후 열려 있는 라이브 세션의 후보 캐시에서 빠져야 한다 → 후보는 **세션 시작 시 1회 + 10분마다** 다시 읽는다(§3-1). 그 사이 이미 붙은 이름은 남는다(그 회의에 실제로 있었던 사실의 기록. 수동 입력과 동일).
  - 과거 노트의 `participant_name` 은 **지우지 않는다**(생체정보가 아니라 회의록의 이름이다. 수동으로 쳐 넣은 이름과 같은 지위). `matched_user_id` 도 둔다(프로필 링크용 — 사람이 탈퇴하면 익명화 cron 이 지운다, 아래).
- 계정 탈퇴: `purge-user` 가 이미 `voice_fingerprints` 를 지운다(`sessions.py:413`). 추가로 **`UPDATE speakers SET matched_user_id=NULL, matched_kind=NULL WHERE matched_user_id=?`** 를 같은 함수에 넣는다(남의 세션에 박힌 내 링크). 이름 스냅샷은 Node 익명화 정책과 같게 둔다(ACCOUNT_DELETION_DESIGN D6 범위 안).
- 데이터 내보내기(`services/exportJobWorker.js:27` → `internal/export`): 응답에 `voice_profile: {languages:[…], consent_version, consent_at, match_enabled}` 을 더한다. **임베딩 바이트는 내보내지 않는다**(복원 불가 값이라 사용자에게 의미가 없고, 유출 표면만 넓힌다).

### 2-4. 보관기간
- 제안: **마지막 매칭/등록 후 24개월** 미사용이면 30일 전 알림 → 자동 삭제(`last_matched_at` 기준, q-note 일일 cron). 기간은 Irene 결정 ①.
- **세션별 `speaker_embeddings`** 는 제3자(동의 없는 상대)의 파생 생체정보다. 지금은 세션과 함께 영구 보존된다. 용도는 종료 시 병합뿐(`speaker_clustering.py`)이므로 **완료 7일 후 삭제**를 제안한다(Irene 결정 ②). 이 결정은 이 기능과 무관하게 지금도 서 있는 문제라 따로 적어 둔다.

### 2-5. 감사 로그
- q-note 는 MySQL 이 없다. 신규 내부 라우트 `POST /api/internal/audit` (Node, 내부 키 → `services/auditService.writeAudit`) 를 q-note 가 부른다: `voice_profile.register` / `voice_profile.delete` / `voice_profile.settings`(business_id NULL = 사람 단위) · `qnote.speaker.auto_named`(business_id = 세션 워크스페이스, target = session). 감사 실패는 **삭제를 막지 않는다**(삭제가 우선) — 경고 로그.
- 개인정보처리방침(`locales/{ko,en}/legal.json` s3 「Q Note 음성 데이터」 한 줄)에 **생체정보 항목을 따로** 추가: 항목·목적·보관기간·철회 방법. §2-1 문구와 같은 사실만 적는다.

## 3. 매칭

### 3-1. 후보 집합 — 세션마다, Node 가 정한다 (fail-closed)
```
candidates(session) =
    녹음자 본인(user_id)                                            — 항상
  ∪ 그 워크스페이스의 현재 멤버 (business_members.removed_at IS NULL, is_ai=false)
  ∪ 고객 계정 (clients.user_id NOT NULL, status 활성)  — 단,
      session.client_id 가 가리키는 고객, 또는
      session.project_id 의 project_clients 에 묶인 고객           — 만
  − match_enabled=0 · consent_version ≠ 현재 · 지문 0행
```
- **다른 워크스페이스 사람은 지문이 있어도 후보가 아니다.** 같은 사람이라도 그 워크스페이스 멤버가 아니면 빠진다 — 테넌트 경계는 사람이 아니라 멤버십이다.
- 고객을 «워크스페이스 모든 고객» 으로 넓힐지는 Irene 결정 ③. 기본은 좁게(연결된 프로젝트·고객) — 고객 300명짜리 워크스페이스에서 모든 고객 지문과 비교하면 오인식이 는다.
- Node 호출이 실패하면(`billing_client.check_membership` 는 `None` fail-open 이지만 **여기서는 안 된다**) 후보 = 녹음자 본인만. 이름을 못 붙이는 것은 되돌릴 수 있고, 남의 이름을 붙이는 것은 되돌리기 어렵다.
- 세션 시작 시 1회 로드 + 10분마다 갱신(삭제·탈퇴 반영). 임베딩은 후보 `user_id` 로만 `SELECT`(`voice_fingerprints WHERE user_id IN (…)`).

### 3-2. 판정 — 임계값 둘 + 여유폭
| 상황 | 규칙 |
|---|---|
| 녹음자 본인 | 기존 `SELF_MATCH_THRESHOLD`(0.62, `voice_fingerprint.py:77`) 유지 → `is_self=1` (죽어 있던 라이브 자기 매칭의 복원) |
| 타인 | `QNOTE_PROFILE_MATCH_THRESHOLD`(초기 **0.72**) 이상 **그리고** 1위−2위 유사도 차 ≥ `QNOTE_PROFILE_MATCH_MARGIN`(초기 **0.08**) 일 때만 이름 |
| 그 외 | **이름을 붙이지 않는다.** «비슷한 사람 후보» 도 띄우지 않는다(틀린 추천은 사람이 믿는다) |
- 타인 임계값이 더 높은 이유: 자기 오인식은 «내 발언이 상대로» 정도지만, 타인 오인식은 **남의 이름으로 남의 말이 기록**된다.
- 임계값은 env 로 두되 **dev 실측으로 정한다**(§6-1). 수치는 설계가 아니라 측정의 결과다.
- 평가 시점: 화자별 누적 PCM 3초(`SpeakerAudioCollector.live_trigger_sec`) 에 1차, 10초에 2차(더 긴 샘플이 보통 정확), 세션 완료 시 배치 3차. **한 번 붙은 이름은 자동으로 바꾸지 않는다** — 자동은 `name_source IS NULL` 인 행만 채운다. 사람이 고친 것(`manual`)은 절대 덮지 않는다.

### 3-3. 한 사람 = 한 화자, 한 화자 = 한 이름
- 같은 사람이 세션 안에서 둘째 화자 행에도 판정되면 기존 `_auto_match_self` 의 병합 로직(`live.py:171-200`, utterances 이동 후 행 삭제)을 **일반화**해 쓴다 — 단 양쪽 다 임계값·여유폭을 넘을 때만. 아니면 높은 쪽만 이름, 나머지는 무명.
- 다른 두 사람이 한 화자 행에 나올 수는 없게 설계한다(행마다 1위 한 명).

### 3-4. 캡처 모드별 통합
| 모드 | «나» | 상대 | 바뀌는 코드 |
|---|---|---|---|
| 마이크(`microphone`) | 지문 매칭(복원) | 지문 매칭 | `live.py` — `_commit_pending_utterance` 뒤 `speaker_collector.add` 가 `'trigger_live'` 를 돌려줄 때 `_auto_match_speaker(…)` 호출 (`:748-750` 자리). 죽은 `_auto_match_self` 는 이 함수로 **대체**(두 벌 두지 않는다) |
| 화상(`web_conference`) | **채널 0 = 나 그대로**(지문 안 본다 — 하드웨어 사실이 더 정확) | 키 `100+n` 마다 지문 매칭 | ① 수신 청크를 **디인터리브**해 채널별 `RollingAudioBuffer` 두 개(`live.py:1102` 는 지금 스테레오를 모노 버퍼에 넣는다) ② 두 번째 `SpeakerAudioCollector` 를 `mc_speaker_key` 로 운용(`:744-750` 의 «단일 채널만» 제한을 채널 1 전용 수집기로 해소) ③ 후보에서 녹음자 본인 제외 |
| 업로드(`upload`, `audio_upload.py`) | 지문 | 지문 | 다이어라이즈 결과의 화자별 PCM 으로 배치 1회(라이브 함수와 **같은** `_auto_match_speaker`) |
| 텍스트 | 해당 없음 | — | — |

- 프론트 라벨 공식은 **한 곳**으로 합친다: `QNotePage.tsx:2127` 의 마이크 분기와 `speakerLabelFor` 가 갈라져 있다. 둘 다 `speakers[].participant_name` 을 우선 읽게 되므로 자동 이름은 추가 코드 없이 보인다. `name_source==='voice_auto'` 면 라벨 옆 작은 「자동」 표시(세션 생성자에게만, §4-1).

### 3-5. 사람이 고친다
- `SpeakerPopover`(`QNotePage.tsx:3653`)에 **사람 고르기**(후보 목록 = §3-1 과 같은 Node 함수, 세션 생성자만 `GET /api/sessions/{id}/speaker-candidates`) + 기존 자유 입력 유지. 사람을 고르면 `matched_user_id` 설정 + `name_source='manual'`. 「이름 지우기」 는 `participant_name=NULL, matched_user_id=NULL, name_source=NULL` — 이후 자동이 **다시** 채울 수 있다(사용자가 지운 것은 «틀렸다» 지 «붙이지 마라» 가 아니다 — 영구 차단은 Irene 결정 ④).
- `match` / `reassign-speaker` 라우트(`sessions.py:2156, 2209`)가 그대로 문이다. 새 라우트를 만들지 않는다.

## 4. 노출

### 4-1. 누가 «자동으로 붙었다» 를 보나
- **세션 생성자만** 「자동」 표시와 유사도(툴팁)를 본다. 생성자가 L2~L4 로 연 열람자에게는 이름만 — 수동 이름과 구별되지 않는다.
- 공개 링크(`sessions.py:3049 public/by-token`)의 `speakers` 는 **화이트리스트** `{id, participant_name, is_self}` 로 줄인다(지금 `deepgram_speaker_id` 까지 나간다). `matched_user_id`·`match_similarity`·`name_source` 는 인증 사용자용 GET(`:1379`)에도 **생성자에게만** 싣는다(`_load_session_or_403` 의 owner 판정 재사용).

### 4-2. «이 사람이 목소리를 등록했다» 는 사실 자체
- 후보 목록(`speaker-candidates`)은 지문 유무를 **싣지 않는다** — 워크스페이스 멤버·연결 고객 전원이 똑같이 나온다(멤버 명부는 이미 보이는 정보라 새 노출이 없다).
- 자동 이름이 붙으면 생성자는 «그 사람이 등록했다» 를 추론할 수 있다. 이것은 동의 문구가 말하는 용도 그 자체이므로 허용한다(문구에 «내 이름을 붙이는 데» 라고 명시).
- 프로필 화면의 등록 상태는 **본인만** 본다(`GET /api/voice-fingerprint` 는 토큰의 user_id 로만 읽는다 — 지금과 같다). 멤버 상세·고객 상세에 「목소리 등록됨」 배지를 **만들지 않는다**.

## 5. API · 화면 · i18n

### 5-1. q-note (FastAPI, `/qnote/api/*`, nginx → :8000)
| 메서드·경로 | 변경 | 인증·제한 |
|---|---|---|
| `POST /api/voice-fingerprint` | `consent_version` 필수 · `subject_kind` 는 토큰 role 로 서버가 정한다 · 감사 | 기존 + `services/rate_limit.py` 사용자당 10회/시간(임베딩은 CPU 작업) |
| `GET /api/voice-fingerprint` | `consent_version, consent_at, match_enabled, consent_current(bool)` 추가 | 기존 |
| `PATCH /api/voice-fingerprint/settings` | 신규 `{match_enabled}` | 본인 |
| `DELETE …` | 기존 + 감사 | 기존 |
| `POST /api/voice-fingerprint/test` | 기존 | 사용자당 20회/시간 |
| `GET /api/sessions/{id}/speaker-candidates` | 신규 — Node `voice-candidates` 프록시(표시명만) | `_load_session_or_403(access='write')` = 생성자만 |
| `POST /api/sessions/{id}/self-voice-sample` | **삭제**(호출부 0건·새 경로와 중복) | — |
| `POST /api/sessions/internal/purge-user` | `speakers.matched_user_id` 해제 추가 | 내부 키 |
| `GET /api/sessions/internal/export` | `voice_profile` 메타 추가 | 내부 키 |

### 5-2. Node
| 메서드·경로 | 내용 |
|---|---|
| `GET /api/internal/qnote/voice-candidates` | §1-4. `services/voiceCandidates.js` 한 함수 |
| `POST /api/internal/audit` | §2-5. `writeAudit` 래퍼. 액션 화이트리스트(`voice_profile.*`, `qnote.speaker.*`) 외는 400 |
- 플랜 게이트: **없음**(제안). 매칭은 STT 분 과금 안에서 일어나고 임베딩은 로컬 CPU 다. 비용 가드는 위 rate-limit 과 기존 `MAX_LIVE_STREAMS_PER_USER` 로 충분하다. (Irene 결정 ⑤)

### 5-3. 화면 — 새로 그리지 않는다
- `ProfilePage.tsx:965` 의 목소리 섹션을 **`components/Profile/VoiceProfileSection.tsx` 로 뺀다**(동의 체크박스·용도 안내·자동 인식 토글(`AutoSaveField type="toggle"`)·언어별 등록·삭제). ProfilePage 와 `ClientHomePage.tsx` 가 **같은 컴포넌트**를 얹는다(CLAUDE.md «껍데기는 빼서 같이 쓴다»).
- 고객 홈 카드 문구는 고객 관점(«상담 회의에서 내 이름이 자동으로 표시됩니다»).
- Q Note: 「자동」 표시 + 팝오버 사람 고르기(§3-5). 회의 시작 모달에 안내 한 줄(«목소리를 등록한 참석자는 이름이 자동으로 붙습니다 · 내 프로필에서 등록») — 기준은 화면이 짧게 알려준다.

### 5-4. i18n 키 (ko/en 동시 작성 · 가드 `--category=i18n|parity`)
- `profile.voice.consent.label` 「내 목소리 특징값 저장과 회의 중 이름 표시에 동의합니다」 / "I agree to store my voice signature and show my name in meetings"
- `profile.voice.consent.full` (§2-1 전문) · `profile.voice.consent.required` 「동의해야 등록할 수 있습니다」 / "Consent is required to register"
- `profile.voice.consent.outdated` 「안내 문구가 바뀌었습니다. 다시 동의하면 자동 인식이 계속됩니다」 / "The notice has changed. Agree again to keep automatic recognition"
- `profile.voice.usage.title` 「어디에 쓰이나요」 / "Where it is used" · `profile.voice.usage.body` 「내가 속한 워크스페이스의 Q Note 회의에서 내 발언에 내 이름이 붙습니다. 다른 워크스페이스·외부에는 쓰이지 않습니다.」 / "…"
- `profile.voice.match.toggle` 「회의에서 자동 인식」 / "Recognize me in meetings" · `profile.voice.match.off_hint` 「등록은 유지되고 매칭만 멈춥니다」 / "Registration stays; matching stops"
- `profile.voice.retention` 「{{months}}개월 동안 쓰이지 않으면 자동 삭제됩니다」 / "Deleted automatically after {{months}} months without use"
- `guest.home.voice.title` 「내 목소리」 / "My voice" · `guest.home.voice.body` 「등록하면 상담 회의록에서 내 발언에 내 이름이 표시됩니다」 / "…"
- `qnote.page.speaker.auto` 「자동」 / "auto" · `qnote.page.speaker.autoTip` 「목소리 프로필로 인식됨 · 유사도 {{sim}}」 / "Matched by voice profile · similarity {{sim}}"
- `qnote.page.speaker.pickPerson` 「사람 고르기」 / "Pick a person" · `qnote.page.speaker.clearName` 「이름 지우기」 / "Clear name"
- `qnote.start.voiceHint` 「목소리를 등록한 참석자는 이름이 자동으로 붙습니다」 / "Participants who registered a voice are named automatically"
- `legal.privacy.s?.biometric` (개인정보처리방침 생체정보 항목 — 항목·목적·보관·철회)

## 6. 검증 계획 (R=1 — 구현 뒤 Fable 게이트에 **한 번에** 올린다)

### 6-1. 임계값 실측 (구현 전·후 같은 픽스처)
- 픽스처: `scripts/e2e/fixtures/voice/` — 팀 3명(동의한 개발팀) × ko/en 각 20초 등록용 + 10초 검사용, 그리고 **합성 음성**(espeak 음높이·속도 다른 4 프로필)으로 음성 대조군. 커밋한다(개발팀 동의 문서 한 줄 포함).
- 표: 본인–본인 / 타인–타인 쌍의 유사도 분포 → 0.72/0.08 이 양쪽을 가르는지. **갈리지 않으면 수치를 바꾸지 말고 이름을 붙이지 않는 쪽으로 둔다.**

### 6-2. 기계 검사 (`node scripts/e2e/run.js --suite voicematch` 신설 + `health-check --category=voice` 확장)
| # | 검사 | 종류 |
|---|---|---|
| 1 | 동의 없이 `POST /voice-fingerprint` → 400 `consent_required`, 행 0 | 음성 |
| 2 | 동의 포함 등록 → GET 에 `consent_current:true` · AuditLog `voice_profile.register` 1행 | 양성 |
| 3 | 워크스페이스 A 멤버 P 의 지문으로 **B 의 세션**에 P 음성 투입 → 이름 없음(후보 제외) | **음성 대조군** |
| 4 | 같은 음성을 A 세션에 투입 → `participant_name=P`, `name_source=voice_auto` | 양성 대조군 |
| 5 | P 지문 삭제 후 A 세션 재투입 → 이름 없음 · 이전 세션의 이름은 그대로 | 음성 |
| 6 | 합성 음성(미등록) 투입 → 이름 없음 · `match_similarity` 기록만 | 음성 |
| 7 | 1위·2위 차 < 여유폭 픽스처 → 이름 없음 | 음성 |
| 8 | 수동 이름 뒤 자동 재평가 → 수동 유지 | 음성 |
| 9 | Node `voice-candidates` 를 막은 채(내부 키 틀리게) → 본인 외 이름 0 (fail-closed) | 음성 |
| 10 | 공개 링크 응답 원문에 `matched_user_id`·`similarity`·`name_source` 문자열 0건(§4-1, `health-check --category=secrets` 방식) | 보안 |
| 11 | 열람자(L3 멤버) GET 에 유사도·`name_source` 없음 · 생성자 GET 에는 있음 | 보안 |
| 12 | 화상 모드: 채널 1 디인터리브 후 키 `100+n` 에 이름, 채널 0 은 `channel` 로 is_self | 양성 |
| 13 | `purge-user` → 지문 0행 · 남의 세션 `matched_user_id` NULL | 음성 |
| 14 | `match_enabled=0` → 후보 제외 | 음성 |
| 15 | 고객 계정으로 `/home` 에서 등록 → `subject_kind=client` · 연결 프로젝트 세션에서만 이름 | 양성·음성 |
| 16 | 화면 3폭: 프로필·고객 홈 섹션이 **같은 컴포넌트**(testid 동일) · 동의 미체크 시 녹음 버튼 비활성 + 이유 | 화면 |
- 양성 대조군 3·4 는 **같은 WAV** 로 워크스페이스만 바꿔야 한다 — 다른 소리로 재면 «후보 제외» 가 아니라 «못 알아들음» 을 잰 것이다.

### 6-3. 운영 적용 · 롤백
- 스키마: q-note `init_db` 의 멱등 `ALTER`(기동 시 자동). Node 스키마 변경 **없음**(AuditLog 재사용). 운영 지문 0행이라 백필 없음.
- `.env`(q-note): `VOICE_CONSENT_VERSION=2026-10` · `QNOTE_PROFILE_MATCH_THRESHOLD` · `QNOTE_PROFILE_MATCH_MARGIN` · `INTERNAL_API_KEY`(기존). 기본값 꺼짐 플래그를 두지 않는다 — 대신 **후보 0명이면 아무 일도 안 일어나는 구조**가 곧 안전 기본값이다.
- 롤백: 코드만 되돌린다. 새 열은 읽는 곳이 없으면 무해. 자동으로 붙은 이름은 `name_source='voice_auto'` 로 식별되므로 필요 시 `UPDATE speakers SET participant_name=NULL … WHERE name_source='voice_auto'` 한 줄.
- 배포 순서: Node(내부 라우트) → q-note → 프론트. q-note 가 먼저 나가면 후보 조회 실패 = fail-closed 라 안전하다.

## 7. 마일스톤 (각각 배포 가능)
| M | 내용 | 비고 |
|---|---|---|
| **M1 동의·모델** | SQLite 열 추가 · `consent_version` 게이트 · 감사 내부 라우트 · 내보내기·purge 보강 · 개인정보처리방침 항목 · `VoiceProfileSection` 추출 + 고객 홈 카드 · 자동 인식 토글 | 매칭 동작 변화 없음. 검사 1·2·13·14·16 |
| **M2 대면 매칭** | `voice-candidates` · `_auto_match_speaker`(본인 복원 + 타인) · 팝오버 사람 고르기 · 공개 응답 화이트리스트 · `self-voice-sample` 삭제 | 검사 3~11·15 |
| **M3 화상·업로드** | 채널 디인터리브 · 채널 1 수집기 · 업로드 모드 배치 | 검사 12 |
| **M4 보관** | 24개월 자동 삭제 + 예고 · `speaker_embeddings` 7일 삭제 | Irene 결정 ①② 뒤 |

## 8. Irene 결정 필요
1. **보관기간** — 마지막 사용 후 24개월 자동 삭제(30일 전 알림) 로 할까요, 아니면 삭제 요청 때까지 둘까요? (제안: 24개월)
2. **세션별 상대 임베딩(`speaker_embeddings`)** — 회의 완료 7일 뒤 삭제로 바꿀까요? 지금은 세션과 함께 영구 보존입니다. (제안: 7일)
3. **고객 후보 범위** — 세션에 연결된 프로젝트·고객의 계정만(제안) vs 워크스페이스 모든 고객 계정.
4. **사람이 자동 이름을 지웠을 때** — 그 세션에서 다시 자동으로 붙여도 되는지(제안: 가능), 아니면 그 화자에는 영구 차단.
5. **플랜 게이트** — 등록·매칭 모두 무료 전 플랜(제안) 확인.
6. **삭제 후 과거 회의록의 이름** — 유지(제안: 수동 입력과 같은 지위) 확인.

### 결정 (2026-10-05 Irene — *"제안대로 다 해"*)
① 24개월 자동 삭제 + 30일 전 알림 · ② `speaker_embeddings` 회의 완료 7일 뒤 삭제 · ③ 고객 후보 = 세션에 연결된 프로젝트·고객 계정만 ·
④ 사람이 지운 자동 이름은 다시 자동으로 붙을 수 있다 · ⑤ 플랜 게이트 없음(전 플랜) · ⑥ 삭제 후 과거 회의록의 이름 유지.

### 구현 중 실측으로 바꾼 것 (2026-10-05, Opus)
- **임계값 0.72 → 0.85, 본인 0.62 기준 폐지(누구든 같은 기준).** `scripts/e2e/fixtures/voice/`(Deepgram TTS 4목소리 × 서로 다른 문장 2):
  같은 목소리 0.944~0.977 · 3초 조각 0.897~0.922 · **다른 목소리 최고 0.807**(asteria↔luna, 둘 다 여성).
  0.72 면 미등록 화자에게 비슷한 등록자 이름이 붙고, 본인 0.62 면 옆사람이 «나» 가 된다(본인만 등록된 회의는 2위가 없어 여유폭도 못 막는다).
  §6-1 «갈리지 않으면 붙이지 않는 쪽» 원칙대로. 실제 마이크 음성은 TTS 보다 유사도가 낮게 나오므로 운영 실측 뒤 env 로 낮출 수 있다.
  프로필 [인식 확인]도 같은 기준을 쓴다(여기만 관대하면 «인식됩니다» 가 회의에서 거짓이 된다).
- **`subject_kind` 열 없음.** 로그인 토큰에 역할이 없어(`services/authTokens.generateAccessToken` = userId·email) 서버가 정할 수 없다.
  멤버/고객 구분은 매칭 때 Node `voiceCandidates` 가 준다.
- **`speaker_embeddings` 7일 삭제 기준 = 상태 무관 «7일 동안 움직임 없음»**(Fable F-2). completed 만 보면 일시정지·방치 회의의 제3자 임베딩이 영구히 남는다(운영 실측 10행). 처리방침 s4 문구도 같은 뜻으로 맞췄다.
- 라이브 병합 뒤 같은 화자 키가 다시 말하면 남은 행으로 보낸다(`speaker_aliases`, F-1) · 감사 `qnote.speaker.auto_named` 의 user_id = 회의를 연 사람, 이름 붙은 사람은 `named_user_id`(F-5)
