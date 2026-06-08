// 통합 공유 — 비밀번호 보호 페이지에서 비번 입력받는 프롬프트 (사이클 N+4 4차)
//
// public preview 페이지가 401 + requires_password 응답 받으면 표시.
// 입력 → onSubmit(pw) 호출. 부모가 fetch 재시도.
import { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

interface Props {
  onSubmit: (password: string) => void;
  busy?: boolean;
  error?: string | null;
}

const SharePasswordPrompt: React.FC<Props> = ({ onSubmit, busy, error }) => {
  const { t } = useTranslation('common');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !pw) return;
    onSubmit(pw);
  };

  return (
    <Wrap>
      <Card>
        <Icon>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </Icon>
        <Title>{t('public.password.title', { defaultValue: '비밀번호로 보호된 링크' }) as string}</Title>
        <Sub>{t('public.password.sub', { defaultValue: '링크 작성자에게 받은 비밀번호를 입력하세요.' }) as string}</Sub>
        <Form onSubmit={submit}>
          <InputRow>
            <Input
              type={show ? 'text' : 'password'}
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder={t('public.password.placeholder', { defaultValue: '비밀번호' }) as string}
              autoFocus
              disabled={busy}
            />
            <Toggle type="button" onClick={() => setShow(s => !s)} disabled={busy}>
              {show
                ? t('share.passwordHide', { defaultValue: '숨기기' }) as string
                : t('share.passwordShow', { defaultValue: '보이기' }) as string}
            </Toggle>
          </InputRow>
          {error === 'wrong' && (
            <Err>{t('public.password.wrong', { defaultValue: '비밀번호가 맞지 않습니다.' }) as string}</Err>
          )}
          <Submit type="submit" disabled={busy || !pw}>
            {busy
              ? t('public.password.checking', { defaultValue: '확인 중...' }) as string
              : t('public.password.submit', { defaultValue: '확인' }) as string}
          </Submit>
        </Form>
      </Card>
    </Wrap>
  );
};

export default SharePasswordPrompt;

const Wrap = styled.div`
  min-height: 100vh; background: #F8FAFC;
  display: flex; align-items: center; justify-content: center; padding: 40px 20px;
`;
const Card = styled.div`
  width: 100%; max-width: 420px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px;
  padding: 32px 28px; box-shadow: 0 4px 12px rgba(0,0,0,0.06);
  text-align: center;
`;
const Icon = styled.div`color: #14B8A6; margin-bottom: 12px; display: flex; justify-content: center;`;
const Title = styled.h1`font-size: 18px; font-weight: 700; color: #0F172A; margin: 0 0 6px;`;
const Sub = styled.p`font-size: 12px; color: #64748B; margin: 0 0 20px;`;
const Form = styled.form`display: flex; flex-direction: column; gap: 8px; align-items: stretch;`;
const InputRow = styled.div`display: flex; gap: 6px;`;
const Input = styled.input`
  flex: 1; min-height: 44px; padding: 10px 12px; font-size: 13px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  &:disabled { opacity: 0.5; }
`;
const Toggle = styled.button`
  display: inline-flex; align-items: center; min-height: 44px;
  padding: 8px 12px; font-size: 11px; font-weight: 600; color: #475569;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Submit = styled.button`
  display: inline-flex; align-items: center; justify-content: center; min-height: 44px;
  padding: 10px 16px; font-size: 13px; font-weight: 700; color: #fff;
  background: #14B8A6; border: none; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Err = styled.div`font-size: 12px; color: #DC2626; text-align: left;`;
