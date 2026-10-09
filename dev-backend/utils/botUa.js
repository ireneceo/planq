// 공개 링크를 연 것이 사람인가 — 봇/메일 스캐너/프리페치를 «고객 열람» 으로 세지 않기 위한 판정 한 벌.
//   Gmail 이미지프록시·MS SafeLinks·기업 메일보안(Proofpoint/Mimecast 등)·크롤러·CLI 툴·헤드리스는 실 고객 아님.
//   UA 없음/비정상도 제외 (실 브라우저는 항상 UA 를 보냄).
//   (2026-10-09 invoices.js 에서 옮겼다 — 공개 문서(docs.js)도 같은 판정을 쓴다.)
'use strict';

const BOT_UA_RE = /bot|crawl|spider|slurp|preview|scan|fetch|monitor|validator|proxy|safelinks|proofpoint|mimecast|barracuda|symantec|forcepoint|headless|phantom|python-requests|curl|wget|go-http|okhttp|java\/|facebookexternalhit|whatsapp|telegram|slackbot|discord|twitterbot|linkedinbot|googleimageproxy|ggpht|feedfetcher|apache-httpclient|axios\//i;

function isBotOrScanner(req) {
  const ua = String(req.headers['user-agent'] || '').trim();
  if (!ua || ua.length < 15) return true;           // UA 없음/비정상 = 실 브라우저 아님 (CLI·스캐너)
  if (BOT_UA_RE.test(ua)) return true;              // 알려진 봇/스캐너/프리페치/메일보안
  return false;
}

module.exports = { isBotOrScanner, BOT_UA_RE };
