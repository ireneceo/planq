// 미리보기 창(가운데 창 · 폰에서는 앱 머리줄 아래 전면) 껍데기 — **공유 규격**.
//
// ★ 2026-11-04 (Irene: *"채팅에 첨부된 업무를 눌렀더니 모바일에서 위 잘리고 닫기도 안나오고 헤더도 없어서 아무것도 못해.
//   첨부문서 업무 파일 팝업들 다 반응형 체크 필요해"*) — 문서 카드만 앱 안 창(PostPreviewModal)이었고
//   업무·파일·Q info·일정·청구서 카드는 새 창(window.open)이라 폰·앱에서 화면 자체가 공개 화면으로 넘어갔다.
//   같은 모양을 두 벌 그리지 않으려고 PostPreviewModal 의 껍데기를 **값 그대로** 여기로 옮겼다.
//   쓰는 곳: components/Docs/PostPreviewModal · components/Common/SharePreviewSheet.
//   (폰 ≤640 의 Backdrop 바깥 여백 0 만 더했다 — Dialog 가 이미 radius 0 · 높이 100% 인 전면이라
//    24px 여백이 남으면 전면도 아니고 창도 아닌 모양이 된다.)
import styled from 'styled-components';

export const PreviewBackdrop = styled.div`
  position: fixed; inset: var(--pq-popup-top, 0px) 0 0; background: rgba(15,23,42,0.55);
  display: flex; align-items: center; justify-content: center; z-index: 1100;
  padding: 24px;
  @media (max-width: 640px) { padding: 0; }
`;
export const PreviewDialog = styled.div`
  background: #fff; border-radius: 14px; width: 100%; max-width: 760px;
  max-height: 86vh; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
  @media (max-width: 640px) {
    max-height: 100%; border-radius: 0; max-width: 100vw;
  }
`;
export const PreviewHeader = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 14px 18px; border-bottom: 1px solid #F1F5F9;
  /* 앱 머리줄 아래면 0, 머리줄이 없는 화면(공개·팝아웃)에서 상태바만큼 — index.css 의 한 토큰 */
  padding-top: calc(14px + var(--pq-popup-safe-pad, 0px));
`;
export const PreviewTitle = styled.h2`
  flex: 1; min-width: 0; font-size: 1rem; font-weight: 700; color: #0F172A; margin: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
export const PreviewHeaderActions = styled.div`display:flex;align-items:center;gap:6px;flex-shrink:0;`;
export const PreviewOpenBtn = styled.button`
  display: inline-flex; align-items: center; padding: 7px 12px;
  font-size: 0.75rem; font-weight: 700; color: #fff; background: #14B8A6;
  border: none; border-radius: 8px; cursor: pointer;
  &:hover { background: #0D9488; }
`;
export const PreviewCloseBtn = styled.button`
  /* touch-target-44: 폰 터치 타깃 (theme/tokens CONTROL.touchMin). 데스크탑 크기는 그대로. */
  @media (max-width: 640px) { min-width: 44px; min-height: 44px; }

  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #64748B;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
