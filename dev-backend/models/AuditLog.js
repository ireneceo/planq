const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class AuditLog extends Model {}

AuditLog.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  // on-behalf-of — 행위자(user_id)가 AI(Cue)처럼 위임받아 행동할 때, 그 권한의 원소유자.
  // 사람이 직접 한 행동은 NULL. Cue 는 항상 위임자(업무 요청자)의 권한으로만 행동하므로
  // "누구 권한으로 했는가" 가 audit_logs 만으로 재구성된다.
  acting_for_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'businesses', key: 'id' }
  },
  action: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  target_type: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  target_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  old_value: {
    type: DataTypes.JSON,
    allowNull: true
  },
  new_value: {
    type: DataTypes.JSON,
    allowNull: true
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true
  },
  // 이 기록을 언제까지 보관하기로 **약속했는가** (기록 시점 플랜 기준).
  //   실제 삭제는 이 값과 현재 플랜 기간 중 **긴 쪽**을 쓴다 — 플랜을 낮춰도 이미 쌓인
  //   기록의 수명이 줄지 않게(services/retentionPolicy.js 래칫 업).
  //   ★ NULL = **보존**. 판단할 근거가 없다는 뜻이지 "지워도 된다" 가 아니다.
  retain_until: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  sequelize,
  tableName: 'audit_logs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'created_at'] },
    { fields: ['user_id', 'created_at'] },
    { fields: ['target_type', 'target_id'] },
    { fields: ['business_id', 'retain_until'], name: 'idx_audit_biz_retain' }
  ]
});

module.exports = AuditLog;
