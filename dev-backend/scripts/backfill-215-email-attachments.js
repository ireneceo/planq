// #215 백필 — 메일 첨부 2건 정정 (설계: docs/QMAIL_ATTACHMENT_DESIGN_215.md §6)
//
// Part C — email_attachments.is_inline 재계산
//   옛 로직 `!!(att.cid || att.contentId)` 이 Content-ID 존재만으로 "본문 삽입" 으로 단정해
//   dev 3,221건 중 2,114건이 첨부 목록에서 사라져 있었다(부가가치세 납부서·매입매출장·영수증 포함).
//   ★ 화면은 이 백필 없이도 이미 정상이다 — 읽기 권위를 컬럼이 아니라 본문 cid 참조로 옮겼기 때문(A).
//     이 백필은 "컬럼이 계속 거짓을 말하는 상태" 를 정리해 미래 코드가 컬럼을 믿어도 되게 만드는 것이다.
//
// Part F — 개인 메일 계정 첨부를 L1(본인만)으로
//   `email_accounts.owner_user_id` 가 set 인 개인 계정의 첨부 File 이 vlevel/visibility='L3' 로 저장돼
//   **워크스페이스 전 멤버의 Q File 에 노출**되고 있었다. 스레드·메시지는 이미 본인만 접근 가능한데
//   파일만 새던 반쪽 상태 → 접근 범위를 메일과 정합하게 좁힌다.
//   uploader_id 도 계정 주인으로 교정한다 (canAccessFileByLevel 의 L1 은 uploader 본인만 통과시키므로,
//   uploader 를 안 고치면 L1 이 계정 주인 자신의 접근까지 끊는다).
//
// ⚠️ Part F 는 노출 범위를 **좁힌다**. 그동안 보이던 파일이 안 보이게 되는 것이 정상 동작 복원이다.
//    파일 내용·이름·소속은 불변, 접근 범위만 바뀐다. 실행 전 반드시 dry-run 으로 대상·건수를 확인할 것.
//
// 실행:
//   node scripts/backfill-215-email-attachments.js            # dry-run (기본) — 아무것도 바꾸지 않음
//   node scripts/backfill-215-email-attachments.js --apply    # 실제 적용 (변경 전 값 backups/ 에 저장)
//   node scripts/backfill-215-email-attachments.js --rollback=backups/215-20260802-1200/215-affected.json
//
// 멱등: apply 후 재실행하면 양 파트 모두 "변경 0" 을 보고한다.
// updated_at 보존: 두 파트 모두 raw SQL (Sequelize timestamps 우회).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/database');
const { isEmbedded } = require('../services/emailAttachments');

const APPLY = process.argv.includes('--apply');
const ROLLBACK = (process.argv.find(a => a.startsWith('--rollback=')) || '').split('=')[1] || null;

const BACKUP_ROOT = path.join(__dirname, '..', '..', 'backups');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ── Part C ──────────────────────────────────────────────────────────────────
async function planPartC() {
  const [rows] = await sequelize.query(
    `SELECT a.id, a.content_id, a.is_inline, m.body_html
       FROM email_attachments a
       JOIN email_messages m ON m.id = a.message_id`
  );
  const changes = [];
  for (const r of rows) {
    const want = isEmbedded(r.content_id, r.body_html) ? 1 : 0;
    const cur = r.is_inline ? 1 : 0;
    if (want !== cur) changes.push({ id: r.id, from: cur, to: want });
  }
  return { scanned: rows.length, changes };
}

async function applyPartC(changes) {
  // raw SQL — updated_at 미변경
  const on = changes.filter(c => c.to === 1).map(c => c.id);
  const off = changes.filter(c => c.to === 0).map(c => c.id);
  for (const [ids, val] of [[on, 1], [off, 0]]) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      await sequelize.query(
        `UPDATE email_attachments SET is_inline = :val WHERE id IN (:ids)`,
        { replacements: { val, ids: chunk } }
      );
    }
  }
}

// ── Part F ──────────────────────────────────────────────────────────────────
async function planPartF() {
  // 개인 계정(owner_user_id IS NOT NULL) 의 스레드 → 메시지 → 첨부 → File
  //   회사 계정(owner_user_id IS NULL) 첨부는 절대 건드리지 않는다 (WHERE 절로 봉쇄).
  //   멱등 가드: vlevel='L3' 인 것만 — 이미 L1 이거나 사용자가 손댄 값은 불변.
  const [rows] = await sequelize.query(
    `SELECT DISTINCT f.id, f.business_id, f.vlevel, f.visibility, f.uploader_id,
            ea.owner_user_id, ea.id AS account_id, ea.email AS account_email
       FROM files f
       JOIN email_attachments a ON a.file_id = f.id
       JOIN email_messages m    ON m.id = a.message_id
       JOIN email_threads t     ON t.id = m.thread_id
       JOIN email_accounts ea   ON ea.id = t.account_id
      WHERE ea.owner_user_id IS NOT NULL
        AND f.deleted_at IS NULL
        AND f.vlevel = 'L3'`
  );
  return rows;
}

async function applyPartF(rows) {
  // 계정 주인별로 묶어 UPDATE (business_id 명시 — 멀티테넌트)
  const byOwner = new Map();
  for (const r of rows) {
    const key = `${r.owner_user_id}|${r.business_id}`;
    if (!byOwner.has(key)) byOwner.set(key, { owner: r.owner_user_id, biz: r.business_id, ids: [] });
    byOwner.get(key).ids.push(r.id);
  }
  for (const g of byOwner.values()) {
    for (let i = 0; i < g.ids.length; i += 500) {
      const chunk = g.ids.slice(i, i + 500);
      await sequelize.query(
        `UPDATE files SET vlevel='L1', visibility='L1', uploader_id=:owner
          WHERE id IN (:ids) AND business_id=:biz AND vlevel='L3'`,
        { replacements: { owner: g.owner, biz: g.biz, ids: chunk } }
      );
    }
  }
}

// ── 롤백 ────────────────────────────────────────────────────────────────────
async function rollback(file) {
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`롤백: ${file}`);
  console.log(`  Part C ${snap.partC.length}건 / Part F ${snap.partF.length}건`);
  for (const c of snap.partC) {
    await sequelize.query(`UPDATE email_attachments SET is_inline = :v WHERE id = :id`,
      { replacements: { v: c.from, id: c.id } });
  }
  for (const f of snap.partF) {
    await sequelize.query(
      `UPDATE files SET vlevel=:vl, visibility=:vis, uploader_id=:up WHERE id=:id AND business_id=:biz`,
      { replacements: { vl: f.vlevel, vis: f.visibility, up: f.uploader_id, id: f.id, biz: f.business_id } });
  }
  console.log('롤백 완료.');
}

// ── main ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await sequelize.authenticate();

    if (ROLLBACK) { await rollback(ROLLBACK); await sequelize.close(); return; }

    console.log(`DB: ${process.env.DB_NAME}  모드: ${APPLY ? '적용(--apply)' : 'dry-run'}\n`);

    // Part C
    const c = await planPartC();
    console.log('── Part C — email_attachments.is_inline 재계산 ──');
    console.log(`  스캔 ${c.scanned}건 / 변경 대상 ${c.changes.length}건`);
    console.log(`    1 → 0 (숨김 해제, 첨부 복원): ${c.changes.filter(x => x.to === 0).length}건`);
    console.log(`    0 → 1 (본문 삽입으로 확정)  : ${c.changes.filter(x => x.to === 1).length}건`);
    if (c.changes.length) console.log(`  샘플 id: ${c.changes.slice(0, 10).map(x => x.id).join(', ')}`);

    // Part F
    const f = await planPartF();
    console.log('\n── Part F — 개인 메일 계정 첨부 L1 전환 ──');
    console.log(`  변경 대상 ${f.length}건`);
    if (f.length) {
      const byAcct = {};
      for (const r of f) {
        const k = `${r.account_email} (계정 ${r.account_id}, biz ${r.business_id}, 주인 user ${r.owner_user_id})`;
        byAcct[k] = (byAcct[k] || 0) + 1;
      }
      for (const [k, n] of Object.entries(byAcct)) console.log(`    ${k}: ${n}건`);
      const upChange = f.filter(r => r.uploader_id !== r.owner_user_id).length;
      console.log(`  uploader_id 변경 필요: ${upChange}건`);
      console.log(`  샘플 file id: ${f.slice(0, 10).map(x => x.id).join(', ')}`);
    }

    if (!APPLY) {
      console.log('\ndry-run 이므로 아무것도 변경하지 않았습니다. 적용하려면 --apply');
      await sequelize.close();
      return;
    }

    if (!c.changes.length && !f.length) {
      console.log('\n변경 대상 0건 — 멱등 확인 (이미 적용된 상태).');
      await sequelize.close();
      return;
    }

    // 변경 전 값 스냅샷 (롤백 경로)
    const dir = path.join(BACKUP_ROOT, `215-${stamp()}`);
    fs.mkdirSync(dir, { recursive: true });
    const snapPath = path.join(dir, '215-affected.json');
    fs.writeFileSync(snapPath, JSON.stringify({
      created_at: new Date().toISOString(),
      db: process.env.DB_NAME,
      partC: c.changes,
      partF: f.map(r => ({ id: r.id, business_id: r.business_id, vlevel: r.vlevel, visibility: r.visibility, uploader_id: r.uploader_id })),
    }, null, 2));
    console.log(`\n변경 전 값 저장: ${snapPath}`);
    console.log(`  롤백: node scripts/backfill-215-email-attachments.js --rollback=${snapPath}`);

    await applyPartC(c.changes);
    await applyPartF(f);
    console.log('\n적용 완료. 멱등 확인을 위해 한 번 더 실행하세요 (변경 0건이어야 함).');

    await sequelize.close();
  } catch (e) {
    console.error('실패:', e.message);
    process.exit(1);
  }
})();
