import styled from 'styled-components';

export const RequiredStar = styled.span`
  color: #EF4444;
  margin-left: 4px;
`;

export const Section = styled.div`
  margin-bottom: 20px;
  &:last-child { margin-bottom: 0; }
`;

export const RadioGroup = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 8px;
`;

export const RadioButton = styled.button<{ selected?: boolean }>`
  padding: 12px 16px;
  min-height: 44px;
  border-radius: 8px;
  border: 1px solid ${props => props.selected ? '#6C5CE7' : '#E6EBF1'};
  background: ${props => props.selected ? 'rgba(108, 92, 231, 0.1)' : 'white'};
  color: ${props => props.selected ? '#6C5CE7' : '#374151'};
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
  &:hover {
    border-color: ${props => props.selected ? '#6C5CE7' : '#D1D5DB'};
    background: ${props => props.selected ? 'rgba(108, 92, 231, 0.1)' : '#F9FAFB'};
  }
`;

export const CheckboxGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const CheckboxLabel = styled.label`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  min-height: 44px;
  border: 1px solid #E6EBF1;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { background: #F9FAFB; border-color: #D1D5DB; }
`;

export const CheckboxInput = styled.input`
  width: 16px;
  height: 16px;
  accent-color: #6C5CE7;
  cursor: pointer;
  border-radius: 4px;
`;

export const CheckboxText = styled.span`
  font-size: 14px;
  color: #374151;
  margin-left: 10px;
  flex: 1;
`;
