// ProjectHistoryEntry — 사람이 **직접 적는** 프로젝트 히스토리(주요 이슈).
//
// ★ 2026-09-13 (Irene: *"프로젝트 히스토리 탭에 수동으로 히스토리 추가하는 기능이 없어.
//   프로젝트 히스토리는 주요 이슈를 직접 넣는 거야. 날짜 제목 내용 등 지금 히스토리에서
//   주로 표시하는 형태로 해줘."*)
//
// ★ 왜 `project_notes`(메모)·`project_issues` 를 안 쓰는가 — 둘 다 **제목도 날짜도 없다**(본문뿐).
//   그리고 뜻이 다르다: 메모는 내부 기록이고 visibility 축이 있으며, 이슈는 대화/메일 스레드에 붙는다.
//   여기 들어가는 것은 "언제 무슨 일이 있었나" 를 사람이 **골라서 박제한 것**이다.
//   기존 표에 컬럼을 얹으면 세 가지 뜻이 한 표에 섞여, 고칠 때 어느 쪽이 깨지는지 알 수 없게 된다.
//
// ★ `occurred_at` 은 **사람이 정한다**(created_at 과 다르다). 지난주에 있었던 일을 오늘 적을 수 있어야
//   히스토리가 사실과 맞는다. 정렬·표시는 occurred_at 기준이다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectHistoryEntry extends Model {}

ProjectHistoryEntry.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  project_id: { type: DataTypes.BIGINT, allowNull: false },
  /** 사람이 정한 시점 — 적은 시각(created_at)이 아니다 */
  occurred_at: { type: DataTypes.DATE, allowNull: false },
  title: { type: DataTypes.STRING(200), allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: false },
  /** 지운 것은 목록에서 빠지되 원장에는 남는다(감사 로그와 짝) */
  deleted_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'project_history_entries',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'project_id', 'occurred_at'] },
  ],
});

module.exports = ProjectHistoryEntry;
