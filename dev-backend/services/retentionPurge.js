// services/retentionPurge.js — 감사 로그 보관기간 만료 정리 (Fable 설계 게이트 2026-09-04).
//
// ★ 기본은 **리포트**다. `RETENTION_PURGE_APPLY=1` 이 없으면 한 행도 지우지 않고 "지울 대상"만
//   센다. 삭제는 되돌릴 수 없으므로 운영 리포트가 실측과 맞는 것을 두 번 이상 확인한 뒤에 켠다.
//
// ★ 스케줄은 04:00 UTC — 자정 체인에 넣지 않는다. 운영 DB 백업이 03:30 UTC 라, 자정(00:00)에
//   지우면 그날 지운 행이 **그날 백업에 없다.** 04:00 이면 03:30 백업이 항상 그날 지울 행을
//   품고 있어 하루짜리 되돌리기 창이 생긴다.
//
// ★ 멱등: 커서를 쓰지 않고 **술어**로 지운다. 중간에 죽어도 다음 회차가 같은 술어로 이어 받는다.
//   SELECT(리포트)와 DELETE(적용)가 **같은 where 빌더**를 쓴다 — 두 벌이면 리포트가 삭제를
//   대변하지 못한다.
const { sequelize } = require('../config/database');
const { resolveRetention, PLATFORM_AUDIT_RETENTION_DAYS } = require('./retentionPolicy');

const LOCK_NAME = 'planq_retention_purge';
const BATCH = 1000;
const BATCH_PAUSE_MS = 100;

/** 워크스페이스 행의 삭제 술어 — 래칫 업의 두 축을 AND 로 건다.
 *  ① 기록 시점에 약속한 만료가 지났다  ② 현재 플랜 기간으로도 지났다
 *  둘 다여야 지운다. 하나라도 안 지났으면 남긴다. */
const BIZ_WHERE = `business_id = :b
    AND retain_until IS NOT NULL AND retain_until < :now
    AND created_at < DATE_SUB(:now, INTERVAL :days DAY)`;

/** 플랫폼 행(business_id NULL) — 스탬프만 본다. NULL 스탬프는 손대지 않는다. */
const PLATFORM_WHERE = `business_id IS NULL AND retain_until IS NOT NULL AND retain_until < :now`;

async function runRetentionPurge({
  now = new Date(),
  apply = process.env.RETENTION_PURGE_APPLY === '1',
  budgetMs = 60_000,
} = {}) {
  const startedAt = Date.now();
  const out = {
    mode: apply ? 'apply' : 'report',
    lock: 'acquired',
    audit: { businesses: [], platform: { candidates: 0, deleted: 0 }, skipped: {}, null_stamp: 0 },
    truncated: false,
    duration_ms: 0,
  };

  const [[lockRow]] = await sequelize.query(`SELECT GET_LOCK('${LOCK_NAME}', 0) AS got`);
  if (!lockRow || Number(lockRow.got) !== 1) {
    out.lock = 'busy';
    out.duration_ms = Date.now() - startedAt;
    return out;
  }

  try {
    const { Business, AuditLog } = require('../models');
    const bizRows = await Business.findAll({ attributes: ['id'], paranoid: false });

    for (const b of bizRows) {
      if (Date.now() - startedAt > budgetMs) { out.truncated = true; break; }
      const ret = await resolveRetention(b.id, 'audit_log');
      if (!ret.ok) {
        // ★ 못 읽으면 **보존**. 사유를 세어 리포트에 남긴다 — fail-closed 는 조용하기 때문이다.
        out.audit.skipped[ret.reason] = (out.audit.skipped[ret.reason] || 0) + 1;
        continue;
      }
      const repl = { b: b.id, now, days: ret.days };
      const [cntRows] = await sequelize.query(
        `SELECT COUNT(*) AS c FROM audit_logs WHERE ${BIZ_WHERE}`, { replacements: repl });
      const candidates = Number(cntRows[0]?.c || 0);
      let deleted = 0;
      if (apply && candidates > 0) {
        for (;;) {
          if (Date.now() - startedAt > budgetMs) { out.truncated = true; break; }
          const [res] = await sequelize.query(
            `DELETE FROM audit_logs WHERE ${BIZ_WHERE} ORDER BY id LIMIT ${BATCH}`, { replacements: repl });
          const n = Number(res?.affectedRows ?? 0);
          deleted += n;
          if (n < BATCH) break;
          await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
        }
      }
      if (candidates > 0 || deleted > 0) {
        out.audit.businesses.push({ business_id: b.id, plan: ret.planCode, days: ret.days, candidates, deleted });
      }
    }

    // 플랫폼 행
    const [pRows] = await sequelize.query(
      `SELECT COUNT(*) AS c FROM audit_logs WHERE ${PLATFORM_WHERE}`, { replacements: { now } });
    out.audit.platform.candidates = Number(pRows[0]?.c || 0);
    if (apply && out.audit.platform.candidates > 0) {
      for (;;) {
        const [res] = await sequelize.query(
          `DELETE FROM audit_logs WHERE ${PLATFORM_WHERE} ORDER BY id LIMIT ${BATCH}`, { replacements: { now } });
        const n = Number(res?.affectedRows ?? 0);
        out.audit.platform.deleted += n;
        if (n < BATCH) break;
        await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
      }
    }

    // 스탬프가 없는 행 — 보존 대상이지만 **몇 건인지 보이게** 둔다(쓰기측이 다시 새면 여기서 는다).
    const [nullRows] = await sequelize.query(
      'SELECT COUNT(*) AS c FROM audit_logs WHERE retain_until IS NULL');
    out.audit.null_stamp = Number(nullRows[0]?.c || 0);

    out.duration_ms = Date.now() - startedAt;

    // 회차 기록 — 전용 테이블을 만들지 않는다. 플랫폼 감사 행이라 최상위 티어 보관이고,
    //   자기 자신을 지우지 않는다. /admin/audit-logs?action=retention.* 로 그대로 보인다.
    try {
      await AuditLog.create({
        user_id: null, business_id: null,
        action: apply ? 'retention.purge' : 'retention.report',
        target_type: 'retention', target_id: null,
        new_value: out,
        retain_until: new Date(Date.now() + PLATFORM_AUDIT_RETENTION_DAYS * 86400000),
      });
    } catch (e) { console.warn('[retentionPurge] 회차 기록 실패', e.message); }

    return out;
  } finally {
    try { await sequelize.query(`SELECT RELEASE_LOCK('${LOCK_NAME}')`); } catch { /* noop */ }
  }
}

/**
 * 매일 04:00 UTC 회차 등록.
 *   자정 체인에 넣지 않는 이유는 파일 상단 주석 참조 — 운영 DB 백업이 03:30 UTC 라
 *   그보다 뒤에 지워야 그날 백업이 지운 행을 품는다(되돌리기 창).
 */
function initRetentionCron() {
  const schedule = () => {
    const now = new Date();
    const next = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 0, 0, 0));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const ms = next.getTime() - now.getTime();
    setTimeout(async () => {
      try {
        const r = await runRetentionPurge();
        console.log('[retention]', r.mode, 'lock=' + r.lock,
          'biz=' + r.audit.businesses.length,
          'platform=' + JSON.stringify(r.audit.platform),
          'skipped=' + JSON.stringify(r.audit.skipped),
          'null_stamp=' + r.audit.null_stamp);
      } catch (e) { console.warn('[retention] failed', e.message); }
      schedule();
    }, ms);
  };
  schedule();
}

module.exports = { runRetentionPurge, initRetentionCron };
