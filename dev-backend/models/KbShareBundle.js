const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// N+93 — Q info(KB) 다건/카테고리 공유 번들 (#6).
// 단건 공유는 KbDocument.share_token. 번들은 별도 토큰이 여러 문서를 가리킨다.
//   kind='selection' → doc_ids JSON 의 문서들 (고정)
//   kind='category'  → category 의 현재 문서들 (live — 새 문서 추가되면 자동 포함)
class KbShareBundle extends Model {}

KbShareBundle.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.BIGINT, allowNull: false },
  token: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  kind: { type: DataTypes.ENUM('selection', 'category'), allowNull: false },
  doc_ids: { type: DataTypes.JSON, allowNull: true },        // kind='selection'
  category: { type: DataTypes.STRING(80), allowNull: true }, // kind='category'
  title: { type: DataTypes.STRING(200), allowNull: true },   // 공유 라벨 (선택)
  created_by: { type: DataTypes.INTEGER, allowNull: true },
  viewed_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  expires_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'kb_share_bundles',
  timestamps: true,
  underscored: true,
});

module.exports = KbShareBundle;
