#!/bin/bash
#
# 배포용 «마지막 커밋의 깨끗한 사본» 만들기 (2026-10-12)
#
#   Irene 2026-10-11: «배포를 하면 모든 작업 일시정지하고 점검 후 배포해야지. 진행중인 거 있으면 그건 빼고.»
#
#   운영 배포는 작업 폴더(/opt/planq)가 아니라 **커밋 하나의 사본**에서 검사·빌드·rsync 한다.
#   작업 폴더의 미커밋 변경 = 다른 방이 하던 일 — 운영에 실리면 안 된다. 그래서 작업 폴더는
#   **읽기만** 하고(stash·checkout·커밋 없음), 사본은 `git archive <커밋>` 으로 만든다.
#
#   사본에 따로 붙이는 것 (추적 안 되지만 빌드·검사에 필요한 것) — 이것뿐이다:
#     · dev-frontend/.env                빌드 시점 환경값(VITE_*) — 작업 폴더 것을 복사
#     · dev-frontend/node_modules        항목마다 심볼릭 링크(작업 폴더 것) — 단 .tmp·.cache·.vite 는
#                                        사본 전용 폴더. 통째로 링크하면 tsc -b 의 tsbuildinfo 가 작업
#                                        폴더 원본 경로를 가리켜 사본 대신 작업 폴더를 «최신» 으로 본다.
#                                        .tmp(tsbuildinfo)는 복사해 증분 검사 기준으로만 쓴다(없으면 OOM 위험).
#     · dev-backend/node_modules · .env  링크 / 복사(권한 유지) — 사본 백엔드는 서버로 띄우지 않고 문법·require
#                                        검사와 불변식 가드(일부 검사가 모듈을 불러 본다)만 돈다.
#                                        rsync 는 node_modules·.env 를 빼므로 운영에 안 간다.
#   그 밖의 미추적 파일은 사본에 없다 — 운영 rsync 는 보호 목록(deploy-planq.sh)으로 운영 쪽 것을 지킨다.
#
# 사용법:  scripts/make-deploy-snapshot.sh <만들 폴더> [커밋=HEAD]
#   마지막 줄 출력: COMMIT <40자 해시>
set -euo pipefail

REPO=/opt/planq
OUT="${1:?사본을 만들 폴더를 주세요}"
REF="${2:-HEAD}"

cd "$REPO"
COMMIT=$(git rev-parse --verify "${REF}^{commit}")

if [ -e "$OUT" ] && [ -n "$(ls -A "$OUT" 2>/dev/null)" ]; then
  echo "[snapshot] $OUT 가 비어 있지 않음 — 덮어쓰지 않는다" >&2
  exit 1
fi
mkdir -p "$OUT"

# 1) 커밋 내용 그대로
git archive --format=tar "$COMMIT" | tar -x -C "$OUT"

# 2) 프론트 빌드 환경값
if [ -f "$REPO/dev-frontend/.env" ]; then
  cp -p "$REPO/dev-frontend/.env" "$OUT/dev-frontend/.env"
fi

# 3) 프론트 node_modules — 항목별 링크 + 캐시 폴더는 사본 전용
SRC_NM="$REPO/dev-frontend/node_modules"
DST_NM="$OUT/dev-frontend/node_modules"
mkdir -p "$DST_NM"
for entry in "$SRC_NM"/* "$SRC_NM"/.[!.]*; do
  [ -e "$entry" ] || continue
  name=$(basename "$entry")
  case "$name" in
    .tmp|.cache|.vite) continue ;;
  esac
  ln -s "$entry" "$DST_NM/$name"
done
mkdir -p "$DST_NM/.tmp"
if [ -d "$SRC_NM/.tmp" ]; then
  cp -p "$SRC_NM"/.tmp/*.tsbuildinfo "$DST_NM/.tmp/" 2>/dev/null || true
fi

# 4) 백엔드 — 검사용 (운영으로는 안 간다: rsync 가 node_modules·.env 를 뺀다)
ln -s "$REPO/dev-backend/node_modules" "$OUT/dev-backend/node_modules"
if [ -f "$REPO/dev-backend/.env" ]; then
  cp -p "$REPO/dev-backend/.env" "$OUT/dev-backend/.env"
fi

echo "COMMIT $COMMIT"
