// 운영 #450 백필 — 메일 «답변 필요» ④ 규칙에 «보낸 사람이 사람인가» 조건을 더한 뒤(services/emailTriage.needsReply),
//   이미 답변 필요로 올라가 있던 **역할·브랜드 주소** 메일을 확인 권장으로 내린다. 멱등. 2026-10-02.
//   설계 docs/SALES_INTAKE_DESIGN.md §3.3 · §6.4 P4. Irene 결정 Q2: 운영 전수 시뮬에서 뒤집히는 목록에 진짜 문의 0건이면 예.
//
// 대상(전부 만족할 때만):
//   reply_needed=1 · status open|uncertain · reply_needed_reason='inbound'(사람이 직접 표시한 manual·임시답변 holding 제외)
//   · 마지막 수신 메일의 보낸 주소가 **아는 상대가 아니고**(③) **개인 주소가 아님**(contactRelation.isPersonalSender)
//   · 마지막 수신 메일에 회신 헤더(in_reply_to)가 **없다** — 우리 대화에 온 회신(①)은 역할 주소여도 답변 필요다. 보수적으로 건너뛴다.
// 바꾸는 것: reply_needed 0 · status 'uncertain' · uncertain_reason 'unclear_intent' · reply_needed_reason NULL
//   (수집 때 ④ 를 통과 못 한 메일이 받는 것과 같은 값 — emailTriage.triageInbound 의 else 갈래).
// 메일은 지우지 않는다 — Q mail 「확인 권장」 으로 옮겨질 뿐이다.
//
// 사용: node scripts/backfill-reply-needed-450.js                 (dry-run, 전 워크스페이스)
//       node scripts/backfill-reply-needed-450.js --apply         (적용 · 되돌리기 기록을 backups/ 에 행마다 남긴다)
//       node scripts/backfill-reply-needed-450.js --rollback <json>
// 운영은 /tmp 로 복사해 돌린다(운영 코드 디렉터리를 손대지 않는다) — 백엔드 위치를 스스로 찾는다.
const fs = require('fs');
const path = require('path');
const BASE = fs.existsSync('/opt/planq/backend/models') ? '/opt/planq/backend' : path.join(__dirname, '..');
process.chdir(BASE);
require(`${BASE}/node_modules/dotenv`).config({ path: `${BASE}/.env`, quiet: true });
const { sequelize } = require(`${BASE}/config/database`);
const { EmailThread } = require(`${BASE}/models`);

const TAG = '[backfill-450]';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ROLLBACK = args.includes('--rollback') ? args[args.indexOf('--rollback') + 1] : null;

async function rollback(file) {
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const r of rec.rows) {
    const t = await EmailThread.findByPk(r.id);
    if (!t) { console.log(TAG, `#${r.id} 없음 — skip`); continue; }
    // 그 뒤에 사람이 다시 손댄 행(답장·확인완료·스팸)은 되돌리지 않는다 — 지금 상태가 사람의 판단이다.
    if (t.reply_needed || t.status !== 'uncertain' || t.uncertain_reason !== 'unclear_intent') { console.log(TAG, `#${r.id} 이후 바뀜 — skip`); continue; }
    await t.update(r.old);
    console.log(TAG, `#${r.id} 되돌림`);
  }
}

async function main() {
  if (ROLLBACK) { await rollback(ROLLBACK); return; }
  const { isKnownContact } = require(`${BASE}/services/emailImapCron`);
  const { isPersonalSender } = require(`${BASE}/services/contactRelation`);
  const { createAuditLog } = require(`${BASE}/services/auditService`);
  const [rows] = await sequelize.query(
    `SELECT t.id, t.business_id, t.subject, t.status, t.reply_needed_reason, t.uncertain_reason,
            m.from_email, m.in_reply_to, m.references_chain
       FROM email_threads t
       JOIN email_messages m ON m.id = (SELECT MAX(id) FROM email_messages x WHERE x.thread_id = t.id AND x.direction = 'inbound')
      WHERE t.reply_needed = 1 AND t.status IN ('open','uncertain') AND t.reply_needed_reason = 'inbound'
      ORDER BY t.business_id, t.id`);
  const recDir = path.join(BASE, '..', 'backups');
  const recFile = path.join(recDir, `backfill-450-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const done = [];
  for (const r of rows) {
    // 엔진 ① isThreadReply 는 In-Reply-To 와 References 둘 다 본다(Fable 2026-10-02) — 같은 기준으로 건너뛴다.
    if (r.in_reply_to || (r.references_chain && String(r.references_chain).trim())) { console.log(TAG, `keep #${r.id} 회신 헤더 있음(①)`); continue; }
    if (await isKnownContact(r.business_id, r.from_email)) { console.log(TAG, `keep #${r.id} 아는 상대 ${r.from_email}`); continue; }
    if (isPersonalSender(r.from_email)) { console.log(TAG, `keep #${r.id} 개인 주소 ${r.from_email}`); continue; }
    console.log(TAG, `${APPLY ? 'FLIP' : 'flip(dry)'} biz ${r.business_id} #${r.id} ${r.from_email} | ${String(r.subject || '').slice(0, 60)}`);
    if (!APPLY) continue;
    const old = { reply_needed: true, status: r.status, uncertain_reason: r.uncertain_reason, reply_needed_reason: r.reply_needed_reason };
    await EmailThread.update(
      { reply_needed: false, status: 'uncertain', uncertain_reason: 'unclear_intent', reply_needed_reason: null },
      { where: { id: r.id, business_id: r.business_id, reply_needed: true } });
    done.push({ id: r.id, business_id: r.business_id, old });
    fs.mkdirSync(recDir, { recursive: true });
    fs.writeFileSync(recFile, JSON.stringify({ at: new Date().toISOString(), rows: done }, null, 2));   // 행마다 — 중간에 터져도 기록이 남는다
    createAuditLog({
      userId: null, businessId: r.business_id, action: 'mail.reply_needed_backfill_450',
      targetType: 'email_thread', targetId: r.id, oldValue: old,
      newValue: { reply_needed: false, status: 'uncertain', uncertain_reason: 'unclear_intent' },
    });
  }
  console.log(TAG, APPLY ? `적용 ${done.length}건${done.length ? ` · 되돌리기 기록 ${recFile}` : ''}` : `대상 ${rows.length}건 검사 (dry-run)`);
  // 열린 화면(Q mail 배지·확인필요)이 새로고침 없이 따라오게 하는 신호는 이 스크립트가 못 보낸다(소켓 없음) —
  //   다음 목록 조회·포커스 복귀 때 서버 값으로 맞춰진다.
}

main().catch((e) => { console.error(TAG, '실패:', e.message); process.exitCode = 1; })
  .finally(() => setTimeout(() => sequelize.close().then(() => process.exit(process.exitCode || 0)), 2000));
