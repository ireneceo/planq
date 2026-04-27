// 이메일 발송 설정 (Phase E2/E3)
// - 발신 표시 이름 (mail_from_name)
// - 회신 주소 (mail_reply_to)
// - 시스템 SMTP 상태 안내
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { apiFetch } from '../../contexts/AuthContext';

interface Props {
  businessId: number;
  isOwner: boolean;
}

interface MailConfig {
  mail_from_name: string | null;
  mail_reply_to: string | null;
  brand_name: string | null;
  name: string | null;
  smtp_configured: boolean;
}

const EmailSettings: React.FC<Props> = ({ businessId, isOwner }) => {
  const { t } = useTranslation('settings');
  const [config, setConfig] = useState<MailConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromName, setFromName] = useState('');
  const [replyTo, setReplyTo] = useState('');

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/businesses/${businessId}/mail`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (!j.success) throw new Error(j.message || 'load_failed');
        const c: MailConfig = j.data;
        setConfig(c);
        setFromName(c.mail_from_name || '');
        setReplyTo(c.mail_reply_to || '');
        setError(null);
      })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId]);

  const save = async (patch: Partial<{ mail_from_name: string | null; mail_reply_to: string | null }>) => {
    const r = await apiFetch(`/api/businesses/${businessId}/mail`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.message || 'save_failed');
    setConfig(j.data);
  };

  if (loading) return <Loading>{t('common.loading', '불러오는 중...')}</Loading>;
  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!config) return null;

  const sampleFrom = `${fromName || config.brand_name || config.name || 'Workspace'}`;
  const fallbackFrom = config.brand_name || config.name || 'Workspace';

  return (
    <Wrap>
      {/* SMTP 상태 */}
      <Section>
        <SectionTitle>{t('email.system.title', '메일 발송 시스템')}</SectionTitle>
        <SectionDesc>{t('email.system.desc', 'PlanQ 가 시스템 메일 서버를 통해 청구서·서명 요청·문서 공유 메일을 발송합니다')}</SectionDesc>
        <StatusBox $ok={config.smtp_configured}>
          <StatusDot $ok={config.smtp_configured} />
          <StatusText>
            {config.smtp_configured
              ? t('email.system.connected', '시스템 메일 서버 연결됨 — 메일이 정상 발송됩니다')
              : t('email.system.disconnected', '시스템 메일 서버 미연결 — 운영자가 SMTP 설정을 완료할 때까지 메일은 발송되지 않습니다')}
          </StatusText>
        </StatusBox>
      </Section>

      {/* 발신 표시이름 + 회신 주소 */}
      <Section>
        <SectionTitle>{t('email.identity.title', '발신 정보')}</SectionTitle>
        <SectionDesc>{t('email.identity.desc', '고객이 받는 메일의 발신자 이름과 회신 주소를 정합니다')}</SectionDesc>

        <Field>
          <Label>{t('email.identity.fromName', '발신 표시이름')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ mail_from_name: fromName.trim() || null })}>
            <Input
              type="text"
              value={fromName}
              onChange={e => setFromName(e.target.value)}
              placeholder={fallbackFrom}
              maxLength={100}
              disabled={!isOwner}
            />
          </AutoSaveField>
          <Hint>{t('email.identity.fromNameHint', '비워두면 워크스페이스 브랜드명이 사용됩니다')}</Hint>
          <Preview>
            <PreviewLabel>{t('email.identity.preview', '미리보기')}</PreviewLabel>
            <PreviewBox>
              <PreviewFrom>"{sampleFrom}" &lt;{config.smtp_configured ? 'noreply@planq.kr' : 'noreply@planq.kr'}&gt;</PreviewFrom>
              <PreviewSubject>[PlanQ] 청구서 — INV-2026-0001</PreviewSubject>
            </PreviewBox>
          </Preview>
        </Field>

        <Field>
          <Label>{t('email.identity.replyTo', '회신 주소 (선택)')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ mail_reply_to: replyTo.trim() || null })}>
            <Input
              type="email"
              value={replyTo}
              onChange={e => setReplyTo(e.target.value)}
              placeholder="billing@yourcompany.com"
              maxLength={200}
              disabled={!isOwner}
            />
          </AutoSaveField>
          <Hint>{t('email.identity.replyToHint', '고객이 답장하면 이 주소로 회신이 옵니다. 비워두면 답장 불가.')}</Hint>
        </Field>
      </Section>

      {/* 향후 기능 placeholder */}
      <Section>
        <SectionTitle>{t('email.future.title', '본인 메일 직접 발송')}</SectionTitle>
        <SectionDesc>{t('email.future.desc', 'Gmail / 회사 SMTP 로 직접 발송하는 기능')}</SectionDesc>
        <PreparingBox>
          <PreparingTitle>{t('email.future.preparingTitle', '준비 중')}</PreparingTitle>
          <PreparingDesc>{t('email.future.preparingDesc', '본인 Gmail 또는 회사 SMTP 계정 연결로 직접 발송하는 기능은 곧 추가됩니다.')}</PreparingDesc>
        </PreparingBox>
      </Section>
    </Wrap>
  );
};

export default EmailSettings;

// ─── styled ───
const Wrap = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const Loading = styled.div`text-align: center; padding: 40px; color: #94A3B8; font-size: 13px;`;
const ErrorBanner = styled.div`padding: 10px 14px; background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; border-radius: 8px; font-size: 12px;`;
const Section = styled.section`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px 20px;
  display: flex; flex-direction: column; gap: 10px;
`;
const SectionTitle = styled.h3`font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;`;
const SectionDesc = styled.div`font-size: 12px; color: #64748B;`;
const StatusBox = styled.div<{ $ok: boolean }>`
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-radius: 10px;
  background: ${p => p.$ok ? '#F0FDF4' : '#FFFBEB'};
  border: 1px solid ${p => p.$ok ? '#86EFAC' : '#FCD34D'};
`;
const StatusDot = styled.div<{ $ok: boolean }>`
  width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
  background: ${p => p.$ok ? '#22C55E' : '#F59E0B'};
`;
const StatusText = styled.div`font-size: 13px; color: #334155; line-height: 1.5;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px; padding-top: 6px;`;
const Label = styled.label`font-size: 12px; font-weight: 600; color: #475569;`;
const Input = styled.input`
  padding: 9px 12px; font-size: 13px; color: #0F172A;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  &:disabled { background: #F8FAFC; color: #94A3B8; cursor: not-allowed; }
`;
const Hint = styled.div`font-size: 11px; color: #94A3B8;`;
const Preview = styled.div`display: flex; flex-direction: column; gap: 4px; margin-top: 4px;`;
const PreviewLabel = styled.div`font-size: 10px; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.4px;`;
const PreviewBox = styled.div`background: #F8FAFC; border-radius: 8px; padding: 10px 12px; font-family: ui-monospace, monospace;`;
const PreviewFrom = styled.div`font-size: 11px; color: #475569;`;
const PreviewSubject = styled.div`font-size: 12px; color: #0F172A; margin-top: 2px;`;
const PreparingBox = styled.div`
  background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 10px; padding: 14px 16px;
`;
const PreparingTitle = styled.div`font-size: 13px; font-weight: 700; color: #334155;`;
const PreparingDesc = styled.div`font-size: 12px; color: #64748B; margin-top: 4px; line-height: 1.5;`;
