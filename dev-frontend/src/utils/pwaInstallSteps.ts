// PWA «앱 설치» 메뉴 경로 — 브라우저별 단계 (2026-10-15 설정 > 앱 설치에서 떼어 냄)
//   설정 > 알림 > 앱 설치(PwaInstallSection)와 공개 앱 다운로드 페이지(/app)가 같은 함수를 쓴다.
//   t 는 `settings` 네임스페이스에 묶인 것을 넘긴다(키 pwa.steps.*).
//   ★ macOS Sonoma(Safari 17)부터 «파일 → Dock에 추가» 로 웹 앱을 설치할 수 있다 — 옛 «지원 안 함» 문구를 바꿨다.
import type { TFunction } from 'i18next';

export function getManualSteps(platform: string, t: TFunction): string[] {
  switch (platform) {
    case 'android-chrome':
      return [
        t('pwa.steps.androidChrome.1', '주소창 우측의 ⋮ (세로 점 3개) 메뉴를 엽니다') as string,
        t('pwa.steps.androidChrome.2', '"홈 화면에 추가" 또는 "앱 설치" 를 선택합니다') as string,
        t('pwa.steps.androidChrome.3', '"추가" / "설치" 를 눌러 완료합니다') as string,
      ];
    case 'android-samsung':
      return [
        t('pwa.steps.androidSamsung.1', '하단 ☰ 메뉴를 엽니다') as string,
        t('pwa.steps.androidSamsung.2', '"현재 페이지 추가" → "홈 화면" 을 선택합니다') as string,
      ];
    case 'desktop-chrome':
    case 'desktop-edge':
      return [
        t('pwa.steps.desktopChromium.1', '주소창 우측의 설치 아이콘 (⊕ 또는 모니터 + ↓) 을 클릭하거나') as string,
        t('pwa.steps.desktopChromium.2', '주소창 우측의 ⋮ 메뉴 → "PlanQ 설치" / "앱 설치" 를 선택합니다') as string,
        t('pwa.steps.desktopChromium.3', '설치 다이얼로그에서 "설치" 를 누르면 시작 메뉴·독에 추가됩니다') as string,
      ];
    case 'android-firefox':
    case 'desktop-firefox':
      return [
        t('pwa.steps.firefox.1', 'Firefox 는 PWA 설치를 제한적으로만 지원합니다') as string,
        t('pwa.steps.firefox.2', '권장: Chrome / Edge / Samsung Internet 으로 다시 열어주세요') as string,
      ];
    case 'desktop-safari':
      return [
        t('pwa.steps.desktopSafari.1', 'Safari 위 메뉴 «파일» → «Dock에 추가» 를 누릅니다 (macOS Sonoma 이상)') as string,
        t('pwa.steps.desktopSafari.2', '«추가» 를 누르면 Dock 과 응용 프로그램에 PlanQ 가 생깁니다') as string,
      ];
    default:
      return [
        t('pwa.steps.other.1', '이 브라우저는 PWA 설치를 지원하지 않거나 식별할 수 없습니다') as string,
        t('pwa.steps.other.2', 'Chrome / Edge / Samsung Internet 또는 iOS Safari 에서 다시 시도하세요') as string,
      ];
  }
}
