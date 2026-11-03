// services/remoteIo.js — socket.io 가 **없는 프로세스**에서 실시간 방송을 메인 백엔드로 넘기는 얇은 대리자.
//
// ★ 왜 (2026-10-04): AI 에이전트 도구(#439)는 MCP 프로세스(:3005)에서 돈다. 행동 계층은 방송을
//   `global.__planqIo` 로 하는데, 그 값은 메인 서버(server.js)에서만 채워진다. 그래서 ChatGPT 가 업무를
//   만들거나 메모를 남겨도 **열어 둔 화면에는 새로고침 전까지 안 보였다**(CLAUDE.md 16번 — "리프레시 없이").
//   메인에 내부 라우트 하나(`POST /api/internal/broadcast`)를 두고, 이 프로세스에서는 io 와 같은 모양
//   (`io.to(room).emit(event, payload)`)으로 받아 그쪽으로 보낸다. 호출부(행동 계층)는 아무것도 바꾸지 않는다.
//
// ★ 실패는 삼킨다 — 방송은 부가 효과다. 쓰기는 이미 끝났고, 화면은 visibility 복귀에서 다시 읽는다.
// ★ 같은 틱의 방송은 한 번에 묶어 보낸다(업무 하나 만들면 4~5건이 연달아 나온다).
const http = require('http');

const TARGET_PORT = Number(process.env.PORT) || 3003;

let queue = [];
let timer = null;

function flush() {
  timer = null;
  const emits = queue;
  queue = [];
  if (!emits.length || !process.env.INTERNAL_API_KEY) return;
  const body = JSON.stringify({ emits });
  try {
    const r = http.request({
      host: '127.0.0.1', port: TARGET_PORT, path: '/api/internal/broadcast', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-internal-api-key': process.env.INTERNAL_API_KEY },
      timeout: 3000,
    }, (res) => { res.resume(); if (res.statusCode !== 200) console.warn('[remoteIo] broadcast', res.statusCode); });
    r.on('error', (e) => console.warn('[remoteIo]', e.message));
    r.on('timeout', () => r.destroy());
    r.end(body);
  } catch (e) { console.warn('[remoteIo]', e.message); }
}

function push(rooms, event, payload, except = []) {
  // 한 번의 emit = 한 줄(rooms 배열) — 방마다 나눠 보내면 두 방에 다 든 소켓이 두 번 받는다(socket.io 는 한 emit 안에서 중복을 거른다).
  queue.push({ rooms, except, event, payload: payload === undefined ? null : payload });
  if (!timer) timer = setImmediate(flush);
}

// io.to(a).to([b, c]).except([d]).emit(e, p) 모양을 흉내 낸다.
// ★ 2026-11-03 — 옛 대리자는 `to(방 하나)` 만 흉내 냈다. 숨은 프로젝트(기본값 «참여 멤버만»)·L1/L2 업무 방송은
//   projectRoom.emitBusinessForProject · taskRoom.emitTask 가 `to([방 배열])` + `.except(방들)` 를 쓰는데,
//   여기엔 except 가 없어 TypeError → 호출부 `.catch(() => {})` 가 삼켰다. ChatGPT 가 프로젝트 안 업무를 만들고 고쳐도
//   열린 화면엔 신호가 0 이었다(Irene «챗gpt나 다른 경로를 통해 뭔가 바꾸면 바로 바로 적용이 안돼»).
const flat = (r) => (Array.isArray(r) ? r : [r]).filter((x) => typeof x === 'string');
function chain(rooms, except) {
  return {
    to(room) { return chain([...rooms, ...flat(room)], except); },
    in(room) { return chain([...rooms, ...flat(room)], except); },
    except(room) { return chain(rooms, [...except, ...flat(room)]); },
    emit(event, payload) { if (rooms.length) push(rooms, event, payload, except); return true; },
  };
}

const remoteIo = {
  to(room) { return chain(flat(room), []); },
  in(room) { return chain(flat(room), []); },
  except(room) { return chain([], flat(room)); },
};

module.exports = { remoteIo };
