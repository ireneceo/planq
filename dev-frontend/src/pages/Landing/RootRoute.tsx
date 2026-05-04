// 루트 라우트 (`/`) — POS 패턴.
// 로그인 여부와 무관하게 항상 랜딩 홈 표시. planq.kr 은 브랜딩/마케팅 페이지.
// 로그인된 사용자는 GNB 의 "내 워크스페이스" 버튼으로 /inbox 진입 (LandingLayout 이 처리).
import HomePage from './HomePage';

const RootRoute: React.FC = () => <HomePage />;

export default RootRoute;
