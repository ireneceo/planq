// 옛 메일 사칭 검사 소급 — docs/MAIL_IMPERSONATION_DESIGN.md §5 (2026-10-15).
//   node scripts/retriage-mail.js --impersonation            # 미리보기(바꾸지 않는다) — 기본
//   node scripts/retriage-mail.js --impersonation --apply    # 반영
//   (이 파일을 직접 돌려도 같다)
//
// 하는 일 두 가지
//   (a) 배지 채우기 — 받은 메일이 있는 모든 스레드에 email_threads.impersonation(이미 스팸인 것 포함 — 업체 스팸 피싱이
//       «왜» 를 보이게). 판정이 그대로면 쓰지 않는다(멱등).
//   (b) 격리 — status open/uncertain 중 강한 근거만. **불가침**: 확인완료(archived) · 우리가 답한 스레드(outbound 1통 이상) ·
//       [스팸 아님] 이력(감사 mail.mark_not_spam) · 규칙·손으로 옮긴 것(mailRetriage.eligibleWhere) · 담당 지정 ·
//       아는 상대(판정 함수가 경고로 낮춘다) · 이 워크스페이스가 격리 기준을 끈 경우.
//   운영 적용 조건: 후보 ≤ 20 이고 목록을 사람이 읽어 정상 0 을 보고에 적은 뒤.
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { EmailThread, EmailMessage } = require('../models');
const IMP = require('../services/mailImpersonation');
const R = require('../services/mailRetriage');
const { offFor } = require('../services/mailCriteria');
const { isKnownContact } = require('../services/emailImapCron');

const APPLY = process.argv.includes('--apply');

function sameView(a, b) {
  const v = (x) => JSON.stringify(x ? { l: x.level, s: (x.signals || []).map((s) => s.code + s.level + s.detail).sort(), k: !!x.known, r: !!x.released_at } : null);
  return v(a) === v(b);
}

async function run() {
  const [threadIds] = await sequelize.query(
    `SELECT DISTINCT thread_id id FROM email_messages WHERE direction = 'inbound' ORDER BY thread_id`);
  const [outRows] = await sequelize.query(`SELECT DISTINCT thread_id id FROM email_messages WHERE direction = 'outbound'`);
  const replied = new Set(outRows.map((r) => r.id));
  const [nsRows] = await sequelize.query(
    `SELECT DISTINCT target_id id FROM audit_logs WHERE action = 'mail.mark_not_spam' AND target_type = 'email_thread'`);
  const notSpam = new Set(nsRows.map((r) => Number(r.id)));
  const eligibleIds = new Set((await EmailThread.findAll({ where: R.eligibleWhere(), attributes: ['id'], raw: true })).map((r) => r.id));
  const assigned = await R.assignedIds([...eligibleIds]);
  const offByBiz = new Map();

  const stat = { scanned: 0, badge_warn: 0, badge_quarantine: 0, badge_written: 0, quarantined: 0, protected: {} };
  const candidates = [];
  const ids = threadIds.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 200) {
    const threads = await EmailThread.findAll({ where: { id: { [Op.in]: ids.slice(i, i + 200) } } });
    for (const th of threads) {
      stat.scanned += 1;
      const last = await EmailMessage.findOne({ where: { thread_id: th.id, direction: 'inbound' }, order: [['id', 'DESC']], attributes: ['from_email'] });
      const known = last ? await isKnownContact(th.business_id, last.from_email) : false;
      const imp = await IMP.assessThread(th, { known });
      if (imp) stat[imp.level === 'quarantine' ? 'badge_quarantine' : 'badge_warn'] += 1;
      const prev = th.impersonation;
      if (!sameView(prev, imp) && (imp || prev)) {
        stat.badge_written += 1;
        if (APPLY) await th.update({ impersonation: imp });
      }
      if (!imp || imp.level !== 'quarantine') continue;
      if (!offByBiz.has(th.business_id)) offByBiz.set(th.business_id, await offFor(th.business_id));
      const why = th.status === 'spam' ? null
        : !['open', 'uncertain'].includes(th.status) ? 'status_' + th.status
          : replied.has(th.id) ? 'replied'
            : notSpam.has(th.id) ? 'mark_not_spam'
              : !eligibleIds.has(th.id) ? 'manual_or_rule'
                : assigned.has(th.id) ? 'assigned'
                  : !IMP.shouldQuarantine(imp, offByBiz.get(th.business_id)) ? 'criterion_off' : 'ok';
      if (!why) continue;   // 이미 스팸 — 배지만
      if (why !== 'ok') { stat.protected[why] = (stat.protected[why] || 0) + 1; continue; }
      candidates.push(`${th.id} | biz ${th.business_id} | ${String(last && last.from_email || '').split('@')[1] || '?'} | ${imp.signals.filter((s) => s.level === 'strong').map((s) => s.code).join(',')}`);
      if (APPLY) {
        await th.update({
          status: 'spam', triage: 'spam', reply_needed: false, reply_needed_at: null, uncertain_reason: null,
          spam_origin: 'impersonation', spam_since: new Date(), triage_criterion: 'impersonation', impersonation: imp,
        });
        await require('../services/auditService').writeAudit({
          action: 'mail.quarantine_impersonation', targetType: 'email_thread', targetId: th.id, businessId: th.business_id,
          newValue: { via: 'retriage', codes: imp.signals.filter((s) => s.level === 'strong').map((s) => s.code) },
        }).catch(() => {});
        stat.quarantined += 1;
      }
    }
  }
  console.log(`${APPLY ? '[반영]' : '[미리보기 — 바꾸지 않음]'} 스레드 ${stat.scanned} · 경고 ${stat.badge_warn} · 격리 등급 ${stat.badge_quarantine} · 배지 ${APPLY ? '씀' : '쓸 것'} ${stat.badge_written}`);
  console.log(`격리 후보 ${candidates.length}건${APPLY ? ` → 격리 ${stat.quarantined}` : ''} · 불가침으로 뺀 것 ${JSON.stringify(stat.protected)}`);
  for (const c of candidates) console.log('  ' + c);
  return { ...stat, candidates };
}

if (require.main === module) {
  run().then(async () => { await sequelize.close(); process.exit(0); })
    .catch(async (e) => { console.error('[retriage-impersonation] 실패:', e.message); process.exit(1); });
}
module.exports = { run };
