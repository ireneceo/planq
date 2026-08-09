# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-09 11:00 UTC (Opus 5, 1M)
**작업 상태:** **음성 3경로 완료(PASS) + 청크 A(#217a·#241·PWA개행) 구현 완료 — Fable 구현게이트 FAIL 1건 수정 후 재검 대기. 전부 미배포.**

> **다음 섹션에서 이어서 할 일: ① 청크 A Fable 재검 → ② 청크 B(#221 메일 5요구) → ③ 청크 C(#217b 세금계산서 메일, Irene 문안 확인 필요) → ④ 청크 D(음성 컨텍스트→메일 답장)**

> ## ⚠️ 이 파일이 낡으면 Fable 이 오판한다
> 지난 세션에서 Fable 이 옛 내용을 읽고 **"#252 는 게이트 FAIL, 배포 금지"** 라고 두 번 잘못 판정했다.
> 정본은 `.claude/.fable-gate.json` 마커 + 아래 표다. 청크를 끝낼 때마다 이 파일을 갱신할 것.

---

## 🟡 청크 A — #217(a) 증빙 뱃지 · #241 Q Note 번역 · PWA 개행 (2026-08-09, 재검 대기)

**Irene 지시 "다 해":** 백로그 #217·#221·#241 + 자체발견 2건을 4청크로 나눠 진행 중. **청크 A 만 구현 완료.**

### 운영 피드백 원문 (운영 DB 직접 조회 — 요약본 금지)
- **#217** "Q bill 에서 증빙탭에서 발행마킹을 하면 **바로 탭에 있는 알림숫자가 안바뀌고 있어**. 세금계산서 발행도 고객에게 이메일 보낼건지 물어보거나 체크하고 같이 보내주는 거지. 발행했다고 알림메일 보내야지. 그리고 제대로 보내는 거 **메일알림 샘플로 보내줘봐. 내용 확인하고 연결하자**." → 첫 문장만 청크 A, 나머지는 **Irene 문안 확인 선행**이라 청크 C
- **#241** "음성노트에서 **번역이 필요없는 경우도 있는데 다 영어번역이 나와. 기본적으로.** 한국어/한국어로 설정해도 번역이 나오네. **고급설정을 번역필요라고 말하고 체크하게 해. 체크하면 번역언어 설정나오게 하면 어때?**"

### ★ 진짜 원인 — 프롬프트에 영어가 박혀 있었다
`q-note/services/llm_service.py` `SYSTEM_KO` 안에 **`## 2. translation (영어 번역)`**,
`SYSTEM_DEFAULT` 는 `"Korean↔English"`. `_build_translate_system` 은 **회의 언어만** 보고
`translation_language` 도 `translate_enabled` 도 참조하지 않았다 → **한국어 회의는 어떤 설정을 해도 영어 번역.**
게다가 `translate_enabled` 는 **읽는 코드가 0곳인 죽은 플래그**였고, 프론트가 `/translate-answer` 를
**자동 호출**해 게이트를 우회하고 있었다.

### 구현
- **전사 번역(주 표면)**: 프롬프트 §2 절만 `{translation_lang_name}` 인자화(교정·질문감지 문구 무접촉) ·
  `_LANG_NAMES` 12→24종 · 서버측 `translation=''` **강제**(LLM 순종에 의존 X) · `detected_language` 기준 판정(multi 세션)
- **술어 단일화** `wants_translation()` = `enabled AND 목적지 있음 AND 목적지 ≠ 내용언어` — 전사·답변·translate-answer 공용
- **기본 OFF**(`sessions.py` 모델 기본값까지) + 고급설정 **"번역 필요" 체크박스** + 체크 시에만 언어 셀렉트
- **회의 중 토글**: WS 제어 메시지 `settings:reload` (연결 시 1회 캐시라 없으면 "켰는데 안 나온다")
- **#217(a)**: QBillPage 가 window CustomEvent 만 듣고 socket 을 안 들어 **리스트는 갱신되는데 뱃지만 멈춰** 있었다
  → socket 3종(`invoice:updated`/`inbox:refresh`/`invoice:deleted`) + `useVisibilityRefresh` + 회차취소 broadcast 1줄
- **PWA 개행**: `plainToHtml` 적용

### Fable 게이트
| 라운드 | 판정 |
|---|---|
| 설계 1판 | **REJECTED** — 내가 답변 번역만 보고 **전사 번역(주 표면)을 통째로 누락** |
| 설계 2판 | APPROVED_WITH_CONDITIONS(9) |
| 구현 1차 | **FAIL(HIGH 1)** — 아래 |
| 구현 2차 | **재검 대기** |

**구현 FAIL 내용(수정 완료, 재검 필요):** 프론트 `translateOn` 이 서버 술어 3조건 중 **1개만** 봐서
(`translate_enabled` 만), 목적지 미지정·같은 언어 세션에서 번역 대신 **"번역 중…" 이 영원히** 남았다.
운영 70세션 중 **22세션(31%)** 해당 + **한국어/한국어 = Irene 원문 시나리오 그대로**.
→ `translateOn` 을 서버와 동일한 3조건으로 정렬.

**★ 내가 Fable 을 반증한 1건:** Fable 설계 조건 7 `target_language` 제거 요구를 **거부**했다.
"죽은 파라미터(호출자 0곳)" 라 했으나, `QNotePage submitManualQuestion → translateVerified` 가
**수동 질문의 회의언어 2슬롯 렌더링**에 쓴다 — 제거하면 그 기능이 죽는다. Fable 이 실HTTP 로 재확인 후
**자신의 조건 7 이 틀렸음을 인정**했다(OFF+target 있으면 2슬롯 생존, target 없으면 게이트 작동).

### 검증
| 스위트 | 결과 |
|---|---|
| q-note 실LLM (`test-qnote-translate.py`) | **22/22** |
| QBill 뱃지 실브라우저 2탭 (`canary-qbill-badge.js`) | **5/5** — `증빙1 → 증빙` 실측, 테스트 청구서 삭제·잔여 0 |
| PWA 개행 (`canary-prefill-newline.js`) | **6/6** |
| health-check / guard-invariants / build | 34/34 · 23/23 · EXIT 0 |

- **반증 성립**: 프롬프트 인자화를 되돌리니 **ko→ja 가 영어로** 나옴(FAIL 4) → 원복 md5 일치 → 22/22 복귀
- ko→ja 실측 `"それでは、来週の火曜日にミーティングは可能ですか？"` — 영어 하드코딩이 실제로 풀림
- OFF 에서도 `formatted_original`·`is_question` **10/10 유지** (번역만 죽이고 교정·질문감지는 살림)
- **Fable 부산물 소견:** OFF 케이스는 서버 강제를 빼도 통과한다(LLM 이 override 를 따라줌).
  **강제가 load-bearing 임을 무는 건 multi 세션 케이스뿐** — OFF 만 보는 검사기는 강제를 검증 못 한다

### 구현 FAIL 수정 후 재검증 (Fable 자신의 탐지기로 확인)
| 케이스 | 수정 전(Fable 실측) | 수정 후 |
|---|---|---|
| `enabled=1 / dest=NULL` | "번역 중…" **영구 표시** | **표시 안 됨** ✅ |
| `enabled=1 / dest=ko (회의도 ko)` ← **Irene 원문 시나리오** | "번역 중…" **영구 표시** | **표시 안 됨** ✅ |
| `enabled=0` | 표시 안 됨 | 표시 안 됨 ✅ |
- QBill 뱃지 5/5 · PWA 개행 6/6 · build EXIT 0 재확인
- **정상 ON 세션(dest=en)** 은 "번역 중…" 이 뜬다 — 번역이 오는 중이므로 **정상**.
  단 Fable 이 "세션 **재진입** 시엔 정상 ON 세션도 placeholder 가 남는다(기존 결함, 이번 변경과 무관)" 고 판정했다 → 아래 백로그

### 남은 것 (Fable 지적, 다음 섹션)
- **[기존결함]** 세션 **재진입** 시 정상 ON 세션에서도 "번역 중…" 이 남는다(캐시 답변에 번역이 없고 재요청 경로가 없음). 이번 변경이 만든 것은 아니나 같은 화면의 결함
- [MEDIUM] `/translate-answer` 의 `target_language` 가 회의 언어인지 **서버 검증 없음** — 장래 자동 호출이 붙이면 게이트 재우회
- [LOW] `q-note/routers/llm.py:55 POST /translate` 가 게이트 밖(소비처 0건이라 현재 무해)
- 모달에서 회의/답변 언어를 번역 목적지로 못 고르게 막기(신규 세션 경로 차단)
- `components/Focus/FocusWidget.tsx` 도 window 만 듣고 socket 미청취 (#217a 와 같은 계열)
- `ShareReceivePage.tsx` 의 `/docs?prefill=` 은 **소비자 0건** (지난 사이클 `voice=` 와 같은 계열)

---

## 📋 다음 섹션 착수 자료 — 청크 B/C/D (조사 완료분)

### 청크 B — #221 메일 (2026-07-25 원문, 요구 5개)
> "이메일을 아래 같은 것을 받았어. 그런데도 **답변필요 메일 리스트로 안왔어. 확인권장에도 안왔어.
> 기준이 뭐야? 제대로 판단할 수 있게 기준을 재정비 못해?**
> 그리고 리스트에 **검토권장이라고 나오는게 확인권장 탭에 나오는 거지? 이름을 똑같이 확인권장으로 통일해.
> 그리고 답변필요도 표시해줘야지.**
> 그리고 **답장하기 옆에 AI 답변 초안 버튼이 제대로 나와야지. 모든 탭에 제대로 나와야 해.** 답변을 어디서든 할 수는 있어야지.
> 그리고 **메일 작성폼, 새 메일에서도 ai로 작성할 수 있어야지**"
> (인용된 메일 2건: 세무회계사무소 지성의 부가세 신고완료·납부서 / Apple Developer 등록 수락 — 사용권 계약 동의+멤버십 구입 필요)
> "*** 아래 메일은 **무조건 확인해야 하는데** 제대로 확인권장에 안들어와서 **업무 미스 했어.**"

**운영 실물 확인함** — 두 메일 다 운영 DB 에 있다:
- `mail@jisungtax.com` (세무회계사무소지성) — msg 1441/1384/1445 등 다수
- `noreply-appledev@email.apple.com` — msg 1283 "Apple Developer Program 등록을 계속 진행하세요." 외 1004/1005/1246/1257

**분류기 구조 파악 완료** (`dev-backend/services/emailTriage.js` 503줄):
- `triageInbound` 가 단일 원천. `triage`(spam/marketing/automated/human) × `status`(open/uncertain/…) × `reply_needed`
- **automated 여도 `hasBusinessRelevance` 면 `uncertain`(확인권장) 으로 올린다** — 정규식 `BUSINESS_RELEVANT`
- **Apple 메일이 빠지는 이유(가설, 미검증)**: `계약(서|\s*체결|\s*완료)` 는 "사용권 **계약을 검토**" 에 안 걸리고
  `\bcontract\b` 는 영어라 한국어 본문에 없음 → automated + open → 자동/마케팅 폴더에 묻힘.
  **계정·멤버십·등록 승인처럼 "내가 조치해야 완료되는" 자동 메일**이 rubric 에 없다
- 세무사 메일은 `hasStrongRequest` 의 `부탁\s*(드|합)` 에 "납부**부탁드**립니다" 가 걸려야 정상인데 안 왔다
  → **운영 실물로 분류기를 돌려 어디서 갈렸는지 확정해야 한다** (진단 스크립트 `diag-triage.js` 를 scratchpad 에 써 뒀으나 미실행)
- 라벨: 리스트 "검토권장" ↔ 탭 "확인권장" 문구 불일치 → 통일 + 리스트에 "답변필요" 표시 추가
- AI 초안 버튼: 현재 일부 탭에만 노출 → 전 탭 + 새 메일 작성폼에도

### 청크 C — #217(b~d) 세금계산서 발행 시 고객 메일
원문이 **"메일알림 샘플로 보내줘봐. 내용 확인하고 연결하자"** 로 Irene 확인을 선행 조건으로 못박음.
지난 사이클에도 "🕐 답변 대기(문안·체크박스 기본값·수신자 없을 때)" 로 남아 있다.
→ **문안을 렌더링해 Irene 에게 보여주고 승인받은 뒤 연결**. 승인 전 발송 로직 활성화 금지.

### 청크 D — 음성 화면 컨텍스트 → 메일 "답장"
설계문서 `docs/MAIL_ALIAS_AND_VOICE_DESIGN.md` §B-3 원안. 현재 시트에 스레드 컨텍스트가 없어
새 메일 컴포저로 착지 중(직전 사이클에서 정직한 축소로 남김).

---

## ✅ 완료 — 음성 캡처 `voice=` 3경로 (2026-08-09, Fable PASS · 미배포)

**발단:** 백로그 2순위. `VoiceCaptureSheet.confirm()` 이 task/event/mail 로 보내면서 받아쓴 텍스트를
`?voice=` 로 붙이는데 **그 파라미터를 읽는 코드가 프론트 전체에 0건**이었다. 세 목적지는
`create=1`/`compose=1` 만 소비해 **빈 폼**을 열었다 — 말한 내용이 페이지 전환과 함께 버려졌다.
게다가 `/api/voice/capture` 가 LLM 1회를 써서 뽑은 구조화 결과(title/detail/assignee/when)도 전부 버려졌다.
(memo 경로만 지난 사이클에 `/notes?prefill=` 로 살렸다 — 무접촉 유지)

### 설계 게이트 — APPROVED_WITH_CONDITIONS(12), 전건 반영
Fable 이 내 낙관 2건을 실측으로 뒤집었다:
- **BLOCKER-1** `setSearchParams(next,{replace:true})` 가 **이미 `location.state` 를 지운다**
  (react-router `chunk-QFMPRPBF.mjs:10517` 이 state 를 안 넘김). 내가 넣으려던 정리용 두 번째
  `navigate(..., {state:null})` 는 불필요할 뿐 아니라 그 시점 `?create=1` 을 **되살린다**
- **BLOCKER-2** 따라서 메일은 초안 fetch `.finally` 에서 state 를 읽으면 **이미 null** →
  `compose=1` effect 안에서 `setSp` **전에** `pendingVoiceRef` 로 캡처해야 한다
- **MAJOR** `matchMemberByName` 2단계 포함 일치가 실제 오배정 벡터: 멤버 `김지원` 이 있을 때 LLM 이 `assignee_name` 을
  `'지원'` 으로 뽑으면 → 김지원 배정 + **push 발송**까지 간다
- **MAJOR** `checkBusinessAccess` 는 `req.body.business_id` 를 읽으므로 **multer 뒤에** 마운트해야 한다
  (뒤집으면 정상 호출이 전부 400)
- **MAJOR** `cBody`/`newDescription` 은 **HTML** — 평문을 그대로 넣으면 개행 소실 + 마크업 주입
- **MINOR** `classifyIntent` 가 토큰을 안 실어 `cue_usage` 가 **여태 0 으로만 기록**되고 있었다

### 구현 (접촉 9파일, DB 변경·마이그레이션 없음)
**백엔드**
- `routes/voice.js` — `checkBusinessAccess`(multer 뒤) 추가 · 프롬프트에 **워크스페이스 tz 기준 오늘** 주입 +
  `when_start`/`when_all_day` 산출 · `sanitizeWhenStart` 클램프(형식/과거/+365일) ·
  `resolveAssignee`(정확 일치 전용) + `assignee_display_name` · 토큰 원장 복구. **LLM 추가 호출 0회**
- `services/aiTaskPlanner.js` — `matchMemberByName(name, members, { exactOnly })` 옵션 신설(기존 호출부 무변경)

**프론트**
- `utils/voiceHandoff.ts` (신규) — `VoiceHandoff` 계약 + `parseVoiceWhen`(tz-naive 파서).
  시트가 아니라 유틸에 둬야 착지 페이지 3곳이 녹음 UI 모듈을 안 끌어온다
- `utils/plainToHtml.ts` (신규) — 이스케이프 + 문단 래핑
- `VoiceCaptureSheet.tsx` — URL → **navigate state** 전달. 미리보기에 **확정된 담당자**(말한 이름 아님,
  확정 실패 시 "지정 안 됨")와 **계산된 날짜** 노출 — 확인 전에 오배정을 잡을 유일한 지점
- `QTaskPage` / `QCalendarPage`+`NewEventModal`(optional prop 3) / `MailPage`
- 메일 초안 충돌: 초안 fetch 후 적용 · 기존 초안이 있으면 **본문 맨 위 추가**(제목은 비어 있을 때만,
  받는 사람 무접촉) · **사용자 첫 편집 전까지 자동저장 억제**(안 막으면 안 건드리고 닫아도 단일 초안 row 가
  음성 내용으로 영구 재작성된다)
- i18n `common.voice.assigneeUnresolved` ko/en 1키 추가

### Fable 구현 게이트 — 1차 FAIL(MAJOR 2) → 수정 → **2차 PASS (남은 결함 없음)**

- **D1** 재적용 방지용 `voiceAppliedRef` 가 영구 잠금 → **같은 페이지에서 두 번째로 말하면 내용 통째로 소실**.
  ref 자체가 불필요했다 — `create=1` 과 state 가 같이 사라져 재실행은 이미 early-return 된다
- **D2** 캘린더 `voiceSeed` 를 `onClose` 에서만 정리 → **저장으로 닫은 뒤 다음 '+일정' 에 이전 음성 제목 잔재**.
  닫힘이 아니라 **여는 경로**(`handleCreateAt`/`handleOpenNew`)에서 초기화 (닫힘 경로가 늘어도 재발 안 함)
- 부수 3건도 반영 — `voice.js` 주석 사실오류 · 메일 첨부/계정/별칭 `markComposeTouched` 누락 · 업무 `detail`/`when_start` 빈 값 명시 초기화

### 검증 (수정 후 재실행)
| 스위트 | 결과 |
|---|---|
| 백엔드 실LLM·실DB·실HTTP (`test-voice.js`) | **33/33** |
| D1·D2 회귀 (`canary-voice-repeat.js`, 3회차·여는 경로 전수) | **16/16** |
| 실브라우저 착지 필드 전수 (`canary-voice-landing.js`) | **18/18** |
| 메일 초안 비파괴 DB 전후 대조 (`canary-mail-draft.js`) | **11/11** |
| `guard-invariants.js` | 23/23 |
| `health-check.js` | 34/34 |
| `npm run build` (heap 4096) | EXIT 0, 청크 갱신 확인 |

- **옛 결함 재현 성공** — `?compose=1&voice=` 로 열면 지금도 폼이 비어 있다(아무도 안 읽음) = 고친 대상 실증
- **오배정 반증** — 기존 2단계는 "지원"→김지원(11) 배정, `exactOnly` 는 null
- **격리 양방향** — 비멤버 워크스페이스 403 / 정상 멤버 200(400 아님 = multer 순서 정합).
  첫 실행에서 403 이 안 나 FAIL → **PM2 미재시작**이 원인이었고 재시작 후 PASS (가드가 실제로 문다는 증거)
- **거짓 FAIL 2건 판별** — 날짜 미착지로 보였으나 UI 가 `08/12`·`8월 14일 (금)` 로 렌더한 것.
  실제로는 정상 착지 (검사기를 의심해 확인)

### 정직한 축소 (설계문서와 다른 점)
설계문서 §B-3 은 mail 을 "Q Mail **답장** 컴포저"라 적었으나, 음성 시트는 어떤 스레드인지 모른다
(화면 컨텍스트 전달 미구현). 컨텍스트 없이 답장 대상을 고를 수 없어 **새 메일 컴포저 유지**. 백로그로 남김.

### 발견했으나 손대지 않은 것 (범위 밖)
- `QTaskPage` 의 기존 `prefill=`(PWA Share Target) 경로도 평문을 RichEditor 에 그대로 넣어 **개행이 사라진다**.
  같은 계열 결함이지만 이번 설계 범위가 아니라 `plainToHtml` 만 만들어두고 적용은 안 했다

---

## ✅ 이전 섹션 완료 — 전부 Fable 게이트 통과 (미배포)

| # | 내용 | 게이트 |
|---|---|---|
| ① | **#252 문서 자동저장** 잔여 BLOCKER 3건 + MAJOR + MINOR + DATETIME(3) 낙관적 잠금 | 구현 PASS |
| ② | **#250 우선순위 재인덱스 백엔드 단일화** | 구현 PASS |
| ③ | **#250 업무 태그** 신설 | FAIL→재검 PASS |
| ④⑤ | **Document 트랙 정리** 청크1(쓰기측)+청크2(수집측) | 구현 PASS |
| 부수 | i18n 가드 여러 줄 주석 오탐 수정 | PASS |

상세는 `DEVELOPMENT_PLAN.md` 최상단 섹션 참조.

---

## 🚀 미배포 — 배포 시 순서 (Irene 의 `/배포` 명령 대기)
```
1) node dev-backend/scripts/migrate-posts-datetime-ms.js   (운영 DB — DATETIME(3))
2) node dev-backend/scripts/migrate-task-tags.js           (운영 DB — 태그 2 테이블)
3) 백엔드 → 4) 프론트
```
둘 다 멱등(재실행 변경 0 실측). 롤백: posts 는 `MODIFY … DATETIME`, 태그는 `DROP TABLE task_tag_links; DROP TABLE task_tags;`(링크 먼저).
**음성 3경로는 DB 변경이 없어 추가 마이그레이션 불필요** — 백엔드+프론트만.

---

## 다음 우선순위

| 순위 | 내용 |
|---|---|
| **1** | #217(QBillPage socket 미청취) · #221 · #241 · iOS 트랙 |
| **2** | `prefill=`(PWA Share) 개행 소실 — `plainToHtml` 적용 (이번에 발견, 범위 밖으로 남김) |
| **3** | 음성 화면 컨텍스트 전달 → mail 을 진짜 "답장" 으로 (설계문서 §B-3 원안) |
| **4** | i18n 래칫 부채 감소분 조이기 — `--update-baseline` **전체 실행**으로만 |
| **5** | ②후속: 완료 경로별 우선순위 해제 비대칭 / ③후속: `tasks.category` 승격·폐기, 태그 타 표면 확산 |

## Irene 확인 대기
1. 방침 변경 공지 — `announcement_text` 1건 권고(Fable)
2. Google Cloud Console 재제출 — 캘린더·Gmail 기재 불일치 해소됨. 반려 메일 원문 주시면 대조
3. Mac Chrome 쿠키 삭제 설정(#244) · #245 뒤로가기 화살표 · 수동 청구서 `taxOn` 기본값
4. **운영 `/api/internal/*` 가 인터넷에서 도달** — `INTERNAL_API_KEY` 단일 방어층.
   `scripts/nginx-planq.kr.conf:52` deny 반영 (**root 필요 → Irene**)

---

## 이번 세션에서 배운 것 (재발 방지)

1. **★ 라우터의 파라미터 정리가 state 까지 지운다.** `setSearchParams(replace)` 는 state 를 안 넘긴다 —
   "읽고 나서 정리하자" 는 순서가 성립하지 않고, **읽기는 정리와 같은 effect 안**이어야 한다.
   정리를 한 번 더 하려던 코드는 방금 지운 파라미터를 되살렸을 것이다.
2. **★ 편의를 위한 부분 일치는 입력 경로에 따라 흉기가 된다.** 같은 `matchMemberByName` 이 타이핑
   경로에선 친절(조사 흡수)이고 음성 경로에선 오배정+알림 발송이다. 함수가 아니라 **호출 맥락**이 정책을 정한다.
3. **★ 미들웨어 순서는 body 파서가 정한다.** multipart 라우트에서 `req.body` 를 읽는 게이트를
   multer 앞에 두면 전 호출 400. 격리 검증을 **비멤버 403 한 방향만** 돌리면 그 사고를 통과시킨다 — 양방향 필수.
4. **★ 가드가 안 물면 코드가 아니라 프로세스를 의심하라.** 403 이 안 난 첫 실행의 원인은 PM2 미재시작이었다.
   재시작 후 물었다 = 반증이 성립한 것.
5. **★ 검사기가 UI 표기를 모르면 거짓 FAIL 이 난다.** 날짜를 ISO 로 찾았는데 화면은 `08/12`·`8월 14일 (금)`.
   FAIL 을 보고 코드를 고치러 가기 전에 **실제 렌더 결과를 덤프**할 것.
6. **★ 자동저장은 "누가 채웠는가" 를 구분해야 한다.** 시스템이 채운 값을 사용자 입력과 똑같이 취급하면,
   사용자가 아무것도 안 하고 닫아도 서버의 단일 초안 row 가 덮어써진다.
7. **★ 서버가 한 번에 해석하면 프론트가 다시 파싱하지 않는다.** 한국어 상대날짜·담당자 매칭을 프론트로
   내리면 취약한 중복이 생긴다. LLM 호출 수를 늘리지 않고 **같은 호출의 출력 스키마만** 넓히는 게 정석.
8. **★ 사용자가 확인 버튼을 누를 때 보는 것이 곧 방어선이다.** 미리보기가 *말한 이름* 만 보여주면
   해석 오류는 끝까지 안 보인다 — **확정된 결과**를 보여야 한다.
9. **★ "한 번만 적용" 가드가 "영영 한 번만" 이 된다 (D1).** 재적용을 막으려 둔 `useRef` 는 리셋 지점이
   없으면 2회차를 통째로 죽인다. **이미 다른 메커니즘이 재실행을 막고 있는지 먼저 확인**하고, 가드를
   넣었으면 반드시 **2회차·3회차를 테스트**할 것. 1회차만 통과시키는 검증은 이 계열을 영원히 못 잡는다.
10. **★ 잔재 정리는 닫는 쪽이 아니라 여는 쪽에서 (D2).** 닫힘 경로는 하나가 아니다(취소·Esc·**저장**).
   `onClose` 에만 정리를 두면 저장으로 닫힌 경로가 새고, 나중에 닫힘 경로가 늘 때마다 같은 결함이 재발한다.
   **여는 경로에서 초기화**하면 닫힘이 몇 개든 안전하다.

## Git 상태
- 미배포: 이전 4덩이 + 음성 3경로 (Fable 게이트 후 확정)
- Fable 게이트 마커: `.claude/.fable-gate.json`
- 검증 스크립트는 전부 `/tmp/.../scratchpad/` — 프로젝트 트리에 없음 (idle autosave 커밋 방지)

## 복구 가이드
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
