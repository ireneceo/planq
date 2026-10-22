// 내 외부 연동 화면의 카드 모양 — 페이지와 «연결된 AI 앱» 칸(ConnectedAiAppsSection)이 같이 쓴다.
//   칸마다 다시 그리면 갈라진다(CLAUDE.md «껍데기는 빼서 같이 쓴다»).
import styled from 'styled-components';
import { mediaPhone } from '../../theme/breakpoints';

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
// 폰(≤640)은 내용을 아이콘 옆 전폭으로 두고 상태 뱃지·해제 버튼(ConnActions)은 다음 줄 오른쪽으로 내린다 —
//   한 줄에 다 넣으면 내용 칸이 120~150px 로 짓눌리고 긴 이메일이면 버튼이 카드 밖으로 밀렸다(2026-10-22 실측).
export const ConnRow = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
  ${mediaPhone} { flex-wrap: wrap; align-items: flex-start; row-gap: 10px; }
`;
export const ConnIcon = styled.div`font-size: 1.5rem;`;
export const ConnInfo = styled.div`
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
  ${mediaPhone} { flex: 1 1 calc(100% - 48px); }
`;
// 행 오른쪽 묶음(상태 뱃지·해제) — 폰에서는 내용 아래 줄 오른쪽 끝
export const ConnActions = styled.div`
  display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: auto;
  ${mediaPhone} { width: 100%; justify-content: flex-end; }
`;
export const ConnTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
export const ConnSub = styled.div`font-size: 0.75rem; color: #475569; overflow-wrap: anywhere;`;
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
