// MailAllowlistRequest — 메일 서버가 PlanQ 서버 접속에 «응답 없음» 일 때, 고객이 자기 메일 관리자에게 보낼
// «접속 허용 요청서» 를 다 써 준다 (2026-11-19, Irene «메일서버 관리자에게 우리 솔루션 열어주게 … 자동화 가능해?»).
// 설계 docs/MAIL_ALLOWLIST_REQUEST_DESIGN.md — Fable decision BUILD-NOW a·f:
//   - 상대 서버를 사람 손 없이 열 방법은 없다. 자동화는 «무엇을 요청할지 다 써 주기 + 다시 확인» 까지.
//   - PlanQ 가 대신 보내지 않는다(복사 · 메일 앱으로 열기만) — 고객 본인 주소에서 가야 관리자가 믿고, 사칭 위험이 없다.
//   - IP 는 화면에 적지 않는다 — 서버 services/mailEgress 한 곳(GET …/email-accounts/egress). 비어 있으면 아무것도 안 그린다(종전 안내만).
//   - 요청서 언어는 고를 수 있다(관리자가 다른 나라일 수 있다) — 처음 값은 화면 언어.
import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { getMailEgressIps } from '../../services/mail';
import { copyRichContent } from '../../utils/copyRich';

// 이 코드들일 때만 요청서를 낸다 — 중계(한국 IP)를 거쳐도 안 된 것(*_relay)·비밀번호 오류·거절에는 안 맞는 처방이다.
export const ALLOWLIST_CODES = ['imap_unreachable', 'smtp_unreachable'];

interface Props {
  businessId: number;
  email: string;
  imap?: { host: string; port: number } | null;
  smtp?: { host: string; port: number } | null;
  onRecheck?: () => void;
  rechecking?: boolean;
  testId?: string;
}

const MailAllowlistRequest: React.FC<Props> = ({ businessId, email, imap, smtp, onRecheck, rechecking, testId }) => {
  const { t, i18n } = useTranslation('qmail');
  const [ips, setIps] = useState<string[] | null>(null);
  const [lang, setLang] = useState<'ko' | 'en'>(i18n.language?.startsWith('ko') ? 'ko' : 'en');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getMailEgressIps(businessId).then(v => { if (alive) setIps(v); }).catch(() => { if (alive) setIps([]); });
    return () => { alive = false; };
  }, [businessId]);

  const letter = useMemo(() => {
    const lt = i18n.getFixedT(lang, 'qmail');
    const servers = [
      imap?.host ? lt('settings.allow.recv', { host: imap.host, port: imap.port }) : null,
      smtp?.host ? lt('settings.allow.send', { host: smtp.host, port: smtp.port }) : null,
    ].filter(Boolean).join(' · ');
    const vars = { email, ips: (ips || []).join(', '), servers, interpolation: { escapeValue: false } };
    return { subject: lt('settings.allow.letter.subject', vars) as string, body: lt('settings.allow.letter.body', vars) as string };
  }, [i18n, lang, imap, smtp, email, ips]);

  if (!ips || ips.length === 0) return null;

  const mailto = `mailto:?subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.body)}`;
  const onCopy = async () => {
    const ok = await copyRichContent({ text: `${letter.subject}\n\n${letter.body}` });
    if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
  };

  return (
    <Box data-testid={testId || 'mail-allowlist-request'}>
      <Title>{t('settings.allow.title') as string}</Title>
      <Why>{t('settings.allow.why') as string}</Why>
      <LangRow role="group" aria-label={t('settings.allow.lang') as string}>
        {(['ko', 'en'] as const).map(l => (
          <LangBtn key={l} type="button" $on={lang === l} aria-pressed={lang === l} onClick={() => setLang(l)}
            data-testid={`mail-allowlist-lang-${l}`}>
            {t(l === 'ko' ? 'settings.allow.langKo' : 'settings.allow.langEn') as string}
          </LangBtn>
        ))}
      </LangRow>
      {/* draft-exempt: 읽기 전용 요청서 미리보기 — 사람이 쓰는 칸이 아니다 */}
      <Letter readOnly value={`${letter.subject}\n\n${letter.body}`} data-testid="mail-allowlist-letter"
        aria-label={t('settings.allow.title') as string} rows={9} />
      <Actions>
        <Btn type="button" onClick={onCopy} data-testid="mail-allowlist-copy">
          {copied ? t('settings.allow.copied') as string : t('settings.allow.copy') as string}
        </Btn>
        <BtnLink href={mailto} data-testid="mail-allowlist-mailto">{t('settings.allow.mailto') as string}</BtnLink>
        {onRecheck && (
          <Btn type="button" $primary onClick={onRecheck} disabled={!!rechecking} data-testid="mail-allowlist-recheck">
            {rechecking ? t('settings.allow.rechecking') as string : t('settings.allow.recheck') as string}
          </Btn>
        )}
      </Actions>
      <Note>{t('settings.allow.note') as string}</Note>
    </Box>
  );
};

export default MailAllowlistRequest;

const Box = styled.div`
  margin-top: 8px; padding: 14px 16px; background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 10px;
  display: flex; flex-direction: column; gap: 8px; min-width: 0;
`;
const Title = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F766E;`;
const Why = styled.div`font-size: 0.75rem; color: #334155; line-height: 1.55;`;
const LangRow = styled.div`display: flex; gap: 6px; flex-wrap: wrap;`;
const LangBtn = styled.button<{ $on: boolean }>`
  height: 32px; padding: 0 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: 600;
  background: ${p => p.$on ? '#CCFBF1' : '#FFFFFF'}; color: ${p => p.$on ? '#0F766E' : '#475569'};
  border: 1px solid ${p => p.$on ? '#14B8A6' : '#E2E8F0'};
  &:hover { border-color: #14B8A6; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const Letter = styled.textarea`
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 160px;
  padding: 10px 12px; border: 1px solid #CBD5E1; border-radius: 8px; background: #FFFFFF;
  font-size: 0.75rem; line-height: 1.55; color: #0F172A; font-family: inherit;
`;
const Actions = styled.div`display: flex; gap: 6px; flex-wrap: wrap;`;
const btnCss = `
  height: 36px; padding: 0 14px; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-weight: 600;
  display: inline-flex; align-items: center; text-decoration: none;
`;
const Btn = styled.button<{ $primary?: boolean }>`
  ${btnCss}
  background: ${p => p.$primary ? '#14B8A6' : '#FFFFFF'}; color: ${p => p.$primary ? '#FFFFFF' : '#0F766E'};
  border: 1px solid #14B8A6;
  &:disabled { opacity: 0.6; cursor: default; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const BtnLink = styled.a`
  ${btnCss}
  background: #FFFFFF; color: #0F766E; border: 1px solid #14B8A6;
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const Note = styled.div`font-size: 0.6875rem; color: #64748B; line-height: 1.5;`;
