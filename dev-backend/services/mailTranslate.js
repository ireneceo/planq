// 메일 본문 번역 — 한 번 번역하면 저장하고 다시 쓴다 (2026-10-30, Irene: *"번역 한번 하면 그대로 저장하고 다음에 들어오면
//   접혀 있다가 번역하기가 번역보기로 바뀐 후 열면 보이게 하자. 아니면 매번 ai 토큰 쓰는 거 아니야?"*).
//   받은 메일 본문은 바뀌지 않으므로 (메시지 × 대상 언어) 하나에 번역문 하나다. email_messages.translations
//   = { <lang>: { text, detected_language, at } }. 같은 메일함을 보는 멤버가 같이 쓴다(본문을 읽을 수 있는 사람이면 번역도 읽는다).
const { sequelize } = require('../config/database');

const SUPPORTED = ['ko', 'en', 'ja', 'zh', 'es'];

// 화면에 내리는 모양 — { ko: '번역문', … }. 저장 형식이 깨졌으면 그 언어는 없는 것으로 본다.
function savedTranslations(raw) {
  let obj = raw;
  if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { return {}; } }
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const lang of SUPPORTED) {
    const v = obj[lang];
    if (v && typeof v.text === 'string' && v.text) out[lang] = v.text;
  }
  return out;
}

// 번역할 본문 — 정리된 본문 우선(인용/전달/서명 제거), 없으면 원문 / HTML strip.
function sourceText(msg) {
  const { cleanVisibleBody } = require('./emailBodyClean');
  return cleanVisibleBody(msg.body_text, msg.body_html) || msg.body_text
    || String(msg.body_html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// 저장된 것이 있으면 AI 를 부르지 않는다. 없으면 번역 → 그 언어 칸만 원자적으로 끼워 넣는다
//   (두 사람이 동시에 다른 언어로 번역해도 서로 덮지 않게 JSON_SET).
// 반환 { ok, translated, detected_language, cached } | { ok:false, error, status }
async function translateMessage(msg, target, businessId) {
  if (!SUPPORTED.includes(target)) return { ok: false, error: 'unsupported_language', status: 400 };
  const saved = savedTranslations(msg.translations);
  if (saved[target]) {
    const raw = typeof msg.translations === 'string' ? JSON.parse(msg.translations) : msg.translations;
    return { ok: true, translated: saved[target], detected_language: raw[target].detected_language || null, cached: true };
  }
  const text = sourceText(msg);
  if (!text || !text.trim()) return { ok: false, error: 'empty_body', status: 400 };
  // 단방향 번역 — 메일은 대상 언어 하나만 필요하다. 양방향(채팅용)을 쓰면 출력 토큰이 2배라
  //   본문 1천 자만 넘어도 JSON 이 잘리고 재시도까지 겹쳐 2분 대기 후 실패했다(#197).
  const { translateOneWithRetry } = require('./translation_service');
  const r = await translateOneWithRetry(text, target, businessId);
  if (r.fallback || !r.translated) {
    return { ok: false, error: r.reason === 'usage_limit_exceeded' ? 'usage_limit_exceeded' : 'translation_unavailable', status: 503 };
  }
  const entry = JSON.stringify({ text: r.translated, detected_language: r.detected_language || null, at: new Date().toISOString() });
  await sequelize.query(
    `UPDATE email_messages SET translations = JSON_SET(COALESCE(translations, JSON_OBJECT()), ?, CAST(? AS JSON))
      WHERE id = ? AND business_id = ?`,
    { replacements: [`$.${target}`, entry, msg.id, businessId] },
  );
  return { ok: true, translated: r.translated, detected_language: r.detected_language, cached: false };
}

module.exports = { SUPPORTED, savedTranslations, translateMessage };
