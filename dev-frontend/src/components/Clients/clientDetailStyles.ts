// 고객 상세 절(사업자·증빙 · 메모 · 상태 배너 · 변경 이력) 공용 규격 — Q sale 패널과 상세 페이지가 같이 쓴다.
//   2026-10-16 설정 > 고객 화면을 Q sale 로 합치며 그 드로어의 값을 **그대로** 옮겼다(색·크기 바꾸지 않음).
import styled from 'styled-components';

export const Section = styled.section`display:flex;flex-direction:column;gap:8px;`;
export const SectionTitle = styled.h3`font-size:0.8125rem;font-weight:700;color:#0F172A;margin:0;`;
export const SectionTitleRow = styled.div`display:flex;align-items:center;justify-content:space-between;gap:8px;`;
export const Helper = styled.div`font-size:0.6875rem;color:#94A3B8;line-height:1.5;`;
export const Dim = styled.div`padding:12px;text-align:center;font-size:0.75rem;color:#94A3B8;background:#F8FAFC;border-radius:8px;`;

export const BizToggleRow = styled.div`padding:2px 0 6px;`;
export const BizRow = styled.div`display:flex;flex-direction:column;gap:4px;min-width:0;`;
export const BizLabel = styled.span`font-size:0.6875rem;color:#64748B;font-weight:600;`;
export const BizReadVal = styled.span`font-size:0.8125rem;color:#0F172A;word-break:break-all;`;
export const BizTwoCol = styled.div`display:grid;grid-template-columns:1fr 1fr;gap:10px;`;
export const BizInput = styled.input`
  width:100%;box-sizing:border-box;padding:8px 28px 8px 10px;
  border:1px solid #E2E8F0;border-radius:8px;font-size:0.8125rem;color:#0F172A;font-family:inherit;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15);}
  &::placeholder{color:#CBD5E1;}
`;
export const NoteArea = styled.textarea`
  width:100%;box-sizing:border-box;min-height:70px;max-height:180px;padding:8px 10px;
  border:1px solid #E2E8F0;border-radius:8px;font-size:0.8125rem;color:#0F172A;background:#FAFBFC;font-family:inherit;line-height:1.5;resize:vertical;
  &:focus{outline:none;border-color:#14B8A6;background:#FFF;box-shadow:0 0 0 3px rgba(20,184,166,0.1);}
  &:disabled{opacity:0.7;}
`;

export const SwitchWrap = styled.label`display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;position:relative;`;
export const SwitchInput = styled.input`appearance:none;-webkit-appearance:none;position:absolute;opacity:0;pointer-events:none;
  &:checked + span{background:#14B8A6;}
  &:checked + span::after{transform:translateX(16px);}
  &:disabled + span{opacity:0.5;cursor:not-allowed;}
`;
export const SwitchTrack = styled.span`display:inline-block;width:38px;height:22px;background:#CBD5E1;border-radius:999px;position:relative;transition:background 0.15s;
  &::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;background:#FFF;border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,0.2);transition:transform 0.15s;}
`;
export const SwitchLabel = styled.span`font-size:0.75rem;font-weight:600;color:#475569;`;

export const Banner = styled.div<{ $tone?: 'warn' | 'info' | 'muted' }>`
  display:flex; align-items:center; gap:12px; justify-content:space-between;
  padding:12px 14px; border-radius:10px;
  background:${(p) => (p.$tone === 'muted' ? '#F1F5F9' : '#FEF3C7')};
  border:1px solid ${(p) => (p.$tone === 'muted' ? '#E2E8F0' : '#FDE68A')};
`;
export const BannerText = styled.div<{ $tone?: 'warn' | 'info' | 'muted' }>`
  display:flex; flex-direction:column; gap:2px; min-width:0;
  strong { font-size:0.8125rem; font-weight:700; color:${(p) => (p.$tone === 'muted' ? '#334155' : '#92400E')}; }
  span { font-size:0.75rem; color:${(p) => (p.$tone === 'muted' ? '#64748B' : '#A16207')}; line-height:1.4; }
`;
export const BannerMeta = styled.div`font-size:0.6875rem; color:#A16207; opacity:0.85; margin-top:2px; font-variant-numeric:tabular-nums;`;
export const BannerBtn = styled.button`
  flex-shrink:0; height:32px; padding:0 12px; border-radius:8px;
  font-size:0.75rem; font-weight:600; cursor:pointer; white-space:nowrap;
  color:#fff; background:#0D9488; border:1px solid #0D9488;
  transition:background 0.12s;
  &:hover:not(:disabled){ background:#0F766E; }
  &:disabled{ opacity:0.55; cursor:default; }
`;

export const HistoryToggle = styled.button`display:inline-flex;align-items:center;gap:4px;padding:5px 10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;font-size:0.75rem;color:#475569;cursor:pointer;&:hover{background:#F0FDFA;border-color:#CCFBF1;color:#0F766E;}`;
