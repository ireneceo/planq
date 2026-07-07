import { useEffect } from 'react';

// 앱 셸(MainLayout·팝아웃) 전용 모바일 뷰포트 고정 락.
//
// 배경: 로그인 후 앱은 채팅 패널·리스트 등이 각자 overflow-y 로 스크롤하므로
//   body/#root 를 뷰포트에 고정(position:fixed + overflow:hidden)해 iOS 바운스·
//   키보드 점프를 차단한다. 그러나 이 락이 전역 기본값이면 랜딩/회원가입/공개
//   페이지처럼 "페이지 전체가 세로로 긴" 화면의 스크롤까지 죽여 회원가입 불가 등
//   치명 회귀가 난다.
//
// 정책(반전): 스크롤 가능이 기본, 앱 셸만 이 훅으로 락을 opt-in 한다. 락이 빠진
//   화면은 최악이라도 "정상 스크롤 + 약간의 iOS 바운스"로 안전하게 degrade 된다.
//   index.css 의 `html.pq-app-shell` 규칙 + main.tsx 의 phantom-scroll 보정이
//   이 클래스에 게이트돼 있다.
export function useAppShellLock() {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('pq-app-shell');
    return () => { html.classList.remove('pq-app-shell'); };
  }, []);
}
