// 기존 Drive 파일을 **새 폴더 규칙**으로 정리한다 (2026-09-07).
//
// Irene: "기존 파일도 제대로 구조에 맞춰줘."
//
// 왜 필요한가 — 폴더 자리를 정하는 기준이 세 곳에서 갈라져 있었다:
//   업로드는 프로젝트만, 이동은 'Workspace Files' 만, 미러만 제대로 봤다.
//   그래서 같은 프로젝트 파일이 `프로젝트A/파일` 에도 `Workspace Files/내폴더/파일` 에도 있다.
//   지금 규칙은 하나다: `프로젝트 폴더(또는 Conversations/Workspace Files) / PlanQ 폴더 사슬 /`
//   이 스크립트는 **이미 올라간 파일**을 그 규칙에 맞춘다.
//
// 안전 규칙
//   · 기본은 **dry-run** — 무엇을 옮길지만 보여준다. 실제 이동은 `--apply` 를 줘야 한다.
//   · 옮긴 목록을 파일로 남긴다(`--log`), 되돌릴 수 있게 원래 부모 id 를 같이 적는다.
//   · Drive 사본이 있는 파일만 대상(`gdrive_mirror_id` 또는 storage=gdrive+external_id).
//   · 이미 맞는 자리에 있으면 건드리지 않는다(멱등).
//   · 한 건 실패가 전체를 멈추지 않는다 — 실패는 세어서 끝에 보고한다.
//
// 사용:
//   node scripts/migrate-drive-folder-tree.js --business=3            # dry-run
//   node scripts/migrate-drive-folder-tree.js --business=3 --apply    # 실제 이동
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/database');
const { File, BusinessCloudToken } = require('../models');
const gdrive = require('../services/gdrive');
const mirror = require('../services/gdriveMirror');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const bizArg = (args.find((a) => a.startsWith('--business=')) || '').split('=')[1];
const logArg = (args.find((a) => a.startsWith('--log=')) || '').split('=')[1];

(async () => {
  const where = { provider: 'gdrive' };
  if (bizArg) where.business_id = Number(bizArg);
  const tokens = await BusinessCloudToken.findAll({ where });
  if (!tokens.length) { console.log('gdrive 연동이 없습니다.'); process.exit(0); }

  const moves = [];
  let checked = 0, already = 0, failed = 0, skipped = 0;

  for (const token of tokens) {
    if (!token.root_folder_id) { console.log(`biz ${token.business_id}: 루트 폴더 없음 — 건너뜀`); continue; }
    const drive = await gdrive.getDriveClient(token);

    const files = await File.findAll({
      where: { business_id: token.business_id, deleted_at: null },
      attributes: ['id', 'file_name', 'project_id', 'folder_id', 'gdrive_mirror_id', 'storage_provider', 'external_id'],
    });

    for (const f of files) {
      // Drive 에 실물이 있는 것만 — 사본(mirror) 또는 원격 참조(storage=gdrive)
      const driveId = f.gdrive_mirror_id || (f.storage_provider === 'gdrive' ? f.external_id : null);
      if (!driveId) { skipped += 1; continue; }
      checked += 1;

      let want;
      try {
        // ★ 앱이 쓰는 것과 **같은 함수**로 목표 자리를 구한다. 여기서 따로 계산하면
        //   정리 결과가 앱의 규칙과 또 갈라진다.
        want = await mirror.resolveDriveParent(drive, token, {
          projectId: f.project_id, folderId: f.folder_id,
        });
      } catch (e) {
        failed += 1;
        console.warn(`  ✗ ${f.file_name} — 목표 폴더 계산 실패: ${e.message}`);
        continue;
      }

      let curParents = [];
      try {
        const meta = await drive.files.get({ fileId: driveId, fields: 'parents', supportsAllDrives: true });
        curParents = meta.data.parents || [];
      } catch (e) {
        failed += 1;
        console.warn(`  ✗ ${f.file_name} — Drive 조회 실패: ${e.message}`);
        continue;
      }

      if (curParents.length === 1 && curParents[0] === want) { already += 1; continue; }

      moves.push({
        file_id: f.id, name: f.file_name, drive_id: driveId,
        from: curParents.join(','), to: want,
        business_id: token.business_id, project_id: f.project_id, folder_id: f.folder_id,
      });

      if (APPLY) {
        try {
          await drive.files.update({
            fileId: driveId, addParents: want,
            ...(curParents.length ? { removeParents: curParents.join(',') } : {}),
            fields: 'id', supportsAllDrives: true,
          });
        } catch (e) {
          failed += 1;
          moves[moves.length - 1].error = String(e.message).slice(0, 160);
          console.warn(`  ✗ ${f.file_name} — 이동 실패: ${e.message}`);
        }
      }
    }
  }

  // 저장소를 더럽히지 않게 기본 경로는 /tmp — 되돌릴 때 필요하니 경로를 꼭 찍어 준다.
  const logPath = logArg || `/tmp/planq-drive-tree-${APPLY ? 'applied' : 'dryrun'}-${Date.now()}.json`;
  fs.writeFileSync(logPath, JSON.stringify({ apply: APPLY, at: new Date().toISOString(), moves }, null, 2));

  console.log('');
  console.log(`${APPLY ? '이동 완료' : 'DRY-RUN (실제로 옮기지 않았습니다)'}`);
  console.log(`  Drive 사본 있는 파일 ${checked}건 (사본 없어 건너뜀 ${skipped})`);
  console.log(`  이미 맞는 자리 ${already}건`);
  console.log(`  ${APPLY ? '옮긴' : '옮길'} 파일 ${moves.length}건 · 실패 ${failed}건`);
  console.log(`  목록: ${logPath}`);
  if (!APPLY && moves.length) {
    console.log('');
    console.log('  앞 10건:');
    for (const m of moves.slice(0, 10)) console.log(`    · ${m.name}  ${m.from} → ${m.to}`);
    console.log('');
    console.log('  실제로 옮기려면 같은 명령에 --apply 를 붙이세요.');
  }
  await sequelize.close();
  process.exit(0);
})();
