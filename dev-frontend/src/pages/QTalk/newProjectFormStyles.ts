// pages/QTalk/newProjectFormStyles — 새 프로젝트 드로어와 그 안의 고객 칸이 같이 쓰는 입력 모양 (2026-10-27 고객 칸을 나누며 옮김 · 값 그대로)
import styled from 'styled-components';

export const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const Label = styled.label`
  font-size: 0.75rem;
  font-weight: 600;
  color: #475569;
`;

export const Input = styled.input`
  width: 100%; min-width: 0; box-sizing: border-box;
  padding: 9px 12px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 0.8125rem;
  color: #0F172A;
  font-family: inherit;
  &::placeholder { color: #94A3B8; }
  &:focus {
    outline: none;
    border-color: #14B8A6;
    background: #FFFFFF;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
  }
`;

export const HelpText = styled.div`
  font-size: 0.6875rem;
  color: #94A3B8;
  margin-top: 2px;
`;

export const RemoveBtn = styled.button`
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #94A3B8;
  cursor: pointer;
  &:hover { background: #FEE2E2; color: #DC2626; }
`;
