// ============================================================================
// PlanQ Design Token System — 프로젝트의 유일한 디자인 값 소스
// 모든 색상, 간격, 폰트 등은 반드시 이 파일에서 import하여 사용
// 하드코딩 금지: #6C5CE7 → theme.colors.primary
// ============================================================================

export const theme = {
  colors: {
    // Brand
    primary: '#6C5CE7',
    primaryHover: '#5B4ED6',
    primaryLight: 'rgba(108, 92, 231, 0.1)',
    primaryShadow: 'rgba(108, 92, 231, 0.3)',

    secondary: '#0A2540',
    secondaryLight: '#F8FAFC',

    // Backgrounds
    background: '#FAFBFC',
    backgroundAlt: '#F6F9FC',
    surface: '#FFFFFF',
    surfaceHover: '#F8FAFC',
    surfaceMuted: '#F3F4F6',

    // Text
    text: {
      primary: '#0A2540',
      secondary: '#6B7C93',
      light: '#8898AA',
      muted: '#6B7280',
      dark: '#374151',
      placeholder: '#9CA3AF',
    },

    // Status
    status: {
      success: '#28C76F',
      successAlt: '#059669',
      successAlt2: '#10B981',
      successLight: '#ECFDF5',
      successDark: '#15803D',
      warning: '#FF9F43',
      warningAlt: '#D97706',
      warningLight: '#FFF7ED',
      warningLightAlt: '#FEF3C7',
      error: '#EA5455',
      errorLight: '#FEF2F2',
      errorLightAlt: '#FEE2E2',
      info: '#00CFE8',
    },

    // Danger
    danger: '#DC2626',
    dangerHover: '#B91C1C',
    dangerLight: '#FEF2F2',
    dangerBorder: '#FCA5A5',
    dangerShadow: 'rgba(220, 38, 38, 0.3)',

    // Borders
    border: '#E6EBF1',
    borderLight: '#E5E7EB',
    borderHover: '#CBD5E1',

    // Disabled
    disabled: {
      background: '#F3F4F6',
      text: '#D1D5DB',
      primaryBg: '#B8B3FF',
      dangerBg: '#FCA5A5',
    },
  },

  typography: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: {
      xs: '12px',
      sm: '14px',
      base: '16px',
      lg: '18px',
      xl: '20px',
      '2xl': '24px',
      '3xl': '30px',
    },
    fontWeight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
  },

  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    '2xl': '48px',
  },

  borderRadius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    full: '9999px',
  },

  shadows: {
    sm: '0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06)',
    md: '0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.05)',
    lg: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    primaryHover: '0 4px 12px rgba(108, 92, 231, 0.3)',
    dangerHover: '0 4px 12px rgba(220, 38, 38, 0.3)',
  },

  transitions: {
    fast: '150ms ease-in-out',
    normal: '300ms ease-in-out',
    slow: '500ms ease-in-out',
  },

  breakpoints: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
  },

  // 컴포넌트별 토큰
  components: {
    button: {
      paddingSm: '8px 14px',
      paddingMd: '12px 20px',
      paddingLg: '16px 28px',
      iconSizeSm: '14px',
      iconSizeMd: '16px',
      iconSizeLg: '18px',
    },
    modal: {
      overlayBg: 'rgba(0, 0, 0, 0.5)',
      widthSm: '400px',
      widthMd: '600px',
      widthLg: '800px',
      headerPadding: '24px',
      bodyPadding: '24px',
      footerPadding: '20px 24px',
    },
  },
};

export type Theme = typeof theme;
