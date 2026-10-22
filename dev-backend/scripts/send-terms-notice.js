// 이용약관 개정 고지 메일 — 손으로 미리보기·재시도하는 문. 보통은 배포 단계(migrate-terms-handover.js)가 약관 버전을 올리며 자동으로 보낸다.
// 사용:  node scripts/send-terms-notice.js                      (미리보기 — 아무것도 안 보냄)
//        node scripts/send-terms-notice.js --send --confirm=<수>  (미리보기의 «보낼 사람» 수를 그대로 적어야 보낸다 — 끊긴 뒤 이어 보내기)
//        node scripts/send-terms-notice.js --only=a@x.com --send --confirm=1  (한 주소에만 — 시험용)
require('dotenv').config();
const { sequelize } = require('../config/database');
const { collectTargets, sendAll } = require('../services/termsNotice');
const { HANDOVER_L1_EFFECTIVE_ON, HANDOVER_TERMS_VERSION } = require('../services/memberHandover');

const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
(async () => {
  try {
    const only = (arg('only') || '').trim().toLowerCase() || null;
    const r = await collectTargets({ version: HANDOVER_TERMS_VERSION, only });
    const byLang = r.targets.reduce((m, t) => { m[t.lang] = (m[t.lang] || 0) + 1; return m; }, {});
    console.log(`[terms-notice] 약관 ${HANDOVER_TERMS_VERSION}(${HANDOVER_L1_EFFECTIVE_ON} 시행) · 활성 계정 ${r.users} · 이미 보냄 ${r.done} · 막힌 주소 ${r.blocked} · 보낼 사람 ${r.targets.length} (${JSON.stringify(byLang)})`);
    if (!process.argv.includes('--send')) { console.log(`[terms-notice] 미리보기만. 보내려면 --send --confirm=${r.targets.length}`); return; }
    if (Number(arg('confirm')) !== r.targets.length) { console.error('[terms-notice] --confirm 수가 보낼 사람 수와 다릅니다 — 보내지 않았습니다'); process.exitCode = 1; return; }
    const s = await sendAll({ version: HANDOVER_TERMS_VERSION, effectiveOn: HANDOVER_L1_EFFECTIVE_ON, targets: r.targets });
    console.log(`[terms-notice] 끝 — 성공 ${s.ok} · 실패/건너뜀 ${s.fail}`);
  } catch (e) { console.error('[terms-notice] 실패:', e.message); process.exitCode = 1; }
  finally { await sequelize.close().catch(() => {}); }
})();
