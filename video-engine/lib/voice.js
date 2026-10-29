// 녹음 기반(①) 소리 다듬기 — 잡음 줄이기·음량 맞추기 · 침묵/«음·어»/되풀이 자르기 · 문장 나누기.
//   자르기는 소리와 얼굴 영상에 **같은 시각으로** 적용한다(얼굴 원이 입 모양과 맞게 — 요구사항 1-①).
//   원본은 그대로 두고 처리본을 만든다. 출력 시각 축 = 자르고 난 뒤(«편집 축»).
const fs = require('fs');
const path = require('path');
const { ff, probe } = require('./ffmpeg');

const FILLERS = new Set(['음', '어', '으', '엄', '음.', '어.', '그', '저', '저기', '뭐', '아', 'um', 'uh', 'mm', 'hmm']);
const GAP = 0.6;    // 이보다 긴 침묵은 줄인다
const KEEP_GAP = 0.18; // 줄인 침묵 자리에 남길 숨(말이 붙어 들리지 않게)
const PAD = 0.06;   // 단어 앞뒤 여유(자음이 잘리지 않게)

const norm = (s) => String(s || '').replace(/[.,!?…~"'”“]/g, '').trim().toLowerCase();

// 남길 구간 목록(원본 축) — [{a, b}]
function keepSpans(words, total) {
  // 1) 채움말 단독 단어 · 바로 앞 단어 되풀이(«이 이 기능») 버림
  const kept = [];
  for (const w of words) {
    const n = norm(w.raw || w.w);
    if (FILLERS.has(n)) continue;
    const prev = kept[kept.length - 1];
    if (prev && norm(prev.raw || prev.w) === n && w.start - prev.end < 0.5) { kept[kept.length - 1] = w; continue; } // 되풀이는 뒤 것(다시 말한 것)을 남긴다
    kept.push(w);
  }
  // 2) 단어를 이어 구간으로 — 틈이 GAP 보다 길면 끊는다
  const spans = [];
  for (const w of kept) {
    const a = Math.max(0, w.start - PAD), b = Math.min(total, w.end + PAD);
    const last = spans[spans.length - 1];
    if (last && a - last.b <= GAP) last.b = Math.max(last.b, b);
    else spans.push({ a, b });
  }
  // 3) 끊긴 자리엔 짧은 숨을 남긴다(앞 구간 끝에 붙임)
  spans.forEach((s, i) => { if (i < spans.length - 1) s.b = Math.min(spans[i + 1].a, s.b + KEEP_GAP); });
  return { spans: spans.map((s) => ({ a: +s.a.toFixed(3), b: +s.b.toFixed(3) })), kept };
}

// 원본 시각 → 편집 축 시각
function mapper(spans) {
  const acc = []; let t = 0;
  for (const s of spans) { acc.push({ ...s, at: t }); t += s.b - s.a; }
  const map = (x) => {
    for (const s of acc) { if (x < s.a) return s.at; if (x <= s.b) return s.at + (x - s.a); }
    return t;
  };
  return { map, total: t, acc };
}

// 문장 나누기 — 문장부호 또는 0.45초 넘는 쉼에서
function sentences(kept, map) {
  const out = []; let cur = [];
  const flush = () => { if (!cur.length) return; out.push({ text: cur.map((w) => w.w).join(' '), t0: +map(cur[0].start).toFixed(3), t1: +map(cur[cur.length - 1].end).toFixed(3), words: cur.map((w) => ({ w: w.w, t: +map(w.start).toFixed(3), e: +map(w.end).toFixed(3) })) }); cur = []; };
  kept.forEach((w, i) => {
    cur.push(w);
    const next = kept[i + 1];
    if (/[.?!]$/.test(w.w) || (next && next.start - w.end > 0.45) || cur.length >= 14) flush();
  });
  flush();
  return out;
}

// 처리본 만들기: 소리(잡음 줄이기 → 자르기 → -16 LUFS) · 얼굴 영상(같은 자르기, 소리 빼고)
function applyCuts({ src, spans, outDir, face = false }) {
  fs.mkdirSync(outDir, { recursive: true });
  const sel = spans.map((s) => `between(t,${s.a},${s.b})`).join('+');
  const audioOut = path.join(outDir, 'voice.m4a');
  ff(['-i', src, '-vn', '-af', `afftdn=nf=-25,aselect='${sel}',asetpts=N/SR/TB,loudnorm=I=-16:TP=-1.5:LRA=11`, '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', audioOut]);
  let faceOut = null;
  if (face) {
    faceOut = path.join(outDir, 'face.mp4');
    ff(['-i', src, '-an', '-vf', `select='${sel}',setpts=N/FRAME_RATE/TB,fps=30,scale=-2:720`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', faceOut]);
  }
  return { audioOut, faceOut, seconds: probe(audioOut).duration };
}

// 한 번에: 인식 결과 → 남길 구간 → 처리본 → 편집 축 문장
function prepare({ src, stt, outDir, face }) {
  const total = probe(src).duration;
  const { spans, kept } = keepSpans(stt.words, total);
  const { map, total: editTotal } = mapper(spans);
  const sents = sentences(kept, map);
  const files = applyCuts({ src, spans, outDir, face });
  const removed = total - editTotal;
  const report = { original: +total.toFixed(2), edited: +editTotal.toFixed(2), removed: +removed.toFixed(2), fillers: stt.words.length - kept.length, spans: spans.length, processed: +files.seconds.toFixed(2) };
  fs.writeFileSync(path.join(outDir, 'voice.json'), JSON.stringify({ report, spans, sentences: sents }, null, 1));
  return { ...files, spans, sentences: sents, report };
}

module.exports = { prepare, keepSpans, mapper, sentences, FILLERS };
