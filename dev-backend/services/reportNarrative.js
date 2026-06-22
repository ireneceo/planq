// services/reportNarrative.js — #85 보고서 executive summary(SCR 구조) AI 생성.
// 스냅샷 데이터(KPI·하이라이트·리스크·블로커·다음) → SCR(상황·문제·해결) 경영진 요약.
// 온디맨드(버튼) 전용 — 자동 호출 안 함(AI 최소사용 원칙). 보고서 IA/탭 불변, 서술 블록만.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = 'gpt-4o-mini';

function briefList(arr, n = 12) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, n)
    .map((t) => (typeof t === 'string' ? t : (t && (t.title || t.name)) || ''))
    .filter(Boolean);
}

// 스냅샷 + 컨텍스트 → { headline, situation, complication, resolution, narrative }
async function generateScrNarrative({ snapshot, scopeLabel, periodLabel, lang = 'ko' }) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
  const s = snapshot || {};
  const data = {
    scope: scopeLabel || '',
    period: periodLabel || '',
    kpi: s.kpi || {},
    highlights: briefList(s.highlights),
    in_progress: briefList(s.in_progress),
    risks: briefList(s.risks),
    blockers: briefList(s.blockers),
    next: briefList(s.next),
    issues: briefList(s.issues),
  };
  const isKo = lang !== 'en';
  const SYSTEM = isKo
    ? `당신은 PlanQ의 시니어 PM이다. 주어진 보고 데이터로 경영진용 요약을 SCR(상황·문제·해결) 구조로 작성한다.
- headline: 한 문장 핵심 메시지(가능하면 정량 포함, 30자 내외)
- situation: 현재 진행 상황(KPI·완료·진행 중심). 2~3문장.
- complication: 리스크·지연·블로커. 없으면 "특이 리스크 없음". 2~3문장.
- resolution: 다음 조치·의사결정 필요사항. 2~3문장.
규칙: 데이터에 있는 사실만, 과장·추측 금지. 한국어. 반드시 JSON 만: {"headline","situation","complication","resolution"}`
    : `You are a senior PM at PlanQ. Write an executive summary from the report data using the SCR (Situation-Complication-Resolution) structure.
- headline: one-sentence key message (include numbers if possible, ~12 words)
- situation: current progress (KPI, completed, in-progress). 2-3 sentences.
- complication: risks, delays, blockers. If none, say "No notable risks." 2-3 sentences.
- resolution: next actions and decisions needed. 2-3 sentences.
Rules: only facts present in the data, no exaggeration or speculation. English. Respond as JSON only: {"headline","situation","complication","resolution"}`;

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(data).slice(0, 40_000) },
      ],
      temperature: 0.3,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`LLM ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  let parsed = {};
  try { parsed = JSON.parse(j.choices?.[0]?.message?.content || '{}'); } catch { parsed = {}; }

  const headline = String(parsed.headline || '').trim();
  const situation = String(parsed.situation || '').trim();
  const complication = String(parsed.complication || '').trim();
  const resolution = String(parsed.resolution || '').trim();
  const L = isKo ? { s: '상황', c: '문제', r: '해결' } : { s: 'Situation', c: 'Complication', r: 'Resolution' };
  const narrative = [
    headline ? `**${headline}**` : '',
    '', `📌 ${L.s}`, situation,
    '', `📌 ${L.c}`, complication,
    '', `📌 ${L.r}`, resolution,
  ].join('\n').trim();

  return { headline, situation, complication, resolution, narrative };
}

module.exports = { generateScrNarrative };
