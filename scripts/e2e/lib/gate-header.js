// scripts/e2e/lib/gate-header.js — 상황판 «개발 사이트 로그인 관문» 통과 표식 (2026-10-29)
//   관문(nginx auth_request → 상황판 /__gate/)을 켜면 공개 주소(dev.planq.kr)로 들어오는 순찰·카나리가
//   전부 로그인 화면(302)으로 튕긴다. 서버 안 자동 시험은 머리글 X-Board-Gate-Test 로 통과한다
//   (~/dev-server/SERVER_SETUP.md 2절). 값은 파일에서만 읽는다 — 코드·커밋·로그에 적지 않는다.
//   파일이 없으면 아무것도 안 한다(머리글 없이 — 관문이 꺼져 있으면 그대로 통과).
//
//   ★ 머리글은 **관문 뒤 주소(BASE 의 호스트)로 가는 요청에만** 붙인다.
//     page.setExtraHTTPHeaders 는 모든 출처에 붙어 값이 바깥(글꼴·스크립트 CDN)으로 새고,
//     낯선 머리글이 다른 출처 요청에 사전 확인(CORS preflight)을 일으켜 멀쩡한 화면을 깨뜨린다.
//     그래서 브라우저 전체에 따로 CDP 세션을 하나 열어 그 호스트만 Fetch 로 잡는다 — 카나리 자신의
//     setRequestInterception(페이지 세션)과 따로 돈다(둘 다 걸린 페이지에서 차단·통과 실측).
//   붙는 곳: ① puppeteer.launch·connect 로 연 모든 브라우저(페이지·새 창 전부) ② Node 쪽 전역 fetch.
//   lib/browser.js 와 run.js 가 불러 둔다 — 카나리를 따로 돌려도 붙는다. 여러 번 불러도 한 번만 건다.
const fs = require('fs');

const HEADER = 'X-Board-Gate-Test';
const TOKEN_FILE = process.env.BOARD_GATE_TEST_TOKEN_FILE || '/home/irene/dev-server/board/secrets/gate-test-token';

function readToken() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim() || null; } catch { return null; }
}

function gateHosts() {
  const hosts = new Set(['dev.planq.kr']);
  for (const u of [process.env.E2E_BASE, process.env.CANARY_FRONT]) {
    try { if (u) hosts.add(new URL(u).host); } catch { /* 잘못된 주소는 무시 */ }
  }
  return hosts;
}

function isGated(url, hosts) {
  try { return hosts.has(new URL(url).host); } catch { return false; }
}

async function attachToTarget(target, token, hosts) {
  const s = await target.createCDPSession();
  s.on('Fetch.requestPaused', (e) => {
    const headers = Object.entries(e.request.headers || {})
      .filter(([k]) => k.toLowerCase() !== HEADER.toLowerCase())
      .map(([name, value]) => ({ name, value: String(value) }));
    if (isGated(e.request.url, hosts)) headers.push({ name: HEADER, value: token });
    s.send('Fetch.continueRequest', { requestId: e.requestId, headers }).catch(() => { /* 페이지가 닫힘 */ });
  });
  await s.send('Fetch.enable', { patterns: [...hosts].map((h) => ({ urlPattern: `*://${h}/*`, requestStage: 'Request' })) });
}

function warn(e) { console.warn(`  [harness] 관문 표식 붙이기 실패: ${e && e.message}`); }

function install() {
  if (globalThis.__boardGateHeaderInstalled) return;
  globalThis.__boardGateHeaderInstalled = true;
  const token = readToken();
  if (!token) return;
  const hosts = gateHosts();

  // ① Node 쪽 fetch(카나리의 API 직접 호출)
  if (typeof globalThis.fetch === 'function') {
    const orig = globalThis.fetch;
    globalThis.fetch = function gatedFetch(input, init) {
      const url = typeof input === 'string' ? input : (input && (input.href || input.url));
      if (!isGated(url, hosts)) return orig.call(this, input, init);
      const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
      headers.set(HEADER, token);
      return orig.call(this, input, { ...(init || {}), headers });
    };
  }

  // ② puppeteer — 브라우저 전체에 한 세션(browser target 의 Fetch)을 건다. 페이지·새 창(popup)·워커가
  //   어떤 경로로 생겨도 같이 잡히고, 첫 이동보다 늦게 붙는 경쟁이 없다(페이지마다 걸면 새 창 첫 요청을 놓쳤다).
  let PN;
  try { PN = require('/opt/planq/dev-backend/node_modules/puppeteer-core/lib/cjs/puppeteer/node/PuppeteerNode.js').PuppeteerNode; }
  catch (e) { warn(e); return; }
  for (const m of ['launch', 'connect']) {
    const orig = PN.prototype[m];
    PN.prototype[m] = async function gated(...args) {
      const browser = await orig.apply(this, args);
      try { await attachToTarget(browser.target(), token, hosts); } catch (e) { warn(e); }
      return browser;
    };
  }
}

install();

module.exports = { install, HEADER };
