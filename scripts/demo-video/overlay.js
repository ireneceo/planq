// 시연 영상 오버레이 — 페이지에 주입. #root 밖(documentElement)에 붙여 확대(transform)에 같이 커지지 않게 한다.
(() => {
  if (window.__pq) return;
  const css = `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700;800&family=Outfit:wght@600;700&display=swap');
  #pqv-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483600;font-family:'Noto Sans KR','Outfit',sans-serif}
  #pqv-cap{position:absolute;left:50%;bottom:72px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:10px}
  .pqv-line{background:rgba(15,46,44,.92);color:#fff;font-weight:800;font-size:46px;letter-spacing:-.02em;line-height:1.25;
    padding:18px 34px 20px;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.28),inset 0 0 0 1px rgba(94,234,212,.25);
    white-space:nowrap;backdrop-filter:blur(6px)}
  .pqv-sub{background:rgba(255,255,255,.95);color:#134E4A;font-weight:700;font-size:26px;padding:10px 22px;border-radius:999px;
    box-shadow:0 10px 30px rgba(0,0,0,.18);opacity:0;transform:translateY(12px);transition:all .5s cubic-bezier(.2,.8,.2,1) .35s}
  .pqv-show .pqv-sub{opacity:1;transform:none}
  .pqv-w{display:inline-block;opacity:0;transform:translateY(22px) scale(.96);filter:blur(4px);
    transition:opacity .45s cubic-bezier(.2,.8,.2,1),transform .45s cubic-bezier(.2,.8,.2,1),filter .45s}
  .pqv-show .pqv-w{opacity:1;transform:none;filter:none}
  .pqv-line em{font-style:normal;color:#5EEAD4;position:relative;isolation:isolate}
  .pqv-line em::after{content:'';position:absolute;left:-2px;right:-2px;bottom:2px;height:10px;background:rgba(45,212,191,.35);
    border-radius:4px;transform:scaleX(0);transform-origin:left;transition:transform .5s cubic-bezier(.2,.8,.2,1) .55s;z-index:-1}
  .pqv-show .pqv-line em::after{transform:scaleX(1)}
  .pqv-hide{opacity:0!important;transform:translateX(-50%) translateY(16px)!important;transition:all .35s ease-in}
  #pqv-cap{transition:opacity .35s,transform .35s}
  #pqv-chip{position:absolute;right:64px;top:4px;display:flex;align-items:center;gap:9px;background:#14B8A6;color:#fff;
    font:700 19px 'Outfit','Noto Sans KR',sans-serif;padding:6px 16px 6px 12px;border-radius:999px;box-shadow:0 10px 30px rgba(15,118,110,.35);
    opacity:0;transform:translateY(-10px);transition:all .45s cubic-bezier(.2,.8,.2,1)}
  #pqv-chip.on{opacity:1;transform:none}
  #pqv-layer.zoomed #pqv-chip{opacity:0}
  #pqv-chip i{width:10px;height:10px;border-radius:50%;background:#5EEAD4;box-shadow:0 0 0 4px rgba(94,234,212,.3)}
  #pqv-cur{position:absolute;left:0;top:0;width:34px;height:40px;transform:translate(960px,620px);
    transition:transform .8s cubic-bezier(.65,0,.35,1);filter:drop-shadow(0 4px 8px rgba(0,0,0,.35));opacity:0}
  #pqv-cur.on{opacity:1}
  #pqv-cur svg{transition:transform .12s}
  #pqv-cur.press svg{transform:scale(.82)}
  .pqv-ripple{position:absolute;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;border:4px solid #14B8A6;
    background:rgba(45,212,191,.25);animation:pqvr .7s ease-out forwards}
  @keyframes pqvr{from{transform:scale(.4);opacity:1}to{transform:scale(3.4);opacity:0}}
  #pqv-spot{position:absolute;border-radius:16px;box-shadow:0 0 0 9999px rgba(10,30,29,.0);outline:4px solid rgba(45,212,191,0);
    transition:all .6s cubic-bezier(.2,.8,.2,1);opacity:0}
  #pqv-spot.on{opacity:1;box-shadow:0 0 0 9999px rgba(10,30,29,.48);outline-color:rgba(45,212,191,.95)}
  #root{transition:transform 1s cubic-bezier(.65,0,.35,1);will-change:transform}
  [data-testid="policy-notice-banner"],[data-testid="right-dock-fab"]{display:none!important}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const layer = document.createElement('div'); layer.id = 'pqv-layer';
  layer.innerHTML = `<div id="pqv-spot"></div><div id="pqv-chip"><i></i><span></span></div><div id="pqv-cap"></div>
    <div id="pqv-cur"><svg width="34" height="40" viewBox="0 0 34 40"><path d="M3 2 L3 32 L11 25 L17 38 L22.5 35.5 L16.5 23 L28 23 Z" fill="#fff" stroke="#0F2E2C" stroke-width="2.4" stroke-linejoin="round"/></svg></div>`;
  document.documentElement.appendChild(layer);
  const $ = (id) => document.getElementById(id);

  // 화면 잡음(안내 배너·설치 카드) 숨김 — 글자로 찾아 그 띠 전체를 숨긴다
  const HIDE = [['디바이스 알림', 110], ['고객이 아직 이 대화를', 150], ['PlanQ 앱으로 설치', 90], ['출근으로 기록', 0]];
  const sweep = () => {
    for (const [txt, maxH] of HIDE) {
      const leaf = [...document.querySelectorAll('#root *')].find((e) => e.children.length <= 2 && (e.textContent || '').trim().startsWith(txt) && e.offsetParent);
      if (!leaf || !maxH) continue;
      let el = leaf;
      while (el.parentElement && el.parentElement.id !== 'root' && el.parentElement.getBoundingClientRect().height <= maxH) el = el.parentElement;
      el.style.setProperty('display', 'none', 'important');
    }
  };
  new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true });
  sweep();

  let cx = 960, cy = 620;
  window.__pq = {
    caption(html, sub) {
      const cap = $('pqv-cap');
      // 단어 단위로 쪼개 순서대로 올라오게 (em 은 한 덩어리)
      const tmp = document.createElement('div'); tmp.innerHTML = html;
      let i = 0; const wrap = (node) => {
        const out = [];
        node.childNodes.forEach((n) => {
          if (n.nodeType === 3) n.textContent.split(/(\s+)/).forEach((w) => { if (!w) return; if (/^\s+$/.test(w)) out.push(w); else out.push(`<span class="pqv-w" style="transition-delay:${(i++) * 70}ms">${w}</span>`); });
          else out.push(`<span class="pqv-w" style="transition-delay:${(i++) * 70}ms">${n.outerHTML}</span>`);
        });
        return out.join('');
      };
      cap.className = ''; cap.innerHTML = `<div class="pqv-line">${wrap(tmp)}</div>` + (sub ? `<div class="pqv-sub">${sub}</div>` : '');
      void cap.offsetWidth; requestAnimationFrame(() => cap.classList.add('pqv-show'));
    },
    hideCaption() { $('pqv-cap').classList.add('pqv-hide'); },
    chip(label) { const c = $('pqv-chip'); c.querySelector('span').textContent = label; c.classList.add('on'); },
    chipOff() { $('pqv-chip').classList.remove('on'); },
    cursorAt(x, y) { const c = $('pqv-cur'); c.style.transition = 'none'; c.style.transform = `translate(${x}px,${y}px)`; void c.offsetWidth; c.style.transition = ''; c.classList.add('on'); cx = x; cy = y; },
    move(x, y, ms = 800) { const c = $('pqv-cur'); c.classList.add('on'); c.style.transitionDuration = ms + 'ms'; c.style.transform = `translate(${x}px,${y}px)`; cx = x; cy = y; },
    press() {
      const c = $('pqv-cur'); c.classList.add('press'); setTimeout(() => c.classList.remove('press'), 160);
      const r = document.createElement('div'); r.className = 'pqv-ripple'; r.style.left = (cx + 4) + 'px'; r.style.top = (cy + 3) + 'px';
      $('pqv-layer').appendChild(r); setTimeout(() => r.remove(), 800);
    },
    cursorOff() { $('pqv-cur').classList.remove('on'); },
    spot(x, y, w, h, pad = 10) { const s = $('pqv-spot'); Object.assign(s.style, { left: (x - pad) + 'px', top: (y - pad) + 'px', width: (w + pad * 2) + 'px', height: (h + pad * 2) + 'px' }); s.classList.add('on'); },
    spotOff() { $('pqv-spot').classList.remove('on'); },
    zoom(x, y, s) { const r = document.getElementById('root'); r.style.transformOrigin = `${x}px ${y}px`; r.style.transform = `scale(${s})`; $('pqv-layer').classList.add('zoomed'); },
    unzoom() { document.getElementById('root').style.transform = 'none'; $('pqv-layer').classList.remove('zoomed'); },
    sweep,
  };
})();
