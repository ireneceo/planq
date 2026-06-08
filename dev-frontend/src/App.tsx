import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { PwaInstallProvider } from './contexts/PwaInstallContext';
// 첫 paint 에 반드시 필요한 eager — Auth/PWA context, Layout, ErrorBoundary, ProtectedRoute, prefetch
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/Common/ErrorBoundary';
import { installRoutePrefetch } from './lib/routePrefetch';
import MainLayout from './components/Layout/MainLayout';

// 사이클 N+17 — 조건부 표시 / idle 시점 mount 컴포넌트는 모두 lazy.
// 첫 paint 에 안 보이는 (조건 X) 또는 비활성 (toast/alert/PWA banner) 컴포넌트가 main bundle 부담.
// lazy 화 → entry preload ↓ 첫 로드 시간 ↓. Suspense fallback={null} 로 invisible 동안 무영향.
const NotificationToaster = lazy(() => import('./components/Common/NotificationToaster'));
const PwaInstallBanner = lazy(() => import('./components/Common/PwaInstallBanner'));
const OpenInAppBanner = lazy(() => import('./components/Common/OpenInAppBanner'));
const BuildVersionGuard = lazy(() => import('./components/Common/BuildVersionGuard'));
const LimitReachedDialog = lazy(() => import('./components/Common/LimitReachedDialog'));
const AnnouncementBanner = lazy(() => import('./components/Common/AnnouncementBanner'));
const TermsReacceptModal = lazy(() => import('./components/Common/TermsReacceptModal'));
const ImpersonateBanner = lazy(() => import('./components/Common/ImpersonateBanner'));
const CueHelpDrawer = lazy(() => import('./components/Common/CueHelpDrawer'));
const MemoFab = lazy(() => import('./components/QNote/MemoFab'));

// Eager — 자주 진입하거나 첫 화면 (Login). 분리해도 의미 작음
import LoginPage from './pages/Login/LoginPage';

// Route-based code splitting — 페이지별 별도 chunk 로 첫 로드 번들 축소.
// 이전: 모든 페이지 eager import → main bundle 2.75MB. 새로고침 시 모두 파싱·실행.
// 변경: 페이지 진입 시점에 해당 chunk 만 로드. 첫 로드 ~800KB, 후속 진입 ~30KB 페이지별.
const RegisterPage = lazy(() => import('./pages/Register/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/Login/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/Login/ResetPasswordPage'));
const VerifyEmailPage = lazy(() => import('./pages/Login/VerifyEmailPage'));
const OAuthCallbackPage = lazy(() => import('./pages/Login/OAuthCallbackPage'));
const OauthConnectConfirmPage = lazy(() => import('./pages/Login/OauthConnectConfirmPage'));
const QNotePage = lazy(() => import('./pages/QNote/QNotePage'));
// 사이클 N+17 hotfix — 메모 분리 창 전용 minimal page (MainLayout 우회)
const MemoStandalonePage = lazy(() => import('./pages/QNote/MemoStandalonePage'));
const ProfilePage = lazy(() => import('./pages/Profile/ProfilePage'));
const ProfileIntegrationsPage = lazy(() => import('./pages/Profile/ProfileIntegrationsPage'));
const MyWorkSettingsPage = lazy(() => import('./pages/Profile/MyWorkSettingsPage'));
const WorkspaceSettingsPage = lazy(() => import('./pages/Settings/WorkspaceSettingsPage'));
const QTalkPage = lazy(() => import('./pages/QTalk/QTalkPage'));
const PersonalVaultPage = lazy(() => import('./pages/PersonalVault/PersonalVaultPage'));
const QTaskPage = lazy(() => import('./pages/QTask/QTaskPage'));
const QProjectPage = lazy(() => import('./pages/QProject/QProjectPage'));
const QProjectDetailPage = lazy(() => import('./pages/QProject/QProjectDetailPage'));
const ClientsPage = lazy(() => import('./pages/Clients/ClientsPage'));
const ClientTimelinePage = lazy(() => import('./pages/Clients/ClientTimelinePage'));
const InvitePage = lazy(() => import('./pages/Invite/InvitePage'));
const QCalendarPage = lazy(() => import('./pages/QCalendar/QCalendarPage'));
const QDocsPage = lazy(() => import('./pages/QDocs/QDocsPage'));
const BriefViewerPage = lazy(() => import('./pages/QDocs/BriefViewerPage'));
const ReceivedSignaturesPage = lazy(() => import('./pages/Signatures/ReceivedSignaturesPage'));
const PublicDocPage = lazy(() => import('./pages/QDocs/PublicDocPage'));
const PublicPostPage = lazy(() => import('./pages/QDocs/PublicPostPage'));
const PublicTaskPage = lazy(() => import('./pages/Public/PublicTaskPage'));
const PublicFilePage = lazy(() => import('./pages/Public/PublicFilePage'));
const PublicKbDocumentPage = lazy(() => import('./pages/Public/PublicKbDocumentPage'));
const PublicKbBundlePage = lazy(() => import('./pages/Public/PublicKbBundlePage'));
const PublicCalendarEventPage = lazy(() => import('./pages/Public/PublicCalendarEventPage'));
const PublicSignPage = lazy(() => import('./pages/QDocs/PublicSignPage'));
const PublicInvoicePage = lazy(() => import('./pages/QBill/PublicInvoicePage'));
const PublicQNoteSessionPage = lazy(() => import('./pages/QNote/PublicQNoteSessionPage'));
const QFilePage = lazy(() => import('./pages/QFile/QFilePage'));
const AdminBusinessesPage = lazy(() => import('./pages/Admin/AdminBusinessesPage'));
const AdminFeedbackPage = lazy(() => import('./pages/Admin/AdminFeedbackPage'));
const AdminEmailLogsPage = lazy(() => import('./pages/Admin/AdminEmailLogsPage'));
const AdminPushLogsPage = lazy(() => import('./pages/Admin/AdminPushLogsPage'));
const AdminPlatformSettingsPage = lazy(() => import('./pages/Admin/AdminPlatformSettingsPage'));
const AdminSubscriptionsPage = lazy(() => import('./pages/Admin/AdminSubscriptionsPage'));
const AdminPaymentsPage = lazy(() => import('./pages/Admin/AdminPaymentsPage'));
const AdminBillingSettingsPage = lazy(() => import('./pages/Admin/AdminBillingSettingsPage'));
const AdminInquiriesPage = lazy(() => import('./pages/Admin/AdminInquiriesPage'));
const AdminNotificationsPage = lazy(() => import('./pages/Admin/AdminNotificationsPage'));
const AdminAuditLogsPage = lazy(() => import('./pages/Admin/AdminAuditLogsPage'));
const AdminUsersPage = lazy(() => import('./pages/Admin/AdminUsersPage'));
const ShareReceivePage = lazy(() => import('./pages/ShareReceive/ShareReceivePage'));
const InsightsPage = lazy(() => import('./pages/Insights/InsightsPage'));
const PrivacyPolicy = lazy(() => import('./pages/Legal/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/Legal/TermsOfService'));
// N+75-D Q Mail M2 — 인박스 read-only (옛 ComingSoonPage 자리 대체)
const MailPage = lazy(() => import('./pages/QMail/MailPage'));
// Landing — 비로그인 외부 트래픽이 보는 영역 (HomePage 는 RootRoute 에서 직접 import)
const LandingFeatures = lazy(() => import('./pages/Landing/FeaturesPage'));
const LandingPricing = lazy(() => import('./pages/Landing/PricingPage'));
const LandingAbout = lazy(() => import('./pages/Landing/AboutPage'));
const LandingContact = lazy(() => import('./pages/Landing/ContactPage'));
const LandingBlog = lazy(() => import('./pages/Landing/BlogPage'));
const RootRoute = lazy(() => import('./pages/Landing/RootRoute'));
const DashboardPage = lazy(() => import('./pages/Dashboard/DashboardPage'));
const TodoPage = lazy(() => import('./pages/Todo/TodoPage'));
const NotificationsPage = lazy(() => import('./pages/Notifications/NotificationsPage'));
const QBillPage = lazy(() => import('./pages/QBill/QBillPage'));
const KnowledgePage = lazy(() => import('./pages/Knowledge/KnowledgePage'));
// Q record 메뉴는 폐지 — Q docs 의 표 kind 로 흡수. /records → /docs redirect.
// 이전 record id 직접 진입 (/records/:id) 시 연결된 post 로 리다이렉트 (RecordToDocRedirect)
const RecordToDocRedirect = lazy(() => import('./pages/Records/RecordToDocRedirect'));
import './App.css';

// 페이지 chunk 로딩 중 표시 — 빠르고 가벼운 fallback (CLS 방지 위해 viewport 채움)
const PageLoadingFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 64px)', background: '#F8FAFC' }}>
    <div style={{ width: 32, height: 32, border: '3px solid #E2E8F0', borderTopColor: '#14B8A6', borderRadius: '50%', animation: 'planq-spin 0.8s linear infinite' }} />
    <style>{'@keyframes planq-spin { to { transform: rotate(360deg); } }'}</style>
  </div>
);

// Placeholder pages - will be replaced per phase
const PlaceholderPage = ({ title }: { title: string }) => (
  <div style={{ padding: '32px', background: '#F8FAFC', minHeight: 'calc(100vh - 64px)' }}>
    <h1 style={{ color: '#0F172A', fontSize: '24px', fontWeight: 700 }}>{title}</h1>
    <p style={{ color: '#475569', marginTop: '8px' }}>Coming soon</p>
  </div>
);

function App() {
  // 라우트 청크 prefetch — idle 시점 핵심 페이지 + 전역 hover/focus delegation
  useEffect(() => installRoutePrefetch(), []);
  return (
    <ErrorBoundary>
    <AuthProvider>
    <PwaInstallProvider>
      <Suspense fallback={<PageLoadingFallback />}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route path="/oauth/connect-confirm" element={<OauthConnectConfirmPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />

        {/* Authenticated routes with MainLayout */}
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <MainLayout><DashboardPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/inbox" element={
          <ProtectedRoute>
            <MainLayout><TodoPage /></MainLayout>
          </ProtectedRoute>
        } />
        {/* 하위 호환 redirect: 이전 북마크 */}
        <Route path="/todo" element={<Navigate to="/inbox" replace />} />
        {/* N+63 — 알림 feed (Activity Feed). 확인 필요 (/inbox = Action Queue) 와 별도. */}
        <Route path="/notifications" element={
          <ProtectedRoute>
            <MainLayout><NotificationsPage /></MainLayout>
          </ProtectedRoute>
        } />

        {/* PWA Share Target — 외부 공유 시트 → PlanQ 진입 */}
        <Route path="/share-receive" element={
          <ProtectedRoute>
            <MainLayout><ShareReceivePage /></MainLayout>
          </ProtectedRoute>
        } />

        {/* 통계·분석 redirect 만 (실제 라우트는 아래 /stats/:tab 단일 정의) */}
        <Route path="/stats" element={<Navigate to="/stats/overview" replace />} />
        <Route path="/insights" element={<Navigate to="/stats/overview" replace />} />

        {/* 알림 설정은 client 도 접근 가능 — :tab 보다 먼저 매칭 */}
        <Route path="/business/settings/notifications" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member', 'client']}>
            <MainLayout><WorkspaceSettingsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/business/settings" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <MainLayout><WorkspaceSettingsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/business/settings/:tab" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <MainLayout><WorkspaceSettingsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/business/members" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <MainLayout><WorkspaceSettingsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/business/members/:tab" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <MainLayout><WorkspaceSettingsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/business/clients" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <MainLayout><ClientsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/business/clients/:clientId/timeline" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <MainLayout><ClientTimelinePage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/business/*" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <Navigate to="/business/settings" replace />
          </ProtectedRoute>
        } />

        <Route path="/talk" element={
          <ProtectedRoute>
            <MainLayout><QTalkPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/talk/:conversationId" element={
          <ProtectedRoute>
            <MainLayout><QTalkPage /></MainLayout>
          </ProtectedRoute>
        } />

        <Route path="/tasks" element={
          <ProtectedRoute>
            <MainLayout><QTaskPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/tasks/:scope" element={
          <ProtectedRoute>
            <MainLayout><QTaskPage /></MainLayout>
          </ProtectedRoute>
        } />

        <Route path="/info" element={
          <ProtectedRoute>
            <MainLayout><KnowledgePage /></MainLayout>
          </ProtectedRoute>
        } />
        {/* 호환: 이전 URL /knowledge → /info */}
        <Route path="/knowledge" element={<Navigate to="/info" replace />} />

        {/* Q record 메뉴 폐지 — Q docs 안의 표 kind 로 흡수 */}
        <Route path="/records" element={<Navigate to="/docs" replace />} />
        <Route path="/records/:id" element={<RecordToDocRedirect />} />

        <Route path="/projects" element={
          <ProtectedRoute>
            <MainLayout><QProjectPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/projects/p/:id" element={
          <ProtectedRoute>
            <MainLayout><QProjectDetailPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/projects/:view" element={
          <ProtectedRoute>
            <MainLayout><QProjectPage /></MainLayout>
          </ProtectedRoute>
        } />

        <Route path="/calendar" element={
          <ProtectedRoute>
            <MainLayout><QCalendarPage /></MainLayout>
          </ProtectedRoute>
        } />

        <Route path="/notes" element={
          <ProtectedRoute>
            <MainLayout><QNotePage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/notes/:sessionId" element={
          <ProtectedRoute>
            <MainLayout><QNotePage /></MainLayout>
          </ProtectedRoute>
        } />
        {/* 사이클 N+17 hotfix — 메모 분리 창 (Document PiP / window.open). MainLayout 우회 = popup 디자인 그대로 */}
        <Route path="/memo/:id" element={
          <ProtectedRoute>
            <MemoStandalonePage />
          </ProtectedRoute>
        } />

        <Route path="/files" element={
          <ProtectedRoute>
            <MainLayout><QFilePage /></MainLayout>
          </ProtectedRoute>
        } />

        {/* 개인 보관함 — 사이클 N+9 (VISIBILITY_VOCABULARY §5) */}
        <Route path="/personal-vault" element={
          <ProtectedRoute>
            <MainLayout><PersonalVaultPage /></MainLayout>
          </ProtectedRoute>
        } />

        <Route path="/docs" element={
          <ProtectedRoute>
            <MainLayout><QDocsPage /></MainLayout>
          </ProtectedRoute>
        } />

        {/* 자료정리 (Brief) 결과 뷰어 — 시점/자료별 토글 + 추천 후속 문서 CTA */}
        <Route path="/docs/brief/:id" element={
          <ProtectedRoute>
            <MainLayout><BriefViewerPage /></MainLayout>
          </ProtectedRoute>
        } />

        {/* 받은 서명 archive — 이전 /docs?tab=received-signatures 에서 분리 (2026-05-03) */}
        <Route path="/signatures/received" element={
          <ProtectedRoute>
            <MainLayout><ReceivedSignaturesPage /></MainLayout>
          </ProtectedRoute>
        } />

        <Route path="/profile" element={
          <ProtectedRoute>
            <MainLayout><ProfilePage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/profile/integrations" element={
          <ProtectedRoute>
            <MainLayout><ProfileIntegrationsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/me/work-settings" element={
          <ProtectedRoute>
            <MainLayout><MyWorkSettingsPage /></MainLayout>
          </ProtectedRoute>
        } />

        <Route path="/settings" element={
          <ProtectedRoute>
            <MainLayout><WorkspaceSettingsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/settings/:tab" element={
          <ProtectedRoute>
            <MainLayout><WorkspaceSettingsPage /></MainLayout>
          </ProtectedRoute>
        } />

        {/* 기존 /billing URL 은 /bills 로 흡수 (북마크 호환) */}
        <Route path="/billing" element={<Navigate to="/bills" replace />} />

        {/* Q Mail M2 — 인박스 read-only UI (사이클 N+75-D) */}
        <Route path="/mail" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <MainLayout><MailPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/bills" element={
          <ProtectedRoute>
            <MainLayout><QBillPage /></MainLayout>
          </ProtectedRoute>
        } />

        {/* 📊 통계·분석 — Q-G 사이클 InsightsPage. useParams<{tab}> 가 동작하려면 path 에 :tab 필요 */}
        <Route path="/stats/:tab" element={<ProtectedRoute><MainLayout><InsightsPage /></MainLayout></ProtectedRoute>} />

        <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/admin/dashboard" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><PlaceholderPage title="Platform Dashboard" /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/admin/businesses" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><AdminBusinessesPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/admin/feedback" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><AdminFeedbackPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/admin/email-logs" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><AdminEmailLogsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/admin/push-logs" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><AdminPushLogsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/admin/platform-settings" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><AdminPlatformSettingsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/admin/subscriptions" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><AdminSubscriptionsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/admin/payments" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><AdminPaymentsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/admin/billing-settings" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><AdminBillingSettingsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/admin/inquiries" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><AdminInquiriesPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/admin/notifications" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><AdminNotificationsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/admin/audit-logs" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><AdminAuditLogsPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/admin/users" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><AdminUsersPage /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/admin/*" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><PlaceholderPage title="Admin" /></MainLayout>
          </ProtectedRoute>
        } />

        {/* Invite (public — no auth required) */}
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/public/docs/:token" element={<PublicDocPage />} />
        <Route path="/public/posts/:token" element={<PublicPostPage />} />
        <Route path="/public/tasks/:token" element={<PublicTaskPage />} />
        <Route path="/public/files/:token" element={<PublicFilePage />} />
        <Route path="/public/kb/:token" element={<PublicKbDocumentPage />} />
        <Route path="/public/kb-bundle/:token" element={<PublicKbBundlePage />} />
        <Route path="/public/calendar/:token" element={<PublicCalendarEventPage />} />
        <Route path="/public/invoices/:token" element={<PublicInvoicePage />} />
        <Route path="/public/qnote-sessions/:token" element={<PublicQNoteSessionPage />} />
        <Route path="/sign/:token" element={<PublicSignPage />} />

        {/* Landing 라우트 — 비로그인 외부 트래픽 (PWA 사용자는 start_url=/inbox 라 안 봄) */}
        <Route path="/" element={<RootRoute />} />
        <Route path="/features" element={<LandingFeatures />} />
        <Route path="/pricing" element={<LandingPricing />} />
        <Route path="/blog" element={<LandingBlog />} />
        <Route path="/about" element={<LandingAbout />} />
        <Route path="/contact" element={<LandingContact />} />

        {/* Default fallback — 알 수 없는 경로는 랜딩 홈으로 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      {/*
        사이클 N+17 — 전역 overlay/banner 컴포넌트 lazy 일괄 wrap.
        모두 첫 paint 에 invisible 또는 조건부 표시 — fallback={null} 안전.
        idle 시점 또는 조건 발동 시 chunk 받음 → entry preload 부담 감소.
      */}
      <Suspense fallback={null}>
        <CueHelpDrawer />
        <MemoFab />
        <NotificationToaster />
        <PwaInstallBanner />
        <OpenInAppBanner />
        <BuildVersionGuard />
        <LimitReachedDialog />
        <AnnouncementBanner />
        <TermsReacceptModal />
        <ImpersonateBanner />
      </Suspense>
    </PwaInstallProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
