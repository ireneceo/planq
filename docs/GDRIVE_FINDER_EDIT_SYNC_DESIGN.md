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
(대기)
