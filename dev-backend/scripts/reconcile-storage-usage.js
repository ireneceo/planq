// 저장 사용량 집계를 **참값으로 맞춘다**.
//
// Irene 2026-09-20: *"스토리지 집계 29MB 차이 나는 거 고쳐."*
// 참값의 정의와 왜 벌어지는지는 `services/storageRecompute.js` 머리말에 있다.
//
// ★ 기본은 미리보기다. 쿼터에 직접 영향을 주는 값이라 «실행» 이 기본이면 안 된다.
// ★ 맞추는 것으로 끝나지 않는다 — `health-check` 에 같은 판정을 붙여 뒀다(retention 카테고리).
//   다시 벌어지면 배포 게이트에서 걸린다. 그때는 **어느 쓰기 경로가 감산을 빠뜨렸는지**를 찾아야 한다.
//
// 실행: node scripts/reconcile-storage-usage.js            (미리보기)
//       node scripts/reconcile-storage-usage.js --apply    (적용)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { drift, reconcile } = require('../services/storageRecompute');

const mb = (n) => (n === null ? '(집계행 없음)' : `${Math.round(n / 1048576)}MB`);
(async () => {
  const rows = await drift();
  const off = rows.filter((r) => r.counted === null || r.diff !== 0);
  console.log(`워크스페이스 ${rows.length}곳 · 어긋난 곳 ${off.length}곳`);
  off.forEach((r) => console.log(`  biz${r.business_id} 집계 ${mb(r.counted)} / 실제 ${mb(r.truth)} · 차이 ${r.diff === null ? '-' : (Math.round(r.diff / 1048576 * 100) / 100) + 'MB'} · 건수 ${r.countedFiles}→${r.truthFiles}`));
  if (off.length === 0) { console.log('맞출 것 없음'); process.exit(0); }
  if (!process.argv.includes('--apply')) { console.log('\n--dry-run (기본). 적용하려면 --apply'); process.exit(0); }
  const changed = await reconcile();
  const after = await drift();
  const still = after.filter((r) => r.counted === null || r.diff !== 0);
  console.log(`적용 ${changed.length}곳 — 남은 불일치 ${still.length}곳 (0 이어야 한다)`);
  process.exit(still.length ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
