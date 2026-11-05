// health-check 계열(health-check · health-money · health-access) 공용 fetch — require 하면 global.fetch 를 감싼다.
//
// ★ 2026-10-08 0-J (Fable 0-C~F 비차단 지적) — localhost fetch 가 간헐적으로 `fetch failed` 였다.
//   ①Node 는 localhost 를 ::1(IPv6)로 먼저 풀 수 있고 백엔드는 IPv4 에서 듣는다 → 127.0.0.1 로 고정한다.
//     (판정 분기 `BACKEND.startsWith('http://localhost')` 는 그대로 — 바꾸는 것은 실제 접속 주소뿐이다.)
//   ②짧게 재시도한다 — 읽기(GET·HEAD)는 모든 네트워크 오류, 쓰기는 «연결 자체가 안 됨»(ECONNREFUSED 등)만.
//     요청이 서버에 닿았을 수 있는 쓰기 오류(응답 중 끊김)는 재시도하지 않는다 — 쓰기 검사를 두 번 실행하지 않게.
//
// ★ 2026-11-06 — 429(분당 한도)는 한도 창이 풀릴 때까지 기다렸다 다시 보낸다.
//   11-06 03:28 배포 게이트가 health-check 2건 429 로 멈췄다. 밤 순찰(nightly-patrol, 18:00~21:30 UTC)이
//   **같은 검사 계정(health-check@planq.kr)** 으로 브라우저 7개를 돌려 그 계정의 사용자 버킷(600/분)을 내내 비워 둔다 —
//   순찰 중에는 언제 돌려도 재현(실측: 16건 429 · RateLimit-Remaining 0 이 계속).
//   429 는 한도 미들웨어가 라우트 **앞에서** 거절한 것이라 쓰기라도 다시 보내도 두 번 실행되지 않는다.
//   한도 자체를 시험하는 검사는 이 계열에 없다(429 를 기대하는 test 0건). 기다림은 프로세스당 합계 10분까지 —
//   넘으면 429 응답을 그대로 돌려줘 예전처럼 빨갛게 드러난다(무한 대기로 게이트가 조용히 멈추지 않게).
if (!global.__planqHealthFetch) {
  global.__planqHealthFetch = true;
  const _fetch = global.fetch;
  const RETRYABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);
  const WAIT_BUDGET_MS = 10 * 60 * 1000;
  let waited = 0;
  let retries429 = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const netFetch = async (url, init) => {
    let last;
    for (let i = 0; i < 4; i++) {
      try { return await _fetch(url, init); } catch (e) {
        last = e;
        const code = e && (e.cause && (e.cause.code || (e.cause.errors && e.cause.errors[0] && e.cause.errors[0].code)));
        // 읽기(GET·HEAD)는 어떤 네트워크 오류든 다시 해도 안전하다. 쓰기는 «아예 못 붙은» 경우만.
        const method = String((init && init.method) || 'GET').toUpperCase();
        const idempotent = method === 'GET' || method === 'HEAD';
        if (!idempotent && !RETRYABLE.has(code)) throw e;
        if (process.env.HC_NET_DEBUG) console.error(`[hc fetch retry] ${method} ${url} code=${code} try=${i + 1}`);
        await sleep(1000 * (i + 1));
      }
    }
    throw last;
  };

  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input.replace(/^http:\/\/localhost(?=[:/])/, 'http://127.0.0.1') : input;
    for (let attempt = 0; ; attempt++) {
      const res = await netFetch(url, init);
      if (res.status !== 429 || attempt >= 3 || waited >= WAIT_BUDGET_MS) return res;
      // 본문은 문자열(JSON)만 다시 보낼 수 있다 — 스트림·FormData 면 그대로 돌려준다.
      const body = init && init.body;
      if (body != null && typeof body !== 'string') return res;
      const reset = Number(res.headers.get('ratelimit-reset'));
      const ms = Math.min(65, Number.isFinite(reset) && reset > 0 ? reset + 1 : 15) * 1000;
      try { await res.arrayBuffer(); } catch { /* 소켓만 비운다 */ }
      waited += ms;
      retries429 += 1;
      console.error(`[hc fetch 429] ${String((init && init.method) || 'GET').toUpperCase()} ${url} — 한도 창 ${Math.round(ms / 1000)}초 기다렸다 다시 (누적 ${retries429}회 · ${Math.round(waited / 1000)}초)`);
      await sleep(ms);
    }
  };
}
