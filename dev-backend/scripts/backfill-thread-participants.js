#!/usr/bin/env node
// #200(b') — email_threads.participants 백필
//
// 왜: 지난 사이클에 근본원인(in-place .push() → Sequelize 변경 미감지)은 고쳤지만,
//   그 전에 쌓인 옛 스레드는 participants=[] 그대로다 (운영 968 중 954).
//   비어 있으면 findOrCreateThread 의 "제목+참여자" 매칭이 항상 실패해 같은 대화가
//   계속 새 스레드로 쪼개지고, 목록 counterpart fallback 도 죽는다.
//
// 술어: 라이브 쓰기측(services/emailAddress.mergeParticipants)과 **같은 함수·같은 규칙**을 쓴다.
//   "이 스레드 계정 주소(+별칭)가 아닌 모든 from / to / cc" — 방향 무관 대칭.
//   - bcc 는 제외한다. 의도적 은닉 수신자를 참여자로 올리면 목록 counterpart 로 샌다.
//     (정상 bcc 답장은 In-Reply-To 로 step1 에서 병합되므로 그룹핑 손실도 없다)
//   - inbound 의 to 를 버리는 비대칭을 쓰면, 자기 주소로 발신된 메일이 자기 함에 도착한
//     스레드(운영 236건)는 유일한 상대 정보인 to 를 잃고 영영 빈 채로 남는다.
//
// 안전: dry-run 이 기본. --apply 로만 쓴다. 멱등(재실행 시 변경 0).
//   participants 한 컬럼만 UPDATE 하고 updated_at 은 보존한다(silent).
//
// 사용:
//   node scripts/backfill-thread-participants.js                 # dry-run 전체
//   node scripts/backfill-thread-participants.js --business=1    # 워크스페이스 한정
//   node scripts/backfill-thread-participants.js --apply         # 실제 적용
//   node scripts/backfill-thread-participants.js --apply --limit=50

const { sequelize } = require('../config/database');
const { EmailThread, EmailMessage, EmailAccount, EmailAccountAlias } = require('../models');
const { mergeParticipants, participantsEqual, normalizeAddrList } = require('../services/emailAddress');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const arg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : null;
};
const BUSINESS_ID = arg('business') ? Number(arg('business')) : null;
const LIMIT = arg('limit') ? Number(arg('limit')) : null;
const BATCH = 500;

// 계정별 제외 주소 (계정 주소 + 별칭) — 스레드마다 조회하지 않도록 한 번에 만든다
async function buildSelfEmailMap(businessId) {
  const where = businessId ? { business_id: businessId } : {};
  const accounts = await EmailAccount.findAll({ where, attributes: ['id', 'email', 'business_id'] });
  const aliases = await EmailAccountAlias.findAll({ attributes: ['account_id', 'email'] });
  const byAccount = new Map();
  for (const a of accounts) {
    const set = new Set();
    const own = String(a.email || '').trim().toLowerCase();
    if (own) set.add(own);
    byAccount.set(a.id, set);
  }
  for (const al of aliases) {
    const set = byAccount.get(al.account_id);
    if (!set) continue;
    const e = String(al.email || '').trim().toLowerCase();
    if (e) set.add(e);
  }
  return byAccount;
}

// 한 스레드의 메시지들 → 참여자 후보 목록 (라이브와 같은 술어 — 방향 무관 from/to/cc, bcc 제외)
function participantsFromMessages(msgs) {
  const incoming = [];
  for (const m of msgs) {
    if (m.from_email) incoming.push({ email: m.from_email, name: m.from_name || '' });
    incoming.push(...normalizeAddrList(m.to_emails));
    incoming.push(...normalizeAddrList(m.cc_emails));
  }
  return incoming;
}

(async () => {
  const started = Date.now();
  console.log(`[backfill-participants] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}` +
    `${BUSINESS_ID ? ` business=${BUSINESS_ID}` : ''}${LIMIT ? ` limit=${LIMIT}` : ''}`);

  const selfEmailMap = await buildSelfEmailMap(BUSINESS_ID);

  const where = BUSINESS_ID ? { business_id: BUSINESS_ID } : {};
  const total = await EmailThread.count({ where });
  console.log(`[backfill-participants] 대상 스레드 ${total}건`);

  let scanned = 0, changed = 0, unchanged = 0, noExternal = 0, noMessage = 0;
  const samples = [];
  const emptySamples = [];

  for (let offset = 0; offset < total; offset += BATCH) {
    const threads = await EmailThread.findAll({
      where,
      attributes: ['id', 'business_id', 'account_id', 'participants', 'subject'],
      order: [['id', 'ASC']],
      limit: BATCH,
      offset,
    });
    if (!threads.length) break;

    const ids = threads.map((t) => t.id);
    const msgs = await EmailMessage.findAll({
      where: { thread_id: ids },
      attributes: ['id', 'thread_id', 'direction', 'from_email', 'from_name', 'to_emails', 'cc_emails'],
      order: [['id', 'ASC']],
    });
    const byThread = new Map();
    for (const m of msgs) {
      if (!byThread.has(m.thread_id)) byThread.set(m.thread_id, []);
      byThread.get(m.thread_id).push(m);
    }

    for (const t of threads) {
      if (LIMIT && changed >= LIMIT) break;
      scanned++;
      const ms = byThread.get(t.id) || [];
      if (!ms.length) { noMessage++; continue; }

      const excludeEmails = [...(selfEmailMap.get(t.account_id) || new Set())];
      // participants 가 NULL 인 옛 row 도 있다 (dev 실측) — mergeParticipants 가 []로 흡수
      const candidates = participantsFromMessages(ms);
      const next = mergeParticipants(t.participants, candidates, { excludeEmails });

      // 결과가 빈 스레드는 "정말 외부 주소가 없는 것"이어야 한다. 놓친 게 아님을 증명하려고
      //   등장 주소 전체를 리포트에 남긴다 (전부 계정·별칭 주소면 정상).
      if (next.length === 0) {
        noExternal++;
        if (emptySamples.length < 10) {
          emptySamples.push({
            thread_id: t.id,
            addrs: [...new Set(candidates.map((c) => String(c.email || c).toLowerCase()))],
            self: excludeEmails,
          });
        }
      }

      if (participantsEqual(t.participants, next)) { unchanged++; continue; }

      changed++;
      if (samples.length < 5) {
        samples.push({
          thread_id: t.id,
          subject: String(t.subject || '').slice(0, 40),
          before: t.participants,
          after: next,
          messages: ms.length,
        });
      }

      if (APPLY) {
        // participants 한 컬럼만. updated_at 은 건드리지 않는다(옛 데이터 변조 최소화).
        await t.update({ participants: next }, { fields: ['participants'], silent: true });
      }
    }
    if (LIMIT && changed >= LIMIT) break;
  }

  console.log('');
  console.log(`[backfill-participants] 스캔 ${scanned} / 변경 ${changed} / 무변경 ${unchanged}` +
    ` / 메시지0 ${noMessage} / 외부주소0 ${noExternal}`);
  console.log('[backfill-participants] 샘플:');
  for (const s of samples) {
    console.log(`  #${s.thread_id} "${s.subject}" (msg ${s.messages})`);
    console.log(`     before: ${JSON.stringify(s.before)}`);
    console.log(`     after : ${JSON.stringify(s.after)}`);
  }
  if (emptySamples.length) {
    console.log(`\n[backfill-participants] 결과 참여자0 스레드 샘플 (등장 주소 전체 — 전부 계정·별칭이면 정상):`);
    for (const e of emptySamples) {
      console.log(`  #${e.thread_id} addrs=${JSON.stringify(e.addrs)} self=${JSON.stringify(e.self)}`);
    }
  }
  if (!APPLY) console.log('\n[backfill-participants] DRY-RUN — 아무것도 쓰지 않았습니다. 적용하려면 --apply');
  console.log(`[backfill-participants] ${Math.round((Date.now() - started) / 1000)}s`);

  await sequelize.close();
  process.exit(0);
})().catch((e) => {
  console.error('[backfill-participants] FAILED', e);
  process.exit(1);
});
