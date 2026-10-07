// AI 에이전트 연동(#439) — 주소·scope·provider 허용목록의 **한 곳**.
//   설계 docs/AI_AGENT_INTEGRATION_DESIGN.md §4.
//
//   Resource(MCP)  = {APP_URL}/agent/mcp
//   Issuer(AS)     = {APP_URL}/agent         ← 엔드포인트는 전부 /agent/* 아래(최상위 /register 는 회원가입 화면이라 겹친다)
//   동의 화면       = {APP_URL}/connect/agent?request=<id>
const APP_URL = (process.env.APP_URL || 'https://dev.planq.kr').replace(/\/+$/, '');

const ISSUER = `${APP_URL}/agent`;
const RESOURCE = `${APP_URL}/agent/mcp`;
const CONSENT_URL = `${APP_URL}/connect/agent`;

// scope — 툴마다 필요한 scope 한 줄. 동의 화면은 «읽기만 / 읽기+쓰기» 두 묶음으로만 보여준다(설계 §4.4).
const READ_SCOPES = ['tasks:read', 'notes:read', 'clients:read', 'projects:read', 'schedule:read'];
// docs:write · files:write — 2026-10-05 추가(문서 쓰기·파일 올리기). 이미 연결된 앱의 grant 에는 없다 →
//   **다시 연결해야** 생긴다. 동의 화면 문구가 «업무·메모» 였던 grant 를 조용히 넓히지 않는다.
// projects:write — 2026-10-07 추가(create_project, Fable B 판정 2). 같은 이유로 이미 연결된 앱은 다시 연결해야 생긴다
//   (동의 화면 문구에 «프로젝트를 만든다» 가 들어갔다 — 옛 동의를 조용히 넓히지 않는다).
const WRITE_SCOPES = ['tasks:write', 'notes:write', 'schedule:write', 'docs:write', 'files:write', 'projects:write'];
// 별도 동의(opt-in) — 묶음(읽기만/읽기+쓰기)에 **들지 않는다**(설계 docs/AI_AGENT_M3_DESIGN.md §3.1).
//   동의 화면의 체크박스를 켰을 때만 붙는다. 묶음 밖이라 이미 받은 연결(grant)은 자동으로 넓어지지 않는다.
//   mail:read          — 메일 조회(M3-a). 워크스페이스 스위치 permissions.ai_agent.mail 이 꺼지면 호출 때 거절.
//   mail_drafts:write  — 답장 초안(M3-c). mail:read 없이는 붙지 않는다.
const OPT_IN_SCOPES = ['mail:read', 'mail_drafts:write'];
const BUNDLE_SCOPES = [...READ_SCOPES, ...WRITE_SCOPES];
// 디스커버리(scopes_supported)에 보여야 하므로 ALL 에는 넣는다 — 부여 판단은 grants.grantedScopes 가 묶음과 체크박스로 한다.
const ALL_SCOPES = [...BUNDLE_SCOPES, ...OPT_IN_SCOPES];

// provider adapter — **인증 모양과 메타만** 다르다. 툴·정책은 services/agent 레지스트리 한 벌.
//   redirectHosts 밖의 redirect_uri 는 등록(DCR)부터 거절한다 — 인가 코드를 남의 서버로 빼돌리는 문을 닫는다.
const PROVIDERS = {
  openai: { id: 'openai', label: 'ChatGPT', redirectHosts: ['chatgpt.com', 'chat.openai.com'] },
  anthropic: { id: 'anthropic', label: 'Claude', redirectHosts: ['claude.ai', 'claude.com'] },
  // Claude Code·로컬 개발 도구 — loopback 만(포트 무관). https 가 아니어도 되는 유일한 경우.
  local: { id: 'local', label: 'Local app', redirectHosts: ['localhost', '127.0.0.1'], loopback: true },
};

/** redirect_uri 가 어느 provider 의 것인지. 허용 밖이면 null. */
function providerForRedirect(uri) {
  let u;
  try { u = new URL(uri); } catch { return null; }
  for (const p of Object.values(PROVIDERS)) {
    if (!p.redirectHosts.includes(u.hostname)) continue;
    if (p.loopback) { if (u.protocol === 'http:' || u.protocol === 'https:') return p; continue; }
    if (u.protocol === 'https:') return p;
  }
  return null;
}

const ACCESS_TTL_SEC = 60 * 60;            // 1시간 — 매 호출 grant 를 다시 읽으므로 해제는 즉시 반영된다
const REFRESH_TTL_MS = 90 * 24 * 3600 * 1000;   // 90일 sliding
const AUTHREQ_TTL_MS = 10 * 60 * 1000;     // 동의 화면에서 머무를 수 있는 시간
const CODE_TTL_MS = 2 * 60 * 1000;         // 인가 코드
const CODE_MAX_ATTEMPTS = 5;

const enabled = () => String(process.env.AGENT_ENABLED || '0') === '1';
const writeEnabled = () => String(process.env.AGENT_WRITE_ENABLED || '0') === '1';

function tokenSecret() {
  const s = process.env.AGENT_TOKEN_SECRET;
  // 비밀이 없거나 브라우저 세션 비밀과 같으면 켜지 않는다 — 같은 값이면 에이전트 토큰이 세션 표면에 들어갈 수 있다.
  if (!s || s.length < 32 || s === process.env.JWT_SECRET) return null;
  return s;
}

module.exports = {
  APP_URL, ISSUER, RESOURCE, CONSENT_URL,
  READ_SCOPES, WRITE_SCOPES, OPT_IN_SCOPES, BUNDLE_SCOPES, ALL_SCOPES, PROVIDERS, providerForRedirect,
  ACCESS_TTL_SEC, REFRESH_TTL_MS, AUTHREQ_TTL_MS, CODE_TTL_MS, CODE_MAX_ATTEMPTS,
  enabled, writeEnabled, tokenSecret,
};
