// 이용약관 개정(사업 목적 전용 · App Store 3.1.1 B안) — 배포 때 약관 버전 1.3(재동의) + 공지 띠 + 활성 회원 고지 메일 1통.
//   Irene 2026-11-16 «권고대로»(= 고지 메일 보냄). 같은 틀: scripts/migrate-terms-handover.js(1.2).
//   시행: 기존 이용자 EXISTING_EFFECTIVE_ON · 새 워크스페이스 NEW_EFFECTIVE_ON (legal.json terms.s1·s2 와 같은 날짜).
//
//   ★ 약관 제13조 «중요 변경 30일 전 공지» — 기존 이용자 시행일이 오늘(한국)+30일보다 이르면 **아무것도 바꾸지 않고** 경고만.
//     그때는 시행일을 옮긴다(config/termsBusinessOnly.js · legal.json ko/en terms.s1·s2 · emailService TERMS_NOTICE itemsByVersion['1.3']).
//   ★ 1.2(인수인계) 단계가 먼저 돈다(deploy-planq.sh 순서). 그래도 아직 1.2 전이면 **버전은 올리지 않고** 고지 메일·공지 띠만 낸다 —
//     1.3 으로 올리면 «1.2 이상» 으로 켜지는 인수인계 기능이 그 조항 고지 없이 켜진다(memberHandover versionGte). 고지 의무(제13조)는 메일로 채운다.
//     이때 메일은 «동의 창이 뜹니다» 대신 «동의하지 않으면 시행일 전까지 중단할 수 있습니다» 로 나간다(reaccept:false).
//     ★ 그 뒤 11-23 전 배포에서 1.2 가 올라가 있으면 이 단계가 1.3 으로 올린다 — «창 안 뜸» 메일을 받은 사람에게도 창이 뜬다(메일은 다시 안 감, 해롭지 않은 쪽).
//       11-23 을 넘기면 30일 가드가 막아 매 배포 warn — 시행일을 옮기거나 관리자 화면에서 버전을 손으로.
//   ★ 30일 가드에 걸리면 exit 1 — 배포 스크립트의 warn 으로 배포 요약에 드러난다(조용히 지나가지 않게).
//   ★ 멱등 — 이미 1.3 이상이면 손대지 않는다. 메일은 이미 보낸 주소를 건너뛴다(termsNotice). 배포를 막지 않는다(exit 0).
//
// 사용: node scripts/migrate-terms-business-only.js            (적용)
//       node scripts/migrate-terms-business-only.js --dry-run  (무엇을 바꿀지·몇 명에게 보낼지만)
require('dotenv').config();
const { sequelize } = require('../config/database');
const { PlatformSetting } = require('../models');

const {
  BIZONLY_TERMS_VERSION: TERMS_VERSION, BIZONLY_EXISTING_EFFECTIVE_ON: EXISTING_EFFECTIVE_ON, BIZONLY_NEW_EFFECTIVE_ON: NEW_EFFECTIVE_ON,
} = require('../config/termsBusinessOnly');
const DRY = process.argv.includes('--dry-run');
const NOTICE_KO = `이용약관이 바뀝니다 — PlanQ 는 사업자·조직의 업무용 서비스로, 업무 목적으로만 제공됩니다(기존 이용자 ${EXISTING_EFFECTIVE_ON} · 새 워크스페이스 ${NEW_EFFECTIVE_ON} 시행).`;
const NOTICE_EN = `Our Terms are changing — PlanQ is a work service for businesses and organizations, provided only for business purposes (effective ${EXISTING_EFFECTIVE_ON} for existing users, ${NEW_EFFECTIVE_ON} for new workspaces).`;

function versionLt(a, b) {
  const pa = String(a || '0').split('.').map(Number); const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0; const y = pb[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
function addDays(ymd, n) { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function joinNotice(cur, add) {
  if (!cur || !cur.trim()) return add;
  if (cur.includes(add)) return cur;
  const joined = `${cur.trim()} · ${add}`;
  return joined.length <= 500 ? joined : null;   // 넘치면 덮지 않는다
}

(async () => {
  try {
    const ps = await PlatformSetting.findOne();
    if (!ps) { console.log('[terms-bizonly] platform_settings 행 없음 — 건너뜀'); return; }
    const today = kstToday();
    const latestOk = addDays(today, 30);
    console.log(`[terms-bizonly] 현재 약관 버전 ${ps.terms_version} · 기존 이용자 시행 ${EXISTING_EFFECTIVE_ON} · 오늘(한국) ${today} · 30일 뒤 ${latestOk}`);
    if (!versionLt(ps.terms_version, TERMS_VERSION)) { console.log(`[terms-bizonly] 이미 ${ps.terms_version} — 할 일 없음`); return; }
    const bumpVersion = !versionLt(ps.terms_version, '1.2');
    if (!bumpVersion) console.warn('[terms-bizonly] ⚠️ 아직 1.2(인수인계) 전 — 약관 버전(재동의)은 그대로 두고 고지 메일·공지 띠만 낸다');
    if (EXISTING_EFFECTIVE_ON < latestOk) {
      process.exitCode = 1;
      console.warn(`[terms-bizonly] ⚠️ 기존 이용자 시행일 ${EXISTING_EFFECTIVE_ON} 이 30일 공지 기간(${latestOk})보다 이르다 — 바꾸지 않음. 시행일을 옮긴 뒤 다시 배포하세요(config/termsBusinessOnly.js·legal.json terms.s1·s2·emailService itemsByVersion).`);
      return;
    }
    // 1.2 공지 띠가 남아 있어도 이어 붙인다(500자 안). 넘치면 띠는 그대로 두고 경고.
    const ko = joinNotice(ps.announcement_text, NOTICE_KO);
    const en = joinNotice(ps.announcement_text_en, NOTICE_EN);
    const patch = bumpVersion ? { terms_version: TERMS_VERSION } : {};
    if (ko) patch.announcement_text = ko;
    if (en) patch.announcement_text_en = en;
    if (ko && !ps.announcement_text) { patch.announcement_dismissible = true; patch.announcement_severity = 'info'; }
    if (!ko || !en) console.warn('[terms-bizonly] ⚠️ 기존 공지가 길어 약관 공지를 붙이지 못함 — 관리자 화면에서 공지 띠를 확인하세요');
    console.log(`[terms-bizonly] ${DRY ? '(미리보기) ' : ''}바꿀 것: ${JSON.stringify(patch)}`);
    const { collectTargets, sendAll } = require('../services/termsNotice');
    const r = await collectTargets({ version: TERMS_VERSION });
    console.log(`[terms-bizonly] 고지 메일 ${DRY ? '(미리보기) ' : ''}보낼 사람 ${r.targets.length} · 이미 보냄 ${r.done} · 막힌 주소 ${r.blocked}`);
    if (!DRY) {
      if (Object.keys(patch).length) await ps.update(patch);
      console.log(`[terms-bizonly] ✅ ${bumpVersion ? '약관 버전·공지 띠 반영 — 다음 로그인부터 재동의 창' : '공지 띠만 반영(버전 그대로)'}`);
      const s = await sendAll({ version: TERMS_VERSION, effectiveOn: EXISTING_EFFECTIVE_ON, targets: r.targets, reaccept: bumpVersion });
      console.log(`[terms-bizonly] 고지 메일 성공 ${s.ok} · 실패/건너뜀 ${s.fail} (실패분은 scripts/send-terms-notice.js --version=1.3 로 이어 보내기)`);
    }
  } catch (e) {
    console.error('[terms-bizonly] 실패(배포는 계속):', e.message);
  } finally {
    await sequelize.close().catch(() => {});
  }
})().then(() => { process.exit(process.exitCode || 0); });
