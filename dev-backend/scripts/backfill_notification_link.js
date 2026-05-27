// N+74-D — notifications.link 절대 URL → path 정규화 백필.
// 옛 notify 호출자가 'https://planq.kr/talk?conv=3' 같이 저장한 link 를
// path 형식 '/talk?conv=3' 으로 변환. frontend navigate() 호환.
//
// idempotent: 이미 path 형식이면 skip.
//
// 실행:
//   node scripts/backfill_notification_link.js

require('dotenv').config();
const { sequelize } = require('../config/database');
const { normalizeLink, buildLink } = require('../services/notification_link');

async function main() {
  const { Notification } = require('../models');
  const rows = await Notification.findAll({
    where: { link: { [require('sequelize').Op.ne]: null } },
    attributes: ['id', 'link', 'entity_type', 'entity_id', 'event_kind'],
  });
  console.log(`Total rows with link: ${rows.length}`);
  let normalized = 0, builtFromEntity = 0, skipped = 0, unchanged = 0;
  for (const r of rows) {
    const fromLink = normalizeLink(r.link);
    if (fromLink && fromLink !== r.link) {
      await r.update({ link: fromLink });
      normalized += 1;
    } else if (fromLink === r.link) {
      unchanged += 1;
    } else {
      // 정규화 실패 — entity_type+entity_id 매핑으로 재생성 시도
      const built = buildLink({ entity_type: r.entity_type, entity_id: r.entity_id, event_kind: r.event_kind });
      if (built && built !== '/' && built !== r.link) {
        await r.update({ link: built });
        builtFromEntity += 1;
      } else {
        skipped += 1;
      }
    }
  }
  console.log(JSON.stringify({ normalized, builtFromEntity, skipped, unchanged }, null, 2));
  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
