#!/bin/bash
# rotate-internal-key.sh — INTERNAL_API_KEY 회전 (Node ↔ Python Q Note 공유 비밀)
#
# 왜: 이 키가 git 히스토리에 박제돼 원격 저장소에 push 됐다(2026-09-02 보안감사 C-2).
#     실제로 그 키로 인터넷에서 크로스테넌트 파일 메타 + 서버 절대경로를 200 으로 받아냈다.
#     라우트에 루프백 강제를 걸어 원격 악용은 닫았지만, **샌 비밀은 회전이 정답**이다.
#
# 이 키는 같은 서버 안 두 프로세스가 나눠 갖는다 — 한쪽만 바꾸면 Q Note 가 조용히 죽는다.
#   dev : /opt/planq/dev-backend/.env  +  /opt/planq/q-note/.env
#   prod: /opt/planq/backend/.env      +  /opt/planq/q-note/.env   (원격)
#
# 사용: ./rotate-internal-key.sh dev
#       ./rotate-internal-key.sh prod
set -euo pipefail

TARGET="${1:-}"
[ -z "$TARGET" ] && { echo "사용: $0 {dev|prod}"; exit 1; }

NEW_KEY="planq-internal-${TARGET}-$(openssl rand -hex 16)"
STAMP=$(date +%Y%m%d_%H%M%S)

apply_local() {
  local f="$1"
  [ -f "$f" ] || { echo "  ✗ 없음: $f"; return 1; }
  cp "$f" "${f}.bak-${STAMP}"                      # 되돌릴 수 있게 먼저 복사
  if grep -q '^INTERNAL_API_KEY=' "$f"; then
    sed -i "s|^INTERNAL_API_KEY=.*|INTERNAL_API_KEY=${NEW_KEY}|" "$f"
  else
    printf '\nINTERNAL_API_KEY=%s\n' "$NEW_KEY" >> "$f"
  fi
  echo "  ✓ $f (백업 ${f}.bak-${STAMP})"
}

if [ "$TARGET" = "dev" ]; then
  echo "== dev 회전 =="
  apply_local /opt/planq/dev-backend/.env
  apply_local /opt/planq/q-note/.env
  pm2 restart planq-dev-backend >/dev/null
  pm2 restart planq-qnote >/dev/null
  sleep 4
  echo "== 검증 =="
  OLD_KEY_PROBE=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "x-internal-api-key: planq-internal-dev-f76e0bffee43e39959f3dd7eb1cbb222" \
    "http://localhost:3003/api/internal/qnote/can?business_id=5" || true)
  NEW_KEY_PROBE=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "x-internal-api-key: ${NEW_KEY}" \
    "http://localhost:3003/api/internal/qnote/can?business_id=5" || true)
  echo "  유출된 옛 키 → ${OLD_KEY_PROBE} (403 이어야 함)"
  echo "  새 키        → ${NEW_KEY_PROBE} (403 이 아니어야 함)"
  [ "$OLD_KEY_PROBE" = "403" ] || { echo "  ✗ 옛 키가 아직 통한다 — 회전 실패"; exit 1; }
  [ "$NEW_KEY_PROBE" != "403" ] || { echo "  ✗ 새 키가 안 통한다 — 두 .env 가 어긋났다"; exit 1; }
  echo "✅ dev 회전 완료"
else
  echo "== prod 회전 =="
  ssh -o ConnectTimeout=20 irene@87.106.78.146 "bash -s" <<EOF
set -euo pipefail
STAMP=${STAMP}
NEW_KEY=${NEW_KEY}
for f in /opt/planq/backend/.env /opt/planq/q-note/.env; do
  if [ -f "\$f" ]; then
    cp "\$f" "\${f}.bak-\${STAMP}"
    if grep -q '^INTERNAL_API_KEY=' "\$f"; then
      sed -i "s|^INTERNAL_API_KEY=.*|INTERNAL_API_KEY=\${NEW_KEY}|" "\$f"
    else
      printf '\nINTERNAL_API_KEY=%s\n' "\$NEW_KEY" >> "\$f"
    fi
    echo "  ✓ \$f"
  else
    echo "  ✗ 없음: \$f"; exit 1
  fi
done
pm2 restart planq-prod-backend >/dev/null
pm2 restart planq-prod-qnote >/dev/null
sleep 4
OLD=\$(curl -s -o /dev/null -w '%{http_code}' -H "x-internal-api-key: planq-internal-dev-f76e0bffee43e39959f3dd7eb1cbb222" "http://localhost:3003/api/internal/qnote/can?business_id=5" || true)
NEW=\$(curl -s -o /dev/null -w '%{http_code}' -H "x-internal-api-key: \${NEW_KEY}" "http://localhost:3003/api/internal/qnote/can?business_id=5" || true)
echo "  유출된 옛 키 → \${OLD} (403 이어야 함)"
echo "  새 키        → \${NEW} (403 이 아니어야 함)"
[ "\$OLD" = "403" ] || { echo "  ✗ 옛 키가 아직 통한다"; exit 1; }
[ "\$NEW" != "403" ] || { echo "  ✗ 새 키가 안 통한다 — 두 .env 가 어긋났다"; exit 1; }
echo "✅ prod 회전 완료"
EOF
fi

echo
echo "새 키는 .env 에만 있다 — 이 값을 문서·커밋·채팅에 옮겨 적지 말 것."
echo "되돌리려면 같은 시각 스탬프의 .env.bak-${STAMP} 를 복원하고 두 프로세스를 재시작한다."
