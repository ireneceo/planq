// services/agent/taskMarkdown.js — 업무 설명·결과물의 Markdown ⇄ HTML 왕복 (2026-10-27 Fable 설계 GO-WITH-CHANGES)
//
// 왜: get_task 는 저장된 TipTap HTML 을 그대로 줬고 update_task 는 Markdown 으로 받았다. AI 가 받은 HTML 을 고쳐 돌려보내면
//   태그가 글자로 저장됐다(운영 K-DINE 업무 6건). 이제 조회도 Markdown — **이 파일이 내놓는 문법 = 이 파일이 읽는 문법**이다.
//   한쪽만 늘리면 같은 사고가 다시 난다(Fable). 그래서 두 방향이 같은 문서 모형(TipTap JSON 모양)을 거친다.
// 지원: 제목(#~###) · 문단(줄바꿈 = <br>) · 글머리/번호/체크리스트(들여쓰기 = 중첩) · 인용(여러 줄·중첩) · 구분선 · 코드 블록(```언어) ·
//       굵게 ** · 기울임 _ (읽을 때는 * 도) · 취소선 ~~ · 인라인 코드 ` · 링크(http(s)·mailto) · 이미지(우리 업로드 주소만, 한 줄 단독) · 백슬래시 이스케이프.
// Markdown 으로 못 옮기는 것(표·밑줄·형광·정렬·안전하지 않은 링크/이미지·알 수 없는 태그)은 글자만 옮기고 lossy 로 표시한다 —
//   lossy 인 칸은 교체를 거절한다(AI 가 못 본 서식을 지우지 않게). 원시 HTML 입력은 해석하지 않는다(looksLikeHtml 로 거절).
const { parseDocument } = require('htmlparser2');

// 링크 — 바깥 http(s)·mailto + 앱 안 상대 주소(/payroll/runs/16 처럼 PlanQ 가 만든 것). javascript: 등은 링크가 되지 않는다
const SAFE_HREF = /^((https?:\/\/|mailto:)|\/(?!\/))[^\s()<>]*$/i;
// 업무 설명 편집기가 올린 그림 주소(task_attachments preview_url · files previewUrlForFile) — 그 밖의 주소는 이미지로 만들지 않는다
const SAFE_IMG = /^\/api\/(tasks\/public\/attach|files\/public-image)\/[A-Za-z0-9._-]+$/;
const ESCAPABLE = '\\`*_[]()#+-.!>~|<';

// ───────────────────────── Markdown → 문서 모형 ─────────────────────────
const text = (t, marks) => ({ type: 'text', text: t, marks: marks.slice() });
const isWord = (ch) => !!ch && /[A-Za-z0-9]/.test(ch);

/** 닫는 구분자 위치 — 이스케이프·인라인 코드는 건너뛴다. 없으면 -1 */
function findClose(s, delim, from) {
  for (let k = from; k < s.length; k += 1) {
    if (s[k] === '\\') { k += 1; continue; }
    if (s[k] === '`') { const e = s.indexOf('`', k + 1); if (e > k) { k = e; continue; } }
    if (s.startsWith(delim, k)) {
      if (delim.length === 1 && s[k + 1] === delim) { k += 1; continue; }   // ** 안의 * 는 닫는 표시가 아니다
      return k;
    }
  }
  return -1;
}

function inline(s, marks = []) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push(text(buf, marks)); buf = ''; } };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
    if (c === '\n') { flush(); out.push({ type: 'hardBreak' }); i += 1; continue; }
    if (c === '`') {
      const e = s.indexOf('`', i + 1);
      if (e > i + 1) { flush(); out.push(text(s.slice(i + 1, e), [...marks, { type: 'code' }])); i = e + 1; continue; }
    }
    if (c === '[') {
      const close = findClose(s, ']', i + 1);
      if (close > i + 1 && s[close + 1] === '(') {
        const end = s.indexOf(')', close + 2);
        const href = end > 0 ? s.slice(close + 2, end) : '';
        if (end > 0 && SAFE_HREF.test(href)) {
          flush(); out.push(...inline(s.slice(i + 1, close), [...marks, { type: 'link', attrs: { href } }])); i = end + 1; continue;
        }
      }
    }
    if (s.startsWith('**', i) || s.startsWith('~~', i)) {
      const d = s.slice(i, i + 2);
      const e = findClose(s, d, i + 2);
      if (e > i + 2) { flush(); out.push(...inline(s.slice(i + 2, e), [...marks, { type: d === '**' ? 'bold' : 'strike' }])); i = e + 2; continue; }
    }
    if ((c === '_' || c === '*') && !/\s/.test(s[i + 1] || ' ') && !(c === '_' && isWord(s[i - 1]))) {
      const e = findClose(s, c, i + 1);
      if (e > i + 1 && !/\s/.test(s[e - 1]) && !(c === '_' && isWord(s[e + 1]))) {
        flush(); out.push(...inline(s.slice(i + 1, e), [...marks, { type: 'italic' }])); i = e + 1; continue;
      }
    }
    buf += c; i += 1;
  }
  flush();
  return out;
}

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/;
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const IMG_RE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"width=([^"]+)")?\)$/;
const indentOf = (l) => l.match(/^ */)[0].length;
const startsBlock = (t) => /^#{1,3}\s/.test(t) || /^>/.test(t) || /^```/.test(t) || HR_RE.test(t) || LIST_RE.test(t) || IMG_RE.test(t);

function parseBlocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) { i += 1; continue; }
    let m;
    if ((m = t.match(/^```\s*([\w+#-]*)\s*$/))) {
      const code = []; i += 1;
      while (i < lines.length && lines[i].trim() !== '```') { code.push(lines[i]); i += 1; }
      i += 1;
      while (code.length && !code[code.length - 1].trim()) code.pop();   // 끝의 빈 줄은 화면에 안 보인다(왕복 고정점)
      out.push({ type: 'codeBlock', attrs: { language: m[1] || null }, content: code.length ? [text(code.join('\n'), [])] : [] });
      continue;
    }
    if ((m = t.match(/^(#{1,3})\s+(.*)$/))) { out.push({ type: 'heading', attrs: { level: m[1].length }, content: inline(m[2]) }); i += 1; continue; }
    if (HR_RE.test(t)) { out.push({ type: 'horizontalRule' }); i += 1; continue; }
    if ((m = t.match(IMG_RE)) && SAFE_IMG.test(m[2])) {
      out.push({ type: 'image', attrs: { src: m[2], alt: m[1] || null, width: m[3] || null } }); i += 1; continue;
    }
    if (/^>/.test(t)) {
      const inner = [];
      while (i < lines.length && /^>/.test(lines[i].trim())) { inner.push(lines[i].trim().replace(/^>\s?/, '')); i += 1; }
      out.push({ type: 'blockquote', content: parseBlocks(inner) });
      continue;
    }
    if ((m = raw.match(LIST_RE)) && !HR_RE.test(t)) {
      const baseIndent = m[1].length;
      let list = null;
      while (i < lines.length) {
        const lm = lines[i].match(LIST_RE);
        if (!lm || lm[1].length !== baseIndent || HR_RE.test(lines[i].trim())) break;
        const ordered = /\d/.test(lm[2]);
        let first = lm[3] || '';
        let task = null;
        const tm = !ordered && first.match(/^\[( |x|X)\](?:\s+(.*))?$/);
        if (tm) { task = tm[1] !== ' '; first = tm[2] || ''; }
        const type = ordered ? 'orderedList' : task !== null ? 'taskList' : 'bulletList';
        if (!list || list.type !== type) {
          if (list) out.push(list);
          list = { type, content: [] };
          if (ordered) list.attrs = { start: parseInt(lm[2], 10) };
        }
        const c = baseIndent + lm[2].length + 1;
        const child = [first];
        let j = i + 1;
        while (j < lines.length) {
          const l = lines[j];
          if (!l.trim()) {
            let k = j + 1; while (k < lines.length && !lines[k].trim()) k += 1;
            if (k < lines.length && indentOf(lines[k]) >= c) { for (; j < k; j += 1) child.push(''); continue; }
            break;
          }
          if (indentOf(l) >= c) { child.push(l.slice(c)); j += 1; continue; }
          break;
        }
        const content = parseBlocks(child);
        if (!content.length || content[0].type !== 'paragraph') content.unshift({ type: 'paragraph', content: [] });
        list.content.push(task !== null ? { type: 'taskItem', attrs: { checked: task }, content } : { type: 'listItem', content });
        i = j;
      }
      if (list) out.push(list);
      continue;
    }
    const buf = [t];
    i += 1;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i].trim())) { buf.push(lines[i].trim()); i += 1; }
    out.push({ type: 'paragraph', content: inline(buf.join('\n')) });
  }
  return out;
}

function markdownToModel(md) {
  return parseBlocks(String(md || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'));
}

// ───────────────────────── 문서 모형 → HTML ─────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MARK_HTML = { bold: ['<strong>', '</strong>'], italic: ['<em>', '</em>'], strike: ['<s>', '</s>'], code: ['<code>', '</code>'] };

function inlineHtml(nodes) {
  return (nodes || []).map((n) => {
    if (n.type === 'hardBreak') return '<br>';
    let s = esc(n.text || '');
    for (const m of [...(n.marks || [])].reverse()) {
      if (m.type === 'link') s = `<a href="${esc(m.attrs.href)}">${s}</a>`;
      else if (MARK_HTML[m.type]) s = MARK_HTML[m.type][0] + s + MARK_HTML[m.type][1];
    }
    return s;
  }).join('');
}

function blockHtml(n) {
  const kids = () => (n.content || []).map(blockHtml).join('');
  switch (n.type) {
    case 'paragraph': return `<p>${inlineHtml(n.content)}</p>`;
    case 'heading': return `<h${n.attrs.level}>${inlineHtml(n.content)}</h${n.attrs.level}>`;
    case 'bulletList': return `<ul>${kids()}</ul>`;
    case 'orderedList': return `<ol${n.attrs?.start && n.attrs.start !== 1 ? ` start="${n.attrs.start}"` : ''}>${kids()}</ol>`;
    case 'listItem': return `<li>${kids()}</li>`;
    case 'taskList': return `<ul data-type="taskList">${kids()}</ul>`;
    case 'taskItem': return `<li data-type="taskItem" data-checked="${n.attrs.checked ? 'true' : 'false'}"><label><input type="checkbox"${n.attrs.checked ? ' checked="checked"' : ''}><span></span></label><div>${kids()}</div></li>`;
    case 'blockquote': return `<blockquote>${kids()}</blockquote>`;
    case 'horizontalRule': return '<hr>';
    case 'codeBlock': return `<pre><code${n.attrs?.language ? ` class="language-${esc(n.attrs.language)}"` : ''}>${esc((n.content || []).map((c) => c.text).join(''))}</code></pre>`;
    case 'image': return `<img src="${esc(n.attrs.src)}"${n.attrs.alt ? ` alt="${esc(n.attrs.alt)}"` : ''}${n.attrs.width ? ` width="${esc(n.attrs.width)}"` : ''}>`;
    default: return '';
  }
}

/** AI 가 보낸 Markdown → 업무 칸 HTML. 빈 내용이면 '' (호출부가 null 로 저장한다). */
function toHtml(md) { return markdownToModel(md).map(blockHtml).join(''); }

// ───────────────────────── HTML → 문서 모형 ─────────────────────────
function htmlToModel(html) {
  const lossy = new Set();
  const doc = parseDocument(String(html || ''), { decodeEntities: true });
  const tag = (el) => (el.name || '').toLowerCase();
  const kids = (el) => el.children || [];
  const styled = (el) => { if (el.attribs?.style && /\S/.test(el.attribs.style)) lossy.add('style'); };

  function inl(nodes, marks) {
    const out = [];
    for (const n of nodes) {
      if (n.type === 'text') { const t = n.data.replace(/[ \t\r\n]+/g, ' '); if (t) out.push(text(t, marks)); continue; }
      if (n.type !== 'tag') continue;
      const name = tag(n);
      styled(n);
      if (name === 'br') { out.push({ type: 'hardBreak' }); continue; }
      const mark = { strong: 'bold', b: 'bold', em: 'italic', i: 'italic', s: 'strike', del: 'strike', strike: 'strike', code: 'code' }[name];
      if (mark) { out.push(...inl(kids(n), [...marks, { type: mark }])); continue; }
      if (name === 'a') {
        const href = n.attribs?.href || '';
        if (SAFE_HREF.test(href)) out.push(...inl(kids(n), [...marks, { type: 'link', attrs: { href } }]));
        else { lossy.add('link'); out.push(...inl(kids(n), marks)); }
        continue;
      }
      if (name === 'span') { out.push(...inl(kids(n), marks)); continue; }
      lossy.add(name === 'u' ? 'underline' : name === 'mark' ? 'highlight' : name === 'img' ? 'image' : `tag:${name}`);
      out.push(...inl(kids(n), marks));
    }
    return out;
  }

  const textOf = (n) => (n.type === 'text' ? n.data : kids(n).map(textOf).join(''));

  function blocks(nodes) {
    const out = [];
    let loose = [];   // 블록 밖 인라인(옛 HTML·평문 조각) → 문단 하나
    const flush = () => { const c = inl(loose, []); loose = []; if (c.some((x) => x.type !== 'text' || x.text.trim())) out.push({ type: 'paragraph', content: c }); };
    for (const n of nodes) {
      if (n.type !== 'tag') { if (n.type === 'text') loose.push(n); continue; }
      const name = tag(n);
      const blockish = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'pre', 'hr', 'img', 'div', 'table', 'section', 'article'].includes(name);
      if (!blockish) { loose.push(n); continue; }
      flush();
      styled(n);
      if (name === 'p') out.push({ type: 'paragraph', content: inl(kids(n), []) });
      else if (/^h[1-6]$/.test(name)) {
        const level = Number(name[1]);
        if (level > 3) lossy.add('heading_level');
        out.push({ type: 'heading', attrs: { level: Math.min(3, level) }, content: inl(kids(n), []) });
      } else if (name === 'ul' && n.attribs?.['data-type'] === 'taskList') {
        out.push({ type: 'taskList', content: kids(n).filter((li) => tag(li) === 'li').map((li) => {
          const body = kids(li).find((x) => tag(x) === 'div');
          return { type: 'taskItem', attrs: { checked: li.attribs?.['data-checked'] === 'true' }, content: blocks(body ? kids(body) : kids(li).filter((x) => tag(x) !== 'label')) };
        }) });
      } else if (name === 'ul' || name === 'ol') {
        const list = { type: name === 'ul' ? 'bulletList' : 'orderedList', content: kids(n).filter((li) => tag(li) === 'li').map((li) => ({ type: 'listItem', content: blocks(kids(li)) })) };
        if (name === 'ol') list.attrs = { start: parseInt(n.attribs?.start, 10) || 1 };
        out.push(list);
      } else if (name === 'blockquote') out.push({ type: 'blockquote', content: blocks(kids(n)) });
      else if (name === 'pre') {
        const code = kids(n).find((x) => tag(x) === 'code');
        const lang = ((code?.attribs?.class || '').match(/language-([\w+#-]+)/) || [])[1] || null;
        out.push({ type: 'codeBlock', attrs: { language: lang }, content: [text(textOf(code || n).replace(/\s+$/, ''), [])] });
      } else if (name === 'hr') out.push({ type: 'horizontalRule' });
      else if (name === 'img') {
        const src = n.attribs?.src || '';
        if (SAFE_IMG.test(src)) out.push({ type: 'image', attrs: { src, alt: n.attribs?.alt || null, width: n.attribs?.width || null } });
        else lossy.add('image');
      } else if (name === 'table') {
        // 표는 Markdown 으로 옮기지 않는다 — 읽을 수 있게 행마다 « | » 로 이은 문단만 남기고 lossy
        lossy.add('table');
        const rows = [];
        (function walk(x) { for (const c of kids(x)) { if (tag(c) === 'tr') rows.push(c); else if (c.type === 'tag') walk(c); } })(n);
        for (const r of rows) out.push({ type: 'paragraph', content: [text(kids(r).filter((c) => c.type === 'tag').map((c) => textOf(c).replace(/\s+/g, ' ').trim()).join(' | '), [])] });
      } else out.push(...blocks(kids(n)));   // div 등 감싸개는 벗긴다
    }
    flush();
    return out;
  }
  return { model: blocks(kids(doc)), lossy: [...lossy] };
}

// ───────────────────────── 문서 모형 → Markdown ─────────────────────────
const ORDER = ['link', 'bold', 'strike', 'italic', 'code'];
const sameMark = (a, b) => a.type === b.type && (a.type !== 'link' || a.attrs.href === b.attrs.href);
const escText = (s) => s.replace(/[\\`*_[\]]/g, '\\$&').replace(/~~/g, '\\~~').replace(/<(?=[A-Za-z/!])/g, '\\<');

function mdInline(nodes, lossy, outer = 0) {
  let out = '';
  let i = 0;
  while (i < nodes.length) {
    const n = nodes[i];
    if (n.type === 'hardBreak') { out += '\n'; i += 1; continue; }
    const top = ORDER.slice(outer).map((t) => (n.marks || []).find((m) => m.type === t)).find(Boolean);
    if (!top) { out += escText(n.text); i += 1; continue; }
    let j = i;
    while (j < nodes.length && nodes[j].type !== 'hardBreak' && (nodes[j].marks || []).some((m) => sameMark(m, top))) j += 1;
    const run = nodes.slice(i, j).map((x) => ({ ...x, marks: x.marks.filter((m) => !sameMark(m, top)) }));
    const level = ORDER.indexOf(top.type) + 1;
    if (top.type === 'code') {
      const raw = run.map((x) => x.text).join('');
      if (raw.includes('`') || !raw) lossy.add('code');
      out += `\`${raw}\``;
    } else {
      // 구분자 안쪽 끝에 공백이 있으면 읽을 때 강조가 안 된다 — 공백은 밖으로 뺀다
      const inner = mdInline(run, lossy, level);
      const lead = inner.match(/^\s*/)[0]; const trail = inner.slice(lead.length).match(/\s*$/)[0];
      const core = inner.slice(lead.length, inner.length - trail.length);
      if (!core) { out += inner; i = j; continue; }
      if (top.type === 'link') out += `${lead}[${core}](${top.attrs.href})${trail}`;
      else {
        const d = { bold: '**', strike: '~~', italic: '_' }[top.type];
        if (top.type === 'italic' && (isWord(out.slice(-1)) || isWord(nodes[j]?.text?.[0]))) lossy.add('italic_in_word');
        out += `${lead}${d}${core}${d}${trail}`;
      }
    }
    i = j;
  }
  return out;
}

// 줄 첫머리가 블록 문법으로 읽히지 않게(문단·제목 글자 안의 «- », «1. », «# », «> » 등)
function escLineStart(line) {
  if (/^(#{1,6}\s|#{1,6}$|>|[-+]\s|[-+]$|```|!\[)/.test(line) || HR_RE.test(line)) return `\\${line}`;
  return line.replace(/^(\d{1,9})([.)])(\s|$)/, '$1\\$2$3');
}
// 화면에서 겹친 공백은 한 칸으로 보인다 — 인라인 코드 밖만 한 칸으로(왕복 고정점)
const squeeze = (l) => l.split(/(`[^`]*`)/).map((seg, k) => (k % 2 ? seg : seg.replace(/ {2,}/g, ' '))).join('');
const cleanLines = (s) => s.split('\n').map((l) => escLineStart(squeeze(l).trim())).join('\n');
const indent = (s, n) => s.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

function mdBlock(n, lossy) {
  const kids = (sep = '\n\n') => (n.content || []).map((c) => mdBlock(c, lossy)).filter((x) => x !== '').join(sep);
  switch (n.type) {
    case 'paragraph': return cleanLines(mdInline(n.content || [], lossy));
    case 'heading': {
      const s = mdInline(n.content || [], lossy);
      if (s.includes('\n')) lossy.add('heading_break');
      return `${'#'.repeat(n.attrs.level)} ${s.replace(/\n/g, ' ').trim()}`;
    }
    case 'blockquote': return kids().split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
    case 'bulletList': case 'orderedList': case 'taskList': {
      let num = n.attrs?.start || 1;
      return (n.content || []).map((item) => {
        const marker = n.type === 'orderedList' ? `${num++}. ` : '- ';
        const box = n.type === 'taskList' ? (item.attrs?.checked ? '[x] ' : '[ ] ') : '';
        const parts = (item.content || []).map((c) => mdBlock(c, lossy));
        // 첫 문단은 표시 뒤에, 나머지 블록은 빈 줄 + 들여쓰기(목록은 빈 줄 없이 바로)
        let s = parts[0] || '';
        for (let k = 1; k < parts.length; k += 1) {
          if (parts[k] === '') continue;
          const isList = /List$/.test(item.content[k].type);
          s += (isList ? '\n' : '\n\n') + parts[k];
        }
        return (marker + box + indent(s, marker.length).slice(marker.length)).replace(/\s+$/, '');
      }).join('\n');
    }
    case 'codeBlock': {
      const code = (n.content || []).map((c) => c.text).join('');
      if (/^\s*```/m.test(code)) lossy.add('code_fence');
      return `\`\`\`${n.attrs?.language || ''}\n${code}\n\`\`\``;
    }
    case 'horizontalRule': return '---';
    case 'image': {
      const alt = n.attrs.alt || '';
      if (/[\]\n]/.test(alt) || /"/.test(n.attrs.width || '')) lossy.add('image_attrs');
      return `![${alt.replace(/[\]\n]/g, ' ')}](${n.attrs.src}${n.attrs.width ? ` "width=${n.attrs.width}"` : ''})`;
    }
    default: return '';
  }
}

/** 업무 칸 HTML → { markdown, lossy: [이유] } — 빈 칸이면 markdown ''. */
function fromHtml(html) {
  const { model, lossy } = htmlToModel(html);
  const set = new Set(lossy);
  const markdown = model.map((b) => mdBlock(b, set)).filter((x) => x !== '').join('\n\n');
  return { markdown, lossy: [...set] };
}

/** 원시 HTML 로 보이는 입력 — 코드 블록·인라인 코드·\< 는 뺀다(HTML 예시를 적은 설명은 받는다). */
const HTML_TAG_RE = /(^|[^\\])<\/?(p|br|ul|ol|li|h[1-6]|strong|em|b|i|u|s|a|div|span|table|thead|tbody|tr|td|th|img|blockquote|pre|code|hr|label|input|mark|del|strike|font|section|article)(\s[^>]*)?\/?>/i;
function looksLikeHtml(md) {
  const s = String(md || '')
    .replace(/^\s*```[\s\S]*?^\s*```\s*$/gm, '')
    .replace(/`[^`\n]*`/g, '');
  return HTML_TAG_RE.test(s);
}

module.exports = { toHtml, fromHtml, looksLikeHtml, markdownToModel, htmlToModel, SAFE_IMG };
