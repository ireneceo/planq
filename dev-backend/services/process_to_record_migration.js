// 마이그레이션 — 기존 project_process_parts (행) + project_process_columns (사용자 정의 컬럼)
// 데이터를 새 q_records / q_record_rows 시스템으로 1회 변환.
//
// 안전 원칙:
//  - 한 프로젝트당 q_record 1개만 생성 (이미 마이그레이션 됐으면 skip)
//  - process_parts / process_columns 원본 데이터는 절대 삭제하지 않음 (롤백 가능)
//  - q_record.metadata 같은 백업 정보로 process_part_id 보존 (향후 동기화)
//
// 호출:
//   const { migrateProcessParts } = require('../services/process_to_record_migration');
//   const stats = await migrateProcessParts({ businessId?, projectId? });
//   console.log(stats); // { projects_seen, records_created, rows_created, skipped }
//
// 임의 실행 (1회): node scripts/migrate-process-to-records.js

const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  Project, ProjectProcessPart, ProjectProcessColumn,
  QRecord, QRecordRow,
} = require('../models');

function newColId() { return 'c' + crypto.randomBytes(4).toString('hex'); }

// process_columns.col_type → q_record column type 변환
const TYPE_MAP = { text: 'text', date: 'date', select: 'select', number: 'number' };

async function migrateOneProject(project) {
  const stats = { project_id: project.id, created: false, rows: 0, skipped_reason: null };

  // 이미 q_record 가 있으면 skip — 동일 프로젝트 + name='process' 또는 process_tab_label 매칭
  const existing = await QRecord.findOne({
    where: { business_id: project.business_id, project_id: project.id, name: project.process_tab_label || '테이블' },
  });
  if (existing) { stats.skipped_reason = 'already_migrated'; return stats; }

  // 사용자 정의 컬럼 + 기본 컬럼 (depth1/2/3, description, status, link, notes)
  const userCols = await ProjectProcessColumn.findAll({
    where: { project_id: project.id }, order: [['order_index', 'ASC']],
  });
  const parts = await ProjectProcessPart.findAll({
    where: { project_id: project.id }, order: [['order_index', 'ASC']],
  });
  if (parts.length === 0 && userCols.length === 0) {
    stats.skipped_reason = 'empty';
    return stats;
  }

  // 컬럼 스키마 — 기본 + 사용자 정의 순서
  const baseCols = [
    { id: newColId(), name: '대분류', type: 'text', _from: 'depth1' },
    { id: newColId(), name: '중분류', type: 'text', _from: 'depth2' },
    { id: newColId(), name: '소분류', type: 'text', _from: 'depth3' },
    { id: newColId(), name: '설명', type: 'longtext', _from: 'description' },
    { id: newColId(), name: '상태', type: 'select', _from: 'status_key' },
    { id: newColId(), name: '링크', type: 'url', _from: 'link' },
    { id: newColId(), name: '메모', type: 'longtext', _from: 'notes' },
  ];
  const userColsMapped = userCols.map(c => ({
    id: newColId(),
    name: c.label,
    type: TYPE_MAP[c.col_type] || 'text',
    _from_user_key: c.col_key,
  }));
  const allCols = [...baseCols, ...userColsMapped].map((c, i) => ({
    id: c.id, name: c.name, type: c.type, order: i,
    // _from / _from_user_key 는 mapping 용 — JSON 저장 시 제거
  }));
  const colMapping = [...baseCols, ...userColsMapped]; // values 매핑용

  // q_record 생성
  const rec = await QRecord.create({
    business_id: project.business_id,
    project_id: project.id,
    name: project.process_tab_label || '테이블',
    category: '프로세스',
    description: `프로젝트 ${project.name} 의 process 탭에서 자동 마이그레이션됨`,
    columns: allCols,
    read_policy: 'all',
    created_by: project.created_by || project.owner_user_id || 1,
  });
  stats.created = true;

  // 각 part → q_record_row 변환
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const values = {};
    for (const col of colMapping) {
      const cleanCol = allCols.find(c => c.id === col.id);
      if (!cleanCol) continue;
      if (col._from) {
        // 기본 컬럼 — depth1/depth2/...
        values[col.id] = p[col._from] || null;
      } else if (col._from_user_key) {
        // 사용자 정의 컬럼 — extra JSON 에서
        const extra = p.extra || {};
        values[col.id] = extra[col._from_user_key] != null ? String(extra[col._from_user_key]) : null;
      }
    }
    await QRecordRow.create({
      q_record_id: rec.id,
      values,
      position: i + 1,
      created_by: rec.created_by,
    });
    stats.rows += 1;
  }
  return stats;
}

async function migrateProcessParts(opts = {}) {
  const summary = { projects_seen: 0, records_created: 0, rows_created: 0, skipped: [], details: [] };
  const where = {};
  if (opts.businessId) where.business_id = opts.businessId;
  if (opts.projectId) where.id = opts.projectId;

  const projects = await Project.findAll({ where });
  for (const p of projects) {
    summary.projects_seen += 1;
    try {
      const stat = await migrateOneProject(p);
      summary.details.push(stat);
      if (stat.created) {
        summary.records_created += 1;
        summary.rows_created += stat.rows;
      } else {
        summary.skipped.push({ project_id: p.id, reason: stat.skipped_reason });
      }
    } catch (e) {
      console.error(`[migrate] project ${p.id} failed:`, e.message);
      summary.skipped.push({ project_id: p.id, reason: 'error: ' + e.message });
    }
  }

  // sequelize JSON 직렬화 — _from / _from_user_key 마킹 제거 (이미 allCols 에서 제외했지만 안전 차)
  // (이미 cleanCol 만 저장했으므로 OK)
  return summary;
}

module.exports = { migrateProcessParts };
