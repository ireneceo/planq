/**
 * PlanQ 공통 아이콘 — Feather-style stroke SVG.
 *
 * 좌측 사이드바와 동일한 디자인 시스템:
 * - 16x16 또는 size prop
 * - stroke="currentColor", strokeWidth=2
 * - line-cap/join: round
 *
 * 이모지(🎙️ 🌏 🇰🇷 등) 사용 금지. 필요한 아이콘은 여기 추가.
 */
import type { SVGProps } from 'react';

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const MicIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

export const MonitorIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

export const StopIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <rect x="5" y="5" width="14" height="14" rx="1" />
  </svg>
);

export const PlayIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <polygon points="6 4 20 12 6 20 6 4" />
  </svg>
);

export const PlusIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const CheckIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const HelpCircleIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export const ArrowRightIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

export const SearchIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export const CloseIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const FileTextIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

export const XIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const TrashIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

export const UserIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const SettingsIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const PowerIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    <line x1="12" y1="2" x2="12" y2="12" />
  </svg>
);

export const ChevronUpIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

export const ChevronDownIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const MergeIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M6 21V9a9 9 0 0 0 9 9" />
  </svg>
);

export const InboxIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

export const ChatIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

export const MailIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

export const BellIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

export const SparkleIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
  </svg>
);

export const ClipboardIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
  </svg>
);

export const FileIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

export const EditIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

export const CalendarIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

export const ClockIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

export const AlertTriangleIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
