// 대본(script) → 장면 목록(storyboard) 변환기.
//   대본 = 사람이(또는 AI 가) 쓰고 플랫폼 관리자가 확인·수정하는 것: 장면 순서·자막·템플릿·음악.
//   장면 목록 = Remotion 이 그대로 그리는 것: 출력 시각 기준 카메라 키·커서 경로·자막 시각·효과음·음악 박자.
//   같은 대본 → 같은 장면 목록(결정적). 수정 요청은 대본을 고치고 다시 이 변환을 돌린다.
const fs = require('fs');
const path = require('path');
const { analyzeAudio } = require('../lib/beats');
const { ff } = require('../lib/ffmpeg');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'out', 'shots');
const FPS = 30;

const loadJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const r3 = (x) => Math.round(x * 1000) / 1000;

function template(id) { return loadJSON(path.join(ROOT, 'templates', `${id}.json`)); }
function music(id) {
  const cat = loadJSON(path.join(ROOT, 'assets', 'music', 'catalog.json'));
  const m = cat.find((x) => x.id === id);
  if (!m) throw new Error('음악 없음: ' + id);
  const file = path.join(ROOT, 'assets', 'music', m.file);
  const cache = file + '.beats.json';
  let a;
  if (fs.existsSync(cache) && fs.statSync(cache).mtimeMs > fs.statSync(file).mtimeMs) a = loadJSON(cache);
  else { a = analyzeAudio(file); fs.writeFileSync(cache, JSON.stringify(a)); }
  return { ...m, file, analysis: a };
}

// ── 화면 장면: 원본 시각 → 출력 시각 ──
function buildScreen(spec, tpl, aspectHints) {
  const shot = loadJSON(path.join(SHOTS, spec.shot, 'shot.json'));
  const vp = shot.viewport;
  // fromBeat: 그 자막 자리부터(쇼츠 콜드 오픈 — 가장 센 장면을 0초에) · maxSec: 원본 몇 초까지만
  let t0 = spec.trimStart || 0;
  if (spec.fromBeat) { const b = shot.events.find((e) => e.type === 'beat' && e.key === spec.fromBeat); if (!b) throw new Error(`${spec.shot}: fromBeat ${spec.fromBeat} 없음`); t0 = Math.max(0, b.t - 0.25); }
  let t1 = Math.min(shot.duration, spec.trimEnd ? shot.duration - spec.trimEnd : shot.duration);
  if (spec.maxSec) t1 = Math.min(t1, t0 + spec.maxSec);
  const evs = shot.events.filter((e) => e.t >= t0 - 0.01 && e.t <= t1);

  // 1) 배속 구간: 기다림 = waitSpeed, 사건 없는 긴 정지 = pace
  const marks = []; // [a, b, rate]
  for (const e of evs) if (e.type === 'wait') marks.push([e.t + 0.15, Math.min(t1, e.t + e.dur - 0.1), tpl.waitSpeed]);
  if (tpl.pace > 1.01) {
    const busy = evs.filter((e) => e.type !== 'wait').flatMap((e) => [[e.t - 0.3, e.t + (e.dur || 0) + 0.6]]);
    busy.push(...marks.map(([a, b]) => [a, b]));
    busy.sort((a, b) => a[0] - b[0]);
    let cur = t0;
    for (const [a, b] of busy) { if (a - cur > 0.9) marks.push([cur + 0.3, a, tpl.pace]); cur = Math.max(cur, b); }
    if (t1 - cur > 0.9) marks.push([cur + 0.3, t1, tpl.pace]);
  }
  marks.sort((a, b) => a[0] - b[0]);
  const segs = []; let src = t0, at = 0;
  const push = (a, b, rate) => { if (b - a > 0.02) { segs.push({ at: r3(at), src: r3(a), dur: r3((b - a) / rate), rate }); at += (b - a) / rate; } };
  for (const [a, b, rate] of marks) { if (a < src) continue; push(src, a, 1); push(a, b, rate); src = b; }
  push(src, t1, 1);
  const map = (t) => {
    for (const g of segs) { const end = g.src + g.dur * g.rate; if (t <= end + 1e-6) return Math.max(0, g.at + (Math.max(t, g.src) - g.src) / g.rate); }
    return at;
  };
  const dur = at;

  // 2) 카메라 키
  const full = { cx: vp.width / 2, cy: vp.height / 2, vw: vp.width };
  const minVwL = vp.width / tpl.camera.maxZoom;
  const camL = [{ t: 0, ...full }];
  // 세로(데스크탑 녹화): 최소 2.2배 — 폰에서 글자가 읽히게. 카드 비율 ≈ 1:1 이라 대상의 폭·높이 중 큰 쪽이 들어오게(여백 6%)
  const pMax = vp.width / 2.2;
  const pDefault = vp.mobile ? vp.width : pMax;
  const pFit = (r) => Math.min(pMax, Math.max(340, Math.max(r.w, r.h) / Math.min(0.88, tpl.camera.portraitFill)));
  const camP = [{ t: 0, cx: vp.mobile ? vp.width / 2 : vp.width * 0.45, cy: vp.height / 2, vw: pDefault }];
  let lastMove = null;
  for (const e of evs) {
    const t = r3(map(e.t));
    if (e.type === 'focus' && e.zoom !== false) {
      const r = e.rect;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      if (vp.mobile) {
        const z = Math.min(1.45, Math.max(1.12, (vp.width * 0.92) / r.w));
        camL.push({ t, cx, cy, vw: vp.width / z });
        camP.push({ t, cx, cy, vw: vp.width / Math.min(1.35, z) });
      } else {
        const needL = Math.max(r.w / tpl.camera.fill, (r.h / tpl.camera.fill) * (16 / 9));
        camL.push({ t, cx, cy, vw: Math.min(vp.width, Math.max(minVwL, needL)) });
        camP.push({ t, cx, cy, vw: pFit(r) });
      }
    } else if (e.type === 'focus') {
      // 확대 없이 스포트라이트만 — 세로는 그래도 그쪽으로 옮겨 간다
      const r = e.rect;
      if (!vp.mobile) camP.push({ t, cx: r.x + Math.min(r.w, pMax) / 2, cy: r.y + r.h / 2, vw: pFit(r) });
    } else if (e.type === 'unfocus') {
      camL.push({ t, ...full });
      const lp = lastMove ? lastMove.to : { x: vp.width / 2, y: vp.height / 2 };
      camP.push({ t, cx: vp.mobile ? vp.width / 2 : lp.x, cy: vp.mobile ? vp.height / 2 : lp.y, vw: pDefault });
    } else if (e.type === 'move') {
      lastMove = e;
      // 세로(데스크탑)는 커서를 따라간다 — 확대 중이 아닐 때만
      const zoomed = camP[camP.length - 1].vw < pDefault - 1;
      if (!vp.mobile && !zoomed) camP.push({ t, cx: e.to.x, cy: e.to.y, vw: pDefault });
    }
  }
  // 너무 촘촘한 키는 합친다(같은 시각에 둘이면 뒤의 것)
  const tidy = (keys) => keys.filter((k, i) => !(keys[i + 1] && keys[i + 1].t - k.t < 0.05));

  const moves = evs.filter((e) => e.type === 'move').map((e) => ({ t0: r3(map(e.t)), t1: r3(map(e.t + e.dur)), from: e.from, to: e.to }));
  const clicks = evs.filter((e) => e.type === 'click').map((e) => ({ t: r3(map(e.t)), x: e.x, y: e.y }));
  const spots = [];
  evs.forEach((e, i) => {
    if (e.type !== 'focus' || e.spot === false) return;
    const end = evs.slice(i + 1).find((x) => x.type === 'unfocus' || x.type === 'focus');
    // 요소 경계에 딱 붙이면 그래프 끝이 잘린다 — 안쪽 여백 16px 더(Fable A 5번)
    const r = e.rect, P = 16;
    spots.push({ t0: r3(map(e.t) + 0.25), t1: r3(map(end ? end.t : t1) - 0.05), rect: { x: r.x - P, y: r.y - P, w: r.w + P * 2, h: r.h + P * 2 } });
  });
  const waits = segs.filter((g) => g.rate === tpl.waitSpeed).map((g) => ({ t0: g.at, t1: r3(g.at + g.dur), rate: g.rate }));

  // 3) 자막 — beat 키에 붙인다. 다음 자막 시작(또는 장면 끝)까지
  const beatT = {};
  const beatIssues = {};
  for (const e of evs) if (e.type === 'beat' && beatT[e.key] == null) { beatT[e.key] = map(e.t); beatIssues[e.key] = e.issues || null; }
  // 소재 검수 관문(설계 §7): 자막을 다는 beat 에서 화면이 로딩·빈 상태·공지·오류면 멈춘다 — 사람이 «그대로 쓰기»(accept) 하면 통과
  const gate = [];
  // 녹음 기반(say)이면 말이 장면 전체를 덮으므로 모든 beat 를 본다
  const gateKeys = spec.say ? Object.keys(beatIssues) : Object.keys(spec.captions || {});
  for (const key of gateKeys) {
    if (key === 'start') continue;
    const iss = beatIssues[key];
    if (iss == null && beatT[key] != null) gate.push({ shot: spec.shot, beat: key, kind: 'unchecked', text: '이 녹화는 검수 전 녹화기로 찍혔다 — 다시 녹화' });
    else if (iss && iss.length && !(spec.accept || []).includes(key)) for (const i of iss) gate.push({ shot: spec.shot, beat: key, ...i });
  }
  const caps = [];
  for (const [key, val] of Object.entries(spec.captions || {})) {
    const at = key === 'start' ? 0.2 : beatT[key];
    if (at == null) throw new Error(`${spec.shot}: 자막 자리 «${key}» 가 녹화에 없음 (있는 것: ${Object.keys(beatT).join(', ')})`);
    const c = typeof val === 'string' ? { text: val } : val;
    caps.push({ ...c, at: r3(at + 0.2) });
  }
  caps.sort((a, b) => a.at - b.at);
  // 자막은 화면이 다음 동작으로 바뀌기 전에 끝난다(다음 beat − 0.15초) · 다음 자막과는 나감(0.28초)+0.15초 띄운다(Fable A 2·4번)
  const beatTimes = Object.values(beatT).sort((a, b) => a - b);
  caps.forEach((c, i) => {
    const nextBeat = beatTimes.find((b) => b > c.at + 0.3);
    const nextCap = caps[i + 1] ? caps[i + 1].at - 0.45 : dur;
    const end = Math.min(nextCap, nextBeat != null ? nextBeat + 0.2 - 0.15 : dur);
    c.dur = r3(Math.max(1.2, end - c.at));
  });

  return {
    kind: 'screen', device: vp.mobile ? 'mobile' : 'desktop',
    src: `media/shots/${spec.shot}/raw.mp4`,
    viewport: { width: vp.width, height: vp.height, dpr: vp.dpr },
    segments: segs, cam: { landscape: tidy(camL), portrait: tidy(camP) },
    moves, clicks, spots, waits, captions: caps, dur: r3(dur), side: spec.side, _gate: gate,
    _clicks: clicks.map((c) => c.t),
  };
}

// 화면 장면 길이를 늘리거나 줄인다 — 마지막 구간(대개 정지 화면) 배속으로 흡수
function retimeScreen(sc, delta) {
  if (!delta) return;
  const g = sc.segments[sc.segments.length - 1];
  const span = g.dur * g.rate;
  const nd = Math.max(0.3, g.dur + delta);
  g.rate = r3(span / nd); g.dur = r3(nd);
  sc.dur = r3(g.at + g.dur);
}

// 올린 소재 장면 — 분석 결과(lib/assets.js)가 먼저 있어야 한다. 사진은 피사체 쪽으로, 영상은 쓸 수 있는 구간만 1.2초 안팎 컷으로.
//   (컷 경계를 음악 박자에 맞추는 것은 장면 경계 박자 맞춤과 같은 격자 — 컷 길이를 박 간격의 배수로 둔다)
function buildAsset(spec) {
  const file = path.join(ROOT, 'data', 'assets', spec.asset);
  const af = file + '.analysis.json';
  if (!fs.existsSync(file)) throw new Error(`소재 없음: ${spec.asset}`);
  if (!fs.existsSync(af)) throw new Error(`소재 분석 먼저: node lib/assets.js data/assets/${spec.asset}`);
  const a = loadJSON(af);
  const src = `media/uploads/${spec.asset}`;
  const base = { dur: spec.dur || 3.5, captions: spec.captions || [], title: spec.title };
  if (spec.kind === 'photo') {
    if (a.usable === false) throw new Error(`소재 «${spec.asset}» 는 쓰기 어렵다고 판독됨: ${a.issue || ''}`);
    return { kind: 'photo', src, subject: a.subject, ...base };
  }
  const segs = (a.usable || []).map((u) => ({ a: u.a + 0.15, b: u.b - 0.15 })).filter((u) => u.b - u.a >= 1);
  if (!segs.length) throw new Error(`소재 «${spec.asset}» 에 쓸 수 있는 구간(밝고 안 흔들린 1초 이상)이 없음`);
  const cutLen = spec.cut || 1.25;
  const cuts = []; let need = base.dur, k = 0, guard = 0;
  while (need > 0.05 && guard++ < 200) {
    const g = segs[k % segs.length];
    const off = Math.floor(k / segs.length) * cutLen; // 같은 구간을 두 번 쓰면 다음 부분부터
    const from = g.a + (off % Math.max(0.01, g.b - g.a - 0.5));
    const d = Math.min(cutLen, need, g.b - from);
    if (d > 0.3) { cuts.push({ src, from: r3(from), dur: r3(d) }); need -= d; }
    k++;
  }
  return { kind: 'footage', cuts, ...base };
}

// 화면 장면을 목표 길이에 맞춘다(녹음 기반) — 모든 시각을 같은 비율로 늘이고 줄인다.
//   너무 길면(2.5배 넘게 빨라져야 하면) 2.5배까지만 빨리 하고 뒤를 자른다 — UI 가 지나치게 빨라 보이지 않게.
function retimeScreenTo(sc, target) {
  let f = sc.dur / target; // >1 = 빨리
  f = Math.max(0.6, Math.min(2.5, f));
  const k = 1 / f;
  for (const g of sc.segments) { g.at = r3(g.at * k); g.dur = r3(g.dur * k); g.rate = r3(g.rate * f); }
  for (const key of ['landscape', 'portrait']) sc.cam[key].forEach((c) => { c.t = r3(c.t * k); });
  sc.moves.forEach((m) => { m.t0 = r3(m.t0 * k); m.t1 = r3(m.t1 * k); });
  sc.clicks.forEach((c) => { c.t = r3(c.t * k); });
  sc.spots.forEach((x) => { x.t0 = r3(x.t0 * k); x.t1 = r3(x.t1 * k); });
  sc.waits.forEach((x) => { x.t0 = r3(x.t0 * k); x.t1 = r3(x.t1 * k); x.rate = r3(x.rate * f); });
  sc._clicks = sc.clicks.map((c) => c.t);
  sc.dur = r3(target);
}

// 몽타주용 정지 화면 — 녹화 원본에서 한 장
function still(shotId, t, name) {
  const out = path.join(ROOT, 'out', 'stills', `${name}.jpg`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    ff(['-ss', String(t), '-i', path.join(SHOTS, shotId, 'raw.mp4'), '-frames:v', '1', '-q:v', '2', out]);
  }
  return `media/stills/${name}.jpg`;
}

// 몽타주 세로판 — 전체 화면 대신 그 장면의 첫 강조 영역을 2.5배쯤 잘라 쓴다(Fable A 3-④)
function stillCrop(shotId, t, name) {
  const out = path.join(ROOT, 'out', 'stills', `${name}-crop.jpg`);
  if (!fs.existsSync(out)) {
    const shot = loadJSON(path.join(SHOTS, shotId, 'shot.json'));
    const f = shot.events.find((e) => e.type === 'focus' && e.zoom !== false) || shot.events.find((e) => e.type === 'focus');
    const dpr = shot.viewport.dpr;
    const r = f ? f.rect : { x: shot.viewport.width * 0.25, y: shot.viewport.height * 0.2, w: shot.viewport.width * 0.5, h: shot.viewport.height * 0.6 };
    const w = Math.min(shot.viewport.width, Math.max(r.w + 60, 560)), h = Math.min(shot.viewport.height, Math.max(r.h + 60, w * 0.75));
    const x = Math.max(0, Math.min(shot.viewport.width - w, r.x + r.w / 2 - w / 2)), y = Math.max(0, Math.min(shot.viewport.height - h, r.y + r.h / 2 - h / 2));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    ff(['-ss', String(t), '-i', path.join(SHOTS, shotId, 'raw.mp4'), '-frames:v', '1', '-vf', `crop=${Math.round(w * dpr)}:${Math.round(h * dpr)}:${Math.round(x * dpr)}:${Math.round(y * dpr)}`, '-q:v', '2', out]);
  }
  return `media/stills/${name}-crop.jpg`;
}

function build(script, aspect = 'landscape') {
  const tpl = { ...template(script.template), ...(script.templateOverrides || {}) };
  const mus = script.music ? music(script.music) : null;
  const scenes = [];
  const list = script.scenes.filter((s) => !s.only || s.only === aspect);
  for (const [i, s] of list.entries()) {
    const id = s.id || `${i + 1}-${s.kind}${s.shot ? '-' + s.shot : ''}`;
    if (s.kind === 'screen') scenes.push({ id, ...buildScreen(s, tpl), transKind: s.transKind, transIn: s.transIn });
    else if (s.kind === 'montage') {
      const images = s.shots.map((x, k) => (aspect === 'portrait' ? stillCrop : still)(x.shot, x.t, `${x.shot}-${String(x.t).replace('.', '_')}-${k}`));
      scenes.push({ id, kind: 'montage', images, title: s.title, dur: s.dur, captions: s.captions || [], transKind: s.transKind, transIn: s.transIn });
    } else if (s.kind === 'photo' || s.kind === 'footage') scenes.push({ id, ...buildAsset(s), transKind: s.transKind, transIn: s.transIn });
    else scenes.push({ id, dur: s.dur, ...s, captions: s.captions || [] });
  }
  const gateIssues = scenes.flatMap((x) => x._gate || []);
  scenes.forEach((x) => { delete x._gate; });
  // 챕터 카드 — 그 챕터 첫 화면 장면의 정지 화면을 흐리게 깔고 «01 / 04» 진행 표시(Fable A 6번)
  const chapters = scenes.filter((x) => x.kind === 'chapter');
  chapters.forEach((ch, k) => {
    ch.total = String(chapters.length).padStart(2, '0');
    const i = scenes.indexOf(ch);
    const nxt = scenes.slice(i + 1).find((x) => x.kind === 'screen');
    const sp = nxt && list[scenes.indexOf(nxt)];
    if (sp && sp.shot) {
      const sh = loadJSON(path.join(SHOTS, sp.shot, 'shot.json'));
      const f = sh.events.find((e) => e.type === 'focus');
      ch.image = (aspect === 'portrait' ? stillCrop : still)(sp.shot, f ? f.t + 0.6 : 1, `ch-${sp.shot}`);
    }
  });

  // 녹음 기반(①): 장면 길이를 말에 맞춘다 — 장면 k 의 시작 = 그 장면 첫 문장 시작(편집 축). 자막 = 녹음 단어 시각.
  let voice = null;
  if (script.voice) {
    const vdir = path.join(ROOT, 'data', 'voice', script.voice.id);
    const vj = loadJSON(path.join(vdir, 'voice.json'));
    const S = vj.sentences;
    const total = vj.report.edited;
    // say 없는 장면(끝 로고)은 말이 끝난 뒤에 붙는다
    const starts = list.map((sp, k) => (k === 0 ? 0 : sp.say ? S[sp.say[0]].t0 - 0.12 : null));
    let tail = total + 0.4;
    starts.forEach((v, k) => { if (v == null) { starts[k] = tail; tail += list[k].dur || 3.5; } });
    scenes.forEach((sc, k) => {
      const sp = list[k];
      if (!sp.say) return; // 끝 로고 — 자기 dur 그대로
      const nextStart = k + 1 < scenes.length ? starts[k + 1] : total + 0.8;
      const nTrans = k + 1 < scenes.length ? (scenes[k + 1].transIn ?? tpl.transitionSec) : 0;
      const target = Math.max(1.2, nextStart - starts[k] + nTrans);
      if (sc.kind === 'screen') retimeScreenTo(sc, target); else sc.dur = r3(target);
      // 이 장면이 말하는 문장 → 자막(문장마다 한 자막, 단어 시각 그대로)
      const [a, b] = sp.say;
      sc.captions = S.slice(a, b + 1).map((x) => ({ text: x.text, at: r3(Math.max(0, x.t0 - starts[k])), dur: r3(x.t1 - x.t0 + 0.25), words: x.words.map((w) => ({ w: w.w, t: r3(w.t - x.t0) })) }));
    });
    voice = { src: `media/voice/${script.voice.id}/voice.m4a`, volume: 1, spans: S.map((x) => ({ t0: x.t0, t1: x.t1 })),
      face: script.voice.face && fs.existsSync(path.join(vdir, 'face.mp4')) ? `media/voice/${script.voice.id}/face.mp4` : null };
  }

  // 음악 박자: 영상 0초 = 음악 startAt. 장면 경계를 박자에 붙인다(녹음 기반은 말이 길이를 정하므로 안 붙인다)
  const startAt = mus ? (script.musicStart != null ? script.musicStart : mus.analysis.beats[0]) : 0;
  const grid = !mus || tpl.beatSync === 'none' || voice ? [] : (tpl.beatSync === 'downbeat' ? mus.analysis.downbeats : mus.analysis.beats).map((b) => b - startAt).filter((b) => b > 0);
  let at = 0;
  scenes.forEach((sc, i) => {
    const trans = i === 0 ? 0 : (sc.transIn ?? tpl.transitionSec);
    if (i > 0) at -= trans;
    const start = at;
    let end = start + sc.dur;
    if (grid.length && i < scenes.length - 1) {
      // 다음 장면이 들어오는 시각(end - 다음 전환 길이의 절반)이 박에 오도록
      const nxt = scenes[i + 1]; const nTrans = nxt.transIn ?? tpl.transitionSec;
      const cut = end - nTrans / 2;
      const win = sc.kind === 'screen' ? 0.9 : 0.7;
      const cand = grid.filter((b) => Math.abs(b - cut) <= win && b - start > 1);
      if (cand.length) {
        const b = cand.reduce((p, q) => (Math.abs(q - cut) < Math.abs(p - cut) ? q : p));
        const delta = b - cut;
        if (sc.kind === 'screen') retimeScreen(sc, delta); else sc.dur = r3(sc.dur + delta);
        end = start + sc.dur;
      }
    }
    sc._start = r3(start);
    at = end;
  });
  const total = at;
  // 마지막 자막은 다음 장면 전환이 시작되기 전에 나간다(겹침 방지)
  scenes.forEach((sc, i) => {
    const nx = scenes[i + 1]; if (!nx || !sc.captions) return;
    const nTrans = nx.transIn ?? tpl.transitionSec;
    for (const c of sc.captions) { const lim = sc.dur - nTrans - 0.15 - c.at; if (c.dur > lim) c.dur = r3(Math.max(0.8, lim)); }
    sc.exitAt = r3(sc.dur - nTrans);
  });

  // 효과음
  const sfx = [];
  scenes.forEach((sc, i) => {
    const kind = sc.transKind || (tpl.transition === 'mixed' ? ['zoom', 'slide', 'fade', 'wipe'][i % 4] : tpl.transition);
    if (i > 0 && kind !== 'fade' && kind !== 'cut') sfx.push({ t: r3(sc._start - 0.12), kind: 'whoosh' });
    // 클릭 소리는 2초에 한 번까지(피로 — Fable A 9번)
    if (sc.kind === 'screen') { let last = -9; for (const c of sc._clicks) { if (c - last >= 2) { sfx.push({ t: r3(sc._start + c - 0.03), kind: 'click' }); last = c; } } }
    if (sc.kind === 'chapter' || sc.kind === 'title') sfx.push({ t: r3(sc._start + 0.25), kind: 'pop' });
    if (sc.kind === 'points') sc.points.forEach((_, k) => sfx.push({ t: r3(sc._start + 0.6 + k * 0.45), kind: 'pop', vol: 0.8 }));
    if (sc.kind === 'stat') sfx.push({ t: r3(sc._start + 1.4), kind: 'ding' });
    if (sc.kind === 'logo') sfx.push({ t: r3(sc._start + 0.1), kind: 'boom' });
    if (sc.kind === 'converge') { sfx.push({ t: r3(sc._start + sc.at - 0.1), kind: 'whoosh' }); sfx.push({ t: r3(sc._start + sc.at + 0.45), kind: 'ding' }); }
    if (tpl.caption === 'pop') for (const c of sc.captions || []) sfx.push({ t: r3(sc._start + c.at), kind: 'pop', vol: 0.5 });
    if (sc.kind === 'montage' && sc.beats) sc.beats.forEach((b) => sfx.push({ t: r3(sc._start + b), kind: 'whoosh', vol: 0.6 }));
    delete sc._clicks; delete sc._start;
  });

  return {
    id: script.id, aspect, title: script.title, mode: script.mode || 'instruction', fps: FPS,
    template: tpl, scenes,
    music: mus ? { src: `media/music/${mus.file ? path.basename(mus.file) : ''}`, volume: tpl.musicVolume, startAt: r3(startAt), fadeIn: 0.6, fadeOut: 2.2, credit: mus.credit } : undefined,
    sfx: sfx.filter((x) => x.t >= 0 && x.t < total),
    voice: voice || undefined,
    brand: { logoWhite: 'brand/planQ_white_new.svg', logoColor: 'brand/planQ_color.svg', mark: 'brand/favicon.svg', url: 'planq.kr' },
    _grid: grid.filter((b) => b < total), _total: r3(total), _gate: gateIssues,
    _beats: mus ? mus.analysis.beats.map((b) => r3(b - startAt)).filter((b) => b >= 0 && b < total) : [],
  };
}

// 몽타주 박자 — 장면 시작 이후의 박을 장면 기준 시각으로
function attachMontageBeats(sb) {
  if (!sb._beats.length) return sb;
  let at = 0;
  sb.scenes.forEach((sc, i) => {
    const trans = i === 0 ? 0 : (sc.transIn ?? sb.template.transitionSec);
    if (i > 0) at -= trans;
    if (sc.kind === 'montage' && !sc.beats) {
      // 장면 안의 모든 박 중에서 사진 수만큼 고르게(사진 한 장이 0.9초 이상 보이게)
      const local = sb._beats.map((b) => b - at).filter((b) => b >= 0 && b < sc.dur - 0.6);
      const n = sc.images.length;
      sc.beats = local.length >= n ? Array.from({ length: n }, (_, k) => local[Math.floor((k * local.length) / n)]) : local;
      if (sc.beats.length) sc.beats[0] = 0;
    }
    if (sc.kind === 'kinetic' && sc.snap) {
      sc.lines.forEach((ln) => { const near = sb._grid.map((b) => b - at).filter((b) => b >= 0).reduce((p, q) => (Math.abs(q - ln.at) < Math.abs(p - ln.at) ? q : p), ln.at); if (Math.abs(near - ln.at) < 0.5) ln.at = r3(near); });
    }
    at += sc.dur;
  });
  return sb;
}

if (require.main === module) {
  const file = process.argv[2];
  const script = loadJSON(file);
  // 가로·세로를 따로 만든다 — 세로는 장면 고르기(only)·몽타주 잘라 쓰기·카메라가 다르다
  for (const aspect of ['landscape', 'portrait']) {
    const sb = attachMontageBeats(build(script, aspect));
    if (sb._gate.length && !process.argv.includes('--accept-all')) {
      console.error(`✗ 소재 검수 관문: ${sb._gate.length}건 — 렌더하지 않는다(대본 screen 장면에 "accept": ["beat 키"] 로 «그대로 쓰기», 또는 다시 녹화)`);
      for (const g of sb._gate) console.error(`  · ${g.shot} / ${g.beat}: ${g.kind} — ${g.text}`);
      process.exit(2);
    }
    const out = path.join(ROOT, 'out', 'storyboards', `${script.id}.${aspect}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(sb, null, 1));
    console.log(`장면 목록 ${path.basename(out)} · 장면 ${sb.scenes.length} · ${sb._total}s · 효과음 ${sb.sfx.length}`);
  }
}
module.exports = { build, attachMontageBeats, template, music };
