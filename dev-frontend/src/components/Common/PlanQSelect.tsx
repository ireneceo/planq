/**
 * PlanQSelect — PlanQ 표준 검색 가능 셀렉트 컴포넌트
 *
 * ⚠️ 절대 규칙
 * - 모든 select는 이 컴포넌트 사용 (raw <select>, react-select 직접 import 금지)
 * - 색상은 PlanQ 딥틸 시스템 (#14B8A6 계열) 고정
 * - 새 옵션 prop 추가 시 PlanQ 컬러/간격 가이드 준수
 *
 * 사용 예:
 *   const options = [
 *     { value: 'ko', label: '한국어' },
 *     { value: 'en', label: 'English' },
 *   ];
 *   <PlanQSelect
 *     options={options}
 *     value={selected}
 *     onChange={setSelected}
 *     placeholder="언어 선택"
 *   />
 */
import Select, { components } from 'react-select';
import type { StylesConfig, Props as ReactSelectProps, GroupBase } from 'react-select';

// ─────────────────────────────────────────────────────────
// PlanQ 컬러 토큰 (COLOR_GUIDE.md와 동기)
// ─────────────────────────────────────────────────────────
const C = {
  primary50: '#F0FDFA',
  primary100: '#CCFBF1',
  primary200: '#99F6E4',
  primary500: '#14B8A6',
  primary600: '#0D9488',
  primary700: '#0F766E',
  neutral200: '#E2E8F0',
  neutral300: '#CBD5E1',
  neutral400: '#94A3B8',
  neutral500: '#64748B',
  neutral600: '#475569',
  neutral800: '#1E293B',
  neutral900: '#0F172A',
  white: '#FFFFFF',
  errorBorder: '#DC2626',
};

// ─────────────────────────────────────────────────────────
// 옵션 타입
// ─────────────────────────────────────────────────────────
export interface PlanQSelectOption {
  value: string | number;
  label: string;
  description?: string; // 부가 설명 (예: 언어명 옆에 영문)
  icon?: React.ReactNode; // 아이콘/국기 등
  isDisabled?: boolean;
}

interface PlanQSelectProps<IsMulti extends boolean = false>
  extends Omit<
    ReactSelectProps<PlanQSelectOption, IsMulti, GroupBase<PlanQSelectOption>>,
    'styles' | 'theme' | 'classNamePrefix'
  > {
  size?: 'sm' | 'md' | 'lg';
  hasError?: boolean;
  /** 옵션 간격 — 시간 리스트처럼 옵션 많을 때 'compact' 사용. 기본 'comfortable'. */
  density?: 'comfortable' | 'compact';
}

// ─────────────────────────────────────────────────────────
// 사이즈별 패딩
// ─────────────────────────────────────────────────────────
const SIZE_HEIGHT = {
  sm: 36,
  md: 44,
  lg: 52,
} as const;

const SIZE_FONT = {
  sm: 13,
  md: 14,
  lg: 16,
} as const;

// ─────────────────────────────────────────────────────────
// 스타일 빌더
// ─────────────────────────────────────────────────────────
function buildStyles(
  size: 'sm' | 'md' | 'lg',
  hasError: boolean,
  density: 'comfortable' | 'compact' = 'comfortable',
): StylesConfig<PlanQSelectOption, boolean, GroupBase<PlanQSelectOption>> {
  const minHeight = SIZE_HEIGHT[size];
  const fontSize = SIZE_FONT[size];
  const optionPadding = density === 'compact' ? '5px 10px' : '10px 12px';

  return {
    control: (base, state) => ({
      ...base,
      minHeight,
      backgroundColor: state.isDisabled ? '#F8FAFC' : C.white,
      borderColor: hasError
        ? C.errorBorder
        : state.isFocused
        ? C.primary500
        : C.neutral200,
      borderWidth: 1,
      borderRadius: 8,
      boxShadow: state.isFocused
        ? `0 0 0 3px ${hasError ? 'rgba(220,38,38,0.1)' : 'rgba(20,184,166,0.15)'}`
        : 'none',
      transition: 'border-color 120ms, box-shadow 120ms',
      cursor: state.isDisabled ? 'not-allowed' : 'pointer',
      '&:hover': {
        borderColor: hasError ? C.errorBorder : state.isFocused ? C.primary500 : C.neutral300,
      },
    }),
    valueContainer: (base) => ({
      ...base,
      padding: size === 'sm' ? '2px 12px' : size === 'lg' ? '8px 16px' : '4px 14px',
      fontSize,
    }),
    placeholder: (base) => ({
      ...base,
      color: C.neutral400,
      fontSize,
    }),
    singleValue: (base) => ({
      ...base,
      color: C.neutral900,
      fontSize,
    }),
    input: (base) => ({
      ...base,
      color: C.neutral900,
      fontSize,
      margin: 0,
      padding: 0,
    }),
    indicatorSeparator: () => ({ display: 'none' }),
    dropdownIndicator: (base, state) => ({
      ...base,
      color: state.isFocused ? C.primary600 : C.neutral400,
      padding: size === 'sm' ? 6 : 8,
      transition: 'color 120ms, transform 120ms',
      transform: state.selectProps.menuIsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
      '&:hover': { color: C.primary600 },
    }),
    clearIndicator: (base) => ({
      ...base,
      color: C.neutral400,
      padding: 6,
      '&:hover': { color: C.errorBorder },
    }),
    menu: (base) => ({
      ...base,
      marginTop: 6,
      borderRadius: 10,
      border: `1px solid ${C.neutral200}`,
      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
      overflow: 'hidden',
      zIndex: 100,
    }),
    menuList: (base) => ({
      ...base,
      padding: 4,
      maxHeight: 320,
    }),
    option: (base, state) => ({
      ...base,
      padding: optionPadding,
      borderRadius: 6,
      fontSize,
      cursor: state.isDisabled ? 'not-allowed' : 'pointer',
      backgroundColor: state.isSelected
        ? C.primary50
        : state.isFocused
        ? C.primary50
        : 'transparent',
      color: state.isDisabled ? C.neutral400 : state.isSelected ? C.primary700 : C.neutral800,
      fontWeight: state.isSelected ? 600 : 400,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      '&:active': {
        backgroundColor: C.primary100,
      },
    }),
    multiValue: (base) => ({
      ...base,
      backgroundColor: C.primary100,
      borderRadius: 6,
      padding: '2px 4px',
    }),
    multiValueLabel: (base) => ({
      ...base,
      color: C.primary700,
      fontSize: fontSize - 1,
      fontWeight: 500,
    }),
    multiValueRemove: (base) => ({
      ...base,
      color: C.primary600,
      borderRadius: 4,
      '&:hover': {
        backgroundColor: C.primary200,
        color: C.primary700,
      },
    }),
    noOptionsMessage: (base) => ({
      ...base,
      color: C.neutral500,
      fontSize,
      padding: '12px',
    }),
  };
}

// ─────────────────────────────────────────────────────────
// 옵션 렌더 (icon, description 지원)
// ─────────────────────────────────────────────────────────
const Option = (props: any) => {
  const { data } = props;
  return (
    <components.Option {...props}>
      {data.icon && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{data.icon}</span>}
      <span style={{ flex: 1 }}>{data.label}</span>
      {data.description && (
        <span style={{ color: C.neutral400, fontSize: 12 }}>{data.description}</span>
      )}
    </components.Option>
  );
};

const SingleValue = (props: any) => {
  const { data } = props;
  return (
    <components.SingleValue {...props}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {data.icon}
        <span>{data.label}</span>
      </span>
    </components.SingleValue>
  );
};

// ─────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────
function PlanQSelect<IsMulti extends boolean = false>(
  props: PlanQSelectProps<IsMulti>
) {
  const { size = 'md', hasError = false, density = 'comfortable', ...rest } = props;

  return (
    <Select
      {...rest}
      styles={buildStyles(size, hasError, density) as any}
      components={{ Option, SingleValue, ...(rest.components || {}) }}
      noOptionsMessage={({ inputValue }) =>
        inputValue ? `'${inputValue}'에 대한 결과 없음` : '옵션 없음'
      }
      placeholder={rest.placeholder ?? '선택하기'}
      isSearchable={rest.isSearchable ?? true}
    />
  );
}

export default PlanQSelect;
