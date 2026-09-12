## 현재 작업 상태
**마지막 업데이트:** 2026-09-12 20:45 UTC
**작업 상태:** Q sale 후속 1·2 완료(커밋 `a353e1c4`, **미배포**) · 후속 3~5 남음

### ★ 방금 끝낸 것 (커밋 a353e1c4 · 3eeb6ca5 · 28656ba4 — **셋 다 미배포**)

**③ 문의 추가에 AI 입력 · 첫 상담 기록 · 등록자 (28656ba4)**
- `POST /api/sale/:biz/inquiry/extract` — 전화 메모·메일 본문을 붙여넣으면 6필드 추출, **저장 안 함**
  (사람이 확인 후 저장 · "AI 가 채운 값" 안내). 비용 3종 + `PURPOSES.sale_extract`.
- 모달에 **첫 상담 기록**(종류 전화·미팅·방문·메모 + 내용) → `client_interactions` 1건(`created_by`=나).
  생성 로직은 `services/saleInteraction.js` **한 문**(상담 원장 POST 와 공유 — 베끼지 않았다).
- **등록자·등록 시각** — `client_stage_history` 첫 행에서 파생(새 컬럼 0). ClientPanel "등록" 절.
- 초안 kind `sale-inquiry-add`. 가드가 `usage.cueKind.extract` 라벨 누락을 선제로 잡았다.
- 검증: 실호출 16/16 · 실브라우저 8/8(폰 390 포함) · `--suite drafts` 0 · 빌드 EXIT 0 · guard 49/50.
- ★ **dev 에는 활성 구독이 없어 새 문의 생성이 422(플랜 게이트)로 막힌다** — `client_stage_history` 0건이
  그 증거. 기록 경로는 "기존 고객 연결" 분기로 쟀다. 운영 정책 확인 필요(대기열 14번 질문 4).
- ★ **미결정: `clients.sales_source` 에 'visit' 추가 여부** — Irene "전화/방문". ENUM append 는 운영
  ALTER(R=1)라 하지 않았다. 지금은 방문이 **상담 기록 종류**로만 남고 유입 통계에선 'other' 로 섞인다.

### 앞 라운드 — 업무 추가 폼 복사본 4→1 (a353e1c4 · 3eeb6ca5)
- **업무 추가 폼이 한 벌이 됐다** — 네 자리(QTaskPage 인라인·드로어 / Q sale 상담 / Q project 업무 탭)가
  `components/QTask/TaskCreateForm.tsx`(535줄) 하나를 쓴다. QTaskPage 4223→3598 · TasksTab 648→433.
- 합치며 드러난 실제 결함 3: ①Q project 에 태그·첨부 없음 ②반복 UI 두 벌(공용 `RecurrencePicker` 로 통일,
  사용자 지정 모달 폐기) ③**§5.7 — 남을 담당자로 고르고 적은 예측시간이 조용히 사라졌다**
  (서버가 버리는데 화면은 요청 탭에서만 숨겼다 → `capacityMine` 한 술어로 통일, 값도 안 보낸다).
- 상담 행 클릭 → `ClientPanel` 의 `inquiry` 분기 우측 패널. 펼치기 토글 제거.
- 하니스 `run.js` 가 dotenv 를 먼저 싣는다 — "총 실패 0 + 종료코드 1" 로 초록이 빨간불로 읽히던 구멍.
- 검증: 빌드 EXIT 0/`error TS` 0 · guard 49/50 · health 43/43 · **신규 `--suite taskaddparity` 20/20** ·
  `tabletchrome` 9뷰포트 0 · 회귀 `drafts,detailopen,inboxcount` 0 · DB 왕복(반복·그룹·§5.7 버림·남의 그룹 400) ·
  3폭 실측. **Fable 미검증(자체 검증) — 한도 초과 7회, 대기열 12·13번**
- 남은 부채: 없음(복사본 4→1). `pages/QProject/ProjectTaskList.tsx` 의 **행 단위 빠른 추가**는 성격이
  달라(표 안 한 줄) 그대로 뒀다 — 합칠 대상인지 판단 필요.

### 앞 라운드 (a353e1c4 상세)
- **업무 추가 폼 단일 원천** `components/QTask/TaskCreateForm.tsx`(신규 629줄).
  세 벌(QTaskPage 인라인·드로어 / Q sale)이 이미 갈라져 있었다 — 태그는 인라인에만, 요청 탭 예측시간
  가드는 드로어에 없었다(§5.7 위반), Q sale 은 제목+설명 2칸. QTaskPage 4223→3599줄.
- **상담 행 클릭 → 우측 패널** — `ClientPanel` 의 `inquiry` 분기(이름·이메일+확인·회사(추정)·유입경로·
  제목·내용·시각 + [보기]·[고객으로 등록]). 펼치기 토글 제거. 시각은 `useTimeFormat`.
- 검증: 빌드 EXIT 0/`error TS` 0 · guard 49/50 · health 43/43 · **신규 `--suite taskaddparity` 15/15** ·
  회귀 `drafts,detailopen,inboxcount` 0 · 실HTTP 7/7. **Fable 미검증(자체 검증 — R=0·F=1)**
- 남은 부채: **Q project TasksTab = 네 번째 복사본**(업무 그룹·프로젝트 고정이 달라 제외했다)

### 이번 세션 배포
| 배포 | 커밋 | 백업 | 비고 |
|---|---|---|---|
| 1차 08:31 | `8c642085` | `20260912_083154` | 승인완료(done_feedback) 단계 부활 + Q sale 실시간 |
| 2차 09:47 | `81cd75db` (내용 `3710babf`) | `20260912_094734` | Q sale 상담 기준·정보 통합·우측 패널 |

롤백: `ssh irene@87.106.78.146 'tar -xzf /opt/planq/backups/<TS>/backend.tar.gz -C /opt/planq && pm2 reload planq-prod-backend'`

### 완료된 작업 (이번 세션)

**① Q sale 입구를 고객 → 상담(고객 미등록 문의)으로** (1차·2차 걸쳐)
- `services/saleInbox.js`(신규) + `GET /api/sale/:biz/inbox`. 새 테이블 없이 원본 3곳에서 `client_id IS NULL` 만 읽는다
- 행의 단위는 **대화방**. 게스트 링크는 별개 접점이 아니라 그 대화의 신원 → 중복 해소(914→912)
- 등록 가능 판정은 `source` 가 아니라 **`ref.kind`** — 게스트가 채팅에서 이메일을 남기면 그 링크로 등록된다
- 집계는 별도 COUNT, 칩 선택과 무관하게 계산(전체 7인데 칩 누르면 9로 튀던 결함 수정)

**② 상담의 기준을 세웠다 (2차)**
- 여태 **기준이 없었다** — 고객이 한 마디도 안 해도 방이 있으면 올라왔다
- 이제 **외부(비멤버) 발화 ≥ 1** 인 방만. 링크만 있고 말 없는 방은 `account_requested_at` 있을 때만
- dev 반증: 미연결 대화방 9개가 **전부 외부 발화 0건** → 채팅·게스트 0은 과잉 차단이 아님

**③ 회사·이메일·이름 표시** — 회사는 이메일 도메인 추정, 무료메일 + **발송 전용 주소** 제외
(`no_reply@email.apple.com` 을 회사로 내놓던 것을 실측으로 잡았다). 추정값은 `estimated` 로 구분

**④ 고객 정보 한 벌로 통합** — `GET /clients/:id` 에 `contact`(초대/계정/청구/세금계산서 이메일을 **종류별로**)·`biz` 추가.
`ClientPanel`(우측 패널, **정보만**) + 전체보기 아이콘 + `ClientLink`(이름 어디서나 같은 방식으로 열기).
**관리(초대·보관·삭제·한도)는 설정에만** — Irene 지시

**⑤ 고객 탭 페이지 전환 제거** → 우측 패널(재클릭 토글). 문의 추가 후에도 패널로 이어진다

**⑥ 필터를 탭 아래로** · "원본 열기" → **[보기]**

**⑦ 업무 추가가 빈 입력** — 메일 제목·본문을 베끼지 않는다. 그 입력은 쓰다 닫아도 남는다
(draft kind `sale-task-add` 등록 — 예외 선언이 아니라 실제 임시저장. 래칫 89→88 복구)

**⑧ 업무 승인완료(done_feedback) 단계 부활** (1차 배포)
- 컨펌 충족 시 `completed` → **`done_feedback`**. `completed_at`·진행률 100 안 찍는다
- `complete` 액션에 예외(컨펌자 있어도 `done_feedback` 이면 통과) — 없으면 **아무도 닫을 수 없는 막다른 길**
- 확인필요 5번째 버킷(verb `finish`) · `weekTaskSet` · `popoutSort` 에 모두 반영
- **운영 ENUM ALTER 0건** — 값이 살아 있고 코드 경로만 0이던 폐지값을 되살렸다
- 2026-04-25 "자동완료 유지 + 알림만" 결정을 되돌린 것(같은 신고 두 번, #282)

**⑨ Q sale 상담 목록 실시간** — 새 이벤트를 만들지 않고 있는 신호를 듣는다
(`message:new`·`mail:new`·`inbox:refresh`) → 250ms debounce silent 재조회 + `useVisibilityRefresh`

### ★ 작업 원칙 (2026-09-12 Irene 지시 — 이번 세션에서 내가 어긴 것)

> *"뭘 개발해도 새로운거 새로운 디자인. 기능형태 ui/ux 마음대로 생성하지마. 동기화도 다 되어야 해."*

**구현 전에 먼저 찾는다.** 같은 일을 하는 화면이 있으면 그것을 쓰고, 인라인이라 재사용이 안 되면
**공용으로 빼서** 둘이 같이 쓴다. 새로 그리면 필드·동작이 갈리고 고칠 때 한 곳만 고쳐진다.
껍데기도 이미 있다 — `CreateDrawer`(우측 생성 폼) · `StandardModal`(가운데) · `DetailDrawer`(상세 패널) ·
`dropdownShell` · `AttachmentField`. 자료도 **응답 한 곳**을 정본으로 쓴다(화면마다 모으면 갈라진다).
CLAUDE.md "새로 만들지 않는다" 절에 박제했다.

### 다음 할 일 (Q sale 후속 — Irene 지시 잔여)

> **★ 2026-09-12 오후 추가 지적 2건 — 아래 1·2 가 그것이다. 배포 뒤에 받았다.**

1. ~~**상담 행 클릭 → 우측 패널**~~ ✅ a353e1c4 (Irene: *"상담 탭 리스트에서 리스트 누르면 해당 고객 정보가 우측 패널에
   뜨게 해달라고 했잖아. 이건 아직 안한거야? 만약 고객이 아니고 게스트면 **가져올 수 있는 정보를 다
   넣어야지. 이름 이메일주소 등등**"*)
   - 미등록 문의는 고객 레코드가 없어 `ClientPanel` 을 그대로 못 쓴다 → **`InquiryView` 분기**로 간다
     (타입은 `components/QSale/ClientPanel.tsx` 에 이미 추가해 뒀다: who·email·company·title·preview·
     at·needsReply·source·canRegister·emailVerified)
   - `SaleInboxList` 의 행 클릭이 지금 **펼치기 토글**(`setOpenId`)이다 — 패널 열기로 바꾸되
     펼치기를 없앨지 같이 둘지 정해야 한다
   - 넣을 것: 이름·이메일(+확인 여부)·회사(추정 표시)·유입 경로·제목·마지막 내용·시각·답변 필요 여부
     · [보기] · [고객으로 등록](`canRegister` 일 때만)

2. ~~**업무 추가 팝업을 기존 것으로 교체**~~ ✅ a353e1c4 — 공용 `TaskCreateForm` 로 세 자리가 같아졌다
   (Irene: *"업무추가 팝업이 왜 새거야? 기존 업무추가 항목들하고 기능하고 다르고?"*)
   - 지금 `SaleInboxList` 에 **`StandardModal` 로 새로 짠 제목+설명 2칸 모달**이 들어가 있다.
     기존 업무 추가에는 **프로젝트·담당자·마감일** 등이 있는데 여기엔 없다 → 화면마다 기능이 갈린다
   - **재사용 대상**: `components/Common/CreateDrawer`(props: `open·onClose·title·children·onSubmit·
     submitting·submitLabel·submitDisabled·wide·leftSlot`) + `pages/QTask/QTaskPage.tsx:3513` 의
     `PanelAddForm` 구성(업무명 · 프로젝트 · 담당자 · 마감 · Ctrl+Enter 저장)
   - 그 폼은 지금 QTaskPage 안에 인라인이라 **공용으로 빼야** 두 곳이 같아진다. 빼는 김에
     Q project TasksTab 도 같이 쓰게 할지 검토
   - ★ 지금 붙여둔 임시저장(kind `sale-task-add`)은 **교체 후에도 유지**해야 한다(쓰다 닫으면 날아감)

3. **문의 추가에 AI 입력 · 작성자 기록 · 유입 경로(전화/방문 등) 명확히** — 모달은 이미 있다
   (`sale-add-inquiry`, 이름·회사·전화·이메일·유입경로). AI 추가와 작성자가 빠져 있다
   - **AI 는 `components/QTask/AiTaskCreateModal.tsx` 패턴을 따른다**
     (props: `open·onClose·businessId·projectId·onCreated`) — 새로 짜지 말 것
3. **Q sale 배지 ⓑ** — 지금 `collectSale` 은 **등록된 고객**만 센다(미등록 문의는 어느 배지에도 없다).
   메일·채팅 알림이 닿지 않는 **게스트 링크 문의만** 더한다. `sales_source !== 'email'` 조건이 이미 있어
   이중 계수는 없다(확인 완료)
4. **계약 불발 사유 입력** — 서버는 `lost_reason`·`lost_note` 를 받는데 지금은 단계만 넘긴다.
   왜 깨졌는지가 원장에 안 남는다

**의도적으로 뺀 것**: 프로젝트 만들기·청구하기 액션 — `/projects`·`/bill` 이 고객 지정 쿼리를
**읽지 않는다**(실측 0건). 지금 버튼을 달면 고객이 안 실린 빈 화면으로 가는 죽은 링크다.
받는 쪽을 먼저 만들어야 한다.

### Fable 게이트 — 오늘 **5회 모두 한도 초과**
`docs/FABLE_GATE_QUEUE.md` 9·10·11번. 마커는 `by:"unavailable"`.
한도가 풀리면 **9·10·11번을 한 라운드로 묶어** 사후 검증한다(쪼개 올리지 않는다).
오늘 배포 2회 모두 **독립 검증 0회**다.

### 이번 세션에서 내 검사기가 거짓말한 것 (같은 실수 반복 금지)
- 카나리 ④가 게스트 행 **0건을 보고 `0===0` 으로 통과**(빈 데이터 초록) → 0건이면 **판정 불가(실패)** 로 바꿨다
- 승인 카나리가 `/마무리|완료/` 로 긁어 앱 크롬의 "이번 주 마무리" 를 잡아 **드로어가 안 열려도 통과** →
  드로어 안 + "최종 완료" 문자열로 좁혔다
- Q sale ⑦이 앞 단계가 켜둔 "답변 필요만" 필터를 물려받아 **거짓 FAIL** → 필터를 끄고 계측
- `error TS` 0 을 **아직 안 찍힌 0** 으로 읽을 뻔했다(빌드 완료 신호를 먼저 확인할 것)
- 빌드를 앞 빌드가 끝나기 전에 또 걸어 로그가 겹치고 SIGTERM(143)이 찍혔다

### 남은 기술 부채
- `routes/dashboard.js` 1349줄 / god-file 임계 **1350줄** — 여유 1줄. 다음 사이클에 수집기 분리 필요
- Q sale 설계 §5.2 "확인 필요 스트립" 미구현 (상담 목록의 "답변 필요" 칩이 일부만 대신)
- dev 대화방 331의 `last_message_at` 은 probe 가 바꾼 뒤 **원래 값을 몰라 못 되돌렸다**(영향: 정렬 순서만)

### 사람이 해야 할 것 (Irene)
- iOS 앱 재빌드(Codemagic) — 키보드 위 ▲▼✓ 바
- 운영 피드백 #409 · #410 답글

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
