// 가입 출처 보고 — 로그인된 순간 한 번(services/firstTouch). 화면에 아무것도 그리지 않는다.
//   App 루트 한 곳에 둔다 — 탭 모드·미러 모드 두 렌더 트리 어디로 들어와도 돈다.
import { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { reportFirstTouch } from '../../services/firstTouch';

export default function SignupSourceReporter() {
  const { user } = useAuth();
  useEffect(() => {
    if (user?.id) void reportFirstTouch();
  }, [user?.id]);
  return null;
}
