// components/Tab/tabIcon.ts — ⑥ 탭 kind → Q 시리즈 아이콘 (사이드바와 동일 컴포넌트)
import type { FC } from 'react';
import {
  DashboardIcon, TodoCheckIcon, ChatIcon, TaskIcon, NoteIcon, FileTextIcon,
  CalendarIcon, BillIcon, MailIcon, ProjectIcon, FolderIcon, ClientsIcon,
  BookIcon, InsightsIcon, SettingsIcon, UserIcon,
} from '../Common/Icons';
import type { TabKind } from '../../stores/tabStore';

interface IconComp { (props: { size?: number }): ReturnType<FC>; }

const KIND_ICON: Record<TabKind, IconComp> = {
  dashboard: DashboardIcon,
  inbox: TodoCheckIcon,
  talk: ChatIcon,
  task: TaskIcon,
  note: NoteIcon,
  docs: FileTextIcon,
  calendar: CalendarIcon,
  bill: BillIcon,
  mail: MailIcon,
  project: ProjectIcon,
  projectDetail: ProjectIcon,
  files: FolderIcon,
  clients: ClientsIcon,
  info: BookIcon,
  other: SettingsIcon,
};

export function iconForTab(kind: TabKind, path: string): IconComp {
  if (kind === 'other') {
    if (path.startsWith('/stats') || path.startsWith('/insights')) return InsightsIcon;
    if (path.startsWith('/profile') || path.startsWith('/me/')) return UserIcon;
    return SettingsIcon;
  }
  return KIND_ICON[kind] || SettingsIcon;
}
