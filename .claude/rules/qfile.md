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

