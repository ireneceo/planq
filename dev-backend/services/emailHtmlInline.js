// services/emailHtmlInline.js — 보내는 메일의 표에 인라인 스타일을 입힌다.
//
// 왜 필요한가: 우리 에디터(Tiptap)가 만드는 표는 `<table style="min-width:50px">` 뿐이고
//   테두리·여백이 없다. 편집 중에는 앱 CSS 가 그려주지만 **메일에는 앱 CSS 가 없다**.
//   그래서 보낸 메일도, 상대가 그걸 인용해 되돌아온 메일도 테두리 없는 텍스트 덩어리로 보였다
//   (Irene: "붙이기 하면 표도 제대로 들어가는데 보낸 메일에서 보면 제대로 안나와").
//
// ★ 아무 <table> 이나 손대면 안 된다. 전달(forward)은 원문 HTML 을 본문에 그대로 합성하므로,
//   **뉴스레터의 레이아웃 표(일부러 테두리 없음)** 가 본문에 들어온다. 무차별 주입하면 남의
//   디자인에 격자를 그려 넣는 셈이다. → 우리 에디터가 붙인 `pq-table` 클래스가 있는 표만 손댄다.
//
// 멱등이어야 한다(초안 재발송·서명 이중 적용). 처리한 표에는 data-planq-inlined="1" 을 남긴다.
// 표가 없으면 입력을 **그대로** 돌려준다(문자열 동일).

const TABLE_STYLE = 'border-collapse:collapse;width:100%;font-size:13px;margin:12px 0;';
const TH_STYLE = 'border:1px solid #CBD5E1;padding:8px 12px;background:#F8FAFC;font-weight:700;text-align:left;';
const TD_STYLE = 'border:1px solid #E2E8F0;padding:8px 12px;vertical-align:top;';

/** 여는 태그의 style 속성에 값을 병합한다. 이미 있으면 앞에 붙이고(기존 선언이 이김), 없으면 추가. */
function mergeStyle(tag, add) {
  const m = /\sstyle\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
  if (!m) return tag.replace(/\s*\/?>$/, (end) => ` style="${add}"${end}`);
  const merged = `${add}${m[2].trim().replace(/;?$/, ';')}`;
  return tag.slice(0, m.index) + ` style="${merged}"` + tag.slice(m.index + m[0].length);
}

function hasClass(tag, cls) {
  const m = /\sclass\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
  return !!m && m[2].split(/\s+/).includes(cls);
}

/**
 * 우리 에디터가 만든 표(class="pq-table")에만 메일용 인라인 스타일을 입힌다.
 * 이미 처리한 표(data-planq-inlined)는 건너뛴다 — 멱등.
 */
function inlineMailTableStyles(html) {
  const src = String(html || '');
  if (!src || !/<table[^>]*\bpq-table\b/i.test(src)) return src;

  let out = '';
  let i = 0;
  let depth = 0;          // pq-table 안쪽인지 (중첩 표는 바깥 표 기준으로만 처리)
  let skip = false;       // 이미 처리된 표 안이면 셀도 건드리지 않는다
  const re = /<(\/?)(table|td|th)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    out += src.slice(i, m.index);
    const [full, close, name] = m;
    const lower = name.toLowerCase();
    let tag = full;
    if (lower === 'table') {
      if (close) { depth = Math.max(0, depth - 1); if (depth === 0) skip = false; }
      else {
        const isOurs = hasClass(full, 'pq-table');
        if (depth === 0) {
          if (!isOurs) { skip = true; }
          else if (/data-planq-inlined/i.test(full)) { skip = true; }
          else {
            skip = false;
            tag = mergeStyle(full, TABLE_STYLE).replace(/\s*\/?>$/, (e) => ` data-planq-inlined="1"${e}`);
          }
        }
        depth += 1;
      }
    } else if (!close && depth > 0 && !skip) {
      // 이미 style 을 가진 셀은 발신자(또는 사용자)의 의도이므로 손대지 않는다.
      if (!/\sstyle\s*=/i.test(full)) tag = mergeStyle(full, lower === 'th' ? TH_STYLE : TD_STYLE);
    }
    out += tag;
    i = m.index + full.length;
  }
  out += src.slice(i);
  return out;
}

module.exports = { inlineMailTableStyles, TABLE_STYLE, TH_STYLE, TD_STYLE };
