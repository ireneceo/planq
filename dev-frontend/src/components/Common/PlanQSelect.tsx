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
// 새 값을 그 자리에서 만들 수 있는 변형 — 태그처럼 "사전에서 고르되 없으면 즉시 추가" 하는 곳에 쓴다.
//   별도 "+ 새 태그" 버튼을 옆에 두면 사용자가 두 곳을 오간다(Irene: "새태그는 왜 만들기 따로 나와?").
import CreatableSelect from 'react-select/creatable';
import type { StylesConfig, Props as ReactSelectProps, GroupBase } from 'react-select';
import { useTranslation } from 'react-i18next';

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
  /** 목록에 없는 값을 입력창에서 바로 만들 수 있게 한다 (onCreateOption 과 함께 사용) */
  creatable?: boolean;
  /** creatable 전용 — 입력값으로 새 항목을 만들 때. react-select/creatable 의 props 라
   *  기본 Select 타입에는 없다. 여기서 열어주지 않으면 호출측이 tsc 에서 막힌다. */
  onCreateOption?: (inputValue: string) => void;
  /** creatable 전용 — 목록 안 '만들기' 항목 문구 */
  formatCreateLabel?: (inputValue: string) => React.ReactNode;
  hasError?: boolean;
  /** 옵션 간격 — 시간 리스트처럼 옵션 많을 때 'compact' 사용. 기본 'comfortable'. */
  density?: 'comfortable' | 'compact';
}

// ─────────────────────────────────────────────────────────
// 사이즈별 패딩
// ─────────────────────────────────────────────────────────
// Toolbar 표준 높이 — Q task 기준 36px (sm), 모달 입력 44px (md)
const SIZE_HEIGHT = {
  sm: 36,
  md: 44,
  lg: 52,
} as const;

// ★ 숫자로 두면 react-select 가 px 로 굳혀 **글씨 크기 배율을 안 따라간다** (2026-08-30 실측:
//   셀렉트 값만 13px 에 멈춰 있었다). rem 문자열로 넘긴다 — 값은 px 로 적고 아래서 환산한다.
const SIZE_FONT = {
  sm: 13,
  md: 14,
  lg: 16,
} as const;
const rem = (px: number) => `${px / 16}rem`;

// ─────────────────────────────────────────────────────────
// 스타일 빌더
// ─────────────────────────────────────────────────────────
// 터치 기기 판정 — 마우스가 없는 환경(폰·태블릿). 데스크탑은 영향 0.
function isCoarsePointer(): boolean {
  try { return window.matchMedia?.('(pointer: coarse)').matches ?? false; } catch { return false; }
}
// 항목이 이만큼 넘으면 검색 없이는 못 고른다 — 그때는 터치에서도 켠다(그 키보드는 사용자가 원한 것).
const SEARCH_THRESHOLD = 15;

/**
 * 검색 입력을 열 것인가.
 *
 * ★ 터치에서는 **호출부가 명시로 켠 것도 상한을 둔다** (2026-09-06 실측으로 배운 것).
 *   처음엔 "기본값만" 바꿨는데 `isSearchable` 을 **명시로 켜는 곳이 31 군데**라 거의 안 먹었다
 *   (실측: 태블릿 coarse=true 인데 readOnly=false = 여전히 검색 가능 = 키보드가 올라온다).
 *   Irene 의 요구는 "셀렉트는 원할 때 입력하게" 이므로, 정책은 컴포넌트가 쥐어야 한다.
 *     · 명시 false → 그대로 false (54곳)
 *     · 명시/기본 true → 데스크탑은 true, **터치는 항목이 많을 때만** true
 *     · creatable → 입력해서 새로 만드는 것이 본질이라 **항상** true (막으면 기능이 죽는다)
 */
function resolveSearchable(explicit: boolean | undefined, optionCount: number, creatable: boolean): boolean {
  if (explicit === false) return false;
  if (creatable) return true;
  if (!isCoarsePointer()) return true;          // 데스크탑 — 종전 그대로
  return optionCount > SEARCH_THRESHOLD;
}

function buildStyles(
  size: 'sm' | 'md' | 'lg',
  hasError: boolean,
  density: 'comfortable' | 'compact' = 'comfortable',
): StylesConfig<PlanQSelectOption, boolean, GroupBase<PlanQSelectOption>> {
  const minHeight = SIZE_HEIGHT[size];
  const fontSizePx = SIZE_FONT[size];
  const fontSize = rem(fontSizePx);
  /* ★ 폰에서는 1rem(16px) 아래로 내려가지 않는다 — iOS 가 16px 미만 입력칸에 포커스하면
     화면을 스스로 확대한다(viewport 의 maximum-scale 을 걷어냈으므로 크기로 막아야 한다).
     react-select 의 내부 input 은 **인라인 `font: inherit`** 라 어떤 stylesheet 규칙도
     못 이긴다 — 그래서 index.css 가 아니라 그 부모 슬롯(valueContainer)까지 같이 올린다
     (Fable 게이트 지적: 검색 input 이 13px 로 남아 있었다).

     ★ #406 (Irene 2026-09-03): "셀렉트에 나오는 글자는 왜 커? 어떤 글자들이 안맞게 큰 느낌 나고"
     이 바닥값을 control·placeholder·singleValue 에까지 걸어 두어, **폰에서 셀렉트의 표시 글자만
     16px 로 튀었다.** 주변 라벨·본문은 13~14px 인데 값만 커서 줄이 어긋나 보인다.
     자동확대는 **포커스된 input** 에만 걸린다 — 값을 그리는 span 은 아무리 작아도 확대를
     유발하지 않는다. 그래서 바닥값은 input 과 그 컨테이너에만 남기고 표시 슬롯에서는 걷는다.
     (16px input 은 36px control 안에 그대로 들어간다 — 16×1.2 + 패딩 4 = 23px < 36px.) */
  const phoneFloor = { '@media (max-width: 640px)': { fontSize: `max(1rem, ${fontSize})` } };
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
      ...phoneFloor,
      padding: size === 'sm' ? '2px 12px' : size === 'lg' ? '8px 16px' : '4px 14px',
      fontSize,
    }),
    // ★ 문구는 **감기지 않는다** — 좁으면 말줄임 (2026-09-06).
    //   기본값은 white-space: normal 이라 한국어 플레이스홀더가 두 줄이 되고 컨트롤이
    //   36 → 44px 로 자란다. 실측: Q Note 밴드에서 "프로젝트 연결 안 함" 이 156px 폭에서
    //   "프로젝트 연결 안 / 함" 으로 감겨 밴드가 57 → 65px 이 됐다.
    //   셀렉트가 제 문구를 감아 올리는 것은 어느 화면에서도 깨져 보인다 — 공용에서 막는다.
    placeholder: (base) => ({
      ...base,
      color: C.neutral400,
      fontSize,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '100%',
    }),
    singleValue: (base) => ({
      ...base,
      color: C.neutral900,
      fontSize,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '100%',
    }),
    input: (base) => ({
      ...base,
      ...phoneFloor,
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
      // viewport 경계 강제 — portal 안에서도 화면 안에 들어오게
      maxHeight: 'min(320px, calc(100vh - 80px))',
    }),
    // 포털 렌더 시 z-index — 모달 backdrop(50) 과 Dialog 위에 뜨도록 10000
    menuPortal: (base) => ({ ...base, zIndex: 10000 }),
    menuList: (base) => ({
      ...base,
      padding: 4,
      // menu 보다 약간 작게 (보더/패딩 공간 확보)
      maxHeight: 'min(300px, calc(100vh - 100px))',
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
      // #243 — 긴 이메일 주소가 드롭다운 폭을 넘어 잘려 보이던 문제. 폭을 늘리면 좁은 패널에서
      //   메뉴가 화면 밖으로 나가므로, 옵션 텍스트를 줄바꿈시켜 전체가 보이게 한다.
      whiteSpace: 'normal',
      overflowWrap: 'anywhere',
      lineHeight: 1.45,
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
      fontSize: rem(fontSizePx - 1),
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
        <span style={{ color: C.neutral400, fontSize: '0.75rem' }}>{data.description}</span>
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
  const { size = 'md', hasError = false, density = 'comfortable', creatable = false, ...rest } = props;
  const { t } = useTranslation('common');
  const Cmp = (creatable ? CreatableSelect : Select) as typeof Select;

  return (
    <Cmp
      {...rest}
      styles={buildStyles(size, hasError, density) as any}
      components={{ Option, SingleValue, ...(rest.components || {}) }}
      noOptionsMessage={({ inputValue }) =>
        inputValue
          ? t('select.noResultFor', { defaultValue: "'{{query}}'에 대한 결과 없음", query: inputValue })
          : t('select.noOptions', { defaultValue: '옵션 없음' })
      }
      placeholder={rest.placeholder ?? t('select.placeholder', { defaultValue: '선택하기' })}
      /* ★ 터치 기기에서는 **누르자마자 키보드가 올라오지 않는다** (2026-09-06 운영, Irene 태블릿:
           "셀렉트에서 키보드가 다 올라와… 셀렉트는 원할 때 입력하게 해야 하지 않아?").
         react-select 는 isSearchable 이면 열 때 텍스트 입력에 포커스를 준다 — 마우스에서는
         공짜지만 폰·태블릿에서는 **화면 절반이 키보드로 덮인 채 목록을 골라야 한다.**
         → 거친 포인터(pointer: coarse)면 기본 off. 다만 항목이 많으면 검색 없이 못 고르므로
           그때는 켠다(그 키보드는 사용자가 원한 것이다).
         ★ 호출부가 명시로 넘기면 그것이 이긴다 — 검색이 본질인 곳(담당자 고르기 등)은 그대로. */
      isSearchable={resolveSearchable(rest.isSearchable, Array.isArray(rest.options) ? rest.options.length : 0, creatable)}
      // 모달·드로어 내부에서 드롭다운이 푸터·컨테이너에 가려지는 문제 방지 —
      // document.body 로 포털 렌더. z-index 는 buildStyles.menuPortal 에서 처리.
      menuPortalTarget={rest.menuPortalTarget ?? (typeof document !== 'undefined' ? document.body : null)}
      menuPosition={rest.menuPosition ?? 'fixed'}
      menuPlacement={rest.menuPlacement ?? 'auto'}
      // react-select 가 placement 계산에 사용 — viewport 작은 모바일에서도 작동하도록 보수적 값
      maxMenuHeight={rest.maxMenuHeight ?? 280}
    />
  );
}

export default PlanQSelect;
