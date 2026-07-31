#!/usr/bin/env node
/**
 * actual_hours 재산정 백필 — status 경과시간 누적 폐기에 따른 1회성 정정
 * (Fable 설계 게이트 2026-07-31. 근거는 services/taskActualHours.js 상단 주석 참조.)
 *
 * 하는 일: actual_source='auto' 인 업무의 actual_hours 를 **포커스 세션 실측 합**으로 맞춘다.
 *          포커스 세션이 없으면 0 (status 경과시간에서 유래한 허구값 제거).
 *
 * 안전장치
 *   - dry-run 이 기본. 쓰기는 `--apply` 를 명시해야만 한다.
 *   - `actual_source='user'` 는 **쿼리 레벨에서 제외** — 읽지도 않는다.
 *   - `--apply` 시 변경 대상의 원본을 backups/actual-hours-backfill-{ts}.json 에 먼저 기록한다.
 *   - `--restore <file>` 로 되돌릴 수 있다.
 *   - 멱등: target 이 포커스 세션에서 파생되므로 재실행 시 변경 0건이어야 한다(검증 항목).
 *
 * 사용
 *   node scripts/backfill-actual-hours-drop-status-fallback.js              # dry-run
 *   node scripts/backfill-actual-hours-drop-status-fallback.js --apply
 *   node scripts/backfill-actual-hours-drop-status-fallback.js --restore backups/actual-hours-backfill-1234.json
 *
 * ★ 코드 배포가 먼저다. 옛 훅이 살아 있는 상태에서 백필하면 곧바로 재오염된다.
 */
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/database');
const { Task, FocusSession } = require('../models');

const APPLY = process.argv.includes('--apply');
const RESTORE_IDX = process.argv.indexOf('--restore');
const RESTORE_FILE = RESTORE_IDX >= 0 ? process.argv[RESTORE_IDX + 1] : null;
const EPS = 0.05;  // 0.1h 단위 반올림 잡음 무시

function focusHours(sessions) {
  const sec = sessions.reduce((s, r) => s + (typeof r.computeActualSeconds === 'function' ? r.computeActualSeconds() : 0), 0);
  return Math.round((sec / 3600) * 10) / 10;
}

async function restore(file) {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`복원 — ${file} (${rows.length}건)`);
  let n = 0;
  for (const r of rows) {
    const t = await Task.findByPk(r.id);
    if (!t) { console.log(`  skip task ${r.id} (없음)`); continue; }
    await t.update({ actual_hours: r.actual_hours, actual_source: r.actual_source });
    n++;
    console.log(`  task ${r.id} ← ${r.actual_hours}h / ${r.actual_source}`);
  }
  console.log(`복원 완료 ${n}건`);
}

(async () => {
  if (RESTORE_FILE) { await restore(RESTORE_FILE); await sequelize.close(); return; }

  const tasks = await Task.findAll({
    where: { actual_source: 'auto' },
    attributes: ['id', 'status', 'actual_hours', 'actual_source'],
    order: [['id', 'ASC']],
  });
  const allFocus = await FocusSession.findAll();
  const byTask = new Map();
  for (const f of allFocus) {
    if (!f.task_id) continue;
    if (!byTask.has(f.task_id)) byTask.set(f.task_id, []);
    byTask.get(f.task_id).push(f);
  }

  const changes = [];
  for (const t of tasks) {
    const stored = Number(t.actual_hours) || 0;
    const target = focusHours(byTask.get(t.id) || []);
    if (Math.abs(stored - target) >= EPS) changes.push({ id: t.id, status: t.status, stored, target, actual_source: t.actual_source, actual_hours: t.actual_hours });
  }

  console.log(`대상(actual_source='auto') ${tasks.length}건 · 변경 필요 ${changes.length}건${APPLY ? '' : '  [dry-run — 쓰기 없음]'}`);
  for (const c of changes) console.log(`  task ${c.id} (${c.status}): ${c.stored}h -> ${c.target}h`);

  if (APPLY && changes.length) {
    const dir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `actual-hours-backfill-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(changes.map((c) => ({ id: c.id, actual_hours: c.actual_hours, actual_source: c.actual_source })), null, 1));
    console.log(`백업 기록: ${file}`);
    for (const c of changes) {
      await Task.update({ actual_hours: c.target, actual_source: 'auto' }, { where: { id: c.id } });
    }
    console.log(`적용 완료 ${changes.length}건 — 재실행 시 변경 0건이어야 한다(멱등 확인).`);
  }

  const [left] = await sequelize.query("SELECT COUNT(*) n FROM tasks WHERE actual_source='auto' AND actual_hours > 24");
  console.log(`참고 — auto 이면서 24h 초과로 남은 업무: ${left[0].n}건`);
  await sequelize.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
