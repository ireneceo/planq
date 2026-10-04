// AI 에이전트 도구 — 출처 연결 (#439 M3-c, 설계 docs/AI_AGENT_M3_DESIGN.md §6).
//
//   «메일을 읽고 업무로 만들어 줘» 처럼 조회한 것을 기록으로 남길 때, 그 기록이 **어디서 왔는지**를 PlanQ 원장에 남긴다.
//   ★ 출처 id 는 **읽기 권한을 확인한 뒤에만** 받는다(CLAUDE.md 공유·참조 다섯 규칙 ⑤ «붙일 때 원본 읽기 권한»).
//     메일은 mail:read + 워크스페이스 스위치 + qmail 메뉴 + 계정 격리(남의 개인 메일 금지) — get_mail_thread 와 같은 문.
//     채팅은 qtalk 메뉴 + canAccessConversation, 업무는 get_task 와 같은 문(loadTask).
//     못 읽는 출처는 NOT_FOUND — 있다는 사실도 흘리지 않는다.
//   ★ 원본 링크 문구는 서버가 만든다(«원본 메일: url» / "Source mail: url"). 링크는 APP_URL 아래만.
const cfg = require('../../agent_oauth/config');
const { err } = require('../errors');
const { assertMenu } = require('../menu');

const LINE = {
  mail: { ko: '원본 메일', en: 'Source mail' },
  task: { ko: '원본 업무', en: 'Source task' },
};

/** 원본 링크 한 줄의 언어 — 사용자 언어(users.language) → 워크스페이스 기본 언어 → 한국어. */
async function langOf(p) {
  const { User, Business } = require('../../../models');
  const u = await User.findByPk(p.userId, { attributes: ['id', 'language'] });
  if (u && ['ko', 'en'].includes(u.language)) return u.language;
  const b = await Business.findByPk(p.businessId, { attributes: ['id', 'default_language'] });
  return b && b.default_language === 'en' ? 'en' : 'ko';
}

async function sourceLine(p, kind, url) {
  const lang = await langOf(p);
  return `${LINE[kind][lang]}: ${url}`;
}

/**
 * 출처를 확인한다. allowed — 이 도구가 받는 kind 목록.
 * @returns {Promise<null | {kind:'mail', thread, messageId, url} | {kind:'chat', conversation, url} | {kind:'task', task, url}>}
 */
async function resolveSource(p, source, allowed) {
  if (!source) return null;
  if (!allowed.includes(source.kind)) throw err('VALIDATION_ERROR', 'source_kind_not_supported', { allowed });
  if (source.kind === 'mail') {
    // 메일을 출처로 붙이려면 그 메일을 **읽을 수 있어야** 한다 — 이 연결에 메일 권한이 없으면 붙일 수 없다
    if (!(p.scopes || []).includes('mail:read')) {
      throw err('PERMISSION_DENIED', 'scope', { missing_scopes: ['mail:read'], hint: 'Reconnect PlanQ and allow email access in the consent screen.' });
    }
    const mail = require('./mail');
    const acctIds = await mail.mailGate(p);
    const thread = await mail.loadThread(p, source.thread_id, acctIds);
    let messageId = null;
    if (source.message_id) {
      const { EmailMessage } = require('../../../models');
      const m = await EmailMessage.findOne({ where: { id: source.message_id, business_id: p.businessId, thread_id: thread.id }, attributes: ['id'] });
      if (!m) throw err('NOT_FOUND', 'message_not_found');
      messageId = m.id;
    }
    return { kind: 'mail', thread, messageId, url: `${cfg.APP_URL}/mail?thread=${thread.id}` };
  }
  if (source.kind === 'chat') {
    await assertMenu(p, 'qtalk', 'read');
    const { Conversation } = require('../../../models');
    const { canAccessConversation, getUserScope } = require('../../../middleware/access_scope');
    const conv = await Conversation.findOne({ where: { id: source.conversation_id, business_id: p.businessId } });
    const scope = conv ? await getUserScope(p.userId, p.businessId, p.platformRole) : null;
    if (!conv || !(await canAccessConversation(p.userId, conv, scope))) throw err('NOT_FOUND', 'conversation_not_found');
    return { kind: 'chat', conversation: conv, url: `${cfg.APP_URL}/talk?conv=${conv.id}` };
  }
  if (source.kind === 'task') {
    if (!(p.scopes || []).includes('tasks:read')) throw err('PERMISSION_DENIED', 'scope', { missing_scopes: ['tasks:read'] });
    await assertMenu(p, 'qtask', 'read');
    const t = require('./tasks');
    const task = await t.loadTaskForSource(p, source.task_id);
    return { kind: 'task', task, url: `${cfg.APP_URL}/tasks?task=${task.id}` };
  }
  throw err('VALIDATION_ERROR', 'source_kind_not_supported', { allowed });
}

module.exports = { resolveSource, sourceLine };
