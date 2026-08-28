// Drive → PlanQ 역방향 동기화 종단 카나리 (#379)
//   ★ 실제 Google Drive 에 파일을 만들고 **진짜로 이름을 바꾸고 지워서** PlanQ 에 반영되는지 본다.
//     모의 change 객체로 치면 Changes API 가 필드를 안 주는 종류의 사고를 못 잡는다 —
//     실제로 그 사고가 있었다(listChanges 가 name 만 요청해 이름변경 외 감지가 불가능했다).
//   전제: dev 에 gdrive 연동이 살아 있어야 한다. 없으면 **통과가 아니라 판정 불가로 실패**시킨다.
const path = require('path');
const { Readable } = require('stream');
const BE = '/opt/planq/dev-backend';
// ★ 이 카나리는 HTTP 가 아니라 **모델을 직접** 쓴다(Drive API 호출이 필요해서).
//   저장소 루트에서 실행하면 루트 .env 를 읽어 DB 변수가 비어 있다 → dev-backend 의 .env 를 명시 로드.
require(path.join(BE, 'node_modules/dotenv')).config({ path: path.join(BE, '.env') });

async function run() {
  const rows = [];
  const push = (name, ok, msg) => rows.push({ name, ok, msg });
  const { BusinessCloudToken, File, GdriveSyncLog } = require(path.join(BE, 'models'));
  const gdrive = require(path.join(BE, 'services/gdrive'));
  const gdriveApply = require(path.join(BE, 'services/gdriveApply'));
  let drive = null, driveFileId = null, localId = null;
  try {
    const token = await BusinessCloudToken.findOne({ where: { provider: 'gdrive' } });
    if (!token) { push('connection', false, '🔴 dev 에 gdrive 연동 없음 — 판정 불가(통과로 치지 않는다)'); return rows; }
    drive = await gdrive.getDriveClient(token);
    const BIZ = token.business_id;

    const created = await gdrive.uploadFile(drive, {
      name: 'planq-canary-before.txt', mimeType: 'text/plain',
      body: Readable.from([Buffer.from('canary')]), parentId: token.workspace_folder_id || undefined,
    });
    driveFileId = created.id;
    const st = await drive.changes.getStartPageToken();
    await token.update({ watch_page_token: st.data.startPageToken });

    // ★ file_path 는 NOT NULL 이다. Drive 정본 파일은 로컬 경로가 없으므로 `gdrive:<id>` 규약.
    //   v2 인제스트도 같은 규약을 따라야 한다 — 로컬 파일로 오해해 여는 코드가 있으면 안 된다.
    const local = await File.create({
      business_id: BIZ, uploader_id: 5, file_name: 'planq-canary-before.txt',
      file_path: `gdrive:${driveFileId}`, file_size: 6, mime_type: 'text/plain',
      storage_provider: 'gdrive', external_id: driveFileId, external_url: created.webViewLink || null,
      visibility: 'L3', vlevel: 'L3',
    });
    localId = local.id;

    await gdrive.renameFile(drive, driveFileId, 'planq-canary-AFTER.txt');
    await new Promise((r) => setTimeout(r, 3000));
    const data = await gdrive.listChanges(drive, token.watch_page_token);
    const changes = data.changes || [];
    const mine = changes.filter((c) => c.fileId === driveFileId);
    push('changes-detected', mine.length > 0, `Changes ${changes.length}건 · 이 파일 ${mine.length}건`);
    if (mine.length) {
      const f = mine[0].file || {};
      push('fields-present', !!f.name && Array.isArray(f.parents),
        `name=${f.name} parents=${(f.parents || []).length}개 md5=${f.md5Checksum ? '有' : '無'}`);
    }
    const sum = await gdriveApply.applyChanges(BIZ, changes);
    await local.reload();
    push('rename-applied', local.file_name === 'planq-canary-AFTER.txt',
      `file_name=${local.file_name} · ${JSON.stringify(sum.byAction)}`);

    const again = await gdriveApply.applyChanges(BIZ, changes);
    push('echo-absorbed', again.applied === 0, JSON.stringify(again.byAction));

    await gdrive.deleteFile(drive, driveFileId);
    driveFileId = null;
    await new Promise((r) => setTimeout(r, 3000));
    const d2 = await gdrive.listChanges(drive, token.watch_page_token);
    await gdriveApply.applyChanges(BIZ, d2.changes || []);
    await local.reload();
    push('trash-soft-deleted', !!local.deleted_at, `deleted_at=${local.deleted_at ? '설정됨' : 'null'}`);

    const logs = await GdriveSyncLog.count({ where: { business_id: BIZ, file_id: localId } });
    push('sync-log', logs >= 2, `${logs}건`);
  } catch (e) {
    push('error', false, 'ERROR: ' + String(e.message).slice(0, 160));
  } finally {
    try { if (driveFileId && drive) await gdrive.deleteFile(drive, driveFileId); } catch { /* noop */ }
    try { if (localId) await File.destroy({ where: { id: localId }, force: true }); } catch { /* noop */ }
  }
  return rows;
}

// 러너 계약 — r.fail(숫자)을 안 주면 **게이트에서 영원히 통과**한다(2026-08-28 실측 사고).
function toRunnerShape(list) {
  return list.map((r) => ({ name: r.name, fail: r.ok ? 0 : 1, details: [r.msg], hasCanary: true }));
}
module.exports = { run: async () => toRunnerShape(await run()), name: 'gdrive-sync' };

if (require.main === module) {
  run().then((res) => {
    let fail = 0;
    console.log('\n=== Drive → PlanQ 역방향 동기화 ===');
    for (const r of res) { console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(20)} ${r.msg}`); if (!r.ok) fail++; }
    console.log(`\n검사 ${res.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
