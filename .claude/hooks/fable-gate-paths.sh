# PlanQ — Fable 게이트 지문 경로의 **단일 정본** (Fable 결정 2026-09-25)
#   fable-gate-stop.sh 와 .claude/commands/fable-검증.md 가 이 파일 하나를 source 한다.
#   전에는 같은 경로 문자열이 두 파일에 세 번 박혀 있었다 — 한 곳만 고치면 지문이 갈라진다.
#
#   scripts          — 검사기(e2e·guard-invariants·health-check)·래칫 베이스라인·배포 스크립트.
#                      여기가 빠져 있어 «검사기를 약화시키는 변경» 이 게이트를 울리지 않았다.
#   .claude/hooks    — 게이트 자신. 게이트를 끄는 변경이 게이트 밖이면 안 된다.
#   .claude/commands — /fable-검증 의 마커 기록 절차.
#   ★ docs/ 는 넣지 않는다 — FABLE_GATE_QUEUE.md(unavailable 흐름)·dev-status/next.json(배포)을
#     게이트·배포가 스스로 쓰므로 자기 출력에 자기가 울리는 루프가 된다.
#     .claude/session-state.md·settings.local.json 도 같은 이유로 제외(자동저장이 쓴다).
GATE_PATHS=(dev-backend dev-frontend q-note scripts .claude/hooks .claude/commands)
