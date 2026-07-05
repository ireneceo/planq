// scripts/backfill-gdrive-mirror.js
// 기존 로컬(planq) 저장 파일을 워크스페이스 연결 Google Drive 에 "사본"으로 미러(백필).
//   ★ storage_provider 는 planq 유지 — 서빙/다운로드/이미지/ZIP 무영향. Drive 는 가시성용 사본.
//   Fable 게이트 반영: 실측 프리플라이트 · 매니페스트 롤백 · 멱등 · content_hash dedup · L1 owner본인 · security general만 · 페이싱.
//
// 사용법:
//   node scripts/backfill-gdrive-mirror.js --business=1 --dry-run       # 대상만 집계
//   node scripts/backfill-gdrive-mirror.js --business=1                 # 실행(매니페스트 자동 저장)
//   node scripts/backfill-gdrive-mirror.js --rollback=<manifest.json>   # 롤백(Drive 삭제 + 컬럼 원복)
const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const { File, BusinessCloudToken } = require('../models');
const gdrive = require('../services/gdrive');
const mirror = require('../services/gdriveMirror');

const arg = (k, d) => { const a = process.argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const has = (k) => process.argv.includes(`--${k}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function rollback(manifestPath) {
  const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const token = await BusinessCloudToken.findOne({ where: { business_id: man.business_id, provider: 'gdrive' } });
  const drive = token ? await gdrive.getDriveClient(token) : null;
  let deleted = 0, restored = 0;
  const seenDrive = new Set();
  for (const e of man.entries) {
    // 컬럼 원복 (백필 전 값 = null 전제 기록됨)
    const f = await File.findByPk(e.file_id);
    if (f) { await f.update({ gdrive_mirror_id: e.before.gdrive_mirror_id, gdrive_mirror_url: e.before.gdrive_mirror_url, gdrive_mirrored_at: e.before.gdrive_mirrored_at }); restored++; }
    // Drive 사본 삭제 (uploaded 건만, dedup reuse 는 원본 1개만 삭제)
    if (drive && e.uploaded && e.mirror_id && !seenDrive.has(e.mirror_id)) {
      seenDrive.add(e.mirror_id);
      try { await gdrive.deleteFile(drive, e.mirror_id); deleted++; } catch (err) { console.warn('  drive delete fail', e.mirror_id, err.message); }
      await sleep(200);
    }
  }
  console.log(`롤백 완료 — 컬럼 원복 ${restored} · Drive 삭제 ${deleted}`);
  process.exit(0);
}

async function main() {
  if (has('rollback') || arg('rollback')) return rollback(arg('rollback'));
  const businessId = Number(arg('business'));
  const dryRun = has('dry-run');
  const limit = arg('limit') ? Number(arg('limit')) : null;
  if (!businessId) { console.error('--business=<id> 필수'); process.exit(1); }

  const token = await BusinessCloudToken.findOne({ where: { business_id: businessId, provider: 'gdrive' } });
  if (!token || !token.root_folder_id) { console.error('gdrive 연동/root_folder 없음 — 백필 대상 아님'); process.exit(1); }

  // 대상 후보: 로컬 저장 · 미미러 · 미삭제
  const candidates = await File.findAll({
    where: { business_id: businessId, storage_provider: 'planq', gdrive_mirror_id: null, deleted_at: null },
    order: [['id', 'ASC']],
  });
  // 적격 필터 (isEligible: security general + L1은 owner본인)
  const eligible = candidates.filter(f => mirror.isEligible(f, token));

  // ── 프리플라이트 실측 (Fable 요건) ──
  const byVis = {}; const bySec = {};
  for (const f of candidates) { const v = (f.vlevel || f.visibility || 'L3'); byVis[v] = (byVis[v] || 0) + 1; bySec[f.security_level || 'general'] = (bySec[f.security_level || 'general'] || 0) + 1; }
  const l1total = candidates.filter(f => (f.vlevel || f.visibility) === 'L1').length;
  const l1owner = candidates.filter(f => (f.vlevel || f.visibility) === 'L1' && String(f.uploader_id) === String(token.connected_by)).length;
  const hashGroups = new Set(candidates.filter(f => f.content_hash).map(f => f.content_hash)).size;
  console.log(`[프리플라이트] biz#${businessId} 연결계정=${token.account_email} connected_by=${token.connected_by}`);
  console.log(`  로컬 미미러 후보 ${candidates.length} · 적격 ${eligible.length} (제외 ${candidates.length - eligible.length})`);
  console.log(`  visibility 분포: ${JSON.stringify(byVis)} · security: ${JSON.stringify(bySec)}`);
  console.log(`  L1 개인 ${l1total}건 중 owner본인 ${l1owner}건만 대상 (타 멤버 ${l1total - l1owner}건 제외)`);
  console.log(`  content_hash 그룹 ${hashGroups} (중복 dedup 회피)`);
  if (dryRun) { console.log('[dry-run] 실제 업로드 안 함'); process.exit(0); }

  const targets = limit ? eligible.slice(0, limit) : eligible;
  const drive = await gdrive.getDriveClient(token);
  const byHash = new Map();
  const manifest = { business_id: businessId, started_at: new Date().toISOString(), entries: [] };
  let uploaded = 0, reused = 0, failed = 0, consecFail = 0;

  for (const file of targets) {
    if (file.gdrive_mirror_id) continue;
    const before = { gdrive_mirror_id: file.gdrive_mirror_id, gdrive_mirror_url: file.gdrive_mirror_url, gdrive_mirrored_at: file.gdrive_mirrored_at };
    try {
      const hash = file.content_hash;
      if (hash && byHash.has(hash)) {
        const m = byHash.get(hash);
        await file.update({ gdrive_mirror_id: m.id, gdrive_mirror_url: m.url, gdrive_mirrored_at: new Date() });
        manifest.entries.push({ file_id: file.id, before, uploaded: false, reused: true, mirror_id: m.id });
        reused++; consecFail = 0;
        continue;
      }
      const driveId = await mirror.mirrorFile(file, token, drive); // 컬럼 세팅 포함
      const fresh = await File.findByPk(file.id);
      if (hash) byHash.set(hash, { id: fresh.gdrive_mirror_id, url: fresh.gdrive_mirror_url });
      manifest.entries.push({ file_id: file.id, before, uploaded: true, reused: false, mirror_id: fresh.gdrive_mirror_id, mirror_url: fresh.gdrive_mirror_url });
      uploaded++; consecFail = 0;
      console.log(`  ✔ #${file.id} ${String(file.file_name).slice(0, 30)} → ${driveId}`);
      await sleep(350);
    } catch (e) {
      failed++; consecFail++;
      manifest.entries.push({ file_id: file.id, before, uploaded: false, error: e.message });
      console.warn(`  ✘ #${file.id} ${e.message}`);
      if (/invalid_grant|invalid_token|unauthorized/i.test(e.message) || consecFail >= 3) {
        console.error('  중단 — 토큰 문제/연속 실패. 매니페스트 저장 후 종료.'); break;
      }
      await sleep(500);
    }
  }

  manifest.finished_at = new Date().toISOString();
  manifest.summary = { uploaded, reused, failed, total: targets.length };
  const manPath = path.join(__dirname, `../backups/gdrive-mirror-manifest-biz${businessId}.json`);
  try { fs.mkdirSync(path.dirname(manPath), { recursive: true }); } catch { /* */ }
  fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2));
  console.log(`\n완료 — 업로드 ${uploaded} · 재사용(dedup) ${reused} · 실패 ${failed}`);
  console.log(`매니페스트: ${manPath} (롤백: node scripts/backfill-gdrive-mirror.js --rollback=${manPath})`);
  process.exit(failed > 0 && uploaded === 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
