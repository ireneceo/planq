// 배포 시점 개발 현황 — 플랫폼 관리자 전용.
//
// Irene 2026-09-03: "배포 할 때마다 현재 작업중, 완료처리한 거, 진행중인 거, 이슈된거,
//   앞으로 해야 할 거 리스트업 해줘. 변경 후 바뀌는 현상, 추가로 체크해야 할 영역도 꼭 넣어.
//   개발자/관리자 시선으로 해."
//
// ★ 릴리즈노트(HelpArticle)와 같은 곳에 두지 않는다. HelpArticle.visibility 는
//   ('public','authenticated') 두 값뿐이라, 넣는 순간 routes/wiki.js·whats_new.js·blog.js 로
//   **모든 로그인 사용자**에게 흘러간다. 여기에는 미공개 취약점 서술이 실린다.
//
// ★ 키는 version 이 아니라 commit_to 다. 버전은 며칠씩 안 오르는데 배포는 하루 5회도 한다
//   (2026-09-03 실측). version UNIQUE 로 잡으면 그 5회가 1행으로 덮여 이력이 사라진다.
//
// ★ 기계가 아는 값은 사람이 적지 않는다 — 별도 컬럼이다. 배포 스크립트가 이미 들고 있는 값을
//   그대로 주입한다. sections 에 사람이 같은 값을 또 적게 두면 반드시 갈라진다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class DevStatusReport extends Model {}

DevStatusReport.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  // ── 기계가 채우는 사실 (배포 스크립트 --meta) ─────────────────────
  commit_to: { type: DataTypes.STRING(40), allowNull: false, unique: true },   // 이 배포의 HEAD = 키
  commit_from: { type: DataTypes.STRING(40), allowNull: true },                // 직전 배포 커밋
  version: { type: DataTypes.STRING(20), allowNull: true },                    // 표시용 (키 아님)
  deployed_at: { type: DataTypes.DATE, allowNull: false },
  backup_dir: { type: DataTypes.STRING(200), allowNull: true },                // 롤백 경로
  closed_feedback_ids: { type: DataTypes.JSON, allowNull: true },              // 이번 배포로 닫은 신고
  kept_open_ids: { type: DataTypes.JSON, allowNull: true },                    // 일부러 열어둔 신고
  pdf_check: { type: DataTypes.STRING(40), allowNull: true },
  release_note_published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  schema_changed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

  // ── 사람이 쓰는 서술 ────────────────────────────────────────────
  // sections JSON v1 — 9 섹션. 값은 **텍스트로만** 렌더한다(HTML 렌더 금지, 저장형 XSS).
  //   working_on[]       {title, detail, owner, since}          이번 배포 시점에 dev 에서 손대고 있는 것(미커밋·미배포)
  //   completed[]        {title, detail, commit, verified}      verified: fable_pass|opus_only|none
  //   in_progress[]      {title, detail, blocked_by}            여러 사이클에 걸친 열린 기능(설계 완료·착수 대기 포함)
  //   issues[]           {title, detail, severity, area, feedback_id}
  //   backlog[]          {title, detail, priority}
  //   behavior_changes[] {title, before, after, affected}       변경 후 바뀌는 현상
  //   check_areas[]      {area, why, how}                       추가로 체크해야 할 영역
  //   migrations[]       {script, table, kind, rollback_note}
  //   blocked_on_human[] {what, who, since}                     Irene 손이 필요한 것
  //   tooling_health[]   {tool, symptom, workaround}            게이트가 반쪽인 이유
  //   undeployed[]       {commit, subject}                      이 배포에 안 들어간 것
  sections: { type: DataTypes.JSON, allowNull: false },

  author_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
}, {
  sequelize,
  modelName: 'DevStatusReport',
  tableName: 'dev_status_reports',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['deployed_at'] },
    { unique: true, fields: ['commit_to'] },
  ],
});

module.exports = DevStatusReport;
