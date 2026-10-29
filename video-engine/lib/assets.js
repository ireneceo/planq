// 올린 소재(사진·로고·영상) 인식 — 설계 §7.
//   사진: AI 이미지 인식으로 설명·태그·주된 피사체 위치 → 확대·이동 효과가 피사체 쪽으로.
//   영상: 키프레임 격자를 AI 로 보고, ffmpeg 로 «어두움»(밝기)·«흔들림»(연속 프레임 차이) 을 1초 단위로 재서 쓸 수 있는 구간만 남긴다.
//   결과는 소재 옆 <파일>.analysis.json(다시 묻지 않는다). 녹화(capture) 검수는 DOM 판정이라 여기 오지 않는다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const fs = require('fs');
const path = require('path');
const { ff, ffLog, probe } = require('./ffmpeg');

const DARK = 0.16;   // 평균 밝기(0~1) 이보다 낮으면 어두움
const SHAKE = 0.05;  // 연속 프레임 차이(1초 가운데값, 0~1) 이보다 크면 흔들림·급한 움직임 — 흰 UI 화면 흔들림 실측 0.081, 정지 0
const MIN_SEG = 1.5;

async function vision(jpegBuf, ask) {
  const { callLLM } = require('/opt/planq/dev-backend/services/llm');
  const r = await callLLM({ purpose: 'generic', model: 'gpt-5.1', maxTokens: 900, timeoutMs: 90000, json: true, fallback: '',
    messages: [{ role: 'system', content: ask }, { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBuf.toString('base64')}`, detail: 'low' } }] }] });
  return r.content ? JSON.parse(r.content) : null;
}

const IMAGE_ASK = '마케팅 영상 소재 사진이다. JSON 하나로: {"description":"한국어 한 문장","tags":["3~6개"],"kind":"photo|logo|screenshot|illustration","subject":{"x":0~1,"y":0~1,"w":0~1,"h":0~1}(주된 피사체 상자, 이미지 비율 기준),"text_in_image":"보이는 글자(없으면 빈 문자열)","usable":true|false,"issue":"쓰기 어려운 이유(흐림·저화질·개인정보 등, 없으면 빈 문자열)"}';
const VIDEO_ASK = '마케팅 영상 소재 영상의 키프레임 격자(왼쪽 위부터 시간순, 2초 간격)다. JSON 하나로: {"description":"한국어 한두 문장","tags":["3~6개"],"frames":[{"i":칸 번호,"what":"짧게","good":true|false}],"mood":"한 줄"}';

async function analyzeImage(file) {
  const out = file + '.analysis.json';
  if (fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, 'utf8'));
  const p = probe(file);
  const jpg = ff(['-i', file, '-vf', 'scale=768:-2', '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1']);
  const v = await vision(jpg, IMAGE_ASK);
  const res = { type: 'image', width: p.width, height: p.height, ...(v || { description: '', tags: [], usable: true }), at: new Date().toISOString() };
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  return res;
}

// 1초 단위 밝기·움직임 → 쓸 수 있는 구간
function measureVideo(file, dur) {
  const bright = [...ffLog(['-i', file, '-an', '-vf', 'fps=4,scale=160:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-']).matchAll(/YAVG=([\d.]+)/g)].map((m) => +m[1] / 255);
  const diff = [...ffLog(['-i', file, '-an', '-vf', 'fps=4,scale=160:-2,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-']).matchAll(/YAVG=([\d.]+)/g)].map((m) => +m[1] / 255);
  const secs = Math.floor(dur);
  const perSec = [];
  for (let s = 0; s < secs; s++) {
    const b = bright.slice(s * 4, s * 4 + 4), d = diff.slice(s * 4, s * 4 + 4).sort((x, y) => x - y);
    const avgB = b.length ? b.reduce((x, y) => x + y, 0) / b.length : 0;
    const medD = d.length ? d[Math.floor(d.length / 2)] : 0; // 가운데값 — 장면 전환 한 번은 흔들림으로 안 친다
    perSec.push({ s, dark: avgB < DARK, shaky: medD > SHAKE, b: +avgB.toFixed(3), m: +medD.toFixed(3) });
  }
  const usable = []; let cur = null;
  for (const x of perSec) {
    const ok = !x.dark && !x.shaky;
    if (ok && !cur) cur = { a: x.s, b: x.s + 1 };
    else if (ok) cur.b = x.s + 1;
    else if (cur) { if (cur.b - cur.a >= MIN_SEG) usable.push(cur); cur = null; }
  }
  if (cur && cur.b - cur.a >= MIN_SEG) usable.push(cur);
  return { perSec, usable };
}

async function analyzeVideo(file) {
  const out = file + '.analysis.json';
  if (fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, 'utf8'));
  const p = probe(file);
  const m = measureVideo(file, p.duration);
  const n = Math.min(12, Math.max(1, Math.floor(p.duration / 2)));
  const sheet = ff(['-i', file, '-vf', `fps=1/2,scale=256:-2,tile=4x${Math.ceil(n / 4)}`, '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1']);
  const v = await vision(sheet, VIDEO_ASK);
  const res = { type: 'video', seconds: +p.duration.toFixed(2), width: p.width, height: p.height, hasAudio: p.hasAudio, ...(v || {}), usable: m.usable, perSec: m.perSec, at: new Date().toISOString() };
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  return res;
}

async function analyze(file) {
  const ext = path.extname(file).toLowerCase();
  return ['.mp4', '.mov', '.webm', '.m4v'].includes(ext) ? analyzeVideo(file) : analyzeImage(file);
}

if (require.main === module) {
  analyze(process.argv[2]).then((r) => console.log(JSON.stringify({ ...r, perSec: r.perSec ? `${r.perSec.length}초` : undefined }, null, 1))).catch((e) => { console.error(e.message); process.exit(1); });
}
module.exports = { analyze, analyzeImage, analyzeVideo, measureVideo };
