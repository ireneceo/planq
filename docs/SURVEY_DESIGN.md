# 설문 (#460) 설계 — 2026-10-07

> **Fable 설계 판정(2026-10-07): CHANGES → 아래 «Fable 수정 7건» 이 본문보다 우선한다.** 본문의 해당 줄은 이 절로 읽는다.
>
> 1. 보안등급 = `securityLevel.blocksExternalShare` 그대로(**internal 도 거절**) · `PUT /posts/:id/security-level` 상향 시 `survey_token=NULL` 같이
> 2. 공개 GET/POST 매 요청 판정 = `services/survey.js resolveSurveyToken` **한 함수**: 토큰 → q_record → Post(paranoid) → Business 생존 → 등급 → published → 마감 → 정원 → 하드캡(설문당 5,000)
> 3. `survey_token` 은 설정 라우트(`GET /api/records/:id/survey`, 켜기 권한자)에서만 내린다 — records 상세·목록·post serialize 에서 뺀다 + `health-check --category=secrets` 1건
> 4. 켜기 술어 = `getUserScope`(owner/admin/member — 고객·ai·해제 멤버 제외) ∧ `posts.canEditPost` (L1 은 작성자만). records.js `assertMember` 를 베끼지 않는다
> 5. 응답 행 `created_by` **NULL**(외부 응답) · `q_record_audits.user_id` NULL 허용 + `action` ENUM `row.survey` append — 스키마 변경 4건(아래 §1 갱신)
> 6. 레이트리밋 주 키 = **토큰**(`guestLimiter` 재사용: POST 분 60·일 2000, GET 분 120) · IP 보조(분 20·시 300) · 본문 상한은 `content-length` 선검사(전역 json 10mb 가 먼저 읽는다) + 칸별 상한
> 7. 공개 화면 경로 **`/public/survey/:token`**(크롬 숨김·앱 열기 배너·robots 가 자동으로 따라온다) · 실시간 `record:row` 방송·리스너는 **신규**(신호만) · 알림 `event_kind` 'survey' 를 notifications·notification_prefs **양쪽** append(순서 다름) · 10분 묶음은 DB 의 마지막 알림 시각으로
> - 질문지 GET 에 내보내지 않는 것: aggregate·max_responses·응답 수·각종 숫자 id. 칸 설명은 `survey_settings.help:{colId:text}`(columns JSON 을 늘리지 않는다)
> - 운영 스크립트 `migrate-survey.js`(멱등, 코드 배포 전): q_records 2컬럼 · q_record_rows.created_by NULL · q_record_audits.user_id NULL + ENUM · notifications/notification_prefs ENUM

> Irene #460: *"설문 > 관리 > 통계확인 이런거"* · 결정(2026-10-07): *"어차피 외부 고객도 그냥 접속 가능하잖아. 이게 입력만 받으면 되는 건데 제한할 의미가 있어?"*
> → **링크를 가진 누구나 응답**(외부 포함). 검토 의견: `docs/SURVEY_FEASIBILITY_2026-10-07.md`

## 0. 한 줄

**설문 = 표 문서(Q docs `kind='table'`)의 «응답 받기» 문.** 문항 = 표 칸, 응답 1건 = 표 1줄, 관리 = 표 화면 그대로, 통계 = 칸별 집계.
새 표·새 메뉴를 만들지 않는다(CLAUDE.md «새로 만들지 않는다»).

## 1. 데이터 (스키마 변경 — `q_records` 컬럼 2개, 멱등 스크립트)

| 컬럼 | 뜻 |
|---|---|
| `survey_token` VARCHAR(64) NULL UNIQUE | 응답 링크 열쇠. NULL = 설문 꺼짐. 끄면 NULL(옛 링크 즉시 죽음). 다시 켜면 **새 값** |
| `survey_settings` JSON NULL | `{ title, intro, required:[colId], hidden:[colId], closes_at, max_responses, notify:true }` |

- 응답 행: `q_record_rows` 그대로. `created_by` 는 NOT NULL 이라 **설문을 켠 사람**(=`survey_settings.owner_id`)으로 채우고,
  출처는 `values` 가 아니라 **새 컬럼 없이** `q_record_audits.action='row.survey'` 로 남긴다(행 이력에서 «설문 응답» 으로 보임).
- 운영: `scripts/migrate-survey.js`(멱등, 배포 슬롯 — 코드 배포 전).

## 2. 열쇠는 **문서 공유 링크와 따로**다 (가장 중요한 결정)

문서 공유 링크(`posts.share_token`)는 **표 내용을 읽는** 열쇠다. 설문 링크는 **한 줄을 쓰기만** 하는 열쇠다.
같은 열쇠를 쓰면 «응답하라고 보낸 링크로 남의 응답 전체를 읽는» 길이 생긴다. 그래서:

- 설문 링크로 할 수 있는 것은 정확히 두 가지 — ① 질문지 읽기(칸 이름·종류·선택지·설명) ② 응답 1건 쓰기.
- **응답을 읽는 공개 경로는 없다.** 응답은 표 문서를 볼 수 있는 사람만 본다(`canViewRecord` = 문서 읽기 술어 그대로).
- 질문지에서 빠지는 칸: `secret` 타입(항상) · `hidden` 으로 고른 칸(내부 메모용 칸 — 담당·처리상태 등).

## 3. 누가 켜고 끄나

- 켜기·끄기·설정: **그 표 문서를 고칠 수 있는 사람**(표 행 쓰기와 같은 판정 — `canViewRecord` + 워크스페이스 멤버, 고객 역할 제외).
- 보안등급: 문서가 **`confidential`(기밀)이면 설문을 켤 수 없다**(밖으로 나가는 문 규칙 4). `internal` 은 허용 —
  질문지는 칸 이름·선택지뿐이고 응답은 들어오기만 한다. ★ Fable 판단 요청 지점.
- 문서를 휴지통에 넣으면 설문도 닫힌다(공개 GET/POST 가 문서 삭제 여부를 본다).

## 4. 무인증 표면 — `routes/survey_public.js` (`/api/survey/:token`)

| 라우트 | 응답 |
|---|---|
| `GET /api/survey/:token` | `{ title, intro, workspace_name, closes_at, closed, questions:[{id,name,type,options?,required}] }` — 응답·행 수·작성자 정보 없음 |
| `POST /api/survey/:token/responses` | 201 `{ ok:true }` 만. 만든 행 id 도 돌려주지 않는다 |

- 모르는 토큰·꺼진 설문·삭제된 문서 = **404 한 가지**(존재 여부를 가르지 않는다). 마감·정원 초과 = 410 `survey_closed`.
- 입력 검증은 칸 타입별 **서버 한 함수**(`services/surveyAnswer.js`): text 500자 · longtext 5000자 · number 유한수 · date `YYYY-MM-DD` ·
  checkbox bool · select 는 **선택지 안의 값만** · multi_select 선택지 부분집합 · email/phone/url 형식. 질문지에 없는 칸 id·secret·hidden 칸은 **버린다**(400 아님).
  필수 칸 누락 = 400 `required_missing`. 본문 상한 64KB.
- 남용: IP 당 분 5회·시간 30회(실패도 셈) · 토큰당 하루 2000건 · 꿀단지 칸(`website`)이 채워지면 **201 을 주고 저장하지 않는다**.
- 알림: 새 응답 → 설문을 켠 사람에게 **앱 알림만**(`skipChannels:['email']`), 같은 설문 10분에 1건으로 묶는다. 실시간: 표 문서 화면에 `record:row` 신호(id 만).
- 감사: `q_record_audits(row.survey)` — 응답 값은 AuditLog 에 싣지 않는다(표의 기존 규칙).

## 5. 화면

- **표 문서 머리 ⋯ 메뉴 → «설문으로 받기»** → `DetailDrawer`: 켜기 스위치(AutoSaveField) · 링크 복사 · 제목·안내문 · 칸별 «필수 / 숨김» · 마감일 · 최대 응답 수.
  끄면 «이 링크는 더 이상 응답을 받지 않습니다» 확인(ConfirmDialog).
- **공개 응답 화면 `/s/:token`**(로그인 불필요, 랜딩 껍데기 아님): 칸을 위→아래 문항으로. 칸 타입별 입력(기존 표 셀 편집기와 같은 규칙) ·
  필수 표시 · 제출 → «응답이 전달되었습니다» · 다시 응답하기. ko/en(브라우저 언어). 폰 우선.
  하단에 «응답은 {{워크스페이스}}에 전달됩니다» 한 줄(개인정보 수집 고지 — 무엇을 묻는지는 만든 사람이 정한다).
- **통계** — 표 문서에 «통계» 보기 토글: select·multi_select·checkbox = 비율 막대 · number = 평균·최소·최대 · date = 날짜별 건수 ·
  text/longtext = 최근 응답 목록(+ 행 수). `GET /api/records/:id/survey-stats`(인증, `canViewRecord`). 응답 0건이면 빈 상태 문구.

## 6. 검증 계획

- 서버: 토큰 없는/꺼진/삭제 문서 404 · 마감 410 · 필수 누락 400 · 선택지 밖 값 거절 · secret/hidden 칸 주입 무시 · 꿀단지 저장 0 ·
  레이트리밋 429 · 설문 링크로 응답 읽기 경로 0(GET 응답에 values 없음) · 끄면 옛 토큰 404 · 다시 켜면 새 토큰 · 기밀 문서 켜기 거절 ·
  고객 역할 켜기 403 · 남의 워크스페이스 표 켜기 403 · 통계 = 실제 행 집계와 일치 · L1 문서 통계는 작성자만
- 화면: 공개 응답 3폭(폰·태블릿·데스크탑) 제출 → 표에 줄 생김 · 설정 서랍 · 통계 보기
