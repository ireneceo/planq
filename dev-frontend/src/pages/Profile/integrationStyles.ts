// 내 외부 연동 화면의 카드 모양 — 페이지와 «연결된 AI 앱» 칸(ConnectedAiAppsSection)이 같이 쓴다.
//   칸마다 다시 그리면 갈라진다(CLAUDE.md «껍데기는 빼서 같이 쓴다»).
import styled from 'styled-components';

export const Section = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 20px; margin-bottom: 16px;
`;
export const SectionTitle = styled.h3`margin: 0 0 4px; font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
export const SectionSub = styled.p`margin: 0 0 14px; font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
export const Empty = styled.div`
  padding: 24px 12px; text-align: center; color: #94A3B8;
  background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 8px;
  display: flex; flex-direction: column; gap: 6px;
  font-size: 0.8125rem;
`;
export const ConnList = styled.div`display: flex; flex-direction: column; gap: 8px;`;
export const ConnRow = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
`;
export const ConnIcon = styled.div`font-size: 1.5rem;`;
export const ConnInfo = styled.div`flex: 1; display: flex; flex-direction: column; gap: 2px;`;
export const ConnTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
export const ConnSub = styled.div`font-size: 0.75rem; color: #475569;`;
export const ConnMeta = styled.div`font-size: 0.6875rem; color: #94A3B8;`;
export const DangerBtn = styled.button`
  height: 30px; padding: 0 12px;
  background: transparent; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 6px;
  font-size: 0.75rem; font-weight: 600;
  cursor: pointer;
  &:hover { background: #FEF2F2; border-color: #FCA5A5; color: #991B1B; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
