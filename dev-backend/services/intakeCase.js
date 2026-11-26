// 접수 양식(설문) 응답 → 사건(프로젝트)·업무 — 판정·만들기 한 곳 (2026-11-26)
//   설계 정본 docs/INTAKE_AUTO_CASE_DESIGN.md §6 (Fable DESIGN-CHANGE 9건 반영)
//
// ★ 1차는 «확인 후 만들기(review)» 만 — 무인증 응답이 직접 만드는 길(auto)은 없다. 응답 저장 경로(routes/survey_public.js)는 이 파일을 부르지 않는다.
// ★ 실행 주체 = [사건 만들기] 를 누른 사람. 설정의 owner_id 는 알림 받는 사람일 뿐이다.
// ★ 멱등 = intake_cases.q_record_row_id UNIQUE 를 INSERT 로 먼저 잡기 — 동시 두 번 클릭에 사건 1건.
// ★ 기존 고객 자동 연결 금지 — 이메일이 일치해도 누르는 사람이 [연결]/[새 잠재 고객]/[연결 안 함] 을 고른다(본인 확인 안 된 주소다).
//   예외: 개인 열쇠(survey_recipients)로 받은 응답은 보낸 쪽이 정한 받는 사람 = 확인된 고객이다(익명 설문은 접수 처리를 켤 수 없다).
// ★ 응답 값은 감사·이 표에 싣지 않는다(표의 감사 규칙). 응답 요약은 고객 상담 기록(내부)으로만.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');

const MODES = ['off', 'review'];
const MAP_KEYS = ['name', 'email', 'phone', 'company'];
const NAME_COLS_MAX = 3;
const CHOICES = ['link', 'new', 'none'];

class IntakeError extends Error {
  constructor(code, status, extra) { super(code); this.code = code; this.status = status; this.extra = extra || null; }
}

/** 설정 정리(동기) — 지운 칸 id 는 버린다(sanitizeSettings 의 pickIds 와 같은 방식). */
function normalizeIntake(record, raw, prev) {
  const ids = new Set((record.columns || []).map((c) => String(c.id)));
  const p = prev && typeof prev === 'object' ? prev : {};
  if (raw === undefined) raw = p;
  const s = raw && typeof raw === 'object' ? raw : {};
  const pick = (v) => (v !== undefined && v !== null && ids.has(String(v)) ? String(v) : null);
  const tpl = Number(s.template_id);
  const map = {};
  const srcMap = s.map && typeof s.map === 'object' ? s.map : {};
  for (const k of MAP_KEYS) map[k] = pick(srcMap[k]);
  return {
    mode: MODES.includes(s.mode) ? s.mode : 'off',
    template_id: Number.isInteger(tpl) && tpl > 0 ? tpl : null,
    name_cols: (Array.isArray(s.name_cols) ? s.name_cols : []).map(String).filter((x) => ids.has(x)).slice(0, NAME_COLS_MAX),
    map,
  };
}

/** 템플릿 — 시스템 preset 이거나 이 워크스페이스 것(templateApply 와 같은 선). 아니면 null. */
async function loadTemplate(templateId, businessId) {
  if (!templateId) return null;
  const { TaskTemplate, TaskTemplateItem } = require('../models');
  const t = await TaskTemplate.findByPk(templateId, { attributes: ['id', 'name', 'is_system', 'business_id'] });
  if (!t) return null;
  if (!t.is_system && Number(t.business_id) !== Number(businessId)) return null;
  const itemCount = await TaskTemplateItem.count({ where: { template_id: t.id } });
  return { id: t.id, name: t.name, is_system: !!t.is_system, item_count: itemCount };
}

/** 저장 전 검사(비동기) — 켤 때만 본다. 저장과 실행 두 번 본다(실행 때 다시 loadTemplate). */
async function assertIntakeSettings(record, settings) {
  const it = settings.intake;
  if (!it || it.mode === 'off') return settings;
  if (settings.anonymous) throw new IntakeError('intake_anonymous', 409);
  if (!(await loadTemplate(it.template_id, record.business_id))) throw new IntakeError('intake_template', 400);
  return settings;
}

/** 응답 줄 → 접수 맥락. 권한: 응답을 볼 수 있음(표 읽기 술어 + 설문이면 멤버 이상) ∧ 멤버 이상(고객·AI 제외). */
async function loadContext(user, rowId) {
  const { QRecordRow, QRecord, Post } = require('../models');
  const id = Number(rowId);
  if (!Number.isInteger(id) || id <= 0) throw new IntakeError('not_found', 404);
  const row = await QRecordRow.findByPk(id);
  if (!row) throw new IntakeError('not_found', 404);
  const record = await QRecord.findByPk(row.q_record_id);
  if (!record) throw new IntakeError('not_found', 404);
  const { canViewSurveyResponses, isMemberUp } = require('./surveyAccess');
  const v = await canViewSurveyResponses(user, record);
  if (!v.ok) throw new IntakeError('not_found', 404);
  if (!(await isMemberUp(user, record.business_id))) throw new IntakeError('forbidden', 403);
  const post = v.post || await Post.findOne({ where: { q_record_id: record.id }, attributes: ['id', 'title', 'kind'] });
  if (!post) throw new IntakeError('not_found', 404);
  const survey = require('./survey');
  const settings = survey.settingsOf(record);
  const intake = normalizeIntake(record, settings.intake, {});
  return { row, record, post, settings, intake, questions: survey.questionsOf(record, post.kind) };
}

const str = (v) => (v === undefined || v === null ? '' : (Array.isArray(v) ? v.join(', ') : String(v))).trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 응답에서 고객 칸·사건 이름 */
function mappedValues(ctx) {
  const vals = ctx.row.values && typeof ctx.row.values === 'object' ? ctx.row.values : {};
  const m = ctx.intake.map;
  const email = str(vals[m.email]).slice(0, 254);
  const out = {
    name: str(vals[m.name]).slice(0, 100),
    email: EMAIL_RE.test(email) ? email : '',
    phone: str(vals[m.phone]).slice(0, 40),
    company: str(vals[m.company]).slice(0, 200),
  };
  const parts = ctx.intake.name_cols.map((id) => str(vals[id])).filter(Boolean);
  const base = String(ctx.settings.title || ctx.post.title || '').trim();
  let projectName = parts.join(' · ');
  if (!projectName && (out.name || out.company)) projectName = [base, out.name || out.company].filter(Boolean).join(' — ');
  // 이름·회사가 없는 응답 — 같은 이름 프로젝트가 여럿 생기지 않게 응답 번호를 붙인다(Fable 비차단 3)
  if (!projectName) projectName = `${base || 'Intake'} #${ctx.row.position || ctx.row.id}`;
  out.project_name = projectName.slice(0, 200);
  return out;
}

/** 개인 열쇠 응답의 받는 사람 고객(익명이 아니어서 줄에 이어져 있을 때만) */
async function recipientClient(ctx) {
  if (!ctx.row.survey_recipient_id) return null;
  const { SurveyRecipient, Client } = require('../models');
  const rc = await SurveyRecipient.findByPk(ctx.row.survey_recipient_id);
  if (!rc || Number(rc.business_id) !== Number(ctx.record.business_id) || !rc.client_id) return null;
  return Client.findOne({ where: { id: rc.client_id, business_id: ctx.record.business_id } });
}

const clientBrief = (c) => (c ? { id: c.id, name: c.display_name || c.company_name || c.invite_email || null } : null);

// 만드는 중(running)으로 이만큼 멈춰 있으면 «멈춘 것» 으로 보고 다시 잡게 한다 — 만들기 한 번은 몇 초다(Fable 차단 B1)
const STALE_MS = 5 * 60 * 1000;
// underscored 모델의 시각은 JS 쪽 이름이 updatedAt·createdAt 이다(DB 칸은 updated_at) — 둘 다 받는다
const tsOf = (ic, k) => ic[k === 'u' ? 'updatedAt' : 'createdAt'] || ic[k === 'u' ? 'updated_at' : 'created_at'] || null;
const isStale = (ic) => ic.status === 'running' && Date.now() - new Date(tsOf(ic, 'u')).getTime() > STALE_MS;

function caseView(ic, projectName) {
  if (!ic) return null;
  return {
    id: ic.id, status: ic.status, step: ic.step, error: ic.error || null, stale: isStale(ic),
    project_id: ic.project_id || null, project_name: projectName || null,
    client_id: ic.client_id || null, client_choice: ic.client_choice || null,
    task_count: ic.task_count || 0, created_at: tsOf(ic, 'c'), actor_user_id: ic.actor_user_id,
  };
}

/** 이 사람이 고객을 붙이거나 만들 수 있나 — Q sale 쓰기 */
async function canTouchClients(user, businessId) {
  return require('../middleware/menu_permission').menuAllows(businessId, user, 'qsale', 'write');
}

/** 미리보기 — 무엇이 만들어지는지 + 기존 고객 후보(Q sale 을 볼 수 있는 사람에게만 이름) */
async function preview(user, rowId) {
  const ctx = await loadContext(user, rowId);
  const { IntakeCase, Project } = require('../models');
  const ic = await IntakeCase.findOne({ where: { q_record_row_id: ctx.row.id, business_id: ctx.record.business_id } });
  let projectName = null;
  if (ic && ic.project_id) {
    const p = await Project.findOne({ where: { id: ic.project_id, business_id: ctx.record.business_id }, attributes: ['id', 'name'] });
    projectName = p ? p.name : null;
  }
  const mv = mappedValues(ctx);
  const template = ctx.intake.mode === 'review' ? await loadTemplate(ctx.intake.template_id, ctx.record.business_id) : null;
  const touch = await canTouchClients(user, ctx.record.business_id);
  let emailMatch = null; let phoneMatch = null; let recip = null;
  if (touch) {
    recip = await recipientClient(ctx);
    const { findExistingByContact } = require('./saleCommon');
    if (!recip && mv.email) emailMatch = await findExistingByContact(ctx.record.business_id, { email: mv.email });
    if (!recip && !emailMatch && mv.phone) phoneMatch = await findExistingByContact(ctx.record.business_id, { phone: mv.phone });
  }
  return {
    enabled: ctx.intake.mode === 'review' && !!template,
    template,
    project_name: mv.project_name,
    contact: { name: mv.name || null, email: mv.email || null, phone: mv.phone || null, company: mv.company || null },
    can_touch_clients: touch,
    recipient_client: clientBrief(recip),
    email_match: clientBrief(emailMatch),
    phone_match: clientBrief(phoneMatch),
    case: caseView(ic, projectName),
  };
}

/** 응답 요약(내부 상담 기록 본문) — 질문지에 나오는 칸만(비밀·첨부 칸은 questionsOf 가 이미 뺀다) */
function responseSummary(ctx, lang) {
  const vals = ctx.row.values && typeof ctx.row.values === 'object' ? ctx.row.values : {};
  const lines = [];
  for (const q of ctx.questions) {
    const v = vals[q.id];
    if (v === undefined || v === null || v === '') continue;
    const shown = typeof v === 'boolean' ? (v ? (lang === 'en' ? 'Yes' : '예') : (lang === 'en' ? 'No' : '아니오')) : str(v);
    lines.push(`${q.name}: ${shown}`);
  }
  const head = lang === 'en' ? '[Public form · not verified]' : '[공개 양식 · 본인 확인 안 됨]';
  return `${head}\n${lines.join('\n')}`.slice(0, 5000);
}

/**
 * [사건 만들기] — 누른 사람의 권한으로.
 * @param body { client_choice: 'link'|'new'|'none', client_id? (link 일 때 — 미리보기의 후보 id 만) }
 */
async function createCase(user, rowId, body = {}, { req } = {}) {
  const ctx = await loadContext(user, rowId);
  const businessId = Number(ctx.record.business_id);
  if (ctx.intake.mode !== 'review') throw new IntakeError('intake_off', 409);
  if (ctx.settings.anonymous) throw new IntakeError('intake_anonymous', 409);
  const template = await loadTemplate(ctx.intake.template_id, businessId);
  if (!template) throw new IntakeError('intake_template', 400);
  const choice = CHOICES.includes(body.client_choice) ? body.client_choice : 'none';

  const { IntakeCase, Task } = require('../models');
  // ── 먼저 잡기 ──
  let ic;
  try {
    ic = await IntakeCase.create({
      business_id: businessId, q_record_id: ctx.record.id, q_record_row_id: ctx.row.id,
      status: 'running', step: 'claimed', mode: 'review', template_id: template.id, actor_user_id: user.id,
    });
  } catch (e) {
    if (e.name !== 'SequelizeUniqueConstraintError') throw e;
    const prev = await IntakeCase.findOne({ where: { q_record_row_id: ctx.row.id } });
    if (!prev || Number(prev.business_id) !== businessId) throw new IntakeError('not_found', 404);
    if (prev.status === 'done') return { replayed: true, case: caseView(prev) };
    if (prev.status === 'running' && !isStale(prev)) throw new IntakeError('intake_in_progress', 409);
    // 업무가 일부만 생긴 사건은 다시 눌러도 채우지 않는다 — 프로젝트에서 사람이 확인한다(Fable 차단 B2)
    if (prev.status === 'error' && prev.error === 'tasks_partial') throw new IntakeError('tasks_partial', 409);
    // error 또는 멈춘 running → 조건부로 다시 잡는다(동시에 두 사람이 «다시» 를 눌러도 한 사람만 —
    //   running 은 본 그 시각(updated_at) 그대로일 때만: 그사이 살아 있는 요청이 단계를 넘겼으면 못 잡는다)
    const [n] = await IntakeCase.update({ status: 'running', error: null, actor_user_id: user.id },
      { where: prev.status === 'running' ? { id: prev.id, status: 'running', updatedAt: tsOf(prev, 'u') } : { id: prev.id, status: 'error' } });
    if (n !== 1) throw new IntakeError('intake_in_progress', 409);
    ic = await IntakeCase.findByPk(prev.id);
  }

  const fail = async (code) => {
    await IntakeCase.update({ status: 'error', error: String(code).slice(0, 120) }, { where: { id: ic.id } });
  };

  try {
    // ── 1단계: 고객 + 프로젝트 (한 트랜잭션) ──
    if (ic.step === 'claimed') {
      const mv = mappedValues(ctx);
      let clientId = null; let clientChoice = 'none'; let createdClient = null;
      const touch = await canTouchClients(user, businessId);
      if (choice !== 'none' && !touch) { await fail('clients_forbidden'); throw new IntakeError('clients_forbidden', 403); }
      // Q sale 쓰기가 없으면 받는 사람 고객도 잇지 않는다 — 미리보기도 «고객 없이 만들어요» 라고 말한다(Fable 비차단 5)
      const recip = touch ? await recipientClient(ctx) : null;
      if (recip) { clientId = recip.id; clientChoice = 'recipient'; }
      else if (choice === 'link') {
        // 미리보기가 보여 준 후보만 — 화면이 보낸 아무 고객 id 를 붙이지 않는다
        const { findExistingByContact } = require('./saleCommon');
        const cand = (mv.email && await findExistingByContact(businessId, { email: mv.email }))
          || (mv.phone && await findExistingByContact(businessId, { phone: mv.phone })) || null;
        if (!cand || Number(cand.id) !== Number(body.client_id)) { await fail('client_not_candidate'); throw new IntakeError('client_not_candidate', 400); }
        clientId = cand.id; clientChoice = 'linked';
      } else if (choice === 'new') {
        if (!mv.name && !mv.email && !mv.company) { await fail('client_no_contact'); throw new IntakeError('client_no_contact', 400); }
        const { prospectAllowed } = require('./prospect');
        const allowed = await prospectAllowed(businessId);
        if (!allowed.ok) { await fail('prospect_limit'); throw new IntakeError('prospect_limit', 422, { quota: allowed.quota }); }
        clientChoice = 'created';
      }

      const { createProject } = require('./actions/project_actions');
      const t = await sequelize.transaction();
      let proj;
      try {
        if (clientChoice === 'created') {
          const { createProspectRow } = require('./prospect');
          createdClient = await createProspectRow({
            businessId, name: mv.name || mv.company, email: mv.email || null, phone: mv.phone, company: mv.company,
            salesSource: 'web', assignedMemberId: user.id,
          }, { transaction: t });
          clientId = createdClient.id;
        }
        proj = await createProject({ kind: 'user', userId: user.id, platformRole: user.platform_role, req }, {
          businessId, name: mv.project_name, clientIds: clientId ? [clientId] : [],
          startDate: new Date().toISOString().slice(0, 10), kind: clientId ? 'client' : 'internal',
        }, { transaction: t });
        if (!proj.ok) throw new IntakeError(proj.code === 'quota_exceeded' ? 'project_limit' : 'project_failed', proj.http || 400,
          proj.planCan ? { quota: require('./plan').buildQuotaError(proj.planCan, businessId) } : null);
        await IntakeCase.update({ step: 'project_done', project_id: proj.data.project.id, client_id: clientId, client_choice: clientChoice },
          { where: { id: ic.id }, transaction: t });
        await t.commit();
      } catch (e) {
        if (!t.finished) await t.rollback();
        await fail(e.code || 'project_failed');
        throw e;
      }
      if (createdClient) await require('./prospect').afterProspectCreated(createdClient, { reason: 'intake_survey', sourceRef: { q_record_row_id: ctx.row.id } });
      // 응답 요약 — 고객이 있으면 그 고객의 내부 상담 기록(고객 화면에 안 보인다)
      if (clientId) {
        try {
          const { Client, Business } = require('../models');
          const cl = await Client.findOne({ where: { id: clientId, business_id: businessId } });
          const biz = await Business.findByPk(businessId, { attributes: ['default_language'] });
          const lang = biz && biz.default_language === 'en' ? 'en' : 'ko';
          await require('./saleInteraction').createInteraction({
            businessId, client: cl, userId: user.id, req,
            body: { kind: 'memo', title: (lang === 'en' ? 'Intake form response' : '접수 양식 응답').slice(0, 200), body: responseSummary(ctx, lang), occurred_at: ctx.row.created_at },
          });
        } catch (e) { console.warn('[intakeCase] 상담 기록 실패:', e.message); }
      }
      ic = await IntakeCase.findByPk(ic.id);
    }

    // ── 2단계: 템플릿 업무 — 재시도는 그 프로젝트에 업무가 0개일 때만(applyTemplate 은 다시 부르면 또 만든다) ──
    if (ic.step === 'project_done') {
      const existing = await Task.count({ where: { business_id: businessId, project_id: ic.project_id } });
      let created = [];
      if (existing === 0) {
        const { applyTemplate } = require('./templateApply');
        const r = await applyTemplate({
          templateId: template.id, businessId, projectId: ic.project_id,
          startDate: new Date().toISOString().slice(0, 10), actorUserId: user.id,
        });
        created = r.created || [];
        const io = global.__planqIo;
        if (io) {
          for (const tk of created) {
            require('./taskRoom').emitTask(io, 'task:new', { ...tk.toJSON(), actor_user_id: user.id }, { businessId, projectId: ic.project_id })
              .catch((e) => console.warn('[emitTask]', e.message));
          }
        }
      }
      const total = existing + created.length;
      // ★ 템플릿 업무 수보다 모자라면 «완료» 로 닫지 않는다(Fable 차단 B2) — applyTemplate 은 한 건씩 만들어
      //   중간에 끊기면 일부만 남는다. 다시 만들면 겹치므로 채우지 않고 «일부만 생김» 으로 화면에 드러낸다.
      if (total < template.item_count) {
        await IntakeCase.update({ status: 'error', error: 'tasks_partial', task_count: total }, { where: { id: ic.id } });
        throw new IntakeError('tasks_partial', 409, { task_count: total, expected: template.item_count, project_id: ic.project_id });
      }
      await IntakeCase.update({ step: 'tasks_done', status: 'done', task_count: total, error: null }, { where: { id: ic.id } });
      ic = await IntakeCase.findByPk(ic.id);
      require('./auditService').createAuditLog({
        userId: user.id, businessId, action: 'intake.case_create', targetType: 'intake_case', targetId: ic.id,
        newValue: {
          via: 'intake_review', q_record_id: ctx.record.id, row_id: ctx.row.id, project_id: ic.project_id,
          client_id: ic.client_id || null, client_choice: ic.client_choice, template_id: template.id, task_count: total,
          resumed_tasks: existing > 0,
        },
      });
      if (global.__planqIo) global.__planqIo.to(`business:${businessId}`).emit('record:row', { id: ctx.record.id, business_id: businessId, project_id: ctx.record.project_id || null });
    }
    return { replayed: false, case: caseView(ic) };
  } catch (e) {
    const cur = await IntakeCase.findByPk(ic.id);
    if (cur && cur.status === 'running') await fail(e.code || e.message || 'failed');
    throw e;
  }
}

/** 응답 줄이 지워진 사건 — 사건·프로젝트는 남는다(§6-8). 접수함 아래 «원 응답 삭제됨» 으로 보인다. */
async function orphanCases(record) {
  const { IntakeCase, QRecordRow, Project } = require('../models');
  const all = await IntakeCase.findAll({ where: { business_id: record.business_id, q_record_id: record.id }, order: [['id', 'DESC']], limit: 200 });
  if (!all.length) return [];
  const alive = new Set((await QRecordRow.findAll({ where: { id: all.map((x) => x.q_record_row_id), q_record_id: record.id }, attributes: ['id'] })).map((r) => r.id));
  const gone = all.filter((x) => !alive.has(x.q_record_row_id));
  const pids = gone.map((x) => x.project_id).filter(Boolean);
  const names = new Map((pids.length ? await Project.findAll({ where: { id: pids, business_id: record.business_id }, attributes: ['id', 'name'] }) : []).map((p) => [p.id, p.name]));
  return gone.map((x) => caseView(x, names.get(x.project_id) || null));
}

/** 응답 목록에 붙일 사건 표시 — 이 표의 줄 id 들(최대 500) → { rowId: caseView }. 남의 표 줄 id 를 섞어 보내도 버린다. */
async function casesForRows(record, rowIds) {
  const asked = [...new Set((rowIds || []).map(Number).filter((n) => n > 0))].slice(0, 500);
  if (!asked.length) return {};
  const { IntakeCase, QRecordRow } = require('../models');
  const ids = (await QRecordRow.findAll({ where: { id: asked, q_record_id: record.id }, attributes: ['id'] })).map((r) => r.id);
  if (!ids.length) return {};
  const rows = await IntakeCase.findAll({ where: { business_id: record.business_id, q_record_row_id: { [Op.in]: ids } } });
  const out = {};
  for (const r of rows) out[r.q_record_row_id] = caseView(r);
  return out;
}

module.exports = { IntakeError, MODES, normalizeIntake, assertIntakeSettings, loadTemplate, preview, createCase, casesForRows, orphanCases, mappedValues };
