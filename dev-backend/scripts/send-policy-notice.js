// 처리방침 개정 고지 메일 — 2026-10-26 시행분(랜딩 마케팅 측정). docs/MARKETING_TRACKING_DESIGN.md §10-5 ③.
//   처리방침 10조가 «시행 7일 전 서비스 공지 및 이메일로 안내» 를 약속한다. 그 메일 쪽 한 번짜리 문.
//
// 사용:  node scripts/send-policy-notice.js                     (미리보기 — 받는 사람 수·언어별 수·예시 3명만 출력, 아무것도 안 보냄)
//        node scripts/send-policy-notice.js --send --confirm=<수>  (미리보기의 «보낼 사람» 수를 그대로 적어야 보낸다)
//        node scripts/send-policy-notice.js --only=a@x.com          (한 주소에만 — 시험용, --send 와 같이)
//
// ★ 받는 사람 = 활성 계정 전체(삭제·정지 제외). 가짜·시스템 주소(cue+…@system.planq.kr 등)는 sendEmail 이 막는다.
// ★ 다시 돌려도 이미 보낸 주소는 건너뛴다(EmailLog template='policy_notice_2026_10' status='sent') — 중간에 끊겨도 이어서.
// ★ dev 는 EMAIL_SENDING_ENABLED=false 라 sendEmail 이 'skipped' 로만 남긴다(실제 발송은 운영에서만).
require('dotenv').config();
const { Op } = require('sequelize');
const { User, EmailLog } = require('../models');
const { sequelize } = require('../config/database');
const { sendPolicyNoticeEmail, emailBlockReason } = require('../services/emailService');

const TEMPLATE = 'policy_notice_2026_10';
const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const SEND = process.argv.includes('--send');
const CONFIRM = Number(arg('confirm'));
const ONLY = (arg('only') || '').trim().toLowerCase() || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  try {
    const where = { status: 'active', is_guest: false, is_ai: false, email: { [Op.ne]: null } };
    if (ONLY) where.email = ONLY;
    const users = await User.findAll({ where, attributes: ['id', 'email', 'name', 'language'], order: [['id', 'ASC']] });
    const sentRows = await EmailLog.findAll({ where: { template: TEMPLATE, status: 'sent' }, attributes: ['to_email'] });
    const already = new Set(sentRows.map((r) => String(r.to_email || '').toLowerCase()));
    const targets = [];
    let blocked = 0; let done = 0;
    for (const u of users) {
      const to = String(u.email).trim().toLowerCase();
      if (already.has(to)) { done += 1; continue; }
      if (emailBlockReason(to)) { blocked += 1; continue; }
      targets.push({ id: u.id, to, name: u.name, lang: (u.language && u.language !== 'ko') ? 'en' : 'ko' });   // 언어 없음 = 한국어, 그 밖 언어(ja·zh…)는 영어
    }
    const byLang = targets.reduce((m, t) => { m[t.lang] = (m[t.lang] || 0) + 1; return m; }, {});
    console.log(`[policy-notice] 활성 계정 ${users.length} · 이미 보냄 ${done} · 막힌 주소 ${blocked} · 보낼 사람 ${targets.length} (${JSON.stringify(byLang)})`);
    const byDomain = targets.reduce((m, t) => { const d = t.to.split('@')[1]; m[d] = (m[d] || 0) + 1; return m; }, {});
    console.log('[policy-notice] 도메인별:', Object.entries(byDomain).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${n}`).join(' · '));
    console.log('[policy-notice] 예시:', targets.slice(0, 3).map((t) => `${t.id}:${t.lang}`).join(', ') || '없음');
    if (!SEND) { console.log('[policy-notice] 미리보기만 했습니다. 보내려면 --send --confirm=' + targets.length); await sequelize.close(); process.exit(0); }
    if (CONFIRM !== targets.length) {
      console.error(`[policy-notice] --confirm=${Number.isFinite(CONFIRM) ? CONFIRM : '(없음)'} 이 보낼 사람 수 ${targets.length} 와 다릅니다 — 보내지 않았습니다.`);
      await sequelize.close(); process.exit(1);
    }
    let ok = 0; let fail = 0;
    for (const t of targets) {
      const r = await sendPolicyNoticeEmail({ to: t.to, name: t.name, lang: t.lang, userId: t.id });
      if (r) ok += 1; else fail += 1;
      await sleep(400);   // 발신 평판 — 한꺼번에 쏟지 않는다
    }
    console.log(`[policy-notice] 끝 — 성공 ${ok} · 실패/건너뜀 ${fail} (실패는 다시 돌리면 그것만 다시 보낸다)`);
    await sequelize.close(); process.exit(fail ? 2 : 0);
  } catch (e) { console.error('[policy-notice] 실패:', e.message); process.exit(1); }
})();
