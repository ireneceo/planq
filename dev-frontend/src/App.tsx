import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/Common/ErrorBoundary';
import MainLayout from './components/Layout/MainLayout';
import CueHelpDrawer from './components/Common/CueHelpDrawer';
import LoginPage from './pages/Login/LoginPage';
import RegisterPage from './pages/Register/RegisterPage';
import QNotePage from './pages/QNote/QNotePage';
import ProfilePage from './pages/Profile/ProfilePage';
import WorkspaceSettingsPage from './pages/Settings/WorkspaceSettingsPage';
import QTalkPage from './pages/QTalk/QTalkPage';
import QTaskPage from './pages/QTask/QTaskPage';
import QProjectPage from './pages/QProject/QProjectPage';
import QProjectDetailPage from './pages/QProject/QProjectDetailPage';
import ClientsPage from './pages/Clients/ClientsPage';
import InvitePage from './pages/Invite/InvitePage';
import QCalendarPage from './pages/QCalendar/QCalendarPage';
import QDocsPage from './pages/QDocs/QDocsPage';
import PublicDocPage from './pages/QDocs/PublicDocPage';
import PublicPostPage from './pages/QDocs/PublicPostPage';
import PublicSignPage from './pages/QDocs/PublicSignPage';
import PublicInvoicePage from './pages/QBill/PublicInvoicePage';
import QFilePage from './pages/QFile/QFilePage';
import AdminBusinessesPage from './pages/Admin/AdminBusinessesPage';
import PrivacyPolicy from './pages/Legal/PrivacyPolicy';
import TermsOfService from './pages/Legal/TermsOfService';
import ComingSoonPage from './pages/ComingSoon/ComingSoonPage';
import DashboardPage from './pages/Dashboard/DashboardPage';
import TodoPage from './pages/Todo/TodoPage';
import QBillPage from './pages/QBill/QBillPage';
import KnowledgePage from './pages/Knowledge/KnowledgePage';
import './App.css';

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

        <Route path="/knowledge" element={
          <ProtectedRoute>
            <MainLayout><KnowledgePage /></MainLayout>
          </ProtectedRoute>
        } />

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

        {/* 📊 통계·분석 */}
        <Route path="/stats/overview" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <MainLayout><ComingSoonPage titleKey="nav.statsOverview" titleFallback="개요" descKey="comingSoon.statsDesc" /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/stats/tasks" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <MainLayout><ComingSoonPage titleKey="nav.statsTaskTime" titleFallback="업무·시간" descKey="comingSoon.statsDesc" /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/stats/profit" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <MainLayout><ComingSoonPage titleKey="nav.statsProfit" titleFallback="프로젝트 수익성" descKey="comingSoon.statsDesc" /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/stats/team" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <MainLayout><ComingSoonPage titleKey="nav.statsTeam" titleFallback="팀 생산성" descKey="comingSoon.statsDesc" /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/stats/finance" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <MainLayout><ComingSoonPage titleKey="nav.statsFinance" titleFallback="비용·재무" descKey="comingSoon.statsDesc" /></MainLayout>
          </ProtectedRoute>
        } />
        <Route path="/stats/reports" element={
          <ProtectedRoute requiredRole={['business_owner', 'business_member']}>
            <MainLayout><ComingSoonPage titleKey="nav.statsReports" titleFallback="보고서" descKey="comingSoon.statsDesc" /></MainLayout>
          </ProtectedRoute>
        } />

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
      {/* 글로벌 Cue 도움말 — ⌘? / Ctrl+/ + cue:ask 이벤트 receiver */}
      <CueHelpDrawer />
    </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
