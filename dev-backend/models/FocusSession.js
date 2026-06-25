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
    // 운영 #94 — 방치 세션 누적 차단.
    //   포커스를 멈추지 않고 PWA/탭을 닫으면 그 세션은 active 로 남아, 다음 /start 시점(며칠 뒤)에야
    //   ended_at=now 로 종료된다. 그 결과 한 세션이 8일(190h) 을 기록 → 주간 진척 그래프 실제선이
    //   168h(일주일) 을 초과하는 비현실값으로 오염되고, recompute 시 task.actual_hours 까지 부풀려졌다.
    //   heartbeat(클라 30s) 가 멈춘 last_activity_at 이후는 "사용자 부재" 이므로 비계상한다.
    const GRACE_SEC = 300;          // last_activity 후 유예 5분 (heartbeat 30s 의 충분한 여유)
    const HARD_CAP_SEC = 12 * 3600; // 단일 세션 절대 상한 12h (last_activity 없을 때 backstop)
    const end = this.ended_at || new Date();
    const total = Math.max(0, Math.floor((end.getTime() - new Date(this.started_at).getTime()) / 1000));
    let pause = this.pause_total_sec || 0;
    // 현재 paused 면 진입 후 경과도 더해 보여줌 (정지 시간이 늘어남)
    if (this.state === 'paused' && this.paused_at) {
      pause += Math.max(0, Math.floor((Date.now() - new Date(this.paused_at).getTime()) / 1000));
    }
    let actual = Math.max(0, total - pause);
    // 방치 캡 — 마지막 활동(heartbeat)까지 + 유예. 정상 세션은 last_activity≈end 라 no-op,
    //   정상 pause 세션도 (last_activity-start) 가 활성구간을 정확히 담아 망가지지 않는다.
    if (this.last_activity_at) {
      const activeSpan = Math.max(0, Math.floor((new Date(this.last_activity_at).getTime() - new Date(this.started_at).getTime()) / 1000)) + GRACE_SEC;
      actual = Math.min(actual, activeSpan);
    }
    return Math.min(actual, HARD_CAP_SEC);
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
