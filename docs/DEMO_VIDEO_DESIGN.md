# 시연·홍보 영상 자동 생성 — 설계 (B단계 · 2026-10-29 · [Opus] · Fable 설계 판정: 차단 3건 반영 → PASS, §18)

> Irene 원문(10-29, 상황판): «탁월한 마케팅을 위해 이 개발을 할거야. 이걸 제대로 확인하고 fable이 검토해서 최고의 결과를 낳도록 해줘.»
> 완료 기준: 플랫폼 관리자 요청 → 대본 확인 → 가로·세로(쇼츠) 영상 생성 → 원본·소재·완성본 구글 드라이브 저장 →
> 플랫폼 관리자가 유튜브에 올리고 링크 입력 → 랜딩 노출 → SNS 발송 흐름으로 공유. 얼굴 AI 아바타는 쓰지 않는다.
> A단계 승인(10-29 «권고대로 진행해 줘»): 샘플 https://claude.ai/artifact/3saAMi8fdmQSWKSBQy6VEw · 엔진 `video-engine/`(커밋 52c15df8·d8029e59).
> A단계 Fable UX 점검 권고(구조에 넣을 것): **① 소재 검수 관문 ② 세로 전용 프레이밍 규칙** — 이 둘이 없으면 템플릿이 좋아도 같은 결함이 반복된다.

## 0. 범위
- **플랫폼(PlanQ 회사) 마케팅 도구**다. 워크스페이스(고객사) 기능이 아니다 — business_id 없음, platform_admin 전용(SNS 발송과 같은 위치).
- 하지 않는 것: 얼굴 AI 아바타 · 고객사에 영상 기능 제공 · 유튜브 자동 업로드(링크는 사람이 넣는다 — 요구사항) · 무인 SNS 발송(SNS 설계 그대로 «초안 → 승인»).
- 엔진은 하나. 생성 방식 3가지(① 녹음 기반 ② 지시만 ③ 브랜딩)는 **대본(장면 목록)만 다르게** 만든다.

## 1. 어디서 도는가 — 구조 결정 (Fable 판정 요청 ①)

| | A. 전부 운영 | B. 공방은 dev, 운영은 결과만 (권고) | C. 전부 dev |
|---|---|---|---|
| 녹화 | 운영 서버가 dev.planq.kr 데모를 원격 녹화 | dev 가 dev 데모를 녹화(지금 그대로) | 같음 |
| 렌더(무거움: 75초 영상 ≈ 25분, 크롬 2 + 합성기 ≈ 3GB) | **고객 서비스 서버에서** — 고객 응답이 느려질 위험 | dev(메모리 게이트·배포 대기 이미 있음) | dev |
| 관리 페이지(요청~버전) | 운영 /admin | **dev.planq.kr/admin/videos** | dev |
| 유튜브 링크·랜딩 노출 | 운영 | **운영 /admin «랜딩 영상»**(링크 넣기) | dev 에서 운영으로 서버 간 전송 필요 |
| SNS 소재 | 운영 | **운영 SNS 발송에 «영상 소재» 를 드라이브에서 가져오기**(§9) | 서버 간 전송 |
| 새 공개·서버 간 표면 | 없음 | 없음(사람이 링크를 옮긴다) | **새 서버 간 인증 표면** |

- 권고 **B**: 렌더는 고객 서버에 올리지 않는다. dev 와 운영 사이를 잇는 것은 **사람이 옮기는 두 가지(유튜브 링크·드라이브 파일)** 뿐이라 새 서버 간 통로가 없다.
- B 의 비용: 관리 페이지가 둘로 나뉜다(dev = 영상 공방, 운영 = 랜딩 영상·SNS). 공방 화면 머리에 «여기는 영상 공방(dev) — 완성본은 운영 [랜딩 영상]·[SNS 발송]에서 씁니다» 안내 + 운영 쪽 바로가기.
- dev 에 실데이터를 두는 셈이 된다(완성 영상·대본) — 마케팅 소재이고 고객 데이터가 아니다. dev DB 는 `scripts/backup-planq-dev-db.sh` 일일 덤프(14일)에 이미 포함된다. **dev DB 를 운영 사본으로 다시 만들 때는 `video_*` 5표를 먼저 `--tables` 로 따로 덤프해 되살린다**(Fable 비차단 5 — server-backup 은 DB 를 안 담는다).
- 운영 서버 사양은 이 방에서 볼 수 없다(운영 접속 권한 없음). A 를 고르려면 운영 메모리 실측이 먼저다.

## 2. 데이터 (dev DB · 플랫폼 표 · 모델 `dev-backend/models/Video*.js` · 마이그레이션 `scripts/migrate-video.js` 멱등)

### `video_projects` — 영상 1편(요청 1건)
| 칸 | 뜻 |
|---|---|
| id · title · mode ENUM('recording','instruction','brand') | |
| brief TEXT | 관리자 지시(②③) · 녹음 설명(①) |
| target_seconds · aspects JSON(['landscape','portrait']) | |
| template_id(FK video_templates) · music_id(FK video_assets kind=music, NULL=무음) · tts ENUM('none','openai')(기본 none) | |
| status ENUM('draft','scripting','script_ready','queued','rendering','rendered','failed','archived') | 전이는 §4 한 문 |
| current_version_id · approved_version_id | |
| drive_folder_id · youtube_url · youtube_video_id(서버가 URL 에서 뽑아 검사 — 11자 `[A-Za-z0-9_-]`) | |
| stt_seconds | 음성 인식 누적 초 — `providerCredit.deepgramSeconds()` 가 이것도 더한다(Deepgram 잔액 경보 안에 들게, 워크스페이스 과금 표에는 섞지 않음 — Fable 비차단 7) |
| created_by · timestamps · deleted_at(paranoid) | |

### `video_versions` — 대본 판(되돌리기 단위)
| 칸 | 뜻 |
|---|---|
| id · project_id · version_no(프로젝트 안 1,2,3…) · parent_version_id | |
| script JSON | **대본 정본**(사람이 확인·수정하는 것 — `video-engine/storyboards/*.json` 과 같은 모양) |
| change_note | «처음 생성» · 수정 요청 원문 · «v2 로 되돌림» |
| source ENUM('ai','human','revert') · ai_meta JSON(모델·토큰·버린 항목) | |
| status ENUM('draft','approved','rendering','rendered','failed') | approved 뒤 script 수정 불가(새 판을 만든다) |
| outputs JSON | `[{aspect, drive_file_id, drive_url, bytes, md5, seconds, render_ms, chunks:[hash…]}]` |
| approved_by · approved_at · timestamps | |
- **판은 지우지 않는다.** 되돌리기 = 옛 판의 script 를 복사한 새 판(source='revert'). 완성본 파일은 드라이브에 판마다 남는다(`v3-16x9.mp4`).

### `video_assets` — 소재·녹음·참고 영상·음악 (프로젝트에 붙거나 라이브러리)
| 칸 | 뜻 |
|---|---|
| id · project_id NULL(=라이브러리) · kind ENUM('voice','face_video','image','logo','footage','reference','music','capture') | |
| original_name · mime · bytes · md5 · seconds · width · height | |
| local_path NULL | 서버 사본(`video-engine/data/assets/<yyyy-mm>/<uuid>.<ext>`) — 드라이브 확인 뒤 NULL(§8) |
| drive_file_id · drive_verified_at | |
| analysis JSON | 이미지 인식(설명·태그) · 쓸 수 있는 구간(흔들림·어두움 제외) · 음성 인식 결과(단어 시각) · 박자 · 참고 영상 측정값 |
| license TEXT | 음악·스톡 출처 표기(예: CC BY 4.0 문장) — 완성본 설명란 문구에 자동으로 붙는다 |
| status ENUM('uploaded','analyzing','ready','failed','archived') · created_by · timestamps | |

### `video_templates` — 편집 규칙
| 칸 | 뜻 |
|---|---|
| id · slug(UNIQUE) · name · params JSON(`video-engine/templates/*.json` 모양) | |
| source ENUM('house','reference') · reference_asset_ids JSON · measured JSON(컷·박자·색 실측 + 이미지 인식 판독) | |
| preview_still · status('active','archived') · created_by · timestamps | |
- 집 템플릿 3종은 시드로 넣는다. 참고 영상 템플릿은 분석기 결과를 **관리자가 이름 붙여 저장**할 때 생긴다(자동 저장 안 함 — 판독이 틀릴 수 있다).

### `video_jobs` — 대기열(§5)
| 칸 | 뜻 |
|---|---|
| id · kind ENUM('script','analyze_asset','transcribe','capture','render','upload','template') | |
| project_id · version_id · asset_id · aspect NULL | |
| status ENUM('queued','running','done','failed','canceled') · attempts · priority | |
| claimed_by(작업자 pid@host) · claimed_at · heartbeat_at · progress(0~1) · log TEXT(마지막 4KB) · error_code · error_message | |
- 운영 쪽 표는 §9·§10 (`marketing_videos`).
- **감사 기록**: 판 승인·되돌리기·유튜브 링크·보관·랜딩 공개 토글·SNS 영상 초안은 `writeAudit`. `video_jobs.log` 는 작업 원장이지 감사가 아니다(Fable 비차단 9).

## 3. 대본 형식 (정본: `video-engine/src/types.ts` + `storyboards/*.json`)
- 대본 = 장면 배열. kind: `screen`(녹화 장면 + beat 키 자막) · `title` · `chapter` · `kinetic` · `converge` · `montage` · `points` · `logo` · **(C단계 추가)** `voice`(녹음 구간 + 얼굴 원) · `photo`(사진 확대·이동) · `footage`(영상 소재 박자 컷) · `stat`(숫자 — **사람이 입력한 값만**, AI 는 못 씀).
- 화면 장면 선택: `fromBeat`(그 순간부터 — 쇼츠 콜드 오픈) · `maxSec` · `only`('landscape'|'portrait').
- 대본 → 장면 목록 변환(`build/storyboard.js`)은 **결정적**이다(같은 대본·템플릿·소재 → 같은 결과). 가로·세로를 따로 만든다.

## 4. 상태 전이 — 문은 하나 (`services/video/videoTransition.js`)
draft →[대본 만들기] scripting → script_ready →[이 대본으로 만들기(판 승인)] queued → rendering → rendered | failed ·
rendered →[수정 요청] scripting(새 판) → script_ready … · 어느 상태든 →[보관] archived · failed →[다시] queued.
- 판 승인 뒤 대본을 고치면 **새 판**(승인한 것과 렌더되는 것이 같아야 한다 — SNS 승인 규칙과 같은 원칙).
- 렌더 중 수정 요청은 받되 새 판은 지금 렌더가 끝난 뒤 대기열에 들어간다(같은 프로젝트 렌더 동시 1건).

## 5. 대기열·작업자 (`video-engine/worker.js` · PM2 `planq-video-worker` · dev 만)
- 작업자 1개가 `video_jobs` 를 10초마다 본다. 점유는 `UPDATE … SET status='running', claimed_by=?, claimed_at=NOW() WHERE id=? AND status='queued'` 영향 1행일 때만.
- **한 번에 한 작업**(요구사항 7). 시작 전 `heavy-task-gate.sh build` + `deploy-busy.sh` + MemAvailable > 2.2GB — 막히면 기다린다(우회 없음, 1시간 넘게 막히면 작업은 queued 로 두고 관리자 화면에 «메모리 대기 중» 표시).
- heartbeat 15초. heartbeat 가 5분 끊긴 running → 작업자 재시작 시 queued 로 되돌린다(렌더·분석은 멱등 — 같은 입력이면 같은 결과, 다시 해도 안전). `upload` 는 드라이브 쪽 같은 이름·md5 파일을 먼저 찾아 중복 업로드를 막는다.
- 실패 사유 코드: memory_wait_timeout · capture_failed · render_failed · drive_not_connected · drive_upload_failed · stt_failed · llm_failed · asset_unusable. 화면에 사람이 읽는 문장으로.
- 작업별 상한: 렌더 1편 90분 · 전사 10분 · AI 대본 2분 · 소재 분석 3분.
- 진행률은 관리자 화면에 실시간(Socket.IO 플랫폼 관리자 방 신호 → 화면이 다시 읽음, 정본은 DB).
- **공용 게이트의 구멍**(Fable 비차단 6): 서버 공용 `heavy-task-gate.sh` 는 node RSS 만 보므로 렌더 중 크롬(≈2GB)이 안 보인다. 작업자는 렌더 동안 `logs/video-render-running.pid` 를 남기고, PlanQ `npm run build` prebuild·e2e 러너가 `deploy-busy.sh` 처럼 이것도 기다린다. PurpleHere·Lingo 빌드까지 막으려면 `/var/www/scripts/heavy-task-gate.sh` 에 이 표시를 보태야 한다 — PlanQ 폴더 밖이라 **Irene 할 일(서버 방)**. PM2 `planq-video-worker` 에 `max_memory_restart` · `--max-old-space-size`, Remotion `concurrency` ≤ 2.

## 6. 세 가지 생성 방식
### ② 지시만 (A단계 `ai/script.js` 그대로 + 아래)
- `services/llm` 목적 **`video_script`** 를 PURPOSES 에 등록(gpt-5.1 · 4000 토큰 · 120초) — 미등록이면 generic 으로 조용히 떨어진다(SNS 설계 지적 14 선례). 플랫폼 비용, costGuard.perUserLimiter(분 3·일 40).
- 울타리: 사실 = 랜딩 문구(`locales/ko/landing.json`) + 위키 공개 글 요약 · 화면 = 녹화 장면 목록의 id·beat 키만 · screen 자막은 beat 설명에 있는 것만 · 숫자 장면 금지 · 슬로건 «일을 *일답게* 하다» 고정 · 길이 예산.
- 소리 = 자막 + 배경음악. TTS 는 선택(OpenAI TTS — 켜기 전 Irene 에게 가격과 함께 묻는다, 기본 꺼짐). 나중에 녹음으로 바꾸기 = 같은 프로젝트에 voice 소재를 올리고 [녹음으로 바꾸기] → ① 흐름으로 새 판.
### ① 녹음 기반
1. 업로드: 녹음(m4a·mp3·wav) 또는 얼굴 영상(mp4·mov, 소리 포함 가능). 얼굴 영상은 소리를 뽑아 같은 시각축으로.
2. 전처리: `afftdn`(잡음) → `loudnorm`(−16 LUFS) — 원본은 그대로 두고 처리본을 쓴다.
3. 음성 인식: **Deepgram 사전녹음 API(nova-3, ko, `words` 단어 시각)** — `routes/voice.js` 가 이미 쓰는 같은 호출·같은 키(`DEEPGRAM_API_KEY` dev .env). 새 유료 서비스 아님. 분당 과금이라 `video_projects.stt_seconds` 에 기록(§2).
4. 자르기 목록: 0.6초 넘는 침묵 · «음/어/그/저기» 단독 단어 · 같은 말 되풀이(앞 것 버림) · **쉬고 다시 말한 문장(재테이크 — 쉼 0.35초 뒤 같은 두 단어로 다시 시작하거나 앞 토막 전체를 다시 말함 → 앞 시도 버림, 앞 토막이 문장부호로 끝난 완결 문장이면 나란한 문장으로 보고 남김)** → `cuts[]`. 녹음 요령: 말이 꼬이면 한 템포 쉬고 문장 처음부터 다시(2026-10-30 AI 영상편집 워크플로 참고). **자르기는 소리·얼굴 영상에 같은 시각으로** 적용(얼굴 원 합성과 동기 — 요구사항).
5. 문장 → 장면: 문장 목록을 AI 에 주고 «이 문장에 맞는 녹화 장면·beat» 를 고르게(②와 같은 울타리). 문장 시작 = 장면 시작, 화면 동작은 그 문장 길이에 맞게 늘이고 줄인다(녹화의 기다림·정지 구간 배속으로 흡수 — A단계 retimeScreen).
6. 자막 = 녹음 단어 시각(`Caption.words`) — 단어별 강조가 말과 맞는다. 문장을 **넷플릭스 한국어 자막 지침의 틀**(한 줄 16자 · 두 줄까지 · 한 자막 7초 이하 · 5/6초 이상 · 줄 끝 마침표·쉼표 뺌)로 나눈다(`lib/voice.js` `captionChunks`). 음악은 말할 때 자동으로 낮춘다(`voice.spans` · 템플릿 duck).
7. 얼굴 원: 얼굴 영상이 있으면 오른쪽 아래(세로는 위 가운데) 원형, 말하는 구간만. 얼굴 위치는 첫 키프레임 이미지 인식으로 잡아 원 안에 맞춘다(움직이는 추적은 C 이후).
### ③ 브랜딩·홍보
- 목적·대상·길이 → AI 콘셉트·대본(`converge`·`kinetic`·`montage`·`points`·`logo`). 소재(사진·로고·영상)가 있으면 이미지 인식 결과를 같이 넘겨 배치. 무료 스톡 영상(Pexels API, 출처 표기 불필요)은 선택 — 키가 필요하면 Irene 할 일.

## 7. 소재 인식·검수 관문 (A단계 Fable 권고 ①)
- 이미지·영상 소재: 키프레임(영상은 2초마다)을 이미지 인식(llm.callLLM 이미지, 목적 `video_vision`) → 설명·태그·주된 피사체 위치. 영상은 ffmpeg 로 **흔들림**(vidstabdetect 이동량) · **어두움**(signalstats YAVG < 40) 구간을 재서 `usable[]` 에서 뺀다.
- 사진은 확대·이동(피사체 위치 쪽으로), 영상은 음악 박자에 맞춘 컷(usable 구간 안에서).
- **소재 검수 관문(빌드 실패로 막는다)** — Fable 비차단 3 대로 판정 수단을 둘로 나눈다:
  - **녹화(capture) = DOM 판정**(결정적·싸다·문구가 바뀌어도 안 깨짐): 녹화 중 beat 마다 puppeteer 가 로딩 뼈대(`[data-skeleton]` 등 뼈대 컴포넌트) · 빈 상태 컴포넌트 · 공지 띠 · 온보딩 블록 · `role=alert`·오류 화면 존재를 물어 `shot.json` 에 남긴다. 빈 상태 문구 사전은 손으로 쓰지 않고 `locales/ko/*.json` 의 empty 계열 키에서 만든다. 걸리면 그 장면을 한 번 다시 녹화, 그래도 걸리면 capture_failed. 이미지 인식은 녹화엔 2차 의견으로만.
  - **올린 소재(사진·영상) = 이미지 인식**(`video_vision`) + ffmpeg 흔들림·어두움 측정.
  - 걸린 장면은 «소재 문제» 로 표시하고 렌더하지 않는다(관리자 화면에 프레임과 이유). 사람이 «그대로 쓰기» 를 누르면 통과(writeAudit).
  - 양성 대조군: 뼈대가 든 녹화를 넣으면 빌드가 실패하는가.

## 8. 렌더·수정·버전 (요구사항 4·6·7)
- **세로 전용 프레이밍 규칙**(A단계 Fable 권고 ②, 이미 `build/storyboard.js` 에 들어감): 데스크탑 녹화를 세로로 쓸 때 최소 2.2배 · 대상의 폭·높이가 6% 여백으로 다 들어오게 · 같은 기능의 휴대폰 녹화가 있으면 세로판은 그것을 우선(템플릿 `portraitPrefers: 'mobile'`) · 몽타주는 강조 영역을 잘라 씀.
- **바뀐 부분만 다시 렌더**(Fable 차단 2 반영): 장면 목록을 장면 단위 «조각» 으로 나눠 렌더한다. 조각 = `[장면 i 시작, 장면 i+1 시작)` 프레임 범위. 조각 앞부분엔 장면 i−1 의 꼬리(겹침·사라짐)가, 배경은 절대 시각으로 그려지므로
  **조각 해시 = sha256(engineVersion(video-engine/src 트리 해시) · fps · 화면비 · 템플릿 전체 · 브랜드 소재 md5 · 장면 i−1 전체 · 장면 i 전체 · 장면 i+1 의 transIn·해석된 transKind(mixed 는 장면 번호로 정해진다) · 장면 i 의 startFrame · 이 조각이 쓰는 녹화/소재 md5)**.
  해시가 같은 조각은 지난 판 것을 재사용(dev 캐시 `video-engine/data/chunks/`, 30일·20GB 상한).
  - **정직한 한계**: 길이가 바뀌는 수정(장면 짧게·순서·템플릿·음악)은 박자 격자 재배치와 배경 위상 때문에 **그 장면부터 뒤를 전부 다시 렌더**한다. 조각 재사용이 실제로 듣는 것은 자막 글자·강조·옆 글처럼 길이를 안 바꾸는 수정이다. 예상 시간 표시도 이 규칙으로 계산.
  - 조각은 **소리 없이**(`muted`) 렌더하고, 소리(음악 duck·fade·효과음·목소리)는 **Remotion 오디오 전용 렌더 1회**(오디오 코덱이면 프레임을 안 그린다 — duck·sfx 의미를 한 벌로 유지) → ffmpeg 는 **mux 만**(`-c copy`) (Fable 비차단 1).
  - 조각 이어 붙이기는 concat demuxer + 같은 인코딩 설정(각 조각은 IDR 로 시작) · 스트림 복사. 검증: 이어 붙인 길이 = 장면 목록 총길이 ±1프레임, 아니면 전체 다시 렌더.
- 수정 요청(말로): «2번째 장면 짧게 · 자막 바꿔 · 음악 바꿔 · 템플릿 바꿔» → AI(`video_script`)가 **지금 대본 + 요청** 으로 고친 대본과 바뀐 장면 목록(diff)을 낸다 → 관리자 화면에 바뀐 장면만 표시 → 승인 → 새 판. 템플릿·음악을 바꾸면 모든 조각이 바뀐다(해시가 다름) — 화면에 «전체 다시 만들기(약 N분)» 예상 시간.
- 렌더 시간 표시: 지난 렌더 실측(초당 프레임)으로 예상 시간.

## 9. 구글 드라이브 저장 (`services/gdrive.js` 재사용 · 요구사항 8)
- 저장 계정 = **dev 의 «PlanQ» 워크스페이스에 연결한 드라이브 토큰을 빌려 쓴다**(플랫폼 설정 `video_drive_business_id` · 그 워크스페이스의 BusinessCloudToken). 연결은 그 워크스페이스 설정의 기존 드라이브 연결 그대로(Irene 할 일 — §14).
- **폴더는 워크스페이스 root(`PlanQ - <워크스페이스>`) 밖** — 내 드라이브 최상위 `PlanQ 시연 영상/<yyyy-mm-dd 제목>/원본 · 소재 · 완성본`(Fable 차단 1). root 아래에 두면 `gdriveIngest` 크론이 root 하위 전부를 바이트째 내려받아 Q file 로 들이고 플랜 쿼터에 세어, «업로드 확인 후 서버 사본 삭제» 가 크론 한 바퀴에 무효가 되고 쿼터가 터진다.
  - 최상위 폴더 id 는 `PlatformSetting.video_drive_folder_id` 에 캐시 + `appProperties` 표시(`stampBusinessMark` 선례) · 없어졌으면 다시 만든다. 프로젝트 폴더 id 는 `video_projects.drive_folder_id`. drive.file 범위라 우리가 만든 파일만 보인다.
  - D 검증 대조군: 업로드 뒤 드라이브 감시 크론을 한 바퀴 돌려 `GdriveSyncLog` 에 영상 파일 ingest 0건.
- 업로드: **재개 가능(resumable) 업로드** — 큰 파일(완성본 수십 MB, 얼굴 영상 수백 MB). 지금 `uploadFile` 은 한 번에 올리는 방식이라 `uploadFileResumable(drive, {name, mimeType, filePath, parentId})` 를 gdrive.js 에 더한다.
- **서버 사본 삭제 조건**(요구사항 «업로드 확인 후에만»): 업로드 응답의 id 로 `getFileMeta`(fields 에 `md5Checksum, size, trashed` 를 더한다 — 지금은 없다) → `size`·`md5Checksum` 이 **업로드에 쓴 바로 그 로컬 파일을 다시 읽어 계산한 값**과 같고 `trashed=false` 일 때만 `drive_verified_at` 기록 → 그 뒤 로컬 삭제. 다르면 삭제하지 않고 upload 작업 failed.
  - 완성본은 업로드 확인 뒤에도 **7일** 서버에 둔다 → 7일 뒤 정리 작업이 지운다(`drive_verified_at` 있는 것만). **7일 뒤 재생·[SNS 용 파일 받기]는 `getFileStream` 으로 드라이브에서 받아 내준다**(완성본 포함) — «다운로드 전 삭제 금지» 는 이 경로가 있어야 지켜진다(Fable 비차단 2).
  - 사람이 드라이브에서 지운 파일은 «재생성 불가 — 드라이브에서 지워짐» 으로 표시(복구 안 함).
  - 다시 렌더에 필요한 소재·녹화 원본은 드라이브에서 내려받아 캐시로 쓴다(`getFileStream`).
- 서버에 남는 것: 대본(판 전부) · 장면 목록 · 템플릿 · 소재 분석 결과 · 드라이브 id. **이것만으로 재생성 가능**(소재는 드라이브에서).
- 드라이브 연결이 끊기면(토큰 오류) 업로드 작업 failed(drive_not_connected) + 서버 사본은 지우지 않는다 + 관리자 화면에 «드라이브 다시 연결».

## 10. 랜딩 노출 (운영 · 요구사항 9)
- 운영 표 `marketing_videos`: id · title_ko · title_en · youtube_video_id · aspect('landscape'|'portrait') · placement ENUM · sort · published · **published_at**(VideoObject uploadDate 필수) · duration_seconds · created_by · timestamps. **thumbnail 은 저장하지 않고 `https://i.ytimg.com/vi/<id>/hqdefault.jpg`** 를 쓴다.
- 운영 관리자 «랜딩 영상»(플랫폼 관리자 메뉴 1개): 유튜브 링크 붙여넣기 → 서버가 watch·youtu.be·shorts·embed 네 형태에서 id 를 뽑아 `^[A-Za-z0-9_-]{11}$` 검사 → 제목·위치·공개 토글(writeAudit).
- 공개 API `GET /api/public/marketing-videos?placement=…` — **라우터 하나·읽기만·인증 라우터보다 앞 마운트**(insight_og·survey_public 선례) · `published=1` 술어는 **한 함수**(JSON-LD 도 같은 함수) · 응답 필드 id·youtube_video_id·title·aspect·duration 만 · `Cache-Control: public, max-age=300` · IP 분당 60.
- 화면: 썸네일 + 재생 버튼 → 누를 때만 `https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0` iframe(누르기 전엔 유튜브에 요청 0 — 쿠키·속도). iframe 에 `title` · `allow="autoplay; encrypted-media; picture-in-picture"` · `referrerpolicy="strict-origin-when-cross-origin"` · `loading="lazy"`. 세로 영상은 9:16 상자.
- **CSP**: `frame-src` 에 `https://www.youtube-nocookie.com` 만 더한다(img-src 는 이미 `https:` 라 i.ytimg 허용) — `middleware/security.js` cspDirectives 와 `scripts/apply-nginx-security-headers.sh` **둘 다 같은 문자열**(guard `checkCsp` 가 완전 일치 검사). 운영 nginx 적용은 배포 스크립트 단계.
- 노출 위치 제안(placement):
  1. `home_hero` — 홈 첫 화면 CTA 아래 «1분 만에 보기» 버튼 → 기능 소개(가로) 모달 재생. 첫 화면 레이아웃을 밀지 않는다.
  2. `home_flow` — 홈 «Value/Solution» 절(대화가 곧 실행) 오른쪽에 쇼츠(세로) 1편 썸네일.
  3. `features_<q>` — 기능 페이지 Q 시리즈 카드마다 그 기능 쇼츠(있을 때만).
  4. `about_brand` — 회사 소개 맨 위 브랜드 영상.
  - 영상이 없는 placement 는 아무것도 그리지 않는다(빈 상자 없음).
- SEO: 공개된 영상은 그 페이지의 `VideoObject` JSON-LD(name·thumbnailUrl·uploadDate·embedUrl) — seoArtifacts 와 같은 정본 함수.

## 11. SNS 공유 (`routes/admin_social.js` · SNS 설계 4단계 대체 · 요구사항 10)
- SNS 설계 §8 4단계 «쇼츠 자동 생성» 은 이 엔진이 대신한다(영상 엔진은 하나). SNS 쪽 ffmpeg 카드→쇼츠는 만들지 않는다.
- 운영 «SNS 발송» 에 **«영상 소재» 칸**: 글(article) 대신 `marketing_video_id` 를 출발점으로 소재 만들기 — 채널별 문구 초안(`social_draft`) → 승인. `social_posts.kind='video'`(ENUM 에 이미 있음) · `social_posts.marketing_video_id` NULL 허용(새 칸) · **`social_posts.article_id` 를 allowNull:true 로**(지금 NOT NULL — 모델도 같이 바꾼다, sync alter 가 모델 밖 정의를 되돌리는 선례).
- 영상 파일 가져오기: 운영은 dev 서버에 접근하지 않는다. 관리자가 공방에서 [SNS 용 파일 받기]로 완성본을 내려받아 운영 SNS 화면에 **올린다**(업로드 1회) — 서버 간 통로 없음(§1 B). 파일은 SNS 설계의 media(uploads/social/…)로 저장.
- 유튜브 링크가 있는 영상은 본문 초안에 링크를 넣는다(utm 은 우리 도메인에만 — 유튜브 링크는 그대로).
- **E단계 범위 = 초안 + [영상 내려받기] + [게시함 표시](반자동)까지.** 영상 자동 발송은 채널 연결만으로 안 된다 — Reels·LinkedIn·Facebook 영상 API 는 공개 mp4 주소(SNS §4 는 이미지 전용)·처리 상태 폴링·채널별 영상 어댑터가 따로 필요하다 → **별도 설계(Fable gate)** 로 뒤에 한다(Fable 비차단 8).

## 12. 화면 — 영상 공방 (dev.planq.kr `/admin/videos` · ADMIN_MENUS + 탭 라우트 · i18n `adminVideo` ko/en · 3폭)
1. **목록**: 영상 카드(제목·방식·상태·판·길이·마지막 렌더 시각) · [새 영상].
2. **새 영상**(우측 패널): 방식 3개 고르기 → 방식별 입력(지시문 / 녹음·얼굴 영상 올리기 / 목적·대상·길이) · 소재·참고 영상 올리기(여러 개, 각자 한 줄 설명) · 템플릿(미리보기 정지 화면) · 음악(라이브러리, 들어보기) · 목표 길이 · 화면비 → [대본 만들기].
3. **대본 확인**: 장면 카드 목록(종류·자막 편집·길이·녹화 장면 고르기·순서 끌기·삭제·추가) + 장면마다 정지 화면 미리보기(가로·세로) + 소재 검수 관문 결과 + 예상 렌더 시간 → [이 대본으로 만들기].
4. **생성 상태**: 대기열 위치 · 작업별 진행률 · 메모리 대기 표시 · [취소].
5. **완성본**: 가로·세로 재생 · 판 목록(v1·v2… change_note · [이 판으로 되돌리기]) · [수정 요청](말로) · 드라이브 링크(폴더·파일) · [SNS 용 파일 받기] · 유튜브 링크 입력 칸(입력하면 «운영 [랜딩 영상]에 이 링크를 넣으세요» 안내 + 복사).
6. **템플릿**: 목록(집·참고) · [참고 영상으로 만들기](파일·링크) → 분석 결과(측정값·판독·대조 스틸) → 이름 붙여 저장 · 보관.
7. **음악·소재 라이브러리**: 음악(분위기·BPM·출처 표기) · 공용 소재(로고 등).
- mock 금지 — 전부 실 API. 외부 발송 없음(드라이브 저장은 우리 계정 쓰기).

## 13. API (dev-backend · `routes/admin_videos.js` · `/api/admin/videos/*` — routes/admin.js 가 /api/admin 전체를 platform_admin 으로 선점하지만 **admin_social 처럼 라우터 자체에도 `authenticateToken, requireRole('platform_admin')`**(마운트 순서에만 기대지 않음 — Fable 비차단 10), server.js 마운트는 admin_social 옆)
`GET/POST /projects` · `GET/PATCH /projects/:id` · `POST /projects/:id/script`(AI 대본 작업) · `GET /projects/:id/versions` · `POST /projects/:id/versions`(사람 수정 저장=새 판 draft) · `POST /versions/:id/approve`(→ 렌더 작업) · `POST /projects/:id/revise`(말로 수정 → AI 새 판) · `POST /versions/:id/revert` · `POST /projects/:id/cancel` · `GET /jobs?project=` · `POST /assets`(multer, 종류별 확장자·크기 상한: 음성 200MB · 영상 2GB · 이미지 30MB) · `GET /assets` · `POST /assets/uploads`(분할 업로드 시작) · `PUT /assets/uploads/:uploadId/parts/:n`(≤40MB 조각) · `POST /assets/uploads/:uploadId/complete`(이어 붙여 md5 검사) · `POST /templates/analyze` · `POST /templates` · `GET /preview/:versionId/:sceneId.jpg`(정지 화면) · `GET /outputs/:versionId/:aspect.mp4`(7일 서버 사본, 관리자만, Range) · `PATCH /projects/:id/youtube`.
- **업로드는 앱 안 분할 업로드**(Fable 차단 3 · ⓐ): dev nginx `client_max_body_size 50M` 이라 200MB·2GB 를 한 번에 못 받는다. 화면이 파일을 ≤40MB 조각으로 나눠 올리고(끊기면 이어서), 서버가 이어 붙여 전체 md5 를 검사한다 — sudo·nginx 변경 없음. 종류별 상한(음성 200MB · 영상 2GB · 이미지 30MB)은 **우리 코드가 413** 을 낸다(D 검증에서 nginx 413 이 아님을 실측).
- 응답에 드라이브 토큰·로컬 경로를 싣지 않는다(파일 id·웹 링크만).
- `services/llm.js` PURPOSES 에 `video_script`(gpt-5.1 · 4000 · 120초)·`video_vision`(이미지) 등록 + `costGuard.perUserLimiter`.
- 운영(§10·§11): `routes/admin_marketing_videos.js` · `GET /api/public/marketing-videos` · SNS 영상 소재 칸.

## 14. 단계·Irene 할 일
| 단계 | 내용 | ✋ |
|---|---|---|
| C 엔진 | worker·대기열 · ① 녹음(Deepgram·자르기·얼굴 원) · 소재 인식·검수 관문 · 템플릿 적용 · 조각 렌더·수정·버전 · 녹화 장면 확장(기능별 15~20개, 휴대폰 포함) · 데모 시드 보강(근무 중·미리보기·대시보드 온보딩 끝난 상태) | 녹음 하나 + 지시 하나로 만든 결과 |
| D 관리 페이지 + 드라이브 | §12 화면 · §13 API · 드라이브 재개 업로드·확인 후 삭제 | 실제 요청으로 업로드부터 링크 입력까지 |
| E 랜딩 + SNS | 운영 marketing_videos · 랜딩 4곳 · CSP 두 벌 · SNS 영상 소재 칸 | 배포 전 화면 확인 → 배포 |
- Irene 할 일(필요한 시점에 하나씩): 참고 영상 2~3개(올림) · 배경음악 3곡(올림) · C: 시험용 녹음 1개(+얼굴 영상 선택) · D: dev «PlanQ» 워크스페이스에 구글 드라이브 연결 · E: 유튜브 채널에 올리고 링크 · SNS 채널 계정 연결(SNS 설계 2단계) · 유료 선택(TTS·스톡) 켜기 전 가격 확인.

## 15. 운영 적용 · 끄는 스위치
- dev 공방: `migrate-video.js`(dev DB, 멱등) · PM2 `planq-video-worker` · `.env VIDEO_STUDIO_ENABLED=1` 없으면 작업자·API 404, **관리자 메뉴 자체를 숨긴다**(서버 capability 로 판단 — 운영 코드에도 화면이 실리므로, Fable 비차단 11).
- 운영: `migrate-marketing-videos.js`(멱등 — marketing_videos · social_posts.marketing_video_id · social_posts.article_id NULL 허용) **배포 슬롯 등록, 코드 배포 전**. 공개 API 는 published 만.
- 백업: dev DB 일일 덤프에 포함(§1). Remotion 회사 라이선스는 3명 이하 무료 — 팀이 늘면 유료 전환(Irene 할 일로 기록).

## 16. 검증 계획
- C: 녹음 1개로 ① — 침묵·«음» 잘림 전후 길이 · 자막 단어 시각 ±0.1초(무작위 10단어 대조) · 얼굴 원과 소리 동기(자르기 경계 5곳 프레임) · 소재 검수 관문 양성 대조군(로딩 뼈대가 든 녹화를 넣으면 빌드 실패하는가) · 조각 재사용(자막 1줄 수정 → 바뀐 조각 1개만 렌더, 이어 붙인 길이 ±1프레임) · **대조군: 장면 길이 수정 → 그 뒤 조각 전부 재렌더 + 이음새 프레임 픽셀 차 0**(전체 렌더와 비교) · 메모리 게이트(일부러 막고 기다리는가) · 렌더 중 표시 파일을 PlanQ 빌드가 기다리는가.
- D: 실HTTP — 관리자 아닌 계정 403 · 업로드 상한 413(우리 코드가 냄, nginx 아님) · 분할 업로드 끊김 뒤 이어 올리기 · 드라이브 감시 크론 한 바퀴 뒤 영상 ingest 0건 · 승인 후 수정 = 새 판 · 되돌리기 · 드라이브 md5 다르면 로컬 안 지움(대조군) · 7일 정리 · 화면 3폭.
- E: CSP 두 벌 guard · 공개 API 비공개 영상 0 · 누르기 전 유튜브 요청 0(네트워크 실측) · 세로 9:16 상자 3폭 · SNS 영상 초안 → 승인 → 반자동 게시함 표시.
- 렌더 품질은 기계로 못 가른다 → 각 ✋ 에서 Irene 확인 + (새 템플릿·핵심 흐름이면) Fable UX 점검 1회.

## 17. Fable 에 묻는 것
1. §1 구조(B 권고) — 렌더를 고객 서버에서 떼는 대신 관리 화면이 둘로 나뉘고 사람이 링크·파일을 옮긴다. 이 비용을 받아들일 만한가, 다른 길이 있는가.
2. §8 조각 렌더 — 해시 범위(이웃 전환 포함)와 «영상만 조각 + 소리 한 번» 이 경계 결함 없이 맞는가.
3. §9 서버 사본 삭제 조건(크기+md5 일치) · 완성본 7일 보관이 요구사항 «다운로드 전 삭제 금지» 를 지키는가.
4. §7 소재 검수 관문 판정 방식(빈 상태 문구 사전·뼈대 비율)이 기계로 충분한가, 이미지 인식이 필요한가.
5. §10 랜딩 노출 위치·클릭 전 유튜브 요청 0 · CSP 두 벌 — 공개 표면으로서 빠진 것.

## 18. Fable 설계 판정 (2026-10-29) — 차단 3건 반영 → PASS (재판정 불필요 — 판정문 지시)
- 서버 배치: **B 확정**(공방 dev · 운영은 유튜브 링크·mp4 1회 업로드만 — 새 서버 간 표면 없음). 이유: 렌더 25분·3GB 를 고객 서버에 두는 위험 · 운영 사양 실측 불가 · C 는 새 서버 간 인증 표면.
- 차단 1 §9 드라이브 폴더를 워크스페이스 root 밖으로(gdriveIngest 가 root 하위를 바이트째 들여 삭제 조건·쿼터를 깬다) → **§9 반영**.
- 차단 2 §8 조각 해시 = 앞 장면 전체·해석된 전환 종류·startFrame(배경 절대 시각)·engineVersion 포함 + «길이 바뀌는 수정은 그 장면부터 뒤 전부 재렌더» 정직하게 → **§8·§16 반영**.
- 차단 3 §13 dev nginx 50M → 앱 안 분할 업로드(≤40MB 조각·md5) → **§13·§16 반영**.
- 비차단 1~13 반영 위치: 1 §8(Remotion 오디오 전용 렌더 + mux) · 2 §9(md5Checksum·trashed fields · 7일 뒤 드라이브에서 내줌) · 3 §7(녹화=DOM 판정·소재=이미지 인식·빈 상태 사전은 locales 에서) · 4 §10(공개 API 한 함수·필드·캐시·레이트·iframe 속성·published_at·CSP 는 frame-src 만) · 5 §1·§15(백업 문장 정정) · 6 §5(렌더 중 표시 파일·공용 게이트 보강은 Irene 할 일(서버 방)·PM2 메모리 상한) · 7 §2(stt_seconds → providerCredit) · 8 §11(E = 반자동까지, 영상 자동 발송은 별도 설계) · 9 §2(writeAudit) · 10 §13(라우터 자체 인증·PURPOSES 등록) · 11 §15(메뉴 숨김) · 12 §15(Remotion 라이선스) · 13 §16(D 끝 Fable UX 점검 1회).

## 19. 정기 제작·발행 자동화 — 필요한 기능 (2026-11-04 Irene 요청 · [Opus] 기능 파악 · **Fable 설계 검토 전**)
> Irene: «미리 요청을 넣어서 히스토리 만들어놓고 원하는 정기적인 순서로 진행하게 해줘. 유튜브 링크 안 올린 건 리스트업 되고 내가 주면 그때 다 발행하게. 진짜 자동화되게.»

### 흐름 (사람 손은 두 곳만: ① 요청 넣기 ② 유튜브 링크 주기)
```
[요청 미리 쌓기] → [정해진 순서·때에 작업자가 하나씩 꺼냄] → 대본(AI) → 자동 검수 → 렌더 → 드라이브
   → [유튜브 링크 대기 목록] ← Irene 이 영상 받아 유튜브에 올리고 링크 붙여 넣기(여러 개 한 번에)
   → [발행] 랜딩 노출 + SNS 채널별 게시 (전부 자동)
```

### 새로 필요한 기능 (지금 설계 §1~18 에 없는 것)
| # | 기능 | 내용 | 바뀌는 설계 |
|---|---|---|---|
| 1 | **제작 계획표(요청 쌓기)** | 요청을 미리 여러 개 넣는다(방식·지시·길이·화면비·템플릿·음악·노출 위치·SNS 채널). 순서 끌어 바꾸기. 상태: 계획 → 제작 중 → 링크 대기 → 발행됨 / 확인 필요 / 실패. 지운 것도 이력에 남는다(paranoid) | `video_projects` 에 `plan_order`·`planned_for`·`placement`·`channels` · status 에 `planned`·`awaiting_link`·`needs_review`·`published` |
| 2 | **AI 로 다음 요청 채우기** | [다음 N편 제안] — 기능 목록(랜딩 문구·위키)과 **이미 만든 이력**을 같이 넘겨 겹치지 않는 주제를 제안 → 고르면 계획표에 들어간다 | `video_script` 목적 재사용(울타리 같음) |
| 3 | **정기 실행(제작 박자)** | 설정: «하루 N편, 몇 시부터»(기본 매일 밤 1편 — 낮 빌드와 안 겹치게). 작업자가 그 시각에 계획표 맨 위를 꺼낸다. 메모리 게이트·배포 대기는 지금 규칙 그대로 기다림 | worker 에 일정 확인(크론 없이 작업자 10초 순회 안에서) |
| 4 | **사람 승인 없이 렌더까지** | 지금 설계는 «대본 확인 → [이 대본으로 만들기]» 를 사람이 누른다. 자동 모드에서는 **자동 검수 관문을 통과하면 저절로 승인**(source=`auto`, 감사 기록). 관문에 걸리면 «확인 필요» 목록으로 빼고 다음 편으로 넘어간다(줄이 안 막힘). Irene 의 확인은 완성 영상에서 한 번(링크를 줄 때) | §4 상태 전이에 `auto_approve` 문 하나 더 |
| 5 | **유튜브 링크 대기 목록** | 완성됐는데 링크 없는 영상만 모아 보여 줌 — 영상 재생 · [mp4 받기] · **유튜브에 붙일 제목·설명·태그(AI 초안, 복사 버튼)** · 링크 칸. 여러 줄에 한 번에 붙여 넣고 [발행]. 대기가 N편 넘으면 상황판·푸시로 알림 | §12 화면 5 를 목록형으로 |
| 6 | **링크 = 발행 승인** | 링크를 넣고 [발행]을 누르면 그 영상은 ① 랜딩 노출 위치에 공개 ② SNS 채널별 게시물을 만들어 **승인 상태로** 보낸다(따로 초안 승인 안 받음). 발행 간격 설정(기본 «한 번에 전부», 선택 «채널당 하루 1개씩 나눠») | SNS 규칙 «초안 → 승인» 을 «링크 입력 = 승인» 으로(감사 기록에 남김) — **Fable gate(외부 발송 트리거)** |
| 7 | **SNS 영상 자동 게시** | Instagram 릴스·Facebook·LinkedIn·Threads·YouTube 쇼츠 영상 게시 어댑터 · 공개 mp4 주소 · 처리 상태 확인 · 실패 시 다시 시도·알림 | §11 «별도 설계» 였던 것 — SNS 설계 단계 2(채널 연결·예약 크론) 위에 얹힘 |
| 8 | **한 화면에서 다 보기** | 계획·제작·링크 대기·발행 이력을 **한 곳(운영 관리자)**에서. 아래 «구조 변경» 참고 | §1 결정 B 를 고침 |
| 9 | **실패·막힘 알림** | 렌더 실패·검수 걸림·드라이브 끊김·SNS 게시 실패를 한 줄씩 «확인 필요» 에 + 알림. 3번 실패한 요청은 계획표에서 멈춤 | §5 실패 코드 재사용 |

### 구조 변경 — 왜 필요한가 (§1 결정 B 의 구멍)
- 지금 설계 B 는 «공방은 dev, 운영은 결과만 · 사이는 **사람이 옮긴다**(링크·파일)». 그러면 Irene 이 링크를 dev 에 넣고 → 운영 «랜딩 영상» 에 또 넣고 → SNS 화면에 mp4 를 또 올려야 한다. **«진짜 자동화» 와 맞지 않는다.**
- 권고 **B′: 계획·이력·링크·발행의 정본은 운영, 렌더만 dev.** dev 작업자가 운영에 **바깥으로 나가는 호출만** 한다(운영이 dev 를 부르지 않음): 다음 할 일 받아 가기 → 진행 상태 알리기 → 완성 mp4 올리기(SNS 공개 주소로도 이게 필요). 운영에는 작업자 전용 API 하나(비밀 키 + dev 서버 IP 만, 기록 남김)가 생긴다.
  - 얻는 것: Irene 은 운영 관리자 한 화면만 쓴다 · 링크 한 번 → 랜딩·SNS 끝 · SNS 가 쓸 공개 mp4 가 이미 운영에 있다.
  - 비용: **새 서버 간 인증 표면**(§1 에서 피했던 것) → Fable `gate` · 운영 디스크에 완성 mp4(1편 10~40MB — 보관 기간 정해야 함) · dev 데모 화면 녹화는 그대로 dev.
  - 대안 B(지금 그대로)는 링크·파일을 두 번 옮겨야 해서 요청을 못 채운다. A(전부 운영)는 렌더(25분·3GB)가 고객 서버를 누른다.

### 먼저 있어야 하는 것 (자동 게시의 바닥)
- SNS 설계 단계 2: 채널 OAuth 연결 · 예약 크론 · 공개 미디어 주소 — 아직 안 만듦.
- Irene 할 일(그때 하나씩): 채널별 비즈니스 계정·개발자 앱·심사(Meta·LinkedIn·Threads·YouTube) · 유튜브 채널 · dev «PlanQ» 워크스페이스 드라이브 연결.
- 유튜브 업로드 자체는 계속 사람 몫(구글 앱 감사 전엔 API 업로드가 비공개로만 올라감 — SNS_PUBLISH_CONSULT). 감사를 받으면 «링크 주기» 대신 «[공개로 바꾸기] 한 번» 으로 줄일 수 있다(나중).

### 단계 다시 짜기 (제안)
| 단계 | 내용 | ✋ |
|---|---|---|
| D′ | 운영: 계획표·이력·링크 대기·발행 화면 + 작업자 API · dev: 작업자가 운영에서 받아 가 렌더·올리기 · 자동 승인 문 · 정기 실행 · AI 다음 요청 제안 | 요청 3개 넣고 밤새 3편 나와 링크 대기에 뜨는 것 |
| E′ | 랜딩 노출(§10 그대로) · 링크 = 발행 · SNS 단계 2(채널 연결·예약) · 영상 게시 어댑터 · 알림 | 링크 붙여 넣기 한 번으로 랜딩 + 연결된 채널 게시 |
- Fable: D′ 시작 전 설계 1회(구조 B′·작업자 API·자동 승인·링크=발행 승인) · E′ 끝 검증 1회(외부 발송).

## 20. 상세 설계 — D′/E′ 정기 제작·발행 자동화 (2026-11-04 Irene «권고대로» · [Opus] 초안 → Fable 설계 검토)
> §19 의 9가지를 짠다. §1~18 중 **바뀌는 것만** 적고 나머지(엔진·조각 렌더·검수 관문·템플릿·랜딩 §10)는 그대로 쓴다.

### 20.1 구조 B′ — 정본은 운영, 렌더만 dev
| 어디 | 무엇 |
|---|---|
| **운영(planq.kr)** | 요청(계획표)·판(대본 JSON)·작업 대기열·완성본 사본·유튜브 링크·랜딩 노출·SNS 게시물 — 관리자 화면 `/admin/videos` 하나 |
| **dev(작업자)** | `video-engine` 작업자 1개(PM2 `planq-video-worker`) — 운영에서 일을 **받아 가서**(바깥으로 나가는 호출만) 녹화·AI 대본·검수·렌더 → 결과를 운영에 올림 · 드라이브 보관(dev «PlanQ» 워크스페이스 토큰, §9 그대로) |
- 운영은 dev 를 부르지 않는다. dev 가 꺼져 있으면 운영 화면에 «작업자 연결 안 됨(마지막 신호 N분 전)» 만 뜬다.
- 개발 시험: dev 백엔드가 운영 역할도 한다(작업자 `VIDEO_API_BASE=https://dev.planq.kr`). 운영 연결은 배포 뒤 `.env` 두 줄(아래 20.4) — 그때 Irene 할 일.
- §1 의 «서버 간 통로 없음» 은 이 절로 **바뀐다**(새 인증 표면 20.4 — Fable gate).

### 20.2 데이터 (운영·dev 같은 모델 · `scripts/migrate-video.js` 멱등 · 배포 슬롯, 코드보다 먼저)
§2 표를 쓰되 아래를 더하고 뺀다.
- `video_projects`(요청 1건 = 영상 1편)
  - 더함: `plan_order INT`(계획표 순서, 작을수록 먼저) · `auto_approve BOOL 기본 1` · `placement VARCHAR NULL`(§10 노출 위치) · `channels JSON`(SNS 대상 provider 목록) · `attempts TINYINT` · `review_reason VARCHAR NULL`(확인 필요 사유 코드) · `review_detail TEXT NULL` · `youtube_meta JSON`(제목·설명·태그 초안) · `published_at` · `published_by`
  - status 를 **`planned · producing · needs_review · awaiting_link · published · failed · archived`** 로 바꾼다(§2 의 draft~rendered 는 판(version) 상태로 내려간다 — 요청 상태와 판 상태를 섞지 않는다).
  - 뺌: `drive_folder_id` 는 dev 쪽 보관이라 운영 행에는 작업자가 결과로 알려 준 값만 기록(읽기용).
- `video_versions` §2 그대로(대본 JSON·판 번호·source 에 `auto` 더함). `outputs` 는 운영 사본 경로(`uploads/videos/<yyyy-mm>/<uuid>.mp4`)·bytes·md5·seconds·드라이브 id.
- `video_jobs` 는 **운영 DB 에** 둔다(작업자가 받아 감). kind 를 **`produce` 하나 + `revise` · `prep_voice`** 로 줄인다 — `produce` = 대본(없으면 AI) → 검수 관문 → 렌더(가로·세로) → 드라이브 → 운영 올리기를 한 작업 안의 단계(`stage`)로. 단계마다 heartbeat 에 stage·progress.
- `video_assets` 는 운영에 올린다(녹음·얼굴 영상 — 분할 업로드 §13). 작업자가 내려받아 쓴다. 지시만(②)·브랜드(③) 자동 영상은 소재가 없어도 된다.
- `video_settings`(PlatformSetting 키 `video_schedule`): `{enabled, per_day(기본 1), window:{from:'01:00', to:'06:00'}(KST, 낮 빌드와 안 겹치게), weekdays:[1..7], publish_spread:'all'|'daily'}`.
- `marketing_videos` §10 그대로 + `video_project_id NULL`(공방 영상이면 연결).
- `social_posts.marketing_video_id`·`article_id NULL 허용` §11 그대로.

### 20.3 흐름과 상태 전이 (문 하나 `services/video/videoTransition.js` — 전이마다 writeAudit)
```
planned ─(일정 창 안 · 오늘 몫 남음 · 작업자가 claim)→ producing
producing ─(produce 완료)→ awaiting_link
producing ─(검수 관문 걸림 · auto_approve=0 이면 대본 완성 시)→ needs_review   (계획표는 다음 편으로 계속)
producing ─(실패, attempts<3)→ planned(맨 위 유지) · (attempts=3)→ failed
needs_review ─(관리자: 대본 고침/«이대로» 승인)→ planned(맨 위)  · ─(건너뛰기)→ archived
awaiting_link ─(관리자: 링크 넣고 [발행])→ published
어느 상태든 ─(보관)→ archived (published 는 보관해도 랜딩 노출만 내림 — 이미 나간 SNS 는 그대로)
```
- **정기 실행 = claim 할 때 판정**(크론 없음): 작업자 `POST /claim` → 서버가 ① 이미 queued 인 작업(revise·prep_voice·사람이 다시 넣은 것)을 먼저 주고 ② 없으면 일정(`video_schedule`)을 보고 — 켜짐 ∧ 지금이 창 안 ∧ 요일 ∧ 오늘(KST) producing 으로 옮긴 수 < per_day ∧ producing 중인 요청 0 — 계획표 맨 위 `planned` 1건을 **조건부 UPDATE**(`WHERE id=? AND status='planned'` 영향 1행)로 producing 으로 바꾸고 produce 작업을 만들어 준다. 같은 트랜잭션.
- **자동 승인**: produce 안에서 AI 대본 → `build`(검수 관문 §7 — DOM 판정·소재 판정) 통과 → 판 source=`auto` 로 approved(approved_by NULL, 감사 기록 actor='video-worker'). 관문 실패 → `needs_review`(reason `gate_failed` + 걸린 장면 목록). AI 대본 울타리에서 버린 항목이 있으면(§6 dropped) 그대로 진행하되 판 `ai_meta` 에 남겨 화면에 «AI 가 버린 것 N개».
- **실패 사유 코드** §5 + `worker_offline`(화면 표시용) · `link_check_failed`.

### 20.4 작업자 API (운영 · 새 인증 표면 — Fable gate)
`routes/video_worker.js` · 마운트 `/api/video-worker/*` — **사용자 인증 라우터보다 앞**, 이 라우터 밖 표면 없음.
- **켜짐 조건**: `.env VIDEO_WORKER_TOKEN_SHA256`(토큰의 sha256 hex) 있을 때만 마운트. 없으면 404(표면 없음).
- **인증**: `Authorization: Bearer <토큰 64hex>` → sha256 → `crypto.timingSafeEqual`. ∧ **IP 허용 목록** `VIDEO_WORKER_ALLOW_IPS`(dev 서버 IP — `trust proxy 1` 뒤 `req.ip`) ∧ 레이트 분당 120. 실패는 401 하나(이유 안 흘림) + 경고 로그(토큰 값은 안 남김).
- 토큰 원문은 **dev `video-engine/.env` 에만**(git 제외). 운영엔 해시만. 교체 = 새 토큰 만들어 두 곳 바꿈(문서에 한 줄).
- 끝점(전부 POST/PUT/GET 작업자 전용):
  - `POST /claim` → `{job, project, version?, assets:[{id,bytes,md5}]}` 또는 `{job:null}` · 작업자 신호(`video_worker_seen_at`) 갱신
  - `POST /jobs/:id/heartbeat` `{stage, progress, log}` (log 마지막 4KB)
  - `POST /jobs/:id/version` `{script, ai_meta, source}` → 새 판 id (대본은 JSON 스키마 검사 + 512KB 상한)
  - `POST /jobs/:id/complete` `{outputs:[{aspect, upload_id}], drive:{folder_id, files}, youtube_meta}` · `POST /jobs/:id/fail` `{code, message, review?:{reason, detail}}`
  - `GET /assets/:id` — 그 작업이 가진 소재만(작업 점유자 = 이 작업자일 때), Range
  - `POST /uploads` · `PUT /uploads/:id/parts/:n`(≤40MB) · `POST /uploads/:id/finish`(md5 검사) — mp4 만(ffprobe 로 컨테이너·길이 확인), 1파일 300MB 상한
- 작업자가 보낸 값으로 **상태를 직접 정하지 않는다** — 서버가 전이 문(20.3)으로만 바꾼다. 점유 안 한 작업·끝난 작업에 오는 호출은 409.
- 작업자는 dev DB 를 쓰지 않는다(드라이브 토큰 읽기만 — §9).

### 20.5 링크 = 발행 (외부 발송 트리거 — Fable gate)
- 화면 «링크 대기» 에서 여러 줄 링크를 넣고 [발행] → `POST /api/admin/videos/publish` `[{project_id, youtube_url}]`(관리자 · `authenticateToken, requireRole('platform_admin')`).
- 서버: ① id 추출(§10 네 형태 · 11자 검사) ② **유튜브 oEmbed 확인**(`https://www.youtube.com/oembed?url=…` — 키 불필요. 200 = 공개/일부공개 · 401/404 = 비공개·없음 → 그 줄만 `link_check_failed`, 나머지는 진행) ③ 같은 id 가 다른 영상에 이미 있으면 거절 ④ 트랜잭션: 링크 저장 · `published` 전이 · `marketing_videos` 행(placement 있으면 published=1, published_at) · `social_posts`(channels 마다 1건, kind=video, **status=approved, approved_by=누른 관리자**, 본문 = AI 초안 `social_draft` 를 발행 직후 작업으로 생성) — 즉시(`all`) 또는 채널당 하루 1건씩 `scheduled_at` 분산(`daily`).
- **확인 창**(외부 발송 확인 규칙): «N편 · 랜딩 [위치 목록]에 공개 · SNS [계정 이름 목록]에 [즉시/하루 1건씩] 게시» 를 적는다. 연결된 SNS 계정이 없으면 «SNS 는 계정 연결 뒤 [SNS 발송]에서 보냄(초안만 만듦)» 으로 바뀐다.
- SNS 실제 게시는 **SNS 설계 단계 2(OAuth·예약 크론·공개 미디어 주소)** 가 한다 — 여기서는 승인된 게시물을 만들 뿐. 단계 2 전에는 approved 에서 멈추고 [SNS 발송] 화면에 보인다(반자동: 원고 복사·영상 받기·게시함 표시).
- 영상 게시물의 미디어 = 운영 완성본 사본(세로 우선). SNS §4 공개 미디어 주소를 **video/mp4 · Range** 로 넓히는 것은 SNS 단계 2 의 Fable gate 에 같이 건다.

### 20.6 운영 완성본 사본 · 보관
- `uploads/videos/<yyyy-mm>/<uuid>.mp4`(정적 공개 안 함 — 관리자 스트리밍 `GET /api/admin/videos/outputs/:versionId/:aspect` Range 만).
- 보관: 발행 뒤 **30일**(SNS 예약·재시도 기간) 지나면 지운다(드라이브 원본은 남음 · `drive_file_id` 없으면 안 지움). 링크 대기 중·확인 필요 중인 것은 안 지운다. 정리는 기존 일일 정리 크론에 한 줄.
- 디스크 예상: 1편 가로+세로 ≈ 30~60MB · 하루 1편이면 30일 ≈ 2GB 이하.

### 20.7 AI 보조 (운영 LLM · `services/llm.js` PURPOSES 등록 · costGuard.perUserLimiter)
- `video_plan` — [다음 N편 제안](N≤10): 넣는 것 = 랜딩 문구 요약 + 위키 공개 글 제목 + **이미 있는 요청 제목·지시(보관 포함 전부)**. 나오는 것 = `{title, mode:'instruction'|'brand', brief, target_seconds, aspects, placement?}` 배열 → 화면에서 고르면 계획표 끝에 추가(자동 추가 안 함).
- `video_youtube_meta` — produce 끝에 작업자가 만들지 않고 **운영이 awaiting_link 전이 때** 만든다(사실 = 대본 자막·제목 · 과장 금지 · 해시태그 ≤5 · 설명 끝에 랜딩 주소 utm=youtube).
- `social_draft` — 발행 때 채널별 본문(SNS 설계 §6 그대로).

### 20.8 알림
- `awaiting_link` 가 생기면 플랫폼 관리자에게 앱 알림 1건(같은 날 여러 편이면 한 건으로 묶음: «링크 기다리는 영상 N편») + 푸시. `needs_review`·`failed`·작업자 6시간 무신호(일정 창 안일 때만)도 같은 방식. 메일은 안 보냄.

### 20.9 화면 — 운영 `/admin/videos` (ADMIN_MENUS · i18n `adminVideo` ko/en · 3폭)
머리: 작업자 상태(연결됨/마지막 신호) · 일정 요약(«매일 01~06시 1편 · 다음: <제목>») · [일정 설정].
탭 4개:
1. **계획표** — planned·producing 목록(끌어서 순서) · 행: 제목·방식·길이·화면비·노출 위치·채널·[수정]·[보관] · producing 행은 단계·진행률 · [+ 요청] (우측 패널: §12-2 입력 + 노출 위치·SNS 채널·자동 승인 토글) · [AI 로 다음 N편 제안](제안 목록 체크 → 추가).
2. **링크 대기**(배지 = 개수) — 카드: 가로·세로 재생 · [mp4 받기] · 유튜브 제목·설명·태그(복사 버튼 각각) · 링크 칸 · 맨 위 [링크 여러 개 붙여 넣기](줄마다 제목 순서대로 채움) · [발행](확인 창 20.5).
3. **확인 필요**(배지) — 사유(사람이 읽는 문장)·걸린 장면 정지 화면 · [대본 보기·고치기](§12-3 대본 편집 재사용) · [이대로 다시 넣기] · [건너뛰기].
4. **발행됨** — 날짜·유튜브 링크·랜딩 위치(공개 토글)·SNS 게시물 상태(채널별)·판 기록.
- 녹음 방식(①) 요청은 [+ 요청]에서 녹음 파일을 올려야 계획표에 들어간다.

### 20.10 하지 않는 것(이번)
- 유튜브 자동 업로드(구글 감사 전엔 비공개만 — 나중) · SNS 채널 연결·예약 발송 자체(SNS 단계 2 방에서) · 영상 성과 읽기.

### 20.11 검증 계획
- 작업자 API: 토큰 없음/틀림/허용 안 된 IP → 401 · 토큰 env 없으면 라우트 404 · 남의 작업 heartbeat 409 · 점유 경쟁(같은 순간 claim 2번 → 1건만) · 대본 512KB 초과 413.
- 일정: 창 밖 claim → 없음 · per_day 다 찬 날 → 없음 · producing 중 → 없음(대조군: 조건 하나씩 풀면 1건 나옴).
- 흐름: 요청 3개 넣기 → 작업자 `--once` 3번(일정 시험값) → 3편 awaiting_link + 알림 1건 · 관문 걸리는 요청 1개(로딩 뼈대 장면) → needs_review, 다음 편은 계속.
- 발행: 공개 영상 링크 1 + 없는 영상 링크 1 → 앞 것만 published · marketing_videos 1행 · social_posts 채널 수만큼 approved · 감사 기록 · 공개 API 에 나옴 / 뒤 것은 link_check_failed 로 남음.
- 보관: 발행 31일 전 날짜로 바꿔 정리 → 운영 사본 삭제 · 드라이브 id 없는 것은 안 지움(대조군).
- 화면 3폭 · i18n · e2e 스위트 `videoadmin`.

### 20.12 단계(바뀜)
| 단계 | 내용 | ✋ |
|---|---|---|
| D′1 | 마이그레이션 · 모델 · 전이 문 · 작업자 API · 작업자가 DB 대기열로(파일 대기열 → API) · produce 작업 · 일정 판정 | 요청 3개 → 밤새 3편 awaiting_link (dev 에서) |
| D′2 | 운영 화면 4탭 · AI 다음 편 제안 · 유튜브 메타 · 알림 · 운영 사본 보관 | 화면에서 요청부터 링크 대기까지 |
| E′ | 링크=발행 · marketing_videos·랜딩 4곳(§10) · SNS 영상 게시물 생성 · CSP · (SNS 단계 2 와 이어짐) | 링크 한 번으로 랜딩 공개 + SNS 게시물 승인 |
- Irene 할 일(그때): D′ 끝 — 운영 연결 `.env` 두 줄(작업자 토큰 해시·IP)은 배포 때 같이 · dev «PlanQ» 워크스페이스 드라이브 연결 · E′ — 유튜브 채널 · SNS 계정 연결(SNS 단계 2).
