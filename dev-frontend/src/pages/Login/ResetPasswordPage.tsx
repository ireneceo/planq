// /reset-password/:token — forgot 메일에서 클릭한 사용자가 새 비번 설정
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

const ResetPasswordPage: React.FC = () => {
  const { t } = useTranslation('auth');
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || submitting) return;
    if (pwd.length < 8) { setErr(t('reset.errLen', '비밀번호는 8자 이상') as string); return; }
    if (pwd !== pwd2) { setErr(t('reset.errMatch', '비밀번호가 일치하지 않습니다') as string); return; }
    setSubmitting(true); setErr(null);
    try {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: pwd }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      setDone(true);
      window.setTimeout(() => navigate('/login'), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page>
      <Card>
        <Title>{t('reset.title', '새 비밀번호 설정')}</Title>
        {done ? (
          <SuccessBox>
            {t('reset.success', '비밀번호가 변경됐습니다. 곧 로그인 페이지로 이동합니다.')}
          </SuccessBox>
        ) : (
          <Form onSubmit={submit}>
            <Field>
              <Label>{t('reset.newPwd', '새 비밀번호')}</Label>
              <Input type="password" value={pwd} onChange={e => setPwd(e.target.value)}
                placeholder="8자 이상" required autoFocus minLength={8} />
            </Field>
            <Field>
              <Label>{t('reset.confirm', '비밀번호 확인')}</Label>
              <Input type="password" value={pwd2} onChange={e => setPwd2(e.target.value)}
                placeholder="다시 입력" required minLength={8} />
            </Field>
            {err && <ErrorBox>{err}</ErrorBox>}
            <Submit type="submit" disabled={submitting || !pwd || !pwd2}>
              {submitting ? t('reset.saving', '저장 중...') : t('reset.save', '비밀번호 변경')}
            </Submit>
            <BackLink to="/login">{t('reset.backToLogin', '로그인으로 돌아가기')}</BackLink>
          </Form>
        )}
      </Card>
    </Page>
  );
};

export default ResetPasswordPage;

const Page = styled.div`min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #F8FAFC; padding: 24px;`;
const Card = styled.div`width: 100%; max-width: 420px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px; padding: 32px; box-shadow: 0 1px 2px rgba(0,0,0,0.04);`;
const Title = styled.h1`font-size: 22px; font-weight: 700; color: #0F172A; margin: 0 0 20px;`;
const Form = styled.form`display: flex; flex-direction: column; gap: 14px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Label = styled.label`font-size: 12px; font-weight: 700; color: #475569;`;
const Input = styled.input`padding: 10px 12px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 14px; color: #0F172A; &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }`;
const Submit = styled.button`padding: 10px 16px; background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; &:hover:not(:disabled) { background: #0D9488; } &:disabled { background: #CBD5E1; cursor: not-allowed; }`;
const BackLink = styled(Link)`text-align: center; font-size: 13px; color: #0D9488; text-decoration: none; &:hover { text-decoration: underline; }`;
const ErrorBox = styled.div`padding: 10px 12px; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; font-size: 13px; color: #B91C1C;`;
const SuccessBox = styled.div`padding: 16px; background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 10px; font-size: 14px; color: #0F766E; line-height: 1.6;`;
