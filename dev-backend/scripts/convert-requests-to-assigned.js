// 이미 «요청» 으로 들어간 프로젝트 업무를 «배정 업무» 로 (2026-11-18 · 설계 docs/TASK_REQUEST_INTENT_DESIGN.md §4-10 · Fable DESIGN-READY)
//
//   node scripts/convert-requests-to-assigned.js --business <id> --creator <user_id>            # 기본: 읽기만(건수·표본)
//   node scripts/convert-requests-to-assigned.js --business <id> --creator <user_id> --apply    # 바꾸고 되돌림 장부를 scripts/out/ 에
//   node scripts/convert-requests-to-assigned.js --revert <장부 파일>                            # 장부대로 되돌린다
//
// 대상·바꾸는 것은 services/taskRequestConvert.js 머리말. 두 인자는 필수 — 남의 요청은 건드릴 수 없다.
// 운영은 Irene 승인 뒤에만(dry-run 숫자를 보고). 알림은 나가지 않는다.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/database');
const conv = require('../services/taskRequestConvert');

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const APPLY = args.includes('--apply');
const REVERT = arg('--revert');

(async () => {
  try {
    if (REVERT) {
      const entries = JSON.parse(fs.readFileSync(REVERT, 'utf8'));
      let ok = 0; const skipped = [];
      for (const e of entries) {
        // 장부의 날짜는 ISO 문자열 — DB 에 넣기 전에 Date 로
        for (const k of Object.keys(e.reviewer || {})) {
          if (typeof e.reviewer[k] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(e.reviewer[k])) e.reviewer[k] = new Date(e.reviewer[k]);
        }
        const r = await conv.revertOne(e);
        if (r.ok) ok++; else skipped.push(`#${e.task_id}(${r.reason})`);
      }
      // 건너뜀 = 변환 뒤 완료·취소됐거나 컨펌자가 붙은 것 — 되돌리면 «완료 + 컨펌 대기» 가 되므로 그대로 둔다
      console.log(`[revert] 되돌림 ${ok} / ${entries.length}${skipped.length ? ` · 건너뜀 ${skipped.join(', ')}` : ''}`);
      return;
    }
    const businessId = Number(arg('--business'));
    const creatorId = Number(arg('--creator'));
    if (!businessId || !creatorId) { console.error('--business <id> --creator <user_id> 둘 다 필요'); process.exitCode = 2; return; }

    const rows = await conv.findEligible({ businessId, creatorId });
    const by = {};
    for (const r of rows) {
      const k = `${r.status}·${r.request_ack_at ? '확인함' : '미확인'}`;
      by[k] = (by[k] || 0) + 1;
    }
    console.log(`[대상] ws ${businessId} · 작성자 ${creatorId} · ${rows.length}건`, by);
    rows.slice(0, 5).forEach((r) => console.log(`  표본 #${r.id} ${r.status} ${String(r.title).slice(0, 40)}`));
    if (!APPLY) { console.log('[읽기만] 바꾸려면 --apply'); return; }

    const ledger = [];
    for (const r of rows) {
      const e = await conv.convertOne(r.id, { businessId, creatorId });
      if (e) ledger.push(e);
    }
    const dir = path.join(__dirname, 'out');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `convert-requests-${businessId}-${creatorId}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(ledger, null, 1));
    console.log(`[apply] 바꿈 ${ledger.length} / ${rows.length} · 되돌림 장부 ${file}`);
  } catch (e) {
    console.error('[실패]', e.message); process.exitCode = 1;
  } finally {
    setTimeout(() => sequelize.close().finally(() => process.exit()), 1500);   // 감사 setImmediate 가 쓰고 나서 닫는다
  }
})();
