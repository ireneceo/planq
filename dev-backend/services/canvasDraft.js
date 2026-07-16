// services/canvasDraft.js — ⑤ 프로젝트 캔버스 AI 초안 생성
//
// 프로젝트 컨텍스트(이름·설명·고객·관련 업무)로 전략 프레임(SCQA)·성공지표·추진과제 초안을 LLM 생성.
// "자동입력 + 수정가능"(Irene ⑤ 3상태): 생성분은 source='ai' 로 마킹되고 전량 편집 가능,
//   사용자가 그 필드를 손대면 'manual' 로 flip. 이 서비스는 생성만 — 저장·비파괴 병합은 라우트가 소유.
// LLM 은 게이트웨이(services/llm.js) 단일 경유. 근거 없는 수치 날조 금지.

const { callLLM, isEnabled } = require('./llm');

const SYSTEM_PROMPT = `너는 B2B 프로젝트 전략 컨설턴트다. 주어진 프로젝트 정보로 실행용 전략 프레임 초안을 만든다.
반드시 아래 JSON 만 출력한다 (설명 문장 금지):
{
  "strategy": {
    "context": "추진 배경 (현재 상황·왜 지금)",
    "key_question": "이 프로젝트가 답해야 할 핵심 질문 한 문장",
    "goal": "정성 목표 (무엇을 달성)",
    "governing_thought": "핵심 메시지 한 문장 (피라미드 최상단)",
    "approach": "추진 방식 (어떻게)"
  },
  "success_metrics": [ { "label": "지표명", "target": "목표값(불확실하면 빈 문자열)", "unit": "단위" } ],
  "workstreams": [ { "title": "추진과제명", "description": "한 줄 설명" } ]
}
규칙:
- 언어: 입력 프로젝트의 언어를 따른다 (한국어 프로젝트면 한국어, 영어면 영어).
- success_metrics 2~4개, workstreams 3~5개. 측정 가능·구체적으로.
- 근거 없는 숫자 날조 금지 — target 이 불확실하면 빈 문자열.
- 기존에 채워진 전략 메모가 있으면 그 방향과 모순되지 않게.`;

const clip = (v, n) => (v == null ? '' : String(v).slice(0, n));

// project + context → { strategy, metrics, workstreams }. 저장하지 않는다(제안). 실패 시 throw.
async function generateCanvasDraft(project, context = {}) {
  if (!isEnabled()) throw new Error('llm_unavailable');

  const parts = [`프로젝트명: ${project.name || ''}`];
  if (project.description) parts.push(`설명: ${clip(project.description, 2000)}`);
  if (context.clientName) parts.push(`고객: ${clip(context.clientName, 200)}`);
  const existing = [project.strategy_context, project.strategy_goal, project.strategy_governing_thought]
    .filter(Boolean).join(' / ');
  if (existing) parts.push(`기존 전략 메모: ${clip(existing, 600)}`);
  if (Array.isArray(context.taskTitles) && context.taskTitles.length) {
    parts.push(`관련 업무: ${clip(context.taskTitles.slice(0, 20).join(', '), 1000)}`);
  }

  const res = await callLLM({
    purpose: 'brief',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: parts.join('\n').slice(0, 8000) },
    ],
    json: true,
    maxTokens: 1200,
    fallback: '',
  });
  if (res.fallback) throw new Error('llm_unavailable');

  let parsed;
  try { parsed = JSON.parse(res.content || '{}'); } catch { throw new Error('llm_parse_failed'); }

  const s = parsed.strategy || {};
  const strategy = {
    context: clip(s.context, 2000),
    key_question: clip(s.key_question, 2000),
    goal: clip(s.goal, 2000),
    governing_thought: clip(s.governing_thought, 2000),
    approach: clip(s.approach, 2000),
  };
  const metrics = (Array.isArray(parsed.success_metrics) ? parsed.success_metrics : [])
    .filter((m) => m && m.label).slice(0, 6)
    .map((m) => ({ label: clip(m.label, 120), target: clip(m.target, 60), current: '', unit: clip(m.unit, 20) }));
  const workstreams = (Array.isArray(parsed.workstreams) ? parsed.workstreams : [])
    .filter((w) => w && w.title).slice(0, 6)
    .map((w) => ({ title: clip(w.title, 200), description: clip(w.description, 1000) }));

  return { strategy, metrics, workstreams, usage: { input_tokens: res.input_tokens, output_tokens: res.output_tokens } };
}

module.exports = { generateCanvasDraft };
