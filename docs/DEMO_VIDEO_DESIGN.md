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
