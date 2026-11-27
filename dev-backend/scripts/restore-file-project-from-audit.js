#!/usr/bin/env node
// scripts/restore-file-project-from-audit.js — 공개 범위를 바꾸다 프로젝트 소속이 빠진 파일 되찾기 (2026-11-27)
//
// 왜: 2026-11-27 전 PUT /api/files/:biz/:id/visibility 는 L1/L3/L4·«특정 멤버» 로 바꿀 때마다 project_id 를 지웠다.
//     Irene «연결된 프로젝트는 그래도 끊기면 안되는데 끊겨 버리고». 지금 라우트는 소속을 유지한다(Fable 설계 A).
//     빠진 소속은 감사 로그(file.visibility_change old.project_id → new.project_id NULL)로만 안다.
//
// 대상: 그 파일의 **마지막** file.visibility_change 가 소속을 뗐고 · 지금도 project_id NULL · 파일·프로젝트가 살아 있다.
// 쓰기(--apply)는 **L1(나만 보기) 행만** — 보는 사람이 달라지지 않는다(올린 사람만 본다).
//   L2·L3·L4 는 소속을 되돌리면 그 프로젝트 고객·숨은 프로젝트 규칙이 달라진다 → 목록만 낸다(사람이 고른다).
//   폴더는 건드리지 않는다.
//
// 쓰는 법: node scripts/restore-file-project-from-audit.js [--business <id>]          (읽기만 · 기본)
//          node scripts/restore-file-project-from-audit.js [--business <id>] --apply  (L1 행만 소속 되찾기 + 감사 기록)
// 운영은 Irene 지시 뒤에만 --apply.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../config/database');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const bi = args.indexOf('--business');
const BIZ = bi >= 0 ? Number(args[bi + 1]) : null;

const js = (v) => { if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (_) { return null; } };

(async () => {
  const [logs] = await sequelize.query(
    `SELECT a.id, a.business_id, a.target_id, a.old_value, a.new_value, a.created_at
       FROM audit_logs a
       JOIN (SELECT target_id, MAX(id) AS mid FROM audit_logs
              WHERE action = 'file.visibility_change' AND target_type = 'file' GROUP BY target_id) last
         ON last.mid = a.id
      WHERE a.action = 'file.visibility_change' ${BIZ ? 'AND a.business_id = :biz' : ''}`,
    { replacements: { biz: BIZ } });
  const cands = [];
  for (const l of logs) {
    const o = js(l.old_value) || {}; const n = js(l.new_value) || {};
    if (!o.project_id || n.project_id) continue;
    cands.push({ fileId: Number(l.target_id), projectId: Number(o.project_id), businessId: Number(l.business_id), at: l.created_at });
  }
  const rows = [];
  for (const c of cands) {
    const [[f]] = await sequelize.query(
      'SELECT id, business_id, project_id, vlevel, visibility, file_name FROM files WHERE id = :id AND deleted_at IS NULL',
      { replacements: { id: c.fileId } });
    if (!f || f.project_id) continue;
    if (Number(f.business_id) !== c.businessId) continue;
    const [[p]] = await sequelize.query('SELECT id, name FROM projects WHERE id = :id AND business_id = :biz',
      { replacements: { id: c.projectId, biz: c.businessId } });
    if (!p) continue;
    rows.push({ ...c, level: f.vlevel || f.visibility, name: f.file_name, project: p.name });
  }
  const auto = rows.filter((r) => r.level === 'L1');
  const manual = rows.filter((r) => r.level !== 'L1');
  console.log(`대상 ${rows.length}건 — 자동(L1) ${auto.length} · 사람이 고를 것(L2·L3·L4) ${manual.length}`);
  for (const r of rows) console.log(`  ${r.level === 'L1' ? '자동' : '목록'}  file ${r.fileId} (${r.level}) «${r.name}» → 프로젝트 ${r.projectId} «${r.project}» · 뗀 때 ${new Date(r.at).toISOString()}`);
  if (!APPLY) { console.log('\n읽기만 했다. 쓰려면 --apply (L1 행만).'); process.exit(0); }
  let done = 0;
  for (const r of auto) {
    await sequelize.transaction(async (t) => {
      const [res] = await sequelize.query('UPDATE files SET project_id = :pid WHERE id = :id AND project_id IS NULL AND deleted_at IS NULL',
        { replacements: { pid: r.projectId, id: r.fileId }, transaction: t });
      if (!res || res.affectedRows !== 1) return;
      // 감사는 단일 쓰기 지점(보관 스탬프·마스킹)으로 — 직접 INSERT 하면 retain_until 이 빠진다(health retention).
      await require('../services/auditService').writeAudit({
        businessId: r.businessId, action: 'file.project_restore', targetType: 'file', targetId: r.fileId,
        oldValue: { project_id: null }, newValue: { project_id: r.projectId, via: 'restore-file-project-from-audit' },
      }, { transaction: t });
      done++;
    });
  }
  console.log(`\n되찾음 ${done}건 (L1). 목록 ${manual.length}건은 그대로.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
