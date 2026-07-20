#!/bin/bash
# apply-app-identifiers.sh — Apple Team ID / Android 서명 지문을 코드에 치환.
#   조직 개발자 등록 승인 후, Membership 의 Team ID + Play Console(또는 keytool) SHA-256 을 받으면 실행.
#
# 사용법:
#   ./scripts/apply-app-identifiers.sh --team-id ABCDE12345 [--android-cert AA:BB:CC:...]
#
#   --team-id      Apple Developer Membership 페이지의 Team ID (10자 영숫자). AASA 2곳 치환.
#   --android-cert Play Console 앱 서명 키 SHA-256 지문(콜론 구분). assetlinks 치환. (안드로이드 출시 시)
#
# 치환 후: 프론트 빌드 → guard-native-release --release 로 placeholder 잔존 0 확인 → /배포.
set -euo pipefail

TEAM_ID=""
ANDROID_CERT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --team-id) TEAM_ID="$2"; shift 2 ;;
    --android-cert) ANDROID_CERT="$2"; shift 2 ;;
    *) echo "알 수 없는 옵션: $1"; exit 1 ;;
  esac
done

ROOT="/opt/planq/dev-frontend"
AASA="$ROOT/public/.well-known/apple-app-site-association"
LINKS="$ROOT/public/.well-known/assetlinks.json"

if [ -z "$TEAM_ID" ] && [ -z "$ANDROID_CERT" ]; then
  echo "치환할 값이 없습니다. --team-id 또는 --android-cert 를 주세요."; exit 1
fi

if [ -n "$TEAM_ID" ]; then
  if ! echo "$TEAM_ID" | grep -qE '^[A-Z0-9]{10}$'; then
    echo "⚠ Team ID 형식이 이상합니다(10자 영숫자 기대): $TEAM_ID"; exit 1
  fi
  sed -i "s/__APPLE_TEAM_ID__/$TEAM_ID/g" "$AASA"
  echo "✓ Apple Team ID 치환: $TEAM_ID (AASA)"
fi

if [ -n "$ANDROID_CERT" ]; then
  # sed 구분자 충돌 방지 위해 | 사용 (지문에 : 포함)
  sed -i "s|__ANDROID_SHA256_CERT__|$ANDROID_CERT|g" "$LINKS"
  echo "✓ Android SHA-256 치환 (assetlinks)"
fi

echo ""
echo "=== JSON 유효성 확인 ==="
python3 -c "import json; json.load(open('$AASA')); print('AASA OK')"
python3 -c "import json; json.load(open('$LINKS')); print('assetlinks OK')"
echo ""
echo "=== placeholder 잔존 확인 ==="
if grep -q "__APPLE_TEAM_ID__\|__ANDROID_SHA256_CERT__" "$AASA" "$LINKS"; then
  echo "⚠ 아직 남은 placeholder 있음:"
  grep -n "__APPLE_TEAM_ID__\|__ANDROID_SHA256_CERT__" "$AASA" "$LINKS"
else
  echo "✓ placeholder 없음 (Team ID 만 받았으면 Android 지문은 별도 실행)"
fi
echo ""
echo "다음: cd dev-frontend && npm run build → node scripts/guard-native-release.js → /배포"
