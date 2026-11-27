// AI 에이전트 도구 — Q sale 에 **문의 고객** 추가 (2026-11-27 · Fable 설계 D · docs/QSALE_CLIENT_TOUCHPOINT_DESIGN.md)
//
//   Irene: «Q sales 에 AI로 고객이나 문의 추가하는 것도 필요해.»
//   ★ 만드는 것은 문의 고객(prospect + 단계 inquiry) 하나뿐 — 직접 관리 고객·초대(외부 발송)·고객 수정·단계 변경·보관 도구는 없다.
//   ★ 쓰는 문은 화면과 같다 — services/actions/client_actions.saveInquiryClient(«고객으로 저장» 본체). 모델을 직접 쓰지 않는다(가드 agentsurface).
//   ★ 범위는 토큰의 워크스페이스로만(p.businessId). 메뉴는 Q sales 쓰기.
//   ★ 이메일이 있으면 그 주소의 지난 메일이 이 고객에 붙는다(sticky) → registry 의 riskOf 가 MEDIUM(확인 2단계). 붙인 수는 말하지 않는다.
const cfg = require('../../agent_oauth/config');
const { err } = require('../errors');
const { assertMenu: menuLevel } = require('../menu');

const iso = (v) => (v ? new Date(v).toISOString() : null);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 입력 → seed. 실행·미리보기가 같은 판정을 쓴다(거절될 요청에 확인 토큰을 내주지 않는다). */
async function prepare(p, a) {
  await menuLevel(p, 'qsale', 'write');
  const { trimOrNull, normEmail, findExistingByContact } = require('../../saleCommon');
  const seed = {
    display_name: trimOrNull(a.display_name, 100),
    company_name: trimOrNull(a.company_name, 200),
    phone: trimOrNull(a.phone, 40),
    email: normEmail(a.email),
    sales_source: a.sales_source || 'manual',
    touchAt: null,
  };
  if (!seed.display_name && !seed.company_name) throw err('VALIDATION_ERROR', 'name_required', { hint: 'Give display_name (the person) or company_name.' });
  if (seed.email && !EMAIL_RE.test(seed.email)) throw err('VALIDATION_ERROR', 'invalid_email');
  if (seed.email && require('../../emailTriage').isAutomatedSenderAddress(seed.email)) {
    throw err('VALIDATION_ERROR', 'relay_sender_use_manual', { hint: 'That address is an automatic sender (no-reply / web form). Use the real contact address written in the mail body.' });
  }
  // 메일 출처 — 읽을 수 있는 스레드만(sources). 이미 다른 고객 것이면 충돌.
  const { resolveSource } = require('./sources');
  const src = await resolveSource(p, a.source, ['mail']);
  if (src && src.thread.client_id) {
    throw err('CONFLICT', 'already_client', { client_id: src.thread.client_id, hint: 'This mail thread already belongs to a client. Use get_client with that client_id.' });
  }
  const existing = await findExistingByContact(p.businessId, seed);
  if (!existing) {
    const can = await require('../../plan').can(p.businessId, 'add_prospect');
    if (!can.ok) {
      throw err('QUOTA_EXCEEDED', 'prospects_limit', { limit: can.limit ?? null, current: can.current ?? null, hint: 'The workspace reached its inquiry-client limit. Nothing was created.' });
    }
  }
  return { seed, src, existing };
}

const clientOut = (c) => ({
  client_id: c.id,
  name: c.display_name || c.company_name || null,
  status: c.status, stage: c.sales_stage || null,
  url: `${cfg.APP_URL}/sale/${c.id}`,
});

async function previewCreateClientInquiry(p, a) {
  const { seed, src, existing } = await prepare(p, a);
  return {
    action: existing ? 'link_existing_client' : 'create_inquiry_client',
    name: seed.display_name, company: seed.company_name, email: seed.email, phone: seed.phone,
    existing_client: existing ? clientOut(existing) : null,
    source_mail: src ? { thread_id: src.thread.id, url: src.url } : null,
    past_mail: seed.email ? 'Past mail to and from this address in this workspace will be linked to the client.' : null,
    first_record: a.content ? true : false,
    note: existing ? 'A client with this contact already exists — nothing new is created.' : 'Creates an inquiry client in Q sale. No email or invitation is sent.',
  };
}

async function createClientInquiry(p, a, actor) {
  const { seed, src, existing } = await prepare(p, a);
  let interaction = null;
  if (a.content || a.content_title) {
    let occurred = undefined;
    if (a.occurred_at) {
      const { userTz, parseAgentTime } = require('../datetime');
      occurred = parseAgentTime(a.occurred_at, 'occurred_at', await userTz(p));
      if (occurred.getTime() > Date.now() + 60 * 1000) throw err('VALIDATION_ERROR', 'occurred_in_future');
    }
    let body = a.content || '';
    if (src) {
      const { sourceLine } = require('./sources');
      body = `${body}\n\n${await sourceLine(p, 'mail', src.url)}`.trim();
    }
    interaction = { kind: a.kind || 'memo', title: a.content_title || null, body, occurred_at: occurred, direction: a.direction };
  }
  const saved = await require('../../actions/client_actions').saveInquiryClient({
    businessId: p.businessId, userId: p.userId, from: 'manual', seed,
    thread: src ? src.thread : null, req: null, channel: actor && actor.channel,
    interaction, verifiedSource: src && interaction ? { source_kind: 'email' } : null,
    via: `agent:${p.provider || 'unknown'}`,
  });
  if (!saved.ok) throw err('QUOTA_EXCEEDED', 'prospects_limit', { limit: saved.can?.limit ?? null, current: saved.can?.current ?? null, hint: 'The workspace reached its inquiry-client limit. Nothing was created.' });
  const { Client } = require('../../../models');
  const fresh = await Client.findOne({ where: { id: saved.client.id, business_id: p.businessId } });
  const r = saved.interactionRow;
  return {
    client: clientOut(fresh || saved.client),
    created: !saved.linkedExisting,
    linked_existing: saved.linkedExisting,
    // ★ 키는 interaction 이 아니라 record — execute 의 감사 대상 판정이 data.interaction 에 먼저 걸린다(Fable D)
    record: r ? { interaction_id: r.id, kind: r.kind, title: r.title || null, occurred_at: iso(r.occurred_at) } : null,
    record_error: saved.interactionError || null,
    ...(existing ? { hint: 'A client with this email or phone already existed — returned it instead of creating a duplicate.' } : {}),
  };
}

module.exports = { createClientInquiry, previewCreateClientInquiry };
