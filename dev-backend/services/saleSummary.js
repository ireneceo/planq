// services/saleSummary.js — 고객 히스토리 요약 (docs/Q_SALE_DESIGN.md §10)
//
// Irene: "특히 중요." 운영에서 "고객이 최근 행동한게 뭐야" 에 답을 못 했다 —
//   옛 generateClientSummary 는 **채팅 40건만** 넣었기 때문이다. 입력을 타임라인 전 채널로 바꾼다.
//
// 원칙
//   ① **원장은 타임라인이다.** 요약은 언제든 버리고 다시 만드는 캐시다(회차를 쌓지 않는다).
//   ② **기준선은 `summary_as_of` 하나** — stale 판정·증분 입력 절단·"새 접점 N건" 이 전부 이 값을 읽는다.
//   ③ **문장마다 근거(refs)** 를 요구한다. 근거 없는 문장은 버리지 않고 "근거 없음" 으로 표시해
//      환각을 사용자가 보는 자리에서 걸러낸다(지우면 무엇이 틀렸는지도 사라진다).
//   ④ 사람이 직접 고친 요약(summary_manual)은 자동으로 덮지 않는다.
//   ⑤ stale 이 아니면 **LLM 을 부르지 않는다**(비용). 게이트: checkUsageLimit + recordUsage + capText.
const { Op } = require('sequelize');
const { Client, EmailThread, ClientInteraction } = require('../models');
const { getClientTimeline, ALL_CHANNELS } = require('./clientTimeline');
const { callLLM } = require('./llm');
const { checkUsageLimit, recordUsage } = require('./cue_orchestrator');
const { createAuditLog } = require('./auditService');
const { capText } = require('../middleware/costGuard');

const MAX_ITEMS = 80;             // §10.1 — 최근 90일 또는 80항목 중 먼저 닿는 것
const WINDOW_DAYS = 90;
const MAX_INPUT_CHARS = 8000;
const SECTIONS = ['situation', 'needs', 'decisions', 'open_issues', 'next_steps'];

const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** 요약이 낡았는가 — 기준선(summary_as_of) 뒤에 생긴 접점 수. 기준선이 없으면 "요약 없음". */
async function summaryStatus(businessId, clientId, { userId }) {
  const client = await Client.findOne({ where: { id: clientId, business_id: businessId } });
  if (!client) return null;
  const asOf = client.summary_as_of ? new Date(client.summary_as_of) : null;
  let newItems = 0;
  if (asOf) {
    const { items } = await getClientTimeline(businessId, clientId, { userId, limit: MAX_ITEMS, channels: ALL_CHANNELS });
    newItems = items.filter((it) => it.at && new Date(it.at) > asOf).length;
  }
  return {
    has_summary: !!(client.summary || client.summary_json),
    summary: client.summary || null,
    summary_json: client.summary_json || null,
    as_of: client.summary_as_of,
    updated_at: client.summary_updated_at,
    manual: !!client.summary_manual,
    model: client.summary_model || null,
    item_count: client.summary_item_count || null,
    new_items: newItems,
    stale: !asOf ? !!(client.summary || client.summary_json) : newItems > 0,
  };
}

/** 타임라인 항목 → LLM 입력 줄. 각 줄 앞에 `[#n type id at]` 인덱스를 달아 refs 로 되짚게 한다. */
async function buildInputLines(businessId, clientId, items) {
  // 메일은 스레드 요약 캐시가 있으면 그것을 쓴다(더 짧고 정확 · 비용 ↓)
  const threadIds = [...new Set(items.filter((i) => i.type === 'email' && i.thread_id).map((i) => i.thread_id))];
  const threadSummary = new Map();
  if (threadIds.length) {
    const rows = await EmailThread.findAll({
      where: { business_id: businessId, id: { [Op.in]: threadIds } },
      attributes: ['id', 'ai_summary'], raw: true,
    });
    for (const r of rows) if (r.ai_summary) threadSummary.set(r.id, r.ai_summary);
  }
  // 상담 기록은 요약·본문 원문을 쓴다(타임라인 preview 140자로는 통화 내용이 날아간다)
  const interactionIds = items.filter((i) => i.type === 'interaction').map((i) => Number(i.id));
  const interactions = new Map();
  if (interactionIds.length) {
    const rows = await ClientInteraction.findAll({
      where: { business_id: businessId, id: { [Op.in]: interactionIds } },
      attributes: ['id', 'summary', 'body', 'key_points', 'origin', 'reviewed_at', 'kind'], raw: true,
    });
    for (const r of rows) interactions.set(r.id, r);
  }

  const lines = [];
  const index = [];
  items.forEach((it, i) => {
    const n = i + 1;
    const at = it.at ? new Date(it.at).toISOString().slice(0, 10) : '?';
    let text = it.preview || it.title || '';
    let mark = '';
    if (it.type === 'email' && threadSummary.has(it.thread_id)) text = clip(threadSummary.get(it.thread_id), 600);
    if (it.type === 'interaction') {
      const r = interactions.get(Number(it.id));
      if (r) {
        const kp = Array.isArray(r.key_points) ? r.key_points.join(' · ') : '';
        text = clip([r.summary, r.body, kp].filter(Boolean).join(' / '), 600);
        // 자동으로 쌓였고 아직 사람이 확인하지 않은 기록 — 출력에도 그대로 따라 붙게 한다
        if (r.origin === 'auto' && !r.reviewed_at) mark = ' (미확인)';
      }
    }
    if (it.type === 'stage') {
      const m = it.meta || {};
      text = `${m.from || '—'} → ${m.to}${m.origin === 'auto' ? ' (자동)' : ''}${m.reason ? ` · ${m.reason}` : ''}`;
    }
    if (it.type === 'guest') text = (it.meta || {}).event === 'account_requested' ? '계정 요청' : '게스트 링크 발급';
    if (!text) text = it.title || '(내용 없음)';
    lines.push(`[#${n} ${it.type} ${it.id} ${at}] ${clip(text, 240)}${mark}`);
    index.push({ n, type: it.type, id: it.id });
  });
  return { lines, index };
}

const SYSTEM = `너는 한 고객과의 접점 기록을 읽고 영업 담당자가 3초 만에 파악할 요약을 만든다.
반드시 JSON 하나만 출력한다:
{"situation":[{"text":"...","refs":[1,4]}],"needs":[...],"decisions":[...],"open_issues":[...],"next_steps":[...]}
규칙:
- 모든 문장에 refs 를 단다. refs 는 입력 줄 앞의 #번호다. 근거를 못 찾으면 refs 를 빈 배열로 둔다.
- 입력에 없는 사실을 지어내지 않는다. 추측하지 않는다.
- 각 문장은 한 줄(60자 이내). 섹션마다 최대 4개.
- 입력 줄에 "(미확인)" 이 붙어 있으면 그 문장 끝에도 "(미확인)" 을 붙인다.
- 한국어로 쓴다.`;

function toPlainText(json) {
  const LABEL = { situation: '상황', needs: '요구·조건', decisions: '결정', open_issues: '미해결', next_steps: '다음' };
  const parts = [];
  for (const key of SECTIONS) {
    const rows = Array.isArray(json?.[key]) ? json[key] : [];
    if (!rows.length) continue;
    parts.push(`${LABEL[key]}: ${rows.map((r) => r.text).filter(Boolean).join(' · ')}`);
  }
  return parts.join('\n');
}

/** LLM 출력 정리 — refs 를 입력 인덱스로 검증해 {type,id} 로 바꾼다(없는 번호는 버린다). */
function normalize(raw, index) {
  const byN = new Map(index.map((x) => [x.n, x]));
  const out = {};
  for (const key of SECTIONS) {
    const rows = Array.isArray(raw?.[key]) ? raw[key] : [];
    out[key] = rows.slice(0, 4).map((r) => {
      const text = typeof r === 'string' ? r : String(r?.text || '').trim();
      const refsIn = Array.isArray(r?.refs) ? r.refs : [];
      const refs = refsIn
        .map((n) => byN.get(Number(n)))
        .filter(Boolean)
        .map((x) => ({ type: x.type, id: x.id }));
      return { text: clip(text, 200), refs };
    }).filter((r) => r.text);
  }
  return out;
}

/**
 * 요약 생성 — **stale 이 아니면 LLM 을 부르지 않는다.**
 * @returns {Promise<{ok:boolean, skipped?:string, status?:object}>}
 */
async function generateSaleSummary(businessId, clientId, { userId, force = false, origin = 'manual' } = {}) {
  const client = await Client.findOne({ where: { id: clientId, business_id: businessId } });
  if (!client) return { ok: false, skipped: 'not_found' };

  // 사람이 직접 고친 요약은 자동 시점이 덮지 않는다(§10.4). 사람이 [AI 로 다시] 를 누르면 force 로 온다.
  if (client.summary_manual && !force) return { ok: false, skipped: 'manual_summary' };

  const before = await summaryStatus(businessId, clientId, { userId });
  if (!force && before.has_summary && !before.stale) return { ok: false, skipped: 'up_to_date', status: before };

  const usage = await checkUsageLimit(businessId);
  if (usage.over) return { ok: false, skipped: 'usage_limit', status: before };

  const since = new Date(Date.now() - WINDOW_DAYS * 86400000);
  const { items } = await getClientTimeline(businessId, clientId, { userId, limit: MAX_ITEMS, channels: ALL_CHANNELS });
  const windowed = items.filter((it) => it.at && new Date(it.at) >= since);
  if (!windowed.length) return { ok: false, skipped: 'no_items', status: before };

  const { lines, index } = await buildInputLines(businessId, clientId, windowed);
  // 증분 — 창 밖(90일 이전)은 지난 요약 텍스트로 대신한다(§10.1)
  const prev = client.summary ? `지난 요약:\n${clip(client.summary, 800)}\n\n` : '';
  const userContent = capText(`${prev}접점 기록(최근 → 과거):\n${lines.join('\n')}`, MAX_INPUT_CHARS);

  const r = await callLLM({
    purpose: 'sale_summary',
    json: true,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userContent }],
    fallback: '',
  });
  if (r.fallback || !r.content) return { ok: false, skipped: 'ai_unavailable', status: before };

  let parsed = null;
  try { parsed = JSON.parse(r.content); } catch { parsed = null; }
  if (!parsed) return { ok: false, skipped: 'ai_unparsable', status: before };

  const summaryJson = normalize(parsed, index);
  const text = toPlainText(summaryJson);
  if (!text) return { ok: false, skipped: 'ai_empty', status: before };

  const latestAt = windowed[0]?.at ? new Date(windowed[0].at) : new Date();
  const oldValue = { summary: client.summary, summary_json: client.summary_json, summary_as_of: client.summary_as_of };

  await client.update({
    summary: text,
    summary_json: summaryJson,
    summary_as_of: latestAt,
    summary_item_count: windowed.length,
    summary_model: r.model || null,
    summary_updated_at: new Date(),
    summary_manual: false,
  });
  await recordUsage(businessId, 'summary', r.model, r.input_tokens, r.output_tokens);
  // 이전 요약은 감사 로그의 old_value 가 보관한다 — 요약 회차 테이블을 따로 두지 않는다(§10.2)
  createAuditLog({
    userId: userId || null, businessId, action: 'client.summary_regenerate',
    targetType: 'client', targetId: client.id,
    oldValue, newValue: { summary: text, summary_as_of: latestAt, origin, items: windowed.length },
  });

  return { ok: true, status: await summaryStatus(businessId, clientId, { userId }) };
}

/** 사람이 직접 고친 요약 — AI 가 덮지 않는다(카드에 "직접 수정한 요약" 이 뜬다). */
async function setManualSummary(businessId, clientId, { userId, text }) {
  const client = await Client.findOne({ where: { id: clientId, business_id: businessId } });
  if (!client) return null;
  const oldValue = { summary: client.summary, summary_manual: client.summary_manual };
  await client.update({
    summary: clip(text, 4000),
    summary_manual: true,
    summary_updated_at: new Date(),
    // 구조화 요약은 사람이 고친 문장과 어긋나므로 버린다 — 화면은 전문을 그린다
    summary_json: null,
  });
  createAuditLog({
    userId: userId || null, businessId, action: 'client.summary_regenerate',
    targetType: 'client', targetId: client.id,
    oldValue, newValue: { summary: clip(text, 4000), summary_manual: true, origin: 'human_edit' },
  });
  return summaryStatus(businessId, clientId, { userId });
}

module.exports = { generateSaleSummary, summaryStatus, setManualSummary, MAX_ITEMS, WINDOW_DAYS };
