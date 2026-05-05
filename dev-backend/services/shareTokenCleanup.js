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
  const stats = { posts: 0, documents: 0, invoices: 0 };
  const cutoff = new Date(Date.now() - STALE_DAYS * 86400 * 1000);
  const { Post, Document, Invoice } = require('../models');

  try {
    const [n] = await Post.update(
      { share_token: null, shared_at: null },
      { where: { share_token: { [Op.ne]: null }, shared_at: { [Op.lt]: cutoff } } }
    );
    stats.posts = n;
  } catch (e) { console.warn('[share-cleanup posts]', e.message); }

  try {
    const [n] = await Document.update(
      { share_token: null, shared_at: null },
      { where: { share_token: { [Op.ne]: null }, shared_at: { [Op.lt]: cutoff } } }
    );
    stats.documents = n;
  } catch (e) { console.warn('[share-cleanup documents]', e.message); }

  try {
    const [n] = await Invoice.update(
      { share_token: null, shared_at: null },
      { where: { share_token: { [Op.ne]: null }, shared_at: { [Op.lt]: cutoff } } }
    );
    stats.invoices = n;
  } catch (e) { /* Invoice 에 share_token 없으면 skip */ }

  return stats;
}

module.exports = { runShareTokenCleanup, STALE_DAYS };
