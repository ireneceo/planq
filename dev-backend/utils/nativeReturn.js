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
  // ★ 브라우저용 "계속하기" 버튼은 두지 않는다 (Irene 2026-09-06: "없애. 완벽히 해").
  //
  // ★★ 코드가 있으면 **이 화면은 스스로 떠나지 않는다** (2026-09-06 Fable 재게이트 F-1):
  //   앞 판은 1.4초 뒤 App Link 로 `location.replace` 했는데, 앱이 못 가로채면 그대로
  //   브라우저가 SPA 로 넘어가 **코드가 화면에서 사라졌다**(실측 t=2.8s: code visible false).
  //   딥링크가 실패하는 바로 그 기기가 코드를 가장 필요로 하는데 읽을 시간이 없었다.
  //   주석에는 "못 가로채면 이 화면에 남는다" 고 써 있었다 — 자기 JS 와 모순이었다.
  //   → 코드가 있으면 **자동 이동 금지**. 스킴 시도만 한다(실패해도 페이지가 남는다).
  //     App Link 는 이 흐름에서 **아예 내보내지 않는다**(자동 이동도, 누를 버튼도 없다) —
  //     떠나는 순간 코드를 잃기 때문이다. 앱을 여는 시도는 스킴 하나로 족하고, 그것이 실패해도
  //     페이지가 남아 코드를 읽을 수 있다. 코드가 **없는** 흐름에서만 App Link 사다리를 쓴다.
  const appLink = opts.appLinkUrl ? esc(opts.appLinkUrl) : '';
  const pairCode = opts.pairCode ? esc(opts.pairCode) : '';
  // 화면 성격 — 로그인 복귀 / 연결 확인 / 연동 완료가 같은 제목을 쓰면 거짓말이 된다.
  const title = esc(opts.title || 'PlanQ 로 돌아갑니다');
  // 코드가 없는 흐름(연결 확인 등)의 **다른 길** — 없으면 막다른 길이 된다.
  const altUrl = opts.altUrl ? esc(opts.altUrl) : '';
  const altLabel = esc(opts.altLabel || '계속하기');
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
  p{font-size:14px;line-height:1.7;color:#475569;margin:0 0 18px}
  a{display:block;text-decoration:none;padding:14px 22px;border-radius:10px;
    background:#115E59;color:#fff;font-size:15px;font-weight:600;margin:0 0 12px}
  a.s{background:#fff;color:#0F172A;border:1px solid #CBD5E1}
  .codebox{border:1px solid #CBD5E1;border-radius:12px;background:#fff;padding:16px 12px;margin:4px 0 12px}
  .lbl{font-size:12px;color:#64748B;margin:0 0 6px}
  .code{font-size:30px;font-weight:800;letter-spacing:6px;color:#0F172A;
        font-variant-numeric:tabular-nums}
  .hint{font-size:12px;color:#94A3B8;margin:8px 0 0;line-height:1.6}
</style></head><body><div class="c">
<h1>${title}</h1>
${pairCode ? `<div class="codebox">
<p class="lbl">앱에 이 코드를 입력하세요</p>
<div class="code">${pairCode.slice(0, 3)} ${pairCode.slice(3)}</div>
<p class="hint">10분 동안 유효합니다. 다른 사람에게 알려주지 마세요.</p>
</div>
<p class="hint">앱이 저절로 열렸다면 이 화면은 닫으셔도 됩니다.</p>`
: `<p>잠시만 기다려 주세요. 화면이 바뀌지 않으면 아래 버튼을 눌러 주세요.</p>`}
${appLink && !pairCode ? `<a id="go" href="${appLink}">PlanQ 앱에서 열기</a>` : ''}
${!appLink && !pairCode ? `<a id="go" href="${safe}">PlanQ 앱에서 열기</a>` : ''}
${altUrl ? `<a class="s" id="alt" href="${altUrl}">${altLabel}</a>` : ''}
</div><script>
  // 스킴 시도 — **실패해도 이 페이지는 남는다**(핸들러가 없으면 이동 자체가 취소된다).
  try { location.replace(${JSON.stringify(url)}); } catch (e) {}
  setTimeout(function(){ try { location.href = ${JSON.stringify(url)}; } catch (e) {} }, 400);
${appLink && !pairCode ? `  // 코드가 없는 흐름에서만 App Link 로 한 번 더 자동 시도한다.
  //   코드가 있으면 **자동 이동하지 않는다** — 떠나면 코드를 못 읽는다(F-1).
  setTimeout(function(){
    if (document.visibilityState !== 'visible') return;
    location.replace(${JSON.stringify(opts.appLinkUrl)});
  }, 1400);` : ''}
</script></body></html>`);
}

module.exports = { NATIVE_SCHEME, nativeReturnUrl, sendNativeReturn };
