// routes/appRoutes.tsx — ⑥ 공유 인증 라우트 테이블 (MainLayout 래핑되는 앱 페이지)
//
// 트리 스왑(커밋8) 시 각 탭 pane 의 MemoryRouter 가 이 테이블을 MainLayout 없이 렌더한다.
// 현재(커밋6)는 shell(App.tsx)이 계속 자기 라우트를 쓰고, 여기는 pane 용 원천으로 대기 + drift 가드가
//   App.tsx 의 MainLayout 라우트 목록과 이 목록이 일치하는지 자동 대조(scripts/guard-app-routes.js).
//   → shell/pane 두 벌이 어긋나 한쪽만 404 나는 사고를 기계로 차단(Fable 지적).
//
// 비페이지 라우트(redirect·팝아웃·standalone·wildcard·public·landing)는 App.tsx 전용(여기 없음).
import { lazy } from 'react';
import type { ReactElement } from 'react';

const DashboardPage = lazy(() => import('../pages/Dashboard/DashboardPage'));
const TodoPage = lazy(() => import('../pages/Todo/TodoPage'));
const NotificationsPage = lazy(() => import('../pages/Notifications/NotificationsPage'));
const ShareReceivePage = lazy(() => import('../pages/ShareReceive/ShareReceivePage'));
const WorkspaceSettingsPage = lazy(() => import('../pages/Settings/WorkspaceSettingsPage'));
const ClientsPage = lazy(() => import('../pages/Clients/ClientsPage'));
const OrgPage = lazy(() => import('../pages/Settings/OrgPage'));
const ClientTimelinePage = lazy(() => import('../pages/Clients/ClientTimelinePage'));
const QTalkPage = lazy(() => import('../pages/QTalk/QTalkPage'));
const QTaskPage = lazy(() => import('../pages/QTask/QTaskPage'));
const KnowledgePage = lazy(() => import('../pages/Knowledge/KnowledgePage'));
const QProjectPage = lazy(() => import('../pages/QProject/QProjectPage'));
const QProjectDetailPage = lazy(() => import('../pages/QProject/QProjectDetailPage'));
const QCalendarPage = lazy(() => import('../pages/QCalendar/QCalendarPage'));
const QNotePage = lazy(() => import('../pages/QNote/QNotePage'));
const QFilePage = lazy(() => import('../pages/QFile/QFilePage'));
const PersonalVaultPage = lazy(() => import('../pages/PersonalVault/PersonalVaultPage'));
const MyFeedbackPage = lazy(() => import('../pages/MyFeedback/MyFeedbackPage'));
const QDocsPage = lazy(() => import('../pages/QDocs/QDocsPage'));
const BriefViewerPage = lazy(() => import('../pages/QDocs/BriefViewerPage'));
const ReceivedSignaturesPage = lazy(() => import('../pages/Signatures/ReceivedSignaturesPage'));
const ProfilePage = lazy(() => import('../pages/Profile/ProfilePage'));
const ProfileIntegrationsPage = lazy(() => import('../pages/Profile/ProfileIntegrationsPage'));
const MyWorkSettingsPage = lazy(() => import('../pages/Profile/MyWorkSettingsPage'));
const MailPage = lazy(() => import('../pages/QMail/MailPage'));
const QBillPage = lazy(() => import('../pages/QBill/QBillPage'));
const InsightsPage = lazy(() => import('../pages/Insights/InsightsPage'));
const AdminDashboardPage = lazy(() => import('../pages/Admin/AdminDashboardPage'));
const AdminBusinessesPage = lazy(() => import('../pages/Admin/AdminBusinessesPage'));
const AdminFeedbackPage = lazy(() => import('../pages/Admin/AdminFeedbackPage'));
const AdminWikiPage = lazy(() => import('../pages/Admin/AdminWikiPage'));
const AdminEmailLogsPage = lazy(() => import('../pages/Admin/AdminEmailLogsPage'));
const AdminPushLogsPage = lazy(() => import('../pages/Admin/AdminPushLogsPage'));
const AdminPlatformSettingsPage = lazy(() => import('../pages/Admin/AdminPlatformSettingsPage'));
const AdminSubscriptionsPage = lazy(() => import('../pages/Admin/AdminSubscriptionsPage'));
const AdminPaymentsPage = lazy(() => import('../pages/Admin/AdminPaymentsPage'));
const AdminBillingSettingsPage = lazy(() => import('../pages/Admin/AdminBillingSettingsPage'));
const AdminInquiriesPage = lazy(() => import('../pages/Admin/AdminInquiriesPage'));
const AdminNotificationsPage = lazy(() => import('../pages/Admin/AdminNotificationsPage'));
const AdminAuditLogsPage = lazy(() => import('../pages/Admin/AdminAuditLogsPage'));
const AdminUsersPage = lazy(() => import('../pages/Admin/AdminUsersPage'));

export type PlatformRole = 'platform_admin' | 'business_owner' | 'business_member' | 'client';
export interface AppRouteDef {
  path: string;
  roles?: PlatformRole[];   // ProtectedRoute requiredRole (미지정 = 인증만)
  element: ReactElement;
}

const BIZ: PlatformRole[] = ['business_owner', 'business_member'];

// App.tsx 의 MainLayout 래핑 인증 라우트와 1:1 (drift 가드가 대조). 순서·path 동일 유지.
export const APP_ROUTES: AppRouteDef[] = [
  { path: '/dashboard', element: <DashboardPage /> },
  { path: '/inbox', element: <TodoPage /> },
  { path: '/notifications', element: <NotificationsPage /> },
  { path: '/share-receive', element: <ShareReceivePage /> },
  { path: '/business/settings/notifications', roles: ['business_owner', 'business_member', 'client'], element: <WorkspaceSettingsPage /> },
  { path: '/business/settings', roles: BIZ, element: <WorkspaceSettingsPage /> },
  { path: '/business/settings/:tab', roles: BIZ, element: <WorkspaceSettingsPage /> },
  { path: '/business/members', roles: BIZ, element: <WorkspaceSettingsPage /> },
  { path: '/business/members/:tab', roles: BIZ, element: <WorkspaceSettingsPage /> },
  { path: '/business/clients', roles: BIZ, element: <ClientsPage /> },
  { path: '/business/org', roles: BIZ, element: <OrgPage /> },
  { path: '/business/clients/:clientId/timeline', roles: BIZ, element: <ClientTimelinePage /> },
  { path: '/talk', element: <QTalkPage /> },
  { path: '/talk/:conversationId', element: <QTalkPage /> },
  { path: '/tasks', element: <QTaskPage /> },
  { path: '/tasks/:scope', element: <QTaskPage /> },
  { path: '/info', element: <KnowledgePage /> },
  { path: '/projects', element: <QProjectPage /> },
  { path: '/projects/p/:id', element: <QProjectDetailPage /> },
  { path: '/projects/:view', element: <QProjectPage /> },
  { path: '/calendar', element: <QCalendarPage /> },
  { path: '/notes', element: <QNotePage /> },
  { path: '/notes/:sessionId', element: <QNotePage /> },
  { path: '/files', element: <QFilePage /> },
  { path: '/personal-vault', element: <PersonalVaultPage /> },
  { path: '/me/feedback', element: <MyFeedbackPage /> },
  { path: '/docs', element: <QDocsPage /> },
  { path: '/docs/brief/:id', element: <BriefViewerPage /> },
  { path: '/signatures/received', element: <ReceivedSignaturesPage /> },
  { path: '/profile', element: <ProfilePage /> },
  { path: '/profile/integrations', element: <ProfileIntegrationsPage /> },
  { path: '/me/work-settings', element: <MyWorkSettingsPage /> },
  { path: '/settings', element: <WorkspaceSettingsPage /> },
  { path: '/settings/:tab', element: <WorkspaceSettingsPage /> },
  { path: '/mail', roles: BIZ, element: <MailPage /> },
  { path: '/bills', element: <QBillPage /> },
  { path: '/stats/:tab', element: <InsightsPage /> },
  { path: '/admin/dashboard', roles: ['platform_admin'], element: <AdminDashboardPage /> },
  { path: '/admin/businesses', roles: ['platform_admin'], element: <AdminBusinessesPage /> },
  { path: '/admin/feedback', roles: ['platform_admin'], element: <AdminFeedbackPage /> },
  { path: '/admin/wiki', roles: ['platform_admin'], element: <AdminWikiPage /> },
  { path: '/admin/email-logs', roles: ['platform_admin'], element: <AdminEmailLogsPage /> },
  { path: '/admin/push-logs', roles: ['platform_admin'], element: <AdminPushLogsPage /> },
  { path: '/admin/platform-settings', roles: ['platform_admin'], element: <AdminPlatformSettingsPage /> },
  { path: '/admin/subscriptions', roles: ['platform_admin'], element: <AdminSubscriptionsPage /> },
  { path: '/admin/payments', roles: ['platform_admin'], element: <AdminPaymentsPage /> },
  { path: '/admin/billing-settings', roles: ['platform_admin'], element: <AdminBillingSettingsPage /> },
  { path: '/admin/inquiries', roles: ['platform_admin'], element: <AdminInquiriesPage /> },
  { path: '/admin/notifications', roles: ['platform_admin'], element: <AdminNotificationsPage /> },
  { path: '/admin/audit-logs', roles: ['platform_admin'], element: <AdminAuditLogsPage /> },
  { path: '/admin/users', roles: ['platform_admin'], element: <AdminUsersPage /> },
];

// drift 가드용 — path 목록 (App.tsx MainLayout 라우트와 대조)
export const AUTH_ROUTE_PATHS = APP_ROUTES.map((r) => r.path);
