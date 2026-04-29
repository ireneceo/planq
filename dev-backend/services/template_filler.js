// Phase F 슬롯 시스템 (사이클 I).
// DocumentTemplate.schema_json 의 슬롯 정의를 기반으로 컨텍스트 자동 채움 + body 치환.
//
// schema_json 표준 구조:
// [
//   { "key": "client_name", "label": "고객명", "type": "text", "required": true, "default_from": "client.display_name" },
//   { "key": "issue_date",  "label": "발행일",  "type": "date", "required": true, "default_from": "today" },
//   { "key": "due_date",    "label": "마감일",  "type": "date", "default_from": "today+30d" },
//   { "key": "amount",      "label": "금액",    "type": "number", "required": true },
//   { "key": "memo",        "label": "메모",    "type": "textarea" }
// ]
//
// default_from DSL:
//   client.display_name | client.biz_name | client.company_name | client.country | client.email
//   project.name | project.description
//   user.name | user.email
//   business.brand_name | business.name | business.bank_account_name | business.bank_name | business.bank_account_number
//   today                  → YYYY-MM-DD (Asia/Seoul 기준)
//   today+Nd / today+Nm    → 오늘 + N일 / N개월
const { DocumentTemplate, Client, Project, User, Business } = require('../models');
const { todayInTz, addDaysStr } = require('../utils/datetime');

// ── default_from 해결
async function resolveDefault(expr, ctx) {
  if (!expr || typeof expr !== 'string') return null;
  const e = expr.trim();
  // 날짜 토큰
  if (e === 'today') return todayInTz('Asia/Seoul');
  const todayPlus = e.match(/^today\+(\d+)d$/);
  if (todayPlus) return addDaysStr(todayInTz('Asia/Seoul'), Number(todayPlus[1]));
  const todayPlusM = e.match(/^today\+(\d+)m$/);
  if (todayPlusM) {
    const n = Number(todayPlusM[1]);
    return addDaysStr(todayInTz('Asia/Seoul'), n * 30); // 30일 근사
  }
  // 객체 경로 — client.display_name, business.brand_name 등
  const [scope, ...path] = e.split('.');
  const obj = ctx[scope];
  if (!obj) return null;
  let v = obj;
  for (const p of path) v = v?.[p];
  return v ?? null;
}

// ── 컨텍스트 fetch
async function loadContext({ businessId, projectId, clientId, userId }) {
  const ctx = {};
  if (businessId) {
    const biz = await Business.findByPk(businessId, {
      attributes: ['id', 'name', 'brand_name', 'bank_name', 'bank_account_number', 'bank_account_name', 'tax_id', 'representative', 'address'],
    });
    if (biz) ctx.business = biz.toJSON();
  }
  if (projectId) {
    const proj = await Project.findByPk(projectId, {
      attributes: ['id', 'name', 'description'],
    });
    if (proj) ctx.project = proj.toJSON();
  }
  if (clientId) {
    const cli = await Client.findByPk(clientId, {
      attributes: ['id', 'display_name', 'biz_name', 'company_name', 'country', 'address'],
    });
    if (cli) ctx.client = cli.toJSON();
  }
  if (userId) {
    const user = await User.findByPk(userId, { attributes: ['id', 'name', 'email'] });
    if (user) ctx.user = user.toJSON();
  }
  return ctx;
}

// ── 슬롯 + 자동 채움 default_values 반환
async function getTemplateContext({ templateId, businessId, projectId, clientId, userId }) {
  const tpl = await DocumentTemplate.findByPk(templateId, {
    attributes: ['id', 'kind', 'name', 'mode', 'schema_json', 'body_template', 'variables_json', 'locale'],
  });
  if (!tpl) return null;
  const schema = Array.isArray(tpl.schema_json) ? tpl.schema_json : [];
  const ctx = await loadContext({ businessId, projectId, clientId, userId });

  const defaultValues = {};
  for (const slot of schema) {
    if (slot.default_from) {
      const v = await resolveDefault(slot.default_from, ctx);
      if (v != null) defaultValues[slot.key] = v;
    }
  }
  return {
    template_id: tpl.id,
    kind: tpl.kind,
    name: tpl.name,
    mode: tpl.mode,
    locale: tpl.locale,
    schema,
    body_template: tpl.body_template,
    default_values: defaultValues,
    context: ctx,
  };
}

// ── body_template 의 {{slot}} 치환. 누락 슬롯은 [{{slot}}] 으로 대체 (검증용)
function renderTemplate(bodyTemplate, values) {
  if (!bodyTemplate) return '';
  return String(bodyTemplate).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    if (values && Object.prototype.hasOwnProperty.call(values, key) && values[key] != null && values[key] !== '') {
      return String(values[key]);
    }
    return `[{{${key}}}]`;
  });
}

module.exports = { getTemplateContext, renderTemplate, resolveDefault };
