#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  게스트 링크 스위치 (운영 #259)
#
#  사용법 — 개발서버(87.106.11.184)에 접속한 상태에서:
#
#     ./scripts/guest-killswitch.sh on      켠다 (고객이 링크로 들어올 수 있게)
#     ./scripts/guest-killswitch.sh off     끈다 (기존 링크까지 즉시 전부 닫힘)
#     ./scripts/guest-killswitch.sh status  지금 상태만 본다
#
#  즉시 반영된다. 재배포·재시작 필요 없다.
#  런북: docs/GUEST_LINK_DESIGN.md §11.2.1
# ─────────────────────────────────────────────────────────────
set -euo pipefail

PROD="irene@87.106.78.146"
ACTION="${1:-status}"

case "$ACTION" in
  on)   VALUE=1; LABEL="켜기" ;;
  off)  VALUE=0; LABEL="끄기" ;;
  status) VALUE=""; LABEL="상태 확인" ;;
  *) echo "사용법: $0 [on|off|status]"; exit 1 ;;
esac

echo "게스트 링크 스위치 — $LABEL (운영서버)"
echo

ssh "$PROD" "cd /opt/planq/backend && VALUE='$VALUE' node -e \"
const m = require('./models');
(async () => {
  const v = process.env.VALUE;
  if (v === '1' || v === '0') {
    await m.sequelize.query('UPDATE platform_settings SET guest_links_enabled = ' + v);
  }
  const rows = await m.PlatformSetting.findAll({ attributes: ['id', 'guest_links_enabled'] });
  const on = rows.length > 0 && rows[0].guest_links_enabled === true;
  console.log('현재 상태 :', on ? '켜짐 — 고객이 링크로 들어올 수 있습니다' : '꺼짐 — 모든 게스트 링크가 닫혀 있습니다');
  console.log('발급된 링크 :', await m.GuestLink.count(), '개');
  const off = await m.Business.count({ where: { guest_links_enabled: false } });
  if (off > 0) console.log('참고 : 워크스페이스 ' + off + '곳은 개별적으로 꺼져 있습니다');
  process.exit(0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
\"" 2>/dev/null | grep -v "injected env\|MySQL connected"
