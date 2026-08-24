# Fable 검증 대기 큐 — 2026-08-21 사이클

Irene 지시로 이 사이클은 **Fable 없이** 진행했다(`fable 쓰지 말고`). 전부 **Opus 자체 검증**이다.
아래는 나중에 Fable 이 독립 검증할 때 바로 착수할 수 있도록 남기는 인수인계다.

> 읽는 순서: **§1 고위험(먼저)** → §2 일반 → §3 미해결·결정대기 → §4 재현·검증 방법

---

## 0. 이 사이클의 커밋

| 커밋 | 범위 | 운영 배포 |
|---|---|---|
| `660990f7` | 자동저장 루프 · IMAP 크래시(#357) · 정기업무 #351/#348/#350 · Q docs 첨부(#365) · OG(#362) · 검색(#366) · 네이밍 주석(#359) | ✅ `20260821_063416` |
| `e684ad59` | 편집 중 자동 새로고침 차단 (문서) | ✅ |
| `d991207b` | 편집 중 자동 새로고침 차단 (메모) | ✅ |
| `4a65f831` | 채팅 고객 참여 · @목록 · 방 이름 | ✅ |
| `88e08206` | 에디터 #341/#337/#304 + 정렬 #363 | ✅ |
| (진행 중) | Q info #327/#329/#330/#331/#326/#325/#328/#333/#332 | ❌ 미배포 |

운영 배포 백업: `/opt/planq/backups/20260821_063416` (롤백 명령은 배포 로그 참조)

---

## 1. 고위험 — Fable 이 먼저 볼 것

### 1-A. `routes/conversations.js` — 고객을 대화 참여자로 자동 추가 (보안 경계)

```js
if (client_id) {
  const cli = await Client.findOne({ where: { id: client_id, business_id: req.params.businessId }, ... });
  if (cli && cli.user_id && cli.user_id !== req.user.id) { ConversationParticipant.findOrCreate({ ... role: 'client' }) }
}
```

**검증 포인트**
- 멀티테넌트: `business_id` 조건으로 타 워크스페이스 고객이 붙지 않는가 (WHERE 절 대조)
- 초대 미수락 고객(`clients.user_id` NULL)은 건너뛰는가 — 계정이 없는데 참여자로 넣으면 유령 행
- `findOrCreate` 멱등 — 같은 요청 반복 시 중복 행 0
- **대화 접근 판정(`conversationListWhere`)이 role='client' 참여자를 어떻게 읽는지** — 참여자가 늘어난 만큼 열람 범위가 넓어진 것이므로 이 축을 반드시 대조
- Opus 자체 검증 범위: dev 실호출로 "수정 전 참여자 1명 → 후 2명(고객 포함)" 확인. **접근 판정 축은 미검증.**

### 1-B. `routes/kb.js` — 항목만 있는 정보 등록 허용 + secret 색인 제외 (#332 / #318 인접)

두 겹의 게이트를 모두 넓혔다: `body_or_attachments_required` → `custom_values` 도 인정,
`no_indexable_content` → 항목에서 색인 텍스트 합성.

**secret 처리 규칙(핵심)**: 색인 본문에 secret 항목은 **라벨만** 넣고 **값은 넣지 않는다.**

**검증 포인트**
- 반증: secret 값이 `kb_documents.body` / `kb_chunks.content` 어디에도 없는가
  (Opus 실측: 값 `SUPERSECRET123` → body `"제목\n아이디: tester\n비밀번호"`, 청크 1개, 값 미포함)
- **번역 경로(`auto_translate` 기본 true)도 body 를 쓰는가** — body 에 secret 이 없으면 안전하지만 경로 확인 필요
- 사용자가 **본문 텍스트에 직접** 비밀번호를 쓰는 경우는 여전히 색인·번역으로 나간다 → **#318 미해결**(§3)
- 게이트를 넓혔으므로 **빈 문서가 새로 들어오지 않는지** 역방향 확인 (제목만 있고 항목·본문·첨부 전무 → 여전히 400 이어야 함. Opus 실측 400 확인)

### 1-C. `services/emailImapCron.js` — 프로세스 크래시 차단 (#357)

`removeAllListeners()` 직후 no-op error 리스너 재부착 + 끊긴 연결에 `end()` 생략.

**검증 포인트**
- 리스너를 떼는 지점 **전수**가 커버됐는가 (현재 4곳 + 폴링 경로 1곳)
- no-op 리스너가 **진짜 오류까지 삼키지 않는가** — 재연결 예약 로직(`scheduleReconnect`)이 그대로 동작하는지
- Gmail 동시연결 누수(과거 사고) 재발 없는지 — 계정별 active 연결 1개 유지
- 운영 근거: 8/21 error 로그의 유일한 Error 가 이 EPIPE 12건, 부팅 경고 25회(=재시작 횟수)
- **배포 후 관찰 필요**: 운영 error 로그에서 EPIPE 스택과 부팅 경고가 사라졌는지 (하루치)

### 1-D. `routes/og.js` — 공개 라우트 신규 추가 (보안 경계)

`/insights/:slug`, `/public/posts/:token`, `/public/docs/:token` 을 `/api` **밖**에 마운트.

**검증 포인트**
- 노출 범위: 제목 수준만. 금액·본문·첨부는 넣지 않았는가
- 대상 미존재 시 기본 index.html 그대로 (존재 여부 유출 없음) — Opus 실측 확인
- HTML 이스케이프 — Opus 반증 완료(제목에 `"` `<script>` 삽입 → 원문 유출 0)
- **라우터 마운트 순서** — `app.use('/', ...)` 가 마지막이라 기존 라우트를 가리지 않는지
- share_token 만료(`share_expires_at`) 를 OG 가 **무시**하고 있다 → 만료된 링크도 제목이 나갈 수 있다. **미확인 사항**

---

## 2. 일반 — 자체 검증 근거가 있는 것

| 건 | 파일 | Opus 자체 검증 |
|---|---|---|
| 자동저장 무한 루프 | `PostsPage.tsx` | 시뮬레이션 반증: 12회+무한 → 1회 후 정지 |
| 편집 중 새로고침 | `BuildVersionGuard.tsx` · `PostsPage` · `MemoView` · `MemoPopup` | 반증: reload 함 → 안 함 → 편집 닫으면 다시 적용 |
| #341 문서 중복 생성 | `PostsPage.tsx` | 시뮬레이션 반증: 2개 → 1개 |
| #351 캐치업 · #348 상속 · #350 다이제스트 | `recurringTaskGenerator.js` | 실DB 18/18 PASS · 되돌려 FAIL 11건 반증 |
| #348 백필 | `scripts/backfill-recurring-inheritance.js` | dev 15건 · 운영 3건 반영, 재실행 변경 0(멱등) |
| #365 Q docs 첨부 | `PostsPage.tsx` · `services/files.ts` | 실HTTP: 영상 첨부 → 재조회 1건 |
| #366 검색 정렬 | `routes/search.js` | 실HTTP 200 + 정렬 확인 |
| #337 #304 #363 | `PostEditor.tsx` | 빌드 산출물에 반영 확인 (기능 실브라우저 검증 X) |
| #327 #329 #330 #331 #326 #325 #328 #333 | `KnowledgePage.tsx` | 코드 수정 + 빌드. **실브라우저 검증 X** |

**공통 가드**: `health-check 37/37` · `guard-invariants 25/25` · i18n 래칫 381(기준 382) · `npm run build` exit 0 / error TS 0

> 가드가 실제로 잡은 자체 실수 1건: 정렬 라벨을 `t()` 밖에 둬 한국어 하드코딩 래칫 384 FAIL → `defaultValue` 로 이동해 381 복구.

---

## 2-B. 주간 가용시간 카드 — 진척 기준 변경 (2026-08-24, Irene 지시로 적용 · Fable 사후 검증 대기)

`DEVELOPMENT_PLAN.md` 의 기존 대기 항목 **"주간 가용시간 바 계산(진척/가용 439% · 기간 환산 누락)"** 과 같은 뿌리다.

**증상(운영 실측, 8/24 00:22 KST · business_id=1 워프로랩):**
- 주가 8/17→8/24 로 바뀌자 카드의 `진척(예상시간)` 이 **0.0h** 가 됐다. 같은 카드의 `남은 일` 은 57.7h
  (이월 1.7 + 신규 56.0), 상단 칩 `실제` 는 13.5h.
- 원인은 **한 카드 안에서 기준이 두 개**였던 것: 남은 일·실제는 **누적**인데 진척만 **이번 주 증가분(Δ)**.
  Δ 는 주 시작 시 구조적으로 0 이다(§6.1 그래프 규칙을 바가 그대로 읽고 있었다).
- 담당자=나 기준 진행률>0 인 활성 업무 **6건 · 누적 진척 17.5h**(#127 14.4 · #123 0.9 · #130 0.9 · #129 0.4
  · #131 0.3 · #227 0.55)가 전부 화면 밖에 있었다. 이번 주 신규 22건은 Σ예측 44.7h 인데 진행률이 전부 0 이라
  그 항목만으로는 0 이 될 수밖에 없었다.
- 사용자가 목록에서 본 `기율 와디즈 3.0/95%`(#222)는 **담당자가 타인**이고 컨펌 대기로 목록에 뜬 것이라
  카드(담당자=나 기준) 집합에는 들어가지 않는다 — 카드 캡션과 일치.

**적용한 변경(Irene 지시):** 카드의 진척 = **그 집합의 누적 Σ(예측×진행률)**, 이월 포함.
`남은 일` 과 같은 집합·같은 기준이라 `진척 + 남은 일 = Σ예측` 이 성립한다.
그래프(§6.1)는 **그대로 Δ** — 이월분을 그래프에 다시 실으면 #254 회귀다. 카드에 보조 줄
`이번 주 새로 {h}h · 이월 진척 {h}h` 를 둬 두 기준을 함께 읽게 했다. 설계문서 §6.3 ① 에 개정 이력 기록.

**Fable 이 볼 것:**
- 분자가 누적이 되면 `진척/가용` 이 100% 를 넘을 수 있다 — **439% 증상의 뿌리**. 분모를 가용시간으로 둘지,
  그 집합의 Σ예측으로 둘지 미결. 바 폭은 100% 캡이지만 퍼센트 칩은 실수치를 낸다.
- "기간 환산 누락" — 표시 기간이 주가 아닐 때(월 등) 가용시간 환산이 맞는가.
- 집합 정의: 카드는 `filtered`(보기 필터 영향 받음), 그래프는 `chartWeekTasks`(정본, 보기 무관).
  **카드도 정본 집합을 써야 하는가** — 지금은 검색어를 치면 카드 숫자가 변한다.
- Opus 자체 검증 범위: 운영 데이터 산술 대조(위 숫자) + dev 빌드·가드. **실브라우저 렌더 대조는 dev 데이터로만.**

---

## 2-C. 오늘의 업무 리뷰 — **설계는 Fable 몫** (Irene 2026-08-24 지시로 Opus 작업 중단)

Irene: "오늘의 업무리뷰는 나중에 fable이 보완하게 해줘. **지금 스타일 아니라고.**"

**Irene 이 원한 것 (원문)**
> 확인필요 = Action Center (내가 지금 행동해야 하는 것) / 오늘의 업무 리뷰 = **Context Center**
> (오늘 일을 시작하기 위해 알아야 하는 것). "고객과의 소통에서 생긴 이슈나 메일에서 온 내용,
> 프로젝트에서 지금 마감 임박해서 빠르게 움직여야 하는 게 있거나 등 **업무 대응에 필요한 내용을 정리**하라는
> 거지 리스트업하고 할 일 목록 만들라는 건 아니었다." / "**실제 내용이나 현상을 파악해서 리뷰**해달라는 것"
> 예시 형태:
> ```
> A사 상표침해: 상대방 답변서 도착 → 검토 필요
> B사 자문: 고객 추가자료 업로드
> C사 소송: 다음 기일 9/3 확정
> ```
> 제약: 확인 필요 **상단에 접힌 상태**, **탭으로 나누지 않음**, **저장·날짜별 이력 없음**.

**지금까지 만든 것 (Opus, 2회 교정 후에도 Irene 판정 "아직 스타일 아님")**
- `GET /api/dashboard/today-review` — 저장 없음, 호출 시 계산. 응답:
  `counts{projects_active, today_tasks, approvals, due_soon, changes}` +
  `blocks{inbound, urgent, blocking, moved}`
- 각 항목이 **재료를 구조화해서** 담고 있다: `{subject_label(고객·프로젝트), title, preview(실제 내용 한 줄),
  speaker(말한 사람), detail_key, overdue_days, at, link}`
- 수집원: 메일(답장 대기·확인 권장 + 본문 미리보기) / 채팅(내가 참여한 방, 마지막 발언 본문 + 발신자) /
  업무 상태 이력(사유 note + 행위자) / 일정(신규·변경) / 마감 임박·지연 / 내 컨펌 대기
- 집합 술어는 `services/weekTaskSet` 재사용(Q Task 화면과 숫자 안 갈림). 멀티테넌트 스코프 가드 통과.
- 화면 `components/Dashboard/TodayReview.tsx` — 접이식, 블록별 두 줄(윗줄 주체·제목·그래서 뭘 / 아랫줄 내용).

**무엇이 부족한가 (Fable 이 설계할 것)**
1. **여러 건 → 한 문장 압축.** 지금은 건별 나열이라 결국 목록으로 읽힌다. Irene 예시처럼
   `A사 상표침해: 상대방 답변서 도착 → 검토 필요` 는 **메일 + 사건(프로젝트) + 다음 행동**을 한 줄로 합친 것이다.
2. **중요도·선별.** 무엇을 빼고 무엇을 올릴지. 지금은 최신순 상위 N.
3. **묶음 축.** 고객/사건 단위로 묶을지, 시간축으로 갈지.
4. **문장 생성 위치.** LLM 게이트웨이(`services/llm.js`) 경유 · 비용 가드(`middleware/costGuard`) ·
   캐시 정책(저장 안 하기로 했으므로 요청당 생성이면 비용이 매일 사용자수만큼 든다 — 이 트레이드오프가 핵심 결정).
5. Q Note 브리핑·주간보고와의 **역할 경계** (같은 요약이 세 곳에 생기지 않게).

**Fable 이 다시 만들 필요가 없는 것**: 재료 수집·스코프·집합 술어·접이식 UI 는 위에 있다.
요약 규칙만 얹으면 된다 — `{subject_label, preview, speaker, 상태, 시각}` 이 입력이다.

---

## 2-D. "고정핀 된 채로 팝아웃 열기" — 구조 변경이라 Opus 미착수 (Irene 2026-08-24 요청)

Irene: "확인필요에 추가한 팝아웃 버튼을 [오늘 내 업무]로 하고 **고정핀 된 채로 열리게** 해줘."
라벨은 반영(`오늘 내 업무`). **고정 상태로 여는 것은 미착수** — 이유:

1. **새 창 자동 고정은 브라우저가 막는다.** `documentPictureInPicture.requestWindow()` 는 **그 문서의
   transient user activation** 을 요구한다. `window.open` 으로 방금 열린 창에는 그게 없다 →
   `?pin=1` 같은 플래그로 자동 호출하면 `NotAllowedError`.
2. **부모 창이 대신 PiP 를 만드는 건 가능**하다(부모 클릭에 activation 이 있다). 그런데 지금 **해제
   경로가 홀더 창을 전제**한다 — `unpin()` 이 BroadcastChannel 로 `unpin-request` 를 보내면
   **홀더(원래 팝아웃 창)** 가 자기를 일반 창으로 되돌린다(`pinHost.ts:618-631`, `_holder` 쿼리).
   부모가 만든 PiP 에는 홀더가 없어 **해제가 아무 데도 안 닿는다**.
3. `utils/pinHost.ts` 는 주석에 **여섯 번 재설계**된 이력이 박제돼 있고(창 자리·축출 선공지·홀더 복귀·
   rAF 좌표 밀기), "고정창은 스크립트로 못 옮긴다" 같은 **실측 반증**이 남아 있다. 상태기계에 두 번째
   생성 경로를 얹는 것은 구조적 결정이다.

**Fable 이 정할 것**: 홀더 없는 PiP 를 허용할지(해제 시 새 일반 창을 여는 폴백) / 아니면 여는 순간
자동 고정을 포기하고 "열자마자 핀 안내" 로 갈지. 전자는 `releasePip`·`restoreToNormal`·축출 수신부를
전부 홀더-옵셔널로 바꿔야 한다.

---

## 3. 미해결 · 결정 대기 (Fable 판단이 필요할 수 있는 것)

| # | 내용 | 막고 있는 것 |
|---|---|---|
| **#356** | 운영 `EMAIL_ENCRYPTION_KEY` 미설정 → JWT_SECRET 파생 fallback. 이미 `decrypt failed` 2회 | 키 교체 전 **기존 암호문 재암호화 마이그레이션** 설계 필요. 운영 .env 변경 = Irene |
| **#318** | 사용자가 본문에 직접 쓴 자격증명은 여전히 임베딩·번역으로 외부 LLM 에 나감 | 색인 정책 결정 (문서 단위 opt-out? security_level 연동?) |
| **#317** | AI·CSV 일괄 저장이 항상 워크스페이스 공개(L3) | 공개범위 기본값 정책 |
| **#334** | 통합검색이 `custom_values` 를 통째 CAST 해 secret 값까지 매칭 | 검색 대상에서 secret 제외 규칙 |
| **#362** | OG 서버 렌더는 됐으나 **nginx 라우팅 미적용** (root 권한) | `docs/OG_PREVIEW_NGINX.md` 적용 |
| **#359** | "Q record" 사용자 표기 존폐 | Irene 결정 |
| **#363** 일부 | "표 좌우 폭" (= #311 표 열 너비) | 미착수 |
| #316 #319 #320 #321 #322 | Q info AI·CSV 가져오기 파이프라인 | 미착수 |

---

## 4. 재현·검증 방법 (Fable 용)

```bash
# 가드 3축
node /opt/planq/scripts/health-check.js
node /opt/planq/scripts/guard-invariants.js
cd /opt/planq/dev-frontend && NODE_OPTIONS=--max-old-space-size=4096 npm run build; echo "exit=$?"
#   ★ 파이프(| tail) 뒤에서 종료코드가 가려진다 — 반드시 별도로 $? 를 본다

# 정기업무 (실DB)
#   테스트 스크립트는 규칙대로 삭제했다. 필요하면 아래 시나리오로 재작성:
#   parent(FREQ=DAILY, next_occurrence_at=today-8, workstream·태그·start~due 있음) 생성
#   → generateOneSeries 1회 → 회차 16건(today-8 ~ today+7) · workstream/태그 상속 · start_date offset 유지
#   → 재실행 시 증가 0 · COUNT=3 종료조건

# 고객 참여 (실HTTP, dev)
#   POST /api/conversations/:businessId {title, client_id} → GET .../:id/participants
#   기대: role='client' 참여자 1명 포함

# secret 색인 반증 (실DB, dev)
#   POST /api/businesses/:id/kb/documents {title, custom_columns:[{type:'secret'}], custom_values:{...}}
#   → kb_documents.body / kb_chunks.content 에 secret 값 미포함, 라벨만 존재

# 운영 관찰 (배포 후 하루)
ssh 87.106.78.146 'grep -ac "This socket has been ended" ~/.pm2/logs/planq-prod-backend-error__$(date +%%Y-%%m-%%d)_00-00-00.log'
ssh 87.106.78.146 'grep -ac "EMAIL_ENCRYPTION_KEY 미설정" ~/.pm2/logs/planq-prod-backend-error__*.log'   # = 재시작 횟수
```

### 함정 (이 사이클에서 실제로 밟은 것)

- **DATEONLY 는 Date 객체로 온다** — `String(v).slice(0,10)` 하면 `"Thu Aug 13"` 이 나와 **거짓 FAIL**. 정규화 함수를 쓸 것
- **`PostEditor` 청크가 두 개다** — 29KB 본체 + 66바이트 스텁. 스텁을 grep 하면 "수정이 안 들어갔다" 는 **거짓 판정**이 난다
- **/tmp 에서 node 실행 시 MODULE_NOT_FOUND** — `require('dotenv')` 가 해석 안 된다. `/opt/planq/backend` 안에서 실행할 것
- **배포 스크립트가 exit 1 을 내도 완주했을 수 있다** — 로그의 `Deployment Complete` + PM2 uptime + 청크 md5 대조 3점으로 판정

---

## §3 — 2026-08-24 사이클 소급 검토 요청 (Irene 지시)

이번 사이클은 Fable 게이트 없이 Opus 가 설계·구현·검증했다(Irene 판단). **배포 후 소급 검토 요청.**

### 3-A. 그래프 두 선 재정의 + 기준선 차감 폐기 (구조적 결정)
- 진척 = Σ(예측시간 × 진행률) / 실제 = Σ(실제시간 × 진행률). 두 선이 같은 축.
- **기준선 차감(Δ) 폐기** — 하향 정정이 `max(0, 1−5)=0` 으로 영구 클램프되던 구멍(#385).
- 정의 정본 `services/progressBaseline.js`(estDoneOf/actDoneOf)를 **4개 표면**이 공유:
  라이브 그래프(routes/tasks daily-progress) · 보고서(reportUnitSnapshot) ·
  개인 주간보고(weeklyReviewSnapshot) · 프론트 오늘 점(QTaskPage).
- **검토 포인트:** ①Δ 폐기로 이월분이 이번 주 선에 실린다 — #254 회귀와의 경계 ②과거 보고서
  수치가 소급 변경된다(스냅샷 재해석) ③포커스 실측을 진행률로 환산한 것의 타당성.

### 3-B. Task afterSave 훅 — 같은 날 스냅샷 갱신 (쓰기 경로 신설)
- `services/task_snapshot.js touchTodaySnapshot` + `models/index.js` 훅 등록.
- D 일자 행의 의미를 "D 00:00 사진" → "D 에 대해 알려진 최신 상태" 로 변경.
- **검토 포인트:** ①모든 task 쓰기에 쿼리 2~3개 추가 — 대량 업데이트 경로의 부하
  ②과거 날짜 행 불변 보장 ③멱등성(재실행 created=0 확인했음).

### 3-C. 계획·진척에 완료 업무 포함 (카드 수치 변경)
- `loadBreakdown` 이 완료를 걸러 **계획 55.5h·진척 0.3h** 로 과소 표기하던 것을 완료 포함
  (**계획 75.0h·진척 19.1h**)으로. 대각선 종점과 카드가 같은 수가 된다.
- **검토 포인트:** 계획이 완료해도 줄지 않는다는 원칙(2026-08-21)과 `진척+남은=계획` 항등식 정합.

### 3-D. 쓰기 실패 표면화 (P0-1)
- `saveField`/`changeStatus` 가 `if(!r.ok) return` 으로 침묵하던 것을 인라인 배너 + 서버 재조회로.
- **검토 포인트:** 남은 침묵 지점 전수(다른 페이지의 동일 관용구) · 401 창에서 쓰기 유실 대책.

### 3-E. 완료 해제 시 진행률 0 (전이 규칙 변경)
- `revertStatus` 가 `fromStatus==='completed'` 이면 `progress_percent=0`.
- **검토 포인트:** 컨펌 반려(revision) 경로와의 충돌 여부 · 되돌림 마커/이력 정합.

### 3-F. 보안 경계 — daily-prompt-items 스코프 신설
- 무스코프 `assignee_id` 조회 → `business_id` 필수 + 403 게이트(양·음성 반증 완료).
- **검토 포인트:** 같은 형태의 무스코프 조회 잔존분(TENANT 가드 base 26).
