// 녹화 소재 검수 관문(설계 §7 · Fable 비차단 3) — beat 순간에 화면이 «영상에 써도 되는 상태» 인지 DOM 으로 묻는다.
//   결정적·싸다·문구가 바뀌어도 사전이 locales 에서 다시 만들어지므로 안 깨진다. 이미지 인식은 쓰지 않는다(2차 의견용).
//   걸리는 것: 로딩 중(aria-busy) · 빈 상태 문구 · 공지 띠 · 온보딩 블록 · 경고/오류(role=alert, 오류 화면 문구)
const fs = require('fs');
const path = require('path');

const LOCALES = '/opt/planq/dev-frontend/public/locales/ko';
let cache = null;
// 빈 상태 문구 사전 — locales 의 empty·noData·none·nothing 계열 키 값(짧은 것만, {{보간}} 앞까지)
function phrases() {
  if (cache) return cache;
  const out = new Set();
  const walk = (o, keyPath) => {
    if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) walk(v, keyPath + '.' + k); return; }
    if (typeof o !== 'string') return;
    if (!/(empty|nothing|emptyState)/i.test(keyPath) && !/\.no[A-Z]\w*$/.test(keyPath)) return;
    const s = o.split('{{')[0].replace(/[<>]/g, '').trim();
    if (s.length >= 6 && s.length <= 40) out.add(s);
  };
  for (const f of fs.readdirSync(LOCALES)) { try { walk(JSON.parse(fs.readFileSync(path.join(LOCALES, f), 'utf8')), f); } catch { /* 깨진 파일은 건너뜀 */ } }
  cache = [...out];
  return cache;
}

// 페이지 안에서 돈다 — rect 를 주면 그 안만, 없으면 화면 전체
function inPage(arg) {
  const { rect, empties } = arg;
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    if (rect && (r.right < rect.x || r.left > rect.x + rect.w || r.bottom < rect.y || r.top > rect.y + rect.h)) return false;
    return true;
  };
  const issues = [];
  for (const el of document.querySelectorAll('[aria-busy="true"]')) if (el.tagName !== 'BUTTON' && vis(el)) issues.push({ kind: 'loading', text: (el.getAttribute('aria-label') || el.tagName).slice(0, 60) });
  for (const el of document.querySelectorAll('[role="alert"],[role="alertdialog"]')) if (vis(el) && (el.textContent || '').trim()) issues.push({ kind: 'alert', text: el.textContent.trim().slice(0, 60) });
  // 글자 노드 단위로 빈 상태·공지·오류 문구를 찾는다
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const banner = /자세히 보기|팀 적응 단계|알림이 차단|앱으로 설치|문제가 발생|다시 시도해|찾을 수 없습니다|권한이 없습니다/;
  let n;
  while ((n = tw.nextNode())) {
    const t = (n.textContent || '').trim(); if (t.length < 4) continue;
    const el = n.parentElement; if (!el || !vis(el)) continue;
    if (banner.test(t)) issues.push({ kind: /자세히 보기|알림이 차단|앱으로 설치/.test(t) ? 'banner' : /팀 적응/.test(t) ? 'onboarding' : 'error', text: t.slice(0, 60) });
    else if (empties.some((p) => t.startsWith(p))) issues.push({ kind: 'empty', text: t.slice(0, 60) });
  }
  const seen = new Set();
  return issues.filter((x) => { const k = x.kind + x.text; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
}

async function checkPage(page, rect = null) {
  return page.evaluate(inPage, { rect, empties: phrases() });
}

module.exports = { checkPage, phrases };
