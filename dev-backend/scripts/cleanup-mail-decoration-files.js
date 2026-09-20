// 메일 본문 장식 이미지(서명·로고·아이콘)를 Q file 에서 **치운다**.
//
// Irene 2026-09-20: *"잘못 쌓인 건 지워야지."*
//
// 무엇이 «잘못 쌓인 것» 인가 — 메일에서 들어온 파일 중 **이미지이면서**
//   ① Content-Disposition 이 inline 이거나(is_inline)
//   ② 20KB 미만인 것
// 운영 실측(2026-09-20): 메일에서 온 903건 중 **478건**이 여기 해당하고, 그 실제 용량은
// **0.12MB** 다(같은 이미지가 219번 들어와도 중복제거로 물리 파일은 1개다). 남는 425건이
// 진짜 첨부이고 100MB 의 거의 전부다. 즉 **디스크를 줄이려는 작업이 아니라** 원장을 정리하는 작업이다.
//
// ★ 되돌릴 수 있게 한다 — soft delete(`deleted_at`)만 하고 물리 파일은 건드리지 않는다.
//   실행 전에 복원용 JSON 을 남긴다. 되돌리려면 그 파일의 id 들을 `deleted_at=NULL` 로 되돌리고
//   `email_attachments.file_id` 를 다시 채우면 된다.
// ★ 첨부 칩이 **죽은 버튼**으로 남지 않게 한다 — file_id 를 NULL 로 만들면 화면이 비활성으로
//   그린다. 그대로 두면 눌러도 404 가 나는 버튼이 된다(사용자에게는 고장이다).
// ★ 기본은 --dry-run 이다. 지우는 스크립트의 기본값이 «실행» 이면 언젠가 사고가 난다.
//
// 실행: node scripts/cleanup-mail-decoration-files.js            (미리보기)
//       node scripts/cleanup-mail-decoration-files.js --apply    (실제 적용)
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require('../config/database');

const SMALL_IMAGE_MAX = 20 * 1024;
const APPLY = process.argv.includes('--apply');

const WHERE = `
  FROM email_attachments ea
  JOIN files f ON f.id = ea.file_id
 WHERE f.deleted_at IS NULL
   AND f.storage_provider = 'planq'
   AND f.mime_type LIKE 'image/%'
   AND (ea.is_inline = 1 OR f.file_size < :maxSize)`;

(async () => {
  const [rows] = await sequelize.query(
    `SELECT DISTINCT f.id, f.business_id, f.file_name, f.file_size ${WHERE} ORDER BY f.id`,
    { replacements: { maxSize: SMALL_IMAGE_MAX } },
  );
  if (rows.length === 0) { console.log('대상 0건 — 할 일 없음'); process.exit(0); }
  const bytes = rows.reduce((n, r) => n + Number(r.file_size || 0), 0);
  const byBiz = rows.reduce((m, r) => { m[r.business_id] = (m[r.business_id] || 0) + 1; return m; }, {});
  console.log(`대상 ${rows.length}건 · ${(bytes / 1048576).toFixed(2)}MB · 워크스페이스별 ${JSON.stringify(byBiz)}`);
  console.log('예시:', rows.slice(0, 5).map((r) => `${r.file_name}(${Math.round(r.file_size / 1024)}KB)`).join(' · '));

  const [atts] = await sequelize.query(
    `SELECT DISTINCT ea.id AS att_id, ea.file_id ${WHERE}`,
    { replacements: { maxSize: SMALL_IMAGE_MAX } },
  );
  console.log(`딸린 첨부 행 ${atts.length}건 (file_id 를 비워 죽은 버튼이 안 남게 한다)`);

  if (!APPLY) { console.log('\n--dry-run (기본). 실제로 적용하려면 --apply'); process.exit(0); }

  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const dir = path.join(__dirname, '..', '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `mail-decoration-cleanup-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify({ at: new Date().toISOString(), files: rows, attachments: atts }, null, 2));
  console.log('복원용 기록:', backup);

  const t = await sequelize.transaction();
  try {
    const ids = rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      await sequelize.query('UPDATE files SET deleted_at = NOW() WHERE id IN (:ids) AND deleted_at IS NULL',
        { replacements: { ids: chunk }, transaction: t });
      await sequelize.query('UPDATE email_attachments SET file_id = NULL WHERE file_id IN (:ids)',
        { replacements: { ids: chunk }, transaction: t });
    }
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }

  const [left] = await sequelize.query(`SELECT COUNT(DISTINCT f.id) n ${WHERE}`, { replacements: { maxSize: SMALL_IMAGE_MAX } });
  console.log(`적용 완료 — 남은 대상 ${left[0].n}건 (0 이어야 한다)`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
