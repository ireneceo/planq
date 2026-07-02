// share_token 만료 cron (2026-05-05)
// 30일간 미사용 (조회 / 갱신 없음) share_token 을 자동 NULL 처리. 보안 + DB 위생.
//
// 대상 모델:
//   - Post (Q docs 공유)        — share_token + shared_at
//   - Document (Q docs 문서)    — share_token + shared_at
//   - Invoice (Q bill 공유)     — share_token + shared_at (있으면)
//
// 정책: shared_at 이 30일 이상 전이고 last_viewed_at 도 30일 이상 전이면 NULL 화.
//       last_viewed_at 컬럼이 없으면 shared_at 기준만.

const { Op } = require('sequelize');

const STALE_DAYS = 30;

async function runShareTokenCleanup() {
  // N+74-B — files/kb_documents/calendar_events 추가 (옛: posts/documents/invoices 만)
  const stats = { posts: 0, documents: 0, invoices: 0, files: 0, kb_documents: 0, calendar_events: 0 };
  const cutoff = new Date(Date.now() - STALE_DAYS * 86400 * 1000);
  const { Post, Document, Invoice, File, KbDocument, CalendarEvent } = require('../models');

  const targets = [
    { model: Post, key: 'posts', hasSharedAt: true },
    { model: Document, key: 'documents', hasSharedAt: true },
    { model: Invoice, key: 'invoices', hasSharedAt: false }, // invoices 는 shared_at 없음 (share_token + share_expires_at 만) — updated_at 기준
    // N+74-B 신규 3 자산. shared_at 컬럼 없으면 share_expires_at 또는 updated_at 기준 (없으면 skip).
    { model: File, key: 'files', hasSharedAt: false },
    { model: KbDocument, key: 'kb_documents', hasSharedAt: false },
    { model: CalendarEvent, key: 'calendar_events', hasSharedAt: false },
  ];

  for (const { model, key, hasSharedAt } of targets) {
    try {
      const where = { share_token: { [Op.ne]: null } };
      if (hasSharedAt) {
        where.shared_at = { [Op.lt]: cutoff };
      } else {
        // shared_at 없으면 updated_at 기준 — 30일간 손 안 댄 share 만 정리
        where.updated_at = { [Op.lt]: cutoff };
      }
      const update = { share_token: null };
      if (hasSharedAt) update.shared_at = null;
      const [n] = await model.update(update, { where });
      stats[key] = n;
    } catch (e) {
      // 컬럼/모델 불일치 시 skip
      console.warn(`[share-cleanup ${key}]`, e.message);
    }
  }

  return stats;
}

module.exports = { runShareTokenCleanup, STALE_DAYS };
