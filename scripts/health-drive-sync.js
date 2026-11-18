#!/usr/bin/env node
// health-check `drivesync` 픽스처 — Drive(파인더) 지우기·고치기 반영 (docs/GDRIVE_FINDER_EDIT_SYNC_DESIGN.md §4.6)
//
//   사용: (cwd=/opt/planq/dev-backend) node /opt/planq/scripts/health-drive-sync.js
//   출력: 마지막 줄 '@@' + JSON { ok, detail } | { ok:false, error }
//
//   · 실 Drive 없이 **가짜 Changes** 를 services/gdriveApply 에 넣는다(연결 토큰이 없어도 돈다).
//   · 시험 워크스페이스(ws 6)에 `[health-drivesync]` 행을 만들고 끝에 행·바이트·원장·사용량을 되돌린다.
//   · 음성 대조군(지우면 안 되는 것이 안 지워짐) + 양성 대조군(가드를 무력화하면 판정이 뒤집힘)을 같이 잰다.
'use strict';

const BE = '/opt/planq/dev-backend';
process.chdir(BE);
require(`${BE}/node_modules/dotenv`).config({ path: `${BE}/.env`, quiet: true });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 알림 막기 — 픽스처가 시험 계정 알림함을 채우지 않게(속성 교체가 먹는다: gdriveMirrorSync 가 호출 때 꺼낸다)
const notifications = require(`${BE}/routes/notifications`);
notifications.notify = async () => ({ inbox: false, email: false, push: false });

const M = require(`${BE}/models`);
const { Op } = require(`${BE}/node_modules/sequelize`);
const ga = require(`${BE}/services/gdriveApply`);
const run = require(`${BE}/services/gdriveSyncRun`);

const BIZ = 6;
const stamp = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
const made = [];
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const fails = [];
const check = (name, cond) => { if (!cond) fails.push(name); return cond; };

async function makeFile(tag, content, extra = {}) {
  const biz = await M.Business.findByPk(BIZ, { attributes: ['owner_id'] });
  const dir = path.join(BE, 'uploads', String(BIZ), new Date().toISOString().slice(0, 7));
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, crypto.randomUUID());
  fs.writeFileSync(p, content);
  const f = await M.File.create({
    business_id: BIZ, uploader_id: biz.owner_id, file_name: `[health-drivesync] ${tag} ${stamp}.txt`, file_path: p,
    file_size: Buffer.byteLength(content), mime_type: 'text/plain', storage_provider: 'planq', content_hash: sha(content),
    ref_count: 1, visibility: 'L3', vlevel: 'L3', gdrive_mirror_id: `hds-${tag}-${stamp}`, drive_md5: md5(content), ...extra,
  });
  made.push(f.id);
  return f;
}
const trashed = (f, md) => [{ fileId: f.gdrive_mirror_id, file: { id: f.gdrive_mirror_id, name: f.file_name, trashed: true, explicitlyTrashed: true, md5Checksum: md } }];

(async () => {
  const usageRow = await M.BusinessStorageUsage.findOne({ where: { business_id: BIZ } });
  const usage0 = usageRow ? { bytes_used: usageRow.bytes_used, file_count: usageRow.file_count } : null;
  const detail = {};
  try {
    // 양성 — 직접 지움(md5 같음·산 행 1) → PlanQ 휴지통·deleted_via·purge_after
    const A = await makeFile('A', 'aaaa');
    await ga.applyChanges(BIZ, trashed(A, md5('aaaa')));
    await A.reload({ paranoid: false });
    detail.trash = check('직접 지움 → PlanQ 휴지통', !!A.deleted_at && A.deleted_via === 'gdrive' && !!A.purge_after);

    // 음성 — removed(접근 상실과 못 가름) → 산 채 미러 해제
    const B = await makeFile('B', 'bbbb');
    await ga.applyChanges(BIZ, [{ fileId: B.gdrive_mirror_id, removed: true }]);
    await B.reload({ paranoid: false });
    detail.removed = check('removed → 안 지움', !B.deleted_at && !B.gdrive_mirror_id);

    // 음성 — 폴더째 지움(explicitlyTrashed=false) → 보류
    const C = await makeFile('C', 'cccc');
    await ga.applyChanges(BIZ, [{ fileId: C.gdrive_mirror_id, file: { id: C.gdrive_mirror_id, trashed: true, explicitlyTrashed: false, md5Checksum: md5('cccc') } }]);
    await C.reload({ paranoid: false });
    detail.folder = check('폴더째 지움 → 보류', !C.deleted_at && C.drive_sync_issue === 'trash_held' && !!C.gdrive_mirror_id);

    // 음성 — 쌍둥이(같은 사본을 산 행 2개가 씀) → 둘 다 산다
    const D1 = await makeFile('D1', 'dddd');
    const D2 = await makeFile('D2', 'dddd', { gdrive_mirror_id: D1.gdrive_mirror_id });
    await ga.applyChanges(BIZ, trashed(D1, md5('dddd')));
    await D1.reload({ paranoid: false }); await D2.reload({ paranoid: false });
    detail.twins = check('쌍둥이 → 둘 다 산다', !D1.deleted_at && !D2.deleted_at);

    // 음성 — 고친 뒤 지움인데 고침을 못 받음(가짜 id 라 내려받기 실패) → 안 지움(Drive 유일본 보호)
    const E = await makeFile('E', 'eeee');
    const chE = trashed(E, 'ffffffffffffffffffffffffffffffff');
    await ga.applyChanges(BIZ, chE);
    await E.reload({ paranoid: false });
    const guarded = !E.deleted_at && String(E.drive_sync_issue || '').startsWith('edit_');
    // 양성 대조군 — 가드를 무력화(아는 md5 를 Drive 값으로 속임)하면 판정이 뒤집혀 지워진다
    await E.update({ drive_md5: 'ffffffffffffffffffffffffffffffff', drive_sync_issue: null });
    await ga.applyChanges(BIZ, chE);
    await E.reload({ paranoid: false });
    detail.editThenTrash = check('고친 뒤 지움: 가드 켬 안 지움 / 끔 지움', guarded && !!E.deleted_at);

    // 음성 — drive_md5 NULL 옛 미러 + 같은 md5(에코) → 무변화
    const F = await makeFile('F', 'ffff', { drive_md5: null });
    const fp = F.file_path;
    await ga.applyChanges(BIZ, [{ fileId: F.gdrive_mirror_id, file: { id: F.gdrive_mirror_id, name: F.file_name, trashed: false, md5Checksum: md5('ffff') } }]);
    await F.reload();
    const fv = await M.File.count({ where: { business_id: BIZ, deleted_via: 'gdrive_edit', file_name: { [Op.like]: `%F ${stamp}%` } }, paranoid: false });
    detail.echo = check('에코(NULL md5) → 무변화', F.file_path === fp && fv === 0 && F.drive_md5 === md5('ffff'));

    // 음성 — 같은 지움 동시 2회 → 쿼터 차감 1회
    const G = await makeFile('G', 'gggggggg');
    await M.BusinessStorageUsage.increment('bytes_used', { by: 8, where: { business_id: BIZ } });
    const u0 = Number((await M.BusinessStorageUsage.findOne({ where: { business_id: BIZ } })).bytes_used);
    await Promise.all([run._serialize(BIZ, () => ga.applyChanges(BIZ, trashed(G, md5('gggggggg')))), run._serialize(BIZ, () => ga.applyChanges(BIZ, trashed(G, md5('gggggggg'))))]);
    const u1 = Number((await M.BusinessStorageUsage.findOne({ where: { business_id: BIZ } })).bytes_used);
    detail.concurrent = check('동시 2회 → 차감 1회', u0 - u1 === 8);

    if (fails.length) throw new Error(`실패: ${fails.join(' · ')}`);
    console.log('@@' + JSON.stringify({ ok: true, detail }));
  } catch (e) {
    console.log('@@' + JSON.stringify({ ok: false, error: e.message, detail }));
  } finally {
    try {
      const rows = await M.File.findAll({ where: { [Op.or]: [{ id: made }, { business_id: BIZ, file_name: { [Op.like]: `%[health-drivesync]%${stamp}%` } }] }, paranoid: false });
      for (const r of rows) { try { if (r.file_path && fs.existsSync(r.file_path)) fs.unlinkSync(r.file_path); } catch { /* */ } }
      const ids = rows.map((r) => r.id);
      await M.GdriveSyncLog.destroy({ where: { business_id: BIZ, [Op.or]: [{ file_id: ids }, { gdrive_file_id: { [Op.like]: `hds-%-${stamp}` } }] } });
      await M.AuditLog.destroy({ where: { target_type: 'file', target_id: ids } }).catch(() => null);
      await M.File.destroy({ where: { id: ids }, force: true });
      if (usage0) await M.BusinessStorageUsage.update(usage0, { where: { business_id: BIZ } });
    } catch (e) { console.log('@@' + JSON.stringify({ ok: false, cleanup_error: e.message })); }
    process.exit(0);
  }
})();
