const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 견적 품목 — Quote : QuoteItem = 1 : N
class QuoteItem extends Model {}

QuoteItem.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  quote_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'quotes', key: 'id' } },
  description: { type: DataTypes.STRING(500), allowNull: false },
  quantity: { type: DataTypes.DECIMAL(10, 2), defaultValue: 1 },
  unit_price: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  // 자동 채움 추적 — task_hours 는 tasks.id, recurring 은 subscription 참조
  source_type: {
    type: DataTypes.ENUM('task_hours', 'manual', 'recurring'),
    defaultValue: 'manual',
  },
  source_ref_id: { type: DataTypes.BIGINT, allowNull: true },
  order_index: { type: DataTypes.INTEGER, defaultValue: 0 },
}, {
  sequelize,
  tableName: 'quote_items',
  timestamps: true,
  underscored: true,
  indexes: [{ fields: ['quote_id'] }],
});

module.exports = QuoteItem;
