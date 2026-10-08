#!/bin/bash
# PlanQ — Fable 검증 게이트 Stop 훅 (Irene 지시 2026-07-21 «무조건 Fable» 로 시작 → 09-06 조건부 → 10-08 공용 기준)
# 정책: 언제 Fable 인가는 ~/dev-server/FABLE.md. 이 훅은 «판정 없는 변경 상태» 에서 한 번 멈춰 가르게 할 뿐이다.
#
# 동작: dev-backend/dev-frontend/q-note 에 미커밋 변경이 있는데
#       그 상태에 대한 Fable 게이트 통과 마커가 없으면 → 정지(완료)를 1회 차단하고
#       /fable-검증 실행을 요구한다.
#
# 무한 루프/대화 방해 방지: "지문(변경 상태 해시)" 단위로 딱 1회만 차단한다.
#   - 같은 변경 상태에서 두 번째 정지부터는 통과 (경고는 이미 전달됨).
#   - 코드가 더 바뀌면 지문이 바뀌어 다시 1회 경고.
#   - /fable-검증 통과로 마커가 기록되면 완전히 침묵.
#
# 마커:  /opt/planq/.claude/.fable-gate.json   (/fable-검증 통과 시 기록)
#
# ★ 2026-09-10 (Irene): "페이블 토큰 있을 때 페이블 쓰고 아닐 때 스킵하고 하는 걸로 해야지"
#   → 스킵은 **자동 판정**이고, 스킵했다는 사실은 **반드시 남는다.**
#   ① Fable 을 쓸 수 있으면 → /fable-검증 이 돌고 PASS 마커가 남는다
#   ② Fable 을 못 쓰면      → /fable-검증 이 `by:"unavailable"` 마커를 남기고
#                            상황판 Fable 대기(/api/fable-wait)에 올린다. 그 지문에 한해서만 통과.
#   두 경우 모두 **그 변경 상태(지문)에 묶인다** — 코드가 더 바뀌면 다시 판정한다.
#
# 우회:  touch /opt/planq/.claude/.fable-gate-skip   (사람이 강제로 넘길 때)
#   ★ **24시간이 지나면 자동으로 만료**된다. 무기한 스위치가 아니다 —
#     2026-08-23 에 임시로 켠 것이 **18일간 켜진 채 잊혀** 그동안 자동 차단이 0회였고,
#     자체 검증만으로 운영 배포까지 갔다(v1.48.17 · v1.48.18). 같은 일이 반복되지 않게 만료를 둔다.

cat >/dev/null 2>&1   # hook stdin 소비 (사용 안 함)

# 지문 경로 — 단일 정본(fable-gate-paths.sh). 2026-09-25 부터 scripts·게이트 자체 포함, docs 제외.
#   이유는 그 파일 머리말. 검사기만 약화시키는 변경이 게이트를 울리지 않던 구멍을 막는다.
source "$(dirname "$0")/fable-gate-paths.sh"

REPO=/opt/planq
MARKER="$REPO/.claude/.fable-gate.json"
SKIP="$REPO/.claude/.fable-gate-skip"
NAG="$REPO/.claude/.fable-gate.nag"

# 수동 우회 스위치 — **24시간 만료**. 지난 것은 없는 것으로 친다(위 주석 참조).
SKIP_STALE=""
if [ -f "$SKIP" ]; then
  if [ -n "$(find "$SKIP" -mmin -1440 2>/dev/null)" ]; then
    exit 0                       # 아직 유효한 수동 우회
  fi
  SKIP_STALE="1"                 # 만료됨 → 계속 검사하고, 메시지에 그 사실을 적는다
fi

# 소스 미커밋 변경 상태 (추적/미추적 모두)
CHANGED=$(git -C "$REPO" status --porcelain -- "${GATE_PATHS[@]}" 2>/dev/null)

# ★ 2026-09-10 — **커밋은 검증이 아니다.**
#   여태 이 훅은 미커밋 변경만 봤다. 그래서 작업을 끝내고 커밋하는 순간 $CHANGED 가 비어
#   훅이 조용해졌다. 실제로 **6일 동안 게이트가 한 번도 안 울린 채 운영 배포까지 갔다**
#   (v1.48.17 · v1.48.18). 2026-09-07 에도 같은 구멍으로 "게이트를 커밋 뒤에 돌려 조용히
#   초록으로 넘기고 운영에 두 번 배포" 한 전례가 있다 — 그때 고치지 않아 그대로 재발했다.
#   → 마지막 게이트 통과 **이후에 쌓인 소스 커밋**도 미검증으로 센다.
LAST=$(jq -r '.commit // empty' "$MARKER" 2>/dev/null)
if [ -n "$LAST" ] && git -C "$REPO" cat-file -e "${LAST}^{commit}" 2>/dev/null; then
  COMMITTED=$(git -C "$REPO" log --format=%H "${LAST}..HEAD" -- "${GATE_PATHS[@]}" 2>/dev/null)
else
  # 마커에 커밋이 없다(옛 형식) → 소스 커밋 이력을 판정할 수 없으므로 미커밋 변경만 본다.
  COMMITTED=""
fi

# 미커밋 변경도 없고 미검증 커밋도 없으면 통과
[ -z "$CHANGED" ] && [ -z "$COMMITTED" ] && exit 0

# 지문은 **둘 다** 반영한다 — 커밋만 쌓여도 상태가 달라져야 한다
FP=$(printf '%s\n%s' "$CHANGED" "$COMMITTED" | sha256sum | cut -d' ' -f1)

# 이 상태로 이미 판정이 났으면 통과
#   by=fable       → Fable 이 PASS 를 냈다
#   by=unavailable → Fable 을 **띄우지 못했고** 대기열에 올렸다 (그 사실이 마커에 남는다)
if [ -f "$MARKER" ]; then
  SAVED=$(jq -r '.fingerprint // empty' "$MARKER" 2>/dev/null)
  SAVED_BY=$(jq -r '.by // empty' "$MARKER" 2>/dev/null)
  if [ "$SAVED" = "$FP" ]; then
    case "$SAVED_BY" in
      fable|unavailable) exit 0 ;;
    esac
  fi
fi

# 이 상태로 이미 1회 경고했으면, 반복 차단하지 않고 통과 (대화 방해 방지)
if [ -f "$NAG" ] && [ "$(cat "$NAG" 2>/dev/null)" = "$FP" ]; then
  exit 0
fi

# 첫 감지 → 지문 기록 후 1회 차단
printf '%s' "$FP" > "$NAG"

# ★ `grep -c .` 는 0건일 때 **0 을 출력하고 exit 1** 이다 — `|| echo 0` 을 붙이면
#   두 번 출력돼 메시지에 "0\n0" 이 찍힌다(실제로 찍혔다). 출력만 쓰고 종료코드는 무시한다.
NCOMMIT=$(printf '%s' "$COMMITTED" | grep -c . 2>/dev/null); NCOMMIT=${NCOMMIT:-0}
NDIRTY=$(printf '%s' "$CHANGED" | grep -c . 2>/dev/null); NDIRTY=${NDIRTY:-0}

REASON="🚦 Fable 검증 게이트 미통과 — 완료(정지) 금지.

미커밋 소스 변경 ${NDIRTY}건 · 마지막 게이트 통과 이후 **미검증 소스 커밋 ${NCOMMIT}건** 이 있는데 이 상태에 대한 판정이 없습니다. (커밋했다고 검증된 것이 아닙니다 — 2026-09-10 에 그 구멍으로 6일간 게이트가 안 울린 채 운영 배포까지 갔습니다.)

공용 기준(~/dev-server/FABLE.md · PlanQ 예시는 CLAUDE.md «Fable 사용» 절)으로 가르세요:
  → Fable 대상(돈·운영 DB·권한·공개 주소·외부 발송·삭제·보호 영역·계산·새 설계)이면 /fable-검증 실행.
     · Fable 을 띄울 수 있으면 → 독립 검증 후 PASS 마커
     · 한도로 못 띄우면       → 자체 검증 숫자 + 상황판 Fable 대기(/api/fable-wait) + unavailable 마커,
       보고 첫 줄 «🕓 나중에 — Fable 대기», 운영 배포는 Fable 통과 뒤로. 조용히 넘어가지 않습니다.
  → 대상이 아니면(화면·문구·작은 버그·문서) 자체 검증을 실제로 돌려 숫자로 보고하고 «Fable 미검증(자체 검증)» 이라고 적은 뒤 다시 끝내세요.
${SKIP_STALE:+
⚠️ 수동 우회 파일($SKIP)이 있지만 24시간이 지나 만료됐습니다. 계속 넘기려면 다시 touch 하세요.}

이 변경 상태로는 이 경고를 한 번만 표시합니다.
사람이 강제로 넘기려면: touch $SKIP   (24시간 뒤 자동 만료)"

jq -n --arg r "$REASON" '{decision:"block", reason:$r}'
exit 0
