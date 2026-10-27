// 프로젝트 연결(참조) — 쓰기·읽기 한 벌 (2026-10-27, docs/PROJECT_REFS_DESIGN.md · Fable GO-WITH-CHANGES).
//
//   Irene: «같은 문서가 여러 프로젝트에 연결되는 거면 어떻게 해? … 프로젝트 연결도 여러 개 연결해야 할 것 같아.»
//
//   계약
//   - 소속(project_id)은 하나 그대로 — 공개 범위·폴더·방송의 기준. 연결은 **보여 주는 자리만** 늘린다.
//   - 붙일 때: 원본을 읽을 수 있음 ∧ 대상 프로젝트가 보이고 그 프로젝트 멤버(또는 owner/admin) ∧ 같은 워크스페이스(아니면 404)
//     ∧ 원본이 «나만 보기»(L1) 아님 ∧ 지워지지 않음 ∧ 소속 프로젝트가 아님(409 already_home). 원본 편집 권한은 요구하지 않는다(참조 = 읽기).
//   - 뗄 때: 연결한 사람 ∨ 원본 편집자 ∨ 대상 프로젝트 PM ∨ owner/admin.
//   - 보여 줄 때: 원본 목록 술어(postListWhereByLevel·fileListWhereByLevel) ∧ id IN 연결 ∧ 안 지워짐. 대상 프로젝트 조건은 걸지 않는다 —
//     원본 소속의 L2·숨은 프로젝트 규칙이 그대로 선다. 제목을 복사해 두지 않는다(보안 규칙 5).
//   - 고객(client)·AI: 1차에 아무것도 안 보이고 붙이기·떼기 403. 실시간 사건 project:ref_changed 는 CLIENT_VIEW 에 없다(고객 방에 안 간다).
//   - 복사(문서·파일·프로젝트 복제)에는 따라가지 않는다. 소속 이동은 models/index.js 훅이 새 소속으로 걸린 연결을 지운다.
'use strict';

const { Op } = require('sequelize');
const { Post, File, Project, ProjectMember, ProjectRef } = require('../models');
const {
  getUserScope, isMemberOrAbove, isWorkspaceAdmin, canSeeProject,
  canAccessFileByLevel, postListWhereByLevel, fileListWhereByLevel,
} = require('../middleware/access_scope');
const { canReadPost, canEditPost } = require('./postAccess');

const ENTITY_TYPES = ['post', 'file'];
const MAX_LIST = 200;

const fail = (code, http) => ({ ok: false, code, http });
const validId = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

async function loadEntity(type, id) {
  if (!Number.isFinite(id) || id <= 0) return null;
  if (type === 'post') return Post.findByPk(id);   // paranoid — 휴지통 문서는 null
  const f = await File.findByPk(id);
  return f && !f.deleted_at ? f : null;
}

function vlevelOf(type, e) {
  return type === 'post' ? e.vlevel : (e.vlevel || e.visibility);
}

async function canRead(user, type, e, scope) {
  if (type === 'post') return canReadPost(user, e);
  return canAccessFileByLevel(user.id, e, scope);
}

// 원본 편집자 — 문서는 canEditPost 한 곳, 파일은 올린 사람 ∨ 소속 프로젝트 PM(routes/files.js canMutateFile 과 같은 축).
async function canEditEntity(user, type, e, scope) {
  if (type === 'post') return canEditPost(user.id, e, user.platform_role);
  if (isWorkspaceAdmin(scope) || e.uploader_id === user.id) return true;
  return e.project_id ? isPm(e.project_id, user.id) : false;
}

async function isPm(projectId, userId) {
  return !!(await ProjectMember.findOne({ where: { project_id: projectId, user_id: userId, is_pm: true }, attributes: ['id'] }));
}

// 대상 프로젝트에 «쓸 수 있는가» — 보이고(canSeeProject) ∧ (멤버 ∨ owner/admin). 고객·AI 는 아니다.
async function canWriteProject(scope, project) {
  if (!isMemberOrAbove(scope) || scope.isAi || scope.isClient) return false;
  if (!canSeeProject(scope, project.id)) return false;
  if (isWorkspaceAdmin(scope)) return true;
  return (scope.projectMemberIds || []).map(Number).includes(Number(project.id));
}

function emitChanged(req, project, type, entityId) {
  const io = req.app && req.app.get('io');
  if (!io) return;
  require('./projectRoom').emitProject(io, project.id, 'project:ref_changed', {
    project_id: project.id, entity_type: type, entity_id: entityId,
  });
}

function audit(req, action, ref) {
  require('./auditService').logAudit(req, {
    action, targetType: 'project_ref', targetId: ref.id || null, businessId: ref.business_id,
    [action.endsWith('unlink') ? 'oldValue' : 'newValue']: {
      project_id: ref.project_id, entity_type: ref.entity_type, entity_id: ref.entity_id,
    },
  });
}

async function link({ req, projectId, entityType, entityId }) {
  if (!ENTITY_TYPES.includes(entityType)) return fail('invalid_entity_type', 400);
  if (!validId(projectId) || !validId(entityId)) return fail('not_found', 404);
  const project = await Project.findByPk(Number(projectId));
  if (!project) return fail('project_not_found', 404);
  const scope = await getUserScope(req.user.id, project.business_id, req.user.platform_role);
  if (!isMemberOrAbove(scope) && !scope.isClient) return fail('project_not_found', 404);
  if (!(await canWriteProject(scope, project))) return fail('not_project_member', 403);
  const e = await loadEntity(entityType, Number(entityId));
  // 다른 워크스페이스·없음·휴지통은 같은 404 — 존재를 알리지 않는다
  if (!e || Number(e.business_id) !== Number(project.business_id)) return fail('not_found', 404);
  if (!(await canRead(req.user, entityType, e, scope))) return fail('forbidden', 403);
  if (vlevelOf(entityType, e) === 'L1') return fail('private_not_linkable', 400);
  if (e.project_id && Number(e.project_id) === Number(project.id)) return fail('already_home', 409);
  const [ref, created] = await ProjectRef.findOrCreate({
    where: { project_id: project.id, entity_type: entityType, entity_id: e.id },
    defaults: { business_id: project.business_id, created_by: req.user.id },
  });
  if (!created) return fail('already_linked', 409);
  audit(req, 'project_ref.link', ref);
  emitChanged(req, project, entityType, e.id);
  return { ok: true, data: { id: ref.id, project_id: project.id, entity_type: entityType, entity_id: e.id } };
}

async function unlink({ req, projectId, entityType, entityId }) {
  if (!ENTITY_TYPES.includes(entityType)) return fail('invalid_entity_type', 400);
  // 이상값은 쿼리 전에 404 — NaN 이 SQL 로 가 500(+ SQL 문구 노출)이 났다(Fable 완료 검증 2)
  if (!validId(projectId) || !validId(entityId)) return fail('not_found', 404);
  const project = await Project.findByPk(Number(projectId));
  if (!project) return fail('not_found', 404);
  const scope = await getUserScope(req.user.id, project.business_id, req.user.platform_role);
  // 나에게 숨은 프로젝트의 연결은 있는지조차 알리지 않는다(Fable 완료 검증 3)
  if (!isMemberOrAbove(scope) || scope.isAi || !canSeeProject(scope, project.id)) return fail('not_found', 404);
  const ref = await ProjectRef.findOne({
    where: { project_id: project.id, entity_type: entityType, entity_id: Number(entityId) },
  });
  if (!ref) return fail('not_found', 404);
  let allowed = ref.created_by === req.user.id || isWorkspaceAdmin(scope) || await isPm(project.id, req.user.id);
  if (!allowed) {
    const e = await loadEntity(entityType, Number(entityId));
    allowed = !!e && await canEditEntity(req.user, entityType, e, scope);
  }
  if (!allowed) return fail('forbidden', 403);
  await ref.destroy();
  audit(req, 'project_ref.unlink', ref);
  emitChanged(req, project, entityType, ref.entity_id);
  return { ok: true, data: { project_id: project.id, entity_type: entityType, entity_id: ref.entity_id } };
}

// 항목 상세의 «연결» 칩 — 내가 볼 수 있는 프로젝트만. 고객에게는 빈 배열(다른 프로젝트 이름이 새지 않게).
async function listForEntity(user, entityType, e) {
  if (!ENTITY_TYPES.includes(entityType) || !e) return [];
  const scope = await getUserScope(user.id, e.business_id, user.platform_role);
  if (!isMemberOrAbove(scope) || scope.isAi) return [];
  const refs = await ProjectRef.findAll({
    where: { entity_type: entityType, entity_id: e.id, business_id: e.business_id },
    include: [{ model: Project, attributes: ['id', 'name', 'color', 'status'] }],
    order: [['created_at', 'ASC'], ['id', 'ASC']],
  });
  const editable = await canEditEntity(user, entityType, e, scope);
  const admin = isWorkspaceAdmin(scope);
  const out = [];
  for (const r of refs) {
    const p = r.Project;
    if (!p || !canSeeProject(scope, p.id)) continue;
    if (e.project_id && Number(e.project_id) === Number(p.id)) continue;
    const canUnlink = admin || editable || r.created_by === user.id || await isPm(p.id, user.id);
    out.push({ project_id: p.id, name: p.name, color: p.color || null, can_unlink: !!canUnlink });
  }
  return out;
}

async function refIdsFor(project, entityType) {
  const rows = await ProjectRef.findAll({
    where: { project_id: project.id, entity_type: entityType },
    attributes: ['entity_id', 'created_at'],
    order: [['created_at', 'DESC']],
    limit: MAX_LIST,
  });
  return rows.map((r) => Number(r.entity_id));
}

// 소속이 이 프로젝트인 항목은 «연결됨» 으로 또 세우지 않는다(훅이 빠진 이동 문이 있어도 중복 없음).
const notHomeOf = (project) => ({ [Op.or]: [{ project_id: null }, { project_id: { [Op.ne]: project.id } }] });

async function homeProjects(rows, scope) {
  const ids = [...new Set(rows.map((r) => r.project_id).filter(Boolean).map(Number))];
  if (!ids.length) return new Map();
  const ps = await Project.findAll({ where: { id: ids }, attributes: ['id', 'name', 'color'] });
  return new Map(ps.filter((p) => canSeeProject(scope, p.id)).map((p) => [Number(p.id), { id: p.id, name: p.name, color: p.color || null }]));
}

// 프로젝트 문서 탭의 «연결됨» 행 — 원본 목록 술어로 거른 Post 인스턴스 + 소속 프로젝트(보일 때만).
async function linkedPostsForProject(user, project, { include, extraWhere } = {}) {
  const scope = await getUserScope(user.id, project.business_id, user.platform_role);
  if (!isMemberOrAbove(scope) || scope.isAi) return { rows: [], homes: new Map() };
  const ids = await refIdsFor(project, 'post');
  if (!ids.length) return { rows: [], homes: new Map() };
  const rows = await Post.findAll({
    where: { [Op.and]: [postListWhereByLevel(scope), { id: { [Op.in]: ids } }, notHomeOf(project), ...(extraWhere ? [extraWhere] : [])] },
    include,
    order: [['created_at', 'DESC'], ['id', 'DESC']],
  });
  return { rows, homes: await homeProjects(rows, scope) };
}

// 프로젝트 파일 탭의 «연결됨» 행 — 같은 원리(fileListWhereByLevel). include 는 호출부가 넘긴다(자격 붙은 술어라 조인해도 안전).
async function linkedFilesForProject(user, project, include) {
  const scope = await getUserScope(user.id, project.business_id, user.platform_role);
  if (!isMemberOrAbove(scope) || scope.isAi) return { rows: [], homes: new Map() };
  const ids = await refIdsFor(project, 'file');
  if (!ids.length) return { rows: [], homes: new Map() };
  const rows = await File.findAll({
    where: { [Op.and]: [fileListWhereByLevel(scope), { id: { [Op.in]: ids } }, { deleted_at: null }, notHomeOf(project)] },
    include,
    order: [['created_at', 'DESC']],
  });
  return { rows, homes: await homeProjects(rows, scope) };
}

// 영구 삭제 — 원본 행이 사라지면 연결 행도 지운다(휴지통은 남긴다 — 복원하면 다시 보인다).
async function onEntityPurged(entityType, entityId, { transaction } = {}) {
  return ProjectRef.destroy({ where: { entity_type: entityType, entity_id: entityId }, transaction });
}

module.exports = {
  ENTITY_TYPES, link, unlink, listForEntity, linkedPostsForProject, linkedFilesForProject, onEntityPurged, loadEntity, canRead,
};
