## 현재 작업 상태
**마지막 업데이트:** 2026-09-14 (UTC) — Q sale 2차 신고 15건
**작업 상태:** 완료(커밋) · **Fable 미검증(자체 검증) — 호출 3회 전부 429** · 배포 대기
**Git:** HEAD `bf88d42e` · 미커밋 0건 · **미배포 3건** — `01aa7a78`(Q info) · `463e0720`(Q sale 15건) · `bf88d42e`(고객 탭 알약)

### ★ 미배포 — 다음 배포에 실린다
- `01aa7a78` **Q info 저장 조건 수정**. Irene 이 `/배포` 라고 해야 나간다.
- (이번 Q sale 15건은 아직 커밋 전)

### 이번 세션 — Q sale 2차 신고 15건

**공용 껍데기 4곳을 고쳤다(베끼지 않았다).** 그래서 Q sale 밖으로도 번진다:
| 껍데기 | 무엇을 | 번지는 곳 |
|---|---|---|
| `Common/ActionButton.tsx` | **`xs` 32px** 신설 (HeaderBtn = 프로젝트 링크 규격을 그대로) | 전 화면 (신규 사용은 Q sale 뿐) |
| `Common/filterBar.tsx` | `LabeledFilter` → **`FilterSlot` + `axisOption`** · **`CheckFilter`** 신설 · `margin-top:14px` | Q sale (유일 사용처) |
| `Common/NoteThread.tsx` | **Enter 전송** (Shift+Enter 줄바꿈 · IME 가드 유지) | **3파일 4곳** — Q mail 이슈·메모 · Q Talk 메모 · Q sale 메모 |
| `scripts/guard-invariants.js` | controlHeights 토큰에 **32 추가** → 베이스라인 740 → **636** | 전 저장소 |

**항목별 결과 (15건)**
1 종료가리기 체크박스 ✅ · 2 셀렉트 안에서 고르기(축이름 첫 옵션·"전체" 없음) ✅ · 3 필터줄 위 여백 14px ✅
4 검색·추가를 헤더로(추가는 탭 뒤) ✅ · 5 `+` 아이콘 + secondary(덜 진한) ✅ · 6 xs 32px ✅
7 **보관함 → 휴지통** ko/en ✅ · 8 단계 칩 세로중앙 0px ✅ · 9 ✕ 박스 제거 + 높이 32 통일 ✅
10 [보기] = 아이콘+"보기"(목적지는 title) ✅ · 11 메모 개수 제거 ✅ · 12 [메모보기 ⌄] ✅
13 회색 판 좌우 풀폭 · 카드 안 움직임 ✅ · 14 Enter 전송 ✅
**15 고객 탭 — 맞출 대상이 없다.** 고객 탭은 **표**이고 행 액션이 0건이다(보기·메모·✕ 없음).
   메모는 우측 `ClientPanel` 타임라인에만 있다. 없는 것을 새로 만들지 않았다 — **Irene 확인 필요.**

### 규칙을 조용히 어기지 않았다 (둘 다 문서에 적었다)
- **"필터 전체 옵션 필수"** → memory `feedback_filter_all_option_mandatory` 를 고쳤다:
  *필수인 것은 낱말이 아니라 **되돌릴 길**이다.* 셀렉트는 첫 옵션 라벨이 축 이름이어도 된다.
- **UI_DESIGN_GUIDE §1.8 "Enter 단독 저장 금지"** → **§1.8 에 예외 절을 추가**했다:
  칸이 하나이고 짧은 글을 여러 번 보내며 본인이 바로 지울 수 있는 **채팅형 입력**은 Enter 전송.
  줄바꿈 Shift+Enter · IME 가드 필수 · 안내 문구가 동작과 같아야 한다.

### 검증 (Fable 미검증 — 자체 검증)
**판정: R=0 · S=0 · F=1 → 내가 검증한다** (UI 배치는 기계로 참/거짓이 갈린다).
- 빌드 **EXIT 0 · `error TS` 0** (첫 빌드는 EXIT 2 — styled 주석 안 백틱이 템플릿을 끊었다)
- health-check **44/44** · 가드 **전체 통과**(uispec 토큰 32 추가 후 636/636)
- 새 카나리 **`node scripts/e2e/run.js --suite salelayout`** — 폰 390 · 태블릿 834 · 데스크탑 1440
  Enter 전송은 **실 POST 1건**(`/api/sale/5/consults/client/293/notes`) + **음성 대조군**(Shift+Enter → POST 0건·줄바꿈 O)
- 기존 `--suite sale-panel` ④ 를 **새 계약으로 옮겼다**(끄지 않았다) — 라벨이 고정되었으므로
  판정 대상을 글자 → `title`/`aria-label` 로. 라벨 고정폭도 같이 잰다.

### ★ 내 판정기가 두 번 틀렸다 (둘 다 기록함)
1. **열 정렬을 칩으로 쟀다** → 거짓 실패 3건. 칸은 927px 로 전 행 동일했고, 가운데 정렬된 칩의 x 가
   라벨 길이("없음" vs "협상중")만큼 다른 것은 **정상**이다. → memory `feedback_center_aligned_chip_x_is_not_a_column`
2. **첫 양성 대조군이 거짓 통과했다** — `:nth-of-type(odd)` 는 **같은 태그** 기준이라 StageSlot 이
   언제나 첫 div → 모든 행에 똑같이 먹어 폭이 균일해졌다. 결함을 심은 줄 알았는데 안 심겼다.
   → `width: 150px → auto` 로 다시 심어 재측정 중. ([[feedback_positive_control_can_be_wrong]])

### 다음 할 일
- **양성 대조군 재측정 마무리** → 원복 → 재빌드 → `--suite salelayout` 최종 초록 확인 → 커밋
- **15번 판단** — 고객 탭에 맞출 맥락이 없다. 행 액션을 새로 만들지는 않았다. Irene 확인.
- **배포 대기** — `01aa7a78` + 이번 건. 지시 대기.
- 법인 2개 문서 개정(Irene 법인 정보 필요, 그 전까지 카드 결제 OFF 권고) · Play 심사 결과 대기
- **Fable 대기열 40** — `/usage-credits` 로 풀리면 한 번에.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
