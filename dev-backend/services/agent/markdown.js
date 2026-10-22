// services/agent/markdown.js — AI 가 보낸 마크다운(일부)을 Q docs 본문(TipTap JSON)으로 바꾼다 (2026-10-05)
//
// ChatGPT·Claude 는 문서를 마크다운으로 쓴다. Q docs 편집기는 TipTap JSON 을 저장한다.
// 지원: 제목(# ~ ###) · 글머리(-, *) · 번호(1.) · 인용(>) · 구분선(---) · 코드 블록(```) · 굵게(**) · 기울임(*·_) ·
//       링크([글](주소) — http(s)·mailto 만) · 빈 줄 = 문단 구분. 그 밖의 문법은 **글자 그대로** 남긴다(지우지 않는다).
// ★ HTML 은 해석하지 않는다 — `<script>` 같은 것은 글자 그대로 텍스트 노드가 된다(편집기·렌더러가 이스케이프한다).
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

function inline(text) {
  const out = [];
  // 링크 → 굵게 → 기울임 순으로 토막 낸다. 겹친 문법은 바깥 하나만 인식한다(과설계 금지).
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*]*)\*(?!\w)|(?<![\w_])_([^_\s][^_]*)_(?!\w)/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) {
      const href = m[2];
      out.push(SAFE_HREF.test(href) ? { type: 'text', text: m[1], marks: [{ type: 'link', attrs: { href } }] } : { type: 'text', text: m[0] });
    } else if (m[3] !== undefined) out.push({ type: 'text', text: m[3], marks: [{ type: 'bold' }] });
    else out.push({ type: 'text', text: m[4] !== undefined ? m[4] : m[5], marks: [{ type: 'italic' }] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out.filter((n) => n.text !== '');
}

const para = (t) => ({ type: 'paragraph', content: inline(t) });

/** @returns {{type:'doc', content:object[]}} */
function markdownToDoc(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const content = [];
  let buf = [];          // 문단 줄
  let list = null;       // { type, items }
  let code = null;       // 코드 블록 줄
  const flushPara = () => { if (buf.length) { content.push(para(buf.join(' ').trim())); buf = []; } };
  const flushList = () => { if (list) { content.push({ type: list.type, content: list.items.map((t) => ({ type: 'listItem', content: [para(t)] })) }); list = null; } };
  for (const raw of lines) {
    if (code) {
      if (/^```/.test(raw.trim())) { content.push({ type: 'codeBlock', content: code.length ? [{ type: 'text', text: code.join('\n') }] : [] }); code = null; } else code.push(raw);
      continue;
    }
    const line = raw.trimEnd();
    const t = line.trim();
    if (/^```/.test(t)) { flushPara(); flushList(); code = []; continue; }
    if (!t) { flushPara(); flushList(); continue; }
    let m;
    if ((m = t.match(/^(#{1,3})\s+(.*)$/))) { flushPara(); flushList(); content.push({ type: 'heading', attrs: { level: m[1].length }, content: inline(m[2]) }); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flushPara(); flushList(); content.push({ type: 'horizontalRule' }); continue; }
    if ((m = t.match(/^>\s?(.*)$/))) { flushPara(); flushList(); content.push({ type: 'blockquote', content: [para(m[1])] }); continue; }
    if ((m = t.match(/^[-*+]\s+(.*)$/))) { flushPara(); if (!list || list.type !== 'bulletList') { flushList(); list = { type: 'bulletList', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = t.match(/^\d+[.)]\s+(.*)$/))) { flushPara(); if (!list || list.type !== 'orderedList') { flushList(); list = { type: 'orderedList', items: [] }; } list.items.push(m[1]); continue; }
    flushList();
    buf.push(t);
  }
  if (code) content.push({ type: 'codeBlock', content: code.length ? [{ type: 'text', text: code.join('\n') }] : [] });
  flushPara(); flushList();
  // 빈 문단 노드(content: [])는 편집기가 허용한다. 완전히 비면 빈 문단 하나.
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

// ── 업무 설명·결과물용 HTML (2026-10-22 Fable 설계 — docs/AGENT_TASK_BODY_DESIGN.md) ──────────
//   업무 칸은 TipTap HTML 을 저장한다. 같은 markdownToDoc 결과를 HTML 로 내린다 — 글자는 전부 이스케이프하고,
//   태그는 아래 표에 있는 것만 우리가 만든다(AI 가 보낸 원시 HTML 은 해석하지 않는다).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function textToHtml(n) {
  let out = esc(n.text || '');
  for (const m of n.marks || []) {
    if (m.type === 'bold') out = `<strong>${out}</strong>`;
    else if (m.type === 'italic') out = `<em>${out}</em>`;
    else if (m.type === 'link' && SAFE_HREF.test(m.attrs?.href || '')) out = `<a href="${esc(m.attrs.href)}">${out}</a>`;
  }
  return out;
}
const inlineHtml = (nodes) => (nodes || []).map(textToHtml).join('');

function nodeToHtml(n) {
  switch (n.type) {
    case 'paragraph': return `<p>${inlineHtml(n.content)}</p>`;
    case 'heading': { const l = Math.min(3, Math.max(1, Number(n.attrs?.level) || 1)); return `<h${l}>${inlineHtml(n.content)}</h${l}>`; }
    case 'bulletList': return `<ul>${(n.content || []).map(nodeToHtml).join('')}</ul>`;
    case 'orderedList': return `<ol>${(n.content || []).map(nodeToHtml).join('')}</ol>`;
    case 'listItem': return `<li>${(n.content || []).map(nodeToHtml).join('')}</li>`;
    case 'blockquote': return `<blockquote>${(n.content || []).map(nodeToHtml).join('')}</blockquote>`;
    case 'horizontalRule': return '<hr>';
    case 'codeBlock': return `<pre><code>${esc((n.content || []).map((c) => c.text || '').join(''))}</code></pre>`;
    default: return '';
  }
}

/** @returns {string} TipTap 이 읽는 HTML */
function docToHtml(doc) { return (doc?.content || []).map(nodeToHtml).join(''); }
function markdownToHtml(md) { return docToHtml(markdownToDoc(md)); }

/** 옛 평문 칸을 HTML 로 — 화면 sanitizeHtml.plainTextToHtml 과 같은 규칙(이미 HTML 이면 그대로). 덧붙이기 전에 쓴다. */
function plainToHtml(value) {
  if (!value) return '';
  if (/<[a-z][\s\S]*>/i.test(value)) return value;
  const e = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return e.split(/\n{2,}/).map((para) => `<p>${para.replace(/\n/g, '<br/>')}</p>`).join('');
}

module.exports = { markdownToDoc, docToHtml, markdownToHtml, plainToHtml };
