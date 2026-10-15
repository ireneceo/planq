# 문서 댓글 설계 (Q docs) — Fable 설계 판정 2026-10-15

> Irene: *"문서에 댓글들 남길 수 있게"*
> 범위: 문서(posts) 한 건에 시간순으로 쌓이는 댓글. **답글(스레드)·본문 위치 지정(인라인) 댓글·편집은 이번에 넣지 않는다**(아래 «뺀 것»).

## 0. 한 줄 원칙
- **댓글은 문서에 달리는 기록이다.** 볼 수 있는 사람 = 문서를 읽을 수 있는 사람(`services/postAccess.canReadPost`) — 새 술어를 만들지 않는다.
- 업무 댓글(`task_comments`·`task_actions.createComment`)을 **형제 문**으로 삼는다. 다른 점은 이 문서에 이유를 적는다.
- 문서 밖(공유 링크·PDF·서명본·게스트·AI get_document·검색)으로 **댓글은 한 글자도 나가지 않는다.**

## 1. 데이터 — 새 표 `post_comments`
| 컬럼 | 형 | 비고 |
|---|---|---|
| id | BIGINT PK AI | |
| post_id | INT NOT NULL FK posts(id) ON DELETE CASCADE | 영구삭제가 댓글까지 지운다 |
| business_id | INT NOT NULL | 테넌트 WHERE 용 — 문서의 business_id 를 서버가 복사 |
| user_id | INT NOT NULL FK users(id) ON DELETE CASCADE | 작성자(멤버·고객) |
| content | TEXT NOT NULL | 평문, 상한 5,000자 |
| visibility | ENUM('internal','shared') NOT NULL DEFAULT 'internal' | internal = 멤버만 · shared = 멤버 + 문서를 읽을 수 있는 고객. `personal` 없음 |
| created_at / updated_at | DATETIME | |

인덱스 `(post_id, created_at)` · `(business_id)`. vlevel 미러 없음 — 문서 범위를 그대로 상속한다.

## 2. 누가 읽고 쓰나
| 사람 | 읽기 | 쓰기 |
|---|---|---|
| 멤버(owner/admin/member) | `canReadPost` 참이면 전부 | internal(기본) 또는 shared |
| 고객 계정 | `canReadPost` 참이면 **shared 만** | 서버가 shared 로 강제 |
| 공개 링크·게스트·설문 응답자 | 안 됨 | 안 됨 |

- L1 문서는 작성자만 읽으므로 댓글도 작성자만(owner/admin 도 못 본다).
- kind 전부 허용 — 판정은 `canReadPost` 하나.
- `personal` 을 뺀 이유: 댓글은 남에게 보이는 글이다. 나만 보는 메모는 Q note.
- «고객도 봄» 선택지는 서버 판정 `meta.can_share_with_clients`(문서 project_id 가 있고 그 프로젝트 고객 ≥ 1)일 때만.

## 3. 삭제·편집
- 편집 없음(이번 판). 삭제 = 작성자 본인 또는 owner/admin, 둘 다 그 시점에 `canReadPost` 참. 하드 삭제. 자리 남기지 않음.
- 감사 `post.comment_create`·`post.comment_delete` — `{comment_id, post_id, visibility, author_id}` 만, 본문 금지.

## 4. 알림
- 만드는 곳: `services/actions/post_actions.createComment` 한 곳.
- 멘션: `resolveMentions` → `canReadPost` 로 거름 → `comment_mention`, 제목키 `doc_comment_mention`.
- 일반: 문서 작성자 + 이전 댓글 작성자, 본인·멘션 제외, 각자 `canReadPost` 재판정, internal 이면 고객 제외 → 새 종류 `doc_comment`(ENUM 끝 append, 알림 설정에서 따로 끌 수 있게), 제목키 `doc_comment`.
- 본문 앞 80자 · `previewPolicy:'excerpt'`(업무 댓글과 같다 — 앱 안엔 80자, 푸시·재알림 메일엔 앞 40자. 행의 preview_policy 칸은 internal_only 로 저장) · `skipChannels:['email']` + `suppressEscalation`(미읽음 재알림 메일도 없음).
- (구현 메모 2026-10-15) 고객 없는 문서에 shared 를 보내면 internal 로 낮춘다 · 고객이 internal 댓글을 지우려 하면 404.
- 링크 `/docs?post=<id>&comment=<cid>`(고객도 같은 문서 주소 — 기존 문서 알림 경로).

## 5. 실시간
- 사건 `post:comment` 하나(생성·삭제), 신호만 `{id: post_id, business_id, project_id, comment_id}`. posts.js broadcast 헬퍼로 `business:` + `emitProject`. `CLIENT_VIEW` 에 signal 등록.
- 받는 화면: 열려 있는 문서와 같을 때만 다시 읽음(250ms) + `useVisibilityRefresh`.

## 6. API — `routes/post_comments.js`, `/api/posts` 에 posts.js 보다 앞
| GET `/api/posts/:id/comments` | `canReadPost` | paginated(200/500, created_at ASC) + `meta{viewer_kind, can_share_with_clients}` |
| POST `/api/posts/:id/comments` `{content, visibility?}` | `canReadPost` | 201, 1건 |
| DELETE `/api/posts/:id/comments/:cid` | 작성자 또는 owner/admin ∧ `canReadPost` | `{deleted:true}` |
- 문서 없음·휴지통·못 읽음 → 404. 행 모양 `{id, post_id, content, visibility, user_id, author_name, author_kind, created_at, can_delete}` — toJSON 통째 금지.
- 상세 응답에 `comment_count`(보는 사람 기준). 목록 행에는 넣지 않음.

## 7. 생명주기 — 읽을 때 판정
휴지통 → 404, 복원 → 돌아옴 · 영구삭제 → CASCADE · 복사 → 따라가지 않음 · 프로젝트 이동 → 함께 감(고객 가시성 재판정) · 범위 좁힘·고객 접근 상실 → 못 봄 + 알림 제외 · 공유 링크·PDF·서명본·OG·get_document·검색 → 포함 안 함.

## 8. 화면
- PostsPage 보기 모드, 첨부 절 아래 `components/Docs/DocCommentsSection.tsx`. 편집 모드·공개 페이지엔 없음.
- `NoteThread` 재사용 + `visibilityOptions` 확장(넘기지 않으면 기존 동작 그대로).
- 멤버 + 고객 있는 문서 → [팀만 | 고객도 봄], 기본 팀만. 그 밖 → 토글 없음. shared 행엔 «고객도 봄» 칩, 고객이 쓴 행엔 «고객» 칩.
- 삭제는 `can_delete` 행에만. 초안 kind `post-comment`. `?comment=` 로 열리면 스크롤 + 하이라이트.
- testid `doc-comments-section`·`doc-comment-row`·`doc-comment-delete` (입력은 NoteThread `note-input`).

## 9. 마이그레이션·배포
`dev-backend/scripts/migrate-post-comments.js`(멱등, `--dry`): 표 생성 + 두 알림 표 ENUM 끝 `'doc_comment'`. 배포 슬롯 `migrate-conv-viewer.js` 뒤, PM2 reload 앞. 롤백 = 코드만.

## 10. 검증
실 HTTP: 생성·조회·고객 shared 강제·음성 대조군(타 워크스페이스·남의 프로젝트 고객·L1·무인증) · 삭제 권한 · 감사 본문 0 · 알림 수신자·종류·메일 0 · 휴지통/복원/영구삭제/복사 · 공개 링크·PDF·검색에 본문 0. 브라우저 3폭: 절 위치·Enter 전송·다른 사용자 실시간·고객 컨텍스트 shared 만·초안 복원·`?comment=` 스크롤 · 양성 대조군.

## 뺀 것
답글·인라인 위치 · 편집 · 목록 댓글 수·배지·확인필요 · 첨부·반응 · AI 도구(행동 계층에 두었으니 뒤에 LOW 도구로).
