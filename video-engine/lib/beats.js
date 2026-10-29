// 박자 분석 — 음악/참고 영상 오디오의 BPM · 박 위치 · 강박(마디 첫 박) · 에너지 곡선.
//   방식: 스펙트럼 플럭스(onset 세기) → 자기상관으로 템포 → 박 간격 격자의 위상 맞춤 → 4박 묶음의 강박.
//   외부 라이브러리 없이 계산한다(서버에 파이썬 오디오 패키지가 없다).
const { pcm } = require('./ffmpeg');

const RATE = 22050, HOP = 512, WIN = 1024;

function fftMag(frame) {
  // 길이 WIN 실수 FFT(radix-2) → 크기 스펙트럼 절반
  const n = frame.length, re = Float64Array.from(frame), im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const mag = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) mag[k] = Math.log1p(Math.hypot(re[k], im[k]));
  return mag;
}

function onsetEnvelope(samples) {
  const hann = Float64Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WIN));
  const frames = Math.max(0, Math.floor((samples.length - WIN) / HOP));
  const env = new Float64Array(frames), rms = new Float64Array(frames);
  let prev = null;
  for (let f = 0; f < frames; f++) {
    const fr = new Float64Array(WIN); let e = 0;
    for (let i = 0; i < WIN; i++) { const s = samples[f * HOP + i]; fr[i] = s * hann[i]; e += s * s; }
    rms[f] = Math.sqrt(e / WIN);
    const mag = fftMag(fr);
    if (prev) { let flux = 0; for (let k = 1; k < mag.length; k++) { const d = mag[k] - prev[k]; if (d > 0) flux += d; } env[f] = flux; }
    prev = mag;
  }
  // 국소 평균을 빼 지속음을 걷어낸다
  const out = new Float64Array(frames), W = 8;
  for (let f = 0; f < frames; f++) {
    let s = 0, c = 0; for (let k = Math.max(0, f - W); k <= Math.min(frames - 1, f + W); k++) { s += env[k]; c++; }
    out[f] = Math.max(0, env[f] - s / c);
  }
  return { env: out, rms, fps: RATE / HOP };
}

function tempo(env, fps, lo = 70, hi = 180) {
  const minLag = Math.round(fps * 60 / hi), maxLag = Math.round(fps * 60 / lo);
  let best = 0, bestLag = minLag; const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0; for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    // 사람 귀가 편한 120 근처를 약간 우대(배수 혼동 방지)
    const bpm = fps * 60 / lag; const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    s *= w; scores.push(s); if (s > best) { best = s; bestLag = lag; }
  }
  return { bpm: fps * 60 / bestLag, lag: bestLag };
}

function analyzeAudio(file) {
  const samples = pcm(file, RATE);
  const duration = samples.length / RATE;
  const { env, rms, fps } = onsetEnvelope(samples);
  const { bpm, lag } = tempo(env, fps);
  // 위상: 박 격자에 놓인 onset 합이 최대인 시작점
  let bestPh = 0, bestS = -1;
  for (let ph = 0; ph < lag; ph++) { let s = 0; for (let i = ph; i < env.length; i += lag) s += env[i]; if (s > bestS) { bestS = s; bestPh = ph; } }
  // 박 위치를 ±2프레임 안의 실제 onset 최대점으로 살짝 당긴다
  const beats = [];
  for (let i = bestPh; i < env.length; i += lag) {
    let m = i; for (let k = Math.max(0, i - 2); k <= Math.min(env.length - 1, i + 2); k++) if (env[k] > env[m]) m = k;
    beats.push(+(m / fps).toFixed(3));
  }
  // 강박: 4박 묶음 중 onset 합이 가장 큰 위상
  let down = 0, dS = -1;
  for (let p = 0; p < 4; p++) { let s = 0; for (let i = p; i < beats.length; i += 4) s += env[Math.round(beats[i] * fps)] || 0; if (s > dS) { dS = s; down = p; } }
  const downbeats = beats.filter((_, i) => (i - down) % 4 === 0);
  // 1초 단위 에너지(0~1) — 음악 구간 고르기(조용한 도입 vs 터지는 부분)
  const perSec = []; const fpsI = Math.round(fps);
  for (let s = 0; s * fpsI < rms.length; s++) { let a = 0, c = 0; for (let i = s * fpsI; i < Math.min(rms.length, (s + 1) * fpsI); i++) { a += rms[i]; c++; } perSec.push(a / c); }
  const mx = Math.max(...perSec) || 1;
  return { duration: +duration.toFixed(3), bpm: +bpm.toFixed(1), beats, downbeats, energy: perSec.map((v) => +(v / mx).toFixed(3)) };
}

module.exports = { analyzeAudio, onsetEnvelope, tempo };
