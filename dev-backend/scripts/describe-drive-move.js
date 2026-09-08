// 이관 dry-run 로그의 폴더 id → 이름/경로. 읽기만 한다.
require('dotenv').config();
const fs = require('fs');
const { BusinessCloudToken } = require('../models');
const gdrive = require('../services/gdrive');
const { sequelize } = require('../config/database');
(async () => {
  const logPath = process.argv[2];
  const log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
  const moves = log.moves || [];
  const bizIds = [...new Set(moves.map((m) => m.business_id))];
  const cache = new Map();
  for (const biz of bizIds) {
    const token = await BusinessCloudToken.findOne({ where: { business_id: biz, provider: 'gdrive' } });
    if (!token) continue;
    const drive = await gdrive.getDriveClient(token);
    const ids = [...new Set(moves.filter((m) => m.business_id === biz).flatMap((m) => [...String(m.from || '').split(',').filter(Boolean), m.to]))];
    for (const id of ids) {
      if (cache.has(id)) continue;
      try {
        const r = await drive.files.get({ fileId: id, fields: 'id,name,parents', supportsAllDrives: true });
        let name = r.data.name; let p = r.data.parents && r.data.parents[0]; let depth = 0;
        while (p && depth < 3) {
          const pr = await drive.files.get({ fileId: p, fields: 'id,name,parents', supportsAllDrives: true });
          name = `${pr.data.name}/${name}`; p = pr.data.parents && pr.data.parents[0]; depth += 1;
        }
        cache.set(id, name);
      } catch (e) { cache.set(id, `(못 읽음: ${e.message.slice(0, 40)})`); }
    }
  }
  const grouped = new Map();
  for (const m of moves) {
    const key = `${cache.get(String(m.from).split(',')[0]) || m.from}  →  ${cache.get(m.to) || m.to}`;
    grouped.set(key, (grouped.get(key) || []).concat(m.name));
  }
  console.log(`옮길 파일 ${moves.length}건 · 경로 조합 ${grouped.size}가지\n`);
  for (const [k, names] of grouped) {
    console.log(`■ ${k}   (${names.length}건)`);
    names.slice(0, 6).forEach((n) => console.log(`    · ${n}`));
    if (names.length > 6) console.log(`    · 외 ${names.length - 6}건`);
    console.log('');
  }
  await sequelize.close().catch(() => {});
})().catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => { setTimeout(() => process.exit(0), 50); });
