// services/saleExtract.js — 붙여넣은 글에서 **문의 고객 정보만 뽑는다**(Q sale 문의 추가 보조).
//
// Irene 2026-09-12: "문의 추가에 AI 입력 … 작성자 기록 … 유입 경로 명확히"
//   전화로 받은 메모나 메일 본문을 그대로 붙여넣으면 이름·회사·전화·이메일을 사람이 다시 타이핑한다.
//   그 타이핑만 없애는 것이 여기 할 일이다 — **저장하지 않는다.** 값은 폼에 채우고 사람이 확인해 저장한다
//   (memory feedback_ai_minimal_usage · feedback_system_filled_not_user_input: 시스템이 채운 값은
//    사용자 입력이 아니므로 화면이 그 사실을 말하고, 사람이 고칠 수 있어야 한다).
//
// 비용 3종 세트(CLAUDE.md 운영 1번): 라우트의 perUserDaily + 여기의 checkUsageLimit + capText.
//   한도 초과면 LLM 을 **부르지 않는다**.
const { callLLM } = require('./llm');
const { checkUsageLimit, recordUsage } = require('./cue_orchestrator');
const { capText } = require('../middleware/costGuard');

const MAX_INPUT_CHARS = 12_000;
// sales_source ENUM 과 **같은 목록**이어야 한다(models/Client.js). 모델이 딴 값을 내면 버린다.
const SOURCES = ['guest_link', 'email', 'phone', 'referral', 'web', 'event', 'manual', 'other'];

const SYSTEM = [
  '당신은 B2B 문의 메모에서 연락처 정보를 뽑는 추출기다. 추측하지 말고 **글에 있는 것만** 뽑는다.',
  '없으면 null 을 쓴다. 새 사실을 만들지 않는다.',
  'JSON 만 출력한다:',
  '{"display_name":string|null,"company_name":string|null,"phone":string|null,"email":string|null,',
  ' "sales_source":"phone"|"email"|"referral"|"web"|"event"|"guest_link"|"other"|null,',
  ' "summary":string|null}',
  '- display_name: 사람 이름. 직함·존칭은 뺀다.',
  '- company_name: 회사·기관명. 이메일 도메인으로 **추측하지 않는다**(글에 회사명이 있을 때만).',
  '- phone: 숫자와 하이픈만. 여러 개면 첫 번째.',
  '- sales_source: 글이 말하는 유입 경로(전화로 왔다 → phone, 소개 → referral, 행사·방문 → event).',
  '  단서가 없으면 null.',
  '- summary: 문의 내용 한 줄(80자 이내). 상담 기록 메모의 제목으로 쓴다.',
].join('\n');

const trim = (v, max) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/**
 * @returns {{ ok: true, data: {...} }} 또는 {{ ok: false, reason: string }}
 *   reason: 'empty' | 'usage_limit' | 'ai_unavailable' | 'ai_unparsable'
 */
async function extractInquiry(businessId, rawText, { userId } = {}) {
  const text = String(rawText || '').trim();
  if (!text) return { ok: false, reason: 'empty' };

  const usage = await checkUsageLimit(businessId);
  if (usage.over) return { ok: false, reason: 'usage_limit' };

  const r = await callLLM({
    purpose: 'sale_extract',
    json: true,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: capText(text, MAX_INPUT_CHARS) },
    ],
    fallback: '',
  });
  if (r.fallback || !r.content) return { ok: false, reason: 'ai_unavailable' };

  let parsed = null;
  try { parsed = JSON.parse(r.content); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'ai_unparsable' };

  await recordUsage(businessId, 'extract', r.model, r.input_tokens, r.output_tokens);

  const email = trim(parsed.email, 200);
  const data = {
    display_name: trim(parsed.display_name, 100),
    company_name: trim(parsed.company_name, 200),
    phone: trim(parsed.phone, 40),
    // 형식이 틀린 주소는 버린다 — 저장 라우트가 400 을 낼 값을 폼에 채워 주면 사용자가 원인을 모른다
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null,
    sales_source: SOURCES.includes(parsed.sales_source) ? parsed.sales_source : null,
    summary: trim(parsed.summary, 200),
  };
  // 아무것도 못 뽑았으면 화면이 그렇게 말해야 한다(조용한 무반응 금지)
  const got = ['display_name', 'company_name', 'phone', 'email'].some((k) => data[k]);
  return { ok: true, data: { ...data, found: got } };
}

module.exports = { extractInquiry, MAX_INPUT_CHARS };
