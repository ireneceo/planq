// 일정 추가 폼이 나눠 쓰는 칸 모양 — NewEventModal 과 EventPlaceField 가 같이 쓴다(따로 적으면 갈라진다).
import styled from 'styled-components';
import { SegmentedToggle } from '../../components/Common/segmentedToggle';

export const Field = styled.div` display: flex; flex-direction: column; gap: 6px; position: relative; `;
export const Label = styled.label`
  font-size: 0.6875rem; font-weight: 600; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.3px;
`;
// 접어 둔 첨부를 여는 줄 — 링크처럼 가볍게(입력란 하나를 통째로 차지하지 않게)
export const AttachToggle = styled.button`
  align-self: flex-start; background: none; border: none; padding: 4px 0; cursor: pointer;
  font-size: 0.8125rem; font-weight: 600; color: #0F766E;
  &:hover { color: #0D9488; text-decoration: underline; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; border-radius: 4px; }
`;
export const CheckboxLabel = styled.label`
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  font-size: 0.8125rem; color: #334155;
  input { accent-color: #14B8A6; cursor: pointer; }
`;
export const Input = styled.input`
  padding: 9px 11px; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; outline: none; background: #fff;
  &:focus { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12); }
  &:disabled { background: #F8FAFC; color: #94A3B8; cursor: not-allowed; }
`;
export const AutoMeetingRow = styled.div`
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 8px;
  padding: 10px 12px; margin-bottom: 2px;
`;
export const AutoMeetingText = styled.div`
  display: flex; flex-direction: column; gap: 2px;
  strong { font-size: 0.8125rem; color: #0F172A; font-weight: 600; }
  small { font-size: 0.71875rem; color: #64748B; }
`;
// 폼 칸(세로 flex) 안에서 알약이 가로로 늘어나지 않게
export const PlaceToggle = styled(SegmentedToggle)` align-self: flex-start; `;
