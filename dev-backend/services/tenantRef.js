// services/tenantRef.js — «이 워크스페이스의 것인가» (docs/FIX_0AB_MONEY_DESIGN.md B-③)
//   청구서·고객 구독·(앞으로의) 모든 참조 칸이 이 둘을 부른다. 없으면 400 (404 는 존재를 알려준다).
//   비어 있으면(null/'') null 을 돌려준다 — 참조 해제는 허용.
const { Client, Project } = require('../models');

function refError(code) {
  const e = new Error(code);
  e.code = code;
  e.statusCode = 400;
  return e;
}

async function assertClientInBusiness(clientId, businessId, { transaction } = {}) {
  if (clientId == null || clientId === '') return null;
  const id = Number(clientId);
  if (!Number.isInteger(id) || id <= 0) throw refError('client_not_in_workspace');
  const c = await Client.findOne({ where: { id, business_id: Number(businessId) }, attributes: ['id'], transaction });
  if (!c) throw refError('client_not_in_workspace');
  return c.id;
}

async function assertProjectInBusiness(projectId, businessId, { transaction } = {}) {
  if (projectId == null || projectId === '') return null;
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) throw refError('project_not_in_workspace');
  const p = await Project.findOne({ where: { id, business_id: Number(businessId) }, attributes: ['id'], transaction });
  if (!p) throw refError('project_not_in_workspace');
  return p.id;
}

// 고객과 프로젝트를 같이 고른 참조(청구서 등)는 «그 고객이 그 프로젝트에 연결돼 있나» 를 본다.
//   연결 판정은 Q sale·고객 목록과 같은 술어(clientAccess.projectLinkWhere — client_id 또는 계정 contact_user_id).
//   어긋나면 청구서가 프로젝트 «거래» 탭과 Q sale 고객 기록에 서로 다른 사람의 것으로 갈라진다.
//   둘 중 하나라도 비었으면 검사하지 않는다(외부 수신자·프로젝트 없는 청구).
async function isClientInProject(clientId, projectId, businessId, { transaction } = {}) {
  if (!clientId || !projectId) return true;
  const { ProjectClient } = require('../models');
  const { projectLinkWhere } = require('./clientAccess');
  const c = await Client.findOne({ where: { id: Number(clientId), business_id: Number(businessId) }, attributes: ['id', 'user_id'], transaction });
  if (!c) return false;
  const link = await ProjectClient.findOne({ where: { project_id: Number(projectId), ...projectLinkWhere(c) }, attributes: ['id'], transaction });
  return !!link;
}

async function assertClientInProject(clientId, projectId, businessId, { transaction } = {}) {
  if (!clientId || !projectId) return;
  const { ProjectClient } = require('../models');
  const { projectLinkWhere } = require('./clientAccess');
  const c = await Client.findOne({ where: { id: Number(clientId), business_id: Number(businessId) }, attributes: ['id', 'user_id'], transaction });
  if (!c) throw refError('client_not_in_workspace');
  const link = await ProjectClient.findOne({ where: { project_id: Number(projectId), ...projectLinkWhere(c) }, attributes: ['id'], transaction });
  if (!link) throw refError('client_not_in_project');
}

module.exports = { assertClientInBusiness, assertProjectInBusiness, assertClientInProject, isClientInProject };
