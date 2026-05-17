// 비밀번호 잊었을 때 — 이메일 입력 → 토큰 + 메일 발송
// 보안: 이메일 존재 여부 누설 X (서버가 항상 200)
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { mapApiError } from '../../utils/apiError';

const ForgotPasswordPage: React.FC = () => {
  const { t } = useTranslation('auth');
  const { t: tErr } = useTranslation('errors');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true); setErr(null);
    try {
      const r = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      setDone(true);
    } catch (e) {
      setErr(mapApiError(e, tErr));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page>
      <Card>
        <Title>{t('forgot.title', '비밀번호 재설정')}</Title>
        {done ? (
          <SuccessBox>
            {t('forgot.sent', '이메일을 발송했습니다. 받은편지함을 확인해주세요. (메일이 안 오면 입력한 이메일이 가입돼있지 않을 수 있습니다.)')}
            <SuccessSub>
              <Link to="/login">{t('forgot.backToLogin', '로그인으로 돌아가기')}</Link>
            </SuccessSub>
          </SuccessBox>
        ) : (
          <Form onSubmit={submit}>
            <Hint>{t('forgot.hint', '가입하신 이메일을 입력하시면 비밀번호 재설정 링크를 보내드립니다.')}</Hint>
            <Field>
              <Label>{t('forgot.email', '이메일')}</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="name@company.com" required autoFocus />
            </Field>
            {err && <ErrorBox>{err}</ErrorBox>}
            <Submit type="submit" disabled={submitting || !email.trim()}>
              {submitting ? t('forgot.sending', '발송 중...') : t('forgot.send', '재설정 링크 받기')}
            </Submit>
            <BackLink to="/login">{t('forgot.backToLogin', '로그인으로 돌아가기')}</BackLink>
          </Form>
        )}
      </Card>
    </Page>
  );
};

export default ForgotPasswordPage;

const Page = styled.div`
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: #F8FAFC; padding: 24px;
`;
const Card = styled.div`
  width: 100%; max-width: 420px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px;
  padding: 32px; box-shadow: 0 1px 2px rgba(0,0,0,0.04);
`;
const Title = styled.h1`font-size: 22px; font-weight: 700; color: #0F172A; margin: 0 0 20px;`;
const Form = styled.form`display: flex; flex-direction: column; gap: 14px;`;
const Hint = styled.p`font-size: 13px; color: #475569; line-height: 1.6; margin: 0;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Label = styled.label`font-size: 12px; font-weight: 700; color: #475569;`;
const Input = styled.input`
  padding: 10px 12px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 14px; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const Submit = styled.button`
  padding: 10px 16px; background: #14B8A6; color: #FFFFFF; border: none;
  border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const BackLink = styled(Link)`
  text-align: center; font-size: 13px; color: #0D9488; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
const ErrorBox = styled.div`
  padding: 10px 12px; background: #FEF2F2; border: 1px solid #FECACA;
  border-radius: 8px; font-size: 13px; color: #B91C1C;
`;
const SuccessBox = styled.div`
  padding: 16px; background: #F0FDFA; border: 1px solid #99F6E4;
  border-radius: 10px; font-size: 14px; color: #0F766E; line-height: 1.6;
`;
const SuccessSub = styled.div`
  margin-top: 12px; padding-top: 12px; border-top: 1px solid #99F6E4;
  font-size: 13px;
  a { color: #0D9488; text-decoration: none; font-weight: 600; }
  a:hover { text-decoration: underline; }
`;
