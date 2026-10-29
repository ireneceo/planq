// 말로 수정 — «2번째 장면 짧게 · 자막 바꿔 · 음악 바꿔 · 템플릿 바꿔» → 지금 대본을 고친 새 판(설계 §8).
//   AI 는 대본 전체를 다시 쓰되 요청과 무관한 장면은 글자 하나 바꾸지 않는다(바뀐 조각만 다시 렌더되게).
//   검사는 처음 대본과 같은 울타리(validate) — 없는 화면·자막 자리·숫자 장면은 버린다.
// 실행: node ai/revise.js <id> "요청"      되돌리기: node ai/revise.js <id> --revert=2      판 목록: node ai/revise.js <id> --list
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const fs = require('fs');
const path = require('path');
const { callLLM } = require('/opt/planq/dev-backend/services/llm');
const { facts, SCHEMA, validate, fixSay } = require('./script');
const V = require('../lib/versions');

const ROOT = path.join(__dirname, '..');

async function revise(id, request) {
  V.ensureV1(id);
  const all = V.list(id); const cur = all[all.length - 1];
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'capture', 'catalog.json'), 'utf8'));
  const templates = fs.readdirSync(path.join(ROOT, 'templates')).map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', f), 'utf8'))).map((t) => `${t.id}(${t.name})`);
  const musics = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'music', 'catalog.json'), 'utf8')).map((m) => `${m.id}(${m.mood})`);
  const sys = [
    '너는 PlanQ 영상 편집자다. 지금 대본(JSON)을 관리자의 수정 요청대로 고친 **대본 전체** 를 JSON 하나로 낸다.',
    '- 요청과 상관없는 장면·필드는 글자 하나 바꾸지 않는다(그대로 복사). 장면 번호는 1부터 센다.',
    '- 바꿀 수 있는 것: 장면 dur·순서·삭제·추가 · 자막 글(screen 은 같은 beat 키) · side 글 · template(아래 목록) · music(아래 목록) · fromBeat/maxSec.',
    '- 녹음 기반(say 가 있는 대본)은 문장을 지우거나 순서를 바꿀 수 없다 — say 범위 나누기·화면 고르기만.',
    '- 사실·화면 울타리는 처음과 같다: 제품 사실에 없는 것·숫자 금지, 녹화 장면 id·beat 키만.',
    `템플릿: ${templates.join(', ')} · 음악: ${musics.join(', ')}`,
    '출력 형식: {"script": <고친 대본 전체>, "summary": "무엇을 바꿨는지 한두 줄"}',
    '대본 모양 참고:', SCHEMA,
  ].join('\n');
  const user = [`수정 요청: ${request}`, '', '지금 대본:', JSON.stringify(cur.script), '', '녹화 장면:', ...catalog.map((c) => `- ${c.id}: ${c.desc} · beats ${Object.keys(c.beats).join(',')}`), '', '제품 사실:', ...facts().map((f) => '- ' + f)].join('\n');
  const r = await callLLM({ purpose: 'generic', model: 'gpt-5.1', maxTokens: 6000, timeoutMs: 120000, maxInputChars: 40000, temperature: 0.2, json: true, fallback: '',
    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] });
  if (!r.content) throw new Error('AI 수정 실패');
  const j = JSON.parse(r.content);
  const next = { ...cur.script, ...j.script, id };
  const dropped = validate(next, catalog);
  const vj = next.voice ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'voice', next.voice.id, 'voice.json'), 'utf8')) : null;
  if (vj) dropped.push(...fixSay(next, vj.sentences.length));
  next._ai = { ...(cur.script._ai || {}), revise: { model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens, dropped } };
  const changes = V.diff(cur.script, next);
  const rec = V.save(id, next, { source: 'ai', note: `수정 요청: ${request} — ${j.summary || ''}`, parent: cur.version });
  return { rec, changes, summary: j.summary, dropped };
}

if (require.main === module) {
  const id = process.argv[2];
  const rv = (process.argv.find((a) => a.startsWith('--revert=')) || '').slice(9);
  if (process.argv.includes('--list')) { V.ensureV1(id); for (const v of V.list(id)) console.log(`v${v.version} · ${v.source} · ${v.created_at} · ${v.note}`); }
  else if (rv) { const rec = V.revert(id, +rv); console.log(`v${rec.version} 만듦 — ${rec.note}`); }
  else revise(id, process.argv.slice(3).join(' ')).then(({ rec, changes, summary, dropped }) => {
    console.log(`v${rec.version} 만듦 — ${summary}`); changes.forEach((c) => console.log('  ' + c)); if (dropped.length) console.log('  버림: ' + dropped.join(' / '));
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
module.exports = { revise };
