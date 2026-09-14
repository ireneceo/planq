import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'ko'],

    ns: ['common', 'auth', 'layout', 'profile', 'qnote', 'settings', 'qtalk', 'qtask', 'qproject', 'qdocs', 'qfile', 'clients', 'qcalendar', 'plan', 'legal', 'admin', 'dashboard', 'qbill', 'knowledge', 'insights', 'qtable', 'landing', 'errors', 'focus', 'qmail', 'qsale', 'wiki', 'org', 'appdownload', 'attendance', 'guest'],
    defaultNS: 'common',

    backend: {
      // 빌드 시점의 고정 ID 를 쿼리스트링으로 부착 → 새 배포 후 브라우저가 새 JSON 을 강제로 받음
      // 기존 빌드 JS 는 기존 ID 유지하므로 같은 배포 내에선 캐시 유효
      loadPath: `/locales/{{lng}}/{{ns}}.json?v=${typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}`,
    },

    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },

    interpolation: {
      escapeValue: false,
    },

    partialBundledLanguages: true,

    react: {
      useSuspense: false,
    },
  });

// ── 네이티브 앱 언어 보정 (2026-09-04) ──────────────────────────────────────────
// Irene: "사인인은 로그인 아니잖아. 왜 로그인 안나오고 사인인만 나와? 앱이 왜 달라?"
//
// iOS 앱 번들이 `CFBundleDevelopmentRegion: en` 이고 `CFBundleLocalizations` 가 없어서,
// WKWebView 의 `navigator.language` 가 **기기 언어와 무관하게 `en`** 을 돌려준다.
// 그래서 detection order 의 'navigator' 가 항상 en 을 집는다. 웹은 정상이다
// (실측: 새 방문자 ko-KR → 한국어). **앱에서만** 영어로 뜬 이유가 이것이다.
//
// 그동안 안 보였던 이유: 앱에 옛 `i18nextLng` 가 남아 있었다. 고객처럼 지우고 새로 받으면
// localStorage 가 비어 navigator 로 떨어지면서 처음 드러난다.
//
// 여기서는 Capacitor Device 플러그인으로 **기기 언어를 직접** 읽어 덮는다.
// 사용자가 이미 언어를 골랐으면(localStorage 값 존재) 건드리지 않는다.
// 앱 번들(Info.plist) 도 같이 고치는 것이 정석이지만, 그건 앱 재배포가 필요하고
// 이쪽은 **웹 배포만으로 즉시 반영**된다(앱이 운영 웹을 그대로 띄우는 껍데기라서).
(async () => {
  try {
    if (typeof window === 'undefined') return;
    const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.();
    if (!isNative) return;
    if (localStorage.getItem('i18nextLng')) return;   // 사용자가 고른 값 존중
    const { Device } = await import('@capacitor/device');
    const { value } = await Device.getLanguageTag();   // 예: 'ko-KR'
    const base = String(value || '').toLowerCase().split('-')[0];
    if (base === 'ko' || base === 'en') await i18n.changeLanguage(base);
  } catch { /* 실패하면 기존 감지 결과 그대로 — 회귀 0 */ }
})();

// ── <html lang> 을 실제 화면 언어에 맞춘다 (2026-09-14) ────────────────────────
// `index.html` 은 `lang="en"` 으로 **고정**이었다. 공개 링크(무인증 미리보기)를 여는 고객사
// 브라우저는 이 값을 보고 ①번역 제안 ②화면낭독기 발음 ③`:lang()` 규칙을 정한다.
// 한국어로 그려 놓고 `lang="en"` 이라고 적어 두면 크롬이 한국어 문서를 영어로 오인해
// "이 페이지를 번역하시겠습니까?" 를 거꾸로 띄운다. 감지 결과를 그대로 반영한다.
const syncHtmlLang = (lng?: string) => {
  try {
    const base = String(lng || i18n.language || 'en').split('-')[0];
    if (typeof document !== 'undefined') document.documentElement.lang = base;
  } catch { /* 문서가 없거나 접근 불가 — 표시에만 쓰이므로 삼킨다 */ }
};
i18n.on('languageChanged', syncHtmlLang);
i18n.on('initialized', () => syncHtmlLang());
syncHtmlLang();

export default i18n;
