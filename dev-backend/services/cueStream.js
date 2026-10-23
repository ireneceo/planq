// Cue 답 흘려 보내기(SSE) — 응답 쪽 한 벌 (docs/CUE_STREAMING_DESIGN.md · Fable 2026-10-23 OK-WITH-CHANGES).
//   routes/cue.js POST /help 가 Accept: text/event-stream 일 때만 연다. 이벤트: status{kind} · delta{t} · reset · done{…} · error{message}.
const { createTagHoldback } = require('./cueQuestionAnalysis');

const wantsStream = (req) => /text\/event-stream/i.test(String(req.headers.accept || ''));

/** 헤더를 보내고 첫 신호(thinking)를 쓴다. 반환: { send, gone, onEvent } — onEvent 는 converse·callLLM 의 신호를 받는다. */
function openCueStream(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');   // nginx /api/ 블록은 버퍼링을 켜 둔다
  res.flushHeaders();
  // 끊김은 res 의 close(+ 다 쓰지 못함)로 본다 — req 의 close 는 본문을 다 읽은 직후에 불린다(Fable 실측).
  let gone = false;
  res.on('close', () => { if (!res.writableFinished) gone = true; });
  const send = (event, data) => {
    if (gone || res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  // 분류 꼬리표([[cue:…]])는 흘리지 않는다 — 정본은 done 의 answer(parseClassification).
  const hold = createTagHoldback((t) => send('delta', { t }));
  const onEvent = (type, arg) => {
    if (type === 'delta') hold.push(arg);
    else if (type === 'reset') { hold.reset(); send('reset', {}); }
    else if (type === 'status') send('status', { kind: arg });
  };
  send('status', { kind: 'thinking' });
  return { send, gone: () => gone, onEvent };
}

/** 헤더를 이미 보낸 뒤의 예외 — 오류 처리기는 헤더를 다시 쓰다 터진다. 이벤트로 알리고 닫는다. 처리했으면 true. */
function endStreamOnError(res, e) {
  if (!res.headersSent) return false;
  console.error('[cue/help stream] 헤더 뒤 예외:', e?.stack || e);
  try { if (!res.writableEnded) { res.write(`event: error\ndata: ${JSON.stringify({ message: 'internal_error' })}\n\n`); res.end(); } } catch { /* 이미 끊김 */ }
  return true;
}

module.exports = { wantsStream, openCueStream, endStreamOnError };
