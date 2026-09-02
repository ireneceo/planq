// utils/netGuard.js — 사용자가 지정한 호스트로 나가는 연결의 **목적지 검사**.
//
// ★ 왜 필요한가 — IMAP/SMTP 호스트는 사용자가 자유롭게 적는 값이고, 그대로 연결하면
//   서버가 **내부망 포트 스캐너**가 된다. 예외 메시지(ECONNREFUSED / timeout / TLS 실패)가
//   그대로 응답에 실리면 그것이 곧 오라클이다. 게다가 OAuth 계정은 발송 시점에
//   **살아 있는 Google access token 을 그 호스트로 보낸다**(xoauth2).
//   (2026-09-02 보안감사 H-5. `middleware/security.js` 의 ssrfProtection 은 `url`·`callback` 같은
//    **키 이름 5개**만 훑어서 `imap_host`/`smtp_host` 에는 애초에 닿지 않았다.)
//
// ★ 문자열 매칭이 아니라 **DNS 해석 결과의 IP** 를 본다 — `127.0.0.2`·`[::1]`·`localhost.`·
//   `metadata.google.internal` 처럼 리터럴 검사를 빗나가는 이름들이 실제로 통과했다.
//
// ★ IP 판정을 손으로 쓰지 않는다 — 처음엔 정규식으로 짰다가 **`::ffff:7f00:1`(IPv4 매핑의
//   16진 표기)이 통과**했다(Fable 실측: 그 주소로 실제 루프백 연결이 일어났다).
//   `::ffff:` + 점 표기만 알던 정규식의 한계다. 주소 체계는 `ipaddr.js` 가 안다 —
//   매핑 주소를 v4 로 환원하고, NAT64/6to4/Teredo 처럼 **v4 를 품은 v6** 도 꺼내서 다시 본다.
const dnsp = require('dns').promises;
const net = require('net');
const ipaddr = require('ipaddr.js');   // express 의존성 — 이미 설치돼 있다

// 메일 프로토콜 표준 포트만. 임의 포트는 곧 포트 스캔이다.
const MAIL_PORTS = new Set([25, 143, 465, 587, 993, 995, 2525]);

// 공인 유니캐스트만 허용한다(화이트리스트) — 새 특수 대역이 생겨도 자동으로 막힌다.
const V4_ALLOWED_RANGE = 'unicast';

function ipBlocked(raw) {
  let addr;
  try {
    addr = ipaddr.process(String(raw).replace(/^\[|\]$/g, ''));   // 매핑 주소는 v4 로 환원된다
  } catch {
    return true;   // 파싱 불가 = 차단 (모르면 닫는다)
  }
  if (addr.kind() === 'ipv4') {
    if (addr.range() !== V4_ALLOWED_RANGE) return true;
    // 198.18.0.0/15 (RFC 2544 벤치마크) — ipaddr 이 unicast 로 본다
    try { if (addr.match(ipaddr.parse('198.18.0.0'), 15)) return true; } catch { /* noop */ }
    return false;
  }

  // v6 는 `range()` 하나로 충분하다 — 루프백·ULA·링크로컬은 물론
  //   **v4 를 품은 형식(NAT64 rfc6052 · 6to4 · Teredo · rfc6145)도 unicast 가 아니다.**
  //   ★ 처음엔 여기서 "끝 32비트를 v4 로 꺼내 다시 검사" 하는 블록을 넣었다가
  //     **정상 주소를 막았다** — 일반 IPv6 의 끝 32비트는 v4 로 읽으면 아무 값이나 되기 때문이다
  //     (imap.gmail.com 이 차단됐다). 차단은 넓히면 되는 게 아니라 **맞아야** 한다.
  if (addr.range() !== 'unicast') return true;

  // ipaddr 이 unicast 로 분류하지만 **공인 트래픽이 아닌** 대역 — 명시적으로 막는다.
  //   fec0::/10 폐기된 site-local · 198.18.0.0/15 벤치마크 · 64:ff9b:1::/48 로컬 NAT64(RFC 8215)
  const EXTRA_BLOCKED_V6 = [['fec0::', 10], ['64:ff9b:1::', 48]];
  for (const [net6, bits] of EXTRA_BLOCKED_V6) {
    try { if (addr.match(ipaddr.parse(net6), bits)) return true; } catch { /* 표기 차이는 무시 */ }
  }

  // 딱 하나 예외 — **IPv4-호환 주소**(`::x.x.x.x`, 폐기된 형식)는 앞 96비트가 0 이라
  //   ipaddr 이 unicast 로 본다. 그런데 `::7f00:1` 은 실제로 127.0.0.1 이다(실측 통과했다).
  //   앞 96비트가 0 인 경우에**만** 끝 32비트를 v4 로 읽어 다시 판정한다 — 범위를 좁게 잡는다.
  const b = addr.toByteArray();
  const first96Zero = b.slice(0, 12).every((x) => x === 0);
  if (first96Zero) {
    const tail = b.slice(12, 16);
    if (!tail.every((x) => x === 0)) {
      return new ipaddr.IPv4(tail).range() !== V4_ALLOWED_RANGE;
    }
  }
  return false;
}

// { ok: true } | { ok: false, code: '...' }
async function assertOutboundHostAllowed(host, port, { ports = MAIL_PORTS } = {}) {
  const h = String(host || '').trim().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!h || h.length > 253) return { ok: false, code: 'invalid_host' };
  if (!/^[A-Za-z0-9._:-]+$/.test(h)) return { ok: false, code: 'invalid_host' };
  const p = Number(port);
  if (!ports.has(p)) return { ok: false, code: 'port_not_allowed' };

  // 리터럴 IP 면 그대로, 이름이면 A/AAAA 전부 검사 (하나라도 내부면 차단 — 라운드로빈 우회 차단)
  if (net.isIP(h)) return ipBlocked(h) ? { ok: false, code: 'host_not_allowed' } : { ok: true };
  let addrs;
  try {
    addrs = await dnsp.lookup(h, { all: true });
  } catch {
    return { ok: false, code: 'host_unresolved' };
  }
  if (!addrs.length) return { ok: false, code: 'host_unresolved' };
  if (addrs.some((a) => ipBlocked(a.address))) return { ok: false, code: 'host_not_allowed' };
  return { ok: true };
}

module.exports = { assertOutboundHostAllowed, ipBlocked, MAIL_PORTS };
