// /verify-email/:token — 회원가입 직후 메일에서 인증 링크 클릭
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

const VerifyEmailPage: React.FC = () => {
  const { t } = useTranslation('auth');
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<'pending' | 'success' | 'error'>('pending');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setState('error'); setErr('no token'); return; }
    fetch('/api/auth/verify-email-confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(j => {
        if (j.success) setState('success');
        else { setState('error'); setErr(j.message || 'failed'); }
      })
      .catch(e => { setState('error'); setErr(e instanceof Error ? e.message : 'error'); });
  }, [token]);

  return (
    <Page>
      <Card>
        <Title>{t('verify.title', '이메일 인증')}</Title>
        {state === 'pending' && <PendingBox>{t('verify.pending', '인증 처리 중...')}</PendingBox>}
        {state === 'success' && (
          <SuccessBox>
            {t('verify.success', '이메일 인증이 완료됐습니다. 모든 기능을 사용할 수 있습니다.')}
            <SuccessSub><Link to="/login">{t('verify.toLogin', '로그인하기')}</Link></SuccessSub>
          </SuccessBox>
        )}
        {state === 'error' && (
          <ErrorBox>
            {t('verify.error', '인증 링크가 만료됐거나 잘못됐습니다.')}<br/>
            <small>{err}</small>
            <ErrorSub><Link to="/login">{t('verify.backToLogin', '로그인 후 인증 메일 재발송')}</Link></ErrorSub>
          </ErrorBox>
        )}
      </Card>
    </Page>
  );
};

export default VerifyEmailPage;

const Page = styled.div`min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #F8FAFC; padding: 24px;`;
const Card = styled.div`width: 100%; max-width: 460px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px; padding: 32px; text-align: center;`;
const Title = styled.h1`font-size: 22px; font-weight: 700; color: #0F172A; margin: 0 0 20px;`;
const PendingBox = styled.div`padding: 20px; color: #64748B; font-size: 14px;`;
const SuccessBox = styled.div`padding: 18px; background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 10px; font-size: 14px; color: #0F766E; line-height: 1.7;`;
const SuccessSub = styled.div`margin-top: 14px; padding-top: 14px; border-top: 1px solid #99F6E4; a { color: #0D9488; font-weight: 700; text-decoration: none; } a:hover { text-decoration: underline; }`;
const ErrorBox = styled.div`padding: 18px; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 10px; font-size: 14px; color: #B91C1C; line-height: 1.7;`;
const ErrorSub = styled.div`margin-top: 14px; padding-top: 14px; border-top: 1px solid #FECACA; a { color: #B91C1C; font-weight: 700; text-decoration: none; } a:hover { text-decoration: underline; }`;
