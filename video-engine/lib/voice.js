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
  // 1-2) 쉬고 다시 말한 문장(재테이크) — 앞 시도를 버리고 뒤 것을 남긴다
  const kept2 = dropRetakes(kept);
  // 2) 단어를 이어 구간으로 — 틈이 GAP 보다 길면 끊는다
  const spans = [];
  for (const w of kept2) {
    const a = Math.max(0, w.start - PAD), b = Math.min(total, w.end + PAD);
    const last = spans[spans.length - 1];
    if (last && a - last.b <= GAP) last.b = Math.max(last.b, b);
    else spans.push({ a, b });
  }
  // 3) 끊긴 자리엔 짧은 숨을 남긴다(앞 구간 끝에 붙임)
  spans.forEach((s, i) => { if (i < spans.length - 1) s.b = Math.min(spans[i + 1].a, s.b + KEEP_GAP); });
  return { spans: spans.map((s) => ({ a: +s.a.toFixed(3), b: +s.b.toFixed(3) })), kept: kept2, retakes: kept.length - kept2.length };
}

// 재테이크 찾기 — 말이 쉼(RETAKE_GAP)으로 끊긴 토막끼리 비교한다.
//   뒤 토막이 앞 토막과 같은 두 단어로 시작하거나(«업무를 만들면 담당자가… / 업무를 만들면 담당자에게»)
//   앞 토막 전체가 뒤 토막의 시작과 같으면(«그래서… / 그래서 이 기능은») 앞 것은 실수한 시도다.
//   앞 토막이 문장부호로 끝난 완결 문장이면 같은 말로 시작해도 나란한 문장(«이 버튼을 누르면 …. 이 버튼을 누르면 …»)이라 남긴다.
//   녹화 요령: 말이 꼬이면 한 템포 쉬고 문장 처음부터 다시.
const RETAKE_GAP = 0.35;
function dropRetakes(words) {
  const chunks = [];
  for (const w of words) {
    const cur = chunks[chunks.length - 1];
    if (cur && w.start - cur[cur.length - 1].end <= RETAKE_GAP && !/[.?!]$/.test(cur[cur.length - 1].w)) cur.push(w);
    else chunks.push([w]);
  }
  const key = (c) => c.map((w) => norm(w.raw || w.w));
  const out = [];
  for (const c of chunks) {
    // 같은 문장을 여러 번 다시 말했으면 앞 시도를 모두 버린다
    while (out.length) {
      const p = key(out[out.length - 1]), q = key(c);
      let n = 0; while (n < p.length && n < q.length && p[n] === q[n]) n++;
      const whole = n === p.length && p.length <= q.length;
      const finished = /[.?!]$/.test(out[out.length - 1][p.length - 1] && out[out.length - 1][p.length - 1].w);
      if ((whole && (!finished || p.length === q.length)) || (n >= 2 && !finished)) out.pop(); else break; // 똑같은 문장을 통째로 다시 말한 것도 재테이크
    }
    out.push(c);
  }
  return out.flat();
}

// 자막 나누기 — 넷플릭스 한국어 자막 지침의 틀: 한 줄 16자 · 두 줄까지 · 한 자막 7초 이하 · 0.83초(5/6초) 이상.
//   단어 경계에서만 끊고, 줄 끝 마침표·쉼표는 뺀다(물음표·느낌표는 남김). 단어 시각은 그대로 따라간다.
const CAP_LINE = 16, CAP_LINES = 2, CAP_MAX = 7, CAP_MIN = 5 / 6;
const len = (ws) => ws.reduce((n, w) => n + w.w.length, 0) + Math.max(0, ws.length - 1);
const trimEnd = (w) => w.replace(/[.,]+$/, '');
function captionChunks(words) {
  const caps = []; let cur = [];
  for (const w of words) {
    const next = [...cur, w];
    const tooLong = len(next) > CAP_LINE * CAP_LINES || (cur.length && w.e - cur[0].t > CAP_MAX);
    if (cur.length && tooLong) { caps.push(cur); cur = [w]; } else cur = next;
    if (/[,]$/.test(w.w) && len(cur) > CAP_LINE) { caps.push(cur); cur = []; } // 쉼표에서 두 줄을 채웠으면 끊는다
  }
  if (cur.length) caps.push(cur);
  // 너무 짧은 자막은 이웃과 합친다(합쳐도 두 줄 안이면)
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i], d = c[c.length - 1].e - c[0].t;
    if (d >= CAP_MIN || caps.length < 2) continue;
    const j = i + 1 < caps.length ? i + 1 : i - 1;
    const merged = j > i ? [...c, ...caps[j]] : [...caps[j], ...c];
    if (len(merged) <= CAP_LINE * CAP_LINES) { caps.splice(Math.min(i, j), 2, merged); i--; }
  }
  return caps.map((c) => {
    // 두 줄로 나눌 자리 — 앞 줄이 16자를 넘지 않는 가장 균형 잡힌 단어 경계
    let br = -1;
    if (len(c) > CAP_LINE) {
      let best = Infinity;
      for (let k = 1; k < c.length; k++) {
        const a = len(c.slice(0, k)), b = len(c.slice(k));
        const over = Math.max(0, a - CAP_LINE) + Math.max(0, b - CAP_LINE);
        const score = over * 100 + Math.abs(a - b);
        if (score < best) { best = score; br = k; }
      }
    }
    const ws = c.map((w, i) => (i === br - 1 || i === c.length - 1 ? trimEnd(w.w) : w.w) || w.w);
    const text = br > 0 ? ws.slice(0, br).join(' ') + '\n' + ws.slice(br).join(' ') : ws.join(' ');
    return { text, t0: c[0].t, t1: c[c.length - 1].e, words: c };
  });
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
  const { spans, kept, retakes } = keepSpans(stt.words, total);
  const { map, total: editTotal } = mapper(spans);
  const sents = sentences(kept, map);
  const files = applyCuts({ src, spans, outDir, face });
  const removed = total - editTotal;
  const report = { original: +total.toFixed(2), edited: +editTotal.toFixed(2), removed: +removed.toFixed(2), fillers: stt.words.length - kept.length - retakes, retakes, spans: spans.length, processed: +files.seconds.toFixed(2) };
  fs.writeFileSync(path.join(outDir, 'voice.json'), JSON.stringify({ report, spans, sentences: sents }, null, 1));
  return { ...files, spans, sentences: sents, report };
}

module.exports = { prepare, keepSpans, dropRetakes, captionChunks, mapper, sentences, FILLERS };
