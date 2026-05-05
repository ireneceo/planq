// 사칭(impersonate) 진행 중 배너 — JWT 의 impersonator 클레임이 있을 때 노출
// "이 사용자로 보고 있는 중. 원래 계정으로 돌아가기" + 만료 시각 표시
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { getAccessToken, _impersonateSetAccessToken as setAccessToken } from '../../contexts/AuthContext';

interface DecodedJwt {
  userId?: number;
  id?: number;
  email?: string;
  impersonator?: number;
  exp?: number;
}

function decodeJwt(token: string): DecodedJwt | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch { return null; }
}

const ImpersonateBanner: React.FC = () => {
  const { t } = useTranslation('common');
  const [info, setInfo] = useState<{ targetEmail: string; expiresAt: number } | null>(null);

  useEffect(() => {
    const check = () => {
      const token = getAccessToken();
      if (!token) { setInfo(null); return; }
      const dec = decodeJwt(token);
      if (dec?.impersonator) {
        setInfo({
          targetEmail: dec.email || `#${dec.userId || dec.id}`,
          expiresAt: (dec.exp || 0) * 1000,
        });
      } else {
        setInfo(null);
      }
    };
    check();
    const interval = window.setInterval(check, 30000); // 30초마다 (만료 임박 표시)
    return () => window.clearInterval(interval);
  }, []);

  const exitImpersonation = () => {
    // sessionStorage 에 저장된 original_token 으로 복귀
    const pending = window.sessionStorage.getItem('impersonate_pending');
    if (pending) {
      try {
        const { original_token } = JSON.parse(pending);
        if (original_token) {
          setAccessToken(original_token);
          window.sessionStorage.removeItem('impersonate_pending');
          window.location.href = '/admin/users';
          return;
        }
      } catch { /* fallthrough */ }
    }
    // fallback — 로그아웃
    window.location.href = '/login';
  };

  if (!info) return null;

  const remaining = Math.max(0, Math.floor((info.expiresAt - Date.now()) / 60000));

  return (
    <Banner>
      <Icon>👤</Icon>
      <Text>
        {t('impersonate.viewingAs', '"{{email}}" 사용자로 보고 있습니다', { email: info.targetEmail }) as string}
        {remaining > 0 && (
          <Remaining>
            {t('impersonate.expiresIn', '{{m}}분 후 자동 만료', { m: remaining }) as string}
          </Remaining>
        )}
      </Text>
      <ExitBtn type="button" onClick={exitImpersonation}>
        {t('impersonate.exit', '원래 계정으로 돌아가기')}
      </ExitBtn>
    </Banner>
  );
};

export default ImpersonateBanner;

const Banner = styled.div`
  position: fixed; top: 0; left: 0; right: 0;
  z-index: 250;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 20px;
  background: #FFF1F2;
  border-bottom: 2px solid #F43F5E;
  font-size: 13px; color: #9F1239;
`;
const Icon = styled.span`font-size: 16px; flex-shrink: 0;`;
const Text = styled.span`flex: 1; font-weight: 600;`;
const Remaining = styled.span`margin-left: 8px; font-weight: 400; opacity: 0.8;`;
const ExitBtn = styled.button`
  padding: 6px 14px; background: #FFFFFF; color: #9F1239;
  border: 1px solid #FECDD3; border-radius: 6px;
  font-size: 12px; font-weight: 700; cursor: pointer;
  &:hover { background: #FECDD3; border-color: #F43F5E; }
`;
