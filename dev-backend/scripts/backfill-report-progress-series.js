/**
 * backfill-report-progress-series — 확정 보고서에 빠진 진척 그래프 데이터를 채운다 (#145).
 *
 * 배경: 보고서 IA 개편 때 진척(번업) 그래프가 있던 화면이 통째로 안 쓰이게 되면서 그래프가 사라졌다.
 *      화면은 커밋 d62d159 로 복원했지만, **그 전에 확정(confirmed)된 보고서**는 스냅샷이 박제라
 *      `progress_series` 필드 자체가 없다 → 프론트 가드(`progress_series?.length > 0`)에 걸려
 *      그래프 섹션이 통째로 안 뜬다. (운영 확정본 60건 전부 해당)
 *
 * 안전 규칙 — 확정본은 박제다. **없는 필드만 채우고, 기존 숫자는 한 글자도 건드리지 않는다.**
 *   - 이미 progress_series 가 있으면 건너뛴다 (멱등 — 몇 번 돌려도 같다)
 *   - auto_snapshot 의 다른 키는 그대로 두고 progress_series 만 추가
 *   - 시리즈는 TaskDailyProgress(그 기간의 일별 기록)에서 다시 계산한다. 그 원장은 append-only 라
 *     지금 계산해도 그때와 같은 값이 나온다 — 새 사실을 지어내는 게 아니라 빠진 것을 복원하는 것.
 *
 * 사용: node scripts/backfill-report-progress-series.js           # 미리보기
 *       node scripts/backfill-report-progress-series.js --apply   # 실제 반영
 */
const { sequelize } = require('../config/database');
const { ReportUnit } = require('../models');
const { buildAutoSnapshot } = require('../services/reportUnitSnapshot');

async function main() {
  const apply = process.argv.includes('--apply');

  const units = await ReportUnit.findAll({ order: [['id', 'ASC']] });
  let filled = 0, skipped = 0, empty = 0, failed = 0;

  for (const u of units) {
    const snap = u.auto_snapshot || {};
    if (Array.isArray(snap.progress_series) && snap.progress_series.length > 0) { skipped++; continue; }

    let fresh;
    try {
      fresh = await buildAutoSnapshot(u.business_id, u.scope, u.scope_ref_id, u.period_type, u.period_start);
    } catch (e) {
      failed++;
      console.error(`  ! unit ${u.id} (${u.scope}/${u.period_type}) 재계산 실패: ${e.message}`);
      continue;
    }

    const series = fresh?.progress_series;
    if (!Array.isArray(series) || series.length === 0) { empty++; continue; }   // 그 기간에 일별 기록이 없던 보고서

    filled++;
    console.log(`  unit ${u.id} [${u.status}] ${u.scope}/${u.period_type} ${String(u.period_start).slice(0, 10)} → 진척 ${series.length}일치`);
    if (apply) {
      // 다른 키는 그대로. progress_series 만 얹는다.
      await u.update({ auto_snapshot: { ...snap, progress_series: series } });
    }
  }

  console.log(`\n총 ${units.length}건 — 채움 ${filled} / 이미 있음 ${skipped} / 일별기록 없음 ${empty} / 실패 ${failed}`);
  if (!apply && filled > 0) console.log('(미리보기 — 반영하려면 --apply)');
}

main()
  .then(() => sequelize.close())
  .then(() => process.exit(0))
  .catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
