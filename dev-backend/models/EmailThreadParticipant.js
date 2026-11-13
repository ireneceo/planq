// EmailThreadParticipant — 스레드별 멤버 (Q Mail M1)
// 읽음 추적 + 담당 + 팔로우 + 동시 작업 인디케이터.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class EmailThreadParticipant extends Model {}

EmailThreadParticipant.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  thread_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'email_threads', key: 'id' }, onDelete: 'CASCADE' },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  is_assigned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  is_following: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  last_read_message_id: { type: DataTypes.INTEGER, allowNull: true },
  last_read_at: { type: DataTypes.DATE, allowNull: true },
  // «안 읽음으로 표시»(나만) — 1 이면 커서와 상관없이 나에게 안 읽음. 읽음 쓰기(markReadFor)가 내린다.
  //   읽고 쓰는 곳은 services/mailRead 한 곳(가드 mailread) · docs/QMAIL_MARK_UNREAD_DESIGN.md
  marked_unread: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // 동시 작업 인디케이터 (1.7)
  is_viewing: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  viewing_started_at: { type: DataTypes.DATE, allowNull: true },
  is_drafting: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  drafting_started_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize, tableName: 'email_thread_participants', timestamps: true, underscored: true,
  indexes: [
    { unique: true, fields: ['thread_id', 'user_id'], name: 'email_thread_participants_unique' },
    { fields: ['user_id', 'is_assigned', 'is_following'], name: 'email_thread_participants_user' },
  ],
});

module.exports = EmailThreadParticipant;
