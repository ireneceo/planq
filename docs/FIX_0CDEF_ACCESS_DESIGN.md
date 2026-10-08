# 0단계 결함 수리 — 0-C·0-D·0-E·0-F 구현 설계 (Fable, 2026-10-08)

> 근거: `docs/FABLE_PRODUCT_AUDIT_2026-10-07.md` §C 0단계 표 · 결정 ①⑦⑨ · `docs/audit-2026-10-07/{content,shell,comms,revenue}.md` §5.
> 이 문서는 **설계만**이다. 소스는 손대지 않았다. Opus 가 이 명세대로 구현하고, 묶음마다 아래 «회귀 검사» 를 실제로 돌려 수치로 보고한다.
> 갈림길은 Fable 이 판정했다(Irene 위임). 판정과 이유는 각 항목 끝의 **▶ 판정** 에 적었다.
>
> 운영 실측(읽기, 2026-10-08): `RETENTION_PURGE_APPLY=1` · 서명 요청은 dev 24건 전부 `entity_type='post'` · 옛 Document 25건(공유 5·서명 5, 마지막 생성 2026-09-09).

| 묶음 | R | 게이트 | 스키마 변경 | 배포 단위 |
|---|:-:|---|---|---|
| 0-C 격리·가시성 | **1** | Fable | 없음 | 백엔드+프론트 **같이** |
| 0-D 휴지통 | **1**(비가역 삭제) | Fable | 없음(`purge_after` 이미 있음) | 백엔드 → 리포트 1일 → 플래그 |
| 0-E 관리자·메뉴 권한 | 0 | 자체 검증(F=1) | 없음 | 백엔드 → 프론트 |
| 0-F 초대 경로 | 0 | 자체 검증(F=1) | 없음 | 백엔드 → 프론트 |

공통 규칙(CLAUDE.md): 응답에 자격증명을 싣지 않는다 · 방송은 신호만(`{id, business_id}`) · 공유·참조 다섯 규칙 · 외부 발송은 받는 주소를 보여 주고 확인을 받는다 · 새 상태·새 문은 형제 문의 검사를 그대로 쓴다.

---

## 0-C. 격리·가시성 (R=1)

### C-1. 서명 토큰 — 직렬화에서 빼고, «URL 복사» 는 «링크 다시 보내기» 로

**지금**: `routes/signatures.js:659-689 serialize()` 가 `token`(:669)·`sign_url`(:670) 을 싣고, 진행표 `GET /api/posts/:id/signatures`(:295-310) 와 생성 응답(:284) 이 이것을 멤버 전원에게 내린다. 화면은 `SignatureProgressSection.tsx:120-126 onCopy` → `:304-307 «URL 복사»`. 멤버 라우트 7개(:111·:295·:314·:333·:350·:370·`signature_internal.js:31`)는 `assertMember`(:58-64, 워크스페이스 멤버면 통과)만 본다 — **남의 L1 문서**의 서명 목록·토큰·동결 본문(`GET /api/sign/:token`)까지 열린다.

**변경**

1. `routes/signatures.js serialize(sr, opts = {})`
   ```js
   // opts.withLink === true 일 때만 token·sign_url 을 싣는다 — 받는 사람 본인(received)뿐.
   function serialize(sr, { withLink = false } = {}) { … ...(withLink ? { token: sr.token, sign_url: `${APP_URL}/sign/${sr.token}` } : {}) … }
   ```
   - `:284 created.map(serialize)` · `:308 list.map(serialize)` → 링크 없음(기본값).
   - `:442 ...serialize(s)` (received — `where.signer_email = req.user.email`, 자기 열쇠) → `serialize(s, { withLink: true })`. `ReceivedSignaturesList.tsx:111,116,268` 은 그대로 동작.
2. 문서 술어를 멤버 라우트에 건다 — **새 술어를 만들지 않는다.**
   ```js
   const { canReadPost } = require('../services/postAccess');      // (user, post)  services/postAccess.js:15
   const { canEditPost } = require('./posts');                      // (userId, post, platformRole)  routes/posts.js:90 · export :1926
   /** sr → 그 문서. entity_type 이 'post' 가 아니면 null(옛 Document 서명은 멤버 라우트에서 404). */
   async function postOfRequest(sr) { return sr.entity_type === 'post' ? Post.findByPk(sr.entity_id) : null; }
   ```
   | 라우트 | 줄 | 추가 검사 | 거절 |
   |---|---|---|---|
   | `POST /posts/:id/signatures` | :111-118 | `assertMember` 유지 **+** `canEditPost(req.user.id, post, req.user.platform_role)` | 403 `forbidden` |
   | `GET /posts/:id/signatures` | :295-300 | `canReadPost(req.user, post)` | 403 |
   | `GET /posts/:id/signature-scope` | :314-320 | `canEditPost` (요청 생성과 같은 문) | 403 |
   | `GET /signatures/:id/image` | :333-340 | `post = postOfRequest(sr)` 없으면 404 · `canReadPost` | 403 |
   | `DELETE /signatures/:id` | :350-357 | `sr.requester_user_id === req.user.id` **또는** `canEditPost` | 403 |
   | `POST /signatures/:id/reminder` | :370-377 | 위와 같음 | 403 |
   - `signature_internal.js:31-41` 은 이미 서명자 본인(`signer_user_id || requester_user_id`)만 통과 — 무변경.
3. 재발송은 **확인창 + 받는 주소**(CLAUDE.md «외부 발송은 확인을 받는다»). 지금 `:308-311 onRemind` 는 누르는 즉시 메일이 나간다.
4. 화면 `SignatureProgressSection.tsx`
   - `:304-307` «URL 복사» `MenuItem` **삭제**, `onCopy`(:120-126)·`copiedToken` state 삭제.
   - `:308-311` «재발송» → 라벨 `signProgress.resendLink`, 클릭 시 `ConfirmDialog`(공용 `components/Common/ConfirmDialog`) → 확인하면 기존 `remindSignature(sr.id)`.
   - `services/posts.ts:516-517` `token`·`sign_url` 을 `token?: string; sign_url?: string;`(received 에서만 옴) 로. `QTalk/types.ts:45` 그대로(이미 안 읽는다, `ChatPanel.tsx:1653`).
   - 문구(`qdocs` ns 또는 이 컴포넌트가 쓰는 ns):
     | 키 | ko | en |
     |---|---|---|
     | `signProgress.resendLink` | 링크 다시 보내기 | Resend link |
     | `signProgress.resendConfirm.title` | 서명 링크를 다시 보낼까요? | Resend the signing link? |
     | `signProgress.resendConfirm.desc` | {{email}} 로 서명 링크 메일을 다시 보냅니다. | A new signing link will be emailed to {{email}}. |
     | `signProgress.resendConfirm.ok` | 보내기 | Send |

▶ **판정**: `POST /api/sign/request-link`(`signature_public.js:211`) 는 **쓰지 않는다.** 그 문은 무인증·IP 레이트리밋·열거 방지(«명단에 없어도 같은 응답»)로 설계된 *받는 사람용* 문이다. 멤버가 요청자로서 다시 보내는 것은 이미 있는 인증 라우트 `POST /signatures/:id/reminder` 의 일이고, 거기에 빠져 있던 것은 확인창뿐이다. «내 메일로 받기» 별도 버튼은 두지 않는다 — 보내는 쪽 멤버(`party='us'`)는 메일 링크가 없고 앱 안 [서명하기] 로 서명한다(2026-09-22 계약).

**회귀 검사** — `scripts/health-check.js` `secrets` 카테고리에 추가(`defineSecretTests` :1183 아래), 하니스 패턴은 기존 «고객 응답에 초대 토큰» 검사(:1188-1208)와 같다.
- `secrets` «서명 진행표·생성 응답에 토큰이 없다»: 픽스처 L3 문서 1건 + `POST /posts/:id/signatures`(signers 1, 외부 메일) → 생성 응답·`GET /posts/:id/signatures` 원문 문자열에 `"token"`·`sign_url`·실제 토큰(DB 에서 읽은 64자) 0건. **대조군** `signer_email`·`status` 는 있다. 끝나면 요청 행 삭제.
- `secrets` «받는 사람 본인에게는 자기 링크가 온다»(양성): 같은 요청을 `signer_email = ctx 사용자 이메일` 로 만들고 `GET /signatures/received` 에 그 토큰이 **있다**(없으면 받는 목록의 [서명하기] 가 죽는다).
- 신규 카테고리 `signauth`: 멤버 B(작성자 아님)가 A 의 **L1** 문서에 `GET /posts/:id/signatures` → 403, `POST /posts/:id/signatures` → 403, A 가 만든 요청 `DELETE /signatures/:id` → 403; **대조군** 같은 B 가 L3 문서에는 200. 전부 CLAUDE.md «읽기 403 = 서명 403» 대조.
- e2e `--suite signature`(기존 16검사)에 ① 진행표 ⋯ 메뉴에 «URL 복사» 글자 0 ② «링크 다시 보내기» 클릭 → `[aria-modal="true"]` 확인창에 **받는 주소 문자열이 있다** ③ 확인 전 `reminder_count` 불변, 확인 후 +1.

### C-2. 영업 단계·고객 방송은 신호만

**지금**: `services/salesStage.js:76` `emit('client:updated', client.toJSON())` — `invite_token`·`lost_note`·`expected_amount` 까지 멤버 전원(qsale 권한 none 포함)에게. 같은 계열이 하나 더 있다: `routes/clients.js:10-16 broadcastClient()` 도 `client.toJSON()` 통째다(`:240` 등). 같은 파일군의 다른 방송은 전부 `{ id, business_id }`(`saleCommon.js:25`, `sale.js:284`, `invites.js:199`).

**변경**
- `salesStage.js:76` → `emit('client:updated', { id: client.id, business_id: client.business_id })`.
- `clients.js:10-16` → `const data = { id: client.id, business_id: client.business_id || Number(req.params.businessId) }`.
- 받는 화면은 전부 다시 읽는다(확인함): `SalePage.tsx:164-165`·`SaleDetailPage.tsx:145`·`ClientPanel.tsx:171`·`ClientsPage.tsx:225-227`·`QProjectDetailPage.tsx:528` 모두 `debounced reload` — payload 를 읽는 곳 **0**. 화면 변경 없음.

**회귀 검사** — 가드 `--category=broadcast`(기존)가 `toJSON()` 방송을 잡는지 확인하고, 안 잡으면 그 검사기에 패턴 `emit\([^)]*\.toJSON\(` 을 추가(양성 대조군: 고치기 전 코드로 2건 FAIL). health-check `secrets` «단계 변경 방송 원문에 invite_token 없음»: 소켓 클라이언트로 `business:{id}` 방에 들어가 `PUT /api/sale/:biz/clients/:id/stage` 호출 → 받은 payload 키가 `{id,business_id}` 뿐.

### C-3. Q info — 등급 변경·공유 해제는 «볼 수 있는 사람» 만, 검색은 고객 차단

**지금**: `routes/kb.js:1463-1480 DELETE /kb-documents/:id/share` · `:1483-1507 PUT /kb-documents/:id/security-level` 이 `isMemberOrAbove` 만 — 멤버가 남의 L1 항목 등급 변경·공유 해제. 문서 수정 `PUT …/documents/:docId`(:509-520) 는 이미 `canAccessKbDocumentByLevel` 을 건다. `POST …/kb/search`(:1416) 는 목록(:82-84)과 달리 client 를 안 막는다.

**변경**
- `:1468` 과 `:1490` 바로 아래에 공유 발급(:1440-1441)과 **같은 두 줄**:
  ```js
  if (!(await canAccessKbDocumentByLevel(req.user.id, doc, scope))) return errorResponse(res, 'forbidden', 403);
  ```
- `:1416` 핸들러 첫 줄에 `if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);`(목록 :84 와 같은 문장).

▶ 판정: 거절 코드는 형제 문(공유 발급 :1441)과 같은 **403** 으로 맞춘다(문서 PUT 의 404 와 다르지만 이 블록 안에서 한 벌이 우선).

**회귀 검사** — health-check 신규 `kbauth`: 멤버 B 가 A 의 L1 Q info 에 `PUT security-level` → 403 · `DELETE share` → 403 · 고객 계정 `POST kb/search` → 403; **대조군** B 가 자기 L1 에는 200, A 가 L3 에는 200. 끝나면 픽스처 삭제.

### C-4. 폴더 «같이 삭제» — 안의 파일마다 단건 삭제와 같은 술어, 해제 멤버 차단

**지금**: `routes/file_folders.js:17-21 assertMemberWrite` 가 `removed_at` 을 안 보고(정본 `access_scope.js:60-62` 는 본다) 역할도 안 본다(`ai` 통과). `DELETE /:id?contents=delete`(:258-296) 는 안의 파일을 `trashFile` 로 전부 보내는데 단건 `DELETE /files/:biz/:id`(:1385) 는 `canMutateFile`(:952-968: 본인·owner·PM·platform_admin) 을 본다.

**변경**
```js
// file_folders.js:17-21 교체 — 정본 scope 로 판정(removed_at·ai 반영). 호출부 7곳(:101,:133,:167,:215,:262 …) 시그니처 유지.
async function assertMemberWrite(userId, businessId, platformRole) {
  const scope = await getUserScope(userId, businessId, platformRole);   // 이미 import 됨(:7)
  return isMemberOrAbove(scope) ? scope : null;                          // truthy = 통과, scope 를 돌려준다
}
```
- `:258 DELETE /:id`: `const scope = await assertMemberWrite(...)` 로 받아 두고, `mode === 'delete'` 분기(:293-296)에서 **지우기 전에** 전수 판정:
  ```js
  const { canMutateFile, trashFile } = require('./files');
  const shim = { user: req.user, businessRole: scope.businessRole };     // canMutateFile 이 req 모양을 읽는다(:953-955)
  const blocked = [];
  for (const f of inside) if (!(await canMutateFile(f, shim))) blocked.push(f.id);
  if (blocked.length) { await t.rollback(); return res.status(403).json({ success: false, message: 'folder_has_files_you_cannot_delete', blocked_count: blocked.length }); }
  for (const f of inside) await trashFile(f, req, t, mirrorQueue);
  ```
- 화면(`DocsTab.tsx` 폴더 삭제 확인창 · `docs/FolderTree` 쪽 같은 창): 403 `folder_has_files_you_cannot_delete` 를 받으면 확인창 안에 문구를 띄우고 「파일은 상위 폴더로 옮기기」(= `contents=move`)만 남긴다.
  | 키(`qproject` ns) | ko | en |
  |---|---|---|
  | `docs.folderDelete.blocked` | 삭제 권한이 없는 파일이 {{n}}개 있어 함께 삭제할 수 없습니다. 파일을 상위 폴더로 옮기고 폴더만 삭제할 수 있습니다. | {{n}} file(s) in this folder can’t be deleted by you. You can move the files to the parent folder and delete only the folder. |

▶ 판정: 일부만 지우고 나머지는 옮기는 «섞인 결과» 는 만들지 않는다 — 사용자가 고른 것은 «폴더째 삭제» 하나이고, 절반만 되면 어디로 갔는지 또 추적해야 한다(2026-09-24 사례). 원자적으로 거절하고 이유와 대안을 말한다.

**회귀 검사** — health-check 신규 `folderauth`: 멤버 B 의 폴더에 A 가 올린 파일 1건 + B 파일 1건 → B 가 `DELETE /api/folders/:id?contents=delete` → 403 + `blocked_count:1`, 두 파일 모두 `deleted_at IS NULL`(**아무것도 안 지워짐**); **대조군** 폴더에 B 파일만 있을 때 200 + 그 파일 `deleted_at` 찍힘; **해제 멤버**(`removed_at` 세팅) `POST /api/folders/workspace/:biz` → 403.

### C-5. 위키 공개 이미지 — 정확 매치

**지금**: `routes/wiki.js:236-240` `LIKE '%"file_id":12%'` 가 `"file_id":123` 에도 참 → 무인증으로 file 12 서빙. `body_ko/body_en` 은 `DataTypes.JSON` 블록 배열(`models/HelpArticle.js:46-55`).

**변경**
```js
const referenced = await HelpArticle.findOne({
  where: {
    is_published: true,
    [Op.or]: [
      sequelize.literal(`JSON_CONTAINS(body_ko, JSON_OBJECT('type','image','file_id', ${fid}))`),   // fid 는 위에서 정수 검증(:234)
      sequelize.literal(`JSON_CONTAINS(body_en, JSON_OBJECT('type','image','file_id', ${fid}))`),
    ],
  }, attributes: ['id'],
});
```
(MySQL 8: 후보 객체는 배열 원소 중 하나에 **포함**되면 참 — 블록이 `caption` 등 다른 키를 더 가져도 매치.) `file_id` 가 문자열로 저장된 옛 블록이 있는지 배포 전 SELECT 로 확인(`JSON_SEARCH(body_ko,'one','%','file_id')`), 있으면 `OR JSON_CONTAINS(body_ko, JSON_OBJECT('file_id','${fid}'))` 를 덧붙인다.

**회귀 검사** — health-check `wiki` 카테고리에 «이미지 서빙은 정확한 file_id 만»: 발행 글 픽스처에 `{type:'image', file_id: X}`(X 는 두 자리 이상 id) 만 넣고 `GET /api/wiki/image/${String(X).slice(0,-1)}` → 404, `GET /api/wiki/image/X` → 200(대조군).

### C-6. 옛 Document 공개 서명 제거

**지금**: `routes/docs.js:888-955 POST /public/:token/sign` — OTP·레이트리밋·이메일 검증 없음. 화면은 `pages/QDocs/PublicDocPage.tsx:63-90 submitSign` + 서명 폼. dev 실측: 서명 요청 24건 전부 `post`, Document 는 25건(마지막 생성 09-09, Cue `services/actions/document_actions.js:44 Document.create` 가 아직 만든다).

**변경**
- `docs.js:883-955` 라우트 **삭제**(공개 조회 `GET /public/:token` 은 유지 — 공유 링크로 보기는 계속 된다).
- `PublicDocPage.tsx`: `submitSign`·서명 폼·[서명]/[거절] 버튼·`signOpen/signing/signedDone/signError/signerName/signerEmail/signNote` state 삭제. 이미 `signed_at` 이 있는 문서의 서명 표시(읽기)는 그대로. `usePublicRevalidate` 의 `enabled` 를 `!!doc` 로.
- 안내 문구(`qdocs` ns) — 서명이 필요한 문서는 Q docs 서명 요청으로: `public.signMoved` ko «이 문서는 보기 전용입니다. 서명이 필요하면 보낸 분께 서명 요청 링크를 요청해 주세요.» / en «This document is view-only. If a signature is needed, ask the sender for a signing link.»

▶ 판정: «Cue 의 Document 생성을 Post 로» 는 이 묶음에서 **하지 않는다.** 그것은 Cue 문서 초안의 저장소를 바꾸는 S=1 설계(템플릿 슬롯·버전·공유 토큰의 이관)라 0-C 의 «무인증 표면 닫기» 와 범위가 다르다. 공개 서명 라우트와 화면을 없애면 무인증 쓰기 표면은 0 이 되고, 남는 것은 인증된 멤버의 공유 링크 보기뿐이다. Document→Post 이관은 1단계 1-11(Cue 결과물) 에 붙인다.

**회귀 검사** — health-check `public` 계열: `POST /api/docs/public/<살아있는 share_token>/sign` → 404(라우트 없음, Express 기본). e2e: `/public/docs/:token` 에 `button:has-text("서명")` 0건, 본문은 그려진다(대조군). 가드 `--category=duproute`·`routedrift` 통과.

### C-7. 상담 메모(이메일 스레드) — 개인 메일 격리

**지금**: `routes/sale_interactions.js:111-124 resolveConsultTarget(businessId, kind, id)` 의 `email_thread` 분기가 `business_id` 만 본다. 같은 파일군 `sale_save.js:78-82` 는 `accessibleAccountIds` 로 `account_id` 를 건다.

**변경**
```js
// :111 시그니처에 userId 추가 — 호출 3곳(:126·:146·:167) 모두 req.user.id 를 넘긴다
async function resolveConsultTarget(businessId, kind, id, userId) {
  …
  if (kind === 'email_thread') {
    const { accessibleAccountIds } = require('../services/mailIdentity');          // services/mailIdentity.js:16 — 정의는 이 한 곳
    const acctIds = await accessibleAccountIds(businessId, userId);
    const t = await EmailThread.findOne({ where: { id, business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } }, attributes: ['id', 'project_id'] });
    …
```
**회귀 검사** — health-check 신규 `mailscope`: 멤버 A 의 **개인 메일 계정**(`owner_user_id = A`) 스레드 id 로 멤버 B 가 `GET /api/sale/:biz/consults/email_thread/:id/notes` → 404 `consult_not_found`, `POST` → 404; **대조군** 공용 계정(`owner_user_id NULL`) 스레드에는 B 도 200.

### C-8. `routes/clients.js` 에 `requireMenu('clients', …)`

`middleware/menu_permission.js:38-41` 에 `clients` 키는 이미 있다. `sale.js:4` 체인과 같은 자리(`checkBusinessAccess` 다음)에 넣는다. `businessId` 는 전 라우트 `req.params.businessId` 로 온다.

| 줄 | 라우트 | 레벨 |
|---|---|---|
| :35 | `GET /:businessId` | read |
| :62 | `GET /:businessId/:clientId/removal-impact` | read |
| :86 | `GET /:businessId/:clientId/timeline` | read |
| :102 | `GET /:businessId/:clientId/channel-summary` | read |
| :116 | `POST /:businessId` | write |
| :157 | `GET /:businessId/:id` | read |
| :208 | `PUT /:businessId/:id` | write |
| :252 | `GET /:businessId/:id/history` | read |
| :277 | `POST /:businessId/invite` | write |
| :384 | `POST /:businessId/:id/resend-invite` | write |
| :421 | `POST /:businessId/:id/archive` | write |
| :445 | `DELETE /:businessId/:id` | write |
| `client_links.js:22` | `GET /:businessId/:clientId/qnotes` | read (13번째 — 같은 접두어, 앞에 마운트 `server.js:525`) |

**회귀 검사** — health-check 신규 `clientsmenu`: 멤버 B 에 `business_member_permissions(clients='none')` 행을 넣고 `GET /api/clients/:biz` → 403 `forbidden_menu_hidden`, `'read'` 로 바꾸면 GET 200 · `POST /:biz/invite` 403 `forbidden_read_only`; 행 삭제(기본 write) → 둘 다 통과(대조군). 끝나면 행 삭제.

### C-9. `health-check --category=secrets` 확장 — 위 C-1·C-2 두 검사 + 아래 하나
- «AI 에이전트·검색 응답에 서명 토큰 없음»: `GET /api/search?q=` 통합검색 결과 원문과 `get_document` 도구 응답 원문에 `sign_url` 0건(토큰 이동 경로 전수).

### 0-C 배포 순서·롤백
1. 배포 전 SELECT(운영, 읽기): ① `SELECT COUNT(*) FROM signature_requests WHERE entity_type<>'post'`(0 이어야 C-6·C-1 의 404 분기가 실데이터를 안 건드린다) ② 위키 `JSON_SEARCH` 로 문자열 file_id 블록 수 ③ `documents` 공유 토큰 살아 있는 수(공개 보기 유지 확인용).
2. 백엔드+프론트 **한 번에** 배포(프론트의 «URL 복사» 가 사라져야 토큰 제거가 화면 고장으로 보이지 않는다). 마이그레이션 없음.
3. 롤백: `git revert` 한 커밋. 데이터 변경 없음. 단 C-6 삭제 라우트는 되살려도 OTP 없는 표면이 돌아오므로 되살리지 않는다(화면만 되돌릴 일 없음).

---

## 0-D. 휴지통 보관 — 플랜 일수 + 30일 하한, 문서·정보도 같은 cron

**지금**: 파일은 `services/uploadCleanup.js:29-93` 이 `RETENTION_PURGE_APPLY=1`(운영 켜짐) 로 플랜 일수를 쓴다. 플랜 값 `config/plans.js` free **7**(:30) · starter **14**(:63) · basic 30 · pro 90 · enterprise 365. 문서·정보는 `purge_after` 스탬프(`posts.js:1101-1103`, `kb.js:678-680`)와 화면 만료 표시(`content_trash.js:28-31`)까지만 있고 **지우는 cron 이 없다.** 문구 `qproject.json:591 deleteChoiceTrash`·`:684 descOverwrite`(ko/en) 는 «30일» 하드코딩(`descTrash` :531 은 이미 «요금제에 따라»). 약관 `legal.json:54`(ko, en 대응 줄) 은 «14~365일».

**변경**
1. **하한은 두 겹** — 값과 래칫.
   - `config/plans.js:30` free `trash_retention_days: 7 → 30`, `:63` starter `14 → 30`. (PlanSettings.tsx:472 가 카탈로그 값을 그대로 보여 주므로 요금제 화면도 같이 맞는다.)
   - `services/retentionPolicy.js:42-70 resolveRetention` 끝에 `kind === 'trash'` 면 `days = Math.max(days, TRASH_MIN_DAYS)`(`const TRASH_MIN_DAYS = 30;` export). 누가 plans.js 를 다시 7 로 내려도 지우는 쪽은 30 아래로 안 간다. 스탬프(`stampFor`)·화면 `retention_days`·cron 이 모두 이 함수를 지나므로 **한 곳**이다.
2. **문서·정보 purge 를 같은 체인에** — 새 파일 `services/contentTrash.js`
   ```js
   /** 영구삭제 한 벌 — 라우트(content_trash.js:166-186)와 cron 이 같은 함수를 쓴다. */
   async function purgeContentRow(kind, row, { transaction } = {})   // kind 'post' → PostAttachment.destroy({where:{post_id}}) · 'kb' → KbChunk.destroy({where:{kb_document_id}}) · row.destroy({force:true})
   /** uploadCleanup.runUploadCleanup 과 같은 모양·같은 플래그. */
   async function runContentTrashPurge(today = new Date())
     → candidates: Post / KbDocument  { paranoid:false, where:{ deleted_at: {[Op.ne]:null} }, limit 2000, order deleted_at ASC }
     → biz 별 resolveRetention(biz,'trash')  · 못 읽으면 skipped[reason]++ 보존
     → expired = isExpired(row.purge_after, row.deleted_at, ret.days, today)
     → apply = process.env.CONTENT_TRASH_PURGE_APPLY === '1'   (★ 파일과 **별도 플래그**, 아래 판정)
     → apply 면 트랜잭션마다 purgeContentRow + AuditLog(action 'post.purge'|'kb.document_purge', userId null, oldValue {title}) · 아니면 센다
     → return { mode, scanned, removed, failed, skipped, would_remove }
   ```
   - `routes/content_trash.js:166-186` 의 삭제 본문을 `purgeContentRow` 호출로 바꾼다(동작 무변경).
   - `server.js:696-699` 바로 아래에 같은 try/catch 로 `runContentTrashPurge()` 호출 + `console.log('[content-trash]', r)`.
3. 문구 — 숫자는 **플랜값 보간**, 없으면 일반 문장.
   - 새 훅 `hooks/useTrashRetentionDays(businessId)`: `services/plan.ts:152 fetchStatus` 의 `limits.trash_retention_days`(60초 캐시, `usePlan` 계열이 이미 있으면 그것을 재사용) → `number | null`.
   - `DocsTab.tsx:1946·1970·1996` 과 `deleteChoiceTrash` 를 쓰는 폴더 삭제 창(`pages/QProject/docs/useFolderEditing.tsx`): `days != null ? t('…WithDays', {days}) : t('…')`.
     | 키(`qproject` ns) | ko | en |
     |---|---|---|
     | `docs.confirmDelete.descTrashWithDays` | 삭제한 파일은 휴지통으로 이동합니다. {{days}}일 안에 되돌릴 수 있습니다. | Deleted files move to the trash. You can restore them within {{days}} days. |
     | `docs.folderDelete.deleteChoiceTrash` (:591 교체) | 「파일도 함께 삭제」를 고르면 파일도 휴지통으로 갑니다. 요금제에 따라 정해진 기간 안에 되돌릴 수 있습니다. | “Delete files too” sends the files to the trash. You can restore them within the period set by your plan. |
     | `docs.folderDelete.deleteChoiceTrashWithDays` | … {{days}}일 안에 되돌릴 수 있습니다. | … within {{days}} days. |
     | `docs.dup.descOverwrite` (:684 교체) | 「덮어쓰기」는 새 파일을 올리고 이전 파일을 휴지통으로 보냅니다. 요금제에 따라 정해진 기간 안에 되돌릴 수 있습니다. | Overwrite uploads the new file and sends the previous one to the trash. You can restore it within the period set by your plan. |
     | `docs.dup.descOverwriteWithDays` | … {{days}}일 안에 되돌릴 수 있습니다. | … within {{days}} days. |
   - `legal.json:54`(ko) «플랜별 14~365일» → «플랜별 30~365일»(en 대응 문장도). 약관 **버전은 올리지 않는다** — 보관을 **늘리는** 변경이라 재동의 대상이 아니다(사용자에게 불리하지 않음).

▶ **판정** ① 결정 ①(a)+30일 하한을 그대로 따른다. 운영이 이미 `RETENTION_PURGE_APPLY=1` 이라 free/starter 7·14일 파일이 **지금** 지워지고 있다 — 이 묶음은 그것을 늘린다(즉시 안전). ② 문서·정보 cron 은 **별도 플래그 `CONTENT_TRASH_PURGE_APPLY`** 로 켠다. 파일 cron 과 같은 플래그로 묶으면 배포 직후 자정에 리포트 없이 바로 지운다 — 되돌릴 수 없는 삭제의 첫 회차는 반드시 숫자를 먼저 본다(retentionPurge 와 같은 절차). 리포트 1일 뒤 켠다. ③ `purge_after` 가 NULL 인 옛 행(2026-09-04 이전 삭제)은 `effectiveExpiry` 가 현재 플랜 일수로만 계산한다 — 그 행들도 지워진다. 그것이 화면이 보여 온 계약(«만료» 표시)과 같으므로 그대로 둔다.

**회귀 검사**
- health-check `retention` 카테고리 추가: «모든 플랜 trash_retention_days ≥ 30 **그리고** `resolveRetention(biz,'trash').days ≥ 30`»(plans.js 를 7 로 되돌린 양성 대조군에서 둘째 단언이 잡아야 한다 — 값만 보면 래칫이 없는 코드도 통과한다) · «콘텐츠 휴지통 회차가 만료 합성 행을 지운다»: `deleted_at = now-400d, purge_after = now-1d` 인 Post 1건·KbDocument 1건을 만들고 `runContentTrashPurge({apply:true})` 를 직접 호출 → 두 행 `paranoid:false` 로도 없음 + AuditLog 2행; **음성 대조군** `deleted_at = now-1d` 행은 남는다 · «라우트와 cron 이 같은 함수»: `routes/content_trash.js` 에 `destroy({ force: true })` 직접 호출 0건(grep).
- e2e `--suite`(기존 휴지통 검사가 있으면 거기, 없으면 `trashcopy` 신규): 파일 삭제 확인창 문구에 **숫자**가 있고 그 숫자 == `GET /api/files/:biz/trash` 의 `retention_days`; `PlanSettings` 의 free 카드 숫자 == 30.

### 0-D 배포 순서·롤백
1. 배포 전 운영 SELECT: `SELECT COUNT(*) FROM posts WHERE deleted_at IS NOT NULL` · 같은 것 `kb_documents` · 그중 `purge_after < NOW()` 수. 이 숫자가 1일차 리포트의 `would_remove` 와 맞아야 한다.
2. 백엔드 배포(플랜값·래칫·cron 리포트 모드). PM2 재시작 뒤 `[content-trash] mode=report would_remove=N` 로그 확인(자정 체인 — 바로 보려면 `node -e "require('./services/contentTrash').runContentTrashPurge().then(console.log)"`).
3. 다음 날 리포트 수치가 1번과 맞으면 `.env` 에 `CONTENT_TRASH_PURGE_APPLY=1` → 재시작. 첫 적용 회차 로그를 작업기록에 적는다.
4. 롤백: 플래그 제거(삭제 중단). 지워진 행은 복구 불가 — 그래서 2·3 을 나눈다. 플랜값 롤백은 코드 revert(보관이 짧아지는 쪽이므로 하지 않는 것을 권고).

---

## 0-E. 관리자 역할 · 메뉴 권한 (R=0 · 권한)

### E-1. `isWorkspaceAdmin` 한 함수 — 서버 채팅 5곳 + 설정 화면

**지금**: `routes/conversations.js:17-18 isAdmin`(owner 만) · `:541`(참여자 내보내기) · `:958`(타인 메시지 삭제) · `:979`·`:1014`(핀/해제) · `:1329-1343`(보관: `wsMember.role === 'owner'`) 전부 admin 제외. 화면 `QTalkPage.tsx:328-332` 는 admin 에게 ⋮·보관함을 보여 준다 → 403. `menu_permission.js:95` 는 «admin = 전권», `businesses.js:1038-1047 assertWorkspaceAdmin` 은 owner/admin 인데 화면 `WorkspaceSettingsPage.tsx:514 isAdmin`(owner 만) 이 `:1339 PermissionsSettings isOwner={isAdmin}` 으로 넘겨 admin 은 읽기전용.

**변경**
- `middleware/access_scope.js` (isMemberOrAbove :133 옆):
  ```js
  /** 워크스페이스 관리 권한 — owner · admin · platform_admin. PERMISSION_MATRIX «admin = owner_only 외 전권». */
  function isWorkspaceAdmin(scope) { return !!(scope?.isPlatformAdmin || scope?.isOwner || scope?.isAdmin); }
  /** req 모양(checkBusinessAccess/attachWorkspaceScope 를 지난 라우트). */
  function isWorkspaceAdminReq(req) { return req.user?.platform_role === 'platform_admin' || req.businessRole === 'owner' || req.businessRole === 'admin'; }
  module.exports += { isWorkspaceAdmin, isWorkspaceAdminReq }
  ```
- `conversations.js`: `:17-18 isAdmin = isWorkspaceAdminReq` · `:541`·`:958`·`:979`·`:1014` 의 `const isOwner = req.businessRole === 'owner' || …` → `const isOwner = isWorkspaceAdminReq(req)` · `:1329 isWorkspaceOwner` → `['owner','admin'].includes(wsMember?.role)`. 거절 코드 `workspace_owner_or_project_owner_required` 유지(라벨만 «관리자» 로 — ko/en 매핑 키가 있으면 문구 수정).
  - `:544` 하드코딩 한글 `'본인 나가기 또는 오너만…'` → 코드 `'self_or_admin_only'`, `errors.json` ko «본인이 나가거나 워크스페이스 관리자만 내보낼 수 있습니다.» / en «Only you (leaving) or a workspace admin can remove a member.». 화면 `ChatSettingsModal.tsx:233` [내보내기] 는 `p.user_id === me || hasBiz('owner','admin')` 일 때만 그린다(서버와 같은 술어).
- `WorkspaceSettingsPage.tsx:514` 를 둘로 가른다: `isOwner`(= 지금 식, 서버 `businesses.js:48 isAdmin` 이 owner 만 받는 PUT /:businessId 용 — **그대로**) · `isWsAdmin = isOwner || user?.business_role === 'admin'`. `:1339 isOwner={isWsAdmin}` · `:952` 의 특수 분기(`admin && (attendance|activity)`) 는 `isWsAdmin` 로 단순화. `PermissionsSettings.tsx:26 isOwner` prop 이름은 `canEdit` 로.
  - `settings.json:185 permissions.owner_only_hint` ko «권한 정책은 오너·관리자만 변경할 수 있습니다. 보기는 모든 멤버에게 열려 있습니다.» / en «Only owners and admins can change these settings. All members can view this page.»

▶ 판정: `businesses.js:48 isAdmin`(브랜드·로고 PUT 등) 은 **넓히지 않는다** — 그 라우트들은 신고에 없고, PERMISSION_MATRIX 의 owner_only(결제·플랜·멤버 해제·워크스페이스 정보) 경계가 거기 걸려 있다. 넓힐지는 1-8/2-20(권한 프리셋) 때 매트릭스와 같이 본다.

**가드** `--category=adminpredicate`(신규, 래칫): `dev-backend/routes|services` 에서 `businessRole === 'owner'` · `role === 'owner'` · `wsMember?.role === 'owner'` 가 **단독 관리 판정**으로 쓰인 줄 수를 세고 기준선(수정 후 수치)보다 늘면 실패. `isWorkspaceAdminReq`·`assertWorkspaceAdmin`·`access_scope.js` 안의 정의 줄은 제외. 양성 대조군: 수정 전 코드로 돌리면 6건 초과로 FAIL.

### E-2. 메뉴 권한 «숨김» 을 화면이 따른다 (결정 ⑨ 반영)

**지금**: 서버만 403(`requireMenu`). 사이드바 `MainLayout.tsx:1474-1860` 수기 JSX 는 권한을 안 읽고, `GlobalSearchModal.tsx:228 visibleNavMenus` 도 역할만 본다. 메뉴 정본 `config/navMenus.ts WORKSPACE_MENUS` 와 사이드바가 4곳 어긋난다(`MainLayout:1636 /attendance`·`:1734,1745 /business/settings/{attendance,activity}`·`:1408 /admin/platform-settings#announcement`).

**변경**
1. 서버 — `/me` 에 싣는다(새 라우트 없음). `routes/auth.js:168-172` `userData.business_role = activeWs.role;` 다음 줄:
   ```js
   userData.menu_levels = (await require('../middleware/menu_permission').getMemberMenuLevels(activeWs.business_id, user.id))?.menus || null;   // owner/admin 은 전부 'write'
   ```
   (`:181` 분기에는 `null`.) `AuthContext.tsx:58` User 타입 `menu_levels?: Record<string,'none'|'read'|'write'> | null;` · `:668` 매핑 추가.
2. 서버 — 권한 변경 방송. `businesses.js:1071 PUT …/permissions` 저장 뒤와 `:1113 PUT …/role` 뒤:
   ```js
   req.app.get('io')?.to(`user:${targetUserId}`).emit('permissions:updated', { business_id: businessId });   // server.js:223 user 룸
   ```
3. 프론트 — 받는 곳은 **App 루트 한 곳** `components/Common/WorkspaceSyncGuard.tsx:70` 옆: `onSocket('permissions:updated', (d) => { if (d.business_id === user?.business_id) refreshUser(); })`.
4. `config/navMenus.ts`
   - `NavRole` 에 `'admin'` 추가. `visibleNavMenus` 의 역할 매칭: `admin` 은 `roles` 에 `'admin'` **또는** `'member'` 가 있으면 보임(지금의 admin→member 접기를 일반화).
   - `NavMenuEntry.permKey?: MenuKey`(`services/permissions.ts:7 MenuKey` 를 import). 바인딩: talk→`qtalk` · mail→`qmail` · sale→`qsale` · task→`qtask` · calendar→`qcalendar` · note→`qnote` · docs→`qdocs` · info→`qinfo` · files→`qfile` · bill→`qbill` · ws-clients→`clients` · stats-* 8개→`insights`. (`weekly_team` 은 묶지 않는다 — 기본 none 이라 묶는 순간 멤버 전원의 «주간» 메뉴가 사라진다. 그 페이지는 자기 안에서 가린다.)
   - `visibleNavMenus({ …, menuLevels })` : `m.permKey && menuLevels && menuLevels[m.permKey] === 'none'` 이면 제외.
   - 정본에 **없던 4개를 올린다**: `{ key:'attendance', to:'/attendance', labelKey:'nav.attendance', section:'personal', roles:['owner','member'] }` · `{ key:'ws-attendance-admin', to:'/business/settings/attendance', labelKey:'nav.attendanceAdmin', section:'settings', roles:['owner','admin'] }` · `{ key:'ws-activity', to:'/business/settings/activity', labelKey:'nav.activity', section:'settings', roles:['owner','admin'] }`(라벨 키는 사이드바가 지금 쓰는 키를 그대로 — 없으면 ko/en 추가, `--category=navmenu` 가 잡는다). 관리자 모드의 `#announcement` 앵커 링크는 `ADMIN_MENUS` 의 `admin-platform-settings` 하위로 보고 가드에서 **해시를 떼고** 비교한다.
   - `export function permKeyForPath(path): MenuKey | null` — `navLabelKeyForPath` 와 같은 «가장 긴 접두어» 규칙으로 `permKey` 를 돌려준다.
5. `MainLayout.tsx`
   - `:1086 hasBiz` 옆에 `const visiblePaths = useMemo(() => new Set(visibleNavMenus({ businessRole: user?.business_role, isPlatformAdmin, scope: 'workspace', menuLevels: user?.menu_levels }).map(m => m.to.split('?')[0])), [...])` 와 `const show = (to) => visiblePaths.has(to)`.
   - 워크스페이스 사이드바의 **모든** `NavItem`/`AccordionItem` 조건을 `show('/mail')` 식으로 바꾼다(`hasBiz('owner','member') &&` 는 `show()` 안으로 흡수). 정본에 없는 경로는 자동으로 안 보이므로 4곳 이탈이 **구조적으로** 끝난다.
   - 본문 게이트(주소로 직접 들어온 경우): 페이지 본문을 그리기 전에 `const k = permKeyForPath(location.pathname); if (k && user?.menu_levels?.[k] === 'none') return <MenuHiddenPage />`. `MenuHiddenPage` 는 `components/Common/DetailFallback` 모양(제목 + 한 줄 + [확인 필요로 가기]).
     | 키(`layout` ns) | ko | en |
     |---|---|---|
     | `menuHidden.title` | 이 메뉴는 숨겨져 있어요 | This menu is hidden for you |
     | `menuHidden.desc` | 워크스페이스 관리자가 이 메뉴를 보이지 않게 설정했습니다. 필요하면 관리자에게 요청해 주세요. | A workspace admin has hidden this menu. Ask an admin if you need access. |
     | `menuHidden.goInbox` | 확인 필요로 가기 | Go to Inbox |
   - `GlobalSearchModal.tsx:228`·탭 `+` 가 같은 함수를 쓰므로 `menuLevels: user?.menu_levels` 한 인자만 더한다.

▶ **판정** 사이드바를 `WORKSPACE_MENUS.map` 으로 **통째로 다시 그리는 리팩터링은 이 묶음에서 하지 않는다**(MainLayout 2,390줄 god-file, 배지·아코디언·접힘 상태가 항목마다 다르다). 대신 «보이는가» 의 판정을 `visibleNavMenus` 하나로 **옮기고** 가드로 정본 이탈을 막는다 — 신고(숨김 미반영·이탈 4건)는 이것으로 닫힌다. 통째 렌더는 1-8(메뉴 다이어트·즐겨찾기)에서 사이드바를 어차피 다시 짤 때 한다.

**가드** `--category=navregistry`(신규, 하드): `MainLayout.tsx` 의 워크스페이스 사이드바 구간(`{!isAdminMode && (` … 대응 닫힘)에서 `to="/…"`·`to={\`/…\`}` 리터럴을 모아 해시·쿼리를 뗀 뒤 **전부 `WORKSPACE_MENUS.to` 에 있어야** 통과. 양성 대조군: 수정 전 코드에서 3건 FAIL(`/attendance`·`…/attendance`·`…/activity`).

**회귀 검사** — e2e 신규 `--suite menuhide`(3폭): 멤버 B 에 `qmail=none` 행 → ① 사이드바에 «Q mail» 0건 ② `/mail` 직접 진입 시 `menuHidden.title` 문구가 **보인다**(좌표·`elementFromPoint`) ③ 탭 `+`/검색 목록에 «Q mail» 0건 ④ 행 삭제 + 소켓 `permissions:updated` 수신 뒤 **새로고침 없이** 메뉴가 돌아온다(≤2초) ⑤ owner 는 전 단계에서 보인다(음성 대조군). health-check `me`: `GET /api/auth/me` 에 `menu_levels` 가 있고 멤버 none 행이 반영된다.

### 0-E 배포 순서·롤백
백엔드(me 필드·방송·admin 술어) → 프론트. 스키마 없음. `menu_levels` 는 추가 필드라 옛 번들과 호환. 롤백은 revert 두 커밋(프론트 먼저).

---

## 0-F. 초대 경로 (R=0)

### F-1. `acceptInvite` 한 함수 + 수락 시 `active_business_id`

**지금**: `routes/invites.js:34-92 resolveToken` · `:110-240 POST /:token/accept` 가 세 타입을 라우트 안에서 처리하고, **어느 타입도 `active_business_id` 를 바꾸지 않는다**(기존 계정이 멤버 초대를 수락하면 옛 워크스페이스 착지). 회원가입 `auth.js:241-248` 은 초대 토큰이면 워크스페이스를 안 만들고(:362-413) 수락은 프론트의 `/invite/:token` 리다이렉트(`InvitePage.tsx:68-76` 자동 수락)에 맡긴다. OAuth 는 초대를 모른다.

**변경** — 새 `services/invites.js`
```js
/** routes/invites.js:34-92 를 그대로 옮긴다(동작 무변경). */
async function resolveInviteToken(token) → { type, record, expired, alreadyLinked, info, business_id } | null
/**
 * 세 타입 공통 수락. 라우트의 :122-238 본문을 타입별 분기로 옮기고 **공통 후처리**를 한 곳에 둔다.
 * @param {User} user  로그인(또는 방금 만든) 사용자
 * @param {ReturnType<resolveInviteToken>} resolved
 * @param {{ io?, transaction?, actorReq? }} opts  transaction 이 오면 그 안에서(회원가입 경로), 없으면 자체 트랜잭션
 * @returns {{ type, business_id, redirect, already: boolean }}
 * @throws InviteError(code: 'invalid_or_expired_invite'|'already_accepted'|'quota', status)
 */
async function acceptInvite(user, resolved, opts = {})
```
공통 후처리(세 타입 모두): `User.update({ active_business_id: business_id }, { where: { id: user.id } })` → 방송(`project_client:updated`/`client:updated`/`member:updated` — 신호만) → `notifyInviterOnAccept` → 감사(`invite.accept`). `alreadyLinked` 이고 **그 사용자 본인**이면 던지지 않고 `{ already: true }` 로 돌려준다(가입 직후 InvitePage 의 재호출을 멱등으로 받는다).
- `routes/invites.js` POST accept 는 `resolveInviteToken` + `acceptInvite(req.user, resolved, { io })` 호출과 에러→HTTP 매핑만 남긴다. 응답 모양(`{type, business_id, redirect}`) 유지 — `InvitePage.tsx:59-60` 은 `refreshUser()` 뒤 `body.data.redirect` 로 간다(이미 그렇게 한다).
- `routes/auth.js` register: `isInviteSignup`(:242-248) 판정을 `resolveInviteToken` 으로 바꾸고, 커밋 **뒤** `acceptInvite(user, resolved, { io })` 를 best-effort 로 부른다(실패해도 가입은 성공 — 프론트 자동수락이 두 번째 기회). 응답 user 는 다시 읽어 `active_business_id` 가 반영된 것을 보낸다.

### F-2. OAuth — `redirect`/초대를 state 에 싣고 한 벌(`finish.js`)에서 처리

**지금**: 시작 `login.js:15-36`(구글)·`apple.js:24` 는 `pair` 만 state 에 싣는다(`services/google_oauth_login.js:28-44 genState({pair})`, `apple_oauth_login.js:79-105 {pair,native,nonce}`). 끝 `finish.js:124-157` 신규 가입은 무조건 `setupNewWorkspace`(`core.js:95-147`), 착지는 `buildRedirectTarget` → `/inbox`(`core.js:150-161`), 연결 확인은 `connections.js:93 next:'/inbox'`. 프론트 `GoogleAuthButton.tsx:62,78` 은 `?client=native` 만 붙인다.

**변경**
1. `routes/oauth/core.js`:
   ```js
   /** 돌아갈 앱 경로 — 열린 리다이렉트 차단. 같은 출처 상대경로만. */
   function safeRedirectPath(v) { const s = String(v || ''); return (s.startsWith('/') && !s.startsWith('//') && !/[\\\s]|:/.test(s) && s.length <= 512 && s !== '/login' && s !== '/register') ? s : null; }
   function inviteTokenOf(redirect) { const m = /^\/invite\/([A-Za-z0-9_-]{16,128})/.exec(redirect || ''); return m ? m[1] : null; }
   function buildRedirectTarget({ ok, error, redirect }) { … ok 면 `redirect || '/inbox'` }
   ```
2. state 페이로드에 `redirect` 추가(둘 다 ephemeral 5분, 비밀 아님):
   - `google_oauth_login.js:28 genState(pair, redirect)` → `{ pair, redirect }`; `:35 consumeStateEntry` 반환에 `redirect`; `:70 buildAuthUrl(pair, { redirect })`.
   - `apple_oauth_login.js:79 buildAuthUrl({ pair, native, redirect })` → `:84` 페이로드에 `redirect`; `:98 consumeState` 반환에 `redirect`.
   - `login.js:15` initiate: `const redirect = safeRedirectPath(req.query.redirect)` → `buildAuthUrl(pair, { redirect })`; 콜백 `:66-75` `finishOauthLogin(..., { redirect: stateEntry.redirect })`. `apple.js:24`·`:39-61` 같은 모양.
3. `finish.js:66 finishOauthLogin(req, res, { provider, profile, native, pairId, logTag, redirect })`
   - [분기 3] 신규 가입 전: `const inv = inviteTokenOf(redirect) ? await resolveInviteToken(token) : null; const inviteMode = !!(inv && !inv.expired && !inv.alreadyLinked);` → `inviteMode` 면 `setupNewWorkspace` **생략**(auth.js:362-413 과 같은 분기). 커밋 뒤 `acceptInvite(user, inv, { io: req.app.get('io') })` best-effort(실패 시 로그 + 그래도 `/invite/:token` 으로 보내면 InvitePage 가 다시 시도한다).
   - [분기 2] 연결 확인: `stashConfirm({ …, redirect })`; `connections.js:48-93 POST connect-confirm` 은 payload 의 `redirect` 를 `next` 로 돌려준다(없으면 `/inbox`). `OauthConnectConfirmPage.tsx:61` 은 이미 `j.data.next` 로 간다.
   - 마지막 `:189` → `buildRedirectTarget({ ok: true, isNewUser, redirect })`. 네이티브(`:171-186`)는 종전대로(앱이 딥링크를 따로 받는다 — 이 묶음 범위 밖, 아래 «남는 것»).
4. 프론트
   - `GoogleAuthButton.tsx:37` props `redirect?: string` → `:62,78` URL 에 `&redirect=${encodeURIComponent(redirect)}`(`?` 유무 분기).
   - `RegisterPage.tsx:480-482`·`LoginPage.tsx:636` 에 `redirect={현재 ?redirect}` 전달. 링크 보존: `RegisterPage.tsx:489` `<Link to={redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login'}>` · `LoginPage.tsx:661` 반대 방향 동일. (둘 다 `?redirect` 를 읽는 코드가 이미 있다 — `RegisterPage.tsx:296-307`, `LoginPage.tsx:486-487`.)
5. 409·레이트리밋 문구 — `utils/apiError.ts ERROR_CODE_MAP` 에 추가, `errors.json` ko/en 키:
   | 서버 문자열 | 키 | ko | en |
   |---|---|---|---|
   | `Email already registered`(auth.js:312,484) | `email_taken` | 이미 가입된 이메일이에요. 로그인해 주세요. | This email is already registered. Please sign in. |
   | `Too many registration attempts`(security.js:355) | `rate_limit_register` | 가입 시도가 많아요. 1시간 뒤 다시 해 주세요. | Too many sign-up attempts. Try again in an hour. |
   | `Too many password reset requests`(security.js:363) | `rate_limit_reset` | 재설정 요청이 많아요. 잠시 뒤 다시 해 주세요. | Too many reset requests. Try again later. |
6. 초대 메일 실패를 응답에 싣고, 신규 초대를 방송 — `clients.js:364-375`:
   ```js
   let inviteEmailSent = true; try { … } catch (e) { inviteEmailSent = false; console.warn(…); }
   broadcastClient(req, created, 'client:new');                            // 0-C ② 뒤라 신호만
   successResponse(res, { ...stripClientSecrets(created.toJSON()), invite_email_sent: inviteEmailSent }, inviteEmailSent ? 'Client invited' : 'invite_email_failed', 201);
   ```
   `ClientsPage.tsx:388` 성공 처리에서 `invite_email_sent === false` 면 드로어 안 인라인 경고(토스트 금지) + 기존 [초대 재발송] 버튼으로 안내.
   | 키(`clients` ns) | ko | en |
   |---|---|---|
   | `invite.emailFailed` | 초대는 만들어졌지만 메일을 보내지 못했습니다. 메일 설정을 확인한 뒤 [초대 재발송] 을 눌러 주세요. | The invite was created but the email couldn’t be sent. Check mail settings and use “Resend invite”. |

▶ **판정** ① 초대 수락의 정본은 `acceptInvite` 하나이고, 회원가입·OAuth 는 **커밋 뒤 best-effort 로 부른 다음 어쨌든 `/invite/:token` 으로 보낸다.** 그래야 서버 쪽 실패(쿼터 422 등)가 사용자에게 InvitePage 의 문장으로 보인다 — 가입 트랜잭션 안에 넣으면 쿼터 때문에 **가입 자체가** 실패한다. ② `redirect` 는 `/invite/…` 만이 아니라 공개 페이지 복귀(`PublicFilePage` 등 `LoginPage.tsx:482-487` 이 쓰는 `next`)에도 쓰이므로 일반 경로로 받되 `safeRedirectPath` 로 자른다. ③ 네이티브 앱의 OAuth 복귀는 딥링크 `code` 교환이라 `redirect` 를 싣지 않는다 — 앱에서 초대 링크를 열어 구글 가입하는 경우는 **남는 것**으로 적는다(앱 번들 수정 필요).

**회귀 검사**
- health-check 신규 `invite`:
  1. «기존 계정 멤버 초대 수락 → 활성 워크스페이스가 바뀐다»: 사용자 B(워크스페이스 X 활성) · 워크스페이스 Y 에 `business_members(invite_token, user_id NULL)` 픽스처 → B 로 `POST /api/invites/:token/accept` → `GET /api/auth/me`.business_id === Y, `users.active_business_id === Y`. **음성 대조군** 만료 토큰(`invited_at = now-40d`) → 410 이고 active 는 X 그대로. 끝나면 멤버십·토큰 원복.
  2. «초대 모드 OAuth 신규 가입은 워크스페이스를 만들지 않는다»: node 스크립트가 `finishOauthLogin` 을 가짜 `req/res`(헤더·`app.get('io')` null·`redirect` 캡처)로 직접 호출 — `profile.email` 새 주소 + `redirect='/invite/<토큰>'` → `businesses` 행 **+0**, `business_members` +1(user_id 채워짐), `users.active_business_id` = 초대 워크스페이스, res.redirect 인자가 `/invite/<토큰>`. **대조군** `redirect` 없이 같은 호출 → businesses +1, 착지 `/inbox`. 만든 사용자·워크스페이스 전부 삭제(Cue 사용자 포함).
  3. «state 가 redirect 를 나른다»: `google_oauth_login.buildAuthUrl(null,{redirect:'/invite/abc'})` → `consumeStateEntry(state).redirect === '/invite/abc'`; `safeRedirectPath('//evil.com')`·`('https://x')`·`('/login')` 전부 null(음성).
  4. «초대 메일 실패가 응답에 보인다»: SMTP 호스트를 잘못된 값으로 바꾼 자식 프로세스에서 `POST /api/clients/:biz/invite` → 201 + `invite_email_sent:false`; 정상 환경 → `true`(대조군). (운영에 메일을 보내지 않는 dev 전용.)
- e2e `--suite invite`(신규, 3폭): `/register?redirect=/invite/<토큰>` 에서 «로그인» 링크 href 에 같은 redirect 가 있다 · 구글 버튼 href(onStart 인자) 에 `redirect=` 가 있다 · 409 메일로 가입 시 화면 문구가 `email_taken` ko/en(영문 원문 0건).

### 0-F 배포 순서·롤백
백엔드(state 페이로드·finish·acceptInvite·clients 응답) → 프론트(redirect 전달·문구). state 는 5분 ephemeral 이라 순서 사이의 혼재는 «redirect 없음 = 종전 동작». 롤백은 revert(스키마 없음). `acceptInvite` 로 옮긴 뒤 `routes/invites.js` 의 옛 본문이 남아 있지 않은지 `--category=duproute`·grep 으로 확인(두 벌 금지).

---

## 묶음 공통 — 구현 순서 · 검증 보고 양식

1. **0-C → 0-D → 0-E → 0-F** 순. 0-C 와 0-D 는 Fable 게이트(`/fable-검증`)에 **묶음별 한 번**씩, 0-E·0-F 는 자체 검증 + «Fable 미검증(자체 검증)» 표기.
2. 각 묶음 보고에 반드시: 가드 전체 실행(`node scripts/guard-invariants.js` — 카테고리 단독 금지) EXIT · `npm run build` EXIT/`error TS` 0 · 위 health-check 카테고리 실행 결과(양성/음성 대조군 **둘 다** 뒤집힘 확인) · e2e 스위트 수치 · 운영 배포 전 SELECT 값.
3. 새 health-check 카테고리는 `scripts/health-check.js:46` 목록에 등록하고(`signauth`·`kbauth`·`folderauth`·`mailscope`·`clientsmenu`·`invite`), 새 가드는 `guard-invariants.js:3270 CATEGORIES` 에(`adminpredicate`·`navregistry`). 등록 안 된 검사는 없는 검사다(memory `feedback_unwired_guard_is_no_guard`).
4. 문구는 ko/en 을 **같은 커밋**에 넣고 `--category=parity` 통과.

## 남는 것 (이 묶음 밖 — 작업기록에 옮길 것)
- Cue `Document.create`(document_actions.js:44) 의 Post 이관 — 1-11 과 함께.
- 사이드바 `WORKSPACE_MENUS.map` 통째 렌더 · 즐겨찾기 · «안 쓰는 Q 끄기» — 1-8.
- 네이티브 앱에서 초대 링크 → 구글 가입 시 redirect 전달(앱 번들).
- `businesses.js:48 isAdmin`(owner 만) 라우트들의 admin 범위 — 2-20 권한 프리셋에서 매트릭스와 같이.
- `canMutateFile`(files.js:952) 에 admin 이 없다(owner·PM·본인) — 매트릭스 §5.3 그대로 둔다. 바꾸려면 Irene 결정.
