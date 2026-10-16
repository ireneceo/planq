// 합쳐진 메일 스레드의 옛 번호 → 새 번호 (2026-10-16, Fable 설계 «갈라진 옛 스레드 병합» 필수 7)
//
// 병합 스크립트(scripts/merge-split-mail-threads.js)는 죽은 스레드 행을 **지운다**(툼스톤을 남기면 목록·검색·상담
// 수집기마다 제외 술어를 더해야 하고, 하나만 빠져도 유령 행이 뜬다). 대신 옛 번호를 이 표에 남겨
// 알림·메일로 이미 나간 `/mail?thread=<옛 번호>` 링크가 새 스레드를 연다.
//   - 읽는 문은 상세 GET 하나(routes/email_threads.js) — 알림·AI 도구·상담 열기가 다 그 문으로 들어온다.
//   - 체인을 만들지 않는다: 다시 합치면 new_thread_id 를 갈아 끼운다(repoint).
//   - 표가 없으면(운영 마이그레이션 전) null — 상세는 종전처럼 404.
'use strict';

const { sequelize } = require('../config/database');

async function resolveThreadRedirect(businessId, oldThreadId) {
  try {
    const [rows] = await sequelize.query(
      'SELECT new_thread_id FROM email_thread_redirects WHERE old_thread_id = ? AND business_id = ? LIMIT 1',
      { replacements: [Number(oldThreadId), Number(businessId)] },
    );
    return rows[0] ? Number(rows[0].new_thread_id) : null;
  } catch (e) {
    if (/doesn't exist|ER_NO_SUCH_TABLE/i.test(String(e.message))) return null;
    throw e;
  }
}

module.exports = { resolveThreadRedirect };
