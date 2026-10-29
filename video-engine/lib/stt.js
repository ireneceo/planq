// 음성 인식 — Deepgram 사전녹음(nova-3 · ko · 단어 시각). routes/voice.js 와 같은 호출·같은 키(DEEPGRAM_API_KEY).
//   결과는 녹음 파일 옆 <파일>.stt.json 에 남긴다 — 같은 녹음을 두 번 과금하지 않는다(설계 §6 ①-3, stt_seconds 기록은 호출부).
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const fs = require('fs');
const { ff, probe } = require('./ffmpeg');

const MODEL = process.env.VIDEO_STT_MODEL || 'nova-3';

// 인식용 소리: 16kHz 모노 wav(작고 빠르다). 단어 시각은 원본과 같은 축(앞 자르기 없음).
function toWav(src) {
  const out = src.replace(/\.[^.]+$/, '') + '.stt.wav';
  if (!fs.existsSync(out)) ff(['-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out]);
  return out;
}

async function transcribe(src, { keyterms = [] } = {}) {
  const cache = src + '.stt.json';
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw Object.assign(new Error('DEEPGRAM_API_KEY 없음'), { code: 'stt_failed' });
  const wav = toWav(src);
  const params = new URLSearchParams({ model: MODEL, language: process.env.VIDEO_STT_LANG || 'ko', smart_format: 'true', punctuate: 'true', utterances: 'true', filler_words: 'true' });
  for (const k of keyterms.slice(0, 50)) if (k && k.length <= 60) params.append('keyterm', k);
  const r = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
    body: fs.readFileSync(wav), signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!r.ok) throw Object.assign(new Error(`Deepgram ${r.status}: ${(await r.text()).slice(0, 200)}`), { code: 'stt_failed' });
  const j = await r.json();
  const alt = j?.results?.channels?.[0]?.alternatives?.[0] || {};
  const words = (alt.words || []).map((w) => ({ w: w.punctuated_word || w.word, raw: w.word, start: +w.start.toFixed(3), end: +w.end.toFixed(3), conf: +(w.confidence || 0).toFixed(3) }));
  const out = { model: MODEL, seconds: +probe(wav).duration.toFixed(2), transcript: alt.transcript || '', words, at: new Date().toISOString() };
  fs.writeFileSync(cache, JSON.stringify(out, null, 1));
  return out;
}

module.exports = { transcribe };
