# 제품 감사 — `content` 영역 (문서·파일·지식·노트) — 2026-10-07 · Fable

> 읽기 전용 감사. 근거는 전부 코드·dev DB·i18n(`파일:줄`). 운영 접속·브라우저 미사용.
> 범위: Q docs(Post·표 q_records·설문·템플릿) · 서명 · Q File(+개인 보관함·휴지통·Drive·공유 링크) · Q info(KB) · Q위키 · Q Note(FastAPI).
> 이미 박제된 결정(Drive 양방향 동기화 안 함 · Q Note 사적 공간 · 상담은 고객 기록 · HIGH 위험 AI 도구 금지)은 존중했다.

## 요약 (5줄)
1. **골격은 넓고 깊다** — 문서 편집기(TipTap+서명란+표+체크리스트)·3단계 서명(OTP·동결본·해시)·설문·KB AI ingest·실시간 STT(diarize·화자 자동이름)·업무 추출까지 **동급 SaaS 가 보통 못 갖춘 폭**을 이미 갖췄다. 구현 상태 표에서 ✅ 가 다수.
2. 그러나 **«있는 기능을 화면이 못 쓴다» 계열이 영역마다 하나씩 있다** — KB 뜻검색(`POST kb/search` 프론트 호출 0) · 문서 공유 비밀번호/만료(서버만) · 버전 미리보기(서버만) · Pinned FAQ(화면 0) · 재색인 버튼(0) · Q Note 공유 만료(컬럼만). 백엔드 «완료» 가 사용자에게 도달하지 않은 전형(memory `feedback_backend_done_ui_missing`).
3. **보안·데이터 결함 7건(중~높음, 전부 R=1)** — ① 서명 토큰·`sign_url` 이 멤버 전원에게 내려가고 확인요청(confirm)은 OTP 가 없어 **남이 대리 확인** 가능 ② `signatures.js` 6라우트가 `canReadPost` 를 안 봐 **남의 L1 문서 본문이 서명 경로로 샘** ③ 옛 Document 공개 서명 무검증 ④ KB 보안등급 변경·공유 해제가 읽기 술어를 안 봄 ⑤ 위키 공개 이미지 `LIKE` 접두 매치로 무인증 파일 서빙 ⑥ 휴지통 «90/365일» 표시인데 cron 은 30일에 바이트 삭제 ⑦ 폴더 «같이 삭제» 가 파일 삭제 권한 우회. 모두 Fable 게이트 대상.
4. **UX 격차의 핵심은 «기록→실행» 고리와 «협업» 부재** — 문서 댓글·멘션 0, 동시편집은 409 로 늦은 쪽이 진다, 회의 요약은 수동 버튼이고 오디오 재생이 아예 없다(원본 파기), 표 문서에 정렬·필터·CSV 가 없다, Q Note 목록이 **첫 20건만** 보인다, 파일은 이름으로만 찾고 폴더를 못 옮긴다. 점수: Q docs 7 · 서명 7 · 표/설문 5 · Q File 6 · Q info 5 · Q위키 7 · Q Note 6.
5. 최우선 5건: **P0** 서명 라우트 권한 통일+토큰 제거 · **P0** Q Note 목록 페이지네이션 · **P0** KB 화면 검색을 하이브리드로 교체(+L1/L2 포함) · **P0** 공유 링크 한 벌(문서 비밀번호/만료 노출·파일 B 흡수·Q Note 만료) · **P1** 회의 종료 자동 요약 + 결정/액션 구조화(+ 문서 댓글·멘션은 설계 사안).

---

## 1. 구현 상태

dev DB 실측(2026-10-07): posts 114(doc 80·table 34·template 0) · post_revisions 10 · signature_requests 24(signed 9·sent 11) · q_records 34(설문 켜짐 0) · 문서 공유 토큰 4(비밀번호 0) · 옛 `documents` 25(공유 5) · kb_documents 109(삭제 80) · kb_chunks kb 94 / wiki 190 · help_articles 138(발행 88) · kb_pinned_faqs 0 · Q Note sessions 71(voice 66·text 5 / **status=recording 37**, completed 25) · utterances 3,195 · qa_pairs 226 · 요약 있는 세션 4 · share_token 0 · voice_fingerprints 2.

### 1-A. Q docs (문서)
| 기능 | 상태 | 근거 |
|---|---|---|
| 편집기(H1~3·목록·인용·코드블록·링크·크기조절 이미지·표·정렬·체크리스트·서명란·마크다운 붙여넣기·TOC) | ✅ | `dev-frontend/src/components/Docs/PostEditor.tsx:176-203`, `editorChecklist.ts`, `SignatureField.ts`, `DocToc.tsx` |
| 멘션·임베드(유튜브/iframe)·밑줄/형광/글자색 버튼·콜아웃·토글·슬래시 명령 | 🔴 없음 | `PostEditor.tsx` grep `Mention|iframe|Underline|Highlight|Color|slash` 0건(툴바 `:365-462`) |
| 분류(category) CRUD·칩 필터 | ✅ | `dev-backend/routes/posts.js:1330-1410`, `PostsPage.tsx:1774-1800` |
| 종류 kind | 🟡 | ENUM doc/table/brief/template(`models/Post.js:50`) — **template 생성 경로 0**, 템플릿은 `document_templates` 별도 표 |
| 템플릿(저장·템플릿에서 시작·슬롯 채우기) | ✅ | `PostsPage.tsx:2662` → `POST /api/docs/templates`, `SlotFormModal`, 시스템 7종 시드 |
| 버전/이력 | 🟡 | 서버 목록·**미리보기(`routes/post_revisions.js:44`)**·복원(`:67`), 10분 합치기·50개 상한(`services/postRevisions.js:9,11`). **화면은 목록+복원만 — 미리보기 호출 0·diff 없음**(`PostHistoryPanel.tsx:45,62`) |
| 댓글·인라인 코멘트·멘션 알림 | 🔴 없음 | `models/` PostComment 없음(TaskComment 만), `routes/posts.js` grep comment 0 |
| 동시편집 | 🟡 | CRDT 없음. 존재 표시(`hooks/usePostPresence.ts`, `server.js:207,324`) + 낙관적 잠금 409 `stale_edit`(`posts.js:856-889`) → «새로고침/덮어쓰기»(`PostsPage.tsx:2026-2033`) |
| 자동저장·이탈 저장 | ✅ | `PostsPage.tsx:960,1079,2034`, `posts.js:891` |
| 공유 링크 — 토큰·회수·읽기 술어·보안등급 | ✅ | `posts.js:1410-1468`(`canReadPost`) |
| 공유 링크 — 비밀번호·만료 | 🟡 **서버만** | `applyShareUpdate(post, req.body)`(`:1434`) 받지만 FE `sharePost(postId)` 가 body 없이 호출(`services/posts.ts:466-467`), `PostShareModal.tsx` grep password/expires 0 |
| 공개 페이지·PDF·DOCX | ✅ | `posts.js:1691,1712,1733,1765`, `PublicPostPage.tsx` + `usePublicRevalidate` |
| 서명 요청 3단계(서명란→서명자→발송)·us/them·OTP·내부 서명·확인 요청·취소·재발송·받은 서명함·동결본 해시 | ✅ | `PostSignatureModal.tsx:78`, `signatures.js:350,370,405,483-541,580-590`, `signature_internal.js`, `signature_confirm.js`, `signatureCore.js:183-213` |
| 서명 만료 자동 처리 | 🟡 | cron 없음 — `signatureCore.js:42` «GET 을 거치지 않으면 영영 안 붙는다». 안 연 요청은 진행표에 `sent` 로 남음 |
| 서명본 조립 한 곳 | ✅ | `services/signedDocument.js` (앱·공개·서명·PDF 동일) |
| 표 문서(q_records) — 칸 17종·열 집계·시크릿 reveal 감사 | ✅ | `PostTableGrid.tsx:33-50`, `records.js:390` |
| 표 — 정렬·필터·CSV 가져오기/내보내기·뷰 | 🔴 없음 | `PostTableGrid.tsx`·`services/qtable.ts` grep csv/export/sort/filter 0 |
| 설문(켜기·필수/숨김·마감·정원·공개 응답 화면·통계·실시간) | ✅ | `SurveyDrawer.tsx`, `PublicSurveyPage.tsx`, `SurveyStats.tsx`, `services/survey.js:52`. dev 켜진 설문 0 |
| AI(빈 문서/표/AI 신규작성/자료 기반 brief) | ✅ | `PostAiModal.tsx:306-330`, `/api/docs/ai-generate`, `POST /api/posts/brief` |
| 복제·프로젝트 연결·문서 간 연결·첨부·휴지통 | ✅ | `posts.js:544-612,915-949,1121`, `models/Post.js:75-76` |
| 첨부 목록 — 공용 `AttachmentList` | 🟡 | PostsPage 자체 렌더(공용 미사용, CLAUDE.md «붙은 첨부 한 벌» 계약 이탈) |
| 핀(is_pinned) | 🔴 UI 없음 | 정렬·점만(`PostsPage.tsx:1489-1492,2193`), 바꾸는 호출 0 (서버 PUT 은 받음 `posts.js:895`) |
| 검색 | 🟡 | 제목/본문/분류/프로젝트 LIKE + 매칭 사유(`posts.js:262-317`) — **`content_text` 5,000자 절단(`:90`)** → 긴 문서 뒷부분 검색 불가 |
| 목록 정렬·필터 | ✅ | `ListSortSelect`(`PostsPage.tsx:1558,1769`) |
| 고객(Client) 보기 | 🟡 | 서버 술어 OK(`access_scope.js:492-520`). 프로젝트>문서 탭이 같은 `PostsPage` 인데 **역할 분기 0**(grep `business_role|isClient` 0) → 고객에게 [편집][공유][서명 받기][삭제] 가 그려지고 서버 403 |
| 옛 Document 엔티티(`routes/docs.js` 15라우트) | 🔴 좀비 | FE 호출 0(`services/docs.ts:5-11` 제거 사유 주석). 단 Cue `cue_tools.js:17` → `document_actions.createDocument` 가 **만들 수는 있어** 앱 어디서도 못 여는 문서가 생긴다 |

### 1-B. Q File (파일) · 개인 보관함 · 휴지통 · 공유 링크
(DocsTab=`dev-frontend/src/pages/QProject/DocsTab.tsx` 2,924줄 — Q file·프로젝트 파일 탭·개인 보관함 세 scope 를 한 컴포넌트가 그림 `:66-69`)

| 기능 | 상태 | 근거 |
|---|---|---|
| 업로드 — drag&drop·다중·폴더째(webkitdirectory, 폴더 사슬 재현)·진행률/속도/취소·429 재시도·실패 재시도·용량 사전검사 | ✅ | DocsTab`:713-775,1098-1118,1151-1196,1208-1217`, `docs/UploadQueue.tsx`, `routes/files.js:542-600,618` |
| 같은 이름 중복 — 덮어쓰기/이름바꿈/건너뛰기(배치 1회 질문) | ✅ | DocsTab`:511-611,644-652` |
| 업로드 확장자 화이트리스트 | 🔴 없음 | `files.js:440-456` multer fileFilter 없음(`ALLOWED_EXT` 는 Drive 가져오기만 `driveImport.js:22`). dev 실측 `.html/.svg/.js` 35건. 서빙은 `fileServing.isSafeInline` 이 attachment 강제(`:23-54`)라 XSS 는 막힘 — CLAUDE.md «허용 확장자» 문구와 불일치 |
| 폴더 — 생성·이름변경·중첩·정렬·삭제(안의 파일 옮김/같이 삭제)·폴더째 zip | ✅ | `routes/file_folders.js:97-160,163-243,258-408`, DocsTab`:2356-2368` |
| 폴더 **이동(상위 변경)·폴더 DnD** | 🔴 없음 | PUT 은 name 만(`file_folders.js:211-243`), `TreeRow.tsx` draggable 0 |
| 파일→폴더 DnD·일괄 이동 | ✅ | DocsTab`:976-1070`, `docs/folderDrop.ts` |
| 프로젝트 간 파일 이동 | 🟡 간접 | «공개 범위 L2+프로젝트 선택» 으로만(`files.js:1104-1232`), «프로젝트 바꾸기» 문 없음 |
| 출처 분류(전체/프로젝트/내 파일/채팅/업무/회의/문서/메일) | ✅ | DocsTab`:2195-2250`, `projects.js:3651-4133` — 직렬화가 **두 벌**(`:3742,3967` 코드 자신이 명시) |
| 미리보기 | 🟡 | 이미지·영상/음성(자체 저장만)·PDF·text/html(샌드박스)·zip 목록·.gdoc(`docs/PreviewArea.tsx:29-35,161-262`). **Office(docx/xlsx/pptx) 미리보기 없음** — Drive 바이트 있을 때 «편집 열기» 만(`files.js:989-1049`) |
| 썸네일(리사이즈·캐시·eager/lazy) | ✅ | `files.js:300-316`, DocsTab`:1516-1531` |
| 검색 | 🟡 | 파일명·설명·태그 **클라이언트측**(DocsTab`:456-463`); 전역검색도 `file_name` 만(`search.js:48`). 본문 색인(`services/fileText.js:52-85`, `fileIndex.js:33-43`)은 **Cue 전용** — 검색창 미연결 |
| 정렬·필터 | 🟡 | 정렬 3종(최근/이름/크기)만; 종류·날짜·올린이·태그 필터 없음 |
| 이름변경·설명·태그(자동저장) | ✅ | `files.js:1293-1376`, `docs/FileMetaEditor.tsx`. 태그 필터/클릭 탐색 없음 |
| 다운로드 단건·zip(선택·폴더째, 200개 상한, 항목별 `canDownloadFile`) | ✅ | DocsTab`:904-944,1653-1669`, `files.js:1817-1942` |
| 파일 버전(재업로드 이력) | 🔴 없음 | SHA-256 dedup(`files.js:855-887`)만; «덮어쓰기» 는 옛 파일 휴지통행 |
| 공유 링크 A — ShareModal(페이지 링크·비밀번호·만료·해제·410) | ✅ | `files.js:108-157`, `components/Common/ShareModal.tsx:44,101,249`, `PublicFilePage.tsx:57-153` |
| 공유 링크 B — 일괄 바 [공유 링크](raw 다운로드 URL·30일 고정·비밀번호 없음) | 🟡 반쪽 | DocsTab`:887-902,1409-1416` → `files.js:1735-1786`. **해제 `revokeShareLink`(`services/files.ts:738`) 호출처 0** → 화면에서 못 끊음. 한 컬럼·두 URL·두 정책 |
| 보안등급 internal/confidential 차단(외부 링크·드래그아웃·미디어·공개이미지·Drive 사본)·L1/L2 좁히면 링크 해제 | ✅ | `files.js:121,290-292,424-426,1157-1163,1249-1252,1715`, `share_helper.js:126-134` |
| 외부 공유 받기(ShareReceive = PWA Web Share Target → 채팅/업무/메모/문서/폴더) | ✅ | `manifest.json:24-39`, `ShareReceivePage.tsx:136,272-338`(설치 PWA 전용) |
| Google Drive 워크스페이스 미러(30분 cron+webhook·soft delete·LWW·끊김 안내) | ✅ | `services/gdriveMirror.js`, `gdriveWatchCron.js:95-96`, `routes/cloud.js:26-124`, `CloudConnectNotice.tsx` |
| 개인 Drive 가져오기(AttachmentField 안·drive.file·쿼터) | ✅ | `DriveImportSection.tsx:75,113,148`, `personal_drive.js:26-43,243`, `driveImport.js:136-203` |
| Q file «내 파일(Drive)» 탭 | 🟡 | 읽기 목록+새 탭 열기만(`PersonalDriveTab.tsx:95-104`); 미연결 CTA 가 `window.location.href`(`:63`) — 탭 모드 전체 리로드 |
| 개인 보관함(5탭 — 개요·문서·파일·정보·노트) | ✅ | `PersonalVaultPage.tsx:25,89-105`; 파일 탭 = DocsTab personal(평면). 서버 술어가 레거시 `visibility:'L1'`(`personal_vault.js:23-30`) — 정본은 `vlevel`(`access_scope.js:539`); dev 불일치 190행은 전부 삭제분 |
| 휴지통(파일·문서·정보 한 서랍·복구·영구삭제·비우기·보관일 표시) | ✅ | `TrashDrawer.tsx:52-88`, `FileTrashPanel.tsx:73-105`, `file_trash.js`, `content_trash.js` |
| 휴지통 자동 비움 | 🟡 **화면≠실제** | `uploadCleanup.js:23-30,56-59` — `RETENTION_PURGE_APPLY=1` 없으면 **고정 30일** purge(dev .env 미설정); 화면은 플랜값(free 7·pro 90·enterprise 365, `config/plans.js`) 표시. **문서·정보 휴지통 cron 없음** |
| 삭제 확인 문구 | 🟡 | DocsTab`:1946,1970,1996` «30일 안에 되돌릴 수 있습니다» 하드코딩 |
| dedup 사용자 안내·즐겨찾기·최근·파일 댓글·파일 요청 링크 | 🔴 없음 | grep starred/favorite/file_comment/file_request 0 |
| 고객(Client) 접근 | 🟡 | 쓰기 전부 403 ✅; 목록은 본인 업로드만(`access_scope.js:561-610` client 분기 없음) 인데 다운로드는 L2/L3 허용(`:798-809`) — «못 본다» 쪽 불일치 |
| 모바일 | 🟡 | ≤900px 트리가 목록 위에 쌓임(DocsTab`:2680,2692`), 트리 접기/서랍 없음 → 폰에서 긴 스크롤 |
| i18n | 🔴 | `locales/{ko,en}/qfile.json` 3키뿐 — `tabs.*`·`drive.*` 14키가 `t()` 기본값(한국어) → **영어 사용자에게 한국어로 뜸**(`QFilePage.tsx:36-41`, `PersonalDriveTab.tsx:46-77`) |
| AttachmentField 단일 진입점 | 🟡 | 자체 `<input type=file>` — `QBill/InvoiceDetailDrawer.tsx:1124`, `TaxInvoicesTab.tsx:320`, `PostTableGrid.tsx:880` |

### 1-C. Q info (KB) · Q위키
| 기능 | 상태 | 근거 |
|---|---|---|
| 수동 생성(제목·본문·첨부·항목 custom_columns 6타입·보안등급·L1~L4·대상 멤버/고객) | ✅ | `routes/kb.js:151` → `services/actions/kb_actions.js:38`(화면·AI 에이전트 동일), `services/kbFields.js:33-40,112-150` |
| 텍스트 파일 업로드·기존 파일/문서 → KB·AI ingest(붙여넣기)·CSV ingest(중복 skip/update) | ✅ | `routes/kb.js:168-249,252,341,1046,1154,1282-1296` |
| PDF/DOCX/XLSX ingest | 🔴 없음 | `routes/kb.js:45,250`(«향후 추가») — 파일 자동색인(`services/fileIndex.js`)과 별개 |
| URL 수집 | ⬜ 의도적 제외 | `KbAiIngestModal.tsx:113`(SSRF) |
| 번역(source_language/auto_translate/translation_visibility/translations) | 🔴 **거짓 UI** | 모달이 «두 언어 자동 번역(Cue 차감)» 스위치를 보여줌(`KbAiIngestModal.tsx:301-327`), 컬럼 저장만(`routes/kb.js:1368-1370`), **실행·읽기 코드 0**, DB 0/109 |
| parent_doc_id 분리 | 🔴 쓰기만 | `routes/kb.js:1347-1375`, 읽는 곳 0 |
| 임베딩(text-embedding-3-small·180단어/겹침 20·실패 status) | 🟡 | `services/llm.js:83`, `services/kb_service.js:56,92,126`. **재색인 라우트(`kb.js:699`) 화면 호출 0 · failed 를 화면이 안 그림 · 임베딩 플랜 게이트 0** |
| 자동 태그 | 🟡 | `extractTags` 는 단건 생성만(`kb_actions.js:157`); 업로드·import·batch 는 안 부름 |
| 화면 검색 | 🟡 **제목 LIKE 만** | `routes/kb.js:102`, placeholder «제목 검색…»(`locales/ko/knowledge.json:10`). 하이브리드 `POST kb/search`(`kb.js:1416`) **프론트 호출 0** |
| 전역 검색(⌘K) | ✅ | `services/searchScope.js:343-382`, 하이라이트 `GlobalSearchModal.tsx:200` |
| Cue 연동(Q helper·고객 자동응답·제안·메일 FAQ·업무 research)·출처 표시 | ✅ | `cue_context.js:1366-1380`, `cue_orchestrator.js:147-156,224-241`, `ChatPanel.tsx:1956` |
| Pinned FAQ | 🔴 고아 | CRUD `kb.js:822-933`, 프론트 0, DB 0 — Cue 프롬프트만 소비 |
| 프로젝트>정보 탭 | 🟡 베낀 축소판 | `ProjectKnowledgeTab.tsx:300,401`(자체 모달·보안등급·휴지통·항목·CSV·RichEditor 0) — `KnowledgePage` 는 `embedded` prop 이 이미 있다(`:98`). CLAUDE.md «본체에 scope 를 받게 하고 얹는다» 위반 |
| 자동저장 계약(AutoSaveField) | 🟡 | `KnowledgePage.tsx` import 0 — `onBlur` 직접 PUT(`:1916,1987,2060,2314,2332`), 가드 베이스라인에 없어 안 잡힘 |
| 공유 링크(단건 비밀번호·만료·PDF·번들)·휴지통·정렬·실시간 | ✅ | `kb.js:1434-1600,1637-1748,659-697`, `KnowledgePage.tsx:26,377,396,832` |
| 버전 | 🔴 | `version` 항상 1, 리비전 표 없음 |
| Q위키 — 카테고리·목록·검색(ngram FULLTEXT, 제목·요약)·상세·관련글·ko/en 블록·스크린샷·맥락 도움말(CueHelpDrawer)·질문 로그·클러스터 제안·새소식 연결 | ✅ | `routes/wiki.js:89,117,169,195,232`, `wikiSearch.js:84`, `CueHelpDrawer.tsx`, `admin_wiki.js:237,266`, `WhatsNewPage.tsx:54` |
| Q위키 관리자 편집기 | 🟡 | 플레인 블록(text/heading/step/callout/image) — 리치 편집 없음(`AdminWikiPage.tsx:5`) |

### 1-D. Q Note (음성 회의·메모)
| 기능 | 상태 | 근거 |
|---|---|---|
| 실시간 녹음(마이크·화상회의 탭 2채널)·Deepgram nova-3·diarize·키워드 부스팅·일시정지/재개·이어하기·녹음 잠금(acquire/heartbeat/release) | ✅ | `q-note/services/deepgram_service.py:44-70`, `routers/live.py:416`, `routers/sessions.py:727-780`, `StartMeetingModal.tsx:126` |
| 끊김 시 상태 | ✅ paused 로 | `live.py:1163`. 단 dev 에 **status=recording 37건**(완료 25건보다 많다) — 옛 데이터인지 현재 누수인지 ⬜ |
| 음성 파일 업로드 STT(8포맷·200MB·prerecorded diarize·동시 1건) | ✅ | `services/qnote.ts:793-794`, `routers/audio_upload.py:79,111`, `deepgram_prerecorded.py:53-59` |
| **오디오 보관·재생** | 🔴 없음 | 라이브는 디스크에 안 씀(`live.py` grep open/write 0), 업로드 원본은 STT 끝나면 삭제(`audio_upload.py:273`); FE `<audio>` 0건 |
| 요약(key_points + full_summary, gpt-4o-mini) | 🟡 수동 | `llm_service.py:960-998`; FE 버튼으로만(`QNotePage.tsx:1526`), 종료 시 자동 없음(`:1481` 직후 호출 0). dev 요약 4/66 |
| 결정사항·액션아이템 구조화 | 🔴 | 요약 스키마가 `key_points/full_summary` 둘뿐(`llm_service.py:966`) |
| 업무 추출→후보→등록/거절 | ✅ | `components/QNote/NoteTaskExtract.tsx`, `routes/qnote_bridge.js:32-108`, `QNotePage.tsx:3285`, `MemoView.tsx:112` |
| 요약→Q docs 문서 저장 | ✅ | `QNotePage.tsx:1538-1557`, `MemoView.tsx:121-127` |
| 노트→상담 저장(SaveToSale) | ✅ | `SaveToSaleModal.tsx`, CLAUDE.md 박제 |
| 텍스트 메모(PostEditor 풀·분류/태그·요약) | ✅ | `MemoView.tsx:5,27,102` |
| 실시간 질문 감지→답변 생성(회의 자료 RAG·QA pairs·우선 QA CSV·번역) | ✅ | `live.py:779-800`, `sessions.py:2334-3004`, `QNotePage.tsx:1247-1259,1961` |
| 목소리 프로필→화자 자동 이름(멤버·고객 등록) | ✅ | `live.py:109,722,730`, `components/Profile/VoiceProfileSection.tsx`, `ProfilePage.tsx:792`, `ClientHomePage.tsx:116`(커밋 `0598039d`) |
| 전사문 **텍스트 편집** | 🔴 없음 | utterance 라우트는 화자 재지정만(`sessions.py:2198`) |
| 공개 공유 링크 | 🟡 | 토큰 발급/회수 ✅(`sessions.py:1679,1725`), 공개 페이지 ✅(`PublicQNoteSessionPage.tsx`). **만료 — 컬럼만**(`share_expires_at` 쓰는 곳 0, 읽기 `:3053`), **비밀번호 없음**, 외부 참석자 동의 체크 ✅(`:1706`) |
| 목록 — 검색·분류 필터·공개범위·프로젝트/고객 연결 | 🟡 | 서버 `q/visibility/project_id/client_id` 지원(`sessions.py:1296-1310`); **FE 는 `listSessions(businessId, 1, 20)` 고정(`QNotePage.tsx:690`) + 클라이언트 필터(`:947-957`)** → 21번째 노트부터 목록에서 못 찾음(dev biz 3 = 59건) |
| 전사문 내보내기(txt/복사/다운로드) | 🔴 없음 | `QNotePage.tsx` grep download/export/clipboard 0 (데이터 반출 zip 만 `exportJobWorker.js:27`) |
| 과금(월 분 한도·4030/4031·크레딧 소진 안내·네이티브 문구) | ✅ | `QNotePage.tsx:1104-1115,1304-1305`, `internal.js:231,303` |
| 마이크 거부 안내 | ✅ | `QNotePage.tsx:1426` |
| 화면 꺼짐 방지(wakeLock) | 🔴 없음 | grep 0 |
| 두 밴드 헤더·폰 규칙 | ✅ | `QNotePage.tsx:2904,3104,3933`(PanelHeaderBar 상속) |
| i18n | ✅ | qnote.json ko 435 / en 435, 차이 0 |
| AI 에이전트 도구(get/search_meeting_note·create_memo) | ✅ | `sessions.py:111,310,384`(내부 키) |

---

## 2. UX 점수·격차 (10점)

| 영역 | 점수 | 근거 · 최고 수준(Notion/Google Docs/PandaDoc/Drive/Guru/Otter)과의 격차 |
|---|---|---|
| Q docs 편집·목록 | **7** | 편집기 충실·자동저장·두 밴드 계약 준수. 격차: 입력까지 3~4클릭([+]→드롭다운→AI모달→[빈 문서]) · 댓글/멘션 0 · 동시편집은 늦은 쪽 409 · 슬래시 명령·임베드 없음 · 버전 diff 없음 · 핀 토글 없음 · 자체 모달(`PostsPage.tsx:2850-2870`)·생 px 900(`:2783`) 혼용 · 3,467줄 파일 |
| 서명·확인 요청 | **7** | 3단계 모달·OTP·동결본·받은 서명함은 PandaDoc 급. 격차: 순차 서명·자동 리마인드·만료 cron 없음, «열람됨» 은 `viewed_at` 만, 진행표가 토큰을 그대로 노출(보안 §5) |
| 표 문서·설문 | **5** | 칸 17종·집계는 좋으나 정렬·필터·CSV·뷰가 없어 «표» 가 아니라 «목록 입력기». 설문은 완성이나 dev 사용 0 |
| Q File | **6** | 업로드(폴더째·재시도·중복 질문)·DnD 이동·zip·보안등급·Drive 미러·휴지통 한 벌은 Drive/Dropbox 급. 격차: 폴더 이동 불가 · 버전 이력 없음 · Office 미리보기 없음 · 검색이 파일명만(본문 색인은 Cue 전용) · 종류/올린이/태그 필터 없음 · «공유 링크» 가 두 정책(페이지 링크 vs raw URL, 후자는 해제 불가) · «내 파일» 이 두 뜻 · 삭제 문구 30일 vs 헤더 플랜값 · qfile i18n 기본값 한국어 · 폰에서 트리가 위에 쌓여 긴 스크롤 · 2,924줄 컴포넌트 |
| Q info(KB) | **5** | 생성 경로는 풍부(수동·파일·문서·AI·CSV)·공유·휴지통·실시간 OK. 격차: **화면 검색이 제목만**(뜻검색은 서버에만) · 번역 스위치가 거짓 · 색인 실패 안 보임 · 프로젝트 탭 축소판 · 용어 5가지(Q info/지식/정보/인포/대화 자료) · 헤더 버튼 5개 폰 wrap(`KnowledgePage.tsx:734-755,2147`) · Guru 식 검증/만료/담당자 메타 0 |
| Q위키·맥락 도움말 | **7** | 카테고리·ngram 검색·ko/en·linked_route 도움말·질문 로그→클러스터 제안은 고급. 격차: 관리자 편집기가 플레인 블록, visibility 미사용 |
| Q Note | **6** | 실시간 STT·화자 자동이름·질문→답변·업무 추출·문서 저장·상담 저장까지 «기록→실행» 문이 다 있다. 격차: **목록 20건 상한** · 오디오 없음(Otter/Fireflies 는 재생+클릭 싱크가 핵심) · 요약 수동+결정/액션 비구조 · 전사 편집 불가 · 내보내기 없음 · 공유 만료/비밀번호 없음 · wakeLock 없음 · 시작 모달 2,161줄(항목 다수 — 첫 사용자 부담) |

**공통 격차**: ① 영역마다 «서버는 되는데 화면이 없는» 기능이 1~3개씩 ② 같은 «공유 링크» 가 문서(비밀번호·만료 서버만)·KB(둘 다 있음)·Q Note(만료 컬럼만)·파일에서 **옵션이 다르다** ③ 협업 레이어(댓글·멘션·동시편집)가 content 영역 전체에 없다 — 피드백은 채팅으로 우회.

---

## 3. 확장 기능 제안

| # | 문제(사용자 말) | 제안 | 기대효과 | 규모 | R | 우선 |
|---|---|---|---|---|---|---|
| 1 | «문서에 바로 의견을 달 수가 없어서 채팅으로 왔다갔다 해» | 문서 댓글(블록 앵커)+@멘션+알림(`notify`), 업무 댓글(`task_comments`) 모델·`NoteThread` 재사용 | 검토 루프가 문서 안에서 끝남 | L | 0(S=1) | P1 |
| 2 | «회의 끝났는데 요약을 또 눌러야 하고, 결정사항이 어디 있는지 모르겠어» | 종료 시 자동 요약 + 스키마 `{summary, decisions[], action_items[{who,what,due}]}` → 액션아이템은 기존 후보(`task-candidates`)로 바로 적재 | 종료→업무 등록 클릭 5→1 | M | 0 | P1 |
| 3 | «녹음을 다시 들을 수가 없네» | 오디오 보관 옵션(워크스페이스 설정·보존기간·스토리지 쿼터 합산) + 전사 클릭→재생 싱크. 개인정보라 **기본 꺼짐**·동의 문구 | Otter 급 신뢰(전사 오류 검증) | L | **1**(생체·보관) | P2 |
| 4 | «표에서 정렬이 안 돼. 엑셀로 빼고 싶어» | q_records 정렬·필터·CSV 내보내기/가져오기(서버 `records.js` + `PostTableGrid`) | 표 문서 실사용 | M | 0 | P1 |
| 5 | «Q info 에서 찾으면 안 나오는데 Cue 는 아네» | 화면 검색을 `POST kb/search` 하이브리드로 교체 + L1/L2 스코프 포함 + 하이라이트 | 검색 한 벌 | S | 0 | **P0** |
| 6 | «문서 링크에 비밀번호 걸고 싶어» | `PostShareModal` 에 비밀번호·만료 칸(서버 지원 완료) · Q Note 공유에도 만료(컬럼 있음) — **공유 모달을 공용 한 벌**로 | 공유 정책 통일 | S | 0 | P1 |
| 7 | «이 PDF 를 지식에 넣고 싶어» | KB ingest 에 PDF/DOCX — `services/fileText` 추출기 재사용(이미 파일 색인에 있음) | KB 적재량 ↑ | S | 0 | P1 |
| 8 | «정보가 오래된 건지 모르겠어» | KB 항목에 담당자·검증일·만료(Guru verify) + 만료 임박 확인필요 버킷 | 신뢰 가능한 KB | M | 0 | P2 |
| 9 | «서명 안 한 사람한테 자동으로 다시 보내줘» | 서명 리마인드·만료 cron(기존 cron 러너 재사용, 리마인드 라우트 있음) | 회수율 | S | 1(외부 발송) | P2 |
| 10 | «버전 되돌리기 전에 뭐가 달라졌는지 보여줘» | `post_revisions.js:44` 미리보기 연결 + 텍스트 diff | 복원 사고 ↓ | S | 0 | P2 |
| 11 | «전사문 오타를 고치고 싶어» | utterance 텍스트 편집 라우트+인라인 편집(화자 재지정 UI 선례) | 회의록 품질 | S | 0 | P2 |
| 12 | «회의록을 파일로 주세요» | 전사+요약 txt/DOCX 내보내기(`exportJobWorker.qnoteSessionToHtml` 재사용) | 고객 전달 | S | 0 | P2 |
| 13 | «파일 이름으로밖에 못 찾아» | Q file 검색창·전역검색을 `fileIndex` 본문 색인(이미 Cue 용으로 있음)에 연결 + 종류/올린이/태그 필터 | 파일 탐색 클릭 ↓ | S | 0 | P1 |
| 14 | «폴더를 잘못 만들었는데 옮길 수가 없어» | 폴더 `parent_id` PUT + 트리 폴더 DnD(`folderDrop.ts` 확장, 순환 검사) | 폴더 정리 가능 | S | 0 | P1 |
| 15 | «같은 파일 다시 올렸는데 예전 건 어디 갔어» | 파일 버전 사슬(`supersedes_file_id`) + 미리보기 «이전 버전 n» | 덮어쓰기 안전 | M | 0 | P2 |
| 16 | «워드/엑셀을 열어 봐야 알겠어» | Office 미리보기(서버 변환 PDF 캐시 — LibreOffice 는 서버 의존성, Fable 확인 필요) | 미리보기 클릭 1 | M | 0(S=1) | P2 |
| 17 | «공유 링크를 걸었는데 끊는 데가 없어» | 공유 링크 B 를 A(ShareModal)로 흡수 — 일괄 바 [공유 링크] 가 ShareModal 을 연다(4-4 공용 모달과 합침) | 공유 정책 한 벌 | S | 0 | **P0** |

---

## 4. 개선 설계 (바로 구현 가능 수준)

### 4-1. Q Note 목록 페이지네이션 + 서버 검색 (P0 · S)
- **문제**: `listSessions(businessId, 1, 20)` 고정(`QNotePage.tsx:690`), 검색은 그 20건 안에서만(`:947-957`). dev biz 3 은 59건 → 39건이 목록에서 사라져 있다.
- **와이어**: 좌측 목록 하단 `[더 보기 (39)]` 버튼 → 다음 20건 append. 검색창 입력 300ms 후 서버 `q=` 재조회(결과는 전체 집합).
- **건드릴 파일**: `pages/QNote/QNotePage.tsx`(loadSessions → page state·append, `sessionQuery` → 서버 `q`), `services/qnote.ts listSessions`(이미 page/limit 인자 있음). 신규 훅 `hooks/useIncrementalList.tsx` 가 작업 트리에 생기는 중이면 그것을 쓴다.
- **ko/en**: `page.loadMore` «더 보기 ({{n}})» / "Show more ({{n}})".
- **검증**: dev biz 3 로 로그인 → 목록 20 → 더 보기 → 40 → 59; 검색 «키워드» 가 21번째 이후 노트를 찾는지(양성 대조군: 21번째 노트 제목으로 검색).

### 4-2. 서명 라우트 권한 통일 + 토큰 제거 (P0 · S · R=1 → Fable 게이트)
- **문제**: §5 ①②. 
- **설계**: `routes/signatures.js` 멤버 라우트(목록 `:295`·scope `:314`·생성 `:111`·취소 `:350`·리마인드 `:370`)에 `canReadPost`(읽기)·`canEditPost`(생성·취소·리마인드) 적용. `serialize` 에서 `token`·`sign_url` 제거 — «URL 복사» 는 `POST /api/sign/request-link`(본인 메일 발송) 로 교체(CLAUDE.md 서명 절 선례). `signature_confirm.js` 는 OTP 는 없어도 되나(확인은 서명이 아님) 토큰이 안 새면 성립.
- **화면**: `SignatureProgressSection.tsx:122,307` 복사 버튼 → «링크 다시 보내기»(요청자) / «내 메일로 받기»(서명자 본인).
- **ko/en**: `signature.resendLink` «링크 다시 보내기» / "Resend link".
- **검증**: health-check `--category=secrets` 에 `sign_url`·`token` 문자열 검사 1건 추가(응답 원문). 멤버 B 가 A 의 L1 문서 `GET /posts/:id/signatures` → 403. 양성 대조군: 적용 전 200+token.

### 4-3. KB 화면 검색 → 하이브리드 (P0 · S)
- **문제**: 제목 LIKE(`routes/kb.js:102`) vs 서버 하이브리드(`:1416`) 미연결; `hybridSearch` 가 L1(private)·L2 를 뺀다(`kb_service.js:214-218`).
- **와이어**: 검색창 placeholder «제목·내용으로 검색» → 결과 행에 `HighlightText` + `MatchReason`(전역검색과 같은 부품). 입력 300ms debounce, 2자 이상.
- **건드릴 파일**: `KnowledgePage.tsx`(listKnowledge q → `POST /kb/search` 호출, 결과 id 로 목록 정렬), `services/kb_service.js hybridSearch`(docWhere 에 `canAccessKbDocumentByLevel` 과 같은 술어 — `kbDocumentsListWhereByLevel` 재사용, 청크 후보 캡 200→문서 수 기준), `routes/kb.js:1416`(client 차단 `:85` 와 같은 술어).
- **ko/en**: `search.placeholder` «제목·내용 검색» / "Search title & content"; `search.noResult` «‘{{q}}’ 에 맞는 정보가 없어요 — 철자를 바꾸거나 AI 로 추가하세요».
- **검증**: 본문에만 있는 단어로 검색 → 결과 ≥1(음성 대조군: 지금 0). L1 문서 본인 검색 → 보임, 다른 멤버 → 안 보임. 고객 토큰 `POST kb/search` → 403.

### 4-4. 공유 모달 한 벌 (문서·KB·Q Note·파일) (P1 · M)
- **문제**: 같은 «링크 공유» 가 영역마다 옵션(비밀번호·만료·PDF·범위)이 다르고, 문서는 서버만 지원·Q Note 는 만료 컬럼만.
- **와이어**: `[링크 만들기]` → 링크 칸 + 복사 / 옵션: 비밀번호(토글+입력), 만료(없음·7일·30일·날짜), 범위 안내 문구(«L2 로 좁히면 링크가 끊깁니다») / `[링크 끊기]`.
- **건드릴 파일**: 신규 공용 `components/Common/ShareLinkModal.tsx`(`StandardModal` 기반) — `PostShareModal`·KB 공유·`QNoteShareModal`·파일 공유가 props(`issue/revoke/update` 함수)만 넘긴다. 서버: `posts.js applyShareUpdate` 그대로, q-note `POST /share` 에 `expires_days` 추가(`share_expires_at` 기록).
- **ko/en**: `share.password` «비밀번호» / "Password", `share.expires` «만료» / "Expires", `share.expires.none` «없음» / "Never".
- **검증**: 문서 공유에 비밀번호 → 공개 GET 401 → 비밀번호 POST 200; Q Note 만료 7일 → DB `share_expires_at` 채워짐 → 만료 후 410.

### 4-5. 회의 종료 자동 요약 + 결정/액션 구조화 (P1 · M)
- **문제**: 요약은 버튼(`QNotePage.tsx:1526`), 결정·액션 구분 없음(`llm_service.py:966`). 업무 추출은 별도 버튼.
- **와이어**: 종료 → review 화면 상단 «요약 만드는 중…» 스켈레톤 → 3블록 [요약] [결정사항 n] [할 일 n → 업무 후보로]. 할 일 행마다 담당자(참석자 이름 매칭)·기한 추정 칩 + [등록].
- **건드릴 파일**: `q-note/services/llm_service.py generate_summary`(스키마 확장, 기존 `key_points` 유지), `routers/live.py`(finalize 후 `asyncio.create_task(summary)`), `QNotePage.tsx`(review 진입 시 폴링 또는 WS `summary_ready`), 액션아이템 → `routes/qnote_bridge.js extract-tasks` 입력으로 재사용(`TaskCandidateCard` 그대로).
- **ko/en**: `summary.decisions` «결정사항» / "Decisions", `summary.actions` «할 일» / "Action items", `summary.generating` «요약을 만드는 중…» / "Summarizing…".
- **검증**: 세션 종료 후 10초 내 `summary_full`·`decisions` DB 기록; Cue 사용량 1건 증가; 요약 실패 시 화면에 «다시 만들기» 버튼(실패 대조군: LLM 키 제거).

### 4-6. 프로젝트>정보 탭 = `<KnowledgePage embedded>` (P1 · S)
- **문제**: `ProjectKnowledgeTab.tsx` 베낀 축소판(보안등급·휴지통·항목·CSV·RichEditor 없음) — CLAUDE.md 2026-09-13 노트 탭과 같은 사고.
- **설계**: `KnowledgePage` 에 `scope={{type:'project', projectId}}` 추가(embedded 는 이미 있음 `:98`), 목록 범위·새 항목 기본 project_id·탭 제목 `useTabTitle(…, false)`. `ProjectKnowledgeTab` 은 얹는 껍데기로 축소. `data-testid="project-tab-body-knowledge"` 유지.
- **검증**: `--suite projecttabs` 12탭×3폭 통과 + 프로젝트 탭에서 보안등급 변경·휴지통 열림(음성 대조군: 지금 버튼 없음).

---

## 5. 버그·위험 발견

| # | 심각도 | 내용 | 근거 |
|---|---|---|---|
| 1 | **높음** | 서명 요청 목록이 `token`·`sign_url` 을 멤버 전원에게 내려주고(`signatures.js:295-310`, `serialize :666-667`) 화면이 «URL 복사» 로 노출(`SignatureProgressSection.tsx:122`). 확인 요청 `POST /sign/:token/confirm` 은 OTP 없음(`signature_confirm.js:28`) → **아무 멤버나 고객 대신 «확인»** 가능. CLAUDE.md «서명자별 링크를 여러 사람이 보는 방에 올리지 않는다» 와 충돌(채팅 카드만 뺐고 진행표는 그대로) | 직접 재확인 |
| 2 | **중** | `signatures.js` 멤버 라우트(목록·scope·생성·취소·리마인드)가 `assertMember` 만 봄 → id 만 알면 **남의 L1 문서** 서명 목록·토큰 획득, `GET /api/sign/:token` 이 동결 본문 반환(`signature_public.js:14-100`); 남의 문서로 외부 서명 요청·남의 요청 취소 가능 | `signatures.js:111-120,314,350,370` |
| 3 | **중** | 옛 Document 공개 서명 `POST /api/docs/public/:token/sign` — OTP·레이트리밋·이메일 검증 없음(`docs.js:888-955`). Cue 가 Document 를 만들 수 있어 죽은 표면이 아님(`cue_tools.js:17`) | |
| 4 | **중** | KB `PUT /kb-documents/:id/security-level`·`DELETE …/share` 가 `isMemberOrAbove` 만(`routes/kb.js:1463-1470,1483-1507`) → 멤버가 남의 L1 항목 등급 변경·공유 해제. `POST kb/search` 는 client 미차단(`:1416` vs 목록 `:85`) | 직접 재확인 |
| 5 | **중** | 위키 공개 이미지 `LIKE '%"file_id":12%'`(`routes/wiki.js:238-243`) 가 `"file_id":123` 에도 매치 → 발행 글이 123 을 참조하면 **무인증으로 file 12 서빙** | 직접 재확인 |
| 6 | **중** | KB `documents/batch`(500건×50,000자) 임베딩에 플랜/레이트 게이트 0(`kb.js:1251-1395`), `ai-ingest` 는 `use_cue` 만(`:1058`) — 비용폭탄 계열 | |
| 7 | **중** | KB AI ingest 번역 스위치 3종이 저장만 되고 실행 0(거짓 UI, `KbAiIngestModal.tsx:301-327`) | |
| 8 | **중** | Q Note 목록 첫 20건 고정(`QNotePage.tsx:690`) — 21번째부터 못 찾음 | 직접 확인 |
| 9 | **중** | KB 하이브리드 검색 후보 = 최근 200청크(`kb_service.js:237-240`, id DESC) — 100KB 초과 워크스페이스에선 옛 문서가 검색 대상 밖; L1 은 본인에게도 0(`:214-218`) | |
| 10 | **중** | 문서 공유 비밀번호 — 실패 잠금 없음(`share_helper.js:56-64`), 공개 GET 전용 레이트리밋 없음 | |
| 11 | **중** | 문서 `share-to-chat`(`posts.js:1604-1623`)·서명 카드(`signatures.js:245-263`)가 `Message.create` 만 — `message:new`·`notify` 없음 → 상대는 새로고침 전까지 못 봄(CLAUDE.md 13·16번 위반) | |
| 12 | 낮 | 문서 admin 권한 불일치(공개범위 `posts.js:1024-1027` vs 보안등급 `:1478-1481` vs 삭제 `:1086`) · PUT `status` 무검증(`:894`) · 첨부 해제 `assertMember` 만(`:1138-1158`) · 서명 만료 cron 없음(`signatureCore.js:42`) | |
| 13 | 낮 | `help-feedback` 무인증으로 임의 log_id 평가(`routes/cue.js:478-494`) · KB `?project_id=abc` → `IS NULL` 로 뜻 변경(`kb.js:100`) · Cue 고객 응답 재료가 L2 멤버지정 문서까지(`cue_context.js:1372-1375`) | |
| 14 | 낮 | dev Q Note `status=recording` 37건 > completed 25 — 탭 닫힘 누수인지 옛 데이터인지 ⬜(운영 확인 필요) | SQLite 실측 |
| 15 | 낮 | 문서 검색 `content_text` 5,000자 절단(`posts.js:90`) | |
| 16 | **중** | 폴더 «같이 삭제» 가 파일 삭제 권한 우회 — `file_folders.js:258-298` `assertMemberWrite`(아무 멤버)만 보고 안의 파일 전부 `trashFile`; 단건은 `canMutateFile`(본인·오너·PM, `files.js:953-968,1385`) 필요 → 일반 멤버가 남의 파일을 폴더째 휴지통행(복구 가능) | 직접 재확인 |
| 17 | **중** | 해제된 멤버가 폴더 생성·수정·삭제 가능 — `file_folders.js:17-21 assertMemberWrite` 가 `removed_at: null` 을 안 봄(정본 `access_scope.js:60-62` 는 봄) | |
| 18 | **중** | 휴지통 보관 약속 ≠ 실제 — 화면은 플랜 일수(pro 90·enterprise 365)인데 cron 은 `RETENTION_PURGE_APPLY` 없으면 30일 purge(`uploadCleanup.js:23-30,56-59`) → **비가역 바이트 삭제**. dev .env 미설정(운영 확인 필요). 문서·정보 휴지통은 cron 자체 없음 | 직접 재확인 |
| 19 | **중** | 공유 링크 B 해제 불가(`revokeShareLink` 호출 0) + `DELETE /:biz/:id/share-link`(`files.js:1790-1810`)·`DELETE /:id/share`(`:141-157`) 는 업로더·가시성 검사 없이 멤버면 해제 — 생성(`:117`)과 불일치 | 직접 재확인 |
| 20 | **중** | multer 가 5GB 까지 디스크에 쓴 뒤 플랜 검사(`files.js:453-456` → `:717-725`) — 300/분 × 대용량으로 임시 디스크 점유 가능(nginx 2GB 상한만 방어) | |
| 21 | 낮 | `content_trash.js:68-73` Q info 휴지통이 business_id 만(남의 L1 제목 노출)·영구삭제 모든 멤버(`:44-50`)·`paginatedResponse` total=페이지 크기(`:95`) · 휴지통 비우기 500건 상한 침묵(`file_trash.js:187`) · `file.delete` 감사가 없는 컬럼 참조(`files.js:1400` original_filename/size_bytes → undefined/0) · 폴더 생성·이름변경 broadcast 없음(`file_folders.js:97-243`) · `fileListWhere`(client 분기) 호출처 0 = 죽은 코드(`access_scope.js:298-308`) | |

> 1·2·3·4·5 는 R=1(가시성·증빙·무인증 표면) — 수정은 Fable 게이트. 나머지는 자체 검증 가능(F=1).
