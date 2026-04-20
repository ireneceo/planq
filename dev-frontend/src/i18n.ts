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

    ns: ['common', 'auth', 'layout', 'profile', 'qnote', 'settings', 'qtalk', 'qtask', 'qproject', 'clients', 'qcalendar'],
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

export default i18n;
