// 참고 영상 → 편집 규칙 템플릿.
//   기계로 재는 것: 컷(장면 전환 감지) 길이·분포·구간별 속도 · 음악 BPM·박과 컷의 일치율 · 밝기·채도·대비.
//   눈으로 봐야 하는 것(AI 이미지 인식): 자막 위치·크기·굵기·등장 방식·강조 색 · 카메라 확대/이동 · 전환 종류 · 분위기.
//   참고 영상의 스타일만 가져온다 — 장면·음악·글은 쓰지 않는다(분석이 끝나면 원본은 지워도 된다).
// 실행: node analyze/template-from-video.js <영상> --id=ref-shorts-1 --name="빠른 쇼츠 (참고: ○○)" [--base=fast-shorts] [--no-ai]
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const fs = require('fs');
const path = require('path');
const { ff, ffLog, probe } = require('../lib/ffmpeg');
const { analyzeAudio } = require('../lib/beats');

const ROOT = path.join(__dirname, '..');
const arg = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const r2 = (x) => Math.round(x * 100) / 100;
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

function cuts(file, dur) {
  const log = ffLog(['-i', file, '-an', '-vf', 'scale=320:-2,scdet=threshold=8', '-f', 'null', '-']);
  const ts = [...log.matchAll(/lavfi\.scd\.time:\s*([\d.]+)/g)].map((m) => +m[1]);
  const out = []; for (const t of ts) if (!out.length || t - out[out.length - 1] > 0.4) out.push(t); // 전환(페이드)이 여러 프레임에 걸쳐 잡히는 것 합침
  const bounds = [0, ...out, dur];
  const shots = bounds.slice(1).map((b, i) => b - bounds[i]).filter((x) => x > 0.05);
  // 5초 창마다 컷 수 — «처음 빠르고 중간 느리고 끝 빠름» 같은 속도 흐름
  const curve = []; for (let w = 0; w < dur; w += 5) curve.push(out.filter((t) => t >= w && t < w + 5).length);
  return { times: out.map(r2), shots, curve };
}

function look(file) {
  const log = ffLog(['-i', file, '-an', '-vf', 'fps=2,scale=320:-2,signalstats,metadata=print', '-f', 'null', '-']);
  const get = (k) => [...log.matchAll(new RegExp(`lavfi\\.signalstats\\.${k}=([\\d.]+)`, 'g'))].map((m) => +m[1]);
  const Y = get('YAVG'), S = get('SATAVG'), lo = get('YLOW'), hi = get('YHIGH');
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return { brightness: r2(avg(Y) / 255), saturation: r2(avg(S) / 128), contrast: r2((avg(hi) - avg(lo)) / 255) };
}

function contactSheet(file, cutTimes, dur, out) {
  // 고르게 6장 + 컷 앞뒤 3쌍(전환 모양 보기) = 12칸
  const even = Array.from({ length: 6 }, (_, i) => r2((dur * (i + 0.5)) / 6));
  const pairs = cutTimes.filter((t) => t > 0.5 && t < dur - 0.5).slice(1, 4).flatMap((t) => [r2(t - 0.12), r2(t + 0.15)]);
  const times = [...even, ...pairs].slice(0, 12);
  const tmp = path.join(path.dirname(out), 'f'); fs.mkdirSync(tmp, { recursive: true });
  times.forEach((t, i) => ff(['-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', path.join(tmp, `${String(i).padStart(2, '0')}.jpg`)]));
  ff(['-framerate', '1', '-i', path.join(tmp, '%02d.jpg'), '-vf', 'scale=480:-2,pad=ceil(iw/2)*2:ceil(ih/2)*2,tile=4x3:padding=6:color=white', '-frames:v', '1', out]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return times;
}

async function vision(sheet, times, meta) {
  const { callLLM } = require('/opt/planq/dev-backend/services/llm');
  const img = fs.readFileSync(sheet).toString('base64');
  const sys = [
    '너는 영상 편집 분석가다. 참고 영상의 스틸 12칸(왼쪽 위부터 →, 시각은 아래 목록)을 보고 «편집 스타일» 만 읽는다. 내용·브랜드는 무시.',
    '앞 6칸은 영상 전체에서 고르게, 뒤 칸은 컷 직전·직후 쌍이다(전환 모양 판단용).',
    'JSON 하나로 답한다:',
    '{"caption":{"present":bool,"position":"top|center|bottom|lower-third","sizeRatio":화면 높이 대비 글자 높이(0~0.2),"weight":"light|regular|bold|black","box":"none|solid|highlight-word|outline","emphasis":"color|box|underline|none","emphasisColor":"#hex 또는 null","wordsPerLine":숫자,"animation":"pop|fade|typewriter|slide|static|unknown"},',
    ' "style":"pop|lower|cinema" (pop=큰 굵은 단어 튀는 쇼츠, lower=하단 판·차분, cinema=가운데 크고 얇은 감성),',
    ' "camera":{"zoomIns":"none|some|frequent","panning":"none|some|frequent","screenRecording":bool,"deviceFrames":"none|browser|phone|both"},',
    ' "transitions":["cut","fade","slide","zoom","wipe","whip"] 중 보이는 것,',
    ' "background":"footage|solid|gradient|mixed","mood":"한 줄","notes":"재현에 중요한 특징 2~3개"}',
  ].join('\n');
  const r = await callLLM({ purpose: 'generic', model: 'gpt-5.1', maxTokens: 900, timeoutMs: 90000, json: true, fallback: '',
    messages: [{ role: 'system', content: sys }, { role: 'user', content: [
      { type: 'text', text: `칸별 시각(초): ${times.join(', ')} · 영상 ${meta.width}×${meta.height} · ${r2(meta.duration)}초` },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}`, detail: 'high' } },
    ] }] });
  return r.content ? JSON.parse(r.content) : null;
}

function toTemplate(base, m, v, id, name, refs) {
  const t = JSON.parse(JSON.stringify(base));
  t.id = id; t.name = name;
  const med = m.cuts.median;
  // 속도: 컷 중간 길이 0.8초 → 1.7배, 3초 이상 → 1.0
  t.pace = r2(Math.min(1.8, Math.max(1, 1 + (3 - Math.min(3, med)) * 0.32)));
  t.transitionSec = r2(med < 1.2 ? 0.22 : med < 2.5 ? 0.4 : 0.65);
  t.beatSync = m.audio && m.audio.cutOnBeat >= 0.45 ? (m.cuts.median > m.audio.beatSec * 3 ? 'downbeat' : 'beat') : 'none';
  t.camera.easeSec = r2(Math.max(0.4, Math.min(1.5, med * 0.35)));
  t.grade = { saturate: r2(Math.max(0.9, Math.min(1.25, 0.6 + m.look.saturation))), contrast: r2(Math.max(0.95, Math.min(1.12, 0.8 + m.look.contrast * 0.3))), brightness: 1 };
  if (v) {
    if (['pop', 'lower', 'cinema'].includes(v.style)) t.caption = v.style;
    const sr = v.caption && v.caption.sizeRatio;
    if (sr > 0) t.captionScale = r2(Math.max(0.75, Math.min(1.35, sr / (t.caption === 'lower' ? 0.043 : 0.07))));
    if (v.caption && v.caption.animation === 'typewriter') t.wordStagger = 0.05;
    const tr = (v.transitions || []).filter((x) => x !== 'cut');
    t.transition = tr.length > 1 ? 'mixed' : tr[0] === 'whip' ? 'slide' : (tr[0] || 'cut');
    if (v.camera) t.camera.maxZoom = v.camera.zoomIns === 'frequent' ? 2.6 : v.camera.zoomIns === 'none' ? 1.5 : 2.1;
    if (v.caption && /^#[0-9a-f]{6}$/i.test(v.caption.emphasisColor || '') && t.caption === 'pop') t.palette.highlight = v.caption.emphasisColor;
  }
  t.source = { kind: 'reference', refs, measured: m, vision: v, notes: v ? v.notes : '' };
  return t;
}

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) throw new Error('참고 영상 파일 경로');
  const id = arg('id', 'ref-' + Date.now());
  const name = arg('name', id);
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', `${arg('base', 'calm-lecture')}.json`), 'utf8'));
  const meta = probe(file);
  const c = cuts(file, meta.duration);
  const m = {
    duration: r2(meta.duration), size: `${meta.width}x${meta.height}`, vertical: meta.height > meta.width,
    cuts: { count: c.times.length, median: r2(pct(c.shots, 0.5)), p25: r2(pct(c.shots, 0.25)), p75: r2(pct(c.shots, 0.75)), perMinute: r2((c.times.length / meta.duration) * 60), curve5s: c.curve },
    look: look(file),
  };
  const loud = meta.hasAudio && /max_volume:\s*(-?[\d.]+)/.exec(ffLog(['-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']));
  if (loud && +loud[1] > -45) { // 무음 트랙이면 박자를 재지 않는다
    const a = analyzeAudio(file);
    const near = c.times.filter((t) => a.beats.some((b) => Math.abs(b - t) <= 0.09)).length;
    m.audio = { bpm: a.bpm, beatSec: r2(60 / a.bpm), cutOnBeat: c.times.length ? r2(near / c.times.length) : 0 };
  }
  const dir = path.join(ROOT, 'out', 'analysis', id); fs.mkdirSync(dir, { recursive: true });
  const sheet = path.join(dir, 'sheet.jpg');
  const times = contactSheet(file, c.times, meta.duration, sheet);
  const v = process.argv.includes('--no-ai') ? null : await vision(sheet, times, meta);
  const tpl = toTemplate(base, m, v, id, name, [path.basename(file)]);
  fs.writeFileSync(path.join(ROOT, 'templates', `${id}.json`), JSON.stringify(tpl, null, 2));
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ measured: m, vision: v, sheetTimes: times }, null, 2));
  console.log(JSON.stringify({ id, measured: m, style: v && v.style, mood: v && v.mood }, null, 1));
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
