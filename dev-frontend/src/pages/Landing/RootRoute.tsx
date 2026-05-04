// 루트 라우트 (`/`) 분기:
//   - 로그인된 사용자 → /inbox 리다이렉트 (정석 SaaS 패턴)
//   - 비로그인 → 랜딩 홈 페이지
//   - 인증 상태 로딩 중 → 빈 화면 (깜빡임 방지)
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import HomePage from './HomePage';

const RootRoute: React.FC = () => {
  const { user, isLoading } = useAuth();
  if (isLoading) return null; // 첫 토큰 검증 중 — 짧은 깜빡임 방지
  if (user) return <Navigate to="/inbox" replace />;
  return <HomePage />;
};

export default RootRoute;
