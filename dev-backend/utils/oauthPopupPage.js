// OAuth 연동 팝업의 마지막 화면 — 개인 연동(external_connections)·회사 공용 연동(cloud_oauth)이 같이 쓰는 한 벌.
//
// ★ 2026-10-12 (Irene: "캘린더 고르기 … 연동 완료 / 닫기 / 잠시 후 자동으로 닫힙니다… 그런데 안 닫혀"):
//   이 화면은 예전에 **인라인 <script>** 로 닫기 버튼·자동 닫기·완료 신호를 다 했다. 그런데 백엔드 응답에는
//   helmet 기본 CSP(`script-src 'self'; script-src-attr 'none'`)가 붙어 **인라인 스크립트가 한 줄도 안 돌았다**
//   (2026-04 초기 세팅부터). 그래서 닫기 무반응 · «자동으로 닫힙니다» 가 영원히 남음 · 완료 신호가 안 나가
//   원래 화면도 안 바뀌었다. 2026-08-24 «닫기 되게 해» 수리도 같은 인라인 안이라 한 번도 실행되지 않았다.
//   → 스크립트는 같은 출처 파일(`routes/oauth_popup.js` 의 /api/oauth/popup-done.js)로 뺀다. CSP 를 넓히지 않는다.
//     값은 body 의 data- 속성으로 넘기고, onclick 같은 인라인 핸들러도 쓰지 않는다(script-src-attr 'none').
//   예전엔 두 파일이 서로 베낀 두 벌이라 타이머(600/800)·문구가 이미 갈라져 있었다.
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 스크립트 주소 — 바꾸면 routes/oauth_popup.js 와 같이.
const POPUP_SCRIPT_SRC = '/api/oauth/popup-done.js?v=2';

/**
 * @param {object} o
 * @param {string} o.type      완료 신호 종류 — 'personal:connected' | 'gcal:connected' | 'gdrive:connected'
 * @param {boolean} o.ok
 * @param {string|null} [o.provider]
 * @param {string} o.title     창 제목 (이스케이프됨)
 * @param {string} o.body      본문 HTML — **호출부가 바깥 값을 escHtml 한 뒤** 넘긴다
 */
function oauthPopupHtml({ type, ok, provider, title, body }) {
  const doneTitle = ok ? '✓ 연동이 끝났습니다' : '연동하지 못했습니다';
  const doneText = ok
    ? '원래 화면에 이미 반영됐습니다.'
    : '원래 화면으로 돌아가 다시 시도해 주세요.';
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F8FAFC;color:#0F172A;padding:16px;box-sizing:border-box;}
  .box{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:28px 32px;max-width:420px;width:100%;box-sizing:border-box;text-align:center;box-shadow:0 4px 12px rgba(15,23,42,0.06);}
  h2{margin:0 0 10px;font-size:18px;color:${ok ? '#0F766E' : '#DC2626'};}
  p{margin:0 0 16px;font-size:13px;color:#475569;line-height:1.55;}
  button{height:36px;padding:0 18px;background:#14B8A6;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;}
  button:hover{background:#0D9488;}
  .hint{font-size:11.5px;color:#94A3B8;margin-top:8px;}
  #fallback{display:none;}
</style></head>
<body data-type="${escHtml(type)}" data-ok="${ok ? '1' : '0'}" data-provider="${escHtml(provider || '')}">
  <div class="box" id="primary">
    ${body}
    <button type="button" id="closeBtn">닫기</button>
    <div class="hint">창이 닫히지 않으면 직접 닫아 주세요.</div>
  </div>
  <div class="box" id="fallback">
    <h2>${doneTitle}</h2>
    <p><strong>이 창을 닫아 주세요.</strong> (탭 닫기 또는 ⌘W / Ctrl+W)<br/>
    구글 로그인을 거친 창은 브라우저 보안 정책상 <b>자동으로 닫히지 않을 수 있습니다.</b><br/>
    ${doneText}</p>
  </div>
  <script src="${POPUP_SCRIPT_SRC}"></script>
</body></html>`;
}

module.exports = { oauthPopupHtml, escHtml, POPUP_SCRIPT_SRC };
