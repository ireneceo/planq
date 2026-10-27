---
paths:
  - "dev-backend/routes/**"
  - "dev-backend/services/actions/**"
  - "dev-frontend/src/components/Docs/**"
  - "dev-frontend/src/pages/QTask/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 백엔드 라우트 — pagination·중복 선언·복사(복제) 계약

### List 라우트 pagination 표준 (사이클 N+50 박제)

**모든 신규 GET list 라우트는 `parsePagination` + `paginatedResponse` 사용 필수.** SaaS readiness — workspace 데이터 누적 시 unbounded 응답 OOM 차단.

```javascript
const { parsePagination, paginatedResponse } = require('../middleware/errorHandler');

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { rows, count } = await Model.findAndCountAll({
      where,
      include,
      order: [['created_at', 'DESC']],
      limit, offset,
      distinct: true,  // include 조인이 1:N 일 때 count 정확도
    });
    return paginatedResponse(res, rows.map(serialize), count, { limit, page, offset });
  } catch (err) { next(err); }
});
```

**default / max 가이드:**
- 일반 list (records, posts, backlog, requested, archived): default 200 / max 500
- files / aggregate (all-tasks, all-files): default 500 / max 1000
- 큰 list (conversations, kb): cap 1000 / max 2000 (post-fetch sort/filter 있을 때 paginatedResponse 대신 soft cap 만)

**?page=** 1-base 또는 **?offset=** 둘 다 지원. offset 우선. ?limit 없으면 default 사용. ?limit > max 면 max 로 cap.

**Frontend 호환성:** `data` 필드는 여전히 배열 — pagination 키만 추가됨. 기존 호출은 무변경 동작. frontend 가 `?page=` 또는 `pagination` 키를 점진 opt-in 가능.

**적용 완료 (사이클 N+50):** files / posts / conversations(soft cap) / archived / projects all-tasks · all-files / tasks backlog · requested / records / kb(soft cap)

## 복사(복제)는 **내용만 가져오고 이력은 두고 온다** (2026-09-22 박제)

> Irene: *"문서 복사기능이 없네? … 다른 메뉴도 복사해야 하는데 없는 거 없어?"*

지금 복사가 있는 곳은 **업무**(`POST /api/tasks/:id/copy`)와 **문서**(`POST /api/posts/:id/duplicate`) 둘뿐이다.
청구서·프로젝트·Q info·일정·Q Note·표·메일에는 없다. 새로 넣을 때는 아래 계약을 따른다.

| 따라간다 | 따라가지 않는다 |
|---|---|
| 본문·제목(`… (복사)`)·분류·종류 · 연결(프로젝트·대화방) · 공개 범위·보안등급 · 첨부 **연결** | **이력·증빙**(서명 요청·감사 결과) · **살아 있는 열쇠**(공유 토큰·초대 링크) · 조회수·고정 · 상태 전이 기록 |

- **프로젝트 연결(project_refs)은 따라가지 않는다** (2026-10-27) — 문서·파일·프로젝트를 복사해도 연결은 0개. 소속(project_id)만 위 표대로 따라간다(docs/PROJECT_REFS_DESIGN.md).

- **왜**: 이력을 그대로 복제하면 복사본이 **원본인 척**한다 — 서명본이 두 벌이 되고, 살아 있는 공유 링크가
  두 개가 된다. 복사본의 주인은 **복사한 사람**이다.
- **읽을 수 있으면 복사할 수 있다** — 읽기와 **같은 술어**를 쓴다(문서는 `routes/posts.js canReadPost`).
  쓰기는 그 워크스페이스 멤버만(고객은 만들지 못한다). 실측으로 «읽기 403 = 복사 403» 을 확인한다 —
  복사가 읽기보다 넓으면 그게 곧 가시성 확대 통로다.
- **공개 범위는 승계하되 넓히지 않는다.** L1 문서를 복사하면 복사본도 L1 이다.
- **다른 표를 공유하지 않는다** — 표 문서(`kind='table'`)는 `q_record_id` 를 복사하면 원본과 **같은 표**를 보게 돼
  한쪽을 고치면 양쪽이 바뀐다. 연결을 끊고 본문만 가져온다.
- **제목 꼬리표는 한 글자도 같게** — 업무·문서 모두 `' (복사)'`. 같은 뜻에 다른 글자를 쓰면 다른 기능으로 읽힌다.
- 회귀: `node scripts/e2e/run.js --suite docsdup` (버튼이 아이콘만인지·같은 줄인지 좌표로 · 눌러서 복사본 열림 ·
  복사본에 서명·공유 **안 따라감** + 원본엔 **있음** 양성 대조군).

## 라우트는 **같은 파일에 두 번 선언하지 않는다** (2026-09-13 박제)

`routes/projects.js` 에 `GET /:id/notes` 를 두 번 선언했다(하나는 프로젝트 메모, 하나는 새로 넣은
Q Note 목록). Express 는 **먼저 만난 것만** 부르므로 뒤엣것은 그날부터 **죽은 코드**가 됐고,
프로젝트 메모를 읽던 화면 4곳이 **500 도 404 도 없이** 엉뚱한 목록을 받았다 — 그래서 검증을
그대로 통과했고 운영까지 나갔다(v1.49.0).

- **기계가 센다** — `node scripts/guard-invariants.js --category=duproute` (하드 게이트, 873개 경로).
  "이 경로가 이미 있나" 는 사람이 기억할 일이 아니다.
- 가드는 **한 파일 안**만 본다. 같은 접두어에 라우터를 둘 이상 마운트할 때는(`/api/clients` 의
  `client_links.js` + `clients.js`) **순서가 계약**이다 — 더 구체적인 꼬리 경로를 가진 라우터를
  **앞에** 붙이고, 그 파일에는 고객 id 뒤에 고유한 꼬리가 붙은 경로만 둔다.
- memory `feedback_express_route_order` · `feedback_silent_no_output_paths`.

---

