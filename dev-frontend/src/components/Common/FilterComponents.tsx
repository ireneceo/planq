import React from 'react';
import styled from 'styled-components';

const CommonFilterBar = styled.div`
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
  align-items: flex-start;
  background: transparent;
  border: none;
  padding: 0;
  @media (max-width: 1024px) { gap: 12px; }
  @media (max-width: 768px) { gap: 10px; margin-bottom: 20px; }
  @media (max-width: 600px) {
    flex-direction: column;
    gap: 12px;
    > * { width: 100% !important; min-width: 100% !important; max-width: 100% !important; }
  }
`;

const CommonSearchInput = styled.input`
  flex: 1;
  min-width: 180px;
  max-width: 300px;
  padding: 12px 16px;
  border: 1px solid #E6EBF1;
  border-radius: 8px;
  font-size: 14px;
  background: white;
  &::placeholder { color: #9CA3AF; }
  &:focus { outline: none; border-color: #6C5CE7; box-shadow: 0 0 0 3px rgba(108, 92, 231, 0.1); }
  @media (max-width: 600px) { width: 100%; min-width: 100%; max-width: 100%; }
`;

const SearchInputWrapper = styled.div`
  position: relative;
  display: inline-flex;
  flex: 1;
  min-width: 180px;
  max-width: 300px;
  @media (max-width: 600px) { width: 100%; min-width: 100%; max-width: 100%; }
`;

const ClearButton = styled.button`
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: #9CA3AF;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: color 0.15s;
  &:hover { color: #374151; }
  svg { width: 16px; height: 16px; }
`;

const CommonFilterSelect = styled.select`
  padding: 12px 16px;
  border: 1px solid #E6EBF1;
  border-radius: 8px;
  font-size: 14px;
  background: white;
  cursor: pointer;
  min-width: 140px;
  max-width: 180px;
  flex-shrink: 0;
  &:focus { outline: none; border-color: #6C5CE7; box-shadow: 0 0 0 3px rgba(108, 92, 231, 0.1); }
  &:disabled { background: #F8FAFC; color: #6B7280; cursor: not-allowed; }
  @media (max-width: 600px) { width: 100%; min-width: 100%; max-width: 100%; padding: 12px 16px; font-size: 14px; }
`;

interface CommonFilterBarProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const FilterBar: React.FC<CommonFilterBarProps> = ({ children, className, style }) => (
  <CommonFilterBar className={className} style={style}>{children}</CommonFilterBar>
);

interface CommonSearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  placeholder?: string;
}

export const SearchInput: React.FC<CommonSearchInputProps> = ({ placeholder = "Search...", value, onChange, style, ...props }) => (
  <SearchInputWrapper style={style}>
    <CommonSearchInput
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      style={{ width: '100%', minWidth: 0, maxWidth: 'none', paddingRight: value ? '36px' : '16px' }}
      {...props}
    />
    {value && (
      <ClearButton
        type="button"
        onClick={() => onChange?.({ target: { value: '' } } as React.ChangeEvent<HTMLInputElement>)}
        aria-label="Clear search"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </ClearButton>
    )}
  </SearchInputWrapper>
);

interface CommonFilterSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}

export const FilterSelect: React.FC<CommonFilterSelectProps> = ({ children, ...props }) => (
  <CommonFilterSelect {...props}>{children}</CommonFilterSelect>
);

export { CommonFilterBar, CommonSearchInput, CommonFilterSelect };

interface QuickFiltersProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: Array<{
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    placeholder?: string;
  }>;
}

export const QuickFilters: React.FC<QuickFiltersProps> = ({
  searchValue, onSearchChange, searchPlaceholder = "Search...", filters = []
}) => (
  <FilterBar>
    <SearchInput
      type="text"
      placeholder={searchPlaceholder}
      value={searchValue}
      onChange={(e) => onSearchChange(e.target.value)}
    />
    {filters.map((filter, index) => (
      <FilterSelect key={index} value={filter.value} onChange={(e) => filter.onChange(e.target.value)}>
        {filter.placeholder && <option value="">{filter.placeholder}</option>}
        {filter.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </FilterSelect>
    ))}
  </FilterBar>
);
