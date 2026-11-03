#!/usr/bin/env bash
# frontend-build.sh — dev-frontend `npm run build` 의 본체: tsc -b → vite build (서버 «메모리 자리표» 상자 안에서 돈다) (2026-11-03)
#
#   왜: 11-03 07:51·07:55 PlanQ 빌드 둘이 겹쳐 남은 메모리 200MB·스왑 99% → 바깥 통신 끊김 → 08:02 재부팅.
#     Irene «같은 일 안생기게 메모리 나눠서 순서대로 쓰게 해야지» → 서버 공용 자리표 ~/dev-server/bin/mem-slot (README §2).
#     자리표는 «먼저 선 순서대로» 메모리 몫을 나눠 주고, 들어간 일은 cgroup 상자(몫×1.3, 최대 5494MB + 스왑 512MB) 안에서
#     돌려 넘치면 그 일만 죽인다(137) — 서버 전체가 얼지 않는다.
#   자리 잡기는 package.json "build" 한 줄이 한다(서버 공용 검사 mem-slot-guard 가 그 줄에서 mem-slot 을 본다):
#     mem-slot run planq-build|planq-deploy-build 3600 -- bash ../scripts/frontend-build.sh
#     그래서 dev 빌드(prebuild 의 build-gate.sh 를 먼저 거침)와 운영 배포 빌드(deploy-planq.sh — PLANQ_DEPLOY_PIN,
#     배포의 wait_heavy_gate 를 먼저 거침)가 같은 자리표를 쓴다. 이 파일을 혼자 부르지 않는다.
#   몫(MB) = 실측 정점 + 15% — 아래 [build-mem] 줄이 매 빌드마다 정점을 찍는다. 정점이 늘면 package.json 의 숫자를 고친다.
#     MEASURED 2026-11-03 (styled-components 6.6.0): 상자 정점 3100MB (tsc RSS 3.12GB·105초 / vite 0.74GB) → 3600.
#   힙 상한: tsc 6144 → 4096 (11-03 tsc 하나가 혼자 RSS 6.0GB — 6144 면 상자에 걸려 죽는다).
#     ★ styled-components 6.3.12 에서는 tsc 가 힙 4096·4864 둘 다 메모리 부족으로 죽었다(RSS 5.1GB+). 원인은 그 버전의 타입 —
#       추가 속성(`styled.div<{ $x }>`)을 받는 컴포넌트를 JSX 에서 쓸 때마다 타입 계산이 쌓였다
#       (시험: 300개 사용 1257MB → 6.6.0 375MB · TypeScript 7 로 바꿔도 4GB 넘음). 6.6 아래로 내리면 이 힙·몫으로는 tsc 가 죽는다.
#   종료: 빌드의 종료 코드 (자리표가 감싸므로 75 = 차례가 60분 안에 안 옴 · 137 = 상자 넘어 죽음)
set -eu
HEAP=4096

NODE_OPTIONS="--max-old-space-size=$HEAP" /usr/bin/time -f '[build-mem] tsc 최대 RSS %M KB · %e초' tsc -b
NODE_OPTIONS="--max-old-space-size=$HEAP" /usr/bin/time -f '[build-mem] vite 최대 RSS %M KB · %e초' vite build

# 자리표 상자(cgroup) 전체의 정점 — 몫을 고칠 때 이 숫자를 본다
#   (상자 없이 들어갔으면 — 사용자 systemd 가 없을 때 — 이 cgroup 은 pm2 등 남의 것이라 찍지 않는다)
peak_file="/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/memory.peak"
if [[ "$peak_file" == *memslot-* ]] && [ -r "$peak_file" ]; then
  echo "[build-mem] 상자 정점 $(( $(cat "$peak_file") / 1048576 ))MB"
fi
