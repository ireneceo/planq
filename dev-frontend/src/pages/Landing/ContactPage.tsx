// 문의 페이지 — 연락처 카드 + 문의 폼 (백엔드 /api/inquiries 기존 라우트 사용).
//
// ★ 2026-08-24 — 이 폼은 **한 건도 접수되지 않고 있었다.**
//   프론트가 { name, email, reason } 을 보내는데 라우트는 { from_name, from_email } 을 요구해
//   모든 제출이 400 `name_required` 로 떨어졌다(실호출로 재현). 필드명을 라우트 계약에 맞춘다.
//   `reason` 은 DB 컬럼이 없다 — 스키마를 늘리는 대신 이미 있는 자유형 `source` 에 실어 보낸다
//   (admin 이 유입 경로별로 구분할 수 있어야 하므로 버리지 않는다).
//
// 견적 문의(`?type=quote`)는 별도 폼을 만들지 않고 이 폼의 모드로 처리한다 —
//   접수 경로가 둘로 갈라지면 admin 장부도 둘로 갈라진다.
// 화상 업무설계·사용안내 신청(`?type=onboarding`)도 같은 폼의 모드다 — 칸은 앱 신청 창과 같은
//   OnboardingCallFields 한 벌(docs/ONBOARDING_CALL_DESIGN.md).
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';
import { track } from '../../services/marketingTags';
import { useReveal } from '../../hooks/useReveal';
import { mapApiError } from '../../utils/apiError';
import OnboardingCallFields, {
  emptyOnboardingCall, toDetails, hasValidSlot, browserTimezone, type OnboardingCallValue,
} from '../../components/Common/OnboardingCallFields';

const Reveal: React.FC<{ children: React.ReactNode; as?: React.ElementType }> = ({ children, as = 'div' }) => {
  const ref = useReveal<HTMLElement>();
  const Tag = as as 'div';
  return <Tag ref={ref as React.RefObject<HTMLDivElement>} className="reveal">{children}</Tag>;
};

type Reason = 'sales' | 'support' | 'partnership' | 'other';
const REASONS: Reason[] = ['sales', 'support', 'partnership', 'other'];

// 견적 문의에서 고르는 서비스 범위 — ServicePage 의 SERVICES 와 같은 축.
// migration = 대량 자료 이전(워프로랩 스튜디오, 견적) — 2026-10-23 Fable D4. 무료 이전 연결은 «시작 안내 30분» 의 주제다.
const SCOPES = ['audit', 'design', 'automation', 'build', 'improve', 'migration'] as const;
type Scope = typeof SCOPES[number];
const SCOPE_LABEL_KEY: Record<Scope, string> = {
  audit: 'scopeAudit', design: 'scopeDesign', automation: 'scopeAutomation',
  build: 'scopeBuild', improve: 'scopeImprove', migration: 'scopeMigration',
};

const ContactPage: React.FC = () => {
  const { t, i18n } = useTranslation('landing');
  const { t: tErr } = useTranslation('errors');
  const [params] = useSearchParams();
  // 견적 문의 모드 — /service 의 CTA 가 이 쿼리로 들어온다.
  const isQuote = params.get('type') === 'quote';
  const isCall = params.get('type') === 'onboarding';
  // ?topic=migration 으로 들어오면(요금제 FAQ·Q file 안내) «자료 옮기기» 만 골라 둔다
  const callTopicParam = params.get('topic');
  const initialCall = () => emptyOnboardingCall(callTopicParam === 'migration' ? ['migration'] : callTopicParam === 'workflow' ? ['workflow'] : undefined);
  const [call, setCall] = useState<OnboardingCallValue>(initialCall);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(() => {
    const s0 = params.get('scope');
    return (SCOPES as readonly string[]).includes(String(s0)) ? [s0 as Scope] : [];
  });
  const [reason, setReason] = useState<Reason>('sales');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<'idle' | 'ok' | 'err'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (isCall) {
      if (!name.trim() || !email.trim() || !hasValidSlot(call)) {
        setResult('err');
        setErrMsg(t('contactPage.call.errRequired', '이름·이메일과 희망 시간을 하나 이상 골라 주세요.') as string);
        return;
      }
    } else if (!name.trim() || !email.trim() || !message.trim()) {
      setResult('err');
      setErrMsg(t('contactPage.form.errRequired', '이름·이메일·메시지를 모두 입력해주세요.') as string);
      return;
    }
    setSubmitting(true); setResult('idle'); setErrMsg(null);
    try {
      // 견적 문의는 고른 범위를 본문 끝에 붙인다 — 전용 컬럼을 만들지 않고도 admin 이 그대로 읽는다.
      const scopeLine = (isQuote && scopes.length)
        ? `\n\n[${t('contactPage.scopeLine', '관심 범위')}] ${scopes.map(sc => t(`contactPage.${SCOPE_LABEL_KEY[sc]}`)).join(', ')}`
        : '';
      const r = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isCall ? {
          kind: 'onboarding_call',
          source: 'landing_contact:onboarding',
          from_name: name,
          from_email: email,
          from_company: company || undefined,
          message: message || undefined,
          details: toDetails(call),
          timezone: browserTimezone(),
          locale: i18n.language,
        } : {
          locale: i18n.language,
          // 라우트 계약 그대로 — 필드명이 어긋나면 전건 400 이다.
          kind: isQuote ? 'enterprise' : 'landing',
          source: isQuote ? 'landing_service_quote' : `landing_contact:${reason}`,
          from_name: name,
          from_email: email,
          from_company: company || undefined,
          from_phone: phone || undefined,
          message: message + scopeLine,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.message || 'submit_failed');
      setResult('ok');
      // 고른 칸 값만 — 이름·메일·본문은 보내지 않는다(docs/MARKETING_TRACKING_DESIGN.md §3-4)
      track('pq_lead', isCall
        ? { lead_type: 'onboarding_call' }
        : { lead_type: isQuote ? 'quote' : 'contact', contact_reason: isQuote ? 'quote' : reason });
      setName(''); setEmail(''); setMessage(''); setReason('sales');
      setCompany(''); setPhone(''); setScopes([]); setCall(initialCall());
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
          <Title>{isCall
            ? t('contactPage.call.title', '화상으로 업무 설계·사용 안내 받기')
            : isQuote
            ? t('contactPage.quoteTitle', '견적 문의')
            : t('contactPage.title', '편하게 연락 주세요')}</Title>
          <Sub>{isCall
            ? t('contactPage.call.sub', '30분 화상 미팅으로 지금 일하는 방식을 듣고, PlanQ 에서 어떻게 나누고 쓰면 좋을지 맞춰 안내해 드려요.')
            : isQuote
            ? t('contactPage.quoteSub', '')
            : t('contactPage.sub', '도입 문의·기술 지원·제휴 어떤 주제든 환영합니다. 24시간 안에 답변드립니다.')}</Sub>
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
                {!isCall && (
                  <SideCallLink to="/contact?type=onboarding" data-testid="contact-call-link">
                    {t('contactPage.call.link', '화상으로 업무 설계·사용 안내 받기 →')}
                  </SideCallLink>
                )}
              </SideCard>
            </Reveal>

            <Reveal>
              <FormCard onSubmit={handleSubmit}>
                <FormTitle>{isCall
                  ? t('contactPage.call.formTitle', '신청서')
                  : isQuote
                  ? t('contactPage.quoteTitle', '견적 문의')
                  : t('contactPage.form.title', '메시지 보내기')}</FormTitle>
                <Field>
                  <FieldLabel htmlFor="contact-name">{t('contactPage.form.name', '이름')}</FieldLabel>
                  <FieldInput id="contact-name" type="text" value={name} onChange={e => setName(e.target.value)} required maxLength={60} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="contact-email">{t('contactPage.form.email', '이메일')}</FieldLabel>
                  <FieldInput id="contact-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                </Field>
                {isCall ? (
                  <>
                    <Field>
                      <FieldLabel htmlFor="contact-company">{t('contactPage.call.company', '회사·팀 이름 (선택)')}</FieldLabel>
                      <FieldInput id="contact-company" type="text" value={company}
                        onChange={e => setCompany(e.target.value)} maxLength={100} />
                    </Field>
                    <OnboardingCallFields value={call} onChange={setCall} idPrefix="contact-call" />
                    {/* 양이 많아 대신 옮겨야 하면 — 유료 대량 이전(스튜디오, 견적)이 따로 있다 */}
                    <ServiceHint data-testid="contact-call-bulk-hint">
                      {t('contactPage.call.bulkHint', '자료가 많아 대신 옮겨 드려야 하나요?')}{' '}
                      <ServiceHintLink to="/contact?type=quote&scope=migration">{t('contactPage.call.bulkLink', '대량 이전 견적 문의 →')}</ServiceHintLink>
                    </ServiceHint>
                  </>
                ) : isQuote ? (
                  <>
                    <Field>
                      <FieldLabel htmlFor="contact-company">{t('contactPage.company', '회사명')}</FieldLabel>
                      <FieldInput id="contact-company" type="text" value={company}
                        onChange={e => setCompany(e.target.value)} maxLength={100} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="contact-phone">{t('contactPage.phone', '연락처')}</FieldLabel>
                      <FieldInput id="contact-phone" type="tel" value={phone}
                        onChange={e => setPhone(e.target.value)} maxLength={40} />
                    </Field>
                    <Field>
                      <FieldLabel>{t('contactPage.scope', '관심 있는 범위')}</FieldLabel>
                      <ReasonGroup role="group">
                        {SCOPES.map(sc => (
                          <ReasonChip key={sc} type="button" $active={scopes.includes(sc)}
                            aria-pressed={scopes.includes(sc)}
                            onClick={() => setScopes(prev => (
                              prev.includes(sc) ? prev.filter(x => x !== sc) : [...prev, sc]
                            ))}>
                            {t(`contactPage.${SCOPE_LABEL_KEY[sc]}`)}
                          </ReasonChip>
                        ))}
                      </ReasonGroup>
                    </Field>
                    {/* 견적 전에 무료로 먼저 — 시작 안내 30분(업무 설계·자료 옮기기) */}
                    <ServiceHint data-testid="contact-quote-free-hint">
                      {t('contactPage.quoteFreeHint', '먼저 무료로 이야기해 보고 싶으신가요? 30분 화상으로 업무 설계와 자료 옮기는 순서를 같이 잡아 드려요.')}{' '}
                      <ServiceHintLink to="/contact?type=onboarding">{t('contactPage.call.link', '시작 안내 30분 신청 →')}</ServiceHintLink>
                    </ServiceHint>
                  </>
                ) : (
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
                )}
                <Field>
                  <FieldLabel htmlFor="contact-message">{isCall
                    ? t('contactPage.call.note', '더 알려 주실 것 (선택)')
                    : isQuote
                    ? t('contactPage.quoteMessage', '회사 상황과 원하시는 것')
                    : t('contactPage.form.message', '메시지')}</FieldLabel>
                  <FieldTextarea id="contact-message" rows={isCall ? 3 : 6} value={message}
                    placeholder={isQuote ? (t('contactPage.quotePlaceholder', '') as string) : undefined}
                    onChange={e => setMessage(e.target.value)} required={!isCall} maxLength={isCall ? 200 : 2000} />
                </Field>
                <SubmitRow>
                  <SubmitBtn type="submit" disabled={submitting} data-testid="contact-submit">
                    {submitting
                      ? t('contactPage.form.sending', '보내는 중…')
                      : isCall ? t('contactPage.call.submit', '화상 안내 신청하기')
                      : (isQuote ? t('contactPage.quoteSubmit', '견적 문의 보내기') : t('contactPage.form.submit', '문의 보내기'))}
                  </SubmitBtn>
                  {result === 'ok' && <ResultOk>{isCall
                    ? t('contactPage.call.ok', '신청을 받았습니다. 희망 시간을 확인하고 일정과 회의 링크를 메일로 보내 드릴게요.')
                    : t('contactPage.form.ok', '메시지를 받았습니다. 곧 연락드리겠습니다.')}</ResultOk>}
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
  font-size: 0.8125rem; font-weight: 500; color: #0D9488;
  letter-spacing: 3px; margin-bottom: 16px;
`;
const Title = styled.h1`
  font-size: 2.75rem; font-weight: 700; color: #0F172A;
  line-height: 1.3; word-break: keep-all; margin-bottom: 20px;
  @media (max-width: 768px) { font-size: 2rem; }
`;
const Sub = styled.p`
  font-size: 1.0625rem; font-weight: 300; color: #64748B;
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
const SideTitle = styled.h2`font-size: 1.125rem; font-weight: 700; color: #0F172A; margin: 0;`;
const SideRow = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const SideLabel = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 0.6875rem; font-weight: 500; color: #94A3B8;
  text-transform: uppercase; letter-spacing: 1px;
`;
const SideValue = styled.div`font-size: 0.875rem; color: #334155;`;
const SideValueLink = styled.a`
  font-size: 0.875rem; color: #0D9488; text-decoration: none; font-weight: 500;
  &:hover { text-decoration: underline; }
`;
const SideCallLink = styled(Link)`
  font-size: 0.875rem; font-weight: 600; color: #0D9488; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
const SideDivider = styled.div`height: 1px; background: #E2E8F0; margin: 8px 0;`;
const SideTip = styled.p`
  font-size: 0.8125rem; color: #64748B; line-height: 1.7;
  word-break: keep-all; font-weight: 300;
`;

const FormCard = styled.form`
  padding: 32px 28px; background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 16px;
  display: flex; flex-direction: column; gap: 20px;
`;
const FormTitle = styled.h2`font-size: 1.125rem; font-weight: 700; color: #0F172A; margin: 0 0 4px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const FieldLabel = styled.label`
  font-size: 0.8125rem; font-weight: 600; color: #475569;
`;
const FieldInput = styled.input`
  height: 44px; padding: 0 14px;
  font-size: 0.875rem; color: #0F172A;
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
const FieldTextarea = styled.textarea`
  padding: 12px 14px;
  font-size: 0.875rem; color: #0F172A; font-family: inherit;
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
  font-size: 0.8125rem; font-weight: ${p => p.$active ? 600 : 500};
  cursor: pointer;
  transition: all 0.15s;
  &:hover { border-color: ${p => p.$active ? '#14B8A6' : '#CBD5E1'}; }
`;
const SubmitRow = styled.div`display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 4px;`;
const SubmitBtn = styled.button`
  padding: 14px 32px; border-radius: 999px;
  background: #14B8A6; color: #FFFFFF;
  border: none; font-size: 0.875rem; font-weight: 600; cursor: pointer;
  transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
  box-shadow: 0 0 24px rgba(20,184,166,0.2);
  &:hover:not(:disabled) { background: #0D9488; transform: translateY(-1px); box-shadow: 0 0 36px rgba(20,184,166,0.32); }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const ResultOk = styled.div`font-size: 0.8125rem; color: #0D9488; font-weight: 500;`;
const ResultErr = styled.div`font-size: 0.8125rem; color: #B91C1C; font-weight: 500;`;

// 의뢰할 때 다른 길(무료 30분 ↔ 유료 대량 이전)을 알려 주는 한 줄 (2026-10-23, docs/TRUST_SERVICES_DESIGN.md D4)
const ServiceHint = styled.p`
  margin: 0; font-size: 0.8125rem; color: #64748B; line-height: 1.6;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px 12px;
`;
const ServiceHintLink = styled(Link)`
  color: #0D9488; font-weight: 600; text-decoration: none; white-space: nowrap;
  &:hover { text-decoration: underline; }
`;
