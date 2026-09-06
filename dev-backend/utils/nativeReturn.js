// 네이티브 앱 복귀 URL — OAuth(로그인·개인 연동)가 시스템 브라우저에서 앱으로 돌아오는 통로.
//
// ★ 왜 커스텀 스킴인가 (2026-08-25 운영 실측):
//   원래는 `/oauth/native-return` 상대경로로 302 해서 Universal Link(iOS)/App Links(Android)가
//   앱을 깨우게 했다. 그런데 **iOS 는 같은 도메인 안에서의 이동으로는 Universal Link 를 발화하지
//   않는다.** 우리 콜백(`planq.kr/api/auth/google/callback`)이 같은 `planq.kr` 경로로 302 하므로
//   OS 가 앱을 열지 않고 SFSafariViewController 에 그대로 남는다 → SPA 에 그 경로가 없어
//   랜딩으로 튕기고, 사용자에겐 "창이 안 닫히고 로그인이 안 됨" 으로 보인다.
//   (드물게 성공하는 것이 더 나쁘다 — 3번 시도해야 열리는 복불복이 된다.)
//
//   커스텀 스킴(`planq://`)은 도메인 개념이 없어 항상 앱으로 넘어간다. 스킴은 이미
//   iOS Info.plist(CFBundleURLTypes) 와 AndroidManifest(intent-filter) 에 등록돼 있으므로
//   앱 재빌드 없이 서버 리다이렉트만 바꾸면 된다.
//
//   수신부: dev-frontend `components/NativeBridge.tsx` 의 appUrlOpen — https 경로와 커스텀 스킴
//   양쪽을 모두 인식한다(알림 딥링크는 여전히 Universal Link 를 쓴다).
const NATIVE_SCHEME = 'planq';

/** `planq://oauth/native-return?...` 절대 URL 생성. params 는 객체. */
function nativeReturnUrl(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const q = qs.toString();
  return `${NATIVE_SCHEME}://oauth/native-return${q ? `?${q}` : ''}`;
}

/**
 * 네이티브 복귀를 **응답으로 착지**시킨다. `res.redirect(302, 'planq://...')` 를 쓰지 말 것.
 *
 * ★ 2026-09-04 운영 실측 (Irene: "구글로그인 하는데 다 하고 나서 다시 로그인 나와.
 *   로그인 되도 뒤에 사인인 화면이 그대로 남아있어. 그 위에 팝업처럼 화면이 떠"):
 *   iOS 의 SFSafariViewController(= @capacitor/browser 가 여는 창)는 **서버 302 로 온
 *   커스텀 스킴을 열지 않는다.** 사용자 탭이나 페이지 안 JS 이동은 열지만 리다이렉트는 무시한다.
 *   그래서 창이 그대로 남고, 앱 WebView 는 code 를 못 받아 로그인 화면에 머문다.
 *   이 문제는 "가끔 되는" 것이 아니라 **항상** 이렇게 된다.
 *
 *   해결: 302 대신 아주 작은 HTML 을 돌려주고 그 안에서 `location.replace('planq://…')`.
 *   자동 이동이 막히는 환경을 위해 사용자가 직접 누를 수 있는 링크도 같이 남긴다
 *   (버튼이 없으면 사용자는 창을 닫는 것 말고 할 수 있는 일이 없다).
 */
function sendNativeReturn(res, params = {}, opts = {}) {
  const url = nativeReturnUrl(params);
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const safe = esc(url);
  // ★ 2026-09-06 운영 실측 (Irene, 안드로이드 태블릿):
  //   "로그인한 후 앱으로 돌아가기 버튼 누르면 웹으로 가서 그냥 dns 에러나와. This site can't be reached."
  //   이 페이지의 탈출구가 **커스텀 스킴 하나뿐**이었다. 앱이 없거나(안드로이드는 Play 심사 중이라
  //   설치본이 없다) 스킴 핸들러가 없으면 브라우저가 `planq` 를 **호스트 이름으로 해석**해
  //   ERR_NAME_NOT_RESOLVED 를 낸다. 서버에서 로그인은 이미 성공했는데 세션을 받을 길이 막힌다.
  //   → **웹으로 이어가는 길을 항상 같이 준다.** 스킴 이동이 성공하면 이 페이지는 백그라운드로
  //     가므로, 잠시 뒤에도 화면이 보이면 = 앱이 없다는 뜻이라 그때 폴백을 크게 띄운다.
  const webUrl = opts.webFallbackUrl ? esc(opts.webFallbackUrl) : '';
  // ★ 앱을 여는 길을 **둘** 준다 (2026-09-06).
  //   ① planq:// 커스텀 스킴 — 스킴 핸들러가 등록된 빌드에서만 열린다. 없으면 브라우저가
  //      `planq` 를 호스트로 읽어 ERR_NAME_NOT_RESOLVED("This site can't be reached").
  //   ② https App Link — assetlinks.json 이 서빙되고 서명이 맞으면 앱이 가로챈다.
  //      **안 잡혀도 실재하는 주소**라 SPA 의 /oauth/native-return 이 받아 로그인을 끝낸다.
  //      즉 ②는 어느 쪽으로 가든 막다른 길이 아니다.
  const appLink = opts.appLinkUrl ? esc(opts.appLinkUrl) : '';
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  return res.status(200).send(`<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PlanQ</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",sans-serif;
       background:#F8FAFC;color:#0F172A;padding:24px;text-align:center}
  .c{max-width:340px}
  h1{font-size:17px;font-weight:700;margin:0 0 8px}
  p{font-size:14px;line-height:1.7;color:#475569;margin:0 0 20px}
  a{display:block;text-decoration:none;padding:14px 22px;border-radius:10px;
    font-size:15px;font-weight:600;margin:0 0 10px}
  a.p{background:#115E59;color:#fff}
  a.s{background:#fff;color:#0F172A;border:1px solid #CBD5E1}
</style></head><body><div class="c">
<h1>PlanQ 로 돌아갑니다</h1>
<p id="msg">잠시만 기다려 주세요.</p>
<a class="p" id="go" href="${appLink || safe}">PlanQ 앱에서 열기</a>
${webUrl ? `<a class="s" id="web" href="${webUrl}">이 브라우저에서 계속하기</a>` : ''}
</div><script>
  // 앱이 있으면 스킴이 먼저 낚아채 이 페이지는 백그라운드로 간다.
  try { location.replace(${JSON.stringify(url)}); } catch (e) {}
  setTimeout(function(){ try { location.href = ${JSON.stringify(url)}; } catch (e) {} }, 400);
${appLink ? `  // 스킴이 안 먹었으면 App Link 로 한 번 더 — 앱이 가로채면 앱이 뜨고,
  //   못 가로채도 실재하는 https 주소라 SPA 착지 페이지가 로그인을 끝낸다.
  setTimeout(function(){
    if (document.visibilityState !== 'visible') return;   // 앱이 이미 떴다
    location.replace(${JSON.stringify(opts.appLinkUrl)});
  }, 1400);` : ''}
${webUrl && !appLink ? `  // ★ 2026-09-06 — 앱이 없으면 스킴은 **막다른 길**이다(브라우저가 planq 를 호스트로 읽어
  //   ERR_NAME_NOT_RESOLVED). 처음 고칠 때 폴백을 "1.6초 뒤에 뜨는 보조 버튼" 으로 뒀더니
  //   Irene 이 그대로 큰 버튼(앱으로 돌아가기)을 다시 눌러 **같은 DNS 오류**를 봤다.
  //   → 고르게 하지 말고 **자동으로 웹으로 넘어간다.** 앱이 열렸으면 이 페이지는 숨겨져 있으므로
  //     visibility/focus 검사에서 걸러진다(그때는 넘어가지 않는다 — 일회용 code 를 뺏지 않게).
  var done = false;
  function toWeb() {
    if (done) return;
    // ★ hasFocus() 를 쓰지 말 것 — **인앱 브라우저(Custom Tab)에서는 화면이 보여도 false** 가 나와
    //   자동 이동이 통째로 막힌다(2026-09-06: Irene 이 그래서 수동으로 버튼을 눌렀고, 그때는
    //   이미 코드가 만료돼 있었다). 앱이 열렸는지의 신호는 visibilityState 하나면 충분하다.
    if (document.visibilityState !== 'visible') return;  // 앱이 떴다 — 코드를 뺏지 않는다
    done = true;
    document.getElementById('msg').textContent = '앱이 없어 이 브라우저에서 이어갑니다…';
    location.replace(${JSON.stringify(opts.webFallbackUrl)});
  }
  setTimeout(toWeb, 1800);` : ''}
</script></body></html>`);
}

module.exports = { NATIVE_SCHEME, nativeReturnUrl, sendNativeReturn };
