# 파일·문서 검색 — 메일 첨부 분리 · 못 보는 자료의 «존재 공개» · 열람 요청 (2026-11-25)

> Irene: *"문서/파일 검색할 때 메일에 있는데 나오네 … 메일파일까지 검색하기 체크필터를 두거나 … 보안문제 있는 것도 검색은 되고 보안상 못 보는 거 표시하면 어때?
> 그 보안권한 수정 가능한 사람 표시해주고 그럼 요청할 수 있잖아. 열람요청하기 … 아예 지금처럼 숨길지 보이고 열람만 안되게 할지 이런거 중요하지 않아?
> 존재 여부도 모르면 문제되는 경우 많을 것 같은데. 이거 체계적으로 검토해줘. fable 써서."*
>
> 설계 판정: Fable (2026-11-25) — **A = READY(수정 3건 반영) · B/C = CHANGE**(그대로는 안 되고 좁힌 안으로, Irene 선택 뒤 착수). 구현·실측: [Opus].

## 0. 실측 (dev, 2026-11-25)

| 사실 | 값 |
|---|---|
| ws5 살아 있는 파일 중 메일 첨부 | **2,180 / 2,338 (93%)**, 전부 L3(회사 메일함) |
| ws3 | 1,716 / 1,738, 전부 L1(개인 메일함) |
| 메일 첨부 중 20KB 미만 이미지(서명·아이콘) | 1,927 |
| `email_attachments.is_inline` 참 | 4,927건 중 6건 — 수신 서버가 cid 를 치환해 거의 늘 거짓 |

메일 첨부가 `files` 행이 되는 이유: `email_attachments` 에 저장 칸이 없어 바이트의 실체가 그 행 하나다(지우면 메일에서 첨부를 못 받는다 — `services/emailImapCron.saveAttachmentAsFile`).
개인 메일함 첨부 = L1(주인만), 회사 메일함 첨부 = L3(워크스페이스 전원).

검색 표면별로 보면(고치기 전):
- 통합 검색(`GET /api/search` → `searchScope.searchFiles`) — 메일 첨부를 **안 뺐다**. AI 앱 `search_all`·Cue 도 같은 함수.
- Q file 검색(`DocsTab` — 전체 목록을 화면에서 거름) — «전체» 칸에서 찾으면 메일 첨부까지 걸렸다.
- 첨부 고르기(`routes/files.js` 목록) — 이미 뺐다(2026-09-20).
- **권한 구멍**: 회사 메일함 첨부는 L3 라 **Q mail 메뉴가 «숨김» 인 멤버도** 통합 검색·Q file «메일» 칸·AI `list_files source=mail` 로 받았다.

## 1. 1단계 — 메일 첨부 (구현함 · Irene 결정 불필요)

1. **기본 제외** — 통합 검색 · Q file «전체» 검색 · AI `search_all`(Cue 포함). «메일 첨부도 검색» 체크(`include_mail=1`)했을 때만.
   Q file 은 왼쪽에서 «메일» 칸을 고르면 체크 없이 그 안을 찾는다. 검색어 없는 목록의 «메일» 칸은 그대로(09-20 결정 유지).
2. **술어 한 곳** — `services/mailAttachmentFiles`: `mailAttachmentLiteral`/`notMailAttachmentLiteral`(서브쿼리 `EXISTS … email_attachments`, `File` 자격 붙임) ·
   `notMailNoiseLiteral`(서명·아이콘) · `mailFilesAllowed`(메일을 읽을 수 있는 사람) · `mailThreadOfFiles`(원 메일). 화면 쪽 같은 선은 `pages/QProject/docs/fileSource.passesMailSearch`.
3. **메일을 읽을 수 있는 사람에게만** — `mailFilesAllowed` = 고객 아님 ∧ `menuAllows(qmail, read)`(메일 목록 라우트 requireMenu 와 같은 축).
   적용: 통합 검색 · AI `search_all`(+ 연결에 `mail:read`) · AI `list_files`(source mail·all) · Q file 전체 목록(all-files) · 프로젝트 파일 탭. 메일을 못 보는 사람에게는 체크 칸도 없다(`mail_files_allowed`).
4. **서명·아이콘은 체크해도 검색에서 뺀다** — 메일 첨부 ∧ 이미지 ∧ (20KB 미만 ∨ inline). 메일 화면 안에서는 그대로 보인다.
5. **결과 줄** — 통합 검색은 «메일에서 온 첨부» 를 둘째 줄 앞에 적고 누르면 **원 메일**(`/mail?thread=`)로. AI `search_all` 은 `source:'mail'` + 메일 링크.
   «이 워크스페이스에 저장» 한 사본은 새 `files` 행이라 메일 첨부가 아니다 → 체크 없이도 나온다.

## 2. 2단계 — 못 보는 자료의 «존재 공개» (Irene 선택 대기)

**«전부 잠금 표시» 는 하지 않는다** — ① 제목이 곧 내용이다(«구조조정안.xlsx») ② 검색의 잠금 줄은 «이 단어로 찾으면 뭔가 있다» 를 알려 주는 탐지기가 된다(이름을 가려도 샌다).

| 결정 | 내용 |
|---|---|
| L1 «나만 보기» | **영구 비공개** — 존재·건수 모두 안 보인다(10-09 D2 유지). 설정으로도 못 연다 |
| 고객·게스트 | 자리도 없다(기존 규칙) |
| 대상 | **L2(프로젝트·지정 멤버 제한)뿐** — 워크스페이스 설정 `restricted_discoverable`(대표·관리자, **기본 꺼짐** = 지금과 같음) |
| 항목별 숨김 | `hide_existence` — 올린 사람·대표·관리자가 민감한 제목을 뺀다. **이것 없이 설정만 열지 않는다** |
| 잠금 줄에 싣는 것 | id · 이름 · 종류 아이콘 · 올린 사람 · `locked:true` 뿐(크기·설명·태그·스니펫·프로젝트 이름 없음). **이름으로 맞은 것만**(설명·태그·본문 매칭 제외) |
| 표면 | 통합 검색 + Q file 검색 두 곳만. 목록·최근·폴더 건수·AI `search_all`·Cue 에는 **없다**(AI 가 제목을 밖으로 옮긴다) |
| 술어 | `access_scope.lockedDiscoverableWhere(scope, entity)` 한 곳 + 응답 `services/lockedDiscovery.js`(화이트리스트) |
| 종류 | 2단계 = 파일 + 문서. 업무·Q info = 3단계(같은 모듈) |

## 2-구현. 2단계 구현 (2026-11-25, Irene «권고대로» ①)

- 설정: `businesses.permissions.restricted_discoverable`(기본 꺼짐) · 설정 › 권한 «제한 자료를 검색에서 잠금으로 보이기»(`components/Permissions/RestrictedDiscoverySection`, 대표·관리자)
- 항목 숨김: `files.hide_existence`·`posts.hide_existence`(기본 0) · 파일 상세 «공개» 칸 아래 · 문서 «공개 범위 변경» 창 아래(`components/AccessRequest/HideExistenceToggle` — 설정이 켜졌고 L2 일 때만, 올린 사람·작성자·대표·관리자)
- 판정: `services/lockedDiscovery`(잠금 술어 한 곳 — 후보 = 이름 일치 L2·숨김 아님·남이 올린 것 ≤40건 → **단건 읽기 술어가 거절하는 것만**) · 응답 화이트리스트 `{id,name,kind,owner{id,name},locked,request}`
- 표면: 통합 검색(`/api/search` → `locked_files`·`locked_posts`, Q file·Q docs 메뉴가 숨겨진 멤버는 그 종류 없음) · Q file 검색(`GET /api/access-requests/:biz/locked?types=file`, 워크스페이스 Q file 에서만)
- **설계와 다른 한 곳(Fable 검증 대상)** — 승인을 `target_member_ids` 추가로 하지 않았다. 실측: `access_scope.canAccessFileByLevel`·`canAccessPostByLevel` 은 **프로젝트에 묶인 L2 항목에서 target_member_ids 를 보지 않고**, 목록 술어도 지정 멤버 조건을 «보이는 프로젝트» 로 감싸서 숨은 프로젝트 자료는 승인해도 안 열린다.
  → **승인된 `access_requests` 행 자체가 «그 사람·그 항목 하나·지금 L2 일 때만» 의 권한**(`services/accessGrants` — 읽기 술어 네 벌이 거절한 뒤에만 본다). 항목의 공개 범위는 안 바뀌고, 회수(`revoked`)하면 닫히고, 항목이 «나만 보기» 로 바뀌면 닫히고, 멤버가 아니게 되면 닫힌다.
- API `routes/access_requests.js`(멤버 이상): locked · 요청(POST, 잠금 술어 통과한 것만 — 아니면 같은 404) · inbox · approve/deny/revoke/cancel · settings · hide
- 화면: 잠금 줄 `LockedResultRow` + `AccessRequestButton`(보내기 창) · 받은 요청 `/access-requests`(`pages/AccessRequests`, 알림 링크) · 실시간 `access_request:changed` 신호(사람 방)
- 운영: `dev-backend/scripts/migrate-access-requests.js`(멱등 · 배포 슬롯 · PM2 reload 전)

## 3. 열람 요청 (2단계가 켜졌을 때만) — 구현 기준

- 표 `access_requests`(business_id · entity_type file|post · entity_id · requester_id · approver_id · status pending/approved/denied/expired/canceled/revoked · message · decided_by · decided_at · decision_note).
- 받는 사람(approver_id): 올린 사람·작성자가 지금 직원이면 그 사람, 아니면 NULL → 대표·관리자 전원. 받은 요청함(`/access-requests`)은 approver_id = 나, 대표·관리자는 워크스페이스 전부. 요청자에게 받는 사람 이름 표시 OK.
- **승인 = 그 사람·그 항목 하나의 «읽기» 권한**(`services/accessGrants` — 승인 행 자체, §2-구현). 항목 공개 범위는 안 바뀐다.
  - **읽기 전용** — 밖으로 내보내는 문(파일 공개 링크 발급·끊기 · Drive 편집 열기 · 공용 공유 · 폴더 링크 포함 · 문서 공유 링크·메일 공유)은 승인을 빼고 본다: `access_scope.canShareFile` · `postAccess.canSharePost`(Fable 완료 검증 1차 FAIL 차단 1 → 고침). 편집·삭제·숨김은 원래부터 올린 사람·작성자·관리 축이라 승인과 무관.
  - 승인할 때: 결정자가 **원래 권한으로** 읽을 수 있어야 · 항목이 지금 L2 · 요청자가 지금 멤버(아니면 409).
  - 닫히는 경우: 회수(revoked) · 항목이 «나만 보기»(L1)로 바뀜(그 순간 대기·승인을 닫는다 — `closeForPrivate`, L2 로 돌아와도 안 살아남) · L2 가 아님 · 요청자가 멤버가 아님.
- 알림: 앱 + 푸시, 신호만(항목 이름 없음). 메일 없음.
- 남용 방지: 하루 10건(잠금 판정 **앞** — 한도에 걸리면 무엇이든 같은 429) · 항목×요청자 대기 1건(있으면 그것) · 거절 뒤 7일 · 14일 뒤 만료 · 분당 20회. 승인·거절·회수·취소 AuditLog.
- 요청 API 는 잠금 술어를 통과한 id 만 — 없는 id·L1·숨김·남의 워크스페이스·설정 꺼짐·이미 볼 수 있음·메뉴 숨김은 **모두 같은 404**.
- 잠금 후보에서 빼는 것: 메일 첨부 보관분 · 문서 초안 · 한 글자 검색.

## 4. 단계 · 게이트

| 단계 | 내용 | 게이트 |
|---|---|---|
| 1 | §1 전부 | 구현 완료 · 권한 술어(③)라 Fable 완료 검증 1회 |
| 2 | §2 + §3 (파일·문서) | access_scope 술어 신설 + 새 표 + 알림 — Irene 선택 뒤 착수 · Fable 완료 검증 1회 |
| 3 | 업무·Q info 확장 | 같은 모듈 |

**Irene 선택**: 제한 자료(L2)를 검색에 «잠금 + 열람 요청» 으로 보이게 하는 기능을 만들까요?
- ① 만든다 — 워크스페이스 설정(기본 꺼짐) + 항목별 숨김 + 열람 요청. «나만 보기» 는 계속 완전 비공개. **(Fable 권고)**
- ② 안 만든다 — 지금처럼 전부 숨김. 1단계만.
- ③ 기본 켜짐으로 만든다 — 기존 L2 제목이 배포 즉시 전 멤버에게 드러난다(되돌려도 이미 본 것은 못 지운다). 비권고.

## 5. 검증 (1단계 실측 2026-11-25)

실HTTP `test-mailsearch.js` 21/21 · AI 도구 직접 호출 9/9 · 양성 대조군(제외 술어·메일 게이트를 무력화) → 해당 4건 정확히 FAIL 로 뒤집힘.
- 기본: 메일 첨부 0 / 직접 파일 나옴 · 포함: PDF·20KB 넘는 사진 나옴, 서명 이미지 빠짐, `source:'mail'`+스레드 id
- Q mail 숨김 멤버: `include_mail=1` 직접 호출해도 0 · Q file 전체 목록 «메일» 칸 0 · AI list_files source=mail/all 0 · 대조군(메뉴 되돌림) = 나옴
- 고객 0 · 남의 워크스페이스 403 · `include_mail=true` 같은 다른 값 = 포함 아님 · 프로젝트 파일 탭(폴더 조인) 200
- 시험 데이터: ws6 파일 14932~14935 «[확인용] … qz7m»(메일 스레드 9822에 연결)

남은 것(비차단): 메일 메뉴 숨김 멤버가 회사 메일 첨부 **파일 id 를 알면** 단건 내려받기는 여전히 L3 술어로 열린다 — 단건 문(`canDownloadFile`)에 같은 게이트를 넣을지는 2단계와 함께 본다(그 파일이 문서·업무에 첨부된 경우 열려야 하므로 술어가 다르다).
