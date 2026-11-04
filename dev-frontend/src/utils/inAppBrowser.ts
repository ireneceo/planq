// 메신저·SNS 앱 «안의» 브라우저 감지 — 구글이 그 안에서 로그인을 거절한다(403 disallowed_useragent).
//
// 2026-11-04 Irene «권고대로» — 초대 링크를 카카오톡으로 보내는 일이 많아 고객이 구글을 누르면 막힌다.
//   PlanQ 앱(Capacitor)은 여기서 판정하지 않는다 — 앱은 시스템 브라우저로 따로 연다(services/oauth.ts).
//
// 빠져나가는 길:
//   카카오톡   → kakaotalk://web/openExternal (카카오가 공식으로 여는 바깥 브라우저)
//   안드로이드 → intent:// 로 크롬(없으면 기본 브라우저 — browser_fallback_url)
//   아이폰 기타 앱 → 자동으로 나갈 길이 없다. 주소 복사 + «사파리로 열기» 안내만.
export type InAppKind = 'kakao' | 'android' | 'ios' | null;

const IN_APP_UA = /NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|DaumApps|everytimeApp|BAND\/|Snapchat|Twitter|TikTok|musical_ly|; wv\)/i;

export function detectInAppBrowser(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): InAppKind {
  if (!ua) return null;
  if (/KAKAOTALK/i.test(ua)) return 'kakao';
  if (!IN_APP_UA.test(ua)) return null;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return null;
}

/** 바깥 브라우저로 같은 주소를 연다. 자동으로 열 수 있으면 true(아이폰 기타 앱은 false). */
export function openInExternalBrowser(kind: InAppKind, href: string = window.location.href): boolean {
  let target = '';
  if (kind === 'kakao') target = `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
  else if (kind === 'android') {
    const u = new URL(href);
    target = `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
  }
  if (!target) return false;
  // ★ 숨은 링크를 눌러 연다 — 창 주소(location.href)를 바꾸면 그 앱이 주소를 못 받았을 때(옛 카톡·크롬 없는 폰)
  //   창이 «이동 중» 에 걸려 안내의 [주소 복사] 가 눌리지 않았다(2026-11-04 실측). 안내가 먼저 그려지도록 한 박자 뒤에.
  window.setTimeout(() => {
    const a = document.createElement('a');
    a.href = target; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
  }, 50);
  return true;
}
