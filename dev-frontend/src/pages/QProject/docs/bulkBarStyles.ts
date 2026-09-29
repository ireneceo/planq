// Q file · 프로젝트 > 파일 — 선택 모드의 일괄 줄 규격. DocsTab 이 god-file 한도에 닿아 스타일만 옮겼다(값 무변경).
import styled from 'styled-components';

export const BulkBar = styled.div`
  position:sticky;top:0;z-index:5;
  display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;
  padding:10px 14px;background:#FFFFFF;color:#0F172A;border-radius:10px;
  border:1px solid #E2E8F0;
  box-shadow:0 1px 2px rgba(15,23,42,.05);
`;
export const BulkBarLeft = styled.div`display:flex;gap:8px;align-items:baseline;font-size:0.8125rem;color:#0F172A;
  strong{font-weight:700;}
  span{color:#64748B;font-size:0.6875rem;}
`;
export const BulkBarRight = styled.div`display:flex;gap:6px;align-items:center;flex-wrap:wrap;`;
export const BulkBtnSep = styled.div`width:1px;height:18px;background:#E2E8F0;margin:0 4px;`;
export const BulkBtn = styled.button<{ $danger?: boolean; $primary?: boolean }>`
  height:28px;padding:0 12px;
  background:${p => p.$primary ? '#14B8A6' : '#FFFFFF'};
  color:${p => p.$primary ? '#FFFFFF' : (p.$danger ? '#DC2626' : '#334155')};
  border:1px solid ${p => p.$primary ? '#14B8A6' : (p.$danger ? '#FECACA' : '#E2E8F0')};
  border-radius:6px;font-size:0.75rem;font-weight:600;cursor:pointer;
  transition:background .15s, border-color .15s;
  &:hover:not(:disabled){
    background:${p => p.$primary ? '#0D9488' : (p.$danger ? '#FEF2F2' : '#F8FAFC')};
    border-color:${p => p.$primary ? '#0D9488' : (p.$danger ? '#FCA5A5' : '#CBD5E1')};
  }
  &:disabled{opacity:.4;cursor:not-allowed;}
`;
