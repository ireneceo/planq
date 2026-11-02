// AccountSwitcher — 계정 메뉴 안의 «이 기기 계정» 칸 (인스타식: 다른 계정으로 바꾸기 · 계정 추가 · 모두 로그아웃).
//   설계 docs/MULTI_ACCOUNT_DESIGN.md 2.4·7절. 목록 정본은 서버(GET /api/auth/device-accounts) — 열 때 한 번 읽는다.
//   MainLayout(god-file)의 사용자 메뉴에 한 줄로 얹는다. 모양은 그 메뉴의 항목과 같은 값(어두운 민트 바탕 위).
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LetterAvatar from '../Common/LetterAvatar';
import { getAccessToken, useAuth } from '../../contexts/AuthContext';
import {
  fetchDeviceAccounts, switchAccount, beginAddAccount, type DeviceAccount,
} from '../../services/accounts';

interface Props {
  /** 메뉴를 닫는다(전환·추가로 떠나기 전에) */
  onClose: () => void;
}

const AccountSwitcher: React.FC<Props> = ({ onClose }) => {
  const { t } = useTranslation('common');
  const { user, logout } = useAuth();
  const [others, setOthers] = useState<DeviceAccount[]>([]);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState<number | 'add' | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchDeviceAccounts({ fresh: true }).then((d) => {
      if (!alive || !d) return;
      setOthers(d.accounts.filter((a) => a.user_id !== Number(user?.id)));
      setCount(d.accounts.length || 1);
    });
    return () => { alive = false; };
  }, [user?.id]);

  const relogin = async (a: DeviceAccount) => {
    const fail = await beginAddAccount(getAccessToken());
    if (fail) { setNote(fail === 'limit' ? t('accounts.limit', '이 기기에는 계정을 5개까지 둘 수 있어요') : t('accounts.failed', '잠시 후 다시 해 주세요')); return; }
    onClose();
    goAddLogin(a.email);
  };

  const pick = async (a: DeviceAccount) => {
    if (busy) return;
    if (!a.valid) { await relogin(a); return; }
    setBusy(a.user_id); setNote(null);
    const fail = await switchAccount(a.user_id);
    // 성공하면 페이지가 떠난다 — 여기 닿으면 실패
    setBusy(null);
    if (fail === 'relogin') { await relogin(a); return; }
    if (fail) setNote(t('accounts.failed', '잠시 후 다시 해 주세요'));
  };

  const add = async () => {
    if (busy) return;
    setBusy('add'); setNote(null);
    const fail = await beginAddAccount(getAccessToken());
    setBusy(null);
    if (fail === 'limit') { setNote(t('accounts.limit', '이 기기에는 계정을 5개까지 둘 수 있어요')); return; }
    if (fail) { setNote(t('accounts.failed', '잠시 후 다시 해 주세요')); return; }
    onClose();
    goAddLogin();
  };

  return (
    <Wrap data-testid="account-switcher">
      {others.map((a) => (
        <Row
          key={a.user_id}
          type="button"
          role="menuitem"
          data-testid={`account-switch-${a.user_id}`}
          onClick={() => void pick(a)}
          disabled={busy != null}
          title={a.email}
        >
          <LetterAvatar name={a.name || a.email} src={a.avatar_url} size={32} />
          <Who>
            <Name>{a.name || a.email}</Name>
            <Sub>{a.valid ? (a.workspace_name || a.email) : t('accounts.reloginNeeded', '다시 로그인 필요')}</Sub>
          </Who>
          {a.valid && a.unread_total > 0 && (
            <Count aria-label={t('accounts.unread', { count: a.unread_total, defaultValue: '안 읽은 알림 {{count}}개' }) as string}>
              {a.unread_total > 99 ? '99+' : a.unread_total}
            </Count>
          )}
          {busy === a.user_id && <Sub>…</Sub>}
        </Row>
      ))}
      <Item type="button" role="menuitem" data-testid="account-add" onClick={() => void add()} disabled={busy != null}>
        <Plus aria-hidden="true">+</Plus>
        {t('accounts.add', '계정 추가')}
      </Item>
      {note && <Note role="status">{note}</Note>}
      {count > 1 && (
        <Item
          type="button" role="menuitem" $danger data-testid="account-logout-all"
          onClick={() => { onClose(); void logout({ all: true }); }}
        >
          {t('accounts.logoutAll', '모든 계정 로그아웃')}
        </Item>
      )}
      <Divider />
    </Wrap>
  );
};

export default AccountSwitcher;

// 로그인 화면은 앱 셸 밖이다 — 탭 모드는 라우터 없는 자리라 useNavigate 를 쓸 수 없다(실측: 메뉴가 통째로 죽었다).
//   문서 이동으로 간다(돌아올 때도 다시 부팅이라 앞 계정 화면 상태가 남지 않는다).
function goAddLogin(email?: string): void {
  window.location.href = `/login?add=1${email ? `&email=${encodeURIComponent(email)}` : ''}`;
}

// 값은 MainLayout UserMenuItemBase 와 같다(같은 메뉴 안이라 한 줄만 다르면 튄다).
const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 2px;
`;
const Row = styled.button`
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px; border-radius: 6px; min-height: 40px;
  background: transparent; border: none; cursor: pointer; width: 100%; text-align: left;
  color: #CCFBF1;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
  &:disabled { cursor: default; opacity: 0.7; }
  &:focus-visible { outline: 2px solid rgba(94, 234, 212, 0.5); outline-offset: -2px; }
`;
const Who = styled.span`
  display: flex; flex-direction: column; min-width: 0; flex: 1;
`;
const Name = styled.span`
  font-size: 0.8125rem; font-weight: 600; color: #FFFFFF;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const Sub = styled.span`
  font-size: 0.6875rem; color: #5EEAD4;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const Count = styled.span`
  flex-shrink: 0; min-width: 18px; line-height: 1.2; padding: 2px 5px; border-radius: 9px;
  background: #F43F5E; color: #FFFFFF; font-size: 0.6875rem; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
`;
const Item = styled.button<{ $danger?: boolean }>`
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 6px;
  font-size: 0.8125rem; font-weight: 500;
  background: transparent; border: none; cursor: pointer; width: 100%; text-align: left;
  color: ${({ $danger }) => ($danger ? '#FCA5A5' : '#CCFBF1')};
  transition: background 0.15s, color 0.15s;
  &:hover:not(:disabled) {
    background: ${({ $danger }) => ($danger ? 'rgba(220, 38, 38, 0.18)' : 'rgba(255, 255, 255, 0.08)')};
    color: ${({ $danger }) => ($danger ? '#FECACA' : '#FFFFFF')};
  }
  &:focus-visible { outline: 2px solid rgba(94, 234, 212, 0.5); outline-offset: -2px; }
`;
const Plus = styled.span`
  width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px dashed rgba(204, 251, 241, 0.5); font-size: 1rem; line-height: 1;
`;
// MainLayout UserMenuDivider 와 같은 값 — 이 칸 아래 줄은 이 칸이 긋는다(god-file 에 줄을 늘리지 않게)
const Divider = styled.div`
  height: 1px; background: rgba(255, 255, 255, 0.1); margin: 4px 0;
`;
const Note = styled.div`
  padding: 4px 10px; font-size: 0.6875rem; color: #FDE68A;
`;
