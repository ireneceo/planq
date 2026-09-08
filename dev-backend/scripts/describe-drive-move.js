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
      // ★ 조상 탐색 실패가 **이미 얻은 이름을 버리면 안 된다** (2026-09-08 실측: 부모 사슬 끝이
      //   공유(팀) 드라이브 루트 `0A…` 라 files.get 이 404 → 21건 전부 "못 읽음" 으로 뭉갰다).
      //   루트는 files.get 으로 못 읽는다(drives.get 은 우리 scope 밖). 거기서 멈추고 표시만 한다.
      let name = null;
      try {
        const r = await drive.files.get({ fileId: id, fields: 'id,name,parents,driveId', supportsAllDrives: true });
        name = r.data.name;
        let pid = r.data.parents && r.data.parents[0];
        let depth = 0;
        while (pid && depth < 4) {
          if (/^0A/.test(pid)) { name = `[공유 드라이브]/${name}`; break; }
          try {
            const pr = await drive.files.get({ fileId: pid, fields: 'id,name,parents', supportsAllDrives: true });
            name = `${pr.data.name}/${name}`;
            pid = pr.data.parents && pr.data.parents[0];
          } catch { name = `…/${name}`; break; }   // 더 못 올라가면 거기까지만
          depth += 1;
        }
      } catch (e) { name = `(못 읽음: ${e.message.slice(0, 40)})`; }
      cache.set(id, name);
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
