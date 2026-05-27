// share_expires_at 만료 임박 알림 (사이클 N+74-B 박제).
//
// share_token 이 만료 3일 이내인 자산의 author/uploader 에게 자동 알림 발송.
// 사용자가 만료 전에 갱신 (re-share) 하거나 revoke 결정.
//
// 대상 자산 (share_token + share_expires_at 컬럼 보유):
//   - Post (Q docs)
//   - File (Q file)
//   - KbDocument (Q info)
//   - CalendarEvent (Q calendar)
//
// 정책:
//   - share_expires_at 가 [now, now + 3 days] 사이
//   - 같은 자산 이미 'share_expiry_warn' 알림 발송 이력 있으면 skip (Notification.entity_type + entity_id + event_kind 검색)
//   - notify() 의 inbox/push 채널만 (email 은 너무 시끄러움)
//
// cron 주기: 하루 1회 충분 (만료까지 3일이라 정확성 24h 이내 OK).

const { Op } = require('sequelize');
const { notify } = require('../routes/notifications');

const WARN_DAYS = 3;

async function runShareExpiryNotify(ioApp) {
  const stats = { post: 0, file: 0, kb_document: 0, calendar_event: 0, skipped: 0 };
  const now = new Date();
  const warnUntil = new Date(now.getTime() + WARN_DAYS * 86400 * 1000);

  const { Post, File, KbDocument, CalendarEvent, Notification } = require('../models');

  const targets = [
    { model: Post, entity_type: 'post', authorField: 'author_id', titleField: 'title' },
    { model: File, entity_type: 'file', authorField: 'uploader_id', titleField: 'file_name' },
    { model: KbDocument, entity_type: 'kb_document', authorField: 'uploaded_by', titleField: 'title' },
    { model: CalendarEvent, entity_type: 'calendar_event', authorField: 'created_by', titleField: 'title' },
  ];

  for (const { model, entity_type, authorField, titleField } of targets) {
    try {
      const rows = await model.findAll({
        where: {
          share_token: { [Op.ne]: null },
          share_expires_at: { [Op.gte]: now, [Op.lte]: warnUntil },
        },
        attributes: ['id', 'business_id', authorField, titleField, 'share_expires_at'],
      });
      for (const row of rows) {
        const authorId = row[authorField];
        if (!authorId) { stats.skipped += 1; continue; }
        // 이미 share_expiry warn 발송했으면 skip (event_kind + entity 정확 매칭)
        const existing = await Notification.findOne({
          where: {
            user_id: authorId,
            event_kind: 'share_expiry',
            entity_type,
            entity_id: row.id,
          },
        });
        if (existing) { stats.skipped += 1; continue; }
        const expiresAt = row.share_expires_at;
        const daysLeft = Math.max(1, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86400000));
        await notify({
          userId: authorId,
          businessId: row.business_id,
          eventKind: 'share_expiry',  // N+74-B 신규 event_kind — NotificationPref 매트릭스에서 사용자가 별도 토글 가능
          title: `[공유 링크 만료 임박] ${row[titleField] || '(제목 없음)'}`,
          body: `외부 공유 링크가 ${daysLeft}일 후 만료됩니다. 갱신하려면 다시 공유해주세요.`,
          entityType: entity_type,
          entityId: row.id,
          ioApp,
        });
        stats[entity_type] += 1;
      }
    } catch (e) {
      console.warn(`[share-expiry-notify ${entity_type}]`, e.message);
    }
  }

  return stats;
}

module.exports = { runShareExpiryNotify, WARN_DAYS };
