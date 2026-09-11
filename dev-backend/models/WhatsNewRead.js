// 새 소식 개별 읽음 — 2026-09-11 Irene: "좌측 메뉴 상단 스피커도 드롭다운하면 알림처럼 모두 읽음 표시 나오게 해야지
//   그냥 왜 다 읽은 걸로 돼? 알림이랑 똑같이 해."
//
// 옛 모델은 사람당 워터마크 하나(users.whats_new_seen_at)뿐이라 **드롭다운을 여는 순간 전부 읽음**이 됐고,
// 알림처럼 "눌러 본 것만 읽음" 을 표현할 자리가 없었다. 워터마크는 "모두 읽음" 으로 남기고, 개별 읽음은 여기 행으로 남긴다.
// 미읽음 = 워터마크 이후 발행 AND 이 표에 행이 없음.
const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

class WhatsNewRead extends Model {}

WhatsNewRead.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  // help_articles.slug — 새 소식은 플랫폼 공통 콘텐츠라 business_id 가 없다(Q위키와 같은 축)
  slug: { type: DataTypes.STRING(200), allowNull: false },
  read_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'whats_new_reads',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['user_id', 'slug'], name: 'whats_new_reads_user_slug' }],
});

module.exports = WhatsNewRead;
