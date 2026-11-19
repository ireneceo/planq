// mailEgress — 메일 서버가 «PlanQ 서버 접속» 을 막을 때 고객이 관리자에게 알려 줄 우리 출구 IP (2026-11-19).
// 설계 docs/MAIL_ALLOWLIST_REQUEST_DESIGN.md (Fable decision BUILD-NOW a·f).
//
// ★ 값은 여기 한 곳. 화면에 IP 를 적지 않는다(서버를 옮기면 화면이 거짓이 된다).
//   - `.env MAIL_EGRESS_IPS=1.2.3.4,5.6.7.8` 이 있으면 그것.
//   - 없으면 운영(NODE_ENV=production)만 운영 서버 출구 IP — 2026-11-19 운영에서 바깥으로 실측(IPv4 87.106.78.146, IPv6 출구 없음).
//   - 그 밖(개발 등)에서 값이 없으면 빈 목록 → 화면은 요청서를 내지 않고 종전 안내만.
//   중계(한국 VM) IP 는 넣지 않는다 — 한국 IP 라 허용 요청이 필요 없고 공격 표적만 된다(Fable).
const net = require('net');

const PROD_DEFAULT = ['87.106.78.146'];

function egressIps() {
  const raw = process.env.MAIL_EGRESS_IPS;
  if (raw && raw.trim()) {
    return raw.split(',').map(s => s.trim()).filter(s => net.isIP(s));
  }
  return process.env.NODE_ENV === 'production' ? PROD_DEFAULT.slice() : [];
}

module.exports = { egressIps };
