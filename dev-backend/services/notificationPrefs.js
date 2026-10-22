// 개인 알림 수신 설정 — 매트릭스 읽기와 채널(열) 일괄 저장 (routes/notifications.js 의 /prefs · /prefs/bulk).
//   GET 응답과 일괄 저장 응답이 같은 buildMatrix 를 쓴다(두 벌 금지).
const { NotificationPref } = require('../models');
const { sequelize } = require('../config/database');

const EVENT_KINDS = NotificationPref.EVENT_KINDS;
const CHANNELS = ['inbox', 'chat', 'email', 'push'];

// 기본 ON — 명시적 row 만 반영
async function buildMatrix(userId, businessId, transaction) {
  const rows = await NotificationPref.findAll({ where: { user_id: userId, business_id: businessId }, transaction });
  const matrix = {};
  for (const ev of EVENT_KINDS) {
    matrix[ev] = {};
    for (const ch of CHANNELS) matrix[ev][ch] = true;
  }
  for (const r of rows) {
    if (matrix[r.event_kind]) matrix[r.event_kind][r.channel] = r.enabled;
  }
  return matrix;
}

// 한 채널을 모든 종류에 켜고 끈다 — «이메일 다 끄기» (2026-10-22 Irene).
//   종류 목록은 화면에서 받지 않는다(서버 EVENT_KINDS 전부). 본인 행만, 한 트랜잭션(반쪽 상태 없음).
async function setChannelForAll(userId, businessId, channel, enabled) {
  return sequelize.transaction(async (transaction) => {
    for (const eventKind of EVENT_KINDS) {
      const [row] = await NotificationPref.findOrCreate({
        where: { user_id: userId, business_id: businessId, event_kind: eventKind, channel },
        defaults: { enabled },
        transaction,
      });
      if (row.enabled !== enabled) await row.update({ enabled }, { transaction });
    }
    return buildMatrix(userId, businessId, transaction);
  });
}

module.exports = { EVENT_KINDS, CHANNELS, buildMatrix, setChannelForAll };
