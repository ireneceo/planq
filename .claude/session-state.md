## 현재 작업 상태
**마지막 업데이트:** 2026-09-14 20:15 (UTC) — Q sale 3차 신고 4건 · **운영 배포 완료**
**작업 상태:** 전부 커밋·배포됨 · 미커밋 0건 · **Fable 미검증(자체 검증) — 오늘 호출 6회 전부 429**
**Git:** HEAD `882d71fe` · 버전 **1.52.4** · 운영 `.last-deployed-commit` = `882d71fe`

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
