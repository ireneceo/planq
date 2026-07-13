// 메시지 번역 서비스 — Q talk 채팅방 번역 표시용
// 정책: Conversation.translation_enabled = true 일 때 발송 시점에 양 언어로 번역 + DB 캐시
// LLM: gpt-4o-mini (cue_orchestrator 와 동일 모델 풀)

const SUPPORTED_LANGS = ['ko', 'en', 'ja', 'zh', 'es'];

const LANG_NAMES = {
  ko: 'Korean (한국어)',
  en: 'English',
  ja: 'Japanese (日本語)',
  zh: 'Chinese (中文)',
  es: 'Spanish (Español)',
};

// LLM 호출은 게이트웨이 단일 지점을 지난다 (services/llm.js).
const { callLLM, isEnabled } = require('./llm');

// 입력 언어 자동 감지 + 두 언어로 번역
// languages: ["ko","en"] 같은 2-원소 배열
// 반환: { detected_language, translations: { ko: "...", en: "..." } }
async function translateForBilingual(text, languages, businessId = null) {
  if (!isEnabled()) {
    return { detected_language: null, translations: null, fallback: true };
  }
  if (!Array.isArray(languages) || languages.length !== 2) {
    return { detected_language: null, translations: null, fallback: true, reason: 'invalid_languages' };
  }
  const [a, b] = languages.map(String);
  if (!SUPPORTED_LANGS.includes(a) || !SUPPORTED_LANGS.includes(b) || a === b) {
    return { detected_language: null, translations: null, fallback: true, reason: 'unsupported_or_same_language' };
  }
  if (!text || !text.trim()) {
    return { detected_language: null, translations: null, fallback: true, reason: 'empty_text' };
  }
  // 비용폭탄 M-a — 초대형 메시지 번역 시 입력 토큰 폭발 방지. 8,000자로 슬라이스(max_tokens 산식과 정합).
  if (text.length > 8000) text = text.slice(0, 8000);
  // 워크스페이스 월 Cue 한도 검사 — 초과 시 번역 skip (메시지는 원문만, 번역 자동 시도 안 함)
  if (businessId) {
    try {
      const { checkUsageLimit } = require('./cue_orchestrator');
      const usage = await checkUsageLimit(businessId);
      if (usage.over) {
        return { detected_language: null, translations: null, fallback: true, reason: 'usage_limit_exceeded' };
      }
    } catch { /* best-effort */ }
  }

  const systemPrompt = `You are a precise bilingual translator. Detect the source language of the user message, then return BOTH ${LANG_NAMES[a]} (key="${a}") and ${LANG_NAMES[b]} (key="${b}") versions in JSON.

CRITICAL — BOTH translations MUST be non-empty:
- ALWAYS produce a real translation in BOTH languages, even for short text or single words.
- If the source language matches "${a}", then "${a}" = original verbatim, and "${b}" = full translation into ${LANG_NAMES[b]}.
- If the source language matches "${b}", then "${b}" = original verbatim, and "${a}" = full translation into ${LANG_NAMES[a]}.
- NEVER return empty string, null, the same text in both, or "(skip)". Both keys MUST contain real meaningful text.
- Even for proper nouns, single words, code, or emojis — still produce sensible equivalent.

FORMATTING RULES:
- Preserve ALL line breaks (\\n in JSON), numbering, bullet markers, indentation, blank lines.
- Preserve emojis, URLs, @mentions, #hashtags, code blocks, special characters as-is.
- Do NOT paraphrase, summarize, or add commentary.

JSON RULES:
- Respond as VALID JSON only — no commentary, no markdown fences.
- Inside string values, use \\n escape (NOT raw newline), \\" for quote, \\\\ for backslash.
- Schema: {"detected_language": "ko|en|ja|zh|es", "translations": {"${a}": "...", "${b}": "..."}}`;

  try {
    const { content: raw, fallback: failed, input_tokens, output_tokens, model } = await callLLM({
      purpose: 'translation',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      json: true,
      // 양 언어 + JSON wrapper + 한자/한글 토큰 비율 + escape 여유 → 최소 400, 최대 2000 (옛 값 보존)
      maxTokens: Math.min(2000, Math.max(400, Math.ceil(text.length * 4) + 200)),
      fallback: '',
    });
    if (failed) {
      return { detected_language: null, translations: null, fallback: true, reason: 'llm_error' };
    }
    const content = raw || '{}';
    // LLM 이 raw newline 을 응답하면 JSON.parse 실패. string value 내부의 control char 를 escape 후 재시도.
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (firstErr) {
      // raw newline / tab / carriage return 을 escape sequence 로 변환 + 다른 control char 제거
      const sanitized = content
        .replace(/\r\n/g, '\\n')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\n')
        .replace(/\t/g, '\\t')
        // eslint-disable-next-line no-control-regex
        .replace(new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F]", "g"), "");
      try {
        parsed = JSON.parse(sanitized);
      } catch (secondErr) {
        console.warn('[translation] JSON parse failed twice', firstErr.message, '| raw 100:', content.slice(0, 100));
        return { detected_language: null, translations: null, fallback: true, reason: 'json_parse_failed' };
      }
    }
    const detected = parsed.detected_language || null;
    const translations = parsed.translations || null;
    if (!translations || typeof translations[a] !== 'string' || typeof translations[b] !== 'string') {
      return { detected_language: detected, translations: null, fallback: true, reason: 'malformed_response' };
    }
    // 빈 string 검증 — LLM 이 가끔 한 쪽을 빈 값으로 응답함 (대부분 영어→한국어에서 ko 빈 응답).
    // 빈 값이면 fallback — 호출자가 1회 재시도.
    if (!translations[a].trim() || !translations[b].trim()) {
      return { detected_language: detected, translations: null, fallback: true, reason: 'empty_translation' };
    }
    // 사용량 기록 — translation 카테고리 (cue_usage 통합 추적).
    //   게이트웨이는 사용량을 차감하지 않는다 — 누가 부를 자격이 있고 얼마를 쓰는지는 도메인이 안다.
    if (businessId) {
      try {
        const { recordUsage } = require('./cue_orchestrator');
        await recordUsage(businessId, 'translation', model, input_tokens || 0, output_tokens || 0);
      } catch (e) { console.warn('[translation] recordUsage failed', e.message); }
    }
    return {
      detected_language: detected,
      translations,
      input_tokens: input_tokens || 0,
      output_tokens: output_tokens || 0,
      fallback: false,
    };
  } catch (e) {
    console.warn('[translation] exception', e.message);
    return { detected_language: null, translations: null, fallback: true, reason: 'exception' };
  }
}

// 입력 언어 풀 검증
function validateLanguages(arr) {
  if (!Array.isArray(arr) || arr.length !== 2) return { ok: false, reason: 'must_be_two' };
  const [a, b] = arr.map(String);
  if (!SUPPORTED_LANGS.includes(a) || !SUPPORTED_LANGS.includes(b)) {
    return { ok: false, reason: 'unsupported_language' };
  }
  if (a === b) return { ok: false, reason: 'must_differ' };
  return { ok: true, normalized: [a, b] };
}

// 재시도 wrapper — 빈 번역 / parse 실패 등에 1회 재시도 (총 최대 2회 호출)
async function translateWithRetry(text, languages, businessId = null) {
  let r = await translateForBilingual(text, languages, businessId);
  if (r.fallback && (r.reason === 'empty_translation' || r.reason === 'malformed_response' || r.reason === 'json_parse_failed')) {
    console.log(`[translation] retry — first reason=${r.reason}`);
    r = await translateForBilingual(text, languages, businessId);
  }
  return r;
}

module.exports = {
  translateForBilingual,
  translateWithRetry,
  validateLanguages,
  SUPPORTED_LANGS,
  LANG_NAMES,
};
