# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-07 13:20 UTC (Opus 5, 1M)
**작업 상태:** **완료** (`/개발완료`). **운영 2배포 완료** — `0281936`(210s) · `8754881`(212s). Irene 긴급 신고(공유 문서 PDF 내용 파손) 해소 확인.

**완료 처리 시 가드**: health 34/34 · invariants 22/22 · e2e tenant 0 · 위키 커버리지 ⛔0 · Fable 게이트 2라운드 PASS(소스 미커밋 변경 0).

---

## 이번 세션 완료

### ✅ ★ 공유 문서 PDF 가 본문 대신 TipTap JSON 원문을 찍고 있었다 (Irene 긴급 신고)

**Irene 원문:** "미리보기에 있는 pdf 다운로드 기능을 누르면 이제 되는데 **내용이 엉망으로 나와. 웹이랑 같은 방식으로 안나오고.** 이거 당장 수정해서 배포해야 해"
대상: `https://planq.kr/public/posts/eecb8a77…` (김미정 | 노틸러스인베스트먼트 지원서)

**근본 원인 — 컬럼 타입 하나가 렌더 경로를 갈랐다.**
- `models/Post.js:14` `content_json` = **`DataTypes.TEXT('long')`** → DB에서 **문자열**로 온다
- `models/Document.js:26` `body_json` = **`DataTypes.JSON`** → **객체**로 온다
- `services/pdfTemplates.js:postPdfHtml` 이 `typeof === 'string'` 을 **"HTML 본문"으로 단정** → JSON 원문을 그대로 HTML 에 흘림
- **즉 포스트 PDF 는 처음부터 전건 파손.** 문서 PDF 만 멀쩡했던 것이 진단의 열쇠였다

**수정 (`services/pdfTemplates.js` 단일 파일)**
1. `parseRichContent()` — 문자열이면 **JSON 파싱 우선**(`{`/`[` 로 시작할 때만)
2. `richBodyToHtml()` — TipTap JSON > HTML 문자열 > `content_text` 평문 폴백. **JSON 원문이 새는 경로 제거**
3. `nodeToHtml` 보강 — 웹(`generateHTML` StarterKit+Link+Image+Table)과 정합: taskList/taskItem · 셀 colspan/rowspan · ol start · image width/alt
4. `absolutizeSrc()` — 이미지 상대경로(`/api/posts/editor-image/…`)를 `http://127.0.0.1:${PORT}` 로. **puppeteer `setContent` 는 base URL 이 없다**
5. BASE_CSS `.body-content` 제목/인용/코드/이미지/표/체크리스트 보강
6. `documentPdfHtml` 도 같은 공용 헬퍼 사용

### ✅ 같은 PDF 의 날짜 결함 2건 (실측 중 발견 → 2차 배포)
- `fmtDate` 가 `String(s).slice(0,10)` 이라 Sequelize **Date 객체**를 `Wed Aug 05` 로 잘랐다 → Date 분기 `toISOString().slice(0,10)`
- Post 모델이 `underscored` 라 **인스턴스 속성은 `createdAt`**, `post.created_at` 은 undefined. `buildPostPdf` 가 `toJSON()` 없이 인스턴스를 넘겨 **공유 안 된 포스트는 날짜가 `—`** → `createdAt`/`updatedAt` 폴백
- 청구서 PDF 의 DATEONLY(`due_date`)는 정규식 분기로 Date 변환 자체를 안 타게 해 **하루 밀림 0** 실측

### ✅ ③ 정기청구 메일 PDF 첨부 복구 (전일 설계분 착지 — commit `6196420`)
- `recurring_invoice.js:195` · `clientSubscriptionBilling.js:257` 이 **git 이력에 존재한 적 없는** `./pdfBuilder` 를 require 하고 **빈 `catch` 가 삼켜** 자동청구 메일에 PDF 가 **한 번도** 붙은 적 없었다(무증상)
- 진짜 구현을 `services/invoicePdf.js` 로 **순수 추출** → 라우트 + 정기청구 2엔진 공유
- 실패 시 `console.warn` + `notifyPlatformAdmins` + **첨부 유무로 메일 문구 분기**(첨부 없는데 "첨부된 청구서 참고" 는 고객에게 거짓)

### ✅ ④ PDF 실측 가드 — #253 재발 자동 검출
- `GET /api/internal/health/pdf` 신설 (internal key 자동 적용 + 분당 5회 캡). **백엔드 프로세스 자신이 렌더**해야 `LD_LIBRARY_PATH` 상속 상태를 정확히 잰다 — 별도 `node -e` 는 환경이 달라 거짓 판정
- `scripts/health-check.js` 항목 추가 — 키 못 읽으면 **skip 이 아니라 FAIL**(fail-closed)
- `scripts/deploy-planq.sh` 가 배포 직후 **운영 호스트 내부에서** 실호출 → 실패 시 배너 + Summary 잔존 + 조치 힌트
- **이번 2배포 모두 실제 발화**: `운영 PDF 렌더 OK (11821 bytes, %PDF-)`

### ✅ Fable 게이트 2라운드 — 둘 다 PASS
**1라운드 (JSON 파싱분)**
- **운영 라이브 before/after 대조**: 운영 PDF `pdftotext` → **`{"type"` 191건** (신고 재현) / 수정본 **0건**, 한글 본문 7페이지
- **반증**: 파싱 분기를 옛 동작으로 되돌리니 **191건 재출현**, `330,808B ≈ 운영 before 330,840B`. `cp` 백업 md5 복원, **`git checkout --` 미사용**
- 회귀 무: Q info 공유 PDF(HTML 본문 경로) · 문서 PDF(body_html/body_json) · 청구서 PDF · 비멤버 403 · 옛 포스트 샘플(61·185)

**2라운드 (날짜분)**
- `2026-05-03` 정상, 요일·영문월 토큰 0건. **반증**: 옛 `fmtDate` 복원 시 `Sun May 03` 재현 → md5 복원
- 청구서 PDF 발행일/기한/회차표 DB 값 전건 일치, **DATEONLY 하루 밀림 0**. 서버·MySQL 모두 UTC 실측

### ✅ 운영 2배포 3점 실측
| 항목 | 결과 |
|---|---|
| health | `https://planq.kr/api/health` **200** |
| PM2 | prod-backend/qnote/mcp uptime **70s** (리셋 확인) |
| 신고 문서 라이브 PDF | **477,787B · `%PDF-` · JSON 0건 · 헤더 `2026-08-05`** |

백업: `/opt/planq/backups/20260807_125052` · `/opt/planq/backups/20260807_131120`

---

## 다음 우선순위

| 순위 | 내용 |
|---|---|
| **1** | **Meet 을 개인 연동 우선으로** (Fable 설계 게이트 → 구현). `routes/calendar.js:929`·`event_actions.js:122` 가 `getTokenForBusiness` 만 봐서, 직원(lua)이 8-04 에 자기 계정을 연결했는데도 Meet 이 안 된다. **코드만 바뀌면 재연결 없이 즉시 동작.** 정할 것 — 팀 캘린더 동기화는 워크스페이스 유지할지 / 개인 연동 없는 사람 처리 / 배너가 어느 연동을 가리킬지 |
| **2** | `locales/{ko,en}/legal.json` 캘린더 "**읽기 전용**" 문구 정정 (실제는 읽기·쓰기 `calendar.events` — 구글 검증 반려 트리거) |
| **3** | gcal 콜백 조기 return 3경로 로그 + 배너에 워크스페이스/개인 구분 명시 |
| **4** | 직원 신고 잔여 — #246(공유 후 채팅방 안 열림) · #247/248(보류 버튼 위치, Fable 상의) · #249(업무명 잘림) · #250(업무 태그 미개발) · #251(메일 버튼 전 탭 노출) · #252(문서 임시저장) |
| **5** | #217(QBillPage socket 미청취) · #221 · #241 · iOS 트랙 |
| **P2+** | 캘린더 에코백 동기화(구글→PlanQ, 대규모) |

---

## Irene 확인 대기
1. Mac Chrome "모든 창을 닫을 때 쿠키 및 사이트 데이터 삭제" 설정/확장 (#244 삭제 주체)
2. #245 흔들릴 때 화면 가장자리 뒤로가기 화살표(←) 유무
3. 수동 청구서 모달 `taxOn` 기본 ON 여부
4. Google Cloud Console — Data Access 요청 스코프 정리 / 심사팀 반려 메일 원문
5. **운영 `/api/internal/*` 가 인터넷에서 백엔드까지 도달**한다(dev 는 nginx 가 차단). 방어는 `INTERNAL_API_KEY` 단일층뿐 — repo `scripts/nginx-planq.kr.conf:52` 의 deny 를 운영 라이브 파일에 반영 필요 (**root 필요 → Irene 조치**)

---

## 이번 세션에서 배운 것 (재발 방지)

1. **★ 같은 공용 헬퍼가 한 엔티티에서만 깨졌으면 ORM 표면부터 대조하라.** 컬럼 타입 TEXT(문자열) vs JSON(객체) 하나가 렌더 경로를 갈랐다. 로직은 멀쩡해 보이고 tsc·가드도 못 잡는다. memory `feedback_orm_surface_differs_by_entity` 박제.
2. **★ `underscored: true` 인스턴스에 `created_at` 은 없다.** timestamps 인스턴스 속성은 `createdAt`. `toJSON()` 을 거치는 경로만 snake_case 가 된다 — 같은 헬퍼를 두 경로가 공유하면 양쪽 키 폴백 필수.
3. **★ `String(Date).slice(0,10)` 은 `"Wed Aug 05"` 를 만든다.** Date 는 `toISOString()`, `YYYY-MM-DD` 문자열은 그대로 slice(DATEONLY 를 `new Date()` 태우면 타임존으로 하루 밀림).
4. **★ 배포 직후 운영 실측 항목은 첫 배포부터 값을 한다.** 이번 2배포 모두 `운영 PDF 렌더 OK` 를 찍었다 — #253 처럼 "운영에만 없는 시스템 의존성" 은 이 항목 없이는 몇 달 무증상.
5. **idle autosave 가 Fable 의 반증 편집을 또 커밋했다**(`c286394` → 원복 `0281936`). 누적 3회. Fable 프롬프트에 "작업 파일은 `/tmp`" 를 매번 명시했는데도 **대상 파일 자체를 편집하는 반증**은 훅에 걸린다 — 반증 후 즉시 복원했는지 커밋 로그로 확인할 것.
6. **운영 라이브를 before 증거로 쓰면 판정이 흔들리지 않는다.** "191건 → 0건" 처럼 세어지는 숫자로 대조하면 "고친 것 같다" 가 아니라 고쳤음을 증명한다.

---

## Git 상태
- HEAD: **`8754881`** fix(pdf): 문서 PDF 날짜 표기 — "Wed Aug 05"·"—" 회귀 수정
- 직전: `0281936`(반증 원복) · `c286394`(autosave 오염) · `dae8f18`·`6196420`(autosave — ③④ 및 JSON 파싱 구현)
- 작업 트리: 클린
- **운영 배포 커밋: `8754881`** — 이번 세션 변경 전부 배포 완료
- Fable 게이트 마커: `.claude/.fable-gate.json` — PASS 기록됨

## 운영서버 변경 (코드 외)
- `/opt/planq/backend/.env` 의 `LD_LIBRARY_PATH` (2026-08-06 추가, 배포 rsync 제외 대상이라 유지)
- `~/chrome-deps/` — deb 50개 + 추출 라이브러리 73개. 배포 무접촉
- **puppeteer 가 Chrome 버전을 올리면 라이브러리 재확인 필요** — 이제 배포 스크립트의 PDF 실측이 자동 검출한다

## 복구 가이드
새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
