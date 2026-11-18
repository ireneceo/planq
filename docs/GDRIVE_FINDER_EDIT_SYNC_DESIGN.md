# Drive(파인더)에서 지우기·고치기 → PlanQ 반영 — 설계

작성 2026-11-18 · 방 d907f0d8 · [Opus] · 상태: **Fable 설계 판정 대기**

## 0. 원문·결정

- Irene 11-18: *"지금 구글드라이브에 파일이 올라가기만 하고 삭제도 수정도 해당 파인더에서 할 수가 없으니 사실 무용지물인 상태야. 그냥 저장소인거지."*
- 방 안내: drive.file 권한으로도 **PlanQ 가 Drive 에 올린 사본**의 지움·고침은 Changes 로 보인다 — 지금 반영하지 않는 것은 정책 때문.
- Irene 11-18 «권고대로»: **지움 → PlanQ 휴지통까지만(바로 영구 삭제 안 함) · 고침 → 새 내용, 옛 판 보관.**
- 범위 밖(그대로): Drive 에 **직접 새로 넣은** 파일 들이기(Restricted scope 유료 심사 — 10-02 결정, `GDRIVE_FULL_SCOPE_ENABLE.md`).

## 1. 지금 동작 (코드 사실)

| 파일 종류 | 판정 | Drive 이름·이동 | Drive 지움 | Drive 고침 |
|---|---|---|---|---|
| planq / origin NULL + `gdrive_mirror_id` (현행 업로드의 거의 전부) | PlanQ 정본 | 반영 | **미러 해제만**(`unmirror`, 행 유지, «Drive 사본 없음» 태그) | **무시** |
| gdrive / gdrive (v1 원격 참조) · planq / gdrive (v2 인제스트) | Drive 정본 | 반영 | soft delete(`deleted_at`만 — trashFile 아님) | `drive_md5`·`file_size`만 |

- 정본 판정 `services/fileOrigin.isDriveMaster` · 적용 `services/gdriveApply.applyChange` · 유입 웹훅 `routes/cloud.js /webhook/gdrive` + 크론 `services/gdriveWatchCron.catchUp`(30분, 같은 커서 — 두 길이 같은 변경을 겹쳐 처리할 수 있음).
- Changes 필드: `fileId, removed, time, file(id,name,mimeType,modifiedTime,trashed,parents,md5Checksum,size,webViewLink)`.
- 미러 대상 `gdriveMirror.isEligible`: planq · general · L2(프로젝트)/L3/L4 — L1·대외비·멤버 지정 L2 는 Drive 에 없다.
- PlanQ 삭제 `routes/files.js trashFile` → 커밋 뒤 `flushMirrorRecalls` → `driveMirrorRecall.recallDriveMirror` = `drive.files.delete`(**영구 삭제**, Drive 휴지통 안 거침). 산 형제가 같은 미러를 쓰면 지우지 않고 포인터 유지(`shared`).
- PlanQ 복구 `routes/file_trash.js` → 다시 미러(새 Drive id).
- 쌍둥이: `routes/posts.js` 쌍둥이·백필 `byHash` 가 **같은 `gdrive_mirror_id` 를 여러 산 행이 공유**(운영 5행 있었음 — driveMirrorRecall 주석). `findLocal` 은 산 행 하나만 집는다.
- 바이트 dedup: 같은 `file_path` 를 여러 행이 공유(`services/fileRefs.countLiveRefs`). 사용량 차감은 마지막 산 참조일 때만.
- 파일 «판(버전)» 개념 없음(`TaskDeliverableVersion` 은 업무 산출물 전용).
- [파인더 공유]: Workspace Files·프로젝트 폴더를 팀원 구글 계정에 연다 → 팀원 파인더에서의 지움·고침도 연결 계정의 Changes 에 온다.

dev 실측(ws 3 워프로랩만 연결): 지금 산 미러 행 0(시험 데이터 정리 뒤) · 원장 rename 65 · trash 58 · unmirror 45 · unknown_file 485 · ingest_scope_missing 811. **운영 숫자는 확인 못 함**(이 방에서 운영 읽기 권한 거부).

## 2. 제안 (Opus 초안 — Fable 이 정할 것 표시 ◆)

### A. 지움 (Drive 휴지통으로 보냄 / 영구 삭제)
1. 미러 사본이 `trashed=true` 또는 `removed=true` → 그 사본을 가리키는 **산 행 전부**를 PlanQ 휴지통으로. 경로는 사용자 삭제와 **같은 `trashFile`**(purge_after·사용량 차감·색인 회수·감사·실시간 `file:deleted`) — 별도 soft delete 를 새로 쓰지 않는다.
2. `deleted_by` = Drive `lastModifyingUser.emailAddress` 가 이 워크스페이스 활성 멤버면 그 사람, 아니면 NULL. 감사 `file.delete` + `newValue.via='gdrive'`. 휴지통 화면에 «Google Drive 에서 지움» 표시(◆ 칸을 더할지 감사에서 읽을지).
3. Drive 사본 처리 ◆: (a) 지금 `trashFile` 큐대로 Drive 사본 **영구 삭제** — 복구 창구가 PlanQ 휴지통 하나 / (b) Drive 휴지통에 두고 Drive 에서 «복원»하면 PlanQ 도 복구. 권고 (a) — 두 휴지통이 따로 살면 PlanQ 복구(새 사본) + Drive 복원(옛 사본) = 중복.
4. `removed=true` 는 «영구 삭제» 외에 «접근을 잃음»일 수도 있다 → `files.get` 으로 404/trashed 확인됐을 때만 휴지통, 아니면 지금처럼 unmirror ◆.
5. **대량 안전판** ◆: 폴더째(Workspace Files·프로젝트 폴더) 휴지통으로 보내면 자식이 줄줄이 `trashed`(explicitlyTrashed=false)로 온다. 제안: 한 번의 적용에서 N건(예 20) 넘게 지우게 되면 **지우지 않고 보류** + 대표에게 알림 «Drive 에서 파일 N개가 지워졌어요 — PlanQ 에서도 지울까요?»(화면 필요) / 또는 그대로 휴지통 + 알림만. 되돌릴 수 있으니 후자도 가능.
6. 쌍둥이 ◆: 문서 첨부 쌍둥이까지 휴지통으로 보낼지(같은 바이트·같은 Drive 사본이므로 «하나의 파일»), 파일함 행만 보낼지.

### B. 고침 (같은 Drive 파일 id 로 내용이 바뀜)
1. 판정: 미러 사본의 `md5Checksum` ≠ **로컬 바이트 md5**(드물게 계산, `drive_md5` 에 캐시) → 내용이 바뀐 것. 우리 업로드 에코는 md5 가 같아 자연 흡수.
2. 받기: `files.get alt=media` 로 새 바이트 → 새 경로(`uploads/{biz}/{yyyy-mm}/uuid`)에 저장(제자리 덮어쓰기 금지 — dedup 으로 다른 행이 같은 경로를 쓴다). 확장자·크기 검사는 업로드와 같은 정책(`plan.can('upload_file')`·쿼터·허용 확장자 — `driveImport` 의 검사 재사용).
3. 산 행(쌍둥이 포함 ◆) 의 `file_path·file_size·content_hash(sha256)·drive_md5·mime_type` 갱신, 사용량 = 새 바이트 더하고 옛 바이트는 마지막 참조일 때만 뺀다.
4. **옛 판 보관** ◆:
   - (i) 옛 바이트로 **휴지통 행 하나**를 만든다(«이름 (이전 판 11-18 14:02)», deleted_at=지금, purge_after=보관기간) — 새 표·새 화면 없음, 휴지통 «복구» 로 되살림. 보관은 휴지통 기간까지.
   - (ii) `file_versions` 새 표 + 파일 상세 «이전 판» 목록·되돌리기 — 표·화면·마이그레이션 필요.
   - 권고 (i) — 지금 화면·보관 규칙을 그대로 쓴다.
5. 실패(한도 초과·형식 거부·내려받기 실패): 반영하지 않고 원장 `skip/reason` + 행에 표시(◆ 무엇으로) — 조용히 옛 내용을 보여 주지 않게.
6. 색인(Cue)·썸네일 캐시·Drive 캐시(`driveCache`) 다시 만들기, 실시간 `file:updated`.
7. 충돌: PlanQ 쪽에서 파일 바이트를 고치는 길은 없다(확인 필요) → 충돌 없음, Drive 고침이 그대로 새 판.

### C. 같이 바꿀 것
- `gdriveApply` 머리 정책 ①(비대칭) 갱신 — «PlanQ 정본 사본도 지움·고침을 반영한다(휴지통·옛 판)». `fileOrigin` 축은 그대로.
- Changes 필드에 `lastModifyingUser(emailAddress)`·`explicitlyTrashed` 추가.
- 웹훅·크론 겹침: 같은 변경을 두 번 적용해도 멱등(지움 = 이미 deleted 면 skip · 고침 = md5 같으면 skip)인지 실측.
- 안내 문구: `settings.json scopeOneWay` 등(«Drive 에서 지우거나 고친 것도 PlanQ 에 반영됩니다 — 새로 넣은 파일은 «Drive 가져오기»로») ko/en.
- 회귀 검사: health-check 또는 e2e 에 «Drive 사본 휴지통 → PlanQ 휴지통 · md5 바뀜 → 새 바이트 + 옛 판 휴지통 행» 를 가짜 Changes 입력으로(실 Drive 없이도 돎) + 음성 대조군(에코 md5 같음 → 무변화).

## 3. 검증 계획
- 가짜 Changes 입력으로 `applyChange` 단위 실측(지움·영구 삭제·접근 상실·대량·쌍둥이·에코·한도 초과).
- dev ws 3 실 Drive(연결된 계정)로 `[확인용]` 파일: 업로드 → 미러 → API 로 내용 교체(`files.update` media) → 크론 catchUp → 새 바이트·옛 판 확인 → API 로 휴지통 → PlanQ 휴지통 → PlanQ 복구 → 다시 미러.
- **확인 못 하는 것**: 맥 파인더(Drive for desktop)·오피스 저장이 같은 Drive id 를 유지하는지 — 서버에서 재현 불가. 새 id 로 저장되면 drive.file 로 안 보이고 원래 사본은 trashed 로 와 «지움»으로 처리될 위험 ◆(이 경우 PlanQ 에서는 파일이 휴지통으로 가고 새 판은 안 들어온다).

## 4. Fable 판정

2026-11-18 · [Fable] 설계 판정 · **DESIGN-READY** — 아래 결정이 정본이다. 2절과 다르면 **4절이 이긴다.**
읽은 것: gdriveApply · fileOrigin · driveMirrorRecall · gdriveMirror · gdriveWatchCron · gdrive(listChanges·uploadFile) · fileRefs · filePurge · fileRetention · driveImport · routes/files(trashFile·flushMirrorRecalls·canMutateFile) · file_trash(복구) · cloud(webhook) · posts(쌍둥이·editor-image) · editorImage · File/GdriveSyncLog 모델 · ecosystem(PM2 fork 1개). 실 Drive 호출·운영 DB 는 안 봤다(판정은 코드 사실 기준).

### 4.0 초안에서 사실이 틀린 것 (먼저 바로잡는다)

| 초안 | 코드 사실 | 결과 |
|---|---|---|
| «크론 catchUp 30분» | `runGdriveWatchCron` 은 30분마다 돌지만 **채널이 없거나 24시간 안에 만료될 연동만** 고른다 → catchUp 은 사실상 **주 1회(갱신 때)** | 놓친 변경을 30분 뒤에 줍는 그물은 없다 → D-2 |
| «files.get 404 면 영구 삭제 확인» | Drive 는 **접근을 잃은 파일도 404** 다. 404 로는 둘을 못 가른다 | A-4 |
| `deleted_by` = `lastModifyingUser` | 휴지통 보내기는 내용 수정이 아니라 그 칸이 안 바뀐다. 지운 사람은 **`trashingUser`** | A-7 |
| 커서 | 웹훅·크론 둘 다 **커서를 먼저 저장하고** 그 뒤에 적용한다. 적용 중 죽으면 그 변경은 영영 안 온다(이름변경 때는 참을 만했지만 지움·고침은 조용한 어긋남) | D-1 |
| «팀원 파인더 지움도 Changes 로 온다» | 내 드라이브에서는 **소유자가 아닌 편집자가 지우면 «휴지통» 이 아니라 «폴더에서 빼기»(부모 변경)** 로 올 수 있다(공유 드라이브는 휴지통). 지금 코드는 모르는 부모면 무시 | E-3 실측 · 이번 범위에서는 «빼기» 는 지움으로 보지 않는다 |

### 4.1 A. 지움 — 결정

적용 대상은 **PlanQ 정본 미러 행**(`!isDriveMaster` · `storage_provider='planq'` · `gdrive_mirror_id=driveId`)뿐. Drive 정본 분기는 건드리지 않는다.
`L` = 그 사본을 가리키는 **산 행**. 아래 순서로 **처음 맞는 것**을 한다.

| # | 조건 | 처리 | 원장 |
|---|---|---|---|
| A-4 | `removed=true` | **지금처럼 unmirror**(휴지통 안 보냄). `files.get` 확인은 하지 않는다 — 구별 못 하고, 접근 상실이 대량으로 오면 워크스페이스 파일이 통째로 휴지통에 간다. 틀려도 «안 지워짐» 쪽이 안전 | `unmirror` |
| — | `trashed=true` · `L`=0 | 지금처럼 unmirror(휴지통 형제 포인터까지 비움 — 현행 코드 그대로) | `unmirror` |
| A-6 | `L`≥2(쌍둥이·백필 byHash) **또는** 문서 본문 이미지(`file_path` 에 `editor-images` — posts.js 쌍둥이 술어와 같은 것) | **휴지통 안 보냄 · unmirror.** 이유: ① byHash 쌍둥이는 **다른 프로젝트 행**일 수 있다 — A 폴더 사본을 지웠는데 B 프로젝트 파일이 휴지통에 가면 청중 경계를 넘는 삭제다 ② editor-image 행이 지워지면 `resolveEditorImage` 가 404 → **살아 있는 문서의 그림이 사라진다** | `unmirror` · detail.reason `shared_mirror`/`embedded` |
| A-5a | `explicitlyTrashed=false`(폴더째 지워 따라온 것) | **보류** — 행·포인터 그대로, `drive_sync_issue='trash_held'`. Drive 에서 폴더를 되살리면 `trashed=false` 가 와 표시만 지운다. Drive 가 30일 뒤 비우면 `removed` → unmirror. **폴더 지움의 반영은 이번 범위 밖**(폴더 역방향 동기화는 별도 설계) | `skip`/`trash_held` |
| A-5b | 그 워크스페이스에서 **최근 10분 Drive 발 휴지통 ≥ 100건**(원장 `action='trash'` 로 센다) | 넘는 것부터 **보류**(A-5a 와 같은 상태) + 대표에게 앱 안 알림 1회 | `skip`/`trash_breaker` |
| A-3x | `md5Checksum` 이 없거나, 알고 있는 md5(4.2 B-1)와 **다르다** = 고친 뒤 지움(Changes 는 파일당 마지막 상태만 준다) | **먼저 B(고침)를 적용**하고 성공하면 아래 A-3 으로. B 가 실패하면 **보류**(`edit_*` 표시). ★ 이 경우 **Drive 사본을 영구 삭제하지 않는다** — 우리가 안 받은 바이트의 유일본이다 | — |
| A-3 | 위 어느 것도 아님(`L`=1 · 직접 지움 · md5 같음) | **PlanQ 휴지통 + Drive 사본 영구 삭제 = 초안 (a).** 트랜잭션: 행을 PK 로 `FOR UPDATE` → `deleted_at IS NULL` · `gdrive_mirror_id=driveId` 재확인 → `trashFile(file, {user:{id: 지운 사람|null}}, t, mq)` + `deleted_via='gdrive'` → 커밋 → `flushMirrorRecalls(mq)` → 감사·`file:deleted`(신호만)·알림 | `trash` |

- **(a) 를 고른 이유**: 지금 불변식 «PlanQ 휴지통 행에는 Drive 사본이 없다(shared 예외)» 를 그대로 둔다. (b) 는 `untrash` 반영 + «복구 = 재미러 대신 Drive 복원» 두 방향이 새로 생기는데, 이 영역이 9월에 10차까지 깨진 자리(포인터·형제)다. (a) 에서 되돌릴 수 없는 것은 Drive 사본 삭제 하나이고, **md5 가 같다고 확인된 사본만** 지우므로 잃는 바이트가 없다.
  - 대가(보고·안내 문구에 쓴다): 파인더 «되돌리기(⌘Z)»·Drive 휴지통 «복원» 은 안 된다 — 복구는 PlanQ 휴지통 한 곳.
- A-7 **지운 사람·표시**: Changes 필드에 `file.trashingUser(emailAddress)`·`file.explicitlyTrashed`·`file.lastModifyingUser(emailAddress)` 추가. 이메일이 **그 워크스페이스 활성 멤버 계정**과 맞을 때만 `deleted_by`, 아니면 NULL. **바깥 사람 이메일 원문은 원장·감사에 적지 않는다**(`actor:'external'` 만).
  표시는 **새 칸 `files.deleted_via VARCHAR(20) NULL`**(`'gdrive'` · 옛 판 행 `'gdrive_edit'`) — 감사에서 읽지 않는다(목록마다 조인·감사 보관기간에 묶임). 휴지통 응답에 싣고 화면이 «Google Drive 에서 지움»/«이전 판» 을 그린다. **복구가 `deleted_by`·`purge_after` 와 함께 NULL 로 지운다**(file_trash.js). 모르는 값은 값 그대로 보이게(status-values 규약).
- **알림**(앱 안만 — 메일·푸시 발송 없음): 올린 사람 ≠ 지운 사람이면 올린 사람에게 «Drive 에서 지워져 휴지통으로 갔어요». 한 번 적용에서 같은 사람에게 여러 건이면 **한 장으로 묶는다**. 보류(A-5a·b)는 대표에게 묶어서 1회.
- **권한**: Drive 편집자는 PlanQ `canMutateFile` 이 없어도 지울 수 있게 된다(공유 드라이브·소유 계정). 받아들인다 — 휴지통(30일 이상)·`deleted_via`·알림·감사가 있고 복구 권한은 그대로다. 대신 위 A-5·A-6 이 폭을 줄인다.

### 4.2 B. 고침 — 결정

- **B-1 판정**: 비교 기준은 **«우리가 아는 그 사본의 md5»** = `files.drive_md5`(미러 행에도 쓴다 — 뜻은 그대로 «Drive 가 준 체크섬»).
  - 앞으로: `gdrive.uploadFile` 응답 필드에 `md5Checksum` 추가 → `mirrorFile` 이 `drive_md5` 기록. posts.js 쌍둥이·백필 byHash 가 미러 id 를 물려줄 때 `drive_md5` 도 같이.
  - 옛 행(`drive_md5` NULL): **로컬 바이트 md5 를 그때 계산**해 비교, 같으면 `drive_md5` 만 채우고 끝. ★ **NULL 을 «바뀜» 으로 읽지 않는다** — 읽으면 옛 미러 전부가 첫 이름변경 때 다시 받아지고 옛 판이 생긴다. 로컬 바이트가 없으면 skip `local_missing`.
  - `md5Checksum` 없음(구글 문서로 변환됨 등) → skip `no_md5`.
- **B-제외**: `L`≥2 · editor-image 행(경로가 본문 주소라 새 경로로 옮기면 문서 그림이 404) · **증빙으로 묶인 파일**은 반영하지 않고 `drive_sync_issue='edit_not_applied'`. ★ 구현 전에 작업 모델이 **`files.id` 를 증빙·스냅샷으로 참조하는 표를 전수**로 찾아(서명 요청·청구 첨부·완료 스냅샷 등) 이 절에 목록을 덧붙인다 — 공개 공유 링크(`share_token`)가 걸린 일반 파일은 반영하되(그게 «최신 내용»의 뜻) 감사에 `shared:true`.
- **B-2 받기**(트랜잭션 **밖**): 크기 사전 검사(`f.size` vs 플랜 파일당 한도) → 임시 경로로 스트림(바이트 세다가 한도 넘으면 끊음) → **받은 바이트의 md5 == Changes 의 md5** 확인(다르면 받는 중에 또 바뀐 것 — 버리고 skip `changed_during_download`) → sha256.
  확장자는 **현재 `file_name` 기준** `driveImport.ALLOWED_EXT`·`plan.can('upload_file',{size})`. `mime_type` 은 **업로드 라우트와 같은 방식(확장자 기준)** 으로 정하고 Drive 가 말한 mimeType 을 그대로 믿지 않는다(.pdf 이름에 text/html). 내려받기는 `driveImport.downloadTo` 재사용.
- **B-3 반영**(한 트랜잭션): 행 PK `FOR UPDATE` → `deleted_at IS NULL` · `gdrive_mirror_id=driveId` · `drive_md5` 가 받기 전 값 그대로인지 재확인(아니면 임시 파일 버림) → 쿼터: `옛 바이트는 isLastLiveRef 일 때만 빼고 + 새 바이트` 가 한도 안인지(`file_count` 는 그대로) → **옛 판 행 만들기(B-4)** → 산 행 `file_path·file_size·content_hash·drive_md5·mime_type` 갱신. 새 바이트에는 **dedup 을 걸지 않는다**(항상 새 경로 — 과계수 쪽이라 안전). 커밋 실패면 새 파일 unlink.
  커밋 뒤: 색인 다시(`removeFileIndex`→`indexOnUpload`) · `file:updated`(신호만) · 감사 `file.content_update`(`via:'gdrive'`·옛/새 sha256·크기·고친 사람) · 올린 사람 ≠ 고친 사람이면 앱 안 알림. **Drive 호출은 없다**(Drive 는 이미 새 내용).
- **B-4 옛 판 = (i) 휴지통 행.** 새 표·새 화면 없음. Drive 자체도 일반 파일의 옛 판을 30일 보관하므로 이중이다.
  - 행 내용: 옛 `file_path·file_size·content_hash·mime_type` · 이름 «원래이름 (이전 판 MM-DD HH:mm).확장자» · `uploader_id`·`business_id`·`project_id`·`folder_id`·공개 범위·`target_member_ids`·보안등급 승계 · `deleted_at=지금`·`purge_after=stampFor`·`deleted_by=고친 사람|NULL`·`deleted_via='gdrive_edit'`·`ref_count=1`.
    **승계하지 않는 것**: `gdrive_mirror_*`(있으면 복구 때 `isEligible` 이 막는다)·`drive_md5`·`share_token`·공유 비밀번호·`external_*`·`origin_provider`·프로젝트 연결.
  - **하루 1판으로 묶는다** — 같은 파일에 **24시간 안에 만든 옛 판 행이 있으면 새로 만들지 않는다**(원장 `action='content'`·`file_id` 의 `detail.old_version_file_id` 로 판정). 그때 중간 판 바이트는 `bytesStillNeeded` 가 거짓이면 unlink. 이유: 휴지통 행은 쿼터 밖이라 저장할 때마다 판을 만들면 50MB 파일 100번 저장 = 5GB 가 쿼터 없이 30일 쌓인다.
  - 한계(보고에 쓴다): 옛 판은 **휴지통 보관기간(30일~)까지만**, 복구하면 «되돌리기» 가 아니라 **별도 파일**로 살아난다.
- **B-5 실패 표시 = 새 칸 `files.drive_sync_issue VARCHAR(40) NULL`.** 값: `edit_too_large`·`edit_quota`·`edit_ext`·`edit_download_failed`(다시 시도 대상)·`edit_not_applied`·`trash_held`. 파일 목록 응답에 실어 기존 «Drive 사본 없음» 태그 자리(routes/projects.js 3곳과 같은 표면)에 «Drive 사본이 PlanQ 와 달라요 — 이유» 로 그린다(ko/en · 모르는 값은 값 그대로). 반영에 성공하거나 md5 가 다시 같아지거나 포인터가 비면 NULL. 원장에도 `skip/reason`.
- **B-7 충돌**: PlanQ 에 파일 바이트를 고치는 길이 없음을 확인했다(`file_path` 를 바꾸는 update 0곳). 충돌 없음 — 대신 **바이트를 고치는 길을 새로 만들면 이 절을 다시 연다**(gdriveApply 머리 주석에 한 줄).

### 4.3 D. 동시 처리·유실 — 필수

1. **D-1 워크스페이스당 한 줄로**: «커서 읽기 → listChanges → 적용 → 커서 저장» 을 **business 단위 단일 실행**(프로세스 안 Map — PM2 fork 1개 확인)으로 감싸고 웹훅·크론이 같은 함수를 부른다. **커서는 적용이 끝난 뒤 저장**한다(적용은 멱등, 건별 실패는 `applyChanges` 가 삼키고 표시를 남기므로 독이 든 변경이 줄을 막지 않는다). 이것이 없으면 두 웹훅이 같은 지움을 동시에 적용해 **쿼터를 두 번 뺀다**(과소 계수 = 한도 우회 방향).
2. **D-2 다시 시도**: 30분 크론 틱에 한 구간 추가 — `drive_sync_issue='edit_download_failed'` 인 산 미러 행을 `files.get`(메타)으로 다시 읽어 `applyChange` 에 넣는다(워크스페이스당 틱마다 최대 20건, `workspaceAlive` 술어). 전체 대조(`files.list` 로 앱 파일 전부 vs 행)는 **권고·비차단** — 이번에 안 하면 작업기록 «다음 할 일».
3. **잠금**: 잠그는 것은 **자기 행 하나(PK)** 뿐. 형제 집합을 `FOR UPDATE` 하지 않는다(9월 교착). 형제를 여럿 건드리는 경우는 A-6 으로 애초에 빠진다.
4. **Drive 호출은 전부 트랜잭션 밖** — 내려받기는 앞, 사본 삭제는 커밋 뒤 큐(요청 스코프 배열 — 전역 금지, 롤백이면 큐를 버린다).
5. 한 번 적용에서 **내려받기 최대 20건·합계 500MB**, 넘으면 나머지는 `edit_download_failed` 로 남겨 D-2 가 잇는다.

### 4.4 빠진 위험 — 판정

| 위험 | 판정 |
|---|---|
| 고친 뒤 지움 → (a) 가 안 받은 바이트의 유일본을 영구 삭제 | **차단** — A-3x |
| 접근 상실·폴더 지움이 대량 휴지통으로 번짐 | 차단 — A-4·A-5a·A-5b |
| 문서 그림·다른 프로젝트 행이 같이 사라짐 | 차단 — A-6 · B-제외 |
| 휴지통 행이 쿼터 밖이라 옛 판으로 디스크 무한 증가 | 차단 — B-4 하루 1판 |
| 같은 변경 두 번 적용(쿼터 이중 차감) · 적용 중 죽어 변경 유실 | 차단 — D-1 |
| 옛 미러(`drive_md5` NULL) 전부가 «바뀜» 으로 읽힘 | 차단 — B-1 |
| 증빙 파일·공개 링크의 내용이 조용히 바뀜 | 증빙은 제외(B-제외), 공개 링크는 반영 + 감사·알림 |
| 바깥 사람 이메일이 원장에 남음 · 실시간에 행 전체가 실림 | A-7 · 신호만 |
| **맥 파인더·오피스 저장이 새 Drive id 로 저장**(원래 사본은 `trashed`, 새 파일은 drive.file 로 안 보임) → 고칠 때마다 PlanQ 파일이 휴지통으로 | **서버에서 증명 불가 — 운영 반영 조건**(4.6). 실제로 그렇다면 그 저장 방식에 한해 A-3 을 끄고 다시 판정받는다 |
| Drive 이름변경이 확장자 검사 없이 `file_name` 에 들어감(기존 동작) | 비차단·기존 — 이번에 `mime_type` 은 안 바꾸므로 넓어지지 않는다. 별도 건으로 남긴다 |
| Drive 정본 분기 지움이 `trashFile` 을 안 지나감(purge_after NULL·쿼터 미반환) | 비차단·기존 — 범위 밖 |

### 4.5 구현 순서 (각 단계가 따로 초록이어야 다음으로)

1. **DB**: `files.deleted_via`·`files.drive_sync_issue`(둘 다 NULL 허용 · 멱등 마이그레이션 · 배포 슬롯 등록) + db-schema 규칙 갱신.
2. **md5 기록**: `uploadFile` 필드 · `mirrorFile` · 쌍둥이/백필 승계 · B-1 지연 계산. (동작 변화 없음 — 여기서 음성 대조군 ⓐ 를 먼저 통과시킨다)
3. **D-1** 단일 실행 + 커서 순서. Changes 필드 추가.
4. **A** 지움(분기표 순서 그대로 한 함수) + 복구가 `deleted_via` 지움 + 휴지통 응답·화면 표시.
5. **B** 고침 + 옛 판 + 실패 표시 + D-2.
6. 알림·감사·안내 문구(ko/en — «Drive 에서 지우면 PlanQ 휴지통으로, 고치면 새 내용으로 반영됩니다. 폴더째 지운 것과 새로 넣은 파일은 반영되지 않습니다. 복구는 PlanQ 휴지통에서»).
7. `gdriveApply` 머리 정책 ①·②·④ 갱신 · `.claude/rules/qfile.md` 한 절 · 회귀(health-check 또는 e2e 스위트, 가짜 Changes).

### 4.6 완료 검증 때 반드시 증명할 것 (/fable-검증 에 숫자로)

**양성**
1. 직접 지움(md5 같음·`L`=1) → 행 `deleted_at`·`purge_after`·`deleted_via='gdrive'` · 쿼터 정확히 1회 차감 · 색인 회수 · Drive 사본 404 · 포인터 NULL · 복구 → 새 Drive id·`deleted_via` NULL·쿼터 원복.
2. 고침 → 산 행 새 경로·크기·sha256·`drive_md5` · 내려받기 응답 바이트 sha256 일치 · 옛 판 휴지통 행 1개(옛 바이트 그대로 내려받아짐·미러/공유 칸 NULL) · `bytes_used` = 전 − 옛(마지막 참조일 때) + 새.
3. 고친 뒤 지움(한 변경으로 옴) → 새 내용이 PlanQ 휴지통 행에 있고 옛 판 행도 있다. B 를 일부러 실패시키면 **Drive 사본이 남아 있다**.
4. 실 Drive(dev ws 3, `[확인용]`): 업로드 → `files.update` media → 반영 → 휴지통 → PlanQ 휴지통 → 복구 → 재미러. 그리고 **폴더째 휴지통이 자식 변경으로 오는지·`explicitlyTrashed` 값**, **두 번째 계정(편집자)이 지웠을 때 무엇이 오는지**(휴지통인가 부모 변경인가)를 원문으로 기록.

**음성 대조군**(하나라도 빠지면 미완)
- ⓐ 에코: 우리 업로드·이름변경·이동이 되돌아옴 → 무변화. **`drive_md5` NULL 인 옛 미러 + md5 같은 변경 → 내려받기 0회·옛 판 0개**.
- ⓑ `removed=true` → 휴지통 0건(unmirror). ⓒ `explicitlyTrashed=false` → 휴지통 0건·`trash_held`. ⓓ 100건 넘김 → 101번째부터 보류.
- ⓔ 쌍둥이(`L`=2)·editor-image 지움/고침 → 두 행 다 살아 있고 문서 그림 200.
- ⓕ 같은 변경 묶음을 **동시에 두 번** 적용 → 쿼터 차감 1회·옛 판 1개. ⓖ 적용 도중 예외 → 커서 그대로·다시 돌리면 같은 끝 상태.
- ⓗ 한도 초과·허용 안 되는 확장자·받는 중 md5 불일치 → 산 행 바이트 그대로 + `drive_sync_issue` 가 목록 응답에 실림 + 임시 파일 0개.
- ⓘ 하루 2번 고침 → 옛 판 행 1개, 중간 판 바이트는 디스크에 없다.
- ⓙ 다른 워크스페이스의 같은 Drive id·PlanQ 에서 이미 지운 행 → 무변화. ⓚ Drive 정본 행 → 종전과 한 글자도 같다.
- ⓛ 검사기 자체: A-3x·A-6 가드를 잠깐 끄면 해당 검사가 빨강이 되는지(양성 대조군).

**운영 반영 조건**(검증 통과와 별개)
- Irene 맥 실기기 1회: 파인더(Drive for desktop)에서 미러 파일을 **오피스·한글·미리보기로 열어 저장** → PlanQ 에 «새 내용» 으로 오는지, 휴지통으로 가는지. 휴지통으로 가는 앱이 있으면 배포 전에 이 절로 돌아온다.
- 운영 숫자 3개(읽기만): 산 미러 행 수 · 같은 미러 id 를 나눠 쓰는 산 행 수 · editor-image 미러 행 수 — A-6 이 실제로 몇 행을 빼는지 보고에 적는다.
- 배포 직후 1주: 원장 `trash`·`content`·`trash_held`·`edit_*` 건수를 본다(`trash` 가 사람 손보다 많으면 A-3 을 끈다 — 끄는 스위치는 env 하나로 둔다, 기본 켬).

## 5. 자체 검증 (2026-11-18 · [Opus])

구현 커밋 cf3f5801 · 전체 스위치 f62fff22(다른 방 — 운영 기본 꺼짐 `GDRIVE_FINDER_SYNC=1` 일 때만, dev 는 켬).

- **실 Drive (dev ws 6, 11-18 12:43 Irene 연결, `[확인용]`)** 15/15
  - 미러 업로드가 drive_md5 기록 · ⓐ 에코 무변화
  - 양성2 고침: 새 바이트·sha256·md5 · 옛 판 휴지통 행 1개(옛 바이트 그대로·미러/공유 칸 NULL, 이름 «… (이전 판 11-18 21:44).txt») · 쿼터 = −옛 + 새
  - ⓘ 하루 2번 고침 → 옛 판 1개·중간 판 바이트 지움
  - 양성1 지움: PlanQ 휴지통·deleted_via=gdrive·purge_after · 쿼터 1회 차감 · Drive 사본 영구 삭제(404)·포인터 NULL · ⓕ 다시 돌려도 차감 그대로
    - deleted_by NULL — 지운 구글 계정이 ws 6 멤버가 아니라서(설계대로)
  - 양성3 고친 뒤 지움(고침 성공) → 새 내용으로 휴지통 + 옛 판 1
  - 양성3 고친 뒤 지움(고침 실패 = 저장공간 꽉 참) → 안 지움·로컬 바이트 그대로·`edit_quota`·Drive 사본은 휴지통에 남음
    - 첫 시도는 PlanQ 이름을 .exe 로 바꿔 실패시키려 했으나 Drive 의 이름변경(.txt)이 먼저 반영돼 고침이 성공 — 시험 방법 문제, 용량으로 다시 재서 통과
  - ⓒ 폴더째 지움: 자식 `trashed:true, explicitlyTrashed:false` 로 옴(실측) → 보류 `trash_held` · 폴더 되살리면 표시 지움
- **가짜 Changes** 15/15 (removed·쌍둥이 지움/고침·문서 그림·10분 100건·NULL md5 에코·한도 넘김·받기 실패·D-2 다시 시도·Drive 정본 불변·스위치 끔·동시 2회 차감 1회·가드 양성 대조군·증빙 참/거짓) + 다른 워크스페이스의 같은 Drive id → 무변화
- HTTP 3/3: 휴지통 목록 deleted_via · 복구가 deleted_via·drive_sync_issue NULL · 파일 목록 drive_sync_issue
- 화면 3폭(1440·820·390): 목록 «Drive 와 다름» 82×19 elementFromPoint 일치 · 휴지통 «Google Drive 에서 지움»/«고치기 전 판»
- build EXIT 0 · error TS 0 · guard 85/86 · health-check 101/101(drivesync 포함)
- **확인 못 함**: 두 번째 구글 계정(편집자)이 지웠을 때 휴지통인지 부모 변경인지 · 맥 파인더·오피스/한글/미리보기 저장이 같은 Drive id 를 유지하는지(운영 반영 조건) · 운영 숫자 3개(이 방 운영 읽기 권한 거부)

## 6. Fable 완료 검증

2026-11-18 · [Fable] 완료 검증 · 대상 cf3f5801 + f62fff22 (HEAD 0c73c3ed) · **VERDICT: PASS** — 차단 0 · 비차단 6.
자체 검증 숫자를 믿지 않고 따로 짠 스크립트로 다시 쟀다(스크립트·시험 행·바이트·Drive 사본·원장·감사·알림·사용량 모두 되돌림 — ws 6 사용량 173,996,601B·127개 전후 같음, Drive 에 남은 시험 파일 0).

**통과의 뜻**: ① 운영에 **꺼진 채**(GDRIVE_FINDER_SYNC 없음) 나가도 된다 ② 코드는 §4 설계대로 동작한다.
**운영에서 켜는 것(운영 .env `GDRIVE_FINDER_SYNC=1`)은 이 판정에 들어 있지 않다** — §4.6 «운영 반영 조건»(맥 파인더·오피스/한글/미리보기 저장이 같은 Drive id 를 유지하는가 · 두 번째 구글 계정 편집자가 지웠을 때 무엇이 오는가 · 운영 숫자 3개)이 그대로 남아 있고, 아래 비차단 ①을 먼저 고치기를 권한다.

### 6.1 실 Drive + 실 웹훅 (dev ws 6 · 서버 프로세스가 적용, 검증 스크립트는 Drive 조작·DB 읽기만) — 22/22
- 미러 업로드가 `drive_md5` 기록 · 실 Drive 가 새 Changes 필드(explicitlyTrashed·trashingUser·lastModifyingUser)를 받아 줌(운영에서 스위치와 무관하게 쓰이는 호출이라 따로 확인) · ⓐ 에코 = `skip/no_change` 뿐
- 양성2 고침(Drive `files.update` media → 웹훅 6~27초): 새 경로·크기·sha256·md5 · 옛 판 휴지통 행 1(옛 바이트 그대로·미러/공유 칸 NULL·purge_after 있음) · 쿼터 = −옛 + 새(+30B)·개수 그대로 · `GET /api/files/6/:id/download` 바이트 sha256 = 새 내용
- ⓘ 같은 날 2번째 고침 → 옛 판 1·중간 판 바이트 디스크에 없음
- 양성1 지움: `deleted_via='gdrive'`·`purge_after` · 쿼터 −25B·−1개(1회) · Drive 사본 `files.get` 404 · 포인터 NULL · `GET /trash` 에 gdrive / gdrive_edit · 복구 200 → 새 Drive id·`deleted_via` NULL·쿼터 원복 · 옛 판 복구 → 별도 산 파일(+옛 바이트·+1개)
- 양성3 고친 뒤 바로 지움 → 휴지통 행 바이트 = 새 내용 · Drive 사본 404
- 양성3b 고친 뒤 지움 + 고침 실패(사용량을 한도 위로) → 안 지움·로컬 바이트 그대로·`edit_quota`·원장 `trash_after_edit_held` · **Drive 사본 남음**(trashed:true · md5 = 안 받은 새 내용)
- ⓒ 폴더째 휴지통: 자식 실측 `trashed:true, explicitlyTrashed:false` → `trash_held`·산 채·포인터 유지 · 폴더 되살림 → 표시 NULL
- `all-files` 응답에 `drive_sync_issue` · `/api/cloud/status/6` `finder_sync:true` · 원장 detail 에 이메일 원문 0 · 알림 5장 전부 앱 안(email_logs·push_logs 증가 0)

### 6.2 가짜 Changes (독립 재현) — 31/31
- 고침: 새 경로·옛 판·쿼터·산 행 공유 링크 유지·바깥 이메일 미기록 · 받는 중 md5 불일치 → 무변화·임시 파일 0 · 크기 한도 `edit_too_large` · 확장자 `edit_ext` · 받기 실패 `edit_download_failed` · md5 다시 같으면 표시 NULL
- ⓔ 쌍둥이 고침(반영 안 함)·지움(둘 다 산다) · 문서 그림 지움(산다) · ⓑ removed(산다) · ⓙ 다른 워크스페이스 같은 Drive id·이미 지운 행 → 무변화 · ⓚ Drive 정본 = 종전
- 스위치: GDRIVE_FINDER_SYNC 끔 → 고침 무시·지움은 미러 해제(산다) · GDRIVE_FINDER_TRASH=0 → 산다
- D-1(`runChanges`, 임시 토큰 행): ⓖ 적용 도중 예외 → 커서 그대로 · 목록 2쪽 실패 → 커서 그대로·미적용 · ⓕ 동시 3회 → 쿼터 차감 1회(scanned 1·0·0)·커서 전진 · 커서를 되돌려 다시 적용 → 차감 그대로
- ⓓ 10분 100건 → 보류 + 대표 알림 1(메일·푸시 끔) · 증빙 술어 5개 쿼리가 dev 스키마에서 오류 없이 돈다(오류면 전부 «묶임» 으로 읽혀 고침이 통째로 꺼진다)

### 6.3 가드
`npm run build` EXIT 0 · error TS 0 · guard-invariants 85/86(전체 통과 표시) · health-check 101/101 · drivesync 1/1 · migrate-file-drive-sync 재실행 = «이미 있음» ×2 · 배포 슬롯은 PM2 reload 앞.

### 6.4 비차단 지적
1. **내려받기에 시간 제한이 없다**(`applyMirrorEdit` 의 `getFileStream`). 워크스페이스당 한 줄이라 Drive 스트림이 멈추면 그 워크스페이스의 동기화 전체가 서버 재시작까지 선다(전에는 웹훅마다 따로 돌았다). 꺼진 채로는 해당 없음 — **운영에서 켜기 전에** 멈춤 감시(예: N초 무수신이면 끊고 `edit_download_failed`)를 넣는다.
2. md5 없는 직접 지움(구글 문서로 변환된 사본 등) → 안 지우고 `drive_sync_issue` 도 NULL(실측). 설계 A-3x 는 «보류 표시» 다 — 화면이 말하지 않는 어긋남. `trash_held` 를 남긴다.
3. 휴지통 트랜잭션이 실패하면(교착 등) 원장 `skip/error` 만 남고 표시·다시 시도가 없다. 커서는 넘어간다. 끝 상태는 «PlanQ 에 남음» 이라 잃는 것은 없다.
4. `edit_quota`·`edit_too_large`·`edit_ext` 는 다시 시도하지 않는다(설계대로 `edit_download_failed` 만). 공간이 비어도 그 파일이 Drive 에서 다시 바뀔 때까지 «Drive 와 다름» 이 남는다 — 전체 대조(D-2 권고)와 같이 «다음 할 일».
5. 증빙 목록에 없는 `files.id` 참조: `post_revisions.attachment_file_ids`(옛 문서 판이 새 내용을 가리키게 됨) · `kb_documents.source_file_id` · `calendar_event_attachments` · `client_interactions` · `message_attachments` · `post_attachments` · `email_drafts`. 뒤 여섯은 «최신 내용» 이 뜻에 맞다. `post_revisions` 는 Irene 이 문서 옛 판의 첨부까지 동결하길 바라면 한 줄 더한다. 서명 스냅샷 술어는 숫자 `file_id` 만 맞는다(지금 쓰는 쪽이 숫자 — 문자열로 바뀌면 조용히 빠진다).
6. 확장자 검사는 PlanQ 이름 기준인데 같은 변경의 Drive 이름변경은 검사 없이 뒤에 반영된다(§4.4 의 기존 건 — `mime_type` 은 안 바뀐다).

### 6.5 확인 못 한 것
두 번째 구글 계정(편집자) 지움 · 맥 파인더 앱 저장의 Drive id 유지 · 운영 숫자 3개 · 화면 3폭(자체 검증 값을 다시 재지 않음 — 프론트 변경은 태그·문구뿐이고 빌드·API 칸만 확인) · 파일당 한도를 **스트림 도중** 넘기는 경로(메타 크기 경로만 확인) · D-2 크론 다시 시도의 실 Drive 왕복.
