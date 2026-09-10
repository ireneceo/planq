// ScheduleBatch — 일정 일괄 수정의 **되돌리기 원장** (2026-09-10 신설).
//
// ★ 왜 원장이 필요한가: 기간을 한 번에 바꾸는 것이 무서운 이유는 **되돌릴 수 없어서**다.
//   Irene: *"전체적으로 잡고 싶거나 변경해야 할 때 엄두가 안나. 특히 기간들."*
//   되돌리기가 없으면 사용자는 이 기능을 쓰지 않는다. 그래서 기능의 절반이 이 표다.
//
// ★ `items` 에 **전·후를 둘 다** 적는다. 후만 적으면 되돌릴 근거가 없고, 전만 적으면
//   무엇이 적용됐는지 확인할 근거가 없다. 되돌리기는 items 를 역으로 같은 액션에 태운다.
//
// ★ 미리보기 단계(applied_at IS NULL)도 남긴다 — 사용자가 무엇을 물어봤고 AI 가 무엇을
//   제안했는지가 남아야 나중에 판단을 되짚을 수 있다.
//
// business_id 는 멀티테넌트 WHERE 격리용. project_id 와 같은 워크스페이스여야 한다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ScheduleBatch extends Model {}

ScheduleBatch.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  project_id: { type: DataTypes.BIGINT, allowNull: false },
  created_by: { type: DataTypes.INTEGER, allowNull: false },

  /** 사용자가 입력한 말 그대로 — 나중에 "왜 이렇게 바뀌었나" 를 되짚는 유일한 근거다. */
  prompt: { type: DataTypes.TEXT, allowNull: true },
  /** 어떤 연산이었나 — 'shift' | 'compress'. 새 연산을 더하면 여기 값을 늘린다. */
  op: { type: DataTypes.STRING(30), allowNull: false },
  /** 연산 인자 (일수·목표마감 등). 재현에 필요하다. */
  params: { type: DataTypes.JSON, allowNull: true },

  /**
   * 실제 변경 목록 — `[{task_id, before:{start_date,due_date}, after:{...}}]`
   * ★ 되돌리기의 유일한 근거. 여기 before 가 없으면 원복할 수 없다.
   */
  items: { type: DataTypes.JSON, allowNull: true },
  /** 적용 전에 화면이 보여준 경고(주말 보정·순서 역전·완료 제외 등). 판단의 맥락이다. */
  warnings: { type: DataTypes.JSON, allowNull: true },

  applied_at: { type: DataTypes.DATE, allowNull: true },
  reverted_at: { type: DataTypes.DATE, allowNull: true },
  reverted_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  modelName: 'ScheduleBatch',
  tableName: 'schedule_batches',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'project_id'] },
    { fields: ['created_at'] },
  ],
});

module.exports = ScheduleBatch;
