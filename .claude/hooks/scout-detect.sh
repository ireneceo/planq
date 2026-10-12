# PlanQ — «상황판 정찰 방» 판정 (2026-10-12 · 서버 방 요청 · Fable 설계 판정 D 의 PlanQ 몫)
#   scout-guard.sh(PreToolUse) · fable-gate-stop.sh · idle-autosave-stop.sh 가 source 한다 — 판정은 이 한 곳.
#
# 정찰 방 = 대화의 **첫 사용자 메시지 첫 줄**이 정확히 «[상황판 정찰 방 — 읽기 전용]» 인 방.
#   ★ «첫 줄이 같다» 로만 가른다. 본문 어딘가에 그 문구가 있는 것은 정찰 방이 아니다 —
#     이 장치를 맡긴 일반 방의 첫 메시지에도 그 문구가 인용돼 있다.
#   판정 못 함(기록 파일 없음·첫 메시지 아직 없음) = 일반 방. 지금 방들에 영향 0 이 우선이다.
#   정찰 방은 첫 메시지가 도구 호출보다 먼저 기록되므로 첫 도구 호출부터 정찰 방으로 잡힌다.
#
# 캐시: 방(session_id)마다 결과 한 글자. 첫 메시지는 바뀌지 않으므로 무효화가 없다.
#   «아직 모름» 은 캐시하지 않는다(다음 호출에서 다시 본다).

PLANQ_SCOUT_MARK='[상황판 정찰 방 — 읽기 전용]'
PLANQ_SCOUT_CACHE_DIR="${PLANQ_SCOUT_CACHE_DIR:-/tmp/planq-scout-cache}"

# 인자: 훅 stdin JSON. 정찰 방이면 0, 아니면 1.
planq_is_scout() {
  local json="$1" sid tp first cache
  sid=$(printf '%s' "$json" | jq -r '.session_id // empty' 2>/dev/null)
  tp=$(printf '%s' "$json" | jq -r '.transcript_path // empty' 2>/dev/null)
  if [ -n "$sid" ]; then
    cache="$PLANQ_SCOUT_CACHE_DIR/${sid//[^A-Za-z0-9_-]/_}"
    if [ -f "$cache" ]; then
      [ "$(cat "$cache" 2>/dev/null)" = "1" ] && return 0
      return 1
    fi
  fi
  [ -n "$tp" ] && [ -f "$tp" ] || return 1
  # 첫 사용자 기록 한 줄만(본 대화 — 하위 에이전트 기록 isSidechain 제외). 내용은 문자열 또는 블록 배열.
  first=$(grep -m1 -E '"type": ?"user"' "$tp" 2>/dev/null | jq -r '
      select(.isSidechain != true) | .message.content
      | if type == "string" then . else ([.[] | select(.type == "text") | .text] | join("\n")) end
    ' 2>/dev/null | head -n1)
  # 첫 사용자 기록이 하위 에이전트 것이었으면(드묾) 본 대화 첫 기록을 다시 찾는다
  if [ -z "$first" ]; then
    first=$(jq -r 'select(.type == "user" and .isSidechain != true) | .message.content
        | if type == "string" then . else ([.[] | select(.type == "text") | .text] | join("\n")) end' \
        "$tp" 2>/dev/null | head -n1)
    [ -z "$first" ] && return 1        # 아직 모름 — 캐시하지 않는다
  fi
  first="${first%$'\r'}"
  first="${first#"${first%%[![:space:]]*}"}"   # 앞 공백만 걷는다
  first="${first%"${first##*[![:space:]]}"}"   # 뒤 공백
  local verdict=0
  [ "$first" = "$PLANQ_SCOUT_MARK" ] && verdict=1
  if [ -n "$cache" ]; then
    mkdir -p "$PLANQ_SCOUT_CACHE_DIR" 2>/dev/null && printf '%s' "$verdict" > "$cache" 2>/dev/null
  fi
  [ "$verdict" = "1" ]
}
