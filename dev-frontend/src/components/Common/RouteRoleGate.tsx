// RouteRoleGate — 라우트 표(`routes/appRoutes.tsx`)의 `roles` 선언을 **실제로 집행한다.**
//
// ★ 2026-09-13 실측 사고: `APP_ROUTES` 는 `/admin/*` 16개에 `roles: ['platform_admin']` 을
//   선언해 두었는데 **읽는 곳이 저장소에 0곳**이었다. 탭 모드(데스크탑 기본)에서는
//   `TabPane` 이 `<Route path element>` 만 렌더해 역할을 보지 않았다 —
//   `platform_role='user'` 계정으로 `/admin/users` 를 열면 **관리자 셸이 통째로**
//   (좌측 관리자 링크 17개) 그려지고 "권한 없음" 안내는 한 줄도 없었다.
//   데이터는 서버가 403 으로 막아 새지 않았지만, 화면은 **관리자 기능 목록을 보여주고**
//   사용자에게는 "고장난 화면" 과 구별되지 않았다.
//   → memory `feedback_unwired_guard_is_no_guard` 와 같은 계열: **선언만 있고 배선이 없으면 가드가 아니다.**
//
// ★ 술어는 `ProtectedRoute` 와 **같은 것**(useAuth().hasRole)이다. 두 벌로 만들면 갈라진다
//   (memory `feedback_predicate_must_match_both_sides`). 문구도 같은 `common:forbidden.*` 를 쓴다.
import type { ReactElement } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';

export default function RouteRoleGate({ roles, children }: { roles?: string[]; children: ReactElement }) {
  const { t } = useTranslation('common');
  const { isLoading, hasRole } = useAuth();
  // 역할 제한이 없는 라우트는 그대로 통과 — 표에 선언된 것만 집행한다
  if (!roles || roles.length === 0) return children;
  // 부팅 중에는 판단하지 않는다. 여기서 막으면 새로고침마다 권한 화면이 번쩍인다
  if (isLoading) return null;
  if (hasRole(...roles)) return children;
  return (
    <Denied role="status" data-testid="route-role-denied">
      <Box>
        <Title>{t('forbidden.title')}</Title>
        <Message>{t('forbidden.desc')}</Message>
      </Box>
    </Denied>
  );
}

const Denied = styled.div`
  min-height: 60vh; display: flex; align-items: center; justify-content: center;
  background: #F8FAFC; padding: 24px;
`;
const Box = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 32px 28px; text-align: center; max-width: 400px;
`;
const Title = styled.h2`margin: 0 0 10px; font-size: 1.125rem; font-weight: 700; color: #0F172A;`;
const Message = styled.p`margin: 0; font-size: 0.875rem; color: #475569; line-height: 1.5;`;
