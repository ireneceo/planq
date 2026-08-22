// #370·#372 — 쌓인 플랫폼 로고 File 정리 + 스토리지 카운터 재계산.
//
// 배경: 우리 알림메일의 인라인 로고가 첨부로 수집돼 **매번 물리 파일 + File row** 로 저장됐다.
//   운영 실측 2026-08-22: planq-logo.png 524건 / 20.5MB — 전체 files 의 52%.
//   원인은 코드에서 막았고(수집 차단 #371 + 저장 게이트 #370), 이 스크립트는 **이미 쌓인 것**을 치운다.
//
// 안전장치
//   · 기본은 미리보기. --apply 를 줘야 실제로 지운다.
//   · soft delete (deleted_at) 만 한다. 물리 파일은 --purge 를 따로 줘야 지운다 —
//     되돌릴 수 없는 일은 한 번 더 확인하고 하게.
//   · 판정은 **세 조건을 모두** 만족할 때만: 이름이 planq-logo.png · image/* · 메일첨부 경로(/email/).
//     하나라도 어긋나면 건드리지 않는다(사용자가 올린 동명 파일 오삭제 방지).
//   · 카운터는 이 스크립트가 **차감하지 않는다.** 애초에 반영된 적이 없어서 빼면 더 틀어진다(#372).
//     대신 --recount 로 전 워크스페이스를 실제 파일에서 다시 센다.
//
// 사용:
//   node scripts/cleanup-logo-files.js                  # 미리보기
//   node scripts/cleanup-logo-files.js --apply          # soft delete
//   node scripts/cleanup-logo-files.js --apply --purge  # 물리 파일까지 제거
//   node scripts/cleanup-logo-files.js --recount        # 카운터 재계산만 (--apply 와 함께 써도 됨)
require('dotenv').config();
const fs = require('fs');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { File, BusinessStorageUsage, EmailAttachment } = require('../models');

const APPLY = process.argv.includes('--apply');
const PURGE = process.argv.includes('--purge');
const RECOUNT = process.argv.includes('--recount');

async function findLogoFiles() {
  return File.findAll({
    where: {
      deleted_at: null,
      storage_provider: 'planq',
      file_name: 'planq-logo.png',
      mime_type: { [Op.like]: 'image/%' },
      file_path: { [Op.like]: '%/email/%' },
    },
    attributes: ['id', 'business_id', 'file_path', 'file_size'],
  });
}

async function recountAll() {
  // 실제 파일에서 다시 센다 — 카운터를 "고치는" 유일하게 믿을 수 있는 방법이다.
  const [rows] = await sequelize.query(
    "SELECT business_id, COUNT(*) n, COALESCE(SUM(file_size),0) b FROM files " +
    "WHERE deleted_at IS NULL AND storage_provider = 'planq' GROUP BY business_id"
  );
  console.log('\n[카운터 재계산]');
  for (const r of rows) {
    const bizId = Number(r.business_id);
    const realCount = Number(r.n);
    const realBytes = Number(r.b);
    const cur = await BusinessStorageUsage.findOne({ where: { business_id: bizId } });
    const oldCount = cur ? Number(cur.file_count) : 0;
    const oldBytes = cur ? Number(cur.bytes_used) : 0;
    console.log(`  biz ${bizId}: ${oldCount}건/${oldBytes}B → ${realCount}건/${realBytes}B`
      + (oldCount === realCount && oldBytes === realBytes ? '  (일치)' : '  ★ 불일치'));
    if (APPLY || RECOUNT) {
      if (cur) {
        await cur.update({ file_count: realCount, bytes_used: realBytes });
      } else {
        await BusinessStorageUsage.create({
          business_id: bizId, file_count: realCount, bytes_used: realBytes, storage_provider: 'planq',
        });
      }
    }
  }
  if (!(APPLY || RECOUNT)) console.log('  (미리보기 — 반영하려면 --apply 또는 --recount)');
}

(async () => {
  const logos = await findLogoFiles();
  const byBiz = new Map();
  let bytes = 0;
  for (const f of logos) {
    byBiz.set(f.business_id, (byBiz.get(f.business_id) || 0) + 1);
    bytes += Number(f.file_size || 0);
  }
  console.log(`[로고 File] ${logos.length}건 / ${bytes.toLocaleString()} B`);
  for (const [biz, n] of byBiz) console.log(`  biz ${biz}: ${n}건`);

  if (APPLY && logos.length) {
    const ids = logos.map(f => f.id);
    // 메일 첨부 행은 남긴다(첨부가 있었다는 사실 자체는 이력이다). file_id 만 끊는다 —
    //   안 끊으면 화면이 지워진 File 을 열려다 404 를 만든다.
    await EmailAttachment.update({ file_id: null }, { where: { file_id: ids } });
    await File.update({ deleted_at: new Date() }, { where: { id: ids } });
    console.log(`→ soft delete ${ids.length}건 · 메일첨부 연결 해제`);

    if (PURGE) {
      let removed = 0;
      for (const f of logos) {
        try { if (f.file_path && fs.existsSync(f.file_path)) { fs.unlinkSync(f.file_path); removed += 1; } }
        catch (e) { console.warn('  물리 삭제 실패', f.id, e.message); }
      }
      console.log(`→ 물리 파일 ${removed}건 제거`);
    } else {
      console.log('   (물리 파일은 그대로 — 제거하려면 --purge)');
    }
  } else if (logos.length) {
    console.log('→ 미리보기 (지우려면 --apply)');
  }

  await recountAll();
  process.exit(0);
})();
