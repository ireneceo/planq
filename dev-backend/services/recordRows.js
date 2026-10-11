// 표 문서 행 추가 — 맨 끝 또는 어떤 행의 위/아래에 끼워 넣기 (2026-10-11)
//   Irene: "행사이에 행을 추가하거나 열 사이에 열을 추가하고 싶은 건 어떻게 해?"
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { QRecordRow } = require('../models');

/**
 * @returns 만든 행, 또는 기준 행이 이 표에 없으면 null
 */
async function insertRow(recordId, values, userId, { beforeRowId, afterRowId } = {}) {
  const anchorId = Number(beforeRowId || afterRowId) || null;
  const placeBefore = !!Number(beforeRowId);
  return sequelize.transaction(async (transaction) => {
    if (!anchorId) {
      const last = await QRecordRow.max('position', { where: { q_record_id: recordId }, transaction });
      return QRecordRow.create({ q_record_id: recordId, values, position: (last || 0) + 1, created_by: userId }, { transaction });
    }
    // 옛 표는 position 이 겹친다(문서 생성 때 0 으로 시드) — 겹치면 화면 순서(position, id)대로 1..n 으로 먼저 고른다.
    //   안 그러면 «이 행 아래» 가 같은 번호 무리의 맨 끝으로 가 엉뚱한 자리에 들어간다.
    const [[cnt]] = await sequelize.query(
      'SELECT COUNT(*) AS n, COUNT(DISTINCT position) AS d FROM q_record_rows WHERE q_record_id = ?',
      { replacements: [recordId], transaction });
    if (Number(cnt.d) < Number(cnt.n)) {
      await sequelize.query(
        'UPDATE q_record_rows t JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) AS rn FROM q_record_rows WHERE q_record_id = ?) x ON x.id = t.id SET t.position = x.rn',
        { replacements: [recordId], transaction });
    }
    const anchor = await QRecordRow.findOne({ where: { id: anchorId, q_record_id: recordId }, transaction });
    if (!anchor) return null;   // 다른 표의 행 id 로는 자리를 잡지 않는다
    const pos = placeBefore ? anchor.position : anchor.position + 1;
    await QRecordRow.increment('position', { by: 1, where: { q_record_id: recordId, position: { [Op.gte]: pos } }, transaction });
    return QRecordRow.create({ q_record_id: recordId, values, position: pos, created_by: userId }, { transaction });
  });
}

module.exports = { insertRow };
