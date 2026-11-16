// 멤버 초대 폼 모양 — WorkspaceSettingsPage 에서 옮겼다(2026-11-16, god-file 래칫 · 값은 그대로)
import styled from 'styled-components';

export const InvitePrimaryBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px;
  background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px;
  font-size: 0.8125rem; font-weight: 700; cursor: pointer; flex-shrink: 0;
  &:hover { background: #0D9488; }
`;
export const InviteBox = styled.div`
  margin: 12px 0 16px; padding: 14px; background: #F8FAFC; border: 1px solid #E2E8F0;
  border-radius: 10px; display: flex; flex-direction: column; gap: 10px;
`;
export const InviteInputRow = styled.div`display: flex; gap: 8px; flex-wrap: wrap; & + & { margin-top: 8px; }`;
// 초대 주소 칸 — 메일 받는 사람과 같은 칩 입력(RecipientInput)을 담는 자리(2026-11-16 Irene «이메일 주소처럼 딱딱 저장되는 ui»)
export const InviteEmailSlot = styled.div`flex: 2; min-width: 200px;`;
// 초대 메일에 함께 보낼 말(선택)
export const InviteMessage = styled.textarea`
  width: 100%; min-height: 60px; resize: vertical; font-family: inherit; line-height: 1.5;
  padding: 8px 12px; border: 1px solid #CBD5E1; border-radius: 8px; box-sizing: border-box;
  font-size: 0.8125rem; background: #FFFFFF; &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
// 초대 폼 역할 칸 — 역할 사전 고르기(RolePicker)를 담는 자리. 이메일 칸과 같은 줄.
export const InviteRoleSlot = styled.div`flex: 1; min-width: 140px;`;
export const InviteHintText = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5; margin-top: 6px;`;
export const InviteError = styled.div`font-size: 0.75rem; color: #DC2626;`;
export const InviteResultList = styled.ul`margin: 6px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px;`;
export const InviteResultItem = styled.li<{ $ok?: boolean }>`font-size: 0.75rem; color: ${(p) => (p.$ok ? '#0F766E' : '#B45309')}; overflow-wrap: anywhere;`;
export const InviteActionRow = styled.div`display: flex; gap: 8px; justify-content: flex-end;`;
export const InviteCancel = styled.button`
  padding: 7px 12px; background: #FFFFFF; color: #334155; border: 1px solid #CBD5E1;
  border-radius: 8px; font-size: 0.75rem; font-weight: 600; cursor: pointer;
  &:hover { background: #F8FAFC; border-color: #94A3B8; }
`;
export const InviteSubmit = styled.button`
  padding: 7px 14px; background: #0D9488; color: #FFFFFF; border: none;
  border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;

