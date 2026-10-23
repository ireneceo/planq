// services/exportRender.js — 자료 내보내기 zip 의 문서 HTML·파일명 (routes/export.js 에서 나눔, 동작 그대로)
const path = require('path');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 문서 → 단독 열람 가능한 HTML 파일
// zip 안 문서 1건 → HTML.
//
// ★ 본문 렌더는 `services/pdfTemplates.js richBodyToHtml` 을 **재사용**한다. 옛 코드는
//   `body_html` 이 없으면 `<pre>${JSON.stringify(body_json)}</pre>` 로 **JSON 원문을 덤프**했다 —
//   Post(content_json = TipTap TEXT)로 넘어오면 zip 안 문서가 전부 JSON 덤프가 된다.
//   2026-08-07 포스트 PDF 파손과 같은 계열이라 그때 만든 렌더러를 그대로 쓴다.
// ★ 두 번째 인자에 `d.body_html` 을 **반드시 넘긴다** — processExport 의 Q Note 의사-doc 은
//   content_json 없이 body_html 만 갖는다. null 을 넘기면 Q Note 문서가 전부 빈 HTML 이 된다.
const PDF_ASSET_BASE = (process.env.PDF_ASSET_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3003}`).replace(/\/+$/, '');
const PUBLIC_ASSET_BASE = (process.env.APP_URL || 'https://dev.planq.kr').replace(/\/+$/, '');

function renderDocHtml(d) {
  const title = escapeHtml(d.title || 'Untitled');
  let body = require('../services/pdfTemplates').richBodyToHtml(d.content_json, d.body_html, d.content_text);
  // 이미지 절대화 base 교체 — 렌더러는 puppeteer(서버 자신)용 loopback 을 쓴다. 그대로 두면
  //   사용자가 자기 PC 에서 연 zip HTML 이 **자기 localhost** 를 찌르고 이미지가 전부 깨진다.
  if (body && PUBLIC_ASSET_BASE && PDF_ASSET_BASE !== PUBLIC_ASSET_BASE) {
    body = body.split(PDF_ASSET_BASE).join(PUBLIC_ASSET_BASE);
  }
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${title}</title>`
    + `<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;color:#0F172A;line-height:1.7}h1{font-size:24px;border-bottom:1px solid #E2E8F0;padding-bottom:12px}img{max-width:100%}</style>`
    + `</head><body><h1>${title}</h1>${body}</body></html>`;
}

// 안전한 파일명 + 동명 충돌 접미사
function uniqueName(map, name) {
  const seen = map.get(name) || 0;
  map.set(name, seen + 1);
  if (seen === 0) return name;
  const ext = path.extname(name);
  return `${name.slice(0, name.length - ext.length)} (${seen})${ext}`;
}

module.exports = { escapeHtml, renderDocHtml, uniqueName };
