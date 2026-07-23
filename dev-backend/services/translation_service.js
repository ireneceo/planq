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

// ─────────────────────────────────────────────
// 단방향 번역 — 메일 본문처럼 "한 언어로만" 필요한 긴 텍스트용 (#197)
// ─────────────────────────────────────────────
// translateForBilingual 은 Q talk 채팅용이라 **양 언어를 동시에** 생성한다. 메일 본문(수천 자)에
// 그걸 쓰면 출력 토큰이 2배로 들고 2000토큰 상한에서 JSON 이 중간에 잘려(Unterminated string)
// 재시도까지 겹쳐 사용자가 2분 대기 후 실패를 봤다. 여기서는 대상 언어 하나만 만든다.
// 반환: { detected_language, translated, fallback?, reason? }
async function translateOne(text, targetLang, businessId = null) {
  if (!isEnabled()) return { detected_language: null, translated: null, fallback: true, reason: 'llm_disabled' };
  const target = String(targetLang || '');
  if (!SUPPORTED_LANGS.includes(target)) {
    return { detected_language: null, translated: null, fallback: true, reason: 'unsupported_language' };
  }
  if (!text || !text.trim()) {
    return { detected_language: null, translated: null, fallback: true, reason: 'empty_text' };
  }
  const input = text.length > 8000 ? text.slice(0, 8000) : text;
  if (businessId) {
    try {
      const { checkUsageLimit } = require('./cue_orchestrator');
      const usage = await checkUsageLimit(businessId);
      if (usage.over) return { detected_language: null, translated: null, fallback: true, reason: 'usage_limit_exceeded' };
    } catch { /* best-effort */ }
  }

  const systemPrompt = `You are a precise translator. Detect the source language of the user message, then translate it into ${LANG_NAMES[target]}.

RULES:
- Translate the ENTIRE message. Never summarize, paraphrase, or truncate.
- If the source is already ${LANG_NAMES[target]}, return it verbatim.
- Preserve ALL line breaks (\\n in JSON), numbering, bullets, indentation, blank lines.
- Preserve emojis, URLs, @mentions, #hashtags, code blocks, special characters as-is.
- No commentary, no markdown fences.

JSON RULES:
- Respond as VALID JSON only.
- Inside string values use \\n for newline, \\" for quote, \\\\ for backslash.
- Schema: {"detected_language": "ko|en|ja|zh|es", "translated": "..."}`;

  try {
    // 단방향이라 출력량은 대략 입력 문자수에 비례. 잘림이 곧 실패이므로 넉넉히 잡되 상한은 purpose 가 캡한다.
    const { content: raw, fallback: failed, finish_reason, input_tokens, output_tokens, model } = await callLLM({
      purpose: 'translation_long',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ],
      json: true,
      maxTokens: Math.min(4000, Math.max(500, Math.ceil(input.length * 1.6) + 300)),
      fallback: '',
    });
    if (failed) return { detected_language: null, translated: null, fallback: true, reason: 'llm_error' };

    let parsed;
    const content = raw || '{}';
    try {
      parsed = JSON.parse(content);
    } catch {
      const sanitized = content
        .replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\n').replace(/\t/g, '\\t')
        // eslint-disable-next-line no-control-regex
        .replace(new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F]", "g"), "");
      try { parsed = JSON.parse(sanitized); } catch (e2) {
        console.warn('[translation] one-way JSON parse failed', e2.message, '| raw 100:', content.slice(0, 100));
        return { detected_language: null, translated: null, fallback: true, reason: 'json_parse_failed' };
      }
    }
    const detected = parsed.detected_language || null;
    const translated = typeof parsed.translated === 'string' ? parsed.translated : null;
    if (!translated || !translated.trim()) {
      return { detected_language: detected, translated: null, fallback: true, reason: 'empty_translation' };
    }
    // ★ 잘린 번역 통과 차단 — 토큰 상한에 걸려 앞부분만 온 응답이 "성공" 으로 새면 사용자는
    //   조용히 반쪽 번역을 읽게 된다. 길이가 원문의 25% 미만이거나 length 로 끊겼으면 실패 처리.
    if (finish_reason === 'length' || translated.length < input.length * 0.25) {
      console.warn(`[translation] truncated — in ${input.length} / out ${translated.length} / finish=${finish_reason}`);
      return { detected_language: detected, translated: null, fallback: true, reason: 'truncated' };
    }
    if (businessId) {
      try {
        const { recordUsage } = require('./cue_orchestrator');
        await recordUsage(businessId, 'translation', model, input_tokens || 0, output_tokens || 0);
      } catch (e) { console.warn('[translation] recordUsage failed', e.message); }
    }
    return { detected_language: detected, translated, input_tokens: input_tokens || 0, output_tokens: output_tokens || 0 };
  } catch (e) {
    console.warn('[translation] one-way exception', e.message);
    return { detected_language: null, translated: null, fallback: true, reason: 'exception' };
  }
}

// 단방향 재시도 wrapper — 양방향과 동일 정책 (일시적 parse/빈응답 1회 재시도)
async function translateOneWithRetry(text, targetLang, businessId = null) {
  let r = await translateOne(text, targetLang, businessId);
  // ★ 재시도는 "일시적 실패" 에만. 출력 토큰 상한에서 잘린 것(truncated)이나 그 결과로 깨진 JSON 은
  //   같은 입력·같은 상한이면 **결정적으로 또 실패**한다. 재시도하면 사용자 대기만 2배가 된다(#197).
  const RETRYABLE = ['empty_translation', 'malformed_response'];
  if (r.fallback && r.reason === 'json_parse_failed' && text.length > 4000) {
    console.log('[translation] json_parse_failed on long input — 재시도 skip (토큰 상한 결정적 실패)');
    return r;
  }
  if (r.fallback && (RETRYABLE.includes(r.reason) || r.reason === 'json_parse_failed')) {
    console.log(`[translation] one-way retry — first reason=${r.reason}`);
    r = await translateOne(text, targetLang, businessId);
  }
  return r;
}

module.exports = {
  translateForBilingual,
  translateWithRetry,
  translateOne,
  translateOneWithRetry,
  validateLanguages,
  SUPPORTED_LANGS,
  LANG_NAMES,
};
