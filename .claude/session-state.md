# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-02 18:12 UTC (Opus 5, 1M)
**작업 상태:** 완료 — **#215 운영 배포 + 백필 완주** (`37fb2f0`, 210s). 미배포 0.

### 진행 중인 작업
- 없음. **#217 은 Irene 답변 대기** (아래 "다음 할 일" 참조)

---

## 🚀 2026-08-02 배포 1회 — `37fb2f0` (210s)

### #215 Q Mail 첨부파일 (A~I) — 첨부 66% 소실 복구

**근본원인:** `emailImapCron.js:389` 이 `is_inline: !!(att.cid || att.contentId)` —
Content-ID 존재만으로 "본문 삽입"으로 단정. Apple Mail·국세청 등이 **일반 첨부에도
Content-ID 를 붙인다**. dev 3,221건 중 2,114건(66%)이 화면에서 소실됐고 그 안에
부가가치세 납부서·매입매출장·영수증 PDF 가 있었다. 본문이 실제 cid 를 참조한 건 6건뿐.
★ 다운로드 경로 자체는 멀쩡했다 — "다운로드가 안 된다"의 정체는 **누를 대상이 없던 것**.

| 항목 | 내용 |
|---|---|
| A 표시 술어 | 권위를 컬럼 → **본문 cid 참조**로 이전. `services/emailAttachments.js` 단일 원천을 읽기·쓰기·백필 3곳 공용. fail-open(의심되면 보여준다) |
| B 쓰기측 | `isEmbedded(cid, parsed.html)`. Fable 이 Opus 초안의 `att.related` 를 각하 — **백필이 재계산할 수 없어** 술어가 갈라진다 |
| C 백필 | is_inline 재계산. dev 2,108 / **운영 454** |
| D 미리보기 | 이미지=ImageLightbox 갤러리 / PDF=새 탭. **인증 blob→objectURL** (무인증 capability URL 각하 — 대상이 세금계산서) |
| E | 다운로드 실패 `catch {}` 침묵 제거 → 인라인 에러 |
| F 개인메일 | 개인 계정 첨부가 vlevel=L3 라 **전 멤버 노출**. L1 + uploader 교정. dev 370 / **운영 207** |
| G | 반송헤더 등 기계 파트 974건 칩 숨김 + 신규 File 생성 skip |
| H | 본문 cid 이미지 data: URI 치환. `sanitizeHtml.ts` 무접촉(#226 재발 차단) |
| I | 리스트 첨부 클립. B+C 로 `is_inline` 이 술어의 **물질화 캐시**가 되어 목록↔상세 정의상 일치 |

**Q위키 갱신(3-1-W 게이트):** `qmail-inbox` 아티클에 리스트 클립·미리보기·내려받기 아이콘 ·
개인/회사 계정 첨부 가시성 안내 4줄 추가(ko/en). dev + **운영 둘 다 seed 반영**. 커버리지 ✅ 통과.

**신규 파일:** `services/emailAttachments.js` · `scripts/backfill-215-email-attachments.js` ·
`pages/QMail/MessageAttachments.tsx` · `pages/QMail/useInlineCidImages.ts` ·
`docs/QMAIL_ATTACHMENT_DESIGN_215.md`(Fable 설계서, §9 = I 항목)

**운영 백필 완주:** dry-run → apply(454 + 207) → **재실행 변경 0**(멱등) → 실측
`is_inline` 1=2/0=569 · 개인 207건 L1 · 회사 352+12건 L3 불변.
롤백: `/opt/planq/backups/215-20260802-181024/215-affected.json`

**3점 실측:** PM2 uptime 19s 리셋 · 청크 `index-BUQjoQz8.js` dev=운영 일치 · Complete 210s
(★ `DEPLOY_EXIT=1` 은 이 스크립트의 알려진 부수 신호 — memory `feedback_deploy_exit1_spurious`)

---

## 완료된 작업 (이번 세션)

### 운영 피드백 장부 정리 — 32 → 25건
7-31 일괄 정리가 **15:29** 에 돌았는데 그날 배포는 17시·18시에도 있었다. 그 이후 배포분
**7건(#218·#219·#223·#224·#226·#234·#243)** 이 `pending` 인 채였다. 운영서버 실물 대조
(`980af56` + `content_json`·`BroadcastChannel`·`overflowWrap`·기준선 차감) 후 `done` 처리.
(#215 배포 후 `done` 처리는 아직 안 함 — 다음 세션 첫 할 일)

### #217 조사 완료 (구현 착수 전, Irene 답변 대기)
- **① 탭 숫자 미갱신 = 실제 버그, 원인 확정.** 백엔드는 발행 즉시 소켓 `inbox:refresh`
  를 쏜다(`routes/invoices.js`). 그런데 `QBillPage.tsx:54` 는 **window 이벤트만** 듣는다.
  **같은 이름의 서로 다른 두 채널**이 어긋나 신호가 안 닿는다. 옆의 `TaxInvoicesTab` 은
  소켓을 들어서 목록만 갱신 → "목록은 바뀌는데 숫자만 안 바뀌는" 증상.
- **② 고객 이메일 = "없음"이 아니라 "게이트가 없음".** `notifyCustomerReceiptIssued` 가
  **묻지 않고 무조건 발송** 중. 모달에 체크박스도 받는사람 표시도 없어 **발행자는 자기가
  메일을 보냈다는 사실 자체를 모른다**.
- **③ 알림메일 이미 연결됨.** 실제 문안을 렌더링해 확인 아티팩트로 제출:
  https://claude.ai/code/artifact/56efaa73-7ed5-484a-bb3d-33d864da5a1b

---

## 다음 할 일

### Irene 답변 대기 (#217 — 답 오면 바로 착수)
1. **문안** 그대로 갈지 / 고칠 곳(문장 단위)
2. **체크박스 기본값** — 켜짐(현 동작 유지) vs 꺼짐(명시적으로 켜야 발송)
3. **받는 주소 없을 때** — 지금은 조용히 넘어감. 모달에 "받는 주소 없음" 미리 표시할지

### 개발 (잔여 피드백 25건 — 운영 DB 원문 기준)
- **코드로 바로**: #213 메일 필터 접기 · #214 알림 발송처 전수정리 · #217 · #220 팀메일 발신자 표시 ·
  #222 새 메일 폼 자동저장·이탈 · #225 문서 워드/PDF/엑셀 · #231 프로젝트 개요 자료·핀 ·
  #232 드래그드롭 통일 · #241 음성노트 번역 기본 끄기 · #195 랜딩 도움말 카테고리
- **Fable 설계 선행**: #208 출퇴근·휴가 · #211 B2B 타깃 검토 · #221 메일 분류 재정비 ·
  #227 Cue 우측패널 · #228 파일 드래그 반출 · #229 프로젝트 히스토리 · #230 Today's 브리핑 ·
  #233 통합검색 AI · #235 업무추출 자동화 · #236 업무 태그 · #237 오늘 나의 업무 ·
  #238 Cue 완료 등록 · #239 문서 컨펌 · #240 프로젝트 완료 알림

### Irene 조치 (코드로 불가)
- 워프로랩 Google Calendar 재연동 — 운영 토큰 스코프가 `userinfo.email openid` 뿐이라
  재연동 전에는 #242 Meet 코드가 배포돼 있어도 동작 안 함

### 후속 정리 (Fable 비블로킹 관찰)
- forward 서버 경로(`email_threads.js:958`)가 원본 첨부 **전건** 재첨부 — 화면에서 숨긴
  로고·반송헤더까지 포함. 기존 동작이라 회귀는 아니나 A 채택으로 간극이 넓어짐
- 목록 SQL 의 mime denylist 가 `; charset=` 파라미터 미제거 (상세 술어는 제거). 현 DB 0건
- `useInlineCidImages` 가 상세 재로드마다 재다운로드 (dev 6건 규모라 무시 가능)
- DSN 장식 이미지가 첨부로 계수됨 — 노이즈 정제 후보

---

## 이번 세션에서 배운 것 (재발 방지)

1. **★ 운영 피드백은 원문을 읽어라.** 세션 요약본으로 설계했다가 #215 의 "첨부파일 있고
   없고도 알기 편하게"(=리스트 표시)를 통째로 빠뜨려 한 라운드를 더 돌았다. #195 도 내가
   알던 내용과 실제 요청이 달랐다. 착수 전 `planq_prod_db.feedback_items` 원문 조회 필수.
2. **`window.open(url,'_blank','noopener')` 은 성공해도 null 을 반환한다**(스펙). 반환값을
   팝업차단 신호로 쓰면 열릴 때마다 폴백이 같이 발화한다. 핸들에서 `w.opener=null` 로 끊을 것.
3. **빌드 알림의 exit 0 을 믿지 말 것.** tsc 가 실패했는데 exit 0 으로 통보된 건이 있었고,
   cwd 를 틀려 `Missing script: "build"` 로 실패한 건도 있었다. 판정은 **REAL_EXIT +
   `error TS` 수 + 산출물 mtime 3점**으로.
4. **i18n 패리티 가드는 i18next 복수 접미사를 모른다.** ko/en 양쪽에 `_one`/`_other` 를
   모두 둘 것(ko 는 두 값 동일). 기존 `thread.awaitingReply_*` 가 같은 관례.
5. **미커밋 상태에서 `git checkout --` 금지.** Fable 이 반증 원복에 쓰다가 구현을 통째로
   날렸다(캡처해 둔 diff 로 blob 해시 일치까지 복원). 반증은 `cp` 백업으로.

---

## Git 상태
- 최근 커밋: `37fb2f0` fix(qmail): #215 첨부파일 — 66% 소실 복구 · 미리보기 · 개인메일 격리
- 작업 트리: 클린 (미커밋 0)
- 운영 배포 커밋: `37fb2f0` (= dev HEAD)
- Fable 게이트: PASS 기록됨 (`.claude/.fable-gate.json`)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
