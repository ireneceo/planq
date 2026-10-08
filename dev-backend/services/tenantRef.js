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

module.exports = { assertClientInBusiness, assertProjectInBusiness };
