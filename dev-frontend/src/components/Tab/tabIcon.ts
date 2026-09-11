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
  sale: ClientsIcon,   // Q sale — 고객의 영업 뷰라 고객 아이콘을 공유한다
  project: ProjectIcon,
  projectDetail: ProjectIcon,
  files: FolderIcon,
  clients: ClientsIcon,
  info: BookIcon,
  admin: SettingsIcon,
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
