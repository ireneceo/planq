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
function sendNativeReturn(res, params = {}) {
  const url = nativeReturnUrl(params);
  const safe = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  return res.status(200).send(`<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PlanQ</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",sans-serif;
       background:#F8FAFC;color:#0F172A;padding:24px;text-align:center}
  .c{max-width:320px}
  h1{font-size:17px;font-weight:700;margin:0 0 8px}
  p{font-size:14px;line-height:1.7;color:#475569;margin:0 0 20px}
  a{display:inline-block;background:#115E59;color:#fff;text-decoration:none;
    padding:14px 22px;border-radius:10px;font-size:15px;font-weight:600}
</style></head><body><div class="c">
<h1>PlanQ 로 돌아갑니다</h1>
<p>잠시만 기다려 주세요. 화면이 바뀌지 않으면 아래 버튼을 눌러 주세요.</p>
<a id="go" href="${safe}">PlanQ 앱으로 돌아가기</a>
</div><script>
  // 즉시 이동 — SFSafariViewController 는 302 는 무시하지만 이 이동은 앱을 연다.
  try { location.replace(${JSON.stringify(url)}); } catch (e) {}
  // 일부 환경은 첫 시도를 삼킨다. 짧게 한 번 더.
  setTimeout(function(){ try { location.href = ${JSON.stringify(url)}; } catch (e) {} }, 400);
</script></body></html>`);
}

module.exports = { NATIVE_SCHEME, nativeReturnUrl, sendNativeReturn };
