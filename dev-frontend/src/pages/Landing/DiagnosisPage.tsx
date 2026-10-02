// 무료 업무체계 자가진단 (#426) — /service/diagnosis (공개, 로그인 불필요)
//
//   Irene #426: *"무료로 기본 설문 하게 한 다음 맞춤피드백 주는 거 만들면 어때? 왜 플랜큐를 써야 하는지 더 확실해지게."*
//   설계 docs/FREE_DIAGNOSIS_DESIGN.md — 6개 층 × 2문항(서비스 페이지의 «우리가 설계하는 것» 6층과 같은 이름).
//   · 점수는 서버가 센다(POST /api/diagnosis) — 화면은 받은 점수를 그린다.
//   · 결과 문장은 미리 쓴 문구(landing.json diagnosisPage.results) — AI 를 부르지 않는다.
//   · 결과는 이메일 없이 바로. 메일 받기는 선택 — 첫 제출이 준 claim 으로 **같은 응답**에 붙인다.
//   · 진행 중 답은 이 브라우저에만 보관(새로고침해도 이어서). 저장소가 막혀 있어도 화면은 돈다.
import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { i18nArray } from '../../utils/i18nArray';
import LandingLayout from '../../components/Landing/LandingLayout';
import { Container, Eyebrow, PrimaryCta, SecondaryCta } from '../../components/Landing/landingShell';

const LAYERS = ['structure', 'workflow', 'information', 'decision', 'automation', 'platform'] as const;
const QIDS = ['S1', 'S2', 'W1', 'W2', 'I1', 'I2', 'D1', 'D2', 'A1', 'A2', 'P1', 'P2'] as const;
const INDUSTRIES = ['agency', 'consulting', 'it', 'commerce', 'other'] as const;
const TEAM_SIZES = ['1-5', '6-20', '21-50', '50+'] as const;
type Layer = typeof LAYERS[number];
// 문항 id 첫 글자 → 층 (서버 services/diagnosis.js QUESTIONS 와 같은 짝)
const LAYER_OF: Record<string, Layer> = { S: 'structure', W: 'workflow', I: 'information', D: 'decision', A: 'automation', P: 'platform' };
type Band = 'low' | 'mid' | 'high';
interface Result { scores: Record<Layer, number>; total: number; weakest: Layer; bands: Record<Layer, Band>; claim: string | null }

const STORE_KEY = 'planq:diagnosis-progress';
const readStore = (): { answers: Record<string, number>; step: number } | null => {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; }
};
const writeStore = (v: unknown) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* 저장 불가 — 화면은 그대로 */ } };
const clearStore = () => { try { localStorage.removeItem(STORE_KEY); } catch { /* noop */ } };

const DiagnosisPage: React.FC = () => {
  const { t, i18n } = useTranslation('landing');
  const D = (k: string, o?: Record<string, unknown>) => t(`diagnosisPage.${k}`, o) as string;
  const saved = useMemo(readStore, []);
  // step: -1 소개 · 0..11 문항 · 12 선택 문항 · 13 결과
  const [step, setStep] = useState<number>(saved?.step ?? -1);
  const [answers, setAnswers] = useState<Record<string, number>>(saved?.answers || {});
  const [industry, setIndustry] = useState<string | null>(null);
  const [teamSize, setTeamSize] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 메일 받기
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [consent, setConsent] = useState(false);
  const [mailState, setMailState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [mailError, setMailError] = useState<string | null>(null);

  useEffect(() => { if (step >= 0 && step <= 12) writeStore({ answers, step }); }, [answers, step]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);

  const choose = (qid: string, v: number) => {
    setAnswers((a) => ({ ...a, [qid]: v }));
    setStep((s) => Math.min(12, s + 1));
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true); setError(null);
    try {
      const r = await fetch('/api/diagnosis', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, industry, team_size: teamSize, lang: i18n.language, source: new URLSearchParams(window.location.search).get('utm_source') || null }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message);
      setResult(j.data as Result);
      setStep(13);
      clearStore();
    } catch { setError(D('submitFailed')); }
    finally { setSubmitting(false); }
  };

  const sendMail = async () => {
    if (!result?.claim || mailState === 'sending') return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setMailError(D('invalidEmail')); return; }
    setMailState('sending'); setMailError(null);
    try {
      const r = await fetch('/api/diagnosis/claim', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim: result.claim, email: email.trim(), company: company.trim() || null, consent }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message);
      setMailState('sent');
    } catch { setMailState('error'); setMailError(D('sendFailed')); }
  };

  const restart = () => { clearStore(); setAnswers({}); setResult(null); setIndustry(null); setTeamSize(null); setMailState('idle'); setStep(0); };

  const ordered = result ? [...LAYERS].sort((a, b) => result.scores[a] - result.scores[b] || LAYERS.indexOf(a) - LAYERS.indexOf(b)) : [];

  return (
    <LandingLayout transparentTop={false}>
      <Wrap>
        <Container>
          <Inner data-testid="diagnosis-page">
            <Eyebrow>{D('eyebrow')}</Eyebrow>
            {step === -1 && (
              <>
                <H1>{D('title')}</H1>
                <Lead>{D('sub')}</Lead>
                <LayerChips>{LAYERS.map((l) => <Chip key={l}>{D(`layers.${l}`)}</Chip>)}</LayerChips>
                <Actions><StartBtn type="button" onClick={() => setStep(0)} data-testid="diagnosis-start">{D('start')}</StartBtn></Actions>
              </>
            )}

            {step >= 0 && step <= 11 && (() => {
              const qid = QIDS[step];
              const opts = i18nArray<string>(t(`diagnosisPage.questions.${qid}.o`, { returnObjects: true }));
              return (
                <Card>
                  <Progress aria-label={D('progress', { n: step + 1, total: 12 })}>
                    <Bar style={{ width: `${((step + 1) / 12) * 100}%` }} />
                  </Progress>
                  <Meta>{D(`layers.${LAYER_OF[qid[0]]}`)} · {D('progress', { n: step + 1, total: 12 })}</Meta>
                  <Question>{D(`questions.${qid}.q`)}</Question>
                  <Options role="radiogroup">
                    {opts.map((o, i) => (
                      <Option key={i} type="button" role="radio" aria-checked={answers[qid] === i} $on={answers[qid] === i}
                        onClick={() => choose(qid, i)} data-testid={`diagnosis-opt-${qid}-${i}`}>{o}</Option>
                    ))}
                  </Options>
                  <Nav>
                    <NavBtn type="button" onClick={() => setStep((s) => s - 1)}>{D('prev')}</NavBtn>
                    {answers[qid] !== undefined && <NavBtn type="button" onClick={() => setStep((s) => s + 1)}>{D('next')}</NavBtn>}
                  </Nav>
                </Card>
              );
            })()}

            {step === 12 && (
              <Card>
                <Question>{D('optionalTitle')}</Question>
                <Label>{D('industry')}</Label>
                <Pills>{INDUSTRIES.map((k) => (
                  <Pill key={k} type="button" $on={industry === k} onClick={() => setIndustry(industry === k ? null : k)}>{D(`industries.${k}`)}</Pill>
                ))}</Pills>
                <Label>{D('teamSize')}</Label>
                <Pills>{TEAM_SIZES.map((k) => (
                  <Pill key={k} type="button" $on={teamSize === k} onClick={() => setTeamSize(teamSize === k ? null : k)}>{k}</Pill>
                ))}</Pills>
                {error && <Err role="alert">{error}</Err>}
                <Nav>
                  <NavBtn type="button" onClick={() => setStep(11)}>{D('prev')}</NavBtn>
                  <StartBtn type="button" onClick={submit} disabled={submitting || Object.keys(answers).length !== 12} data-testid="diagnosis-finish">{D('finish')}</StartBtn>
                </Nav>
              </Card>
            )}

            {step === 13 && result && (
              <>
                <H1>{D('resultTitle')}</H1>
                <Lead>{D('total', { total: result.total })} · <strong>{D('weakest', { layer: D(`layers.${result.weakest}`) })}</strong></Lead>
                <Bars data-testid="diagnosis-bars">
                  {LAYERS.map((l) => (
                    <BarRow key={l}>
                      <BarLabel>{D(`layers.${l}`)}</BarLabel>
                      <BarTrack><BarFill style={{ width: `${(result.scores[l] / 4) * 100}%` }} $band={result.bands[l]} /></BarTrack>
                      <BarNum>{result.scores[l]}/4</BarNum>
                    </BarRow>
                  ))}
                </Bars>
                {ordered.map((l) => (
                  <Feedback key={l} $first={l === result.weakest} data-testid={`diagnosis-feedback-${l}`}>
                    <FbTitle>{D(`layers.${l}`)} · {result.scores[l]}/4</FbTitle>
                    <FbLine><b>{D('labelNow')}</b> {D(`results.${l}.${result.bands[l]}.now`)}</FbLine>
                    <FbLine><b>{D('labelChange')}</b> {D(`results.${l}.${result.bands[l]}.change`)}</FbLine>
                    <FbPlanq>{D(`results.${l}.${result.bands[l]}.planq`)}</FbPlanq>
                  </Feedback>
                ))}
                <Actions>
                  <PrimaryCta to="/register">{D('ctaStart')}</PrimaryCta>
                  <SecondaryCta to="/contact?type=quote&scope=audit">{D('ctaExpert')}</SecondaryCta>
                </Actions>
                {result.claim && (
                  <MailCard data-testid="diagnosis-mail">
                    <FbTitle>{D('mailTitle')}</FbTitle>
                    {mailState === 'sent' ? <Ok role="status">{D('sent')}</Ok> : (
                      <>
                        <Input type="email" placeholder={D('email')} aria-label={D('email')} value={email} onChange={(e) => setEmail(e.target.value)} />
                        <Input type="text" placeholder={D('company')} aria-label={D('company')} value={company} onChange={(e) => setCompany(e.target.value)} />
                        <Consent><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> <span>{D('consent')}</span></Consent>
                        {mailError && <Err role="alert">{mailError}</Err>}
                        <StartBtn type="button" onClick={sendMail} disabled={!consent || !email.trim() || mailState === 'sending'}>{D('send')}</StartBtn>
                      </>
                    )}
                  </MailCard>
                )}
                <Actions><NavBtn type="button" onClick={restart}>{D('retry')}</NavBtn></Actions>
              </>
            )}
          </Inner>
        </Container>
      </Wrap>
    </LandingLayout>
  );
};

export default DiagnosisPage;

const Wrap = styled.section`padding: 72px 0 96px; background: linear-gradient(180deg, #F0FDFA 0%, #FFFFFF 40%); @media (max-width: 640px) { padding: 40px 0 64px; }`;
const Inner = styled.div`max-width: 680px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px;`;
const H1 = styled.h1`margin: 0; font-size: 2rem; font-weight: 700; color: #0F172A; line-height: 1.35; word-break: keep-all; @media (max-width: 640px) { font-size: 1.5rem; }`;
const Lead = styled.p`margin: 0; font-size: 1rem; color: #475569; line-height: 1.7; word-break: keep-all;`;
const LayerChips = styled.div`display: flex; flex-wrap: wrap; gap: 8px;`;
const Chip = styled.span`padding: 6px 12px; border-radius: 999px; background: #FFFFFF; border: 1px solid #CCFBF1; color: #0F766E; font-size: 0.8125rem;`;
const Actions = styled.div`display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px;`;
const StartBtn = styled.button`
  min-height: 48px; padding: 0 28px; border: none; border-radius: 999px; cursor: pointer;
  background: #0F766E; color: #FFFFFF; font-size: 0.9375rem; font-weight: 600;
  &:hover:not(:disabled) { background: #115E59; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const Card = styled.div`background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 14px; @media (max-width: 640px) { padding: 18px; }`;
const Progress = styled.div`height: 6px; border-radius: 3px; background: #E2E8F0; overflow: hidden;`;
const Bar = styled.div`height: 100%; background: #14B8A6; transition: width 0.25s;`;
const Meta = styled.div`font-size: 0.75rem; color: #64748B;`;
const Question = styled.h2`margin: 0; font-size: 1.1875rem; font-weight: 700; color: #0F172A; line-height: 1.5; word-break: keep-all;`;
const Options = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const Option = styled.button<{ $on: boolean }>`
  text-align: left; min-height: 52px; padding: 12px 16px; border-radius: 12px; cursor: pointer;
  background: ${(p) => (p.$on ? '#F0FDFA' : '#FFFFFF')}; border: 1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};
  font-size: 0.9375rem; color: #0F172A; line-height: 1.5;
  &:hover { border-color: #5EEAD4; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const Nav = styled.div`display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap;`;
const NavBtn = styled.button`
  min-height: 44px; padding: 0 18px; border-radius: 999px; cursor: pointer;
  background: #FFFFFF; border: 1px solid #CBD5E1; color: #334155; font-size: 0.875rem; font-weight: 600;
  &:hover { background: #F8FAFC; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const Label = styled.div`font-size: 0.8125rem; font-weight: 600; color: #334155;`;
const Pills = styled.div`display: flex; flex-wrap: wrap; gap: 8px;`;
const Pill = styled.button<{ $on: boolean }>`
  min-height: 40px; padding: 0 14px; border-radius: 999px; cursor: pointer; font-size: 0.8125rem;
  background: ${(p) => (p.$on ? '#0F766E' : '#FFFFFF')}; color: ${(p) => (p.$on ? '#FFFFFF' : '#334155')};
  border: 1px solid ${(p) => (p.$on ? '#0F766E' : '#CBD5E1')};
`;
const Bars = styled.div`display: flex; flex-direction: column; gap: 10px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: 20px;`;
const BarRow = styled.div`display: grid; grid-template-columns: minmax(84px, 120px) 1fr 40px; align-items: center; gap: 10px;`;
const BarLabel = styled.div`font-size: 0.8125rem; color: #334155;`;
const BarTrack = styled.div`height: 10px; border-radius: 5px; background: #E2E8F0; overflow: hidden;`;
const BarFill = styled.div<{ $band: Band }>`height: 100%; background: ${(p) => (p.$band === 'low' ? '#F43F5E' : p.$band === 'mid' ? '#F59E0B' : '#14B8A6')};`;
const BarNum = styled.div`font-size: 0.75rem; color: #64748B; text-align: right;`;
const Feedback = styled.div<{ $first: boolean }>`
  background: #FFFFFF; border-radius: 16px; padding: 18px 20px; display: flex; flex-direction: column; gap: 8px;
  border: 1px solid ${(p) => (p.$first ? '#14B8A6' : '#E2E8F0')};
`;
const FbTitle = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const FbLine = styled.p`margin: 0; font-size: 0.875rem; color: #334155; line-height: 1.7; b { color: #0F766E; margin-right: 6px; }`;
const FbPlanq = styled.p`margin: 0; font-size: 0.8125rem; color: #0F766E; line-height: 1.6;`;
const MailCard = styled(Card)`margin-top: 8px;`;
const Input = styled.input`
  min-height: 44px; padding: 0 14px; border-radius: 10px; border: 1px solid #CBD5E1; font-size: 0.9375rem;
  &:focus { outline: 2px solid #5EEAD4; outline-offset: 1px; }
`;
const Consent = styled.label`display: flex; gap: 8px; align-items: flex-start; font-size: 0.75rem; color: #475569; line-height: 1.5; input { margin-top: 3px; }`;
const Err = styled.div`font-size: 0.8125rem; color: #B91C1C;`;
const Ok = styled.div`font-size: 0.875rem; color: #0F766E;`;
