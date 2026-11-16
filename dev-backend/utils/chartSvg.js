// utils/chartSvg.js — 문서 차트 블록의 «데이터 → 정적 SVG» 한 벌 (2026-11-16, docs/DOC_CHART_BLOCK_DESIGN.md)
//
// ★ 서버(PDF·서명본·워드)와 화면(편집기·보기·게스트)이 **이 파일 하나**를 쓴다. 두 벌이면 «서명한 화면 ≠ PDF» 가 된다.
//   서버는 require, 화면은 빌드 때 같은 파일을 가져온다(아래 끝 — module 이 있으면 module.exports, 없으면 globalThis.PqChartSvg).
// ★ 의존성 없음 · 실행 코드 없음 · 저장된 값은 숫자·글자뿐. 글자는 전부 XML 이스케이프, 색은 고정 팔레트.
// ★ 그림은 `<img src="data:image/svg+xml;base64,…">` 로만 싣는다 — 그림으로 연 SVG 는 스크립트·외부 주소를 실행·로드하지 않는다.
(function (root) {
  'use strict';

  var KINDS = ['bar', 'line', 'area', 'pie'];
  var LIMIT = { labels: 50, series: 8, title: 120, name: 40, unit: 12 };
  var PALETTE = ['#0D9488', '#F43F5E', '#6366F1', '#F59E0B', '#0EA5E9', '#8B5CF6', '#10B981', '#64748B'];
  var W = 640, H = 360;
  // 그림으로 연 SVG 는 페이지 글꼴(웹 글꼴)을 못 쓴다 — 시스템 글꼴만. PDF(서버 크롬)가 쓰는 Noto CJK 를 맨 앞에(Fable 9).
  var FONT = "'Noto Sans CJK KR','Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

  function str(v, max) {
    if (v == null || typeof v === 'object' || typeof v === 'function') return '';
    var s = String(v).slice(0, max * 4);
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    return s.length > max ? s.slice(0, max) : s;
  }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    var s = v.replace(/[,\s]/g, '').replace(/%$/, '');
    if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  /** 저장·렌더 모두 이 함수를 지난 값만 쓴다. 거절하지 않고 깎는다. */
  function normalizeChart(raw) {
    try { return normalizeInner(raw); } catch (e) { return { v: 1, kind: 'bar', title: '', labels: [], series: [], unit: '' }; }
  }
  function normalizeInner(raw) {
    var c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var labels = (Array.isArray(c.labels) ? c.labels : []).slice(0, LIMIT.labels).map(function (l) { return str(l, LIMIT.name); });
    var series = (Array.isArray(c.series) ? c.series : []).slice(0, LIMIT.series).map(function (s) {
      var o = s && typeof s === 'object' ? s : {};
      var vals = Array.isArray(o.values) ? o.values : [];
      var out = [];
      for (var i = 0; i < labels.length; i += 1) out.push(num(vals[i]));
      return { name: str(o.name, LIMIT.name), values: out };
    });
    // v = 데이터 모양 버전(그림 버전 아님). 모르는 v 는 그리지 않고 대체 글만(Fable 8) — 값은 그대로 들고 다닌다.
    return {
      v: c.v === undefined || c.v === null ? 1 : (c.v === 1 ? 1 : (typeof c.v === 'number' && isFinite(c.v) ? c.v : 0)),
      kind: KINDS.indexOf(c.kind) >= 0 ? c.kind : 'bar',
      title: str(c.title, LIMIT.title),
      labels: labels,
      series: series,
      unit: str(c.unit, LIMIT.unit),
    };
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmt(n) {
    if (n == null) return '';
    var a = Math.abs(n);
    var d = a >= 100 || Number.isInteger(n) ? 0 : a >= 10 ? 1 : 2;
    var s = n.toFixed(d);
    if (d > 0) s = s.replace(/\.?0+$/, '');
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function r1(n) { return Math.round(n * 10) / 10; }
  /** 깔끔한 눈금 (1·2·5×10ⁿ) */
  function niceScale(min, max) {
    if (min === max) { if (max === 0) { max = 1; } else if (max > 0) { min = 0; } else { max = 0; } }
    var span = max - min;
    var raw = span / 5;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var m = raw / p;
    var step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    return { lo: lo, hi: hi, ticks: ticks };
  }
  function text(x, y, s, o) {
    o = o || {};
    return '<text x="' + r1(x) + '" y="' + r1(y) + '" font-size="' + (o.size || 11) + '" fill="' + (o.fill || '#64748B') + '"'
      + (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') + (o.weight ? ' font-weight="' + o.weight + '"' : '') + '>' + esc(s) + '</text>';
  }

  function legend(names, y) {
    // 가운데 정렬 한 줄 — 칸 폭은 글자 수로 어림한다(그림 안 측정 불가)
    var items = names.map(function (n, i) { return { n: n || ('#' + (i + 1)), w: 18 + Math.min(n.length || 2, 16) * 7.5 + 14, c: PALETTE[i % PALETTE.length] }; });
    var total = items.reduce(function (a, b) { return a + b.w; }, 0);
    var x = Math.max(12, (W - total) / 2);
    return items.map(function (it) {
      var label = it.n.length > 16 ? it.n.slice(0, 15) + '…' : it.n;
      var s = '<rect x="' + r1(x) + '" y="' + r1(y - 8) + '" width="10" height="10" rx="2" fill="' + it.c + '"/>' + text(x + 15, y + 1, label, { fill: '#334155' });
      x += it.w;
      return s;
    }).join('');
  }

  function empty(c, top) {
    return text(W / 2, (top + H) / 2, '—', { anchor: 'middle', size: 14, fill: '#94A3B8' });
  }

  // 계열마다 점 모양을 달리한다 — 흑백 인쇄·색각에서도 선이 갈린다(Fable 12)
  function marker(si, x, y, col) {
    var a = ' fill="#fff" stroke="' + col + '" stroke-width="2"/>';
    switch (si % 4) {
      case 1: return '<rect x="' + r1(x - 3) + '" y="' + r1(y - 3) + '" width="6" height="6"' + a;
      case 2: return '<path d="M' + r1(x) + ' ' + r1(y - 4) + ' L' + r1(x + 4) + ' ' + r1(y + 3) + ' L' + r1(x - 4) + ' ' + r1(y + 3) + ' Z"' + a;
      case 3: return '<path d="M' + r1(x) + ' ' + r1(y - 4) + ' L' + r1(x + 4) + ' ' + r1(y) + ' L' + r1(x) + ' ' + r1(y + 4) + ' L' + r1(x - 4) + ' ' + r1(y) + ' Z"' + a;
      default: return '<circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="3"' + a;
    }
  }

  function axisChart(c, top) {
    var multi = c.series.length > 1;
    var bottom = H - (multi ? 58 : 36);
    var all = [];
    c.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) all.push(v); }); });
    if (!all.length || !c.labels.length) return empty(c, top);
    var mn = Math.min.apply(null, all.concat(c.kind === 'line' ? [] : [0]));
    var mx = Math.max.apply(null, all.concat(c.kind === 'line' ? [] : [0]));
    var sc = niceScale(mn, mx);
    var tickW = Math.max.apply(null, sc.ticks.map(function (t) { return fmt(t).length; }));
    var left = 16 + Math.min(tickW, 12) * 6.6;
    var right = W - 16;
    var y = function (v) { return bottom - (v - sc.lo) / (sc.hi - sc.lo) * (bottom - top); };
    var out = [];
    sc.ticks.forEach(function (t) {
      out.push('<line x1="' + r1(left) + '" x2="' + right + '" y1="' + r1(y(t)) + '" y2="' + r1(y(t)) + '" stroke="' + (t === 0 ? '#94A3B8' : '#E2E8F0') + '" stroke-width="1"/>');
      out.push(text(left - 6, y(t) + 4, fmt(t), { anchor: 'end' }));
    });
    var n = c.labels.length;
    var band = (right - left) / n;
    var every = n > 12 ? Math.ceil(n / 12) : 1;
    c.labels.forEach(function (l, i) {
      if (i % every) return;
      var lab = l.length > 10 ? l.slice(0, 9) + '…' : l;
      out.push(text(left + band * (i + 0.5), bottom + 16, lab, { anchor: 'middle' }));
    });
    var z = y(Math.max(sc.lo, Math.min(0, sc.hi)));
    if (c.kind === 'bar') {
      var k = c.series.length;
      var inner = band * 0.72;
      var bw = Math.max(1, inner / k);
      c.series.forEach(function (s, si) {
        s.values.forEach(function (v, i) {
          if (v == null) return;
          var x = left + band * i + (band - inner) / 2 + bw * si;
          var yv = y(v);
          var top2 = Math.min(yv, z);
          var h = Math.max(Math.abs(z - yv), v === 0 ? 0 : 1);
          out.push('<rect x="' + r1(x + 0.5) + '" y="' + r1(top2) + '" width="' + r1(Math.max(1, bw - 1)) + '" height="' + r1(h) + '" rx="2" fill="' + PALETTE[si % PALETTE.length] + '"/>');
        });
      });
    } else {
      c.series.forEach(function (s, si) {
        var col = PALETTE[si % PALETTE.length];
        // null 은 선을 끊는다 — 이어진 조각마다 따로 그린다
        var segs = []; var cur = [];
        s.values.forEach(function (v, i) {
          if (v == null) { if (cur.length) segs.push(cur); cur = []; return; }
          cur.push([left + band * (i + 0.5), y(v)]);
        });
        if (cur.length) segs.push(cur);
        segs.forEach(function (pts) {
          var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1]); }).join(' ');
          if (c.kind === 'area' && pts.length > 1) {
            out.push('<path d="' + d + ' L' + r1(pts[pts.length - 1][0]) + ' ' + r1(z) + ' L' + r1(pts[0][0]) + ' ' + r1(z) + ' Z" fill="' + col + '" fill-opacity="0.18"/>');
          }
          out.push('<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>');
          if (pts.length <= 24) pts.forEach(function (p) { out.push(marker(si, p[0], p[1], col)); });
        });
      });
    }
    if (multi) out.push(legend(c.series.map(function (s) { return s.name; }), H - 16));
    return out.join('');
  }

  function pieChart(c, top) {
    var s = c.series[0];
    var items = [];
    if (s) c.labels.forEach(function (l, i) { var v = s.values[i]; if (v != null && v > 0) items.push({ l: l, v: v, i: i }); });
    var total = items.reduce(function (a, b) { return a + b.v; }, 0);
    if (!total) return empty(c, top);
    // 8색을 넘으면 색이 겹친다 — 큰 순 7개 + 나머지 한 조각(이름 «+N», 언어 낱말 없음 · Fable 13)
    if (items.length > 8) {
      items.sort(function (a, b) { return b.v - a.v; });
      var rest = items.slice(7);
      items = items.slice(0, 7).concat([{ l: '+' + rest.length, v: rest.reduce(function (a, b) { return a + b.v; }, 0), i: -1 }]);
    }
    var cx = 200, cy = (top + H) / 2, r = Math.min(120, (H - top) / 2 - 16);
    var out = [];
    var a0 = -Math.PI / 2;
    items.forEach(function (it, k) {
      var col = PALETTE[k % PALETTE.length];
      var frac = it.v / total;
      if (frac >= 0.9999) { out.push('<circle cx="' + cx + '" cy="' + r1(cy) + '" r="' + r1(r) + '" fill="' + col + '"/>'); return; }
      var a1 = a0 + frac * Math.PI * 2;
      var large = frac > 0.5 ? 1 : 0;
      out.push('<path d="M' + cx + ' ' + r1(cy) + ' L' + r1(cx + r * Math.cos(a0)) + ' ' + r1(cy + r * Math.sin(a0))
        + ' A' + r1(r) + ' ' + r1(r) + ' 0 ' + large + ' 1 ' + r1(cx + r * Math.cos(a1)) + ' ' + r1(cy + r * Math.sin(a1)) + ' Z" fill="' + col + '" stroke="#fff" stroke-width="1.5"/>');
      a0 = a1;
    });
    // 오른쪽 범례 — 이름 · 값 · 비율
    var rows = items;
    var ly = cy - (rows.length * 22) / 2 + 12;
    rows.forEach(function (it, k) {
      var lab = it.l.length > 14 ? it.l.slice(0, 13) + '…' : (it.l || ('#' + (it.i + 1)));
      out.push('<rect x="360" y="' + r1(ly - 9) + '" width="10" height="10" rx="2" fill="' + PALETTE[k % PALETTE.length] + '"/>');
      out.push(text(376, ly, lab, { fill: '#334155', size: 12 }));
      out.push(text(W - 20, ly, fmt(it.v) + ' · ' + Math.round(it.v / total * 1000) / 10 + '%', { anchor: 'end', size: 12 }));
      ly += 22;
    });
    return out.join('');
  }

  /** @returns {string} SVG 문자열 (viewBox 640×360) */
  // ★ 절대 throw 하지 않는다(Fable 5) — 조작된 값 하나로 PDF·서명 화면 전체가 500 이 되면 안 된다. 실패 = 빈 그림.
  function blankSvg() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"><rect width="' + W + '" height="' + H + '" fill="#FFFFFF"/>'
      + '<text x="' + W / 2 + '" y="' + H / 2 + '" font-size="14" fill="#94A3B8" text-anchor="middle" font-family="sans-serif">—</text></svg>';
  }
  function chartSvg(raw) {
    try { return drawSvg(normalizeChart(raw)); } catch (e) { return blankSvg(); }
  }
  function drawSvg(c) {
    if (c.v !== 1) return blankSvg();   // 모르는 데이터 모양 — 그리지 않는다(대체 글만)
    var top = 20;
    var head = '';
    if (c.title) { head += text(16, 26, c.title, { size: 15, weight: 700, fill: '#0F172A' }); top = 44; }
    if (c.unit) head += text(W - 16, 26, '(' + c.unit + ')', { anchor: 'end', size: 11 });
    var body = c.kind === 'pie' ? pieChart(c, top) : axisChart(c, top);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" font-family="' + esc(FONT) + '">'
      + '<rect width="' + W + '" height="' + H + '" fill="#FFFFFF"/>' + head + body + '</svg>';
  }

  /** 대체 글 — 화면 낭독기·검색·워드 */
  function chartSummary(raw) {
    var c = normalizeChart(raw);
    var names = c.series.map(function (s) { return s.name; }).filter(Boolean);
    var s = [c.title, c.labels.filter(Boolean).join(', '), names.join(', ')].filter(Boolean).join(' · ');
    return s.length > 300 ? s.slice(0, 299) + '…' : s;
  }
  /** 검색·공유 본문용 글 — 제목 · 항목: 값들(계열별). 언어 낱말 없이 */
  function chartText(raw) {
    var c = normalizeChart(raw);
    var lines = [c.title + (c.unit ? ' (' + c.unit + ')' : '')];
    c.series.forEach(function (s) {
      lines.push((s.name ? s.name + ': ' : '') + c.labels.map(function (l, i) { return (l || '#' + (i + 1)) + ' ' + (s.values[i] == null ? '-' : fmt(s.values[i])); }).join(', '));
    });
    return lines.filter(function (x) { return x && x.trim(); }).join('\n');
  }

  // UTF-8 → base64 를 파일 안 순수 JS 한 벌로 — 브라우저 btoa 는 한글에서 throw 하고 Node 는 Buffer 라 갈라진다(Fable 2).
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function utf8(s) {
    var out = [];
    for (var i = 0; i < s.length; i += 1) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i += 1; } else c = 0xFFFD;
      } else if (c >= 0xD800 && c <= 0xDFFF) c = 0xFFFD;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  function b64(s) {
    var b = utf8(s); var out = '';
    for (var i = 0; i < b.length; i += 3) {
      var n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
    }
    return out;
  }
  function chartDataUri(raw) { return 'data:image/svg+xml;base64,' + b64(chartSvg(raw)); }

  /** 넣을 HTML 조각 — 서버 nodeToHtml 이 쓴다. 화면 renderHTML 은 같은 값(chartDataUri·chartSummary·JSON)으로 같은 모양을 만든다. */
  function chartHtml(raw) {
    var c = normalizeChart(raw);
    if (c.v !== 1) return '<div class="pq-chart" data-pq-chart="' + esc(JSON.stringify(c)) + '"><p>' + esc(chartSummary(c)) + '</p></div>';
    return '<div class="pq-chart" data-pq-chart="' + esc(JSON.stringify(c)) + '"><img src="' + chartDataUri(c) + '" alt="' + esc(chartSummary(c)) + '" style="width:100%"></div>';
  }

  /** 서버로 보내는 HTML(AI 고쳐쓰기 base_html·문서 템플릿)용 — 그림 없이 데이터만(Fable 1: base64 그림이 글자 한도를 먹는다) */
  function chartStubHtml(raw) {
    return '<div data-pq-chart="' + esc(JSON.stringify(normalizeChart(raw))) + '"></div>';
  }

  var api = { normalizeChart: normalizeChart, chartSvg: chartSvg, chartSummary: chartSummary, chartText: chartText, chartStubHtml: chartStubHtml, chartDataUri: chartDataUri, chartHtml: chartHtml, KINDS: KINDS, LIMIT: LIMIT, PALETTE: PALETTE };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.PqChartSvg = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
