import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { PwaInstallProvider } from './contexts/PwaInstallContext';
import NotificationToaster from './components/Common/NotificationToaster';
import PwaInstallBanner from './components/Common/PwaInstallBanner';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/Common/ErrorBoundary';
import MainLayout from './components/Layout/MainLayout';
import CueHelpDrawer from './components/Common/CueHelpDrawer';

// Eager — 자주 진입하거나 첫 화면 (Login). 분리해도 의미 작음
import LoginPage from './pages/Login/LoginPage';

// Route-based code splitting — 페이지별 별도 chunk 로 첫 로드 번들 축소.
// 이전: 모든 페이지 eager import → main bundle 2.75MB. 새로고침 시 모두 파싱·실행.
// 변경: 페이지 진입 시점에 해당 chunk 만 로드. 첫 로드 ~800KB, 후속 진입 ~30KB 페이지별.
const RegisterPage = lazy(() => import('./pages/Register/RegisterPage'));
const QNotePage = lazy(() => import('./pages/QNote/QNotePage'));
const ProfilePage = lazy(() => import('./pages/Profile/ProfilePage'));
const WorkspaceSettingsPage = lazy(() => import('./pages/Settings/WorkspaceSettingsPage'));
const QTalkPage = lazy(() => import('./pages/QTalk/QTalkPage'));
const QTaskPage = lazy(() => import('./pages/QTask/QTaskPage'));
const QProjectPage = lazy(() => import('./pages/QProject/QProjectPage'));
const QProjectDetailPage = lazy(() => import('./pages/QProject/QProjectDetailPage'));
const ClientsPage = lazy(() => import('./pages/Clients/ClientsPage'));
const InvitePage = lazy(() => import('./pages/Invite/InvitePage'));
const QCalendarPage = lazy(() => import('./pages/QCalendar/QCalendarPage'));
const QDocsPage = lazy(() => import('./pages/QDocs/QDocsPage'));
const BriefViewerPage = lazy(() => import('./pages/QDocs/BriefViewerPage'));
const ReceivedSignaturesPage = lazy(() => import('./pages/Signatures/ReceivedSignaturesPage'));
const PublicDocPage = lazy(() => import('./pages/QDocs/PublicDocPage'));
const PublicPostPage = lazy(() => import('./pages/QDocs/PublicPostPage'));
const PublicSignPage = lazy(() => import('./pages/QDocs/PublicSignPage'));
const PublicInvoicePage = lazy(() => import('./pages/QBill/PublicInvoicePage'));
const QFilePage = lazy(() => import('./pages/QFile/QFilePage'));
const AdminBusinessesPage = lazy(() => import('./pages/Admin/AdminBusinessesPage'));
const AdminFeedbackPage = lazy(() => import('./pages/Admin/AdminFeedbackPage'));
const AdminEmailLogsPage = lazy(() => import('./pages/Admin/AdminEmailLogsPage'));
const AdminPlatformSettingsPage = lazy(() => import('./pages/Admin/AdminPlatformSettingsPage'));
const AdminSubscriptionsPage = lazy(() => import('./pages/Admin/AdminSubscriptionsPage'));
const AdminPaymentsPage = lazy(() => import('./pages/Admin/AdminPaymentsPage'));
const AdminBillingSettingsPage = lazy(() => import('./pages/Admin/AdminBillingSettingsPage'));
const ShareReceivePage = lazy(() => import('./pages/ShareReceive/ShareReceivePage'));
const InsightsPage = lazy(() => import('./pages/Insights/InsightsPage'));
const PrivacyPolicy = lazy(() => import('./pages/Legal/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/Legal/TermsOfService'));
const ComingSoonPage = lazy(() => import('./pages/ComingSoon/ComingSoonPage'));
const DashboardPage = lazy(() => import('./pages/Dashboard/DashboardPage'));
const TodoPage = lazy(() => import('./pages/Todo/TodoPage'));
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
  return (
    <ErrorBoundary>
    <AuthProvider>
    <PwaInstallProvider>
      <Suspense fallback={<PageLoadingFallback />}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
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

        <Route path="/files" element={
          <ProtectedRoute>
            <MainLayout><QFilePage /></MainLayout>
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

        {/* Q Bill (견적·청구·결제·세금계산서 통합) */}
        <Route path="/mail" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <MainLayout><ComingSoonPage titleKey="nav.qmail" titleFallback="Q Mail" /></MainLayout>
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
        <Route path="/admin/*" element={
          <ProtectedRoute requiredRole={['platform_admin']}>
            <MainLayout><PlaceholderPage title="Admin" /></MainLayout>
          </ProtectedRoute>
        } />

        {/* Invite (public — no auth required) */}
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/public/docs/:token" element={<PublicDocPage />} />
        <Route path="/public/posts/:token" element={<PublicPostPage />} />
        <Route path="/public/invoices/:token" element={<PublicInvoicePage />} />
        <Route path="/sign/:token" element={<PublicSignPage />} />

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      </Suspense>
      {/* 글로벌 Cue 도움말 — ⌘? / Ctrl+/ + cue:ask 이벤트 receiver */}
      <CueHelpDrawer />
      {/* 우측 상단 인앱 알림 toaster — Phase 2: focus-steal 없이 실시간 알림 */}
      <NotificationToaster />
      {/* 모바일 PWA 설치 안내 — beforeinstallprompt + iOS Safari 안내 */}
      <PwaInstallBanner />
    </PwaInstallProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
