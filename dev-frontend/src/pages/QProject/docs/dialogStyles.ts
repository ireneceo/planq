// Q file(DocsTab) 의 가운데 확인창·버튼 규격 — DocsTab 과 docs/useFolderEditing 이 같이 쓴다.
//   DocsTab 에 있던 것을 그대로 옮겼다(값 변경 없음 — god-file 래칫, 2026-09-21).
import React from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';

export const SecondaryBtn = styled.button`
  height:34px;padding:0 14px;background:#fff;color:#0F172A;
  border:1px solid #CBD5E1;border-radius:8px;font-size:0.8125rem;font-weight:600;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;text-decoration:none;
  &:hover{background:#F8FAFC;}
`;
export const PrimaryBtn = styled.button`
  height:34px;padding:0 14px;background:#14B8A6;color:#fff;
  border:1px solid #14B8A6;border-radius:8px;font-size:0.8125rem;font-weight:600;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;
  &:hover:not(:disabled){background:#0D9488;border-color:#0D9488;}
  &:disabled{opacity:0.5;cursor:not-allowed;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
export const DangerBtn = styled.button`
  height:34px;padding:0 14px;background:#fff;color:#DC2626;
  border:1px solid #FCA5A5;border-radius:8px;font-size:0.8125rem;font-weight:600;cursor:pointer;
  &:hover{background:#FEF2F2;border-color:#DC2626;}
`;

// Modals (단일/대량 삭제 / 이동)
// ★ 2026-11-03 — 가운데 확인창은 **body 로 포털 + 1100 층**(StandardModal 과 같은 계약).
//   옛 껍데기는 그 자리(z-index 80)에 그려져 미리보기 우측 패널(DetailDrawer 130) **뒤로** 떴다 —
//   미리보기의 [삭제] 를 누르면 «파일을 삭제할까요?» 가 패널 뒤에 깔렸다.
//   (Irene 2026-11-03: "이 팝업이 우측패널 뒤로 뜬다 … 모든 팝업은 최상단이야.")
//   숫자만 올리면 조상이 만든 층(사이드바·transform)에 다시 갇힌다 — 층 밖(body)으로 나간다.
//   폰 앱 머리줄은 가리지 않는다(--pq-popup-top, ui-overlays 규칙).
const ModalBackdrop = styled.div`
  position:fixed;inset:var(--pq-popup-top, 0px) 0 0;z-index:1100;background:rgba(15,23,42,.24);
  display:flex;align-items:center;justify-content:center;padding:20px;
  @media (max-width: 640px) { padding:0; align-items:stretch; }
`;
export const Modal = (props: React.ComponentProps<typeof ModalBackdrop>) => {
  const tree = React.createElement(ModalBackdrop, props);
  return typeof document === 'undefined' ? tree : createPortal(tree, document.body);
};
export const Dialog = styled.div`
  background:#fff;border-radius:14px;width:100%;max-width:460px;
  box-shadow:0 20px 50px rgba(15,23,42,.2);
  display:flex;flex-direction:column;overflow:hidden;max-height:80vh;
  @media (max-width: 640px) {
    max-width:none;max-height:none;border-radius:0;
    /* 막(Backdrop)이 이미 --pq-popup-top 에서 시작한다 — 여기서 또 빼면 머리줄만큼 두 번 내려간다. */
    height:auto;
  }
`;
export const DTitle = styled.div`padding:18px 20px 10px;font-size:0.9375rem;font-weight:700;color:#0F172A;`;
export const DBody = styled.div`
  padding:0 20px 16px;font-size:0.8125rem;color:#475569;line-height:1.5;overflow-y:auto;
  strong{color:#0F172A;}
  p{margin:4px 0;}
`;
export const DFooter = styled.div`padding:12px 20px;border-top:1px solid #E2E8F0;display:flex;gap:8px;justify-content:flex-end;`;

// 파일 목록 위 업로드 줄의 버튼 — [업로드]·[폴더 올리기]·[Google Drive 에서] 가 같은 규격(DocsTab 에서 옮김, 값 변경 없음).
export const CompactUploadBtn = styled.button`
  display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 14px;
  background:#14B8A6;color:#fff;border:none;border-radius:8px;
  font-size:0.75rem;font-weight:600;cursor:pointer;
  &:hover{background:#0D9488;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
