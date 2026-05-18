// FocusSession — 업무 흐름 (Work Flow) 포커스 세션
//
// 사이클 N+26 신규. 개인 시간 추적 (본인만 접근, owner/admin 도 못 봄).
//
// 상태 머신:
//   active  ─ pause()  ─→ paused
//   paused  ─ resume() ─→ active
//   active/paused ─ stop() ─→ stopped (불변)
//
// 한 user 의 active+paused row 동시 최대 1 (라우트 가드).
// task_id NULL = 무지정 일반 포커스 / 있으면 특정 업무 시간 누적.
//
// actual_seconds = (ended_at - started_at) - pause_total_sec (응답 시 계산)

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class FocusSession extends Model {
  /** 진행 중인 실제 누적 초 (paused 중인 경우 paused 진입 직전까지) */
  computeActualSeconds() {
    const end = this.ended_at || new Date();
    const total = Math.max(0, Math.floor((end.getTime() - new Date(this.started_at).getTime()) / 1000));
    let pause = this.pause_total_sec || 0;
    // 현재 paused 면 진입 후 경과도 더해 보여줌 (정지 시간이 늘어남)
    if (this.state === 'paused' && this.paused_at) {
      pause += Math.max(0, Math.floor((Date.now() - new Date(this.paused_at).getTime()) / 1000));
    }
    return Math.max(0, total - pause);
  }
}

FocusSession.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete: 'CASCADE',
  },
  business_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'businesses', key: 'id' },
    comment: '어느 워크스페이스 시점에서 시작했는지',
  },
  task_id: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'tasks', key: 'id' },
    onDelete: 'SET NULL',
    comment: 'NULL = 무지정 / 있으면 특정 업무 시간 누적',
  },
  state: {
    type: DataTypes.ENUM('active', 'paused', 'stopped'),
    allowNull: false, defaultValue: 'active',
  },
  started_at: { type: DataTypes.DATE, allowNull: false },
  ended_at: { type: DataTypes.DATE, allowNull: true },
  pause_total_sec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, comment: '누적 일시정지 초' },
  paused_at: { type: DataTypes.DATE, allowNull: true, comment: '현재 paused 면 진입 시각' },
  last_activity_at: { type: DataTypes.DATE, allowNull: true, comment: '유휴 감지용 마지막 활동' },
  auto_paused: { type: DataTypes.BOOLEAN, defaultValue: false, comment: '유휴로 자동 paused 인지' },
  end_reason: {
    type: DataTypes.STRING(30), allowNull: true,
    comment: 'manual / auto_idle / logout / browser_close / switch / stale',
  },
}, {
  sequelize,
  tableName: 'focus_sessions',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['user_id', 'state'], name: 'idx_user_state' },
    { fields: ['user_id', 'task_id'], name: 'idx_user_task' },
    { fields: ['business_id', 'started_at'], name: 'idx_biz_date' },
  ],
});

module.exports = FocusSession;
