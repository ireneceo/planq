# 폴더 공유 링크 · 폴더째 첨부 — 설계 (운영 피드백 #469)

> 2026-10-29 · [Opus] 초안 → Fable 설계 판정 대기
> Irene «권고대로»(2026-10-29): Q 프로젝트 파일 탭·Q file 에서 **폴더 단위 공유 링크**를 만들고,
> 파일 첨부 «기존 파일·문서 검색해서 추가» 에서 **폴더째 첨부**할 수 있게.
> 새 공개(무인증) 주소가 생기므로 공유 다섯 규칙(`.claude/rules/security-detail.md`)·하위 항목 공개 범위·비밀번호·만료를 설계부터 정한다.

조사 때 HEAD: b80d00f2

---

## 0. 지금 있는 것 (사실)

| 것 | 어디 | 모양 |
|---|---|---|
| 폴더 | `file_folders` (business_id · project_id NULL=워크스페이스 · parent_id · name · gdrive_folder_id) | **공개 범위 칸 없음.** 폴더 목록은 멤버 이상 전원에게 보인다(`file_folders.js` GET). 지우면 **행 자체 삭제**(destroy, 안의 파일은 옮기거나 휴지통) |
| 파일 공개 범위 | `files.vlevel`(L1~L4, legacy `visibility`) · `target_member_ids` · `security_level`(general/internal/confidential) · project_id | 읽기 = `access_scope.canAccessFileByLevel` · 고객 받기 = `canDownloadFile` |
| 파일 공유 링크 | `files.share_token/shared_at/share_password_hash/share_expires_at` · `POST/DELETE /api/files/:id/share` · 공개 `GET /api/files/public/by-token/:token`(+ `/download`) · 화면 `/public/files/:token` | 발급 = 멤버 이상 ∧ `canAccessFileByLevel(발급자)` ∧ `!blocksExternalShare` · 비밀번호·만료 = `services/share_helper` · 하위 주소 서명 `shareSubQuery/verifyShareSub` · `workspaceAliveParam` |
| 공개 첨부 판정 | `shareOpenable.isPublicFile` = (L4) ∧ general | 문서·업무 공유가 첨부를 실을 때 |
| 첨부 «기존 파일 검색» | `AttachmentField.tsx` — `fetchWorkspaceFiles`(=`/api/projects/workspace/:biz/all-files`, 서버가 보는 사람 기준으로 거른 목록, `folder_id` 포함) 중 `source==='direct'` → `existingFileIds` | 서버 첨부 라우트는 **파일마다** `canUserSeeFile` 로 다시 본다(`task_attachments.js` 등 — 규칙 5 의 «붙일 때 원본 읽기 권한») |

---

## 1. 폴더째 첨부 (작은 쪽 — 화면만)

- 검색 셀렉트 옵션에 `[폴더] <경로> (N개)` 를 더한다. 폴더 목록 = 이미 화면이 쓰는 `GET /api/file-folders/workspace/:biz`.
- 고르는 순간 **그 폴더(+하위 폴더)의 파일 id 로 풀어** `existingFileIds` 에 넣는다 — **지금 그 시점의 파일 목록 사본**(첨부는 파일 연결이다. 폴더를 «살아 있게» 붙이는 것이 아님).
  풀린 파일은 각각 칩으로 보여 하나씩 뺄 수 있다. 셀렉트 값에는 폴더가 남지 않는다.
- 풀 재료 = `wsFiles`(이미 서버가 **보는 사람 기준**으로 거른 목록) — 내가 못 보는 파일은 애초에 없다. N 도 그 목록으로 센다.
- 서버 변경 0 — 첨부 라우트가 파일마다 읽기 권한을 다시 본다(규칙 5 그대로).
- 상한: 한 번에 100개 넘으면 앞 100개만 넣고 «폴더에 N개 중 100개만 넣었어요» 한 줄(실수로 큰 폴더를 통째로 붙이는 것 방지). 0개 폴더는 옵션에서 흐리게(«비어 있음»).
- 빈 검색(전체 보기)에서는 폴더 옵션을 파일 옵션 **위**에 둔다.

## 2. 폴더 공유 링크 (공개 주소 — Fable 판정 대상)

### 2-1. 저장
`file_folders` 에 칸 5개 — `share_token VARCHAR(64) NULL` (인덱스) · `shared_at` · `share_password_hash` · `share_expires_at` · **`shared_by INT NULL`**(발급자).
- 다른 자료와 같은 칸 이름 → `applyShareUpdate`·`checkShareExpiry`·`verifySharePassword`·`shareSubQuery`·`shareOffPatch` 를 그대로 쓴다.
- 폴더를 지우면 행이 없어지므로 링크도 같이 죽는다. 비밀 칸은 전역 toJSON(`models/index.js`)이 내리는 목록에 `share_password_hash` 가 이미 있음 — `share_token` 은 폴더 목록 응답에 실리면 **멤버 전원이 링크를 안다**(파일 목록은 지금도 토큰을 싣는가 → 구현 때 확인하고 폴더 목록은 `share_on: boolean` 만 싣는다).
- 운영 `scripts/migrate-folder-share.js`(멱등, 배포 슬롯).

### 2-2. 누가 만들고 끄나
- 멤버 이상(고객 X) ∧ 폴더가 프로젝트 폴더면 `canSeeProject(scope, folder.project_id)`.
- 끄는 사람 = 만들 수 있는 사람과 같은 술어(파일 0-J 선례).
- 감사 `file_folder.share_create` / `file_folder.share_revoke`(토큰 원문 X).

### 2-3. 링크로 무엇이 보이나 — **판정이 필요한 핵심**

폴더에는 공개 범위가 없고 안의 파일마다 범위·등급이 다르다. 그리고 폴더는 **계속 바뀐다**(남이 파일을 넣는다).

**선택지**
- **A. 살아 있는 내용 + 발급자 기준 + 외부 가능 파일만 (권고)**
  열 때마다 다시 계산: 폴더와 하위 폴더 안 `deleted_at NULL` 파일 중
  ① `security_level = general`(규칙 4) ② `vlevel ≠ L1`(나만 보기는 폴더 링크로 절대 안 나감 — 발급자 본인 것도) ③ **발급자가 지금 읽을 수 있는 것**(`canAccessFileByLevel(shared_by, f)` — 단건 파일 공유 발급 술어와 같음, 규칙 1)
  발급자가 워크스페이스에서 빠지면(멤버 아님) 링크 전체가 닫힌다(404).
  - 장점: 단건 파일 공유와 같은 선 · 파일을 L1/대외비로 바꾸면 그 순간 링크에서 빠짐(규칙 2 를 자동으로 지킴) · «폴더에 넣으면 고객에게 보인다» 는 Irene 가 기대하는 쓰임(납품 폴더).
  - 위험: 나중에 **남이** 넣은 L3 파일도 나간다 → 폴더 행·공유 창에 «이 폴더에 넣는 파일은 링크로 보입니다(나만 보기·대외비 제외)» 표시 + 폴더 목록 행에 공유 중 표시(🔗).
- B. 발급 순간 사본(파일 id 고정) — 이후 넣은 파일은 안 나감. 납품 폴더 쓰임에 안 맞고 «폴더 공유» 라는 말과 다르다.
- C. L4(«외부 공개») 로 표시한 파일만(`isPublicFile`) — 문서 공유 첨부와 같은 선. 가장 안전하지만 지금 파일 대부분이 L3 이라 **링크를 열면 비어 있다** → 사용자는 고장으로 읽음.

**하위 폴더**: 포함(재귀). 공개 화면에서 폴더 경로로 묶어 보인다. 하위 폴더를 따로 빼는 기능은 이번에 없음.
**보이는 칸**: 파일 이름·크기·종류·올린 날짜·미리보기 가능 여부. 올린 사람 이름 X(단건 공유는 싣지만 폴더는 여러 사람 — 실을 거면 표시명 `applyMemberDisplayName`). 설명·태그 X. 내부 출처(채팅·업무·메일) 파일은 `folder_id` 가 없어 원래 안 들어감.
**상한**: 한 링크에 파일 500개·하위 폴더 깊이 10 — 넘으면 앞부분만 + «더 있음».

### 2-4. 공개 주소 (새 라우터 `routes/file_folders_public.js`, `/api/file-folders/public`)
- `GET /:token` — 메타(폴더 이름·워크스페이스 이름·파일 목록·하위 폴더 경로) · 비밀번호면 `X-Share-Password` 헤더(링크당 15분 10회) · 만료 410 `share_expired` · 각 파일에 `download_qs`.
- `GET /:token/files/:fileId/download` (`?inline=1` 은 `fileServing.isSafeInline` 만) — **그 파일이 지금 2-3 집합에 드는지 다시 계산**(id 만 알면 받는 구멍 방지) · 비밀번호면 `verifyShareSub(folder, req, token, 'file:<id>')` · 바이트는 `attachmentStorage.readAttachmentBody`(Drive 포함 — 리다이렉트 X).
- `GET /:token/files/:fileId/thumb?w=` — 이미지 썸네일(`imageResize`), 같은 검사.
- `GET /:token/zip` — 전체 받기(같은 집합, 합계 상한 500MB, 넘으면 413 + 화면 안내), 서명 대상 `'zip'`.
- `GET /:token/auth-check`(로그인 사용자) — 멤버면 `appUrl` = Q file 그 폴더.
- `router.param('token', workspaceAliveParam([[FileFolder,'share_token']]))` — 하위 주소 전부.
- 공용 무인증 rate-limit 그대로 + zip 은 IP 당 분 3회.
- `shareOpenable` 에 `file_folder` 규칙 추가(카드 «열어보기» 와 공개 라우트가 같은 판정 — 발급자 멤버십 포함).

### 2-5. 화면
- 폴더 ⋯ 메뉴(Q file·프로젝트>파일, 같은 `FolderActions`)에 «공유 링크» → 기존 `ShareModal`(entityType `file_folder`: 링크 복사·만료 7/30/무기한·비밀번호. 채팅방·이메일 보내기 탭은 이번엔 X — `/api/share/*` 확장은 다음).
  창 안에 «안에 든 파일 N개가 링크로 보여요 · 나만 보기·대외비 M개는 빠져요» 를 서버가 센 숫자로.
- 공유 중인 폴더 행에 링크 아이콘. 끄기 = 창의 [링크 끄기](기존 `ShareRevokeDialog`).
- 공개 페이지 `/public/folders/:token` — `PublicPageShell` · 폴더 경로 묶음 목록 · 행마다 [받기]·미리보기(이미지/PDF) · [전체 받기] · 비밀번호 `SharePasswordPrompt` · 만료 `ExpiredShareLink` · `usePublicRevalidate`(60초·탭 복귀) · Smart Routing.
- i18n ko/en.

### 2-6. 규칙 대조
| 규칙 | 지킴 |
|---|---|
| 1 발급 = 읽기 술어 | 발급: 멤버 ∧ 프로젝트 보임. 내용: 파일마다 `canAccessFileByLevel(발급자)` — 단건 공유와 같은 함수 |
| 2 좁히면 끊는다 | 파일 L1·L2(발급자가 못 보게)·대외비로 바꾸면 다음 요청부터 빠짐(살아 있는 계산). 폴더 자체는 범위가 없어 끊을 일 없음 |
| 3 비밀번호 하위 주소 | 다운로드·썸네일·zip 모두 `verifyShareSub`, 대상별 서명 |
| 4 보안등급 | general 만 |
| 5 참조 | 폴더째 첨부 = 붙일 때 파일마다 서버 검사(기존) |
| 지운 워크스페이스 | `workspaceAliveParam` |
| 비밀값 응답 | 폴더 목록에 토큰 X(`share_on` 만), 해시는 전역 toJSON |

### 2-7. Fable 에게 묻는 것
1. 2-3 에서 A/B/C 중 무엇(또는 다른 선)? A 라면 L2(프로젝트 한정·지정 멤버) 파일도 «발급자가 볼 수 있으면» 나가도 되나, 아니면 L3·L4 만?
2. 발급자가 빠졌을 때 링크를 닫는 것이 맞나(대안: 워크스페이스 owner 기준으로 계속)?
3. 하위 폴더 포함·상한(500개·500MB) 이 맞나?
4. 폴더째 첨부를 «그 순간 사본» 으로 두는 것이 맞나?

## 3. 검증 계획
- 실HTTP(3003): 발급(멤버 200·고객 403·숨은 프로젝트 폴더 403) → 공개 메타에 L3 general 보임 / L1·대외비 안 보임 / 하위 폴더 파일 보임 → 파일을 L1 로 바꾸면 다음 요청에서 빠짐 · 그 파일 id 직접 다운로드 404 → 비밀번호: 헤더 없음 401·틀림 401·맞음 200·서명 다운로드 200·서명 없이 401 → 만료 410 → 링크 끄기 후 404 → 발급자 멤버 해제 후 404 → 워크스페이스 삭제 표시 후 404 → 다른 폴더 파일 id 로 다운로드 404(음성 대조군) → zip 내용 = 메타 목록.
- health-check secrets 에 «폴더 목록에 share_token 없음» 1건 · guard 전체 · build.
- 실브라우저 1440/834/390: 폴더 ⋯ → 공유 창 · 공개 페이지(목록·미리보기·전체 받기·비밀번호) · 첨부 셀렉트 폴더 옵션 → 칩 N개.

---

## 4. Fable 설계 판정 (2026-10-29 · VERDICT: DESIGN-READY) — 구현은 이것을 따른다

1. **2-3 = A, 단 L2 는 뺀다.** 술어 `shareOpenable.isFolderLinkFile(f, 발급자 scope)` = `canAccessFileByLevel(shared_by, f)` ∧ 보안등급 general ∧ `levelOf(f) ∈ {L3, L4, NULL}`. 발급자 본인 L1 도 빠진다. `isPublicFile`(문서·업무 첨부, L4 만)은 그대로 — 폭이 다른 이유를 주석으로.
2. **발급자가 빠지면 닫힌다** — 리졸버가 발급자 `isMemberOrAbove` + 프로젝트 폴더면 `canSeeProject` 를 본다 · 멤버 내보내기 때 그 사람이 연 폴더 링크 `shareOffPatch`. owner 기준으로 이어 가지 않는다.
3. 판정은 **`services/folderShare.js` 한 벌**(`resolveFolderShare` · `listFolderLinkFiles` · `folderLinkFileById`) — 공개 메타·받기·썸네일·zip·auth-check·공유 창 숫자가 모두 이것만.
4. 하위 폴더 포함 · 파일 500 · 깊이 10 · zip 500MB(시작 전 413) · «앞부분» 은 경로·이름 순 고정 · visited Set.
5. 폴더째 첨부 = 그 순간 사본, 서버 변경 0, 100개 상한(경로·이름 순).
6. 비밀번호 하위 주소: 받기·썸네일 = 서명 대상 `file:<id>`, zip = `zip`.
7. 만료 기본 30일(무기한은 고를 수 있음).
8. Drive 저장·자동 수집분도 나간다 — 공유 창에 «구글 드라이브에서 들어오는 파일도 보입니다» 반드시.
9. 발급·끄기 멤버 이상, 메뉴도 멤버만. 고객 폴더 목록에는 공유 칸 없음.

반드시 고칠 것: A 폴더 응답 전부 `services/folderResponse.serializeFolder` 화이트리스트(멤버: share_on·share_expires_at·share_password_set·shared_by / 고객: 없음) + health-check secrets 1건 · B 썸네일은 별도 접두어 `/api/file-folders/public-thumb/` + `IMAGE_PATHS` · C 실시간은 신호만 · D 공개 메타 파일 항목 화이트리스트 · E `shareExpiryNotify` 에 FileFolder · F `share_token` unique 인덱스, 운영 스크립트 멱등·배포 슬롯 · G 규칙 2 «끊는 사건» = 발급자 멤버 해제(+ 나중에 폴더 이동이 생기면 프로젝트 경계 이동).

범위 밖(따로 올림): `GET /api/files/:biz` 가 파일 행 `share_token` 을 멤버 전원에게 싣는다(기존).

### 4-1. 판정 1 정정 (Fable 2026-10-29, 같은 설계 판정의 정정 · VERDICT: DESIGN-READY)
새 사실: 프로젝트 폴더 업로드 기본값 = L2(프로젝트 한정), 워크스페이스 직접 업로드 기본값 = L1(`routes/files.js:677`). dev 최근 60일 폴더 안 파일 8건 전부 L2.
- (a) L2 중 **프로젝트 한정**(project_id ∧ 지정 멤버 없음)은 **싣는다** — 사람이 고른 값이 아니라 기본값이고, 그 프로젝트 고객이 이미 받는 파일이다. **지정 멤버 L2** 는 발급자가 목록에 있어도 뺀다. 프로젝트도 지정 멤버도 없는 L2 도 뺀다.
- (b) L1 은 **발급자 본인 것도 뺀다**(10-09 D2 보다 살아 있는 공개 링크가 넓어지지 않게).
- (c) 공유 창: «보임 N · 빠짐 M(나만 보기 a · 지정 멤버 b · 대외비 c)» + 내가 올린 나만 보기가 있으면 **[내 파일 a′개를 워크스페이스 공개로 바꾸기]**(기존 `PUT /api/files/:biz/:id/visibility` L3 를 파일마다, 확인창에 개수·«남의 파일은 바뀌지 않음»). 서버 새 표면 0.
- 판정 함수 `shareOpenable.folderLinkExcludeReason`(null = 실림) · `isFolderLinkFile`.
