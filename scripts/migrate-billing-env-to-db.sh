#!/usr/bin/env bash
# 운영서버에서 한 번 실행 — .env 의 PortOne · 은행계좌 → platform_settings DB 시드
# 그 후 .env 의 해당 키 제거 (DB 가 source of truth).
#
# 실행: ssh irene@87.106.78.146 'bash /opt/planq/scripts/migrate-billing-env-to-db.sh'
#
# 멱등: 이미 시드된 값은 덮어쓰지 않음 (현재 DB 값 우선). null 인 컬럼만 .env 에서 가져옴.
# .env 에 없는 키는 skip.

set -e

ENV_FILE="/opt/planq/backend/.env"
DB_PW_FILE="/opt/planq/.db-password"
DB_NAME="planq_prod_db"
DB_USER="planq_admin"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found"
  exit 1
fi
if [ ! -f "$DB_PW_FILE" ]; then
  echo "ERROR: $DB_PW_FILE not found"
  exit 1
fi
DB_PW=$(cat "$DB_PW_FILE")

echo "=== 1. .env 에서 결제 키 추출 ==="
get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }

BANK_NAME=$(get_env PLANQ_BILLING_BANK_NAME)
BANK_ACCOUNT=$(get_env PLANQ_BILLING_BANK_ACCOUNT)
BANK_HOLDER=$(get_env PLANQ_BILLING_BANK_HOLDER)
PORTONE_STORE=$(get_env PORTONE_STORE_ID)
PORTONE_CK=$(get_env PORTONE_CHANNEL_KEY)
PORTONE_CKB=$(get_env PORTONE_CHANNEL_KEY_BILLING)
PORTONE_WS=$(get_env PORTONE_WEBHOOK_SECRET)

found=0
for v in "$BANK_NAME" "$BANK_ACCOUNT" "$BANK_HOLDER" "$PORTONE_STORE" "$PORTONE_CK" "$PORTONE_CKB" "$PORTONE_WS"; do
  if [ -n "$v" ]; then found=$((found + 1)); fi
done
echo "  .env 에서 발견한 키: $found 개"

if [ "$found" -eq 0 ]; then
  echo "  → .env 에 결제 관련 키 없음. 스킵."
  exit 0
fi

echo
echo "=== 2. DB 의 platform_settings 현재값 조회 ==="
mysql -u "$DB_USER" -p"$DB_PW" "$DB_NAME" -e \
  "SELECT id, bank_name, bank_account_number, bank_account_holder, portone_store_id, portone_channel_key IS NOT NULL AS has_ck, portone_channel_key_billing IS NOT NULL AS has_ckb, portone_webhook_secret IS NOT NULL AS has_ws FROM platform_settings;" 2>/dev/null

echo
echo "=== 3. UPDATE — 현재 NULL 인 컬럼만 .env 값으로 채움 ==="
SQL=""
[ -n "$BANK_NAME" ]    && SQL+="bank_name = COALESCE(bank_name, '$BANK_NAME'), "
[ -n "$BANK_ACCOUNT" ] && SQL+="bank_account_number = COALESCE(bank_account_number, '$BANK_ACCOUNT'), "
[ -n "$BANK_HOLDER" ]  && SQL+="bank_account_holder = COALESCE(bank_account_holder, '$BANK_HOLDER'), "
[ -n "$PORTONE_STORE" ] && SQL+="portone_store_id = COALESCE(portone_store_id, '$PORTONE_STORE'), "
[ -n "$PORTONE_CK" ]   && SQL+="portone_channel_key = COALESCE(portone_channel_key, '$PORTONE_CK'), "
[ -n "$PORTONE_CKB" ]  && SQL+="portone_channel_key_billing = COALESCE(portone_channel_key_billing, '$PORTONE_CKB'), "
[ -n "$PORTONE_WS" ]   && SQL+="portone_webhook_secret = COALESCE(portone_webhook_secret, '$PORTONE_WS'), "

if [ -z "$SQL" ]; then
  echo "  → 채울 값 없음. 스킵."
  exit 0
fi
SQL="${SQL%, }"  # 마지막 쉼표 제거

# id=1 row 가 없으면 INSERT, 있으면 UPDATE (멱등)
mysql -u "$DB_USER" -p"$DB_PW" "$DB_NAME" <<SQL_EOF 2>&1 | tail -10
INSERT INTO platform_settings (id, brand, created_at, updated_at) VALUES (1, 'PlanQ', NOW(), NOW())
ON DUPLICATE KEY UPDATE updated_at = updated_at;
UPDATE platform_settings SET $SQL, updated_at = NOW() WHERE id = (SELECT MIN(id) FROM (SELECT id FROM platform_settings) t);
SELECT id, bank_name, bank_account_holder, portone_store_id IS NOT NULL AS has_store, portone_channel_key IS NOT NULL AS has_ck FROM platform_settings;
SQL_EOF

echo
echo "=== 4. .env 에서 결제 키 제거 (백업 후) ==="
cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d_%H%M%S)"
sed -i '/^PLANQ_BILLING_BANK_NAME=/d; /^PLANQ_BILLING_BANK_ACCOUNT=/d; /^PLANQ_BILLING_BANK_HOLDER=/d; /^PORTONE_STORE_ID=/d; /^PORTONE_CHANNEL_KEY=/d; /^PORTONE_CHANNEL_KEY_BILLING=/d; /^PORTONE_WEBHOOK_SECRET=/d' "$ENV_FILE"
echo "  .env 백업: ${ENV_FILE}.bak.*"
echo "  남은 결제 키:"
grep -E '^(PLANQ_BILLING|PORTONE_)' "$ENV_FILE" || echo "    (없음 — 정상)"

echo
echo "=== 5. backend reload — 변경된 .env + DB 적용 ==="
pm2 reload planq-prod-backend 2>&1 | tail -3

echo
echo "=== 완료 ==="
echo "관리자 페이지에서 확인: https://planq.kr/admin/billing-settings"
