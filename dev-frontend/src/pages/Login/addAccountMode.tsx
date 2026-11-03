// 로그인 화면의 «계정 추가» 모드(?add=1) — 한 기기 여러 계정(docs/MULTI_ACCOUNT_DESIGN.md 7절 2).
//   ① 들어오면 서버에 «계정 추가» 의도를 다시 남긴다(10분 서명 쿠키 rt_add — 로그인된 사람의 접속 토큰이 있어야 한다).
//      이것이 있어야 이어지는 로그인(비밀번호·구글·애플)이 지금 계정을 지우지 않는다. 없으면 보통 로그인 = 기기 정리.
//   ② 다른 계정으로 들어오면(창의 사람이 바뀜) 다른 창에 알리고 이 창을 새 계정으로 다시 부팅한다.
//   ③ 로그인 안 된 채 ?add=1 로 오면 보통 로그인 화면이다(추가할 «지금 계정» 이 없다).
//   ④ 회원가입 화면(/register?add=1)도 같은 훅을 쓴다 — 로그인된 채 머물고, 새로 만든 계정으로 들어오면 ② 를 한다.
//      가입은 전환 측정 뒤 다시 부팅해야 해서 onSwitched 로 ② 의 다시 부팅을 맡을 수 있다(알림은 훅이 먼저 보낸다).
import React, { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { getAccessToken } from '../../contexts/AuthContext';
import { beginAddAccount, broadcastAccountSwitch, rebootForAccount } from '../../services/accounts';

interface MinimalUser { id: number | string; name?: string | null }

export function useAddAccountMode(
  user: MinimalUser | null, isAuthenticated: boolean, authLoading: boolean,
  onSwitched?: (newUserId: number) => void,
) {
  const location = useLocation();
  const q = new URLSearchParams(location.search);
  const wanted = q.get('add') === '1';
  const fromRef = useRef<{ id: number; name: string } | null>(null);
  if (wanted && !fromRef.current && isAuthenticated && user?.id) {
    fromRef.current = { id: Number(user.id), name: String(user.name || '') };
  }
  const active = wanted && !!fromRef.current;

  // ① 의도를 남긴다(멱등 — 메뉴에서 이미 남겼어도 한 번 더)
  const sentRef = useRef(false);
  useEffect(() => {
    if (!active || sentRef.current) return;
    sentRef.current = true;
    void beginAddAccount(getAccessToken());
  }, [active]);

  const onSwitchedRef = useRef(onSwitched);
  onSwitchedRef.current = onSwitched;
  // ② 새 계정으로 들어왔다 → 다른 창에 알리고 다시 부팅(이 창의 화면 상태는 앞 계정 것이다)
  useEffect(() => {
    if (!active || authLoading || !user?.id) return;
    const now = Number(user.id);
    if (now === fromRef.current?.id) return;
    broadcastAccountSwitch(now);
    if (onSwitchedRef.current) onSwitchedRef.current(now);
    else rebootForAccount();
  }, [active, authLoading, user?.id]);

  return {
    active,
    fromName: fromRef.current?.name || '',
    prefillEmail: (wanted && q.get('email')) || '',
  };
}

/** «취소 — 돌아가기» 한 줄(지금 계정 그대로) */
export const AddAccountCancel: React.FC = () => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  return (
    <CancelRow>
      <CancelBtn type="button" data-testid="login-add-cancel" onClick={() => navigate('/dashboard', { replace: true })}>
        {t('login.addCancel', '취소하고 돌아가기')}
      </CancelBtn>
    </CancelRow>
  );
};

const CancelRow = styled.div`
  display: flex; justify-content: flex-start; margin: -8px 0 16px;
`;
const CancelBtn = styled.button`
  background: none; border: none; padding: 4px 0; cursor: pointer;
  font-size: 0.8125rem; font-weight: 600; color: #0F766E;
  &:hover { text-decoration: underline; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; border-radius: 4px; }
`;
