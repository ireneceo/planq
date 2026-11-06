// MailConnectGuide — 메일 계정 연결 안내(서비스별 앱 비밀번호 단계) + 연결 실패 코드 → 안내 표.
// EmailAccountSettings 에서 뺐다(god-file 래칫). 문구는 qmail.json 이 정본이다.
//
// ★ 2단계 인증은 «안 했다» 는 사람에게만 펼친다 (2026-11-06, Irene «2단계 인증 안되어 있으면 혼란이야. 제대로 안내해야 해. 안했다라는 사람만»).
//   켜는 곳 링크 없이 «먼저 켜주세요» 한 줄만 있으면, 꺼진 사람은 «앱 비밀번호 만들기» 에서
//   «이 설정은 계정에서 사용할 수 없습니다» 를 보고 막힌다. 이미 켠 사람에게는 읽을 필요 없는 문장이다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

export type TwoStepAnswer = 'on' | 'off' | null;

export interface GuideDef {
  titleKey: string; titleDefault: string;
  steps: { key: string; default: string }[];
  link?: { url: string; labelKey: string; labelDefault: string };
  // 앱 비밀번호가 2단계 인증을 전제로 하는 서비스 — 질문 한 줄로 갈라 안내한다
  twoStep?: { setupUrl: string; provider: string };
}

export const APP_PASSWORD_GUIDES: Record<string, GuideDef> = {
  gmail: {
    titleKey: 'settings.guide.gmail.title', titleDefault: '',
    twoStep: { setupUrl: 'https://myaccount.google.com/signinoptions/two-step-verification', provider: 'gmail' },
    steps: [
      { key: 'settings.guide.gmail.s2', default: '' },
      { key: 'settings.guide.gmail.s3', default: '' },
    ],
    link: { url: 'https://myaccount.google.com/apppasswords', labelKey: 'settings.guide.gmail.link', labelDefault: '' },
  },
  naver: {
    titleKey: 'settings.guide.naver.title', titleDefault: '',
    steps: [
      { key: 'settings.guide.naver.s1', default: '' },
      { key: 'settings.guide.naver.s2', default: '' },
      { key: 'settings.guide.naver.s3', default: '' },
    ],
    link: { url: 'https://mail.naver.com', labelKey: 'settings.guide.naver.link', labelDefault: '' },
  },
  icloud: {
    titleKey: 'settings.guide.icloud.title', titleDefault: '',
    twoStep: { setupUrl: 'https://account.apple.com', provider: 'icloud' },
    steps: [
      { key: 'settings.guide.icloud.s2', default: '' },
      { key: 'settings.guide.icloud.s3', default: '' },
    ],
    link: { url: 'https://account.apple.com', labelKey: 'settings.guide.icloud.link', labelDefault: '' },
  },
  outlook: {
    titleKey: 'settings.guide.outlook.title', titleDefault: '',
    twoStep: { setupUrl: 'https://account.microsoft.com/security', provider: 'outlook' },
    steps: [
      { key: 'settings.guide.outlook.s2', default: '' },
      { key: 'settings.guide.outlook.s3', default: '' },
    ],
    link: { url: 'https://account.microsoft.com/security', labelKey: 'settings.guide.outlook.link', labelDefault: '' },
  },
  kakao: {
    titleKey: 'settings.guide.kakao.title', titleDefault: '',
    steps: [
      { key: 'settings.guide.kakao.s1', default: '' },
      { key: 'settings.guide.kakao.s2', default: '' },
    ],
    link: { url: 'https://mail.kakao.com', labelKey: 'settings.guide.kakao.link', labelDefault: '' },
  },
  daum: {
    titleKey: 'settings.guide.daum.title', titleDefault: '',
    steps: [
      { key: 'settings.guide.daum.s1', default: '' },
      { key: 'settings.guide.daum.s2', default: '' },
    ],
    link: { url: 'https://mail.daum.net', labelKey: 'settings.guide.daum.link', labelDefault: '' },
  },
  custom: {
    titleKey: 'settings.guide.custom.title', titleDefault: '',
    steps: [
      { key: 'settings.guide.custom.s1', default: '' },
      { key: 'settings.guide.custom.s2', default: '' },
      { key: 'settings.guide.custom.s3', default: '' },
    ],
  },
};

// 폼 칸 — 실패를 «어느 칸» 에 붙일지
export type MailFormField = 'email' | 'imap_host' | 'imap_username' | 'imap_password' | 'smtp_host' | 'smtp_username' | 'smtp_password';

// 서버 검증 실패 코드 → 안내 문구 · 해당 서비스 안내 · 문제 칸 · 2단계 인증 안내를 펼칠지.
//   문구는 qmail.json settings.err.* 에만 둔다(하드코딩 래칫).
export const IMAP_ERROR_GUIDE: Record<string, { key: string; def: string; preset?: string; field?: MailFormField; twoStepOff?: boolean }> = {
  gmail_app_password_required: { key: 'settings.err.gmailAppPassword', def: '', preset: 'gmail', field: 'imap_password' },
  gmail_auth_invalid: { key: 'settings.err.gmailAuthInvalid', def: '', preset: 'gmail', field: 'imap_password', twoStepOff: true },
  naver_app_password_required: { key: 'settings.err.naverAppPassword', def: '', preset: 'naver', field: 'imap_password' },
  ms_app_password_required: { key: 'settings.err.msAppPassword', def: '', preset: 'outlook', field: 'imap_password' },
  imap_auth_failed: { key: 'settings.err.authFailed', def: '', field: 'imap_password' },
  imap_host_not_found: { key: 'settings.err.hostNotFound', def: '', field: 'imap_host' },
  imap_connect_failed: { key: 'settings.err.connectFailed', def: '', field: 'imap_host' },
  // 목적지 검사(utils/netGuard) — 받기·보내기 서버 둘 다 이 코드를 쓴다. 받기 칸으로 보낸다.
  invalid_host: { key: 'settings.err.hostNotFound', def: '', field: 'imap_host' },
  host_unresolved: { key: 'settings.err.hostNotFound', def: '', field: 'imap_host' },
  host_not_allowed: { key: 'settings.err.hostNotAllowed', def: '', field: 'imap_host' },
  duplicate_email: { key: 'settings.err.duplicate', def: '', field: 'email' },
  // 보내기(SMTP) — 저장 전 실제 로그인 검사 실패 (2026-09-21)
  gmail_smtp_auth_failed: { key: 'settings.err.gmailSmtp', def: '', preset: 'gmail', field: 'smtp_username' },
  naver_smtp_auth_failed: { key: 'settings.err.naverSmtp', def: '', preset: 'naver', field: 'smtp_username' },
  ms_smtp_auth_failed: { key: 'settings.err.msSmtp', def: '', preset: 'outlook', field: 'smtp_username' },
  smtp_auth_failed: { key: 'settings.err.smtpAuth', def: '', field: 'smtp_username' },
  smtp_host_not_found: { key: 'settings.err.smtpHost', def: '', field: 'smtp_host' },
  smtp_connect_failed: { key: 'settings.err.smtpConnect', def: '', field: 'smtp_host' },
};

// IMAP host → 안내 가이드 key (편집 모드에서도 provider 안내 표시)
export function hostToGuideKey(host?: string | null): string | null {
  const h = (host || '').toLowerCase();
  if (h.includes('gmail') || h.includes('googlemail')) return 'gmail';
  if (h.includes('naver')) return 'naver';
  if (h.includes('office365') || h.includes('outlook')) return 'outlook';
  if (h.includes('kakao')) return 'kakao';
  if (h.includes('daum')) return 'daum';
  if (h.includes('me.com') || h.includes('icloud')) return 'icloud';
  return null;
}

// 이메일 도메인 → preset 자동 감지 (입력만 하면 서버 정보 자동 완성)
export function detectPresetByEmail(email: string): string | null {
  const dom = (email.split('@')[1] || '').toLowerCase();
  if (!dom) return null;
  if (/(^|\.)gmail\.com$|(^|\.)googlemail\.com$/.test(dom)) return 'gmail';
  if (/(^|\.)naver\.com$/.test(dom)) return 'naver';
  if (/(^|\.)daum\.net$|(^|\.)hanmail\.net$/.test(dom)) return 'daum';
  if (/(^|\.)kakao\.com$/.test(dom)) return 'kakao';
  if (/(^|\.)outlook\.|(^|\.)hotmail\.|(^|\.)live\./.test(dom)) return 'outlook';
  if (/(^|\.)icloud\.com$|(^|\.)me\.com$|(^|\.)mac\.com$/.test(dom)) return 'icloud';
  return null;
}

interface ConnectGuideProps {
  guide: GuideDef;
  twoStep: TwoStepAnswer;
  onTwoStep: (v: TwoStepAnswer) => void;
  emphasize?: boolean;   // 로그인 거절 직후 — 안내 상자를 진하게
}

export const ConnectGuide: React.FC<ConnectGuideProps> = ({ guide, twoStep, onTwoStep, emphasize }) => {
  const { t } = useTranslation('qmail');
  const ts = guide.twoStep;
  return (
    <GuideBox $emph={!!emphasize} data-testid="mail-connect-guide">
      <GuideTitle>{t(guide.titleKey, guide.titleDefault)}</GuideTitle>
      {ts && (
        <TwoStepBox>
          <TwoStepQ>{t(`settings.guide.twoStep.q.${ts.provider}`) as string}</TwoStepQ>
          <TwoStepBtns role="group">
            <TwoStepBtn type="button" $on={twoStep === 'on'} aria-pressed={twoStep === 'on'}
              data-testid="mail-twostep-on" onClick={() => onTwoStep(twoStep === 'on' ? null : 'on')}>
              {t('settings.guide.twoStep.yes') as string}
            </TwoStepBtn>
            <TwoStepBtn type="button" $on={twoStep === 'off'} aria-pressed={twoStep === 'off'}
              data-testid="mail-twostep-off" onClick={() => onTwoStep(twoStep === 'off' ? null : 'off')}>
              {t('settings.guide.twoStep.no') as string}
            </TwoStepBtn>
          </TwoStepBtns>
          {twoStep === 'off' && (
            <TwoStepPanel data-testid="mail-twostep-panel">
              <GuideStep>
                <GuideNum $sub>A</GuideNum>
                <GuideStepText>{t(`settings.guide.twoStep.turnOn.${ts.provider}`) as string}</GuideStepText>
              </GuideStep>
              <GuideLink href={ts.setupUrl} target="_blank" rel="noopener noreferrer" data-testid="mail-twostep-link">
                {t('settings.guide.twoStep.openSetup') as string}
              </GuideLink>
              <GuideStep>
                <GuideNum $sub>B</GuideNum>
                <GuideStepText>{t('settings.guide.twoStep.thenContinue') as string}</GuideStepText>
              </GuideStep>
              <TwoStepNote>{t(`settings.guide.twoStep.blocked.${ts.provider}`) as string}</TwoStepNote>
            </TwoStepPanel>
          )}
        </TwoStepBox>
      )}
      <GuideSteps>
        {guide.steps.map((s, i) => (
          <GuideStep key={s.key}>
            <GuideNum>{i + 1}</GuideNum>
            <GuideStepText>{t(s.key, s.default)}</GuideStepText>
          </GuideStep>
        ))}
      </GuideSteps>
      {guide.link && (
        <GuideLink href={guide.link.url} target="_blank" rel="noopener noreferrer">
          {t(guide.link.labelKey, guide.link.labelDefault)}
        </GuideLink>
      )}
    </GuideBox>
  );
};

const GuideBox = styled.div<{ $emph: boolean }>`
  margin-top: 8px; padding: 14px 16px; background: #F0FDFA; border-radius: 10px;
  border: ${p => p.$emph ? '2px solid #14B8A6' : '1px solid #99F6E4'};
`;
const GuideTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F766E; margin-bottom: 10px;`;
const GuideSteps = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const GuideStep = styled.div`display: flex; gap: 10px; align-items: flex-start;`;
const GuideNum = styled.span<{ $sub?: boolean }>`
  flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%;
  background: ${p => p.$sub ? '#0F766E' : '#14B8A6'}; color: #fff;
  font-size: 0.6875rem; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 1px;
`;
const GuideStepText = styled.div`font-size: 0.75rem; color: #334155; line-height: 1.55;`;
const GuideLink = styled.a`display: inline-block; align-self: flex-start; margin-top: 12px; font-size: 0.75rem; font-weight: 600; color: #0F766E; text-decoration: none; padding: 7px 12px; background: #fff; border: 1px solid #14B8A6; border-radius: 8px; transition: background 0.15s; &:hover { background: #CCFBF1; }`;
const TwoStepBox = styled.div`margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px dashed #99F6E4;`;
const TwoStepQ = styled.div`font-size: 0.75rem; font-weight: 600; color: #0F172A; margin-bottom: 8px;`;
const TwoStepBtns = styled.div`display: flex; gap: 6px; flex-wrap: wrap;`;
const TwoStepBtn = styled.button<{ $on: boolean }>`
  height: 32px; padding: 0 12px; border-radius: 6px; cursor: pointer;
  font-size: 0.75rem; font-weight: 600;
  background: ${p => p.$on ? '#CCFBF1' : '#FFFFFF'};
  color: ${p => p.$on ? '#0F766E' : '#475569'};
  border: 1px solid ${p => p.$on ? '#14B8A6' : '#E2E8F0'};
  &:hover { border-color: #14B8A6; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const TwoStepPanel = styled.div`display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding: 10px 12px; background: #FFFFFF; border: 1px solid #99F6E4; border-radius: 8px; ${GuideLink} { margin-top: 0; margin-left: 28px; }`;
const TwoStepNote = styled.div`font-size: 0.6875rem; color: #64748B; line-height: 1.5;`;
