// Q record 행 — values JSON 으로 모든 셀 데이터 저장.
// values: { col_id: value }. col_id 는 q_records.columns[].id 와 매핑.
// secret 타입 컬럼 값은 평문 저장 후 라우터에서 권한별 마스킹 처리 (1차 — 향후 KMS).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class QRecordRow extends Model {}

QRecordRow.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  q_record_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'q_records', key: 'id' } },
  values: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  updated_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
}, {
  sequelize, tableName: 'q_record_rows', timestamps: true, underscored: true,
  indexes: [
    { fields: ['q_record_id', 'position'] },
  ],
});

module.exports = QRecordRow;
