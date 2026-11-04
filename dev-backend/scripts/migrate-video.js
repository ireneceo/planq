// 2026-11-04 시연 영상 정기 제작·발행 자동화 D′1 (docs/DEMO_VIDEO_DESIGN.md §20) — 멱등.
//
//   video_projects(요청 = 영상 1편) · video_versions(대본 판) · video_jobs(작업자 대기열) · video_settings(일정·작업자 신호, 1행)
//   ★ 정본은 운영(§20.1 B′) — 운영에서도 돈다. **코드보다 먼저**(배포 슬롯, migrate-social 옆).
//   롤백: 코드 revert 만. 표 잔존은 무해.
//
//   사용: node scripts/migrate-video.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const TAG = '[migrate-video]';
const CS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

async function ensureTable(name, ddl) {
  const [t] = await sequelize.query(`SHOW TABLES LIKE '${name}'`);
  if (t.length) { console.log(`${TAG} ${name} 이미 있음 — skip`); return false; }
  if (DRY) { console.log(`${TAG} (dry) CREATE TABLE ${name}`); return true; }
  await sequelize.query(ddl);
  console.log(`${TAG} ${name} 생성`);
  return true;
}

const TABLES = [
  ['video_projects', `CREATE TABLE IF NOT EXISTS video_projects (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    mode ENUM('recording','instruction','brand') NOT NULL DEFAULT 'instruction',
    brief TEXT NULL,
    target_seconds INT NOT NULL DEFAULT 30,
    aspects JSON NULL,
    template VARCHAR(60) NULL,
    music VARCHAR(120) NULL,
    placement VARCHAR(40) NULL,
    channels JSON NULL,
    status ENUM('planned','producing','needs_review','awaiting_link','published','failed','archived') NOT NULL DEFAULT 'planned',
    plan_order INT NOT NULL DEFAULT 0,
    auto_approve TINYINT(1) NOT NULL DEFAULT 1,
    attempts TINYINT NOT NULL DEFAULT 0,
    producing_started_at DATETIME NULL,
    review_reason VARCHAR(40) NULL,
    review_detail TEXT NULL,
    current_version_id INT NULL,
    approved_version_id INT NULL,
    gate_overrides JSON NULL,
    stage_from ENUM('script','render') NOT NULL DEFAULT 'script',
    drive_folder_id VARCHAR(120) NULL,
    youtube_url VARCHAR(300) NULL,
    youtube_video_id VARCHAR(20) NULL,
    youtube_meta JSON NULL,
    published_at DATETIME NULL,
    published_by INT NULL,
    sns_publish_by INT NULL,
    sns_publish_at DATETIME NULL,
    sns_spread ENUM('all','daily') NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    deleted_at DATETIME NULL,
    KEY video_projects_plan (status, plan_order),
    KEY video_projects_youtube (youtube_video_id)
  ) ${CS}`],
  ['video_versions', `CREATE TABLE IF NOT EXISTS video_versions (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    version_no INT NOT NULL,
    parent_version_id INT NULL,
    script LONGTEXT NOT NULL,
    change_note VARCHAR(500) NULL,
    source ENUM('ai','human','revert','auto') NOT NULL DEFAULT 'ai',
    ai_meta JSON NULL,
    status ENUM('draft','approved','rendering','rendered','failed') NOT NULL DEFAULT 'draft',
    outputs JSON NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY video_versions_no (project_id, version_no)
  ) ${CS}`],
  ['video_jobs', `CREATE TABLE IF NOT EXISTS video_jobs (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    kind ENUM('produce','revise','prep_voice','reupload') NOT NULL,
    project_id INT NOT NULL,
    version_id INT NULL,
    payload JSON NULL,
    status ENUM('queued','running','done','failed','canceled') NOT NULL DEFAULT 'queued',
    attempts TINYINT NOT NULL DEFAULT 0,
    priority INT NOT NULL DEFAULT 0,
    claimed_by VARCHAR(120) NULL,
    claimed_at DATETIME NULL,
    heartbeat_at DATETIME NULL,
    stage VARCHAR(20) NULL,
    progress DECIMAL(5,3) NULL,
    log TEXT NULL,
    result JSON NULL,
    error_code VARCHAR(40) NULL,
    error_message VARCHAR(2000) NULL,
    finished_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    KEY video_jobs_queue (status, priority, id),
    KEY video_jobs_project (project_id)
  ) ${CS}`],
  ['video_settings', `CREATE TABLE IF NOT EXISTS video_settings (
    id INT NOT NULL PRIMARY KEY,
    schedule JSON NULL,
    worker_seen_at DATETIME NULL,
    worker_name VARCHAR(120) NULL,
    updated_at DATETIME NOT NULL
  ) ${CS}`],
];

(async () => {
  try {
    for (const [name, ddl] of TABLES) await ensureTable(name, ddl);
    if (!DRY) {
      await sequelize.query(`INSERT IGNORE INTO video_settings (id, schedule, updated_at) VALUES (1, ?, NOW())`,
        { replacements: [JSON.stringify({ enabled: false, per_day: 1, window: { from: '01:00', to: '06:00' }, weekdays: [1, 2, 3, 4, 5, 6, 7], publish_spread: 'all' })] });
      console.log(`${TAG} video_settings 1행 확인`);
    }
    await sequelize.close();
  } catch (e) { console.error(TAG, e.message); process.exit(1); }
})();
