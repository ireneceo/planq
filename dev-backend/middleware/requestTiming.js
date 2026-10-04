// 느린 요청 기록 — «모든 기능 속도 체크» 를 실사용 데이터로 한다 (2026-10-04, Irene: "속도 체크 좀 해줘. 모든 기능.")
//
// 운영에는 대신 로그인할 테스트 계정이 없고, 사용자 계정으로 대신 재는 것은 하지 않는다.
// 그래서 실제로 쓰는 요청 중 느린 것만 남긴다 — 경로는 숫자 id 를 :id 로 접고(사람·자료가 로그에 안 남게),
// 쿼리 문자열은 버린다. 본문·토큰·사용자 이름은 담지 않는다. 판독은 `grep '\[slow\]'` 한 줄.
const SLOW_MS = process.env.SLOW_REQUEST_MS != null && process.env.SLOW_REQUEST_MS !== '' ? Number(process.env.SLOW_REQUEST_MS) : 800;

const WORD = /^[a-z][a-z_-]{0,29}$/;

function routeKey(req) {
  // 값이 로그에 남지 않게 한다 — 사람 값(:email·:name 라벨)·토큰·id 모두.
  //   ① 라우트가 잡혔으면 **코드에 적힌 모양**(req.route.path, 예: /email-labels/:name)을 쓰고,
  //      그 앞의 마운트 접두어는 실제 주소에서 같은 개수만큼 떼어 고정 단어만 남긴다
  //      (req.baseUrl 은 next(err) 된 요청에서 비어 접두어가 빠진다 — Fable 2026-10-04).
  //   ② 안 잡힌 요청(404)은 앞의 고정 단어 두 개만 남긴다 — 그 뒤는 무엇이든 «…».
  //   ★ 실제 주소 조각을 «지울 것만 지우는» 방식은 샌다(실측: email-addresses/irene%40…, email-labels/vip).
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  const segs = path.split('/').filter(Boolean);
  const mask = (seg) => (WORD.test(seg) ? seg : ':v');
  if (req.route && typeof req.route.path === 'string') {
    const pat = req.route.path.split('/').filter(Boolean);
    const prefix = segs.slice(0, Math.max(0, segs.length - pat.length)).map(mask);
    return ('/' + [...prefix, ...pat].join('/')).slice(0, 160);
  }
  const head = [];
  for (const seg of segs) { if (head.length >= 2 || !WORD.test(seg)) break; head.push(seg); }
  return '/' + head.join('/') + (segs.length > head.length ? '/…' : '');
}

module.exports = function requestTiming(req, res, next) {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms < SLOW_MS) return;
    // 스트림 다운로드·SSE 처럼 «오래 열려 있는 것이 정상» 인 응답은 느림으로 세지 않는다
    const ct = String(res.getHeader('content-type') || '');
    if (/event-stream|octet-stream|application\/zip|application\/pdf|^image\/|^video\/|^audio\//.test(ct)) return;
    console.log('[slow]', JSON.stringify({ at: new Date().toISOString(), m: req.method, r: routeKey(req), s: res.statusCode, ms: Math.round(ms) }));
  });
  next();
};
