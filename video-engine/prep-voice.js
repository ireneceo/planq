// 녹음 기반(①) 준비 — 녹음/얼굴 영상 → 음성 인식(Deepgram) → 침묵·«음/어» 자르기 · 잡음·음량 → 문장.
// 실행: node prep-voice.js <파일> --id=<이름> [--face]   → data/voice/<id>/{voice.m4a, face.mp4, voice.json}
const fs = require('fs');
const path = require('path');
const { transcribe } = require('./lib/stt');
const { prepare } = require('./lib/voice');
const { probe } = require('./lib/ffmpeg');

async function prepVoice({ file, id, face }) {
  const dir = path.join(__dirname, 'data', 'voice', id);
  fs.mkdirSync(dir, { recursive: true });
  const p = probe(file);
  const useFace = face && p.width > 0;
  const stt = await transcribe(file, { keyterms: ['PlanQ', '플랜큐', 'Q talk', 'Q task', 'Q note', 'Q bill', 'Cue'] });
  const r = prepare({ src: file, stt, outDir: dir, face: useFace });
  return { dir, sttSeconds: stt.seconds, ...r };
}

if (require.main === module) {
  const file = process.argv[2];
  const id = (process.argv.find((a) => a.startsWith('--id=')) || '').slice(5);
  if (!file || !id) { console.error('사용: node prep-voice.js <파일> --id=<이름> [--face]'); process.exit(1); }
  prepVoice({ file, id, face: process.argv.includes('--face') }).then((r) => {
    console.log(`녹음 준비 ${r.dir} · 인식 ${r.sttSeconds}s · 원본 ${r.report.original}s → ${r.report.edited}s (잘라낸 ${r.report.removed}s · 채움말 ${r.report.fillers} · 구간 ${r.report.spans}) · 문장 ${r.sentences.length}${r.faceOut ? ' · 얼굴 영상' : ''}`);
    r.sentences.forEach((s, i) => console.log(`  [${i}] ${s.t0.toFixed(1)}–${s.t1.toFixed(1)} ${s.text}`));
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
module.exports = { prepVoice };
