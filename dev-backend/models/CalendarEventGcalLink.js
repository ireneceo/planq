// CalendarEventGcalLink — PlanQ 일정 ↔ 구글 캘린더 이벤트 링크 (2026-07-27)
//
// 왜 컬럼이 아니라 테이블인가:
//   기존 calendar_events.gcal_event_id 는 **목적지가 하나**(워크스페이스 캘린더)라는 전제였다.
//   개인 캘린더 쓰기가 열리면서 한 일정이 팀 캘린더 + 개인 캘린더 N곳에 동시에 존재할 수 있게 됐다.
//   기존 컬럼은 workspace 링크로 그대로 두고(회귀 0), 신규 목적지를 여기에 쌓는다.
//
// 링크가 있어야 "체크를 끄면 구글에서도 지워진다" 가 성립한다 — 어느 이벤트를 지울지 알아야 하므로.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class CalendarEventGcalLink extends Model {}

CalendarEventGcalLink.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  // ★ references/onDelete 를 반드시 모델에 둔다 — 마이그레이션 DDL 에만 FK 를 쓰면,
  //   sync-database.js(Sequelize alter)가 **먼저** 이 테이블을 만들어버리는 경로에서
  //   FK 없이 생성되고 이후 마이그레이션은 hasTable 로 skip 해 **FK 가 영구 누락**된다.
  //   그러면 일정을 지워도 링크가 고아로 남아 구글에 유령 일정이 남는다.
  //   배포 스크립트는 sync-database 를 마이그레이션보다 먼저 돌리고(:222 vs :248),
  //   CLAUDE.md 표준 절차도 수동 `node sync-database.js` 를 지시하므로 순서로는 못 막는다.
  event_id: {
    type: DataTypes.BIGINT, allowNull: false,
    references: { model: 'calendar_events', key: 'id' }, onDelete: 'CASCADE',
  },
  target: { type: DataTypes.ENUM('workspace', 'personal'), allowNull: false },
  // personal 일 때만 채워진다. workspace 는 워크스페이스당 하나뿐이라 NULL.
  connection_id: { type: DataTypes.INTEGER, allowNull: true },
  user_id: { type: DataTypes.INTEGER, allowNull: true },
  gcal_event_id: { type: DataTypes.STRING(255), allowNull: false },
  gcal_calendar_id: { type: DataTypes.STRING(255), allowNull: true, defaultValue: 'primary' },
  // 이 구글 이벤트가 **Google Meet 회의를 들고 있는가.**
  //   회수 루프(reconcile)는 목적지가 wanted 에서 빠지면 구글 이벤트를 지운다. 그런데 회의 링크는
  //   이미 참석자에게 배포된 자원이라, 체크박스 하나로 조용히 파괴되면 복구할 방법이 없다.
  //   → 이 플래그가 선 링크는 회수 대상에서 제외하고 내용 갱신만 한다.
  //   ★ 단 하나의 예외: target='workspace' + 비공개 전환(#126) 은 **보호를 무시하고 삭제**한다.
  //     프라이버시가 회의 링크 보존보다 우선이다 (calendarSync.reconcile 참조).
  //   uniq_event_target_conn 키에는 들어가지 않는다 — 목적지 정체성은 (event,target,conn) 그대로.
  holds_meeting: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // 우리가 **마지막으로 밀어 넣은** 구글 이벤트 버전의 etag.
  //   역방향 폴링이 자기가 만든 변경을 되받아 무한 루프를 도는 것을 막는 **1차 필터**다.
  //   ★ 정본 가드는 아니다 — 구글 etag 는 참석자 응답·리마인더처럼 우리가 안 미는 메타데이터
  //     변화로도 바뀐다. 그래서 역방향은 etag 로 1차 거른 뒤 **화이트리스트 필드 diff 가 비면
  //     no-op** 이라는 멱등 가드를 한 겹 더 둔다(calendarReverseSync).
  last_pushed_etag: { type: DataTypes.STRING(255), allowNull: true },
}, {
  sequelize,
  tableName: 'calendar_event_gcal_links',
  timestamps: true, underscored: true,
  indexes: [
    { unique: true, fields: ['event_id', 'target', 'connection_id'], name: 'uniq_event_target_conn' },
    { fields: ['event_id'], name: 'idx_event' },
    { fields: ['connection_id'], name: 'idx_conn' },
  ],
});

module.exports = CalendarEventGcalLink;
