// mailRoute — 메일(IMAP/SMTP) 연결을 «어느 길로» 할지 정하는 한 곳 (2026-11-17)
//
//   Irene: «다른 앱에서는 연동 잘 되는데 이유가 뭐야? 다른 회사들 것도 이러면 어떻게 하는데?» → B안 «권고대로».
//   설계 docs/MAIL_KR_RELAY_DESIGN.md (Fable 설계 검토 DESIGN-FIX 7건 반영).
//
//   PlanQ 서버는 해외(DE)에 있다. 해외 IP 를 통째로 버리는 한국 메일 서버(gmate 등)는 직접 붙으면 «응답 없음» 이다.
//   그런 경우에만 한국 중계(SOCKS5)를 거친다. 지금 잘 되는 계정은 길이 바뀌지 않는다.
//
//   ★ 계약
//   - 중계는 «응답 없음» 일 때만. 인증 실패·주소 없음·거절은 넘기지 않는다(같은 결과라 시간만 쓴다).
//   - 중계 금지: google_oauth(살아 있는 토큰) · 평문(imap_tls=false / smtp_tls=false) · 중계 포트 밖.
//   - 중계 경로는 인증서를 검증한다(rejectUnauthorized:true + servername) — 중계를 장악해도 비밀번호를 못 본다.
//   - 목적지는 PlanQ 가 netGuard 로 검사한 **IP** 로만 CONNECT(중계가 이름을 다시 풀지 않는다).
//   - 중계가 죽은 것(relay_unavailable)은 계정 오류가 아니다 — 계정에 적지 않고 관리자에게 알린다.
//   - `direct` 계정은 연속 3회 응답 없음 뒤에만 중계를 시도한다(독일 쪽 순간 장애로 전 계정이 새지 않게).
//   - MAIL_RELAY_URL 이 없으면 지금과 똑같다(직접만).
const net = require('net');

// 중계로 보내도 되는 포트 — dante 규칙과 같게 둔다(25·2525 는 서버 간 발송 포트라 뺀다).
const RELAY_PORTS = new Set([143, 465, 587, 993, 995]);
const DIRECT_STREAK_BEFORE_RELAY = 3;
const DIRECT_TIMEOUT_WITH_FALLBACK_MS = 8000;
const RELAY_TIMEOUT_MS = 12000;
const REPROBE_EVERY_MS = 24 * 3600 * 1000;
const MAX_OPENING = 4;        // 동시에 여는(handshake 중) 중계 연결 상한
const MAX_LIVE = 300;         // 살아 있는 중계 연결 상한

let relayCache;               // { raw, cfg }
function relayConfig() {
  const raw = process.env.MAIL_RELAY_URL || '';
  if (relayCache && relayCache.raw === raw) return relayCache.cfg;
  let cfg = null;
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === 'socks5:' && u.hostname && u.port) {
        cfg = { host: u.hostname, port: Number(u.port), userId: decodeURIComponent(u.username || ''), password: decodeURIComponent(u.password || '') };
      } else console.error('[mailRoute] MAIL_RELAY_URL 형식이 socks5://user:pass@host:port 가 아니다 — 중계 끔');
    } catch { console.error('[mailRoute] MAIL_RELAY_URL 을 읽지 못했다 — 중계 끔'); }
  }
  relayCache = { raw, cfg };
  return cfg;
}

// 개발 전용 — 중계 경로를 강제로 탄다(검증용). 운영에서는 읽지 않는다(Fable 7).
function forceRelay() {
  return process.env.NODE_ENV === 'development' && process.env.MAIL_RELAY_FORCE === '1';
}

/** 이 연결이 중계를 탈 수 있는가 — 모든 경로가 이 한 함수로 판정한다. */
function relayAllowed({ port, tls, authType }) {
  if (!relayConfig()) return false;
  if (authType === 'google_oauth') return false;
  if (tls === false) return false;
  return RELAY_PORTS.has(Number(port));
}

// 연결 단계에서 상대가 아무 답도 안 함 — 방화벽·해외 IP 차단에서 흔하다. 거절(ECONNREFUSED)은 포트가 틀린 쪽이라 빼 둔다.
function isUnreachable(e, msg) {
  const m = msg || String((e && e.message) || e || '');
  if (e && e.pqCode) return e.pqCode === 'unreachable';
  const code = e && e.code;
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return true;
  return /timed out while connecting|connection timeout|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(m);
}
function isCertError(e) {
  const m = String((e && (e.code || '') + ' ' + (e.message || '')) || '');
  return /CERT_|certificate|self[- ]signed|altnames|unable to verify|UNABLE_TO_VERIFY|ERR_TLS_CERT/i.test(m);
}

// ── 계정별 길 기억 ──
const directStreak = new Map();   // accountId → 연속 «직접 응답 없음» 횟수(메모리 — 재시작하면 보수적으로 0)

/** 시도 순서. account 가 없으면(등록 전) 저장 없이 같은 규칙. */
function routeOrder(account, { port, tls, authType }) {
  if (!relayAllowed({ port, tls, authType })) return ['direct'];
  if (forceRelay()) return ['relay'];
  const route = account && account.connect_route;
  if (route === 'relay') return ['relay'];
  if (route === 'direct') {
    return (directStreak.get(account.id) || 0) >= DIRECT_STREAK_BEFORE_RELAY ? ['direct', 'relay'] : ['direct'];
  }
  return ['direct', 'relay'];
}

async function rememberRoute(account, route) {
  if (!account || !account.id || !route) return;
  if (route === 'direct') directStreak.delete(account.id);
  if (forceRelay()) return;   // 강제 시험은 저장하지 않는다
  const prev = account.connect_route ?? null;
  if (prev === route) return;
  try {
    const { sequelize } = require('../config/database');
    // 조건부 — 동시에 두 연결이 다른 길을 쓰려 해도 먼저 쓴 쪽만 남는다(Fable: 경합)
    await sequelize.query(
      'UPDATE email_accounts SET connect_route = ?, connect_route_checked_at = NOW() WHERE id = ? AND connect_route <=> ?',
      { replacements: [route, account.id, prev] },
    );
    try { account.set ? account.set('connect_route', route, { raw: true }) : (account.connect_route = route); } catch { account.connect_route = route; }
    console.log(`[mailRoute] account #${account.id} 연결 길 ${prev || '모름'} → ${route}`);
  } catch (e) { console.warn('[mailRoute] remember', e.message); }
}
function noteDirectUnreachable(account) {
  if (!account || !account.id) return;
  directStreak.set(account.id, (directStreak.get(account.id) || 0) + 1);
}

// ── 중계 고장 알림 (계정이 아니라 관리자에게, 1시간에 한 번) ──
let lastRelayAlert = 0;
async function reportRelayDown(reason) {
  console.error('[mailRoute] 한국 중계에 연결하지 못했다:', reason);
  if (Date.now() - lastRelayAlert < 3600 * 1000) return;
  lastRelayAlert = Date.now();
  try {
    const { notify } = require('../routes/notifications');
    const { User } = require('../models');
    const admins = await User.findAll({ where: { platform_role: 'platform_admin' }, attributes: ['id'] });
    for (const u of admins) {
      await notify({
        userId: u.id, businessId: null, eventKind: 'system',
        title: '메일 한국 중계 서버에 연결할 수 없음',
        body: `중계를 쓰는 메일 계정의 수신·발송이 멈춰 있습니다. 원인: ${String(reason).slice(0, 200)}`,
        ioApp: global.__planqIo,
      }).catch(() => {});
    }
  } catch (e) { console.warn('[mailRoute] alert', e.message); }
}

function relayError(pqCode, message) {
  const e = new Error(pqCode === 'relay_unavailable' ? 'relay_unavailable' : message);
  e.pqCode = pqCode;
  e.code = pqCode === 'unreachable' ? 'ETIMEDOUT' : (pqCode === 'refused' ? 'ECONNREFUSED' : 'relay_unavailable');
  return e;
}

// 중계까지는 닿는가(3초) — 우리 쪽 타임아웃이 «중계가 죽음» 인지 «상대가 무응답» 인지 가른다.
function relayReachable(cfg) {
  return new Promise((resolve) => {
    const s = net.connect({ host: cfg.host, port: cfg.port });
    const done = (ok) => { try { s.destroy(); } catch { /* */ } resolve(ok); };
    s.setTimeout(3000, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

let opening = 0; let live = 0; const waiters = [];
async function acquireOpen() {
  if (opening < MAX_OPENING) { opening += 1; return; }
  await new Promise((r) => waiters.push(r));
  opening += 1;
}
function releaseOpen() { opening -= 1; const w = waiters.shift(); if (w) w(); }

/**
 * 중계로 이어진 TCP 소켓. addresses = netGuard 가 검사한 주소(IPv4 우선).
 * 실패는 pqCode: relay_unavailable(중계 고장·인증·상한) / unreachable(상대 무응답) / refused(거절).
 */
async function openRelaySocket({ addresses, port, timeoutMs = RELAY_TIMEOUT_MS }) {
  const cfg = relayConfig();
  if (!cfg) throw relayError('relay_unavailable', 'relay_not_configured');
  const list = (addresses || []).slice().sort((a, b) => (a.family === 4 ? 0 : 1) - (b.family === 4 ? 0 : 1));
  if (!list.length) throw relayError('refused', 'no_address');
  if (live >= MAX_LIVE) throw relayError('relay_unavailable', 'relay_live_cap');
  const { SocksClient } = require('socks');
  await acquireOpen();
  try {
    const { socket } = await SocksClient.createConnection({
      proxy: { host: cfg.host, port: cfg.port, type: 5, userId: cfg.userId, password: cfg.password },
      command: 'connect',
      destination: { host: list[0].address, port: Number(port) },   // IP 리터럴 — 중계가 이름을 풀지 않는다
      timeout: timeoutMs,
    });
    live += 1;
    socket.once('close', () => { live -= 1; });
    return socket;
  } catch (e) {
    const m = String((e && e.message) || e);
    if (/HostUnreachable|NetworkUnreachable|TTLExpired/i.test(m)) throw relayError('unreachable', m);
    if (/ConnectionRefused/i.test(m)) throw relayError('refused', m);
    if (/timed out/i.test(m) && await relayReachable(cfg)) throw relayError('unreachable', m);
    const err = relayError('relay_unavailable', m);
    reportRelayDown(m);
    throw err;
  } finally { releaseOpen(); }
}

// node-imap(0.8.19)은 넘겨받은 소켓에 tls.connect 를 건 뒤 socket.connect() 를 또 부른다 —
//   이미 중계로 이어진 소켓이므로 그 호출만 무해화한다(라이브러리 패치 아님 · tls:true 경로만 중계를 탄다).
function imapSocketFor(socket) {
  socket.connect = function noop() { return this; };
  return socket;
}

/**
 * IMAP 연결(imap-simple) — 길을 정해 붙고 성공한 길을 기억한다.
 * imapConfig 는 기존 그대로, addresses 는 netGuard 결과. 돌려주는 값 { conn, route }.
 */
async function connectImap(account, imapConfigIn, { addresses: addrIn, authType } = {}) {
  const imaps = require('imap-simple');
  const { _pqAddresses, ...imapConfig } = imapConfigIn;   // buildImapConfig 가 실어 보낸 검사 주소
  const addresses = addrIn || _pqAddresses;
  const order = routeOrder(account, { port: imapConfig.port, tls: imapConfig.tls, authType: authType || (account && account.auth_type) });
  let lastErr;
  for (let i = 0; i < order.length; i += 1) {
    const route = order[i]; const hasNext = i < order.length - 1;
    let socket = null;
    try {
      let cfg = imapConfig;
      if (route === 'direct' && hasNext) cfg = { ...imapConfig, connTimeout: DIRECT_TIMEOUT_WITH_FALLBACK_MS };
      if (route === 'relay') {
        socket = await openRelaySocket({ addresses, port: imapConfig.port });
        const servername = net.isIP(imapConfig.host) ? undefined : imapConfig.host;
        cfg = { ...imapConfig, socket: imapSocketFor(socket), tlsOptions: { ...(imapConfig.tlsOptions || {}), rejectUnauthorized: true, servername } };
      }
      const conn = await imaps.connect({ imap: cfg });
      await rememberRoute(account, route);
      return { conn, route };
    } catch (e) {
      if (socket && !socket.destroyed) { try { socket.destroy(); } catch { /* */ } }
      lastErr = e;
      if (route === 'direct' && isUnreachable(e)) {
        noteDirectUnreachable(account);
        if (hasNext) continue;
      }
      if (route === 'relay' && isCertError(e)) { const ce = new Error('imap_cert_invalid'); ce.pqCode = 'cert'; throw ce; }
      throw e;
    }
  }
  throw lastErr;
}

/** 발송이 중계를 타는가 — 받기가 중계로 붙는 계정만(같은 서버가 해외를 막는다). */
function smtpViaRelay(account, port) {
  if (!account || !relayAllowed({ port, tls: account.smtp_tls !== false, authType: account.auth_type })) return false;
  return forceRelay() || account.connect_route === 'relay';
}

/** nodemailer `getSocket` — 중계 길일 때만 넘긴다. */
function smtpGetSocket(addresses) {
  return (options, callback) => {
    openRelaySocket({ addresses, port: options.port })
      .then((socket) => callback(null, { connection: socket }))
      .catch((e) => callback(e));
  };
}
/** 중계 길 SMTP 옵션(인증서 검증 + SNI) — 기존 옵션에 덧붙인다. */
function smtpRelayOptions(host, addresses) {
  return { getSocket: smtpGetSocket(addresses), tls: { rejectUnauthorized: true, servername: net.isIP(host) ? undefined : host } };
}

/**
 * 중계 계정이 하루가 지났으면 직접 TCP 만 다시 재 본다(IDLE 연결은 건드리지 않는다).
 * 직접이 붙으면 다음 연결부터 직접으로 — 상대가 허용해 주면 중계에서 빠진다.
 */
async function reprobeRelayAccounts(accounts) {
  if (!relayConfig() || forceRelay()) return;
  const { assertOutboundHostAllowed } = require('../utils/netGuard');
  for (const acc of accounts || []) {
    if (acc.connect_route !== 'relay') continue;
    const at = acc.connect_route_checked_at ? new Date(acc.connect_route_checked_at).getTime() : 0;
    if (Date.now() - at < REPROBE_EVERY_MS) continue;
    const port = Number(acc.imap_port) || 993;
    const g = await assertOutboundHostAllowed(acc.imap_host, port);
    let ok = false;
    if (g.ok) {
      const a = g.addresses.slice().sort((x, y) => (x.family === 4 ? 0 : 1) - (y.family === 4 ? 0 : 1))[0];
      ok = await new Promise((resolve) => {
        const s = net.connect({ host: a.address, port });
        const done = (v) => { try { s.destroy(); } catch { /* */ } resolve(v); };
        s.setTimeout(DIRECT_TIMEOUT_WITH_FALLBACK_MS, () => done(false));
        s.once('connect', () => done(true));
        s.once('error', () => done(false));
      });
    }
    try {
      const { sequelize } = require('../config/database');
      if (ok) {
        await sequelize.query("UPDATE email_accounts SET connect_route = 'direct', connect_route_checked_at = NOW() WHERE id = ? AND connect_route = 'relay'", { replacements: [acc.id] });
        console.log(`[mailRoute] account #${acc.id} 직접 연결이 다시 열렸다 → direct`);
      } else {
        await sequelize.query('UPDATE email_accounts SET connect_route_checked_at = NOW() WHERE id = ?', { replacements: [acc.id] });
      }
    } catch (e) { console.warn('[mailRoute] reprobe', e.message); }
  }
}

/** IDLE 재연결 지터 — 중계가 재시작되면 중계 계정이 한꺼번에 끊긴다(Fable 3). */
function reconnectJitterMs(account) {
  return account && account.connect_route === 'relay' ? Math.floor(Math.random() * 30000) : 0;
}

module.exports = {
  RELAY_PORTS, relayConfig, relayAllowed, forceRelay, isUnreachable, isCertError,
  routeOrder, rememberRoute, noteDirectUnreachable, openRelaySocket, connectImap,
  smtpRelayOptions, smtpViaRelay, reprobeRelayAccounts, reconnectJitterMs, reportRelayDown,
  DIRECT_TIMEOUT_WITH_FALLBACK_MS,
};
