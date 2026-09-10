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
const ANDROID_PACKAGE = 'app.planq';   // capacitor.config.ts appId · android/app/build.gradle applicationId

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
 * Android 용 intent URL — Chrome(Custom Tab 포함)이 **설치된 앱이 있으면 앱을, 없으면
 * `browser_fallback_url` 을** 연다. 스킴 링크를 그냥 누르면 앱이 없을 때 `planq` 를 호스트로
 * 읽어 ERR_NAME_NOT_RESOLVED 가 났다(2026-09-06 안드로이드 태블릿 실측). intent 는 그 분기를
 * 브라우저가 대신 한다.
 */
function androidIntentUrl(params = {}, fallbackUrl) {
  const scheme = nativeReturnUrl(params);                      // planq://oauth/native-return?…
  const rest = scheme.slice(`${NATIVE_SCHEME}://`.length);     // oauth/native-return?…
  let extras = `scheme=${NATIVE_SCHEME};package=${ANDROID_PACKAGE}`;
  if (fallbackUrl) extras += `;S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`;
  return `intent://${rest}#Intent;${extras};end`;
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
 *
 * ★★ 2026-09-10 — 버튼이 **https App Link** 를 가리키던 것이 iOS 를 망가뜨렸다 (Irene 아이폰:
 *   "이 버튼으로 돌아가면 번호 안눌러도 로그인이 되는데… 팝업이 열린 상태야. 닫으면 다시
 *   로그인화면이 뒤에 있던게 나와"). 운영 refresh_tokens 실측: 그 순간 만들어진 세션의 UA 가
 *   `iPhone … Version/26.6.1`(= SFSafariViewController) 이고 client_kind=web 이었다.
 *   원인: iOS 는 **지금 보고 있는 도메인과 같은 도메인의 Universal Link 를 탭해도 앱을 열지
 *   않는다**(브라우저 안 이동으로 처리). 그래서 버튼이 팝오버 안에서 SPA→web-return 으로 흘러
 *   **팝오버 안에 웹 세션**을 심었고, 뒤의 앱은 아무것도 못 받았다. Android Chrome 도 같은 사이트
 *   안 이동에는 App Link 를 안 건다. 즉 https 링크는 **어느 플랫폼에서도 앱을 열지 못한다** —
 *   그것이 여는 것은 언제나 브라우저 세션이다.
 *   → 앱을 여는 1차 버튼은 **iOS: 커스텀 스킴**(사용자 탭이면 SFSVC 가 "PlanQ에서 열기" 를 띄운다),
 *     **Android: intent://**(앱 있으면 앱, 없으면 fallback). https 는 "앱 없이 브라우저에서 계속"
 *     이라는 **명시적 선택지**로만 남긴다. 자동으로 https 로 떠나는 코드는 없다(F-1 도 그대로 지킨다:
 *     코드가 있는 화면은 스스로 떠나지 않는다).
 *   → 문구에서 "앱으로 돌아가기" 를 뺐다 — 팝오버는 앱 위에 떠 있어 사용자에겐 여기가 곧 앱이다
 *     (Irene: "앱으로 돌아가기 버튼은 말이 안돼. 여기가 앱인데").
 *   → 6자리 코드는 **접어 둔다**("앱이 열리지 않나요?"). 대부분은 버튼 한 번으로 끝나야 하고,
 *     코드는 스킴 탭까지 실패한 기기의 마지막 길이다.
 *
 * @param {object} params  planq:// 쿼리 (code · new · confirm · kind …)
 * @param {object} opts
 *   title       화면 제목 (흐름마다 다르다 — 로그인/연결 확인/연동 완료)
 *   pairCode    6자리 (로그인 흐름에서만). 있으면 접힌 코드 블록을 그린다
 *   webUrl      앱 없이 **이 브라우저에서** 끝내는 URL (web-return). Android intent 의 fallback 으로도 쓴다
 *   altUrl/altLabel  코드 없는 흐름의 다른 길 (연결 확인 페이지 등)
 *   userAgent   플랫폼 판정용. 없으면 res.req 에서 읽는다
 */
function sendNativeReturn(res, params = {}, opts = {}) {
  const url = nativeReturnUrl(params);
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const ua = String(opts.userAgent || (res.req && typeof res.req.get === 'function' && res.req.get('user-agent')) || '');
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const webUrl = opts.webUrl ? String(opts.webUrl) : '';
  // 1차(앱 열기) 링크 — 플랫폼별. 그 외(데스크탑 등)는 스킴.
  const primaryHref = isAndroid ? androidIntentUrl(params, webUrl || undefined) : url;
  const primary = esc(primaryHref);
  const pairCode = opts.pairCode ? esc(opts.pairCode) : '';
  const title = esc(opts.title || 'PlanQ 로 돌아갑니다');
  const altUrl = opts.altUrl ? esc(opts.altUrl) : '';
  const altLabel = esc(opts.altLabel || '계속하기');
  const web = webUrl ? esc(webUrl) : '';
  const primaryLabel = esc(opts.primaryLabel || 'PlanQ 계속하기');
  // 플랫폼별 한 줄 안내 — iOS 는 시스템 확인 창이 한 번 뜬다.
  const hint = isIos
    ? '확인 창이 뜨면 ‘열기’ 를 누르세요.'
    : (isAndroid ? '잠시 뒤 앱이 열리지 않으면 아래 버튼을 누르세요.' : '아래 버튼을 누르면 앱이 열립니다.');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  return res.status(200).send(`<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PlanQ</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",sans-serif;
       background:#F8FAFC;color:#0F172A;padding:24px;text-align:center}
  .c{max-width:340px;width:100%}
  h1{font-size:17px;font-weight:700;margin:0 0 8px}
  p{font-size:14px;line-height:1.7;color:#475569;margin:0 0 18px}
  a.btn{display:block;text-decoration:none;padding:14px 22px;border-radius:10px;
    background:#115E59;color:#fff;font-size:15px;font-weight:600;margin:0 0 12px}
  a.s{display:block;text-decoration:none;padding:12px 18px;border-radius:10px;
    background:#fff;color:#0F172A;border:1px solid #CBD5E1;font-size:14px;font-weight:600;margin:0 0 12px}
  details{margin-top:18px;text-align:left;border-top:1px solid #E2E8F0;padding-top:12px}
  summary{cursor:pointer;font-size:13px;color:#475569;font-weight:600;text-align:center;list-style:none}
  summary::-webkit-details-marker{display:none}
  summary::after{content:' ▾';color:#94A3B8}
  details[open] summary::after{content:' ▴'}
  .step{font-size:13px;color:#475569;line-height:1.7;margin:12px 0 6px}
  .codebox{border:1px solid #CBD5E1;border-radius:12px;background:#fff;padding:14px 12px;margin:6px 0 10px;text-align:center}
  .code{font-size:30px;font-weight:800;letter-spacing:6px;color:#0F172A;font-variant-numeric:tabular-nums}
  .hint{font-size:12px;color:#94A3B8;margin:6px 0 0;line-height:1.6;text-align:center}
</style></head><body><div class="c">
<h1>${title}</h1>
<p>${esc(hint)}</p>
<a class="btn" id="go" href="${primary}">${primaryLabel}</a>
${altUrl ? `<a class="s" id="alt" href="${altUrl}">${altLabel}</a>` : ''}
${pairCode || web ? `<details id="more">
<summary>앱이 열리지 않나요?</summary>
${pairCode ? `<p class="step">① 이 창을 닫으세요(‘완료’ 또는 아래로 쓸어내리기). PlanQ 에 뜨는 칸에 이 코드를 입력하면 로그인이 끝납니다.</p>
<div class="codebox"><div class="code">${pairCode.slice(0, 3)} ${pairCode.slice(3)}</div>
<p class="hint">10분 동안 유효합니다. 다른 사람에게 알려주지 마세요.</p></div>` : ''}
${web ? `<p class="step">${pairCode ? '②' : ''} 앱 없이 쓰려면 이 브라우저에서 계속할 수 있습니다.</p>
<a class="s" id="web" href="${web}">이 브라우저에서 계속</a>` : ''}
</details>` : ''}
</div><script>
  // 스킴 자동 시도 — **실패해도 이 페이지는 남는다**(핸들러가 없으면 이동 자체가 취소된다).
  //   Android Custom Tab 은 여기서 앱이 열린다. iOS 의 SFSafariViewController 는 JS 가 시작한
  //   커스텀 스킴 이동을 무시하므로 **사람이 위 버튼을 눌러야** 한다(그 탭은 연다).
  //   ★ https 로 자동 이동하는 코드는 두지 않는다 — 같은 도메인이라 어느 플랫폼에서도 앱을 열지
  //     못하고, 이 팝오버 안에 웹 세션만 심는다(2026-09-10 실측). 코드가 있는 화면은 떠나지 않는다(F-1).
  try { location.replace(${JSON.stringify(url)}); } catch (e) {}
  setTimeout(function(){ try { location.href = ${JSON.stringify(url)}; } catch (e) {} }, 400);
</script></body></html>`);
}

module.exports = { NATIVE_SCHEME, ANDROID_PACKAGE, nativeReturnUrl, androidIntentUrl, sendNativeReturn };
