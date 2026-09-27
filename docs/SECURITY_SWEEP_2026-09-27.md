# 보안 설정 점검·수리 (2026-09-27) [Opus]

> Irene: *"오늘 이슈들 보안설정이랑 연결되는 거 많으니까 보안설정 기본 체크 좀 하고 개별 업무나 개별 문서마다
> 보안 설정한 거, 공유범위랑 제대로 구조화되서 엇나가는 문제 없는지 확인해."* → *"다 처리해"*

조사 2건(엔티티별 축 인벤토리 · 엔티티 간 누수 경로) 결과를 한 목록으로 합쳤다. 판정 규칙(통일):

1. **공유 링크는 볼 수 있는 사람만 만든다** — 발급 = 읽기와 같은 술어(canReadPost · canAccessFileByLevel/canDownloadFile · canAccessKbDocumentByLevel …).
2. **범위를 좁히면(L1/L2) 기존 링크는 끊는다** — 달력(calendar.js:589)이 선례. 다시 원하면 명시 재발급.
3. **비밀번호 공유는 모든 하위 주소가 비밀번호를 본다** — `share_helper.verifyShareSub`/`shareSubQuery`(서명 `dl`).
4. **보안등급(internal/confidential)은 밖으로 나가는 모든 문에서 막는다.**
5. **참조(첨부·연결·카드)는 붙일 때 원본 읽기 권한을 보고, 보여줄 때 보는 사람 기준으로 다시 본다.**

## 진행

### 비밀번호 우회
- [x] OG 미리보기 — 비밀번호 공유는 종류만(post·task·file·kb·calendar) + 일정은 shareOpenReason
- [x] posts PDF · 첨부 다운로드 (+ 공개 문서 화면 비밀번호 입력창 · pdf_url)
- [x] kb PDF (+ pdf_url) · files `/public/:token/download`

### 발급 = 읽기 권한
- [x] posts /share · /share/email · /share-to-chat(+대화방 참여)
- [x] files /:id/share(+보안등급) · /share-link
- [x] kb /share
- [x] share.js /email · /chat — 엔티티 읽기 + 일정 L1/L2 + 업무 shareBlockedBy + 대화방 참여
- [x] kb 번들 — 선택: 읽기 권한 / 열 때: L1·L2 제외(카테고리·선택 모두)

### KB 판정 한 벌
- [x] access_scope canAccessKbDocumentByLevel · kbDocumentsListWhereByLevel = 화면 목록 규칙
- [x] kb 목록·상세·PUT·share·/kb/search · 통합검색 kbWhere
- [x] conversations.js KB 추천 · email_threads FAQ docWhere
- [x] 고객 대상 Cue KB — security_level general 만

### 범위 축소 시 토큰 회수 (+ 보안상향 시 pw_hash 도 지움)
- [x] post(PUT /:id vlevel · PUT /visibility) · file visibility PUT · kb PUT — qnote(python)은 아래 qnote 항목
- [x] post PUT vlevel=L4 보안등급 게이트 · file L4 전환 보안등급 게이트

### 참조·복사
- [x] task_attachments /attachments/link post_ids → canReadPost · commentId 소속 검증
- [x] task attachments ?context=all · download — 고객에게 internal/personal 댓글 첨부 제외
- [x] 일정 미팅자료 — 붙일 때 읽기 권한 + 조회 시 보는 사람 기준
- [x] 문서 linked_post_ids · post_attachments 추가(canReadPost + canUserSeeFile)
- [x] KB 첨부·import(from-file/from-post)·생성 본문 병합 — 원본 읽기 권한
- [x] brief — 원본 읽기 권한
- [x] 업무 copy — canAccessTask
- [x] 문서 duplicate — target_member_ids 복사

### 메일
- [x] resolveAttachments — 파일 읽기 권한 + 보안등급
- [x] forward — 스레드 접근 검사(답장과 같은 것)
- [x] emailFaqCluster — 공용 계정(owner_user_id NULL) 메일만

### 실시간 방송
- [x] broadcastPost · broadcastFile · broadcastEvent — 행 전체 대신 id·최소 필드(또는 보는 사람별)

### 고객
- [x] 고객 문서 목록 — `?project_id=` 가 프로젝트 제한을 덮어쓰던 기존 누수(Op.and 로)
- [x] canDownloadFile·canAccessPost 고객 분기 — vlevel 반영(L1 제외)

### 기타
- [x] files/public-image — findSourceFile(liveOnly) 로 가장 좁은 등급 행
- [x] 사본 이미지 경로(denyPrivateCopy) — security_level 게이트
- [x] isPublicFile — L4 + general
- [x] all-files post 출처 · 프로젝트 files — 문서 vlevel 필터(+파일 등급)
- [x] 통합검색 — 프로젝트는 목록과 같은 범위(유지) · qtask/qsale 메뉴 숨김이면 결과 비움 · KB 칸 값 raw SQL 재필터
- [x] stats 전 라우트 requireMenu('insights','read')
- [x] adminWiki 옛 `text` 키 편집기 빈칸
- [x] qnote 공유: 발급 시 외부참석자 동의 검사. **L1 발급·범위 변경 시 회수는 유지**(공유 창이 외부 링크를 별도 컨트롤·해제 버튼으로 다룬다 — 생성자만 발급)
- [ ] qnote 비밀번호·만료 — 스키마 추가 필요(SQLite), 이번 범위 밖

## 판단 보류 / 범위 밖
- 게스트 문서 L2·L3 공개(guestPost 의도 명시) — 그대로
- 이미지 게이트 L2/L3 단계(계측) — 그대로
- 업무 자체 보안등급 축 신설 — 하지 않음(Fable 2026-09-27: 첨부에서 파생)

## 검증 (자체, 2026-09-27)
- 실HTTP 44항목 PASS(1차 31 · 2차 13), 잔여 0 — 발급 403 5종 · KB 목록/상세/PUT/검색/번들 · 비밀번호 PDF 401·서명 200·위조 401 ·
  OG 봇 본문 없음(대조: 비번 없는 글은 제목) · 범위 축소 회수(post·file+pw) · 고객 L1 제외·?project_id 덮어쓰기 · 고객 업무 복사 403 ·
  업무 첨부 L1 문서 404·남의 댓글 404·고객 내부댓글 첨부 목록/다운로드 · 미팅자료 L1 제외 · KB import/brief 404 · 복제 target_member_ids ·
  L4 게이트 · 통계 insights=none 403(대조 owner 200) · 소켓 post:updated 신호만
- health-check 48/48 · guard 59/60 · tenant 9/9 · docsdup+signature 0 fail · build EXIT 0
- ⬜ 미측정: 메일 첨부/전달(계정 픽스처 없음) · public-image 좁은 행 · 사본 이미지 보안등급 · 고객 미팅자료 화면 필터 · Cue 외부 KB general ·
  FAQ 공용계정 · 대화방 KB 추천 docWhere · qnote 동의(파이썬) · OG task/file/kb/calendar · kb PDF·파일 옛 다운로드 비번
