## 현재 작업 상태
**마지막 업데이트:** 2026-09-14 21:35 (UTC) — 머리줄 통일(1번) + **법인 2개 고지 완결**
**작업 상태:** 전부 커밋 · 미커밋 0건 · **미배포** · **Fable 미검증(자체 검증) — 오늘 호출 8회 전부 429**
**Git:** HEAD `dc7feff4` · 버전 1.52.4 · **미푸시 22커밋**(`origin/main` = `648d59d1`) · 운영 = `882d71fe`

> ★ 미푸시 커밋 수를 세션 중에 8·9·12·14 로 **네 번 틀리게 보고했다.** `git log origin/main..HEAD | head -20`
> 의 잘린 출력을 세어서다. 정확한 수는 **22** 다. 세는 명령에 `head` 를 붙이면 세지 말 것.

### 이번 세션(이어받은 세션)에서 한 것 — 2건
1. **머리줄 버튼 통일(1번)** — `bf487192`. 주석에 적힌 이유가 거짓이었고 실측이 값을 정했다(머리줄 32 / 필터줄 36).
   신규 카나리 `--suite headerrow`. 양성 대조군 21 실패 ↔ 0.
2. **법인 2개 고지 완결** — `5f40bebb`. 앞 라운드 문구가 절반 거짓이었음을 운영 DB 로 확인해 정정.
   단일 원천 `config/legalEntities.ts`. 그 과정에 결함 3건 추가 발견·수정.

### 배포 이력 (이번 세션 이전)
### 운영 배포 — 오늘 2회
| 시각 | 커밋 | 무엇 |
|---|---|---|
| 19:15 | `19643da3` | v1.52.4 — Q sale 2차 15건 (앞 세션이 배포까지 했고, 그 직후 세션이 끊겼다) |
| 20:07 | `882d71fe` | Q sale 3차 4건 (380초 · 백업 `20260914_200724`) |

★ **내가 한 번 틀리게 보고했다** — 세션 상태에 "미배포" 라고 적혀 있어 그대로 옮겼는데,
운영 백업 디렉터리(`20260914_191513`)와 개발 현황 행(id=98)이 **19:15 배포를 증명**했다.
끊긴 세션의 마지막 동작은 커밋이 아니라 **배포**였다. 상태 파일은 배포 전에 쓰였다.

### 이번 세션 결과 — Q sale 2차 신고 15건 (15/15 반영)
**공용 껍데기를 고쳤다(베끼지 않았다).** 그래서 Q sale 밖으로도 번진다:
| 껍데기 | 무엇을 | 번지는 곳 |
|---|---|---|
| `Common/ActionButton.tsx` | **`xs` 32px** 신설 | 전 화면 (신규 사용은 Q sale) |
| `Common/filterBar.tsx` | `FilterSlot`+`axisOption` · `CheckFilter` 신설 | Q sale |
| `Common/filterChip.tsx` | **신설** — 알약 줄(ChipRow·FilterChip·ChipDivider·ChipRight) | Q sale 상담·고객 두 탭 |
| `Common/NoteThread.tsx` | **Enter 전송**(Shift+Enter 줄바꿈 · IME 가드 유지) | 3파일 4곳 — Q mail 이슈·메모 · Q Talk 메모 · Q sale 메모 |
| `services/saleCommon.js` | `noteTargetOf`/`noteCountsForItems`/`applyNoteCounts` | Q sale 전 행 종류 |
| `scripts/guard-invariants.js` | controlHeights 토큰에 **32** → 베이스라인 740 → **636** | 전 저장소 |

**★ 15번을 처음에 잘못 읽었다** — "행 액션을 고객 탭에도" 로 읽고 *"맞출 맥락이 없다"* 고 보고했다.
Irene: *"세일에서 고객탭은 필터랑 버튼 디자인들 위치 맞추라고 한거야."* → 실측하니 두 탭이
알약을 각자 선언해 갈라져 있었다(칩 줄 시작 y 10px · 켜진 테두리 `#0D9488` vs `#5EEAD4`).
→ `filterChip.tsx` 로 빼서 둘이 같이 쓴다. memory `feedback_nothing_to_align_needs_measuring`.

**★ note_count 가 메모가 아니라 응대 내역을 세고 있었다** — 새 [메모보기 ⌄] 손잡이가 영영 안 뜰 뻔했다.

### 규칙을 조용히 어기지 않았다 (둘 다 문서에 적었다)
- **"필터 전체 옵션 필수"** → memory 수정: 필수인 것은 낱말이 아니라 **되돌릴 길**이다.
- **UI_DESIGN_GUIDE §1.8 "Enter 단독 저장 금지"** → 예외 절 추가(칸 하나짜리 **채팅형** 입력).

### 검증 (Fable 미검증 — 자체 검증)
판정 **R=0 · S=0 · F=1 → 내가 검증한다**.
- 빌드 **EXIT 0 · `error TS` 0** · 빌드 산출물 19:20 (마지막 소스 변경 19:04 이후)
- health-check **44/44** · 가드 **전체 통과**(uispec 32 추가 후 636/636)
- 카나리 `node scripts/e2e/run.js --suite salelayout` — 3폭 **통과 102 · 실패 0**
  (Enter 전송 실 POST 1건 + 음성 대조군 Shift+Enter POST 0건 · ⑮-B 눌러서 8건)

### ★ 내 판정기가 하루에 세 번 틀렸다 (전부 메모리 박제)
1. 열 정렬을 **칩**으로 쟀다 → 거짓 실패 3건 (`feedback_center_aligned_chip_x_is_not_a_column`)
2. 양성 대조군 `:nth-of-type(odd)` 가 모든 행에 먹어 **결함이 안 심겼다** (`feedback_positive_control_can_be_wrong`)
3. **감싸는 상자(ChipRow)의 top** 을 재서 `padding-top` 회귀를 못 봤다 (`feedback_judge_measures_wrapper_not_defect`)

### 이번 세션 추가분 — Q sale 3차 신고 4건 (`12b2975d`)
Irene: *"검색창 왜 위에 있어? 필터들 맨 앞에 둬. 단계 셀렉트 앞에. 그리고 상담 고객이 글자가 왜 세로야?
+고객응대 내역 추가 버튼은 Q task에 +업무추가랑 같은 버튼으로 해. 활성화 버튼."* · *"프로젝트 헤더처럼."*
- 검색 → **필터줄 맨 앞**(공용 `SearchBox` 36px, 독자 SearchInput 제거). `FilterSearchSlot` 은 자라지 않는다
- 알약 탭이 머리줄에서 **먼저 줄어들어** 글자가 세로로 쪼개졌다 → `flex-shrink:0` + `nowrap`(Q task 도 같이)
- 머리줄 CTA 가 **세 화면에 각자 선언**(프로젝트 h32/600 · Q task h36/**700** · Q sale 흰 배경)
  → **`components/Common/headerCta.tsx`** 로 빼서 셋이 같이 쓴다. 값은 프로젝트 헤더가 정본
- 카나리는 끄지 않고 **계약을 옮겼다**(④⑤) + ⑯ 신설. **양성 대조군 9/9** 뒤집힘 → 원복 후 0
- ★ 남은 판단: Q task 버튼 굵기가 700 → 600 이 됐다(지시는 "Q sale 을 Q task 에 맞춰라" 였다). Irene 확인

### 이번 세션 — 끊긴 뒤 이어서 (`bf487192`, 미배포)
**세션이 SSH 끊김으로 멈췄었다. 배포는 이미 끝나 있었다** — 운영 `882d71fe` = v1.52.4,
pm2 3개 online, `undeployed: []`. 워킹트리는 clean 이었고 끊긴 지점이 읽기 전용 grep 이라 잃은 것 0.

**① 머리줄 버튼 통일(1번) — 실측이 주석을 반증했다.**
`headerCta.tsx` 에 *"Q task 만 36 — 그 화면의 머리줄 컨트롤이 36 이라"* 고 적혀 있었는데
바로 옆 AI 버튼은 32 였다(검증된 적 없는 주석). 3폭 실측 → 세 화면 전부 갈라짐
(Q task {32,36} · 프로젝트 {32,37}/{30,32} · Q sale {32,37}).
**어느 값으로 모을지도 실측으로 갈랐다** — AI sm 을 36 으로 올리면 /docs·/knowledge 데스크탑이 깨진다.
→ **머리줄 정본 32 / 필터줄 36**(`filterBar.tsx`). 두 줄은 계약이 다르다.
- `headerCta.tsx` `$h` prop **삭제** · `segmentedToggle.tsx` **height:32px 명시**(전엔 글자 줄높이가 37 을 만들었다)
- 프로젝트의 **베낀** `ViewTabs` → 공용 껍데기 **상속**(활성 글자색 #0F766E 만 덮는다)
- 신규 카나리 `--suite headerrow` (3화면 × 3폭 × 4항목) · 양성 대조군 **21 실패 ↔ 0**

**★ `salelayout` ⑯ 이 3폭 거짓 실패 → 판정식이 원인이었다.** 줄 수를 *상자 높이 ÷ 줄높이* 로
추정했는데 padding 이 0 이 되자 2줄로 읽혔다(`nowrap` 이라 쪼개질 수 없음). → **Range 줄상자로 측정**.
고친 판정식도 주입 대조군으로 **1줄 → 2줄** 뒤집힘 확인. 검사를 끈 것이 아니다.

**② 법인 2개 고지 — 일부만.** Irene 이 준 값: GIT Consulting Group · 47410 Petaling Jaya, Selangor ·
https://gitconsulting.group/ · help@gitconsulting.group
- ✅ 약관 제3조 · 개인정보처리방침 3조(Stripe 처리사 / 말레이시아 수취 법인 **두 줄로 가름**) ·
  결제 직전 `checkout.stripe.hint` — 전부 ko/en
- ⏸ **푸터 두 법인** (platform_settings 에 둘째 법인 칸 없음 + **정식 상호·등록번호(SSM) 없음**)
- ⏸ **약관 시행일·`terms_version`** (올리면 전 사용자 재동의 모달 — 최종 문구 확정 후 한 번에)
- ⏸ 제12조 준거법·관할 = 전문가 영역 · 청구서·영수증 발행 주체
- **카드 결제 계속 OFF 권고**

검증: 빌드 EXIT 0 · error TS 0 · 가드 전체 통과(55/56, 1은 문서 신선도 경고) · uispec 636/636 무변동 ·
health-check 44/44 · 카나리 실패 0(headerrow·salelayout·sale-panel·projecttabs). **Fable 미검증(429 6차)** · 게이트 43.

### 법인 2개 고지 — **완결** (Irene 이 정식 정보를 줬다: "남은 거 다 하라고")
**GIT CONSULTING SDN. BHD.** · SSM `202201012250(1457947-A)` · TIN `C29771304030` ·
P-02-06A, 2nd Floor, Tropicana Avenue, … 47410 Petaling Jaya, Selangor · help@gitconsulting.group

**★ 앞 라운드에 내가 쓴 문구가 절반 거짓이었다.** 운영 `platform_settings` 직독으로 확인:
- **계좌이체 → (주)아이린앤컴퍼니**(국민은행 · 105-87-76451) · **카드(Stripe) → 말레이시아 법인**
- 그리고 "GIT Consulting Group" 은 **브랜드명**이지 등록 법인명이 아니었다(정식은 SDN. BHD.)
→ 결제 수단에 따라 수취 법인이 다르다는 사실로 전부 다시 썼다.

**단일 원천** `dev-frontend/src/config/legalEntities.ts` — 로케일의 법인명 하드코딩 **0건**(보간).
국가 이름은 모듈에 두지 않는다(i18n 가드가 잡았다 — "말레이시아" 는 번역 대상).

한 것: 약관 **제3조**·**제12조**(준거법) · 방침 **3조**(카드에 한정한 국외 이전 + SSM + **거부 수단**) ·
결제 화면 · **랜딩 푸터 두 법인** · 시행일 `2026-08-10`→**`2026-09-14`** · dev `terms/privacy_version` **1.1**

**★ 그 과정에 결함 3건을 찾아 같이 고쳤다**
1. **세금계산서 신청 후 카드 결제 → 신청이 조용히 버려졌다**(`handleStripe` 가 tax 를 안 보낸다).
   애초에 한국 세금계산서를 말레이시아 법인 수취 결제에 발행할 수 없다 → 카드 버튼 비활성 + 이유
2. **푸터의 카드 수취 법인 행이 한국 법인 데이터 유무에 매달려** 블록째로 사라졌다(dev 는 전 칸 NULL)
   → 조건 밖으로 분리. **운영 데이터로만 쟀으면 못 봤다**
3. **약관 버전을 올리면 카나리 전체가 죽는 구조** — 재동의 모달이 `aria-modal` 로 판정을 위조하고
   클릭을 가로채는데 `data-testid` 가 없었다 → testid 4개 + `dismissBlockers` + **`login()` 이 API 로
   선동의**. 버전을 `'1.0'` 상수로 박던 카나리 2곳(`qnote-cue`·`admin-crawl`)도 DB 에서 읽게

**★ 그 자동 동의를 처음엔 조용히 실패하게 만들었다** — access token 이 프론트 **메모리**에만 있어
쿠키 fetch 는 401, `try/catch` 가 삼켰다. 로그인 응답 토큰을 Bearer 로 쓰고 **실패하면 경고**를 찍는다.

### ★ 운영 사실 2건 (Irene 판단 필요)
1. **운영에서 카드 결제가 지금 켜져 있다** — `stripe_card_enabled=1` · secret·webhook 모두 있음
   → `isStripeEnabled('platform')` = **true**. memory 의 "문서 개정 전까지 OFF 권고" 가 반영 안 된 채
   열려 있었다. 고지는 이제 넣었지만 **최종 문구가 전문가 확인을 안 받았다**
2. **운영 `terms_version` 은 안 올렸다** — 설정은 서버별 DB 라 배포로 안 따라간다. 올리는 순간
   운영 전 사용자에게 재동의 모달. 배포와 같은 순간에 해야 한다

미푸시: 법인 완결분 포함. **Fable 미검증(429 7차)** · 게이트 43 · 43-B.

### ★ Irene 에게 물어야 하는 것 (세션이 끊겨 잃어버렸다)
그때 1~4번으로 번호 붙인 신고 목록이 **어디에도 안 적혀 있다.** 복구된 것은 1번뿐이다.
- **2·3번이 무엇이었나?**
- **"4번 백로그"** — 4번을 백로그로 빼라는 뜻인가, 백로그 목록의 4번(*운영 옛 프론트 청크 누적*)을 하라는 뜻인가?
그리고 말레이시아 법인의 **정식 상호(법인형태)·등록번호(SSM)**.

### 다음 할 일
- **Fable 대기열 41** — `/usage-credits` 로 풀리면 한 번에. 풀리면 개발 현황의
  `verified: "opus_only"` 를 `fable_pass` 로 고쳐 재발행.
- 법인 2개 문서 개정(Irene 법인 정보 필요 — 그 전까지 카드 결제 OFF 권고) · Play 심사 결과 대기

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
