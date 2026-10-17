// 앱 셸(탭·사이드바) 밖에서 그리는 경로 — 로그인·초대 수락·공개 링크·팝아웃 창 등.
//   정본은 여기 하나다. App.tsx 의 tree-swap 진입 판정과 알림 클릭(openNotificationTarget)이 같이 읽는다.
//   ★ 알림이 /invite/<token> 을 가리킨다(2026-10-15 초대 인앱 알림). 탭 모드에서 이 경로를 탭으로 열면
//     탭 안에 그릴 화면이 없어 **빈 탭**이 된다 — 그래서 이 경로는 문서 이동으로 간다.
//   (components/Tab/TabMirror NON_TAB_PREFIX 는 «주소를 탭에 비추지 않을 경로» 라는 다른 질문이라 따로 둔다.)
export const NON_APP_PATH_RE = /^\/(login|dev-login|register|invite|forgot-password|reset-password|verify-email|oauth|connect|legal|privacy|terms|app|public|sign|c|memo|talk-popout|task-popout|note-popout|help-popout)(\/|$)/;

export function isNonAppPath(pathname: string): boolean {
  return NON_APP_PATH_RE.test(pathname);
}
