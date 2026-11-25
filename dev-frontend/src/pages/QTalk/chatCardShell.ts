// 채팅 공유 카드 껍데기 — ChatPanel 과 사람 정보 카드(ProfileCardBubble)가 같이 쓴다(값은 ChatPanel 에서 옮기기만 함, 2026-11-25).
import styled from 'styled-components';

// 통합 공유 카드 (사이클 N+4 6차) — task/file/kb_document/calendar_event
export const SharedCard = styled.button`
  all: unset; cursor: pointer; display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; max-width: 380px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
  &:hover { background: #F0FDFA; border-color: #14B8A6; transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
export const SHARED_TONE: Record<string, { bg: string; fg: string; border: string }> = {
  task:     { bg: '#DBEAFE', fg: '#1E40AF', border: '#93C5FD' },
  file:     { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
  kb:       { bg: '#F0FDFA', fg: '#0F766E', border: '#99F6E4' },
  calendar: { bg: '#F0FDFA', fg: '#6B21A8', border: '#D8B4FE' },
};
export const SharedCardIcon = styled.span<{ $tone: keyof typeof SHARED_TONE }>`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${p => SHARED_TONE[p.$tone].bg};
  color: ${p => SHARED_TONE[p.$tone].fg};
  border: 1px solid ${p => SHARED_TONE[p.$tone].border};
  border-radius: 8px;
`;

export const DocCardBody = styled.div`flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;`;
export const DocCardTitle = styled.span`
  font-size: 0.8125rem; font-weight: 700; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
export const DocCardLabel = styled.span`font-size:0.6875rem;color:#64748B;font-weight:500;`;
export const DocCardArrow = styled.span`color:#94A3B8;flex-shrink:0;`;
