// 문의 페이지 — 연락처 카드 + 문의 폼 (백엔드 /api/inquiries 기존 라우트 사용).
import { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';
import { useReveal } from '../../hooks/useReveal';
import { mapApiError } from '../../utils/apiError';

const Reveal: React.FC<{ children: React.ReactNode; as?: React.ElementType }> = ({ children, as = 'div' }) => {
  const ref = useReveal<HTMLElement>();
  const Tag = as as 'div';
  return <Tag ref={ref as React.RefObject<HTMLDivElement>} className="reveal">{children}</Tag>;
};

type Reason = 'sales' | 'support' | 'partnership' | 'other';
const REASONS: Reason[] = ['sales', 'support', 'partnership', 'other'];

const ContactPage: React.FC = () => {
  const { t } = useTranslation('landing');
  const { t: tErr } = useTranslation('errors');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState<Reason>('sales');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<'idle' | 'ok' | 'err'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim() || !email.trim() || !message.trim()) {
      setResult('err');
      setErrMsg(t('contactPage.form.errRequired', '이름·이메일·메시지를 모두 입력해주세요.') as string);
      return;
    }
    setSubmitting(true); setResult('idle'); setErrMsg(null);
    try {
      const r = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, reason, message }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.message || 'submit_failed');
      setResult('ok');
      setName(''); setEmail(''); setMessage(''); setReason('sales');
    } catch (err) {
      setResult('err');
      setErrMsg(mapApiError(err, tErr));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LandingLayout transparentTop={false}>
      <SubHero>
        <Container>
          <Eyebrow>{t('contactPage.eyebrow', 'CONTACT')}</Eyebrow>
          <Title>{t('contactPage.title', '편하게 연락 주세요')}</Title>
          <Sub>{t('contactPage.sub', '도입 문의·기술 지원·제휴 어떤 주제든 환영합니다. 24시간 안에 답변드립니다.')}</Sub>
        </Container>
      </SubHero>

      <MainSection>
        <Container>
          <Layout>
            <Reveal>
              <SideCard>
                <SideTitle>{t('contactPage.side.title', '직접 연락')}</SideTitle>
                <SideRow>
                  <SideLabel>Email</SideLabel>
                  <SideValueLink href="mailto:hello@planq.kr">hello@planq.kr</SideValueLink>
                </SideRow>
                <SideRow>
                  <SideLabel>{t('contactPage.side.support', '기술 지원')}</SideLabel>
                  <SideValueLink href="mailto:support@planq.kr">support@planq.kr</SideValueLink>
                </SideRow>
                <SideRow>
                  <SideLabel>{t('contactPage.side.hours', '응답 시간')}</SideLabel>
                  <SideValue>{t('contactPage.side.hoursValue', '평일 09:00 ~ 18:00 (KST)')}</SideValue>
                </SideRow>
                <SideDivider />
                <SideTip>{t('contactPage.side.tip', '이미 사용자라면 로그인 후 워크스페이스 안의 \'피드백 보내기\' 가 가장 빠릅니다.')}</SideTip>
              </SideCard>
            </Reveal>

            <Reveal>
              <FormCard onSubmit={handleSubmit}>
                <FormTitle>{t('contactPage.form.title', '메시지 보내기')}</FormTitle>
                <Field>
                  <FieldLabel htmlFor="contact-name">{t('contactPage.form.name', '이름')}</FieldLabel>
                  <FieldInput id="contact-name" type="text" value={name} onChange={e => setName(e.target.value)} required maxLength={60} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="contact-email">{t('contactPage.form.email', '이메일')}</FieldLabel>
                  <FieldInput id="contact-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                </Field>
                <Field>
                  <FieldLabel>{t('contactPage.form.reason', '문의 유형')}</FieldLabel>
                  <ReasonGroup role="radiogroup">
                    {REASONS.map(r => (
                      <ReasonChip key={r} type="button" $active={reason === r} onClick={() => setReason(r)}>
                        {t(`contactPage.form.reasons.${r}`)}
                      </ReasonChip>
                    ))}
                  </ReasonGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="contact-message">{t('contactPage.form.message', '메시지')}</FieldLabel>
                  <FieldTextarea id="contact-message" rows={6} value={message} onChange={e => setMessage(e.target.value)} required maxLength={2000} />
                </Field>
                <SubmitRow>
                  <SubmitBtn type="submit" disabled={submitting}>
                    {submitting ? t('contactPage.form.sending', '보내는 중…') : t('contactPage.form.submit', '문의 보내기')}
                  </SubmitBtn>
                  {result === 'ok' && <ResultOk>{t('contactPage.form.ok', '메시지를 받았습니다. 곧 연락드리겠습니다.')}</ResultOk>}
                  {result === 'err' && <ResultErr>{errMsg}</ResultErr>}
                </SubmitRow>
              </FormCard>
            </Reveal>
          </Layout>
        </Container>
      </MainSection>
    </LandingLayout>
  );
};

export default ContactPage;

// ─── styled ───
const Container = styled.div`max-width: 1080px; margin: 0 auto; padding: 0 24px; @media (max-width: 640px) { padding: 0 16px; }`;
const SubHero = styled.section`
  padding: 96px 0 56px;
  background: linear-gradient(180deg, #F0FDFA 0%, #FFFFFF 100%);
  text-align: center;
`;
const Eyebrow = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 13px; font-weight: 500; color: #0D9488;
  letter-spacing: 3px; margin-bottom: 16px;
`;
const Title = styled.h1`
  font-size: 44px; font-weight: 700; color: #0F172A;
  line-height: 1.3; word-break: keep-all; margin-bottom: 20px;
  @media (max-width: 768px) { font-size: 32px; }
`;
const Sub = styled.p`
  font-size: 17px; font-weight: 300; color: #64748B;
  line-height: 1.7; max-width: 640px; margin: 0 auto; word-break: keep-all;
`;

const MainSection = styled.section`
  padding: 64px 0 120px; background: #FFFFFF;
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
`;
const Layout = styled.div`
  display: grid; grid-template-columns: 360px 1fr; gap: 32px;
  align-items: stretch;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
const SideCard = styled.div`
  padding: 32px 28px; background: #FAFBFC;
  border: 1px solid #E2E8F0; border-radius: 16px;
  display: flex; flex-direction: column; gap: 16px;
  height: 100%;
`;
const SideTitle = styled.h2`font-size: 18px; font-weight: 700; color: #0F172A; margin: 0;`;
const SideRow = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const SideLabel = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 11px; font-weight: 500; color: #94A3B8;
  text-transform: uppercase; letter-spacing: 1px;
`;
const SideValue = styled.div`font-size: 14px; color: #334155;`;
const SideValueLink = styled.a`
  font-size: 14px; color: #0D9488; text-decoration: none; font-weight: 500;
  &:hover { text-decoration: underline; }
`;
const SideDivider = styled.div`height: 1px; background: #E2E8F0; margin: 8px 0;`;
const SideTip = styled.p`
  font-size: 13px; color: #64748B; line-height: 1.7;
  word-break: keep-all; font-weight: 300;
`;

const FormCard = styled.form`
  padding: 32px 28px; background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 16px;
  display: flex; flex-direction: column; gap: 20px;
`;
const FormTitle = styled.h2`font-size: 18px; font-weight: 700; color: #0F172A; margin: 0 0 4px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const FieldLabel = styled.label`
  font-size: 13px; font-weight: 600; color: #475569;
`;
const FieldInput = styled.input`
  height: 44px; padding: 0 14px;
  font-size: 14px; color: #0F172A;
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
const FieldTextarea = styled.textarea`
  padding: 12px 14px;
  font-size: 14px; color: #0F172A; font-family: inherit;
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 8px;
  resize: vertical;
  min-height: 120px;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
const ReasonGroup = styled.div`display: flex; flex-wrap: wrap; gap: 8px;`;
const ReasonChip = styled.button<{ $active: boolean }>`
  height: 36px; padding: 0 16px;
  background: ${p => p.$active ? '#F0FDFA' : '#FFFFFF'};
  color: ${p => p.$active ? '#0D9488' : '#475569'};
  border: 1px solid ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  border-radius: 999px;
  font-size: 13px; font-weight: ${p => p.$active ? 600 : 500};
  cursor: pointer;
  transition: all 0.15s;
  &:hover { border-color: ${p => p.$active ? '#14B8A6' : '#CBD5E1'}; }
`;
const SubmitRow = styled.div`display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 4px;`;
const SubmitBtn = styled.button`
  padding: 14px 32px; border-radius: 999px;
  background: #14B8A6; color: #FFFFFF;
  border: none; font-size: 14px; font-weight: 600; cursor: pointer;
  transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
  box-shadow: 0 0 24px rgba(20,184,166,0.2);
  &:hover:not(:disabled) { background: #0D9488; transform: translateY(-1px); box-shadow: 0 0 36px rgba(20,184,166,0.32); }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const ResultOk = styled.div`font-size: 13px; color: #0D9488; font-weight: 500;`;
const ResultErr = styled.div`font-size: 13px; color: #B91C1C; font-weight: 500;`;
