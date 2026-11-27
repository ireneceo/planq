// 문서 PDF 조립 — routes/posts.js 에서 옮겼다(2026-11-27, 동작 그대로). 멤버 PDF · 공개 서명 PDF · 서명 완료 «파일로 저장» 이 같이 쓴다.
// 서명본 — **고정본 + 서명**. 서명 요청이 하나라도 있으면 PDF 는 서명본으로 나간다.
//   재료를 모으는 곳은 services/signedDocument.loadSignedView **한 곳**이다.
async function postSignedView(post, req) {
  const sd = require('../services/signedDocument');
  const view = await sd.loadSignedView('post', post.id);
  if (!view.total) return { view: null, doc: post, labels: null };
  const doc = view.frozen
    ? {
      ...post.toJSON(),
      title: view.frozen.title || post.title,
      content_json: view.frozen.content_json,
      content_html: null, content_text: null,
    }
    : post;
  return { view, doc, labels: sd.labelsFor(req) };
}

// @param {boolean} withCert  증명서 장(이메일·IP 포함) — 멤버 PDF 만 true. 공개 링크 PDF 는 false.
async function buildPostPdf(post, req, withCert) {
  let author = post.author ? { id: post.author.id, name: post.author.name } : null;
  // 워크스페이스 표시명 우선 (PDF 작성자도 닉네임)
  if (author?.id) {
    const { getMemberDisplayName } = require('../services/displayName');
    const d = await getMemberDisplayName(post.business_id, author.id, author.name);
    if (d.name) author.name = d.name;
  }
  const business = await require('../models').Business.findByPk(post.business_id, {
    attributes: ['name', 'brand_name', 'legal_name'],
  });
  const { postPdfHtml } = require('../services/pdfTemplates');
  const { renderPdfFromHtml } = require('../services/pdfService');
  const { view, doc, labels } = await postSignedView(post, req);
  const html = postPdfHtml(doc, author, business?.toJSON() || {},
    view ? { requests: view.requests, labels, cert: !!withCert } : null);
  return renderPdfFromHtml(html);
}

module.exports = { postSignedView, buildPostPdf };
