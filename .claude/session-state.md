## 현재 작업 상태
**마지막 업데이트:** 2026-09-25 09:30 UTC (오후 세션)
**작업 상태:** 커밋·푸시 완료(`ab2b07a7`) · **Fable 게이트 4라운드 PASS** · **운영 미배포**
**주체:** [Opus] Opus 5 (1M) · 검증 [Fable]

> ⚠️ 아래 **「오전 세션」** 절은 다른 세션([Opus] Opus 5.5)이 남긴 것이다. 지우지 말 것 —
> 그쪽 「다음 할 일」이 아직 유효하다.

### 다음 세션에서 가장 먼저 할 일
1. **Fable 판정 결과 확인** — `jq -r '.by, .fingerprint' .claude/.fable-gate.json` +
   `docs/FABLE_GATE_QUEUE.md` 맨 아래 항목. 게이트를 **4라운드** 돌렸다(1·2차 FAIL).
   `by=fable` 이고 지문이 현재 상태와 같아야 통과다.
2. **게이트 4라운드 PASS 로 마감됐다** (1·2차 FAIL). `services/seoArtifacts.js` 의 빈 폴더 rmdir 은
   Fable 이 **양성 대조군까지** 갈랐다(`dirs 6→0` / 되돌리면 `dirs 1`) + **음성 대조군 5종 보존**
   (형제 파일·마커 없는 파일·`assets/`·`locales/`·`../outside/`·심볼릭 링크).
   내 자체검증이 `ok=false` 였던 것은 **내 픽스처가 부실했던 것**이고 코드는 멀쩡했다.
3. **배포 직후 확인 한 줄**: `curl -s -o /dev/null -w "%{http_code}" https://planq.kr/wiki/` → **200**.
   403 이면 생성기의 매니페스트 정리가 실패한 것(`pm2 logs` 의 `[seo-artifacts] removed:88` 확인).
2. **커밋·배포는 Irene 지시 대기.**
3. **`Q sale` → `Q sales` 답을 못 받았다** — 이번 변경에 **안 들어 있다**(대문자만 소문자로 정렬).

### 완료된 작업 (오후 세션)

**① 업무 댓글이 위로 붙던 결함 (운영 신고)** — ✅ Fable PASS
> Irene: *"업무 상세에서 댓글을 달았는데 댓글이 아래로 안 붙고 위로 붙어서 올라간 줄 몰랐어."*
- 정렬 규칙이 아니라 **이름** 문제였다. 조회는 `comments[].createdAt`, 저장은 `created_at` 만 →
  새 댓글 시각이 `''` → **빈 문자열이 모든 날짜보다 작아 맨 위로**. 표시 시각도 빈칸.

**② 업무 히스토리 시각이 5개월간 빈칸** — ✅ Fable PASS (Fable 이 diff 밖에서 찾았다)
- `GET /workflow` 는 `created_at`, 화면은 `createdAt` → **2026-04-25 부터 빈칸.**
  아무도 신고하지 않았다 — **빈칸은 «고장» 으로 보이지 않는다.**

**정본 `dev-backend/utils/rowTimestamps.js` 신설 (`withBothTimestamps`)**
- 근원: 전역 `Model.prototype.toJSON` override(`models/index.js:165`)가 **최상위만**
  `createdAt→created_at` 으로 바꾸고 **중첩 include 행은 camelCase 로 남긴다.**
- ★ **중첩까지 재귀시키지 않았다** — 조회 응답의 중첩 행 이름이 한꺼번에 바뀌면
  `createdAt` 을 읽는 화면들이 **동시에** 시각을 잃는다. 넓히는 쪽이 위험하다.

**③ 「Q위키」 → 「도움말」 개명 (Irene 결정) — 주소까지** · 재판정 대기
- ko「도움말」/ en **`Guide`** · 관리 「도움말 관리」/`Guide admin` · **`Q helper` 팝업 제목 보존**
- **주소** `/wiki/`→`/guide/` · `/wiki/a/:slug`→`/guide/a/:slug` · `/admin/wiki`→`/admin/guide`
- **안 바꾼 것(의도)**: API `/api/wiki/*` · 파일명 · DB(`help_articles`·`kb_chunks.source_type='wiki'`).
  ENUM 변경은 비가역이고 사용자에게 안 보인다.
- ★ Irene 이 **내 SEO 논리를 반박했고 그게 맞았다** — 운영 실측: 집계 시작 2026-09-21(나흘),
  전체 방문 25건, `/wiki/` **1건.** 지킬 색인 자산이 없어 **본격 운영 전 지금이 가장 싼 시점**이었다.

**④ 랜딩 브랜드 표기 정렬** — 랜딩이 `Q Talk`·`Q talk` 를 **같은 문서 안에서 섞어 쓰고 있었다.**
앱 사이드바 소문자를 정본으로 **80건** 정렬(대문자 잔여 0).

### 개명에서 «이름만 바꾸면 고장 나는 것» — 내가 찾은 3건
| 지점 | 무엇이 문제였나 |
|---|---|
| `dev-frontend/src/utils/publicSurface.ts` | 공개 표면 판정이 `/wiki` 기준 → 주소만 바꾸면 **회원이 도움말에서 워크스페이스 크롬**을 본다. 주석에 「전에 같은 회귀가 있었다」고 적힌 자리 |
| `dev-backend/services/seoArtifacts.js` | 빵조각 **3번째 항목만** 옛 주소 잔존 |
| `dev-backend/services/wikiQuestionCluster.js` | 알림 링크가 `/admin/wiki` → **죽은 링크** |

### Fable 1차 FAIL 로 찾은 잔존 4계열 (고쳤다)
1. `dev-frontend/index.html:66` `<noscript>` nav 의 `/wiki/` — **생성기는 홈 머리를 바꾸지 않아
   운영 홈 HTML 에 죽은 링크로 실린다**(운영 홈에 3건 있었다)
2. `dev-frontend/public/llms.txt` — AI 크롤러용 죽은 링크
3. 생성 글 `<title>… | Q위키 — PlanQ` · 알림 제목 `Q위키 초안 N건`
4. **e2e 7곳이 옛 주소를 쳐서 초록이 거짓이 된다** — `canary-crawl`·`canary-header-drift`·
   `visual-audit`·`mobile-keyboard`·`canary-admin-crawl`·`canary-body-gutter`·`narrow-text-audit`
- 추가로 내가 하나 더: **Cue LLM 프롬프트** 「Q위키 문서」→「도움말 문서」
  (`services/cuePrompts.js:45` + `routes/cue.js:362` — **짝이 맞아야** 근거 블록을 찾는다).
  안 고치면 Cue 가 답변에서 폐기된 이름을 말한다.

### ★ 오후 세션에서 내가 틀린 것 (반복 금지)
1. **`Q sale` 을 「상담」으로 바꾸자고 했는데 틀렸다** — 「상담」은 6단계 중 **3번째 단계**이고
   고객 관리는 별도 메뉴(「고객·파트너」)가 있다. 내용을 좁게 보고 «이름이 틀렸다» 고 단정했다.
2. **SEO 색인 손실을 근거로 주소 유지를 주장했는데 데이터가 없었다** — Irene: *"본격 운영도 안
   했는데 이게 중요해?"* 운영을 읽어 보니 `/wiki/` 방문 1건. **주장 전에 재라.**
3. **검사기가 세 번 거짓** — ①`[class*="TimelineItem"]` 은 빌드된 styled-components 에 없어 0건
   ②히스토리 섹션이 기본 접힘이라 행 0건 ③`task_status_history` 에 `updated_at` 컬럼 없음.
   셋 다 **미측정으로 보고**되어 초록으로 새지는 않았다.
4. **양성 대조군이 반만 적용됐는데 «들어갔다» 고 판단** — 파일에 `\uffff` 가 **실제 문자**로 들어가
   치환이 안 맞았다. `grep -c POSCTRL` 이 1인데 2곳을 바꿨다는 사실을 늦게 알아챘다.
5. **`grep` 이 또 거짓** — ugrep 이라 `{...}` 를 구간식으로 읽어 `data-testid={\`...\`}` 를 못 찾는다.
   그 탓에 `&&` 사슬이 끊겨 재시작·빌드가 안 돌았다.
6. **좌표 검사가 결함을 못 잡았다** — DOM 순서대로 top 을 비교하면 내용과 무관하게 항상 증가한다.
   **행을 내용으로 찾아** 비교하도록 고쳤다.

### 회귀 (추가)
`--suite delivver` **11검사**(5개 추가): 새 댓글 맨 아래 · 좌표로도 과거가 위 · 새 댓글 시각 보임 ·
히스토리 섹션 펼침 · 히스토리 시각 빈칸 아님. 손잡이 신설 `task-comment-<id>`·`task-history-toggle`·`task-history-time`.

### 자체 검증 수치 (최종 상태)
- `npm run build` EXIT 0 · `error TS` 0 · health 48/48 · guard 59/60(i18n 242/242 · parity 증가 0)
- `--suite tenant` 0 실패 · `--suite delivver` 11/11 · `wiki-coverage-check.js` EXIT 0
- 실브라우저: `/guide` 목록 · `/guide/a/create-workspace` 본문 · 「Back to Guide」 · 뒤로 `/guide` 동작
- 산출물: `dev-frontend-build/index.html` 에 `href="/guide/">도움말` · `llms.txt` 새 주소
- DB 아티클 본문에 옛 주소·이름 **0건**

### 배포 시 주의 (오후분)
- **운영 옛 생성물**: `wiki/index.html` + `wiki/a/*` = **88 html + 88 .gz**. 배포 직후 `generate-seo.js` 가
  **매니페스트 마커 기준 자동 삭제** + sitemap/rss 재작성(Fable 반증 `removed:3`, 마커 없는 파일은 보존).
  ★ **빈 폴더까지 지워지는지가 관건이다**(위 「가장 먼저 할 일」 2번). 확인:
  ```
  ssh irene@87.106.78.146 'cd /opt/planq/frontend-build && find wiki -name index.html | wc -l; grep -c /wiki/ sitemap.xml; ls guide/a | wc -l'
  # 기대 0 / 0 / 87
  ```
  선택: `rmdir /opt/planq/frontend-build/wiki/a /opt/planq/frontend-build/wiki`(빈 폴더)
- **옛 `/wiki` 는 앱 안 리다이렉트로 살렸다** — `/wiki`→`/guide`, `/wiki/a/:slug`→`/guide/a/:slug`
  (slug 보존). 그 전에는 **랜딩 홈**으로 떨어져 색인된 옛 글 32건이 엉뚱한 데로 갔다(Fable 실측).
  nginx 301 은 더 깔끔하지만 **앱 안 리다이렉트로 충분**하다 — Irene 이 원하면 추가.
- 스키마 **0**. 롤백은 코드만(43파일 revert → 재빌드 → 재배포, 생성기가 대칭 복원)
- **Q위키 2건 운영 미반영**(어제분): `ssh irene@87.106.78.146 "cd /opt/planq/backend && node seed-wiki-content.js"`
  — **배포 rsync 뒤에.** 생성될 것: `folder-upload-and-delete`·`same-name-file`·`trial-options`

### 메뉴 이름 전략 — 이번에 합의된 규칙 (박제)
| 규칙 | 예 |
|---|---|
| **Q + 영어(소문자) = 제품명** → 언어와 무관하게 유지 | `Q talk` `Q task` … `Q sale` |
| **Q 가 안 붙는 것 = 각 언어의 평범한 라벨** | 「도움말」/`Guide` · 「고객·파트너」 · 「문의 인박스」 |
| **예외 `Q helper`**(팝업) | Irene 지시로 그대로 |
- 전면 한글화는 **하지 않는다**: ①제품명을 언어마다 다르게 하면 한 기능에 이름이 둘 ②이름은 화면에만
  있지 않다(도움말 83건·알림·메일·랜딩 색인·URL) ③「Q 메일/문서/파일/청구」는 전부 한글 2자라
  실루엣이 같아 **스캔이 더 느리다**
- **공공·대기업 온프렘용 한글 스킨은 «카드» 로 남긴다** — i18n 이 이미 있어 ko 값만 바꾸면 되므로
  지금 쓸 필요가 없고, 그때 「한글 메뉴로 드립니다」가 협상 재료가 된다

### Irene 결정 대기 (오후분)
1. **`Q sale` → `Q sales`** — 영어권에서 `sale`(단수)은 **할인 행사**로 읽힌다. 영업 활동은 `sales`.
   표시값만 바뀌어 비용 거의 없음. (`Q CRM`·`Q deal`·`Q pipeline` 은 권하지 않음 — 약어·업계용어)
2. **옛 `/wiki` 301 리다이렉트** 넣을지 (nginx 변경)
3. **교차 모드 구멍**(어제부터) — 워크스페이스 모드로 프로젝트 폴더에 올린 파일이 `project_id=null`·L1 이라
   **프로젝트 탭에 안 보인다.** Fable 권고는 프로젝트 파일이 되게 하는 것인데
   **가시성이 L1 → 프로젝트 멤버로 넓어진다.** 임의로 정하지 않음

### Git 상태 (오후 세션 종료 시점)
- `main` · HEAD **`ab2b07a7`**(푸시 완료) · 작업 트리 깨끗 · 운영 **1.63.5**(오후분 미배포)
- 다른 세션 잔여물(내 것 아님, 안 건드림): `dev-backend/test-cal-dbg.js`·`test-qnote-visibility.js`(9/20~21) ·
  `ZZ 게스트검증 업무` 2건(9/05)

---

## 오전 세션 (다른 세션이 남긴 기록 — 지우지 말 것)

**작업 상태:** 완료 (운영 배포 v1.61.0 ~ v1.63.5, 마지막 `5b549002`)
**주체:** [Opus] Opus 5.5 (1M) · 검증 [Fable]

### 완료된 작업 (오전 세션)
- 게스트 진입 P0·A·B (워크스페이스 이름·로고, 공유 링크 멱등 발급·교체, 고객 공개 범위, 로그인 시트)
- 이미지 보안 2a(L1) · 2b 0단계(첨부 사본) · 2b 1·2단계(`image_ctx` + L2/L3 계측, 막지 않음)
- 감사 1~3순위 — 변경 라우트 감사 없음 328 → 98
- 권한 결함 3건 차단(v1.63.5): Cue 초안 승인/거절 · 후보 병합 · 대화방 메시지 — 남의 워크스페이스에 쓰기 가능했다. 운영 흔적 0
- PDF: `?w=` 이미지 누락 수정 → 그 수정이 만든 500 회귀(post 76)를 운영 실측으로 잡아 v1.63.4 에서 줄여 넣기 + 이미지 없이 재렌더
- 서명본 이미지 깨짐 · 기본 발신 계정 해제 · 오류 로그 토큰 노출(redactUrl)

### 다음 할 일
1. **고객 워크스페이스 링크 (docs/CLIENT_ENTRY_DESIGN.md P1)** — Irene 과 합의한 자리: 설정 › 권한 «고객 공개 범위» 옆 «고객 창구» 카드
   (주소·[복사]·[교체]·QR·[고객 화면 미리보기]=새 창) + Q sale 상단 [고객 링크 복사]. 좌측 메뉴에는 넣지 않는다(이동용).
   ★ 시작 전에 Irene 에게 한 줄 확인: **P1+P2(예약) 한 번에(6~8일)** vs **P1 먼저(2~3일)**.
   R=1(무인증 표면·토큰) → Fable. `guest_links.scope` ENUM append `'workspace'` 멱등 마이그레이션 **코드 배포 전**.
2. 작은 후속: `invoice` 무인증 receipt-request 전용 limiter · `file_folder.delete` 감사 oldValue 파일 목록 상한(50 + 총수)
3. 감사 잔여 98 (attendance·leave·notifications 등)
4. 이미지 2b 3단계 — 운영 `l23.would_deny` 를 ~14일 관찰 후(2026-10-08 전후). 켜기 전 Fable · 문서 캐시 60초 판단
5. 결정 대기: 휴지통 L1 행이 산 L3 첨부 사본을 404 로 만드는 것(FABLE_GATE_QUEUE) · nginx `server_tokens off`(sudo)

### 관찰(비차단)
- 보관된 standalone 고객 대화에 고객이 쓰면 409(재활성 안 됨) — 기존 동작, `isClient` 가 프로젝트 분기에서만 계산됨
- `PATCH /api/projects/tasks/:id` 허용 status 목록이 현재 ENUM 과 안 맞음(죽은 경로)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
