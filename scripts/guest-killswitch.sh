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
    await m.GuestLink.sequelize.query('UPDATE platform_settings SET guest_links_enabled = ' + v);
  }
  const rows = await m.PlatformSetting.findAll({ attributes: ['id', 'guest_links_enabled'] });
  const on = rows.length > 0 && rows[0].guest_links_enabled === true;
  console.log('현재 상태 :', on ? '켜짐 — 고객이 링크로 들어올 수 있습니다' : '꺼짐 — 모든 게스트 링크가 닫혀 있습니다');
  console.log('발급된 링크 :', await m.GuestLink.count(), '개');
  const off = await m.Business.count({ where: { guest_links_enabled: false } });
  if (off > 0) console.log('참고 : 워크스페이스 ' + off + '곳은 개별적으로 꺼져 있습니다');

  // ── 워크스페이스별 토글을 만들 시점인가 (Fable 설계 판정 2026-09-02) ──────────
  //   지금은 플랫폼 스위치 하나뿐이다. 사고 단위가 링크 하나라 단건 회수로 충분하고,
  //   켜고 끌 사람이 곧 플랫폼 스위치를 쥔 사람이라 워크스페이스 토글은 사용자 0명이다.
  //   그 전제가 깨지는 순간을 여기서 보이게 한다 — 관측 없는 트리거는 트리거가 아니다.
  const [r1] = await m.GuestLink.sequelize.query(
    'SELECT COUNT(*) AS n FROM guest_links gl JOIN businesses b ON b.id=gl.business_id JOIN users u ON u.id=b.owner_id WHERE u.platform_role<>?',
    { replacements: ['platform_admin'] });
  const [r2] = await m.GuestLink.sequelize.query(
    'SELECT COUNT(DISTINCT business_id) AS n FROM guest_links WHERE revoked_at IS NULL AND expires_at>NOW()');
  const n1 = Number(r1[0].n), n2 = Number(r2[0].n);
  console.log('');
  console.log('워크스페이스별 스위치 :', (n1 >= 1 || n2 >= 2) ? '지금 만들 때 — 아래 조건이 충족됐다' : '아직 필요 없다');
  console.log('  · 플랫폼관리자가 아닌 사람의 워크스페이스 링크 :', n1, '건 (1건 이상이면 만든다)');
  console.log('  · 살아있는 링크를 가진 워크스페이스 :', n2, '곳 (2곳 이상이면 만든다)');
  process.exit(0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
\"" 2>&1 | grep -v "injected env\|MySQL connected"
# stderr 를 버리지 않는다 — 조용히 실패하면 "상태를 못 읽은 것" 이 "정상" 으로 보인다.
# 파이프가 종료코드를 가리므로 ssh 쪽 코드를 그대로 넘긴다.
exit "${PIPESTATUS[0]}"
