// 이용약관 개정 고지 메일 — 손으로 미리보기·재시도하는 문. 보통은 배포 단계(migrate-terms-handover.js)가 약관 버전을 올리며 자동으로 보낸다.
// 사용:  node scripts/send-terms-notice.js                      (미리보기 — 아무것도 안 보냄)
//        node scripts/send-terms-notice.js --send --confirm=<수>  (미리보기의 «보낼 사람» 수를 그대로 적어야 보낸다 — 끊긴 뒤 이어 보내기)
//        node scripts/send-terms-notice.js --only=a@x.com --send --confirm=1  (한 주소에만 — 시험용)
//        --version=1.3  (사업 목적 전용 개정 — migrate-terms-business-only.js 가 끊긴 뒤 이어 보내기. 없으면 1.2 인수인계)
require('dotenv').config();
const { sequelize } = require('../config/database');
const { collectTargets, sendAll } = require('../services/termsNotice');
const { HANDOVER_L1_EFFECTIVE_ON, HANDOVER_TERMS_VERSION } = require('../services/memberHandover');
const { BIZONLY_TERMS_VERSION, BIZONLY_EXISTING_EFFECTIVE_ON } = require('../config/termsBusinessOnly');

const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
(async () => {
  try {
    const only = (arg('only') || '').trim().toLowerCase() || null;
    const VERSIONS = { [HANDOVER_TERMS_VERSION]: HANDOVER_L1_EFFECTIVE_ON, [BIZONLY_TERMS_VERSION]: BIZONLY_EXISTING_EFFECTIVE_ON };
    const version = arg('version') || HANDOVER_TERMS_VERSION;
    const effectiveOn = VERSIONS[version];
    if (!effectiveOn) { console.error(`[terms-notice] 모르는 약관 버전 ${version} — ${Object.keys(VERSIONS).join(', ')} 중 하나`); process.exitCode = 1; return; }
    // 재동의 창이 실제로 뜨는가 = 운영 약관 버전이 이 버전 이상인가(1.2 전이라 1.3 을 못 올린 경로가 있다 — migrate-terms-business-only)
    const { PlatformSetting } = require('../models');
    const ps = await PlatformSetting.findOne();
    const cur = String(ps?.terms_version || '0').split('.').map(Number); const want = String(version).split('.').map(Number);
    const reaccept = (cur[0] || 0) > (want[0] || 0) || ((cur[0] || 0) === (want[0] || 0) && (cur[1] || 0) >= (want[1] || 0));
    const r = await collectTargets({ version, only });
    const byLang = r.targets.reduce((m, t) => { m[t.lang] = (m[t.lang] || 0) + 1; return m; }, {});
    console.log(`[terms-notice] 약관 ${version}(${effectiveOn} 시행 · 재동의 창 ${reaccept ? '뜸' : '안 뜸'}) · 활성 계정 ${r.users} · 이미 보냄 ${r.done} · 막힌 주소 ${r.blocked} · 보낼 사람 ${r.targets.length} (${JSON.stringify(byLang)})`);
    if (!process.argv.includes('--send')) { console.log(`[terms-notice] 미리보기만. 보내려면 --send --confirm=${r.targets.length}`); return; }
    if (Number(arg('confirm')) !== r.targets.length) { console.error('[terms-notice] --confirm 수가 보낼 사람 수와 다릅니다 — 보내지 않았습니다'); process.exitCode = 1; return; }
    const s = await sendAll({ version, effectiveOn, targets: r.targets, reaccept });
    console.log(`[terms-notice] 끝 — 성공 ${s.ok} · 실패/건너뜀 ${s.fail}`);
  } catch (e) { console.error('[terms-notice] 실패:', e.message); process.exitCode = 1; }
  finally { await sequelize.close().catch(() => {}); }
})().then(() => {
  // 메일 연결 풀이 열려 있으면 30초 더 산다(Fable 비차단 2) — 끝났으면 바로 나간다
  process.exit(process.exitCode || 0);
});
