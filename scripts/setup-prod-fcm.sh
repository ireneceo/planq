#!/usr/bin/env bash
# 운영서버 FCM 설정 — 안드로이드 푸시 알림 활성화 (2026-09-04)
#
# 왜 손으로 실행하는가: `.env` 는 배포 rsync 의 제외 대상이라 배포로 따라가지 않는다.
#   키 파일(secrets/)은 제외 대상이 아니라 다음 배포 때 자동으로 따라가지만,
#   지금 당장 알림을 켜려면 먼저 넣어야 한다.
# 멱등하다 — 여러 번 실행해도 줄이 중복되지 않는다.
set -euo pipefail

PROD=irene@87.106.78.146
SRC=/opt/planq/dev-backend/secrets/fcm-service-account.json
DEST=/opt/planq/backend/secrets/fcm-service-account.json

echo "▶ 1/4  키 파일 전송"
[ -f "$SRC" ] || { echo "✗ 개발서버에 키가 없습니다: $SRC"; exit 1; }
scp -q "$SRC" "$PROD:/tmp/fcm-sa.json"

echo "▶ 2/4  운영에 배치 + .env 설정"
ssh "$PROD" 'set -euo pipefail
  mkdir -p /opt/planq/backend/secrets && chmod 700 /opt/planq/backend/secrets
  mv /tmp/fcm-sa.json /opt/planq/backend/secrets/fcm-service-account.json
  chmod 600 /opt/planq/backend/secrets/fcm-service-account.json
  cp /opt/planq/backend/.env /opt/planq/backend/.env.bak.$(date +%Y%m%d_%H%M%S)
  if grep -q "^FCM_SERVICE_ACCOUNT_PATH=" /opt/planq/backend/.env; then
    sed -i "s|^FCM_PROJECT_ID=.*|FCM_PROJECT_ID=planq-48cf7|" /opt/planq/backend/.env
    sed -i "s|^FCM_SERVICE_ACCOUNT_PATH=.*|FCM_SERVICE_ACCOUNT_PATH=/opt/planq/backend/secrets/fcm-service-account.json|" /opt/planq/backend/.env
  else
    printf "\n# FCM (Android 푸시) — 2026-09-04\nFCM_PROJECT_ID=planq-48cf7\nFCM_SERVICE_ACCOUNT_PATH=/opt/planq/backend/secrets/fcm-service-account.json\n" >> /opt/planq/backend/.env
  fi
  grep -n "^FCM_" /opt/planq/backend/.env'

echo "▶ 3/4  백엔드 재시작"
ssh "$PROD" 'pm2 restart planq-prod-backend --update-env >/dev/null 2>&1; sleep 4; pm2 describe planq-prod-backend | grep -E "status|uptime" | head -2'

echo "▶ 4/4  검증 — 설정 인식 + 구글 실제 인증"
ssh "$PROD" 'cd /opt/planq/backend && node -e "
require(\"dotenv\").config();
const f=require(\"./services/fcm_sender\");
console.log(\"isFcmConfigured():\", f.isFcmConfigured());
if(!f.isFcmConfigured()) process.exit(1);
f.sendFcm(\"invalid_token_for_path_check_0000\",{title:\"경로점검\",body:\"무시\"})
 .then(r=>{console.log(\"발송 경로:\", JSON.stringify(r));
   console.log(r.status===404?\"OK — 인증 통과(기기 토큰만 없음)\":\"확인 필요\");})
 .catch(e=>{console.log(\"예외:\",e.message);process.exit(1);});
" 2>&1 | grep -v "injected env"'

echo
echo "✅ 운영 FCM 설정 완료"
