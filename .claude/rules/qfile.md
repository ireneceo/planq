---
paths:
  - "dev-backend/routes/files.js"
  - "dev-backend/routes/file_*.js"
  - "dev-backend/routes/personal_drive.js"
  - "dev-backend/routes/personal_vault.js"
  - "dev-backend/routes/task_attachments*.js"
  - "dev-backend/routes/message_attachments.js"
  - "dev-backend/services/file*"
  - "dev-backend/services/drive*"
  - "dev-backend/services/gdrive*"
  - "dev-backend/services/googleShortcut.js"
  - "dev-backend/services/imageResize.js"
  - "dev-backend/services/attachment*"
  - "dev-backend/services/storage*"
  - "dev-backend/services/upload*"
  - "dev-backend/services/taskAttachment*"
  - "dev-frontend/src/pages/QFile/**"
  - "dev-frontend/src/pages/QProject/**"
  - "dev-frontend/src/components/Common/Attachment*"
  - "dev-frontend/src/components/Common/FilePicker*"
  - "dev-frontend/src/components/Common/DriveImport*"
  - "dev-frontend/src/components/Common/DownloadAll*"
  - "dev-frontend/src/pages/PersonalVault/**"
  - "scripts/ops-capacity-check.js"
  - "docs/FILE_SYSTEM_DESIGN.md"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 파일 저장·첨부·Q file 트리

## 파일 저장

- 경로: `/opt/planq/dev-backend/uploads/{business_id}/{yyyy-mm}/`
- 파일명: UUID로 변환 (원본 파일명은 DB에 저장)
- **파일당 용량 제한:** Free 10MB, Basic 30MB, Pro 50MB
- **플랜별 총 스토리지 쿼터:** Free 1GB / Basic 50GB / Pro 500GB (운영 기준)
- 허용 확장자: jpg, jpeg, png, gif, pdf, doc, docx, xls, xlsx, ppt, pptx, **hwp, hwpx**(한글, 2026-10-22), zip, txt

### SHA-256 dedup
- 업로드 시 `content_hash` 계산 → 동일 해시 존재하면 물리 파일 1개만 보관, `ref_count` 증가
- 삭제는 소프트 삭제 (`deleted_at`) + `ref_count` 감소. 0 도달 시 물리 파일 제거
- 외부 클라우드(gdrive) 연동 시 dedup 비활성 (외부 정책 위임)

### 파일 시스템 문서
- **설계:** `docs/FILE_SYSTEM_DESIGN.md` (스키마·API·UI·외부 연동 전 10섹션)
- **운영 로드맵:** `docs/OPS_ROADMAP.md` (Stage 0~4 임계치, 자동 경보 스크립트)
- **OPS 체크:** `scripts/ops-capacity-check.js` (주 1회, 가입자·용량 집계 + Stage 전환 감지)
- **UI 컴포넌트:** `pages/QProject/DocsTab.tsx` — scope prop 으로 프로젝트/워크스페이스 재사용

---

## 파일 첨부는 **통합 컴포넌트 한 곳**에 넣는다 (2026-09-07 박제)

> Irene: *"파일첨부할 때 구글드라이브에서 가져와서 첨부하게 노션처럼도 기능 추가해 달라고 했는데
> 이것도 파일첨부 통합 컨포넌트에 다 추가 못해?"*

첨부 입력은 `components/Common/AttachmentField.tsx` **하나**다(`FilePicker` 도 이것을 감싼다).
새 공급원(드라이브·클립보드·URL 등)은 여기 한 곳에 넣는다 — 화면마다 붙이면 업무엔 있고 메일엔 없는
상태가 된다. 현재 붙어 있는 것: 로컬 업로드 · 워크스페이스 기존 파일/문서 검색 ·
**개인 Google Drive 가져오기**(`DriveImportSection`).

- **Drive 에서 들인 것은 곧 PlanQ 파일이다** — 결과가 `existingFileIds` 에 그대로 들어가므로
  호출부는 아무것도 안 바꿔도 된다. 미리보기·공유·보존이 자체 업로드와 완전히 같아진다.
- **바이트를 우리가 쥔다.** `external_url`(Drive 링크)은 **연결한 구글 계정 본인에게만** 열린다
  (우리는 `permissions.create` 를 한 번도 부르지 않는다). 링크로 때우면 팀원에게는 안 열린다 —
  2026-09-03 에 공유 링크가 죽은 원인이 정확히 이것이다.
- **들이는 구현은 `services/driveImport.js` 하나다.** 워크스페이스 미러(`gdriveIngest`)와
  개인 첨부(`POST /me/drive/import`)가 같은 함수를 부른다. 베껴 두면 쿼터·dedup·감사 로그·
  실시간 브로드캐스트가 한쪽에만 남는다. 허용 확장자 목록도 여기 하나뿐이다.
- **drive.file scope** — PlanQ 가 만들었거나 사용자가 PlanQ 로 연 파일만 보인다. "내 드라이브에 있는데
  여기 없다" 가 정상이므로 **화면이 그 이유를 말한다**(빈 목록에 안내 문구).

### 붙은 첨부를 **보여주는** 것도 한 벌이다 (2026-10-02)
> Irene: *"이미지 누르면 이미지가 열리는데 리스트 누르면 우측 팝업이 또 뜨네 … 다운로드 링크가 리스트에 있어야지 …
> 전체 다운로드 버튼도 … 이미지 전체로 보다가 닫으면 팝업이든 우측패널이든 없어져. 안돼."*

- 목록은 `components/Common/AttachmentList.tsx`(`layout="rows"|"chips"`) — 이미지는 썸네일·이름 **어디를 눌러도 이미지 보기**,
  문서는 문서 미리보기, 그 외는 `AttachmentPreviewDrawer`. **행마다 내려받기**, 둘 이상이면 **「전체 다운로드」**.
  말풍선처럼 모양이 다른 곳(채팅·메일)은 `DownloadAllButton` 만 가져다 쓴다. 고객에게는 그리지 않는다(라우트가 멤버 이상).
- 「전체 다운로드」는 새 API 없이 `POST /api/files/:biz/bulk-download`(`task-`·`chat-`·`direct-` id).
  ★ 이 라우트는 **항목마다 단건과 같은 술어**를 본다(canDownloadFile·canAccessConversation·canAccessTask) — 2026-10-02 전까지
  business_id 만 봐서 남의 L1·남의 대화방 첨부가 zip 으로 나갔다(음성 대조군으로 확인). 저장소는 `readAttachmentBody`(Drive 포함),
  항목 스트림은 PassThrough 로 감싼다(열린 뒤 터지는 스트림이 zip 을 영영 안 끝냈다).
- **위에 뜬 창(이미지 보기·모달)을 닫는 Esc 는 아래 패널을 닫지 않는다** — 공용 `useEscapeStack` 만 쓴다. 스택이 처리한 Esc 는
  `escapeConsumedByOverlay(e)` 가 참이 되므로, 창(window)에서 Esc 를 따로 듣는 화면은 **그 함수를 먼저 부른다**(QTaskPage 선례).
- 업무에 올리는 새 파일은 **업무 첨부 라우트로 직접** 올린다(`/api/tasks/:id/attachments`). `/api/files` 로 올려 연결하면
  «올린 사람 L1» 원본 등급으로 판정돼 담당자에게도 이미지가 404 다(운영 #444).

## Q file 의 좌측 트리·썸네일·분류 (2026-09-20 박제)

### 트리는 **한 벌**이다
Q file(`ProjectGroups`)과 프로젝트>파일(`FolderTree`)은 **같은 행**을 쓴다 —
`docs/TreeRow.tsx`(구조) + `docs/treeStyles.ts`(규격) + `docs/folderDrop.ts`(드롭).
> Irene: *"이런 건 고치면 양쪽 다 제대로 통일해. 왜 각각 고쳐?"*

- **정렬 계약**: 전체 · 프로젝트(기본 폴더) · 채팅 · 업무 · 회의 · 문서 · 메일이 **같은 왼쪽 기준**.
  들여쓰는 것은 **사람이 만든 폴더뿐**이다. 회귀 `--suite filetree`.
- **액션은 칸이 아니라 겹침**이다(absolute). 칸으로 두면 고정폭은 넘치고 auto 는 숫자 열을 민다.
  **겹치는 순간 숫자는 물러난다** — 안 그러면 세 자리 숫자 알약이 버튼 왼쪽으로 삐져나온다
  (2026-09-20 실측 22px. 파일 129개인 프로젝트에서만 보여 «왜 거기만?» 이 된다).
- **행 안 버튼은 32px**(폰 40). 공용 `OverflowMenu` 트리거는 36px 이라 30px 행에서 부푼다 —
  `FolderActions` 안에서만 눌러 담는다. ★ 분기 조건을 `(hover: none)` 으로 잡지 말 것:
  **헤드리스가 hover:none 으로 뜨고 CDP 로도 안 뒤집힌다** → 그 분기는 영원히 미측정이 된다. 폭으로 가른다.

### 출처는 **태그**다 — 합이 전체와 다른 것이 정상
한 파일이 채팅·업무 양쪽에 걸리면 **양쪽에서 다 센다**(2026-09-07 결정).
운영 실측: 직접 126 + 채팅 9 + 업무 6 + 문서 1 = **142**, 전체는 고유 파일 **133**.
차이 9 는 «채팅에 올렸고 파일로도 잡힌» 같은 파일이다. **합을 맞추려면 태그를 배타 폴더로
바꿔야 하고, 그것은 다른 결정이다.** 숫자를 손보기 전에 이 차이를 먼저 설명할 것.

### 메일 첨부는 **빼지 말고 분류한다**
빼면 어디에도 안 보여 «없어졌다» 가 되고, 그냥 섞으면 «쓸데없는 파일이 너무 많아» 가 된다.
→ **«메일» 칸**에 둔다. 단, 첨부를 **고르는** 화면(`routes/files.js` 목록)에서는 계속 뺀다 —
거기엔 출처 칸이 없어 수백~수천 건이 쏟아진다(dev 실측 2,660건). **두 곳이 다른 것은 의도**이고
그 이유가 코드에 적혀 있어야 한다.

### 썸네일 — 서버가 빠른 것과 **화면이 빠른 것**은 다르다
`?w=` 리사이즈가 **로컬 파일에만** 걸려 있었다. Drive 저장분은 원본이 통째로 나갔다 —
운영 실측 **7.9MB → 8.1MB 전송·첫 바이트 0.84초**(같은 크기 로컬은 23KB·0.04초),
이미지 371장 중 **154장이 Drive**. 목록 한 번이 수백 MB 였다.
- **스트림도 리사이즈+디스크 캐시**한다(`imageResize.resizeStreamAndServe`).
- ★ **캐시가 있으면 바이트를 가지러 가기 전에 끝낸다**(`serveCachedIfPresent`) —
  Drive 왕복 자체가 0.8~1.0초라 캐시가 있어도 다녀오면 그 시간이 그대로 대기다.
- 배포 후 실측 **32KB · 0.039초(250배 감소)**.
- 화면 쪽: 전부 `loading="lazy"` 면 **화면 안에 있어도 낮은 우선순위**로 받는다.
  첫 화면 몫만 `eager`+`fetchPriority=high`. 운영 nginx 가 **HTTP/1.1**(연결 6개)이라 더 크게 걸린다.

### `.gdoc` 은 문서가 아니라 **172바이트 링크**다
> Irene: *"오픈을 하면 No preview available. 내가 공유한 아이디가 같은 드라이브인데 왜 이래?"*

접근 권한 문제가 아니다. 맥/윈도우 드라이브 폴더에서 끌어온 `.gdoc` 은 본문이 아니라 JSON 링크다.
그 «링크 파일» 의 Drive 주소를 열면 Drive 가 172바이트 JSON 을 미리보기하려다 실패한다.
- `services/googleShortcut.js` 가 안의 문서 id 를 읽고 **주소는 우리가 조립한다** —
  파일 안의 `url` 을 그대로 쓰면 **꾸며 넣은 임의 사이트로 보내는 링크**가 된다(음성 대조군 필수).
- 여는 문은 **하나**다(`docs/useFileOpen.ts`) — 헤더 [새 탭에서 열기] 와 미리보기 영역 클릭이
  같은 함수를 쓴다. 따로 열면 «버튼은 문서로 가는데 영역은 Drive 로 간다» 가 된다.
- "다운로드 후 확인" 은 여기서 **거짓말**이다(내려받아도 172바이트 JSON 이다).
- **읽는 문은 셋이고 함수는 하나다** (2026-10-25) — 파일함 `/api/files/:biz/:id/shortcut` · 업무 첨부 `/api/tasks/attachments/:id/shortcut` · 채팅 첨부 `/api/message-attachments/:id/shortcut` 가 모두 `googleShortcut.readShortcutFrom`(권한은 각자 내려받기와 같은 술어). 화면은 `PreviewArea` 가 주소를 안 받으면 스스로 읽는다 — 첨부 미리보기·크게 보기는 **내려받기 주소로 출처를 가른다**(`shortcutEndpointOf`, 첨부 미리보기 id 는 업무·채팅 모두 `task-`). 업무·채팅 첨부 허용 확장자에 `.gdoc` 등 5종(`uploadPolicy`).

### 끌기 — **우리 파일을 끄는 것은 업로드가 아니다**
페이지 껍데기가 **모든** 드래그에 업로드 오버레이를 띄우면, 오버레이가 안쪽을 덮어
**좌측 폴더가 드롭을 못 받는다**(이동 기능은 멀쩡한데 «아무 반응 없음» 으로 보인다).
`Files` 가 있고 전용 MIME 이 **없을 때만** 업로드다.
- 끌기 시작하면 놓을 수 있는 폴더에 **점선**(`body[data-pq-dragfile]`). 단 **옮길 수 있는 파일일 때만** —
  못 옮기는 파일에 점선을 켜면 거짓말이다.
- 놓으면 그 폴더가 **0.7초 반짝인다**(성공 토스트 금지의 대안 — 목적지가 말한다).
- **로컬 파일을 폴더 위에 바로** 올릴 수 있다(`useFolderDrop(onDropFiles, onDropExternal)`).
- ★ 좌측에서 **드롭을 받는 것은 폴더뿐**이다. 프로젝트 줄은 폴더 아이콘이지만 받지 않는다
  (파일→프로젝트는 `project_id` 변경 = **가시성 확대**라 Fable 판단 대기).

---


## Drive(파인더)에서 지우기·고치기 → PlanQ 반영 (2026-11-18 박제)

> Irene: *"지금 구글드라이브에 파일이 올라가기만 하고 삭제도 수정도 해당 파인더에서 할 수가 없으니 사실 무용지물인 상태야."*
> → «지움은 PlanQ 휴지통까지만, 고침은 새 내용·옛 판 보관» (권고대로) · Fable 설계 DESIGN-READY · 정본 `docs/GDRIVE_FINDER_EDIT_SYNC_DESIGN.md` §4

- **drive.file 로도 «PlanQ 가 올린 사본» 의 지움·고침은 보인다** — 반영하지 않던 것은 정책이었다. 새로 넣은 파일 들이기만 유료 심사(범위 밖).
- 판정·안전판은 `services/gdriveMirrorSync.js` **한 곳**. 지움 분기표(처음 맞는 것): removed → 미러 해제(접근 상실과 못 가름) ·
  산 행 ≥2(쌍둥이)·문서 본문 그림 → 미러 해제 · 폴더째 지움(`explicitlyTrashed≠true`) → 보류 `trash_held` · 10분 100건 → 보류 + 대표 알림 ·
  **고친 뒤 지움 → 고침 먼저, 못 받으면 보류(Drive 사본 = 안 받은 바이트의 유일본이라 안 지운다)** · 그 밖 → `trashFile` + Drive 사본 영구 삭제(커밋 뒤).
- 고침: 비교 기준은 `files.drive_md5`(미러 때 기록, 옛 행은 로컬 바이트 md5 — **NULL 을 «바뀜» 으로 읽지 않는다**). 새 바이트는 **항상 새 경로**(dedup 제자리 덮어쓰기 금지),
  옛 판 = 휴지통 행(`deleted_via='gdrive_edit'`, **하루 1판**). 쌍둥이·문서 그림·증빙(청구·급여·서명 스냅샷·메일 첨부)은 반영 안 함(`edit_not_applied`).
- 못 반영한 이유는 `files.drive_sync_issue` → 파일 목록 «Drive 와 다름» 태그. 지운 곳은 `files.deleted_via` → 휴지통 «Google Drive 에서 지움». 복구가 둘 다 지운다.
- **커서 → 변경 → 적용 → 커서 저장은 워크스페이스당 한 줄**(`services/gdriveSyncRun`) — 웹훅·크론이 같은 함수. 커서는 적용 **뒤** 저장. 프로세스 안 잠금이라 PM2 를 여러 개로 늘리면 DB 잠금으로 옮긴다.
- 끄는 스위치 `GDRIVE_FINDER_TRASH=0`(지움만 종전 미러 해제로). 회귀 `node scripts/health-check.js --category=drivesync`.
- ★ PlanQ 에 파일 바이트를 고치는 길을 새로 만들면 충돌 판정(§4.2 B-7)을 다시 연다.

## 파일 «연결된 곳» — 옮기면 안 끊기고, 끊기는 일은 알린다 (2026-11-25 박제)

> Irene: *"파일 위치를 이동하거나 해도 연결해둔 문서에서 끊기지 않게 하거나 꼭 구조상 끊어야 하면 알려줘야 할 것 같아 … 서로 어디에 연결되어 있는지 제대로 다 알게 통합적인 UI"* · Fable 설계 · 정본 `docs/FILE_USAGE_DESIGN.md`

- **사용처는 `services/fileUsage.js` 한 곳**(파일 상세 «연결된 곳» · 확인창 요약 · 감사 숫자). live(원본을 거쳐 열림: 문서 첨부·본문 그림·일정 미팅자료·project_refs·청구 증빙·연락처 사진) / copy(업무·채팅 첨부 — 경로 복사라 지워도 열림). **파일을 가리키는 새 칸을 만들면 여기 한 줄 더한다** — 안 그러면 지울 때 «0곳» 이라고 거짓말한다.
- 경로 비교는 `fileRefs.pathVariants`(두 표기). 본문 그림은 `imageCtx.bodyHasImage` 로 확정.
- **지우기·범위 좁히기는 막지 않고 알린다** — 확인창이 `UsageWarning`(단건·여러 개·폴더째)·`useNarrowConfirm`. 서버 409 를 넣지 않는다(Drive 동기화·폴더 삭제·내보내기가 같은 `trashFile` 을 쓴다).
- **문서 첨부 응답은 보는 사람 기준**(`services/postAttachmentView`) — 휴지통 = `state:'trashed'`, 못 읽음 = 빼고 멤버에게만 숫자, 고객은 흔적 없음. 첨부를 싣는 새 문서 응답은 이 함수를 부른다.
- 파일 삭제·범위 쓰기 AI 도구를 더하면 결과에 `fileUsage.summarize` 를 싣는다.
- 휴지통 파일은 어느 공개 문으로도 안 나간다(`shareOpenable.isPublicFile`).

## 파일 공개 범위 ≠ 프로젝트 소속 — 범위를 바꿔도 소속은 남는다 (2026-11-27 박제)

> Irene: *"파일을 특정프로젝트에서 특정멤버로 바꿨다가 다시 특정프로젝트로 옮기면 제대로 적용을 할 수가 없고 프로젝트 연결이 다시 안돼. 연결된 프로젝트는 그래도 끊기면 안되는데 끊겨 버리고"* · Fable 설계 A~D

- `vlevel` = 누가 보나 / `project_id` = 어디 소속(문서 2026-08-28 과 같은 원칙). `PUT /api/files/:biz/:id/visibility` 는 **명시한 `project_id` 로만** 소속을 바꾼다(null = 빼기 · 같은 워크스페이스 + 볼 수 있는 프로젝트만).
  L1/L3/L4 로 바꿔도 소속 유지. L2 에 대상이 없으면 소속이 있으면 그 프로젝트 L2, 없으면 «청중 없는 L2»(#378).
- **«특정 멤버»(L2 + `target_member_ids`)는 소속이 있어도 명단이 이긴다** — 판정 5곳이 같이 간다: 단건 `fileLevelAllows`(숨은 프로젝트 판정보다 먼저) · 목록 `fileListWhereByLevel`(프로젝트 L2 줄에 «명단 없음», 명단 줄은 `scopedOr` 밖) ·
  고객 `clientFileReadable`/`clientFileListWhere`(명단 L2 제외) · Drive 미러 `isEligible`(명단 L2 는 소속 무관 제외) · 색인 `fileIndex.indexability`(명단 L2 색인 안 함). 프로젝트 이력(`event_stream`)도 명단·올린 사람에게만. 명단 읽기는 `access_scope.fileMemberList` 한 함수.
  명단은 그 워크스페이스 활성 멤버만(고객 400).
- 화면(`DocsTab` 파일 상세): 라디오를 누르는 것만으로는 저장하지 않는다 — «특정 멤버» 는 1명 이상, «특정 프로젝트» 는 프로젝트가 정해졌을 때(소속이 있으면 바로 그 프로젝트). 저장 뒤 값은 서버 응답으로. 공용 `VisibilityField.applyVariant` 는 바꾸지 않았다(문서·업무가 같이 쓴다).
- 옛 버그로 빠진 소속: `node dev-backend/scripts/restore-file-project-from-audit.js`(읽기만 기본 · `--apply` 는 L1 만, 나머지는 목록 — 소속을 되돌리면 그 프로젝트 고객에게 열린다). 운영 `--apply` 는 Irene 지시 뒤.
- 회귀 = dev 왕복 스크립트(34항목, 커밋 안 함) + 양성 대조군(옛 access_scope 로 바꾸면 명단 밖 프로젝트 멤버가 보임으로 뒤집힘).
