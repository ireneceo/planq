// share_token 만료 cron (2026-05-05)
// 30일간 미사용 (조회 / 갱신 없음) share_token 을 자동 NULL 처리. 보안 + DB 위생.
//
// 대상 모델:
//   - Post (Q docs 공유)        — share_token + shared_at
//   - Document (Q docs 문서)    — share_token + shared_at
//   - Invoice (Q bill 공유)     — **상태별** (아래 표, FIX_0AB A-①)
//
// 정책: shared_at 이 30일 이상 전이고 last_viewed_at 도 30일 이상 전이면 NULL 화.
//       last_viewed_at 컬럼이 없으면 shared_at 기준만.
//
// ★ 청구서는 공용 루프에 두지 않는다 — 링크가 곧 결제 통로다. 만료 주인은 share_expires_at(발송 시 명시한 경우만).
//   cron 은 다시 쓸 일이 없는 것만 치운다:
//     sent · overdue · partially_paid → 절대 안 지움(결제 링크)
//     paid      → paid_at(없으면 updated_at) < now − 180일 (고객이 영수·증빙 파일을 내려받는 기간)
//     canceled  → updated_at < now − 30일
//     draft     → sent_at IS NULL AND updated_at < now − 30일 (한 번도 안 보낸 미리보기 토큰)

const { Op } = require('sequelize');

const STALE_DAYS = 30;
const PAID_INVOICE_LINK_DAYS = 180;

async function cleanupInvoiceTokens(now = new Date()) {
  const { Invoice } = require('../models');
  const cutoff30 = new Date(now.getTime() - STALE_DAYS * 86400e3);
  const cutoffPaid = new Date(now.getTime() - PAID_INVOICE_LINK_DAYS * 86400e3);
  const [n] = await Invoice.update({ share_token: null }, {
    where: {
      share_token: { [Op.ne]: null },
      [Op.or]: [
        { status: 'canceled', updated_at: { [Op.lt]: cutoff30 } },
        { status: 'draft', sent_at: null, updated_at: { [Op.lt]: cutoff30 } },
        { status: 'paid', paid_at: { [Op.lt]: cutoffPaid } },
        { status: 'paid', paid_at: null, updated_at: { [Op.lt]: cutoffPaid } },   // paid_at 없는 옛 데이터
      ],
    },
  });
  return n;
}

async function runShareTokenCleanup() {
  // N+74-B — files/kb_documents/calendar_events 추가 (옛: posts/documents/invoices 만)
  const stats = { posts: 0, documents: 0, invoices: 0, files: 0, kb_documents: 0, calendar_events: 0 };
  const cutoff = new Date(Date.now() - STALE_DAYS * 86400 * 1000);
  const { Post, Document, File, KbDocument, CalendarEvent } = require('../models');

  const targets = [
    { model: Post, key: 'posts', hasSharedAt: true },
    { model: Document, key: 'documents', hasSharedAt: true },
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

  // 청구서 — 상태를 아는 별도 단계(A-①)
  try { stats.invoices = await cleanupInvoiceTokens(); }
  catch (e) { console.warn('[share-cleanup invoices]', e.message); }

  return stats;
}

module.exports = { runShareTokenCleanup, cleanupInvoiceTokens, STALE_DAYS, PAID_INVOICE_LINK_DAYS };
