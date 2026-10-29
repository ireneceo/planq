// AI 대본 작성 — 지시(②) 또는 브랜딩 요청(③)을 받아 «대본(script)» JSON 을 쓴다.
//   대본은 플랫폼 관리자가 확인·수정한 뒤에 렌더한다(이 파일은 쓰기만 한다).
//   쓸 수 있는 화면은 녹화 장면 목록(capture/catalog.json)뿐이고, 사실은 랜딩 문구(제품이 실제로 하는 일)에서만 가져온다 —
//   없는 기능·숫자를 지어내지 않게 하는 두 울타리다. 결과는 검사해서 맞지 않는 장면·자막 자리는 버린다.
// 실행: node ai/script.js --mode=instruction --template=fast-shorts --music=Pamgaea --id=a2-shorts "지시문"
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const fs = require('fs');
const path = require('path');
const { callLLM } = require('/opt/planq/dev-backend/services/llm');

const ROOT = path.join(__dirname, '..');
const arg = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };

function facts() {
  const L = JSON.parse(fs.readFileSync('/opt/planq/dev-frontend/public/locales/ko/landing.json', 'utf8'));
  const out = [];
  for (const c of Object.values(L.value.cards || {})) out.push(`${c.title} — ${c.desc}`);
  for (const [k, q] of Object.entries(L.features.q || {})) out.push(`${q.name}(${k}) — ${q.desc}`);
  out.push(`문제 제기: ${L.problem.title1} ${L.problem.title2} ${L.problem.desc2}`);
  return out;
}

const SCHEMA = `{
  "title": "영상 제목(관리자용)",
  "concept": "한두 문장 — 누구에게 무엇을 어떤 느낌으로",
  "hook": "첫 1~2초에 보일 한 줄(질문형·공감형)",
  "scenes": [
    // 쓸 수 있는 kind 와 필드:
    // {"kind":"kinetic","dur":초,"lines":[{"text":"짧은 문장, *강조*","at":장면 기준 초}]}      — 큰 글자가 차례로 바뀜(도입·전환)
    // {"kind":"title","dur":초,"kicker":"작은 꼬리표","lines":["줄1","*강조* 줄2"],"sub":"보조 한 줄"}
    // {"kind":"screen","shot":"장면 id","side":{"kicker":"작게","title":"두 줄 이내 제목\\n줄바꿈"},"captions":{"beat 키":"자막 *강조*", ...}}
    // {"kind":"montage","dur":초,"title":"선택","shots":[{"shot":"장면 id","t":원본 초}]}  — 제품 화면이 박자마다 한 장씩
    // {"kind":"points","dur":초,"title":"제목 *강조*","points":["짧은 항목", ...]}
    // {"kind":"logo","dur":초,"slogan":"일을 *일답게* 하다","cta":"planq.kr 에서 시작하기"}
    // {"kind":"converge","dur":초,"at":모이는 시각,"chips":[{"label":"채팅","icon":"chat|mail|sheet|file|calendar"}],"line":"한 줄 *강조*"} — 흩어진 도구 칩이 PlanQ 마크로 모임(브랜드용)
    // screen 장면 선택 필드: "fromBeat":"beat 키"(그 순간부터 시작 — 쇼츠 첫 장면 콜드 오픈), "maxSec":원본 초 상한
  ]
}`;

function system(mode, tpl, seconds) {
  return [
    '너는 B2B SaaS «PlanQ» 의 숏폼·홍보 영상 감독이자 카피라이터다. 한국어로 쓴다.',
    `만들 영상: ${mode === 'brand' ? '브랜딩·홍보 영상(모션 그래픽 중심, 제품 화면은 몽타주로)' : '기능 소개 쇼츠(실제 제품 화면 녹화 중심)'} · 목표 길이 약 ${seconds}초 · 템플릿 «${tpl.name}».`,
    '규칙:',
    '- 사실은 아래 «제품 사실» 에 있는 것만 쓴다. 숫자·고객 사례·수상·통계를 지어내지 않는다.',
    '- 화면은 «쓸 수 있는 녹화 장면» 의 id 만 쓴다. screen 장면 자막은 그 장면의 beat 키에만 단다(키 이름 그대로).',
    '- 첫 장면은 1.5초 안에 시청자의 문제를 찌르는 후킹(질문·공감). 마지막은 logo 장면(슬로건 «일을 *일답게* 하다» 고정).',
    '- ★ screen 자막은 그 beat 설명에 적힌 화면만 말한다. 설명에 없는 것(원문 연결·맥락·자동화 등)은 그 순간 화면에 안 보이므로 쓰지 않는다. 기능 설명은 kinetic/title/points 장면으로.',
    '- 자막은 한 번에 한 생각, 18자 안팎. 강조는 *별표*로 한두 단어만. 존댓말 평서/질문 혼용 가능, 과장 광고 문구 금지(«혁신적인», «최고의» 등).',
    mode === 'brand' ? '- 브랜드 영상은 감정 → 문제 → 전환 → 약속 → 로고 흐름. 첫 장면은 converge(흩어진 도구 → PlanQ), 이어서 kinetic·montage·points, screen 은 쓰지 않는다.' : '- 쇼츠는 첫 장면을 가장 센 화면으로 연다: screen + fromBeat(예: AI 후보 카드) + maxSec 2.5 콜드 오픈 → 훅 kinetic 1줄 → 해결 화면 1~2개 → 정리 → 로고. 대시보드 같은 «전체 보기» 장면은 쓰지 않는다.',
    `- 길이 예산: 목표 ${seconds}초를 넘기지 않는다. 대략 screen 장면 하나 = ${tpl.pace > 1.2 ? '6~8' : '9~13'}초, 장면 사이 전환마다 ${tpl.transitionSec}초 겹침. 장면별 예상 길이를 더해 맞춘다.`,
    '- dur 는 kinetic/title/montage/points/logo 에만 쓴다(screen 은 녹화 길이로 정해짐, 대략 장면당 8~14초 — 빠른 템플릿은 배속으로 짧아짐).',
    '출력: 아래 형식의 JSON 하나만.',
    SCHEMA,
  ].join('\n');
}

function validate(script, catalog) {
  const shots = Object.fromEntries(catalog.map((c) => [c.id, c]));
  const dropped = [];
  script.scenes = (script.scenes || []).filter((s) => {
    if (!['kinetic', 'title', 'screen', 'montage', 'points', 'logo', 'chapter', 'stat', 'converge'].includes(s.kind)) { dropped.push(`모르는 kind ${s.kind}`); return false; }
    if (s.kind === 'stat') { dropped.push('stat(숫자 장면)은 사실 확인 전엔 쓰지 않음'); return false; }
    if (s.kind === 'screen') {
      if (!shots[s.shot]) { dropped.push(`없는 장면 ${s.shot}`); return false; }
      for (const k of Object.keys(s.captions || {})) if (!(k in shots[s.shot].beats)) { dropped.push(`${s.shot}: 없는 자막 자리 ${k}`); delete s.captions[k]; }
      if (s.fromBeat && !(s.fromBeat in shots[s.shot].beats)) { dropped.push(`${s.shot}: 없는 fromBeat ${s.fromBeat}`); delete s.fromBeat; }
      // 콜드 오픈 자막은 그 beat 에만
      if (s.fromBeat && s.captions) for (const k of Object.keys(s.captions)) if (k !== s.fromBeat) delete s.captions[k];
    }
    if (s.kind === 'montage') s.shots = (s.shots || []).filter((x) => shots[x.shot]).map((x) => ({ ...x, t: Math.min(x.t || 1, (shots[x.shot].seconds || 6) - 0.5) }));
    if (s.kind === 'converge') { s.at = Math.min(s.at || 2.2, (s.dur || 4) - 1.4); s.chips = (s.chips || []).slice(0, 5); }
    if (s.kind !== 'screen' && !(s.dur > 0)) s.dur = 2.5;
    // 키네틱 한 줄은 읽을 시간이 있어야 한다 — 줄당 1.1초 이상
    if (s.kind === 'kinetic') { s.lines.forEach((l, i) => { l.at = Math.max(l.at || 0, i * 1.1); }); s.dur = Math.max(s.dur, s.lines[s.lines.length - 1].at + 1.3); }
    return true;
  });
  if (!script.scenes.length || script.scenes[script.scenes.length - 1].kind !== 'logo') script.scenes.push({ kind: 'logo', dur: 3.6, slogan: '일을 *일답게* 하다', cta: 'planq.kr 에서 시작하기' });
  return dropped;
}

async function main() {
  const mode = arg('mode', 'instruction');
  const tplId = arg('template', mode === 'brand' ? 'emotional-brand' : 'fast-shorts');
  const seconds = +arg('seconds', mode === 'brand' ? 25 : 30);
  const id = arg('id', `${mode}-${Date.now()}`);
  const instruction = process.argv.filter((a) => !a.startsWith('--')).slice(2).join(' ');
  if (!instruction) throw new Error('지시문이 없음');
  const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', `${tplId}.json`), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'capture', 'catalog.json'), 'utf8'));
  // 장면별 녹화 길이(배속 전) — 길이 감 잡게
  for (const c of catalog) { try { c.seconds = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', 'shots', c.id, 'shot.json'), 'utf8')).duration; } catch { /* 녹화 전 */ } }
  const user = [
    `지시: ${instruction}`,
    '', '제품 사실:', ...facts().map((f) => `- ${f}`),
    '', '쓸 수 있는 녹화 장면(id · 장치 · 길이 · 내용 · beat 키):',
    ...catalog.map((c) => `- ${c.id} · ${c.device} · ${c.seconds || '?'}초 · ${c.desc} · beats: ${Object.entries(c.beats).map(([k, v]) => `${k}(${v})`).join(', ')}`),
  ].join('\n');
  const r = await callLLM({ purpose: 'generic', model: 'gpt-5.1', maxTokens: 4000, timeoutMs: 120000, maxInputChars: 20000, temperature: 0.7, json: true, fallback: '',
    messages: [{ role: 'system', content: system(mode, tpl, seconds) }, { role: 'user', content: user }] });
  if (!r.content) throw new Error('AI 대본 실패: ' + JSON.stringify({ fallback: r.fallback, model: r.model }));
  const script = JSON.parse(r.content);
  const dropped = validate(script, catalog);
  const out = { id, mode, template: tplId, music: arg('music') || undefined, instruction, ...script, _ai: { model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens, dropped } };
  const file = path.join(ROOT, 'storyboards', `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`대본 ${file} · 장면 ${out.scenes.length} · 토큰 ${r.input_tokens}+${r.output_tokens}${dropped.length ? ' · 버림: ' + dropped.join(' / ') : ''}`);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
