# /fable-검증 — Fable 독립 검증 게이트 (공용 기준의 Fable 대상일 때)

**언제 부르나 = 공용 기준** `~/dev-server/FABLE.md` (PlanQ 의 «되돌리기 어려운 것» 예시는 CLAUDE.md «Fable 사용» 절).
되돌리기 어려운 변경(돈·운영 DB·권한·공개 주소·외부 발송·삭제·보호 영역)의 완료 검증 · 계산·통계 · 검증 설계 · 새 화면/핵심 흐름 UX 점검일 때 부른다.
화면 다듬기·작은 버그는 부르지 않는다 — 자체 검증 숫자 + «Fable 미검증(자체 검증)».
(출처: 2026-07-21 Irene «구현·테스트 검증은 무조건 Fable» → 2026-09-06 «꼭 필요한 부분에만» → 2026-10-08 공용 기준으로 통일.)

이 커맨드는 Stop 훅(`fable-gate-stop.sh`)과 연동된다 — PASS 면 마커를 남겨 그 변경 상태(지문)로는 다시 묻지 않는다.

---

## 1단계: Fable 서브에이전트로 독립 검증

**Agent 도구를 `model: "fable"` 로 호출**한다. 한 사안 최대 2번(설계 1 + 검증 1), 같은 기능 후속은 묶어서 한 번.
**사실만 짧게** 넘긴다 — 무엇을 보라는 체크리스트를 내려보내지 않는다(공용 기준 4절):

> 너는 PlanQ 독립 검증관(Fable)이다. 아래 변경이 운영에 나가도 되는지 **실제 실행·호출로** 판정하라. 통과를 남발하지 말고 의심되면 실패로 판정하라.
> - Irene 원문(신고·지시):
> - 변경 범위: 커밋 `<마지막 마커 commit>..HEAD` + 미커밋 (`source .claude/hooks/fable-gate-paths.sh && git status --porcelain -- "${GATE_PATHS[@]}"`)
> - 설계 문서:
> - 내 자체 검증 숫자:
> - 이 저장소의 검사 도구(필요한 것을 골라 써라): CLAUDE.md «Fable 사용 › 이 저장소의 검사 도구» — health-check · guard-invariants · `npm run build` · e2e 스위트 · 포트 3003 실HTTP(테스트 스크립트는 `dev-backend/` 에서 돌리고 반드시 `rm`).
>
> 출력: 판정 근거(실제 명령 출력·HTTP 응답 발췌) · 차단/비차단 지적 · 마지막 줄에 정확히 `VERDICT: PASS` 또는 `VERDICT: FAIL`.

---

## 2단계: 판정 처리

### PASS 인 경우 → 마커 기록 (정지 허용)
Fable 이 `VERDICT: PASS` 를 낸 경우에만 아래 Bash 실행:

```bash
REPO=/opt/planq
# ★ 지문은 훅(fable-gate-stop.sh)과 **정확히 같은 방식**으로 계산해야 한다.
#   훅은 printf '%s' 로 후행 개행 없이 해시한다 — 파이프(`| sha256sum`)로 계산하면
#   개행이 섞여 해시가 영원히 달라지고, 마커를 남겨도 게이트가 통과되지 않는다.
# ★ 훅은 미커밋 변경 **+ 마지막 통과 이후의 소스 커밋** 을 함께 해시한다.
#   마커에 `commit` 을 반드시 남겨야 다음 판정의 기준점이 생긴다 — 빠뜨리면 훅이
#   커밋 이력을 못 보고 옛 동작(커밋하면 침묵)으로 되돌아간다.
source "$REPO/.claude/hooks/fable-gate-paths.sh"
CHANGED=$(git -C "$REPO" status --porcelain -- "${GATE_PATHS[@]}")
HEADC=$(git -C "$REPO" rev-parse HEAD)
FP=$(printf '%s\n%s' "$CHANGED" "" | sha256sum | cut -d' ' -f1)
printf '{"fingerprint":"%s","commit":"%s","ts":%s,"by":"fable"}\n' "$FP" "$HEADC" "$(date +%s)" > "$REPO/.claude/.fable-gate.json"
echo "✅ Fable 게이트 통과 기록됨 (fp=${FP:0:12} commit=${HEADC:0:8})"
```

그 후 사용자에게 Fable 판정 근거를 요약 보고. (필요 시 이어서 `/개발완료`.)

### Fable 을 **띄우지 못한** 경우 (한도·사용량 초과·과부하) → 공용 기준 5절

출처 Irene 2026-09-10: *"페이블 토큰 있을 때 페이블 쓰고 아닐 때 스킵하고 하는 걸로 해야지"* — 2026-10-08 부터 «스킵» 은 아래 절차다.
그 밖의 오류는 한 번 다시 시도한다. 귀찮아서·오래 걸려서는 해당 없다.

1. 자체 검증을 **실제로 돌려 숫자로** 남긴다. Fable 몫의 판단을 «통과» 로 쓰지 않는다.
2. **상황판 Fable 대기**에 올린다(`docs/FABLE_GATE_QUEUE.md` 에 쌓던 것을 대신한다):
   ```bash
   curl -s -X POST -H 'Content-Type: application/json' -H 'Origin: http://localhost:8800' --data-binary @- http://127.0.0.1:8800/api/fable-wait <<EOF
   {"room":"$(basename "$CLAUDE_JOB_DIR")","kind":"gate","title":"한 줄 제목","need":"커밋 범위·바뀐 파일·설계 문서·자체 검증 숫자·내가 못 가른 지점","resetAt":"오류에 풀리는 시각이 있으면 ISO"}
   EOF
   ```
   (방 번호가 없는 터미널 창이면 `"room"` 대신 `"project":"planq"`.)
3. 작업기록 `.claude/session-state.md` 에 `### 나중에 — Fable 대기: 무엇 · 한도가 풀리면 · 그때 할 일`.
4. 마커를 `by:"unavailable"` 로 남긴다(아래) — 훅은 이 지문을 통과시키되 «검증됨» 과 **구별**된다.
5. 보고 첫 줄 `🕓 나중에 — Fable 대기: …`, 본문에 «Fable 미검증(자체 검증)». **운영 배포는 Fable 통과 뒤로.**
6. 상황판이 풀리는 시각에 이 방을 깨우면 다시 올리고, 판정을 받으면 `{"room":"<방 번호>","done":true}` 를 같은 주소로 보낸다.

```bash
REPO=/opt/planq
source "$REPO/.claude/hooks/fable-gate-paths.sh"
CHANGED=$(git -C "$REPO" status --porcelain -- "${GATE_PATHS[@]}")
HEADC=$(git -C "$REPO" rev-parse HEAD)
LAST=$(jq -r '.commit // empty' "$REPO/.claude/.fable-gate.json" 2>/dev/null)
if [ -n "$LAST" ] && git -C "$REPO" cat-file -e "${LAST}^{commit}" 2>/dev/null; then
  COMMITTED=$(git -C "$REPO" log --format=%H "${LAST}..HEAD" -- "${GATE_PATHS[@]}")
else COMMITTED=""; fi
FP=$(printf '%s\n%s' "$CHANGED" "$COMMITTED" | sha256sum | cut -d' ' -f1)
printf '{"fingerprint":"%s","commit":"%s","ts":%s,"by":"unavailable"}\n' "$FP" "$HEADC" "$(date +%s)" > "$REPO/.claude/.fable-gate.json"
echo "⚠️ Fable 미가용 — 상황판 Fable 대기 + unavailable 마커 (fp=${FP:0:12})"
```


### FAIL 인 경우 → 마커 기록 금지
- 마커를 쓰지 않는다(정지 시 훅이 다시 게이트를 요구).
- Fable 이 지적한 FAIL 항목을 사용자에게 그대로 보고하고, 수정 후 다시 `/fable-검증`.
- **"코드상 맞다"로 통과 처리 절대 금지.**

---

## 주의
- Fable 대상 변경을 이 커맨드 없이 «검증 완료» 라고 보고하는 것은 위반이다(대상이 아니면 «Fable 미검증(자체 검증)» 으로 보고).
- Fable 대상 변경에서 Opus 가 스스로 검사를 돌려 PASS 마커를 쓰는 것도 위반 — `by:"fable"` 마커는 Fable 판정으로만.
- 마커는 "현재 변경 상태"의 지문에 묶인다. 마커 기록 후 코드를 더 바꾸면 지문이 달라져 게이트가 다시 열린다(재검증 필요) — 정상 동작.
- 사람이 강제로 넘기려면: `touch /opt/planq/.claude/.fable-gate-skip`.
  ★ **24시간 뒤 자동 만료**된다. 2026-08-23 에 임시로 켠 것이 **18일간 켜진 채 잊혀**
  그동안 자동 차단이 0회였고 자체 검증만으로 운영 배포까지 갔다(v1.48.17·v1.48.18).
  무기한 스위치를 두지 않는 이유다.
- 훅은 **미커밋 변경 + 마지막 통과 이후의 소스 커밋**을 함께 본다. **커밋은 검증이 아니다** —
  예전엔 커밋하는 순간 훅이 조용해져 그대로 배포까지 갔다(2026-09-07·2026-09-10 두 번).
