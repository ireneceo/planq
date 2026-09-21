// Q file(DocsTab) 의 가운데 확인창·버튼 규격 — DocsTab 과 docs/useFolderEditing 이 같이 쓴다.
//   DocsTab 에 있던 것을 그대로 옮겼다(값 변경 없음 — god-file 래칫, 2026-09-21).
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
export const Modal = styled.div`
  position:fixed;inset:0;z-index:80;background:rgba(15,23,42,.24);
  display:flex;align-items:center;justify-content:center;padding:20px;
  @media (max-width: 640px) { padding:0; align-items:stretch; }
`;
export const Dialog = styled.div`
  background:#fff;border-radius:14px;width:100%;max-width:460px;
  box-shadow:0 20px 50px rgba(15,23,42,.2);
  display:flex;flex-direction:column;overflow:hidden;max-height:80vh;
  @media (max-width: 640px) {
    max-width:none;max-height:none;border-radius:0;
    margin-top:var(--pq-chrome-bottom, 60px);height:calc(100vh - var(--pq-chrome-bottom, 60px));height:calc(100dvh - var(--pq-chrome-bottom, 60px));
  }
`;
export const DTitle = styled.div`padding:18px 20px 10px;font-size:0.9375rem;font-weight:700;color:#0F172A;`;
export const DBody = styled.div`
  padding:0 20px 16px;font-size:0.8125rem;color:#475569;line-height:1.5;overflow-y:auto;
  strong{color:#0F172A;}
  p{margin:4px 0;}
`;
export const DFooter = styled.div`padding:12px 20px;border-top:1px solid #E2E8F0;display:flex;gap:8px;justify-content:flex-end;`;
