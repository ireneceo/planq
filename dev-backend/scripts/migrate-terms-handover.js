// 이용약관 개정(퇴사 시 업무 인수인계, 제10조) — 배포 때 공지 띠 + 약관 버전 1.2 를 한 번에 올린다.
//   docs/ORG_STAGE0_DESIGN.md 9절 4 · Irene 2026-10-22 «너가 해»(관리자 화면 손작업을 배포 단계로 옮김).
//
//   ★ 약관 제13조 «중요 변경은 30일 전 공지» — 시행일(services/memberHandover HANDOVER_L1_EFFECTIVE_ON)이
//     오늘(한국 날짜) + 30일보다 이르면 **아무것도 바꾸지 않고** 경고만 낸다. 그 경우 시행일을 옮긴 뒤 다시 배포한다
//     (memberHandover.js · legal.json terms.s10 두 곳). 버전이 안 오르면 «나만 보기» 업무 넘기기도 켜지지 않는다(안전한 쪽).
//   ★ 멱등 — 이미 1.2 이상이면 손대지 않는다. 공지 띠는 비어 있을 때만 쓴다(다른 공지가 있으면 덮지 않고 이어 붙이되 500자 안에서만).
//   ★ 배포를 막지 않는다 — 경고여도 exit 0(코드 동작은 버전을 보고 스스로 꺼져 있다).
//
// 사용: node scripts/migrate-terms-handover.js            (적용)
//       node scripts/migrate-terms-handover.js --dry-run  (무엇을 바꿀지만 출력)
require('dotenv').config();
const { sequelize } = require('../config/database');
const { PlatformSetting } = require('../models');
const { HANDOVER_L1_EFFECTIVE_ON, HANDOVER_TERMS_VERSION } = require('../services/memberHandover');

const DRY = process.argv.includes('--dry-run');
const NOTICE_KO = `이용약관이 바뀝니다(${HANDOVER_L1_EFFECTIVE_ON} 시행) — 워크스페이스에서 제외되면 끝나지 않은 업무는 대표가 지정한 인수자에게 넘어갈 수 있습니다.`;
const NOTICE_EN = `Our Terms are changing (effective ${HANDOVER_L1_EFFECTIVE_ON}) — if you are removed from a workspace, your unfinished tasks may be handed over to a successor chosen by the owner.`;

function versionLt(a, b) {
  const pa = String(a || '0').split('.').map(Number); const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0; const y = pb[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}
function kstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function joinNotice(cur, add) {
  if (!cur || !cur.trim()) return add;
  if (cur.includes(add)) return cur;
  const joined = `${cur.trim()} · ${add}`;
  return joined.length <= 500 ? joined : null;   // 넘치면 덮지 않는다
}

(async () => {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(HANDOVER_L1_EFFECTIVE_ON || '')) || !HANDOVER_TERMS_VERSION) {
      console.error('[terms-handover] 시행일·버전 상수를 못 읽음 — 아무것도 바꾸지 않음');
      return;
    }
    const ps = await PlatformSetting.findOne();
    if (!ps) { console.log('[terms-handover] platform_settings 행 없음 — 건너뜀'); return; }
    const today = kstToday();
    const latestOk = addDays(today, 30);
    console.log(`[terms-handover] 현재 약관 버전 ${ps.terms_version} · 시행일 ${HANDOVER_L1_EFFECTIVE_ON} · 오늘(한국) ${today} · 30일 뒤 ${latestOk}`);
    if (!versionLt(ps.terms_version, HANDOVER_TERMS_VERSION)) {
      console.log(`[terms-handover] 이미 ${ps.terms_version} — 할 일 없음`);
      return;
    }
    if (HANDOVER_L1_EFFECTIVE_ON < latestOk) {
      console.warn(`[terms-handover] ⚠️ 시행일 ${HANDOVER_L1_EFFECTIVE_ON} 이 30일 공지 기간(${latestOk})보다 이르다 — 바꾸지 않음.`
        + ' services/memberHandover.js HANDOVER_L1_EFFECTIVE_ON 과 dev-frontend/public/locales/{ko,en}/legal.json terms.s10 시행일을 옮긴 뒤 다시 배포하세요.'
        + ' (그 전까지 «나만 보기» 업무 넘기기는 꺼져 있다)');
      return;
    }
    const ko = joinNotice(ps.announcement_text, NOTICE_KO);
    const en = joinNotice(ps.announcement_text_en, NOTICE_EN);
    const patch = { terms_version: HANDOVER_TERMS_VERSION };
    if (ko) patch.announcement_text = ko;
    if (en) patch.announcement_text_en = en;
    if (ko && !ps.announcement_text) { patch.announcement_dismissible = true; patch.announcement_severity = 'info'; }
    if (!ko || !en) console.warn('[terms-handover] ⚠️ 기존 공지가 길어 약관 공지를 붙이지 못함 — 관리자 화면에서 공지 띠를 확인하세요');
    console.log(`[terms-handover] ${DRY ? '(미리보기) ' : ''}바꿀 것: ${JSON.stringify(patch)}`);
    if (!DRY) {
      await ps.update(patch);
      console.log('[terms-handover] ✅ 약관 버전·공지 띠 반영 — 다음 로그인부터 재동의 창');
    }
  } catch (e) {
    console.error('[terms-handover] 실패(배포는 계속):', e.message);
  } finally {
    await sequelize.close().catch(() => {});
  }
})();
