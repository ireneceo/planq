// ffmpeg 도우미 — 분석·전처리용 전체판(ffmpeg-static 6.0). Remotion 렌더는 자체 ffmpeg 를 쓴다.
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');

const FFMPEG = process.env.FFMPEG || path.join(__dirname, '..', 'node_modules', 'ffmpeg-static', 'ffmpeg');
const FFPROBE = process.env.FFPROBE || require('ffprobe-static').path;

function ff(args, opts = {}) {
  return execFileSync(FFMPEG, ['-hide_banner', '-y', '-loglevel', opts.loglevel || 'error', ...args], { maxBuffer: 1 << 30, ...opts });
}
// stderr 를 돌려준다(필터 로그 — scdet·ebur128·silencedetect 결과가 여기로 나온다)
function ffLog(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', ...args], { maxBuffer: 1 << 30 });
  return String(r.stderr || '');
}
function probe(file) {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(String(out));
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const fr = v && v.avg_frame_rate ? v.avg_frame_rate.split('/').map(Number) : null;
  return {
    duration: +j.format.duration,
    width: v ? v.width : 0, height: v ? v.height : 0,
    fps: fr && fr[1] ? fr[0] / fr[1] : 0,
    hasAudio: !!a,
  };
}
// 모노 PCM(float32) — 박자·음량 분석용
function pcm(file, rate = 22050) {
  const buf = ff(['-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1']);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}
module.exports = { FFMPEG, FFPROBE, ff, ffLog, probe, pcm };
