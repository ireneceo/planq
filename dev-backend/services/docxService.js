// 문서·노트를 **진짜 .docx** 로 (#225)
//
// 운영 신고: "문서, 노트들 워드, pdf, 엑셀, 등등으로 기본적으로 다운로드 받아야 하는 거 아니야?"
//   PDF 는 이미 있고(services/pdfService), 없던 것이 워드다.
//
// 왜 라이브러리를 안 쓰나: .docx 는 정해진 이름의 XML 몇 개를 담은 zip 이다. 우리는 이미 archiver 를
//   쓰고 있어서, 문단·제목·굵기·목록·표 정도의 부분집합은 의존성 없이 만들 수 있다.
//   (HTML 에 .doc 확장자를 붙이는 흔한 편법은 쓰지 않는다 — 최신 워드가 "형식이 확장자와 다르다" 며
//    경고를 띄워서, 사용자에게는 파일이 깨진 것처럼 보인다.)
//
// 지원 범위: 제목(h1~h3) · 문단 · 굵게/기울임/밑줄/취소선 · 글머리·번호 목록 · 표 · 링크(밑줄 텍스트) ·
//   인용 · 코드. 이미지는 넣지 않는다(문서 안 이미지는 대부분 우리 서버 인증이 필요해 워드에서 못 연다 —
//   빈 사각형이 남는 것보다 자리 표시 문구가 정직하다).
const archiver = require('archiver');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// ── OOXML 조각 ───────────────────────────────────────────────────
function runXml(text, marks = {}) {
  if (!text) return '';
  const props = [
    marks.bold ? '<w:b/>' : '',
    marks.italic ? '<w:i/>' : '',
    marks.underline || marks.link ? '<w:u w:val="single"/>' : '',
    marks.strike ? '<w:strike/>' : '',
    marks.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : '',
    marks.link ? '<w:color w:val="0563C1"/>' : '',
  ].join('');
  // xml:space="preserve" 가 없으면 앞뒤 공백이 사라져 단어가 붙는다.
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function paraXml(runs, opts = {}) {
  const pr = [];
  if (opts.style) pr.push(`<w:pStyle w:val="${opts.style}"/>`);
  if (opts.listId) {
    pr.push(`<w:numPr><w:ilvl w:val="${opts.level || 0}"/><w:numId w:val="${opts.listId}"/></w:numPr>`);
  }
  if (opts.quote) pr.push('<w:ind w:left="480"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="CBD5E1"/></w:pBdr>');
  return `<w:p>${pr.length ? `<w:pPr>${pr.join('')}</w:pPr>` : ''}${runs || ''}</w:p>`;
}

// ── TipTap(JSON) → OOXML ─────────────────────────────────────────
function inlineRuns(node) {
  if (!node) return '';
  if (node.type === 'text') {
    const marks = {};
    for (const m of node.marks || []) {
      if (m.type === 'bold') marks.bold = true;
      else if (m.type === 'italic') marks.italic = true;
      else if (m.type === 'underline') marks.underline = true;
      else if (m.type === 'strike') marks.strike = true;
      else if (m.type === 'code') marks.code = true;
      else if (m.type === 'link') marks.link = true;
    }
    return runXml(node.text, marks);
  }
  if (node.type === 'hardBreak') return '<w:r><w:br/></w:r>';
  return (node.content || []).map(inlineRuns).join('');
}

function tableXml(node) {
  const rows = (node.content || []).filter((r) => r.type === 'tableRow');
  if (!rows.length) return '';
  const body = rows.map((row) => {
    const cells = (row.content || []).filter((c) => c.type === 'tableCell' || c.type === 'tableHeader');
    const tcs = cells.map((c) => {
      const inner = (c.content || []).map((p) => paraXml(inlineRuns(p))).join('') || paraXml('');
      const shade = c.type === 'tableHeader' ? '<w:shd w:val="clear" w:fill="F1F5F9"/>' : '';
      return `<w:tc><w:tcPr><w:tcBorders>${border()}</w:tcBorders>${shade}</w:tcPr>${inner}</w:tc>`;
    }).join('');
    return `<w:tr>${tcs}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>${body}</w:tbl>${paraXml('')}`;
}
const border = () => ['top', 'left', 'bottom', 'right']
  .map((s) => `<w:${s} w:val="single" w:sz="4" w:color="CBD5E1"/>`).join('');

function blockXml(node, ctx) {
  if (!node) return '';
  switch (node.type) {
    case 'heading': {
      const lv = Math.min(3, Math.max(1, Number(node.attrs?.level) || 1));
      return paraXml(inlineRuns(node), { style: `Heading${lv}` });
    }
    case 'paragraph':
      return paraXml(inlineRuns(node));
    case 'bulletList':
    case 'orderedList': {
      const listId = node.type === 'bulletList' ? 1 : 2;
      return (node.content || []).map((li) => (li.content || [])
        .map((p, i) => (p.type === 'paragraph'
          ? paraXml(inlineRuns(p), i === 0 ? { listId } : {})
          : blockXml(p, ctx))).join('')).join('');
    }
    case 'taskList':
      return (node.content || []).map((li) => {
        const checked = li.attrs?.checked ? '☑ ' : '☐ ';
        const inner = (li.content || []).map(inlineRuns).join('');
        return paraXml(runXml(checked) + inner);
      }).join('');
    case 'blockquote':
      return (node.content || []).map((p) => paraXml(inlineRuns(p), { quote: true })).join('');
    case 'codeBlock':
      return paraXml(runXml(textOf(node), { code: true }));
    case 'table':
      return tableXml(node);
    case 'horizontalRule':
      return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="CBD5E1"/></w:pBdr></w:pPr></w:p>';
    case 'image':
      // 이미지는 넣지 않는다(파일 상단 주석). 무엇이 빠졌는지는 알려준다.
      return paraXml(runXml(`[이미지: ${node.attrs?.alt || node.attrs?.title || '첨부'}]`, { italic: true }));
    default:
      return (node.content || []).map((c) => blockXml(c, ctx)).join('');
  }
}

function textOf(n) {
  if (!n) return '';
  if (typeof n.text === 'string') return n.text;
  return (n.content || []).map(textOf).join('');
}

/** 평문(줄바꿈 기준) — 리치 콘텐츠가 없을 때의 폴백 */
function plainToXml(text) {
  return String(text || '').split(/\r?\n/).map((line) => paraXml(runXml(line))).join('') || paraXml('');
}

function documentXml(bodyXml) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body>
</w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

// 맑은 고딕 — 한글이 깨지지 않게 동아시아 폰트를 명시한다.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="Malgun Gothic"/>
<w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
${[1, 2, 3].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:pPr><w:spacing w:before="${280 - n * 40}" w:after="${120 - n * 20}"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${34 - n * 4}"/></w:rPr></w:style>`).join('')}
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="480" w:hanging="240"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="480" w:hanging="240"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

/**
 * 리치 콘텐츠(TipTap JSON) 또는 평문 → .docx Buffer
 * @param {{title?:string, subtitle?:string, content?:object|string, plain?:string}} doc
 */
async function buildDocx(doc) {
  const head = [
    doc.title ? paraXml(runXml(doc.title), { style: 'Title' }) : '',
    doc.subtitle ? paraXml(runXml(doc.subtitle, { italic: true })) : '',
  ].join('');

  let body = '';
  const content = typeof doc.content === 'string' ? safeParse(doc.content) : doc.content;
  if (content && Array.isArray(content.content)) {
    body = content.content.map((n) => blockXml(n, {})).join('');
  } else {
    body = plainToXml(doc.plain || textOf(content) || '');
  }

  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks = [];
  archive.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  // 이름과 순서는 규격이다 — [Content_Types].xml 이 먼저 와야 워드가 연다.
  archive.append(CONTENT_TYPES, { name: '[Content_Types].xml' });
  archive.append(ROOT_RELS, { name: '_rels/.rels' });
  archive.append(DOC_RELS, { name: 'word/_rels/document.xml.rels' });
  archive.append(STYLES, { name: 'word/styles.xml' });
  archive.append(NUMBERING, { name: 'word/numbering.xml' });
  archive.append(documentXml(head + body), { name: 'word/document.xml' });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

function safeParse(v) {
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
}

/** 파일명 헤더 — 한글 제목이 깨지지 않게 RFC 5987 형식을 같이 준다(PDF 경로와 같은 방식). */
function sendDocx(res, buf, title) {
  const safe = String(title || 'document').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  const ascii = safe.replace(/[^\x20-\x7E]/g, '_') || 'document';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition',
    `attachment; filename="${ascii}.docx"; filename*=UTF-8''${encodeURIComponent(safe)}.docx`);
  res.setHeader('Content-Length', buf.length);
  return res.send(buf);
}

module.exports = { buildDocx, sendDocx };
