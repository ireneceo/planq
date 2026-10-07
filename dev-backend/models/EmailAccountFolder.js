// 메일 계정의 «받은편지함 밖» 폴더 — 업체 보낸편지함(sent)·스팸함(spam)을 읽기 전용으로 비춘다.
//
// 설계 정본: docs/MAIL_SENT_SPAM_SYNC_DESIGN.md (Fable 판정 2026-10-07 절이 본문보다 우선)
//
// ★ 커서는 **폴더마다** 다르다 — IMAP uid 공간은 메일함별이다. `email_accounts.imap_last_uid` 는
//   받은편지함(INBOX) 커서로 그대로 남고, 여기 `last_uid` 는 그 역할의 폴더 커서다.
// ★ 폴더 이름을 하드코딩하지 않는다 — SPECIAL-USE(\Sent·\Junk)로 찾고, 없을 때만 이름 후보로 찾는다.
//   못 찾으면 `folder=NULL`(= 그 역할은 꺼진 상태)로 남긴다. 조용히 INBOX 를 다시 읽지 않는다.
// ★ `enabled` 는 사용자의 선택(계정 설정 화면 토글)이다. 기본 켜짐.
//   폴더를 못 찾았으면 enabled 여도 돌지 않는다 — 화면이 «찾지 못함» 을 말한다.
// ★ UIDVALIDITY 가 바뀌면 그 폴더 커서를 0 으로 = 그 역할의 «첫 가져오기» 규칙(Sent 30일·Spam 14일)으로 되돌린다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class EmailAccountFolder extends Model {}

EmailAccountFolder.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  account_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'email_accounts', key: 'id' }, onDelete: 'CASCADE',
  },
  role: { type: DataTypes.ENUM('sent', 'spam'), allowNull: false },
  // 업체 쪽 실제 폴더 경로(예: "[Gmail]/Sent Mail", "보낸메일함"). NULL = 찾지 못함
  folder: { type: DataTypes.STRING(255), allowNull: true },
  uid_validity: { type: DataTypes.BIGINT, allowNull: true },
  last_uid: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  last_synced_at: { type: DataTypes.DATE, allowNull: true },
  last_error: { type: DataTypes.STRING(1000), allowNull: true },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  // 마지막으로 폴더 목록을 훑은 시각 — 못 찾은 역할은 하루에 한 번만 다시 찾는다
  discovered_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  modelName: 'EmailAccountFolder',
  tableName: 'email_account_folders',
  timestamps: true,
  underscored: true,
  indexes: [
    // 컬럼 레벨 unique 금지 — sync 때마다 인덱스가 쌓인다(EmailAccountAlias 와 같은 이유)
    { unique: true, fields: ['account_id', 'role'], name: 'email_account_folders_account_role' },
  ],
});

module.exports = EmailAccountFolder;
