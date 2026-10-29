# 메일 사칭(유사 도메인·숨김 문자) 검사 — 설계 판정 (Fable, 2026-10-15)

> Irene 2026-10-15: *"메일 스팸관련해서 이런 거 참고 가능해? 그리고 우리가 스팸에 어떻게 거르는지도 잘 어딘가에 안내되어 있어? 기준이나 스팸관리 기능도 필요한 것 같아."*
> 판정 종류: **design**(분류 기준 변경 — CLAUDE.md «판정 조건·분류 기준·계약 변경»). 권고가 곧 결정. 구현은 Opus, 검증은 §8 로.
> 선행 설계: `MAIL_CRITERIA_DESIGN.md`(기준 카탈로그) · `MAIL_SENT_SPAM_SYNC_DESIGN.md`(업체 스팸함 읽기 전용 미러).

## 0. 한 줄 결론
**브랜드 목록·키워드 없이, «구조(문자)» 와 «관계(아는 도메인)» 두 축으로만 가른다.** 강한 근거 1개면 기존 스팸 폴더로 격리(`spam_origin='impersonation'`), 약한 근거는 경고 배지만. 판정 함수는 하나(`services/mailImpersonation.assess`) — 인입·재판정·브리프·화면이 같이 읽는다. 업체 메일함에는 계속 아무것도 쓰지 않는다.

dev 실측이 결정을 받친다: 진짜 피싱 4통은 **전부 SPF/DKIM pass** 이고 **전부 단어 안에 숨김·방향 제어 문자**가 박혀 있었다. 유사 도메인·IDN 은 8,510통 중 0. 즉 지금 당장 잡아야 할 것은 «문자 구조» 이고, 유사 도메인은 «아는 도메인» 과만 비교하면 조용하다(브랜드 목록은 키워드 목록과 같은 운명 — 두 번 샜던 길).

## 1. 신호와 등급

| id | 무엇을 보나 | 등급 | 정상 사례를 지키는 규칙 |
|---|---|---|---|
| `bidi_override` | 표시이름·제목·첨부 파일명에 양방향 제어 문자(U+202A–202E, U+2066–2069) 하나라도 | **강** | 예외 없음. 업무 메일에 RLO 가 올 이유가 없다(실측 2/4 피싱). |
| `hidden_chars` | 표시이름·제목·첨부 파일명의 **단어 안** 형식 문자(ZWSP U+200B · ZWNJ U+200C · ZWJ U+200D · WJ U+2060 · BOM U+FEFF · U+2061–2064 · U+00AD 소프트하이픈) | 단어 안 **2개 이상 → 강** / 1개 → 약 | ① 이모지 ZWJ 시퀀스(ZWJ 양옆이 `\p{Extended_Pictographic}` 또는 변형 선택자)는 세지 않는다(🐈‍⬛) ② 문자열 처음·끝 또는 공백 옆의 1개는 «붙어 온 찌꺼기» — 세지 않는다(«NOL_CS ‍») ③ 콜드메일 제목 ZWSP 1개 → 약(경고만). |
| `mixed_script_label` | From·Reply-To·Return-Path 도메인, 본문 링크 호스트의 **레이블 하나** 안에 라틴 + 키릴/그리스/아르메니아 등 혼합 | **강** | UTS #39 *Highly Restrictive* 허용 조합은 혼합이 아니다 — 라틴+{한자,히라가나,가타카나} · 라틴+{한자,한글} · 라틴+{한자,주음}. **한글만·한자만·일본어만인 레이블은 단일 스크립트 = 신호 0.** punycode(`xn--`) 자체는 신호가 아니다 — `url.domainToUnicode` 로 풀어 스크립트를 본다. |
| `ascii_masked_label` | 레이블이 **전부 비라틴 스크립트**인데 UTS #39 skeleton 이 **전부 ASCII 영문자**로 떨어짐(`аррӏе`→`apple`) | **강** | 진짜 비라틴 단어는 skeleton 에 비라틴이 남는다(«почта» 의 ч, 한글 전부). 브랜드 목록 없이 전체 키릴 위장을 잡는 축. dev 비ASCII 발신 0 이라 음성 비용 0. |
| `lookalike_known_domain` | From·Reply-To·링크 호스트의 등록 도메인(eTLD+1)이 **아는 도메인**과 ① skeleton 동일(실제 문자열은 다름) 또는 ② Damerau 편집거리 1(아는 도메인 길이 ≥ 6, 무료메일·우리 자신 제외) | **강** | 비교 대상 = «아는 도메인» 집합 **하나**: 우리 발신 주소·별칭 도메인 + 고객(clients.email·contact) + 우리가 답한 주소 + 멤버 (= `spam_rescue` 의 known 집합을 도메인으로 접은 것, `emailImapCron.isKnownContact` 와 같은 원천). 무료메일 도메인은 집합에서 뺀다(gmail.com 과 거리 1 인 도메인은 널렸다). **정확히 같은 도메인은 신호 아님**(그건 아는 상대). |
| `display_name_domain` | 표시이름 안에 도메인 모양 토큰(`x.y` + 알려진 TLD) 또는 **아는 도메인의 브랜드 레이블**이 있는데 실제 발신 등록 도메인이 그것이 아님 | 약 | dev 고유 5건 중 4건 정상(Investing.com·«irenewp.com Team»·docomo by DMARC/25). 단독으론 경고만. 우리 워크스페이스 이름 사칭(`display_name_mismatch`)은 브리프에 이미 있다 — 같은 함수로 옮기고 등급은 **약** 그대로. |
| `reply_to_divergent` | Reply-To 등록 도메인 ≠ From 등록 도메인이고 Reply-To 가 무료메일 | 약 | 뉴스레터·티켓 시스템은 Reply-To 가 다르지만 무료메일이 아니다. |

- **격리(quarantine) = 강 1개 이상. 경고(warn) = 약 1개 이상. 약 여러 개를 더해 강으로 올리지 않는다** — 올릴 근거 데이터가 0건이다. 운영 한 달 측정 뒤 재검토(§5 보고 숫자).
- **아는 상대(정확히 같은 주소·도메인)에게서 온 강 신호는 격리하지 않고 경고까지만**(계정 탈취 가능성은 있으나 사람이 본다 — `spam_rescue` 와 같은 정신). `lookalike_known_domain` 은 정의상 아는 주소가 아니므로 해당 없음.
- 스팸 점수(`emailSpamFilter`)·인증 결과(SPF/DKIM)는 **이 판정에 넣지 않는다** — 피싱 4통이 pass 였다. 인증 실패는 브리프 신호로 남는다.
- 검사 범위는 **머리말과 호스트뿐**: 표시이름·제목·From/Reply-To/Return-Path·첨부 파일명·본문 `<a href>` 호스트(최대 50개). 본문 본문 텍스트의 혼동 문자는 보지 않는다(인용·다국어 본문이 전부 걸린다).

## 2. 격리 동작
- **새 폴더를 만들지 않는다.** 기존 스팸 폴더로: `status='spam'`, `triage='spam'`, `reply_needed=false`, `triage_criterion='impersonation'`, **`spam_origin='impersonation'`**(ENUM 끝 append), `spam_since=now`.
- 업체 스팸함 메일과 **같은 격리 규칙**을 탄다: 항상 **새 스레드**(기존 대화에 끼어드는 것이 사칭의 목적이다) · 고객 연결·상담 승격·알림·확인필요·Cue·검색 추천·자동 추출 **전부 제외** · **30일 뒤 영구 삭제**(purge 술어 `spam_origin IN ('provider','impersonation')` 로 확장 — 스팸 폴더의 수명은 하나). 삭제 전 30일간 스팸 폴더에서 이유와 함께 보인다.
- **`spam_rescue` 보다 먼저, 모든 기준보다 먼저 본다** — 카탈로그 `order: 5`(`thread_reply` 보다 앞. In-Reply-To 위조로 «우리가 답한 스레드» 에 끼는 것을 막는다). 단 §1 «아는 상대 → 경고만» 은 이 함수 안에서 known 을 받아 처리한다(엔진이 `known` 을 이미 계산한다 — 그 값을 넘긴다).
- **복원 = 기존 [스팸 아님] 버튼 하나.** `routes/email_threads.js mark-not-spam` 이 `spam_origin IN ('provider','impersonation')` 이면 `mailSpamRelease.releaseProviderSpam`(이름을 `releaseQuarantined` 로 바꾸고 provider 분기 유지) 를 부른다 — 받은 메일 판정을 다시 돌리고 `spam_origin·spam_since` 를 비운다. 재판정이 다시 격리하지 않도록 `impersonation.released_at` 을 적고, 함수는 그 값이 있으면 **격리하지 않고 경고로 낮춘다**(배지는 남는다 — 사람이 봤다는 사실이 신호를 없애진 않는다).
- **복원은 학습하지 않는다.** 혼동 도메인에 허용 규칙(`mailSenderRules`)을 심는 것이 공격자가 바라는 바다. 격리 자체도 도메인 스팸 규칙을 학습하지 않는다(mark-spam 2회 학습은 사람이 누른 것에만).
- 격리 시 감사 로그 `mail.quarantine_impersonation`(thread id · 신호 코드). 알림 없음.

## 3. 경고 표시와 저장
- **저장: `email_threads.impersonation JSON NULL`** 한 컬럼 — `{ level:'warn'|'quarantine', signals:[{code, detail}], assessed_at, released_at? }`. 메시지가 아니라 스레드인 이유: 폴더·배지·복원이 모두 스레드 단위. 여러 메시지면 최고 등급. `triage_headers` 에 끼우지 않는다(옛 메일엔 없고, 헤더와 판정을 섞으면 재판정 입력이 오염된다). `detail` 에는 원문 문자열을 넣지 않고 **코드·호스트·문자 코드포인트**만(공유 링크·검색 스니펫으로 새지 않게).
- **목록 행**: `impersonation.level` 이 있으면 제목 왼쪽에 작은 경고 아이콘 배지(`aria-label` «사칭 의심»). 스팸 폴더 행에는 «사칭 의심으로 격리» 를 **기존 criterion 표시 자리**에(새 줄 X). 폰에서도 보이는 글자가 아니라 아이콘 + `title` 이 아니라 — ★ 폰은 title 이 안 뜬다 → 아이콘 옆 짧은 글자 «사칭 의심»(≤640 에서도 그린다).
- **상세**: 두 밴드 계약을 깨지 않는다 — 본문 영역 맨 위 안내 줄 하나(기존 공지 줄 컴포넌트 재사용)에 «왜» 를 신호별 한 문장으로(`qmail:impersonation.<code>`). 격리본에는 링크를 **비활성**(href 제거, 텍스트만)으로 그린다 — 경고만 뜬 메일은 링크 그대로.
- **브리프**(`mailBrief.collectTrustSignals`)는 같은 함수 결과를 `impersonation_<code>` 로 옮겨 싣는다(강=danger·약=warn). 브리프의 자체 `display_name_mismatch` 계산은 지우고 이 함수로 대체(같은 값의 공식 두 벌 금지).

## 4. 업체 메일함 쪽 이동
**읽기 전용 미러 유지(권고 = 결정).** 이유: ① Gmail OAuth 는 차단 중, IMAP 으로 Gmail/네이버 스팸함에 옮기는 것은 «사용자 자산 변경» 이고 업체마다 폴더 의미가 다르다 ② 우리가 오격리하면 사용자의 원래 메일함까지 망가진다 ③ 되돌리기가 업체마다 다르다. 다시 열 조건(둘 다): OAuth 복원 + 계정별 명시 옵트인 «업체 메일함에도 스팸 반영», 그리고 **자동이 아니라 사람이 누른 [스팸] 에만**. 이번 범위 밖.

## 5. 옛 메일 소급
- `scripts/retriage-mail.js --impersonation`(기본 dry-run · `--apply` 따로). 대상: inbound 가 있는 모든 스레드. 하는 일 두 가지 — (a) **배지 채우기**: 전 스레드에 `impersonation` JSON(이미 스팸인 것 포함 — provider 스팸 4통이 양성 대조군이 된다) (b) **격리**: `status IN ('open','uncertain')` 중 강 신호.
- **불가침**: `status='archived'`(사람이 확인완료) · outbound 가 한 통이라도 있는 스레드(우리가 답했다) · 감사 로그에 `mail.mark_not_spam` 이 있는 스레드 · 아는 상대(§1) → 배지만, 이동 없음.
- dry-run 보고 숫자: 배지 warn/quarantine 수 · 격리 후보 목록(id·발신 도메인·신호 코드) 전수. **운영 적용 조건: 후보가 ≤ 20 이고 목록을 사람이 읽고 정상 0 임을 보고에 적은 뒤**(dev 예상: 신규 격리 0 — 진짜 4통은 이미 provider 스팸).
- 운영 스키마: `scripts/migrate-mail-impersonation.js`(멱등 — ENUM append 1 + JSON 컬럼 1), **배포 슬롯 등록**, 코드보다 먼저.

## 6. 안내 — 기준 공개와 «스팸관리»
- **카탈로그에 한 줄**: `{ id:'impersonation', folder:'spam', lockable:false, order:5 }`. 끌 수 있다(owner/admin, `mail_criteria.off`) — 끄면 **격리만 꺼지고 경고 배지는 남는다**(사실을 숨기지 않는다). 설정 화면 설명(i18n `qmail:criteria.impersonation.{title,desc}`, ko/en)에 §1 표의 검사 항목을 그대로 적는다 — 「숨김·방향 제어 문자 / 섞인 문자 체계 / 아는 도메인과 한 글자 차이 / 표시이름의 다른 도메인」. `examples` 는 합성 예(실제 피싱 원문 X).
- **위키 글 «스팸·사칭은 이렇게 거릅니다»**(`seed-wiki-content.js`, ko/en, visibility authenticated): ① 업체(Gmail·네이버) 스팸함은 그대로 가져와 보여만 준다(30일) ② 자체 점수(외부 점수 우선, 없으면 규칙) ③ 사칭 검사 4가지 ④ 아는 상대는 스팸이어도 확인 권장으로 ⑤ [스팸 아님] 은 PlanQ 안에서만 — 업체 쪽은 직접 ⑥ 같은 도메인을 2번 스팸 표시하면 도메인 규칙 ⑦ 끄는 곳: 설정 > 메일 분류 기준. 설정 화면 spam_filter·impersonation 설명 끝에 이 글 링크.
- **상세 «왜 격리됐나»** — §3 안내 줄.
- **이번에 넣는 스팸관리 기능(2개)**: ① 스팸 폴더 행·상세에 **이유**(criterion + 사칭 신호 — 지금은 provider 스팸에 이유 표시가 없다) ② 설정 > 메일 분류 기준 아래 **차단 목록**(`mailSenderRules` verdict='spam' 도메인·주소 목록 + 삭제 버튼 — 지금은 학습된 규칙을 볼 곳이 없다. 읽기 `GET /mail-criteria` 응답에 `blocked` 배열로 싣고, 삭제는 기존 규칙 삭제 라우트). 범위 밖: 일괄 [스팸 아님](스레드마다 재판정이 돈다 — 요청이 오면), 허용 목록 UI, 수동 격리 규칙 편집.

## 7. 혼동 문자 데이터
**라틴 부분집합을 생성 스크립트로 vendoring** — `scripts/gen-confusables.js` 가 Unicode `confusables.txt`(버전 고정, 파일 머리 주석에 버전·URL·날짜)에서 **대상이 ASCII 영문자·숫자인 항목만** 뽑아 `services/data/confusables-latin.json`(코드포인트 → ASCII, 약 1~2천 항목)을 만든다. 전체 파일(수천 줄, 비라틴↔비라틴 쌍 대부분)은 우리 비교 대상(아는 도메인 = ASCII)에 쓸모가 없고, npm 패키지는 없고(supply-chain·갱신 미보장), `\p{Script=…}` 스크립트 판정은 Node 정규식이 이미 한다(데이터 불필요). skeleton = NFD → 소문자 → 매핑 적용 → 결합 문자 제거. 유지비: Unicode 판이 바뀔 때 스크립트 한 번.

## 8. 검증 설계 (자체 검증 숫자 → 이 문서 §9 에 결과 기록)
- **양성(격리 ≥ quarantine)**: dev 실 4통(9562·9542·9075·9056 — 재판정 배지 채우기로 `level='quarantine'` 4/4) + 합성: `xn--pple-43d.com`(mixed_script) · 전체 키릴 `аррӏе.com`(ascii_masked) · 아는 도메인에 대한 `gitconsu1ting.com`·`gitconsulting.co`(lookalike, 거리 1 — 테스트 워크스페이스에 해당 도메인을 «우리가 답한 주소» 로 심는다) · 첨부 파일명 `invoice‮fdp.exe`(bidi) · 제목 단어 안 ZWJ 2개. 기준 **8/8**.
- **음성(quarantine 아님)**: NOL_CS(끝 ZWJ 1) · 🐈‍⬛ 제목 · 한글 IDN 발신 `문의@한글도메인.한국` + 본문 링크 `https://한글.한국/`(신호 0) · 일본어 혼합 레이블 `ドコモ.jp`(신호 0) · Investing.com / «irenewp.com Team» / docomo DMARC 표시이름(≤ warn) · mindsupernova 제목 ZWSP 1(= warn, quarantine 아님). 기준 **격리 0/8, 신호 0 인 것은 정확히 4**(한글·일본어·🐈‍⬛·NOL_CS).
- **가드 반증**: 이모지 예외를 끄면 🐈‍⬛ 가 격리로 뒤집히는지(양성 대조군이 아니라 **판정기 자체의 반증**) · `known` 전달을 끊으면 아는 상대 강 신호가 격리로 뒤집히는지.
- **같은 함수 증명**: 인입(`triageInbound`)·재판정(`retriageStored`)·브리프·스크립트가 같은 스레드에 같은 `impersonation` JSON 을 내는지(해시 비교 4경로).
- **운영 읽기 전용 시뮬**: 전 inbound 스레드 dry-run — 격리 후보 중 outbound 있음/아는 상대/archived = **0**(불가침 술어 증명) · 후보 전수 목록을 사람이 읽어 정상 0. 사칭이 아닌 비ASCII 발신·링크(한글 IDN 등)가 운영에 있으면 그 건수와 신호 0 을 적는다.
- e2e: `--suite mailimpersonation`(목록 배지 가시성 3폭 · 스팸 폴더 이유 글자 · 상세 안내 줄 · 격리본 링크 비활성 · [스팸 아님] → open 복귀 + JSON released_at) · `health-check --category=secrets`(impersonation.detail 에 원문 0).

## 9. 범위 밖
LLM 판정 · 브랜드/유명 도메인 목록 · 업체 메일함 쓰기(§4) · URL 평판·Safe Browsing 조회 · 첨부 내용 검사 · DMARC 정책 강제 · 본문 텍스트 혼동 문자 · 허용 목록 UI · 일괄 [스팸 아님] · 약 신호 합산 승격(측정 뒤) · 자체 스팸 점수 규칙 개편(별건).

## 10. 구현 메모 (Opus)
- 새 파일 `services/mailImpersonation.js`(`assess({fromName, fromEmail, replyTo, returnPath, subject, linkHosts, attachmentNames, knownDomains, known, released})` 순수 함수 + `knownDomainsOf(businessId)` 캐시 5분) · `services/data/confusables-latin.json` · `scripts/gen-confusables.js`.
- 엔진: `triageInbound`/`retriageStored` 맨 앞 분기 + `out(...)` 에 `impersonation` 포함 → 저장부가 JSON 컬럼에 쓴다. 가드 `--category=convparticipants` 류처럼 **직접 `status:'spam'` 쓰기 금지** 는 기존 agentsurface/broadcast 범위 밖 — 새 가드는 두지 않는다(엔진 한 곳만 격리한다, 코드리뷰로).
- 새 상태값 `spam_origin='impersonation'` 을 읽는 곳 전수: purge(`emailImapCron:703`) · mark-not-spam(`:740`) · 목록 직렬화(`:574`) · 화면 `spam_origin === 'provider'` 분기(«Gmail·네이버에서도 해제» 안내는 provider 에만) · mailSpamRelease.

## Irene 질문
없음 — 되돌리기 어려운 선택은 없다(격리는 [스팸 아님] 으로 복원, 30일 삭제는 기존 스팸 수명과 같고 적용 전 dry-run 목록을 사람이 읽는다).

## 10. 아는 상대의 관계사 도메인 · «안전한 도메인» (Fable 2026-10-27 · DESIGN: GO-WITH-CHANGES)
> Irene 2026-10-27: *"같은 자회사 도메인인데 이런 내용이 나와. 계속 나오잖아. 어쩔거야? … 아니라고 누르면 이 도메인 안전하게 등록하던지."*
> 화면: «아는 도메인과 한 글자만 다른 도메인» + «아는 상대의 주소라 격리하지 않았어요» — §1 «lookalike 는 정의상 아는 주소가 아니다» 와 모순.

- **원인(버그)**: «아는 도메인» 집합(`contextOf`)이 «아는 상대»(`isKnownContact`)와 원천이 갈라져 있었다 — 보낸 메일은 `to_emails $[0]`(첫 받는 사람)만, 고객 담당자(`client_contacts`)·고객 별칭(`email_aliases`)·④ 회신 헤더 증거는 빠짐.
- **A (고침)**: ① `contextOf` 보낸 메일 받는 사람 **전부**(JSON_TABLE) + 고객 담당자·별칭 주소 ② `assess` 에서 `known` 이면 **From 등록 도메인**을 아는 도메인에 넣는다(무료메일 제외 · Reply-To/Return-Path 는 넓히지 않음 · 링크는 그 도메인과 정확히 같을 때만 빠짐). 구조 신호(bidi·숨김·섞인 문자·ascii 위장)는 그대로.
- **B (안전한 도메인)**: `businesses.permissions.mail_trusted_domains`(스키마 변경 0 · 최대 50) · `services/mailTrustedDomains` 한 곳.
  - 등록: owner/admin · 메일 상세 안내 줄 버튼 · 도메인은 **서버가 고른다**(`candidateOf` — 경고(warn) 스레드의 `lookalike_known_domain` 중 `from:` 호스트의 등록 도메인 하나). 링크·Reply-To 는 제시 안 함. **격리 상태에서는 등록 불가**(`release_first` — 먼저 [스팸 아님]). 무료메일·우리 도메인 거절.
  - 확인창에 두 도메인을 적는다(«x 는 y 와 한 글자만 달라요 …»).
  - 효과: 아는 도메인에만 더함(우리 주소·워크스페이스 이름 검사 범위는 그대로). 등록 도메인도 비교 대상으로 남아 그것을 흉내 낸 도메인은 계속 잡힌다.
  - 등록·빼기 뒤 다시 판정(사칭 판정 있는 스레드 · 빼기는 그 도메인에서 받은 스레드) — 격리가 풀리는 것은 `spam_origin='impersonation'` 뿐, 새로 격리하지 않음. 감사 `mail.trusted_domain.add/remove`(old/new). 빼기는 설정 › 메일 분류 기준 «안전한 도메인».
- 검증: `dev-backend` 실호출 26/26(A 신호 0 · 처음 보는 유사 도메인 격리 유지 · 격리 상태 400 · 멤버 403 · 등록 뒤 표시 사라짐 · 제3 도메인 계속 걸림 · bidi 격리 유지 · 빼면 경고 복귀·재격리 없음 · 감사) · 대조군: A 를 끄면 Irene 화면과 같은 `warn + known + lookalike` 로 돌아감.
