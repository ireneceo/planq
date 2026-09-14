const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectNote extends Model {}

ProjectNote.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  // 프로젝트 혹은 conversation 둘 중 하나 이상은 반드시 세팅. 독립 대화는 project_id null + conversation_id.
  project_id: { type: DataTypes.BIGINT, allowNull: true },
  conversation_id: { type: DataTypes.INTEGER, allowNull: true },
  email_thread_id: { type: DataTypes.INTEGER, allowNull: true }, // N+87 Phase C — 메일 스레드 노트
  // ★ 2026-09-14 — Q sale 상담 메모 (Irene: *"메모라고 메모남기기가 댓글처럼 …
  //   채팅방 보면 메모를 공개범위 선택해서 할 수 잇잖아. 그거 그대로 하자."*)
  //   상담 행의 **기준**이 무엇인지가 곧 이 세 칸이다: 메일이면 email_thread_id,
  //   대화면 conversation_id, 등록된 고객이면 client_id. 새 표를 만들지 않는다 —
  //   공개범위·작성자·초안·삭제 규칙이 이미 여기 한 벌로 있다(베끼면 한쪽만 고쳐진다).
  client_id: { type: DataTypes.INTEGER, allowNull: true },
  author_user_id: { type: DataTypes.INTEGER, allowNull: false },
  visibility: {
    type: DataTypes.ENUM('personal', 'internal', 'shared'),
    allowNull: false,
    comment: 'personal: 본인만 | internal: 내부 멤버 | shared: 내부 + 관련 고객',
  },
  // N+67 — 4단계 visibility 통합. personal→L1 / internal→L3 / shared→L4.
  vlevel: {
    type: DataTypes.ENUM('L1', 'L2', 'L3', 'L4'),
    allowNull: true,
    defaultValue: null,
  },
  target_member_ids: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  body: { type: DataTypes.TEXT, allowNull: false },
}, {
  sequelize,
  tableName: 'project_notes',
  timestamps: true,
  underscored: true,
});

// N+67 — vlevel ↔ visibility 양방향 동기
ProjectNote.addHook('beforeSave', (n) => {
  if (n.vlevel) {
    n.visibility = n.vlevel === 'L1' ? 'personal' : n.vlevel === 'L4' ? 'shared' : 'internal';
  } else {
    n.vlevel = n.visibility === 'personal' ? 'L1' : n.visibility === 'shared' ? 'L4' : 'L3';
  }
});

module.exports = ProjectNote;
