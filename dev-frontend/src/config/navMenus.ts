// config/navMenus.ts — 이동 가능한 메뉴(페이지) 레지스트리
//
// #210 — "상단 탭 + 누르면 메뉴들 선택도 되게. 검색해도 메뉴명이 안 나와서 갈 방법이 없어."
//   통합 검색(GlobalSearchModal)이 데이터(업무·문서·파일…)만 검색하고 메뉴 자체는 결과에 없었다.
//   → 이 파일이 메뉴 목록의 단일 원천. 사이드바(MainLayout)와 같은 경로·같은 i18n 키·같은 역할 조건.
//   ⚠ 사이드바에 메뉴를 추가/삭제하면 이 파일도 같이 갱신할 것.
//
//   문구는 전부 i18n(layout ns) — 이 파일에는 사용자 노출 문자열을 두지 않는다.
//   검색 동의어도 언어별 콘텐츠라 locales 의 `nav.searchAliases.<key>`(쉼표 구분)에 둔다.

export type NavRole = 'owner' | 'member' | 'client';

export type NavSection = 'main' | 'features' | 'personal' | 'manage' | 'settings' | 'account' | 'admin';

export interface NavMenuEntry {
  key: string;              // 고유 키 (검색 보조 매칭 + searchAliases 키)
  to: string;               // 라우트
  labelKey: string;         // layout 네임스페이스 i18n 키 (사이드바와 동일)
  section: NavSection;
  // 워크스페이스 역할 조건 — any 는 로그인만 하면 노출
  roles: NavRole[] | 'any';
}

/** 섹션 헤더 i18n 키 (layout ns) */
export const SECTION_LABEL_KEY: Record<NavSection, string> = {
  main: 'nav.sectionMain',
  features: 'nav.sectionFeatures',
  personal: 'nav.sectionPersonal',
  manage: 'nav.sectionManage',
  settings: 'nav.settings',
  account: 'nav.myAccount',
  admin: 'nav.sectionAdmin',
};

// ── 워크스페이스 메뉴 (사이드바 일반 모드) ──
export const WORKSPACE_MENUS: NavMenuEntry[] = [
  { key: 'dashboard', to: '/dashboard', labelKey: 'nav.dashboard', section: 'main', roles: 'any' },
  { key: 'inbox', to: '/inbox', labelKey: 'nav.inbox', section: 'main', roles: 'any' },

  { key: 'talk', to: '/talk', labelKey: 'nav.talk', section: 'features', roles: ['owner', 'member', 'client'] },
  { key: 'mail', to: '/mail', labelKey: 'nav.qmail', section: 'features', roles: ['owner', 'member'] },
  { key: 'sale', to: '/sale', labelKey: 'nav.qsale', section: 'features', roles: ['owner', 'member'] },
  { key: 'task', to: '/tasks', labelKey: 'nav.task', section: 'features', roles: ['owner', 'member', 'client'] },
  { key: 'project', to: '/projects', labelKey: 'nav.project', section: 'features', roles: ['owner', 'member', 'client'] },
  { key: 'calendar', to: '/calendar', labelKey: 'nav.calendar', section: 'features', roles: ['owner', 'member', 'client'] },
  { key: 'note', to: '/notes', labelKey: 'nav.note', section: 'features', roles: ['owner', 'member'] },
  { key: 'docs', to: '/docs', labelKey: 'nav.docs', section: 'features', roles: ['owner', 'member'] },
  { key: 'info', to: '/info', labelKey: 'nav.qinfo', section: 'features', roles: ['owner', 'member'] },
  { key: 'files', to: '/files', labelKey: 'nav.file', section: 'features', roles: ['owner', 'member'] },
  { key: 'bill', to: '/bills', labelKey: 'nav.qbill', section: 'features', roles: ['owner', 'member', 'client'] },

  { key: 'personal-vault', to: '/personal-vault', labelKey: 'nav.personalVault', section: 'personal', roles: ['owner', 'member'] },
  // ★ 2026-09-17 (#414) — **새 소식·알림을 메뉴 표에 올린다.** Irene:
  //   *"스피커랑 알림을 좌측 상단 아이콘에서 전체보기를 열면 탭이 설정으로 떠. …
  //     아님 내문의, 피드백이랑 묶어서 4개 다 같은 메뉴 될 수 있지 않나"*
  //   여태 이 둘은 헤더 아이콘으로만 여는 화면이라 **표에 없었다** — 소속이 없으니 탭에서
  //   좌측 2뎁스도 안 열리고 이름도 기본값으로 떨어졌다.
  //   자리는 «설정» 이 아니라 **개인**이다: 알림·새 소식·내 문의는 워크스페이스 설정이 아니라
  //   **나에게 온 것**이고, 그 섹션에 이미 내 문의·피드백이 있다(Irene 의 두 번째 안).
  //   ★ 표에 올렸으니 EXTRA_PAGE_LABELS 에서는 뺀다 — 같은 값을 두 곳에 두면 갈라진다.
  { key: 'whats-new', to: '/whats-new', labelKey: 'nav.whatsNew', section: 'personal', roles: ['owner', 'member'] },
  { key: 'notifications', to: '/notifications', labelKey: 'nav.notifications', section: 'personal', roles: ['owner', 'member'] },
  { key: 'my-feedback', to: '/me/feedback', labelKey: 'nav.myFeedback', section: 'personal', roles: ['owner', 'member'] },
  { key: 'received-signatures', to: '/signatures/received', labelKey: 'nav.receivedSignatures', section: 'personal', roles: ['owner', 'member'] },

  { key: 'stats-overview', to: '/stats/overview', labelKey: 'nav.statsOverview', section: 'manage', roles: ['owner', 'member'] },
  { key: 'stats-tasks', to: '/stats/tasks', labelKey: 'nav.statsTaskTime', section: 'manage', roles: ['owner', 'member'] },
  { key: 'stats-weekly', to: '/stats/weekly', labelKey: 'nav.statsWeekly', section: 'manage', roles: ['owner', 'member'] },
  { key: 'stats-profit', to: '/stats/profit', labelKey: 'nav.statsProfit', section: 'manage', roles: ['owner', 'member'] },
  { key: 'stats-team', to: '/stats/team', labelKey: 'nav.statsTeam', section: 'manage', roles: ['owner', 'member'] },
  { key: 'stats-finance', to: '/stats/finance', labelKey: 'nav.statsFinance', section: 'manage', roles: ['owner', 'member'] },
  { key: 'stats-reports', to: '/stats/reports', labelKey: 'nav.statsReports', section: 'manage', roles: ['owner', 'member'] },

  { key: 'ws-settings', to: '/business/settings', labelKey: 'nav.workspaceSettings', section: 'settings', roles: ['owner', 'member'] },
  { key: 'ws-plan', to: '/business/settings/plan', labelKey: 'nav.plan', section: 'settings', roles: ['owner'] },
  { key: 'ws-work-env', to: '/business/settings/work-env', labelKey: 'nav.workEnv', section: 'settings', roles: ['owner', 'member'] },
  { key: 'ws-permissions', to: '/business/settings/permissions', labelKey: 'nav.permissions', section: 'settings', roles: ['owner', 'member'] },
  { key: 'ws-billing', to: '/business/settings/billing', labelKey: 'nav.billing', section: 'settings', roles: ['owner'] },
  { key: 'ws-org', to: '/business/org', labelKey: 'nav.org', section: 'settings', roles: ['owner'] },
  { key: 'ws-members', to: '/business/members', labelKey: 'nav.members', section: 'settings', roles: ['owner'] },
  { key: 'ws-clients', to: '/business/clients', labelKey: 'nav.clients', section: 'settings', roles: ['owner', 'member'] },
  { key: 'ws-cue', to: '/business/settings/cue', labelKey: 'nav.cue', section: 'settings', roles: ['owner'] },
  { key: 'ws-company-mail', to: '/business/settings/mail-accounts', labelKey: 'nav.companyMail', section: 'settings', roles: ['owner', 'member'] },
  { key: 'ws-email', to: '/business/settings/email', labelKey: 'nav.email', section: 'settings', roles: ['owner'] },
  { key: 'ws-storage', to: '/business/settings/storage', labelKey: 'nav.storage', section: 'settings', roles: ['owner'] },
  { key: 'ws-backup', to: '/business/settings/data-export', labelKey: 'nav.wsBackup', section: 'settings', roles: ['owner'] },

  { key: 'me-profile', to: '/profile', labelKey: 'user.profile', section: 'account', roles: 'any' },
  { key: 'me-integrations', to: '/profile/integrations', labelKey: 'nav.myIntegrations', section: 'account', roles: ['owner', 'member'] },
  { key: 'me-mail-accounts', to: '/business/settings/mail-accounts?scope=personal', labelKey: 'nav.myMailAccounts', section: 'account', roles: ['owner', 'member'] },
  { key: 'me-work-env', to: '/me/work-settings', labelKey: 'nav.myWorkEnv', section: 'account', roles: ['owner', 'member'] },
  { key: 'me-notifications', to: '/business/settings/notifications', labelKey: 'nav.myNotifications', section: 'account', roles: 'any' },
  { key: 'me-data', to: '/business/settings/data-export?scope=personal', labelKey: 'nav.myData', section: 'account', roles: ['owner', 'member'] },
];

// ── 플랫폼 관리 메뉴 (사이드바 /admin 모드) ──
export const ADMIN_MENUS: NavMenuEntry[] = [
  { key: 'admin-dashboard', to: '/admin/dashboard', labelKey: 'nav.dashboard', section: 'admin', roles: 'any' },
  { key: 'admin-users', to: '/admin/users', labelKey: 'nav.users', section: 'admin', roles: 'any' },
  { key: 'admin-businesses', to: '/admin/businesses', labelKey: 'nav.businesses', section: 'admin', roles: 'any' },
  { key: 'admin-inquiries', to: '/admin/inquiries', labelKey: 'nav.inquiries', section: 'admin', roles: 'any' },
  { key: 'admin-feedback', to: '/admin/feedback', labelKey: 'nav.feedback', section: 'admin', roles: 'any' },
  { key: 'admin-dev-status', to: '/admin/dev-status', labelKey: 'nav.devStatus', section: 'admin', roles: 'any' },
  { key: 'admin-wiki', to: '/admin/wiki', labelKey: 'nav.wiki', section: 'admin', roles: 'any' },
  { key: 'admin-email-logs', to: '/admin/email-logs', labelKey: 'nav.emailLogs', section: 'admin', roles: 'any' },
  { key: 'admin-push-logs', to: '/admin/push-logs', labelKey: 'nav.pushLogs', section: 'admin', roles: 'any' },
  { key: 'admin-platform-settings', to: '/admin/platform-settings', labelKey: 'nav.platformSettings', section: 'admin', roles: 'any' },
  { key: 'admin-subscriptions', to: '/admin/subscriptions', labelKey: 'nav.subscriptions', section: 'admin', roles: 'any' },
  { key: 'admin-payments', to: '/admin/payments', labelKey: 'nav.payments', section: 'admin', roles: 'any' },
  { key: 'admin-billing-settings', to: '/admin/billing-settings', labelKey: 'nav.billingSettings', section: 'admin', roles: 'any' },
  { key: 'admin-notifications', to: '/admin/notifications', labelKey: 'nav.adminNotifications', section: 'admin', roles: 'any' },
  { key: 'admin-audit-logs', to: '/admin/audit-logs', labelKey: 'nav.adminAuditLogs', section: 'admin', roles: 'any' },
  // ★ 사이드바(MainLayout:1356)에는 있는데 이 표에 없었다 — 표가 단일 원천이므로 빠지면
  //   탭 이름도 `+` 검색 목록도 같이 빠진다(2026-09-17 전수 검사로 발견).
  { key: 'admin-updates', to: '/admin/updates', labelKey: 'nav.updates', section: 'admin', roles: 'any' },
];

/**
 * 현재 사용자가 볼 수 있는 메뉴 — 사이드바와 동일한 역할 조건.
 *
 * ★ `scope` 는 **선택이 아니라 격리선**이다. 예전엔 인자가 없어서 platform_admin 이면
 *   *어디에 있든* 워크스페이스 메뉴 + 관리자 메뉴를 합쳐서 돌려줬다. 그래서 관리자 화면의
 *   탭 `+` 목록에 Q Talk·확인 필요 같은 워크스페이스 메뉴가 섞여 나왔고, 그걸 누르면
 *   `tabStore.newTab` → `ensureScopeFor` 가 **말없이 범위를 워크스페이스로 갈아끼워**
 *   직전 워크스페이스의 탭 목록이 통째로 되살아났다.
 *   Irene 2026-09-10: *"탭을 열면 다른 워크스페이스 탭이 열려."* — 그 문이 여기다.
 *   생략하면 종전대로(둘 다) 이므로, 부르는 쪽은 **자기가 어느 범위인지 반드시 넘긴다.**
 */
export function visibleNavMenus(opts: {
  businessRole?: string | null;
  isPlatformAdmin?: boolean;
  /** 'admin' = 플랫폼 관리자 범위(관리자 메뉴만) · 'workspace' = 워크스페이스 범위(워크스페이스 메뉴만) */
  scope?: 'admin' | 'workspace';
}): NavMenuEntry[] {
  const role = (opts.businessRole || null) as NavRole | null;
  const ws = WORKSPACE_MENUS.filter((m) => {
    if (m.roles === 'any') return true;
    return !!role && (m.roles as NavRole[]).includes(role);
  });
  if (opts.scope === 'admin') return opts.isPlatformAdmin ? ADMIN_MENUS : [];
  if (opts.scope === 'workspace') return ws;
  return opts.isPlatformAdmin ? [...ws, ...ADMIN_MENUS] : ws;
}

/**
 * 관리자 경로 → 사이드바와 **같은** i18n 라벨 키. 탭 제목이 여기서 온다.
 *
 * ★ 화면마다 `useTabTitle` 을 부르게 하지 않는다 — 관리자 화면 15개 중 하나만 빠뜨려도
 *   그 탭만 조용히 "설정" 으로 떨어진다(기본값으로 떨어지는 것이 곧 버그다).
 *   표가 이미 단일 원천이니 표를 읽는다. 메뉴를 추가하면 탭 이름도 자동으로 따라온다.
 * 접두어가 가장 긴 항목을 고른다 — `/admin/wiki/123` 같은 하위 경로도 부모 라벨을 받는다.
 */

/**
 * 메뉴 표에 **없는데** 탭으로 열리는 화면들. 여기 없으면 탭 이름이 기본값으로 떨어진다.
 * (사이드바 메뉴가 아니라 헤더 아이콘·딥링크로만 여는 화면들이다.)
 */
const EXTRA_PAGE_LABELS: Array<[string, string]> = [
  ['/todo', 'nav.inbox'],
  ['/settings', 'nav.settings'],
  ['/profile', 'user.profile'],
  ['/knowledge', 'nav.qinfo'],
  ['/attendance', 'nav.attendance'],
  ['/wiki', 'nav.helpCenter'],
  ['/billing', 'nav.billing'],
  ['/records', 'nav.records'],
  ['/personal-vault', 'nav.personalVault'],
  ['/me/feedback', 'nav.myFeedback'],
  ['/me/work-settings', 'nav.myWorkEnv'],
  ['/signatures/received', 'nav.receivedSignatures'],
  // 인덱스 경로 — 하위로 리다이렉트되지만 탭은 이 경로로 먼저 만들어진다(짧은 순간 "설정" 이 보인다).
  ['/stats', 'nav.statsOverview'],
  ['/admin', 'nav.sectionAdmin'],
  ['/', 'nav.dashboard'],
];

/**
 * **모든** 경로 → 탭 이름 i18n 키. 관리자·워크스페이스 메뉴 표와 위 보충표를 한 번에 읽는다.
 *
 * ★ 왜 표인가 — 화면마다 `useTabTitle` 을 부르게 하면 **하나만 빠뜨려도 그 탭만** 조용히
 *   기본값으로 떨어진다. 2026-09-10 에 `/admin` 만 이 방식으로 고쳤는데 나머지 30여 경로는
 *   그대로 남아서 Irene 이 다시 신고했다 — *"전체보기를 열면 탭이 설정으로 떠"*(#414).
 *   기본값으로 떨어지는 것이 곧 버그다(상태값 규약과 같은 계열).
 * 접두어가 가장 긴 항목을 고른다.
 */
export function navLabelKeyForPath(path: string): string | null {
  const p = (path || '').split('?')[0].replace(/\/+$/, '') || '/';
  let best: { to: string; labelKey: string } | null = null;
  const consider = (to: string, labelKey: string) => {
    const base = to.split('?')[0];
    if (p === base || p.startsWith(`${base}/`)) {
      if (!best || base.length > best.to.length) best = { to: base, labelKey };
    }
  };
  for (const m of ADMIN_MENUS) consider(m.to, m.labelKey);
  for (const m of WORKSPACE_MENUS) consider(m.to, m.labelKey);
  for (const [to, labelKey] of EXTRA_PAGE_LABELS) consider(to, labelKey);
  return best ? (best as { to: string; labelKey: string }).labelKey : null;
}

export function adminLabelKeyForPath(path: string): string | null {
  const p = (path || '').split('?')[0].replace(/\/+$/, '') || '/';
  let best: NavMenuEntry | null = null;
  for (const m of ADMIN_MENUS) {
    if (p === m.to || p.startsWith(`${m.to}/`)) {
      if (!best || m.to.length > best.to.length) best = m;
    }
  }
  return best ? best.labelKey : null;
}
