// services/officeText.js — Office 문서(docx·xlsx·pptx)에서 **읽을 수 있는 글**을 뽑는다.
//
// Irene 2026-09-08: "Q sale 빼고 다 해줘." — 남겨 둔 것 중 하나가 이것이다.
//   Cue 는 텍스트·PDF·HTML 만 읽었고 워드·엑셀은 `unsupported_type` 으로 **한 글자도** 안 읽혔다.
//   계약서와 견적서가 대개 그 두 형식이라, 가장 물어볼 만한 파일이 정확히 사각지대였다.
//
// ★ 왜 새 의존성을 안 붙였나
//   `xlsx`(SheetJS) 는 npm 배포본에 prototype pollution·ReDoS 권고가 붙어 있고,
//   `mammoth` 는 bluebird·jszip 등 전이 의존성을 데려온다. OOXML 은 **ZIP + XML** 이고
//   Node 에 `zlib` 이 이미 있다 — 읽기 전용 추출에 새 공급망을 들일 이유가 없다.
//   (운영은 매 배포 `npm ci --omit=dev` 가 도니 의존성 자체는 갈 수 있다. 그래도 안 붙인다.)
//
// ★ 절대 예외를 던지지 않는다. 못 읽으면 **빈 문자열**이다 — 색인이 업로드를 죽이면 안 된다.
//   암호 걸린 docx(OLE 컨테이너), 손상 파일, ZIP64 아닌 이상한 변형 전부 여기서 조용히 0자다.
const zlib = require('zlib');

// ── ZIP 읽기 (중앙 디렉터리 기준) ────────────────────────────────────────────
//   로컬 헤더를 앞에서부터 훑는 방식은 data descriptor 가 붙은 항목에서 길이를 못 믿는다.
//   중앙 디렉터리가 정본이다.
const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOC_SIG = 0x07064b50;
const CEN_SIG = 0x02014b50;

function findEocd(buf) {
  // EOCD 는 파일 끝에 있고 주석(최대 65535) 뒤에 올 수 없다 — 뒤에서부터 찾는다.
  const min = Math.max(0, buf.length - (0xffff + 22));
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/** ZIP 항목 목록 → { name → {offset, method, compSize} }. 못 읽으면 null. */
function zipIndex(buf) {
  if (buf.length < 22 || buf.readUInt16LE(0) !== 0x4b50) return null;   // 'PK' 아니면 ZIP 이 아니다
  const eocd = findEocd(buf);
  if (eocd < 0) return null;

  let count = buf.readUInt16LE(eocd + 10);
  let cenOff = buf.readUInt32LE(eocd + 16);

  // ZIP64 — 항목 수나 오프셋이 포화값이면 ZIP64 EOCD 를 봐야 한다.
  if (count === 0xffff || cenOff === 0xffffffff) {
    const locOff = eocd - 20;
    if (locOff < 0 || buf.readUInt32LE(locOff) !== EOCD64_LOC_SIG) return null;
    const z64 = Number(buf.readBigUInt64LE(locOff + 8));
    if (!Number.isFinite(z64) || z64 < 0 || z64 + 56 > buf.length) return null;
    if (buf.readUInt32LE(z64) !== EOCD64_SIG) return null;
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cenOff = Number(buf.readBigUInt64LE(z64 + 48));
  }

  const entries = new Map();
  let p = cenOff;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    let compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    let localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf-8', p + 46, p + 46 + nameLen);

    // ZIP64 확장 필드 — 포화값인 항목만 실제 값을 여기서 읽는다(순서가 규격에 정해져 있다).
    if (compSize === 0xffffffff || localOff === 0xffffffff) {
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const hid = buf.readUInt16LE(e);
        const hsz = buf.readUInt16LE(e + 2);
        if (hid === 0x0001) {
          let q = e + 4;
          // uncompressed, compressed, localHeaderOffset 순 — 포화였던 것만 들어 있다.
          if (buf.readUInt32LE(p + 24) === 0xffffffff) q += 8;          // uncompressed size
          if (compSize === 0xffffffff) { compSize = Number(buf.readBigUInt64LE(q)); q += 8; }
          if (localOff === 0xffffffff) { localOff = Number(buf.readBigUInt64LE(q)); }
          break;
        }
        e += 4 + hsz;
      }
    }
    entries.set(name, { method, compSize, localOff });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return entries.size ? entries : null;
}

/** 항목 하나의 압축을 푼다. 실패하면 null. */
function zipRead(buf, ent) {
  try {
    const lo = ent.localOff;
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) return null;
    const nameLen = buf.readUInt16LE(lo + 26);
    const extraLen = buf.readUInt16LE(lo + 28);
    const start = lo + 30 + nameLen + extraLen;
    const end = start + ent.compSize;
    if (end > buf.length) return null;
    const raw = buf.subarray(start, end);
    if (ent.method === 0) return raw;                       // stored
    if (ent.method === 8) return zlib.inflateRawSync(raw);  // deflate
    return null;                                            // 그 외 방식은 다루지 않는다
  } catch { return null; }
}

// ── XML 조각 ────────────────────────────────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, g) => {
    if (g[0] === '#') {
      const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    return ENT[g] != null ? ENT[g] : m;
  });
}

/** `<ns:tag …>내용</ns:tag>` 의 내용들. 자기 닫힘 태그는 빈 값으로 건너뛴다. */
function tagTexts(xml, tag) {
  const out = [];
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*?(/)?>`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    if (m[1]) continue;                                  // <w:t/> — 내용 없음
    const close = xml.indexOf('</', re.lastIndex);
    const closeEnd = close < 0 ? -1 : xml.indexOf('>', close);
    if (close < 0 || closeEnd < 0) break;
    out.push(unescapeXml(xml.slice(re.lastIndex, close)));
    re.lastIndex = closeEnd + 1;
  }
  return out;
}

function tidy(s) {
  return String(s)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ── docx ────────────────────────────────────────────────────────────────────
// 문단(`w:p`)이 줄이고, `w:tab`·`w:br` 이 칸과 줄이다. 이걸 안 살리면 표가 한 줄로 뭉개져
//   "표 두 번째 항목 얼마야?" 같은 질문에 못 답한다.
function docxParagraphs(xml) {
  const body = xml.replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, '');
  const lines = [];
  const re = /<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g;
  let m;
  while ((m = re.exec(body))) {
    const inner = m[1];
    if (!inner) { lines.push(''); continue; }
    // ★ 탭·줄바꿈을 **읽은 순서 그대로** 끼워 넣는다. 먼저 문자로 치환해 두고 나중에
    //   `<w:t>` 만 긁어모으면 그 사이의 탭·줄바꿈이 통째로 사라진다 —
    //   실측으로 표의 `담당 ⇥ 홍길동 ⏎ 연락` 이 `담당홍길동연락` 한 낱말이 됐다.
    //   낱말이 붙으면 검색도 임베딩도 그 줄을 못 찾는다.
    const tok = /<(?:w:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:w:)?t>)|<w:(tab|br|cr)\b[^>]*\/?>/g;
    let t; let line = '';
    while ((t = tok.exec(inner))) {
      if (t[2]) line += t[2] === 'tab' ? '\t' : '\n';
      else if (t[1]) line += unescapeXml(t[1]);
    }
    lines.push(line.replace(/[ \t]+$/, ''));
  }
  return lines;
}

function docxText(buf) {
  const zip = zipIndex(buf);
  if (!zip) return '';
  const parts = [];
  // 본문 → 각주/미주 → 머리말/꼬리말 순. 계약서 단서가 각주에 있는 일이 실제로 있다.
  const order = ['word/document.xml'];
  for (const name of zip.keys()) {
    if (/^word\/(footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(name)) order.push(name);
  }
  for (const name of order) {
    const ent = zip.get(name);
    if (!ent) continue;
    const raw = zipRead(buf, ent);
    if (!raw) continue;
    const text = docxParagraphs(raw.toString('utf-8')).join('\n');
    if (text.trim()) parts.push(text);
  }
  return tidy(parts.join('\n\n'));
}

// ── xlsx ────────────────────────────────────────────────────────────────────
// 날짜는 **일련번호**로 저장된다. 그대로 두면 계약일이 `45678` 로 나가 Cue 가 그걸 읽는다 —
//   숫자만 옳고 뜻은 틀린 답이 가장 나쁘다. 서식(numFmt)을 보고 날짜면 되돌린다.
const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function xlsxDateStyles(zip, buf) {
  const ent = zip.get('xl/styles.xml');
  if (!ent) return new Set();
  const raw = zipRead(buf, ent);
  if (!raw) return new Set();
  const xml = raw.toString('utf-8');

  // 사용자 서식 중 날짜/시간 패턴을 쓰는 id 를 모은다 (따옴표 안 리터럴은 뺀다).
  const dateFmtIds = new Set(BUILTIN_DATE_FMT);
  const fmtRe = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
  let m;
  while ((m = fmtRe.exec(xml))) {
    const code = unescapeXml(m[2]).replace(/"[^"]*"/g, '').replace(/\\./g, '');
    if (/[yYdD]|hh|HH|mmm/.test(code) && !/^[#0.,%\s]*$/.test(code)) dateFmtIds.add(Number(m[1]));
  }

  // cellXfs 의 순서가 곧 `c/@s` 인덱스다.
  const xfsBlock = (xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [''])[0];
  const styles = new Set();
  let i = 0;
  const xfRe = /<xf\b[^>]*>/g;
  while ((m = xfRe.exec(xfsBlock))) {
    const id = Number((m[0].match(/numFmtId="(\d+)"/) || [])[1]);
    if (Number.isFinite(id) && dateFmtIds.has(id)) styles.add(i);
    i += 1;
  }
  return styles;
}

/** 엑셀 일련번호 → `YYYY-MM-DD`(시각이 있으면 분까지). 1900 윤년 버그까지 그대로 흉내낸다. */
function serialToDate(n) {
  if (!Number.isFinite(n) || n <= 0 || n > 2958465) return null;   // 9999-12-31 넘으면 날짜가 아니다
  const whole = Math.floor(n);
  const frac = n - whole;
  // 엑셀은 1900-02-29 를 존재한다고 친다 — 60 이후는 하루를 빼야 실제 날짜와 맞는다.
  const days = whole > 59 ? whole - 1 : whole;
  const ms = Date.UTC(1900, 0, 1) + (days - 1) * 86400000 + Math.round(frac * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return frac > 0 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

function xlsxSharedStrings(zip, buf) {
  const ent = zip.get('xl/sharedStrings.xml');
  if (!ent) return [];
  const raw = zipRead(buf, ent);
  if (!raw) return [];
  const xml = raw.toString('utf-8');
  // 한 <si> 안에 <t> 가 여러 개일 수 있다(서식이 끊긴 문자열) — 이어 붙여야 한 낱말이 된다.
  const out = [];
  const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[1] ? tagTexts(m[1], 't').join('') : '');
  return out;
}

function xlsxSheetNames(zip, buf) {
  const ent = zip.get('xl/workbook.xml');
  if (!ent) return [];
  const raw = zipRead(buf, ent);
  if (!raw) return [];
  const out = [];
  const re = /<sheet\b[^>]*name="([^"]*)"[^>]*>/g;
  let m;
  while ((m = re.exec(raw.toString('utf-8')))) out.push(unescapeXml(m[1]));
  return out;
}

function xlsxSheetRows(xml, shared, dateStyles) {
  const lines = [];
  const rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    if (!rm[1]) continue;
    const cells = [];
    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cRe.exec(rm[1]))) {
      const attrs = cm[1] || '';
      const inner = cm[2] || '';
      if (!inner) continue;
      const type = (attrs.match(/\bt="([^"]*)"/) || [])[1] || 'n';
      let val = '';
      if (type === 's') {
        const idx = Number(tagTexts(inner, 'v')[0]);
        val = shared[idx] != null ? shared[idx] : '';
      } else if (type === 'inlineStr') {
        val = tagTexts(inner, 't').join('');
      } else if (type === 'e') {
        val = '';                                   // #REF! 같은 오류 셀은 뜻이 없다
      } else {
        val = tagTexts(inner, 'v')[0] || '';
        const styleIdx = Number((attrs.match(/\bs="(\d+)"/) || [])[1]);
        if (val && Number.isFinite(styleIdx) && dateStyles.has(styleIdx)) {
          const asDate = serialToDate(Number(val));
          if (asDate) val = asDate;
        }
      }
      if (String(val).trim()) cells.push(String(val).trim());
    }
    if (cells.length) lines.push(cells.join('\t'));
  }
  return lines;
}

function xlsxText(buf) {
  const zip = zipIndex(buf);
  if (!zip) return '';
  const shared = xlsxSharedStrings(zip, buf);
  const dateStyles = xlsxDateStyles(zip, buf);
  const names = xlsxSheetNames(zip, buf);
  // sheet1.xml, sheet2.xml … 을 숫자 순서로. 문자열 정렬이면 sheet10 이 sheet2 앞에 온다.
  const sheets = [...zip.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));

  const parts = [];
  sheets.forEach((name, i) => {
    const raw = zipRead(buf, zip.get(name));
    if (!raw) return;
    const rows = xlsxSheetRows(raw.toString('utf-8'), shared, dateStyles);
    if (!rows.length) return;
    // 시트 이름을 머리로 남긴다 — "견적 시트에 뭐라고 돼 있어?" 에 답하려면 이름이 필요하다.
    parts.push(`# ${names[i] || `Sheet${i + 1}`}\n${rows.join('\n')}`);
  });
  return tidy(parts.join('\n\n'));
}

// ── pptx ────────────────────────────────────────────────────────────────────
function pptxText(buf) {
  const zip = zipIndex(buf);
  if (!zip) return '';
  const slides = [...zip.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  const parts = [];
  slides.forEach((name, i) => {
    const raw = zipRead(buf, zip.get(name));
    if (!raw) return;
    const xml = raw.toString('utf-8');
    // 문단(a:p) 단위로 줄을 나눈다 — 전부 이어 붙이면 제목과 본문이 한 낱말로 붙는다.
    const lines = [];
    const pRe = /<a:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/a:p>)/g;
    let m;
    while ((m = pRe.exec(xml))) {
      if (!m[1]) continue;
      const line = tagTexts(m[1], 't').join('').trim();
      if (line) lines.push(line);
    }
    if (lines.length) parts.push(`# Slide ${i + 1}\n${lines.join('\n')}`);
  });
  return tidy(parts.join('\n\n'));
}

/**
 * OOXML 문서에서 글을 뽑는다. 못 뽑으면 **빈 문자열** (예외 없음).
 * @param {Buffer} buf
 * @param {'docx'|'xlsx'|'pptx'} kind
 */
function extractOfficeText(buf, kind) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 4) return '';
    if (kind === 'docx') return docxText(buf);
    if (kind === 'xlsx') return xlsxText(buf);
    if (kind === 'pptx') return pptxText(buf);
    return '';
  } catch (e) {
    console.warn('[officeText] 추출 실패:', kind, e.message);
    return '';
  }
}

module.exports = { extractOfficeText, zipIndex, zipRead, serialToDate };
