// 이메일 변경 모달 — 2 step (새 이메일 입력 → OTP 확인)
// API: POST /api/users/:id/email-change-request → /api/users/:id/email-change-verify

import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { XIcon } from '../../components/Common/Icons';

interface Props {
  open: boolean;
  userId: number | string;
  currentEmail: string;
  onClose: () => void;
  onChanged: (newEmail: string) => void;
}

type Step = 'enter-email' | 'enter-code';

export default function EmailChangeModal({ open, userId, currentEmail, onClose, onChanged }: Props) {
  const { t } = useTranslation('profile');
  const [step, setStep] = useState<Step>('enter-email');
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useBodyScrollLock(open);
  useEscapeStack(open, onClose);
  useFocusTrap(ref, open);

  useEffect(() => {
    if (open) {
      setStep('enter-email');
      setNewEmail('');
      setCode('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const sendCode = async () => {
    if (submitting) return;
    setError(null);
    const email = newEmail.trim().toLowerCase();
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_RE.test(email)) { setError(t('emailChange.errors.invalidEmail')); return; }
    if (email === currentEmail.toLowerCase()) { setError(t('emailChange.errors.sameAsCurrent')); return; }
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/users/${userId}/email-change-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_email: email }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const code = data.message || 'unknown';
        if (code === 'email_already_used') setError(t('emailChange.errors.emailTaken'));
        else if (code === 'same_as_current') setError(t('emailChange.errors.sameAsCurrent'));
        else if (code === 'invalid_email_format') setError(t('emailChange.errors.invalidEmail'));
        else if (code === 'locked') setError(t('emailChange.errors.locked'));
        else setError(t('emailChange.errors.unknown'));
        setSubmitting(false);
        return;
      }
      setStep('enter-code');
      setSubmitting(false);
    } catch {
      setError(t('emailChange.errors.unknown'));
      setSubmitting(false);
    }
  };

  const verify = async () => {
    if (submitting) return;
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) { setError(t('emailChange.errors.invalidCode')); return; }
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/users/${userId}/email-change-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const msg = data.message || 'unknown';
        if (msg === 'invalid_code') setError(t('emailChange.errors.invalidCode'));
        else if (msg === 'otp_expired') setError(t('emailChange.errors.expired'));
        else if (msg === 'locked') setError(t('emailChange.errors.locked'));
        else if (msg === 'email_already_used') setError(t('emailChange.errors.emailTaken'));
        else setError(t('emailChange.errors.unknown'));
        setSubmitting(false);
        return;
      }
      onChanged(data.data.email);
      onClose();
    } catch {
      setError(t('emailChange.errors.unknown'));
      setSubmitting(false);
    }
  };

  return (
    <Backdrop onClick={onClose}>
      <Dialog ref={ref} role="dialog" aria-modal="true" aria-label={t('emailChange.title') || 'Change email'}
        onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <Title>{t('emailChange.title')}</Title>
          <CloseBtn type="button" onClick={onClose} aria-label="close"><XIcon size={16} /></CloseBtn>
        </ModalHeader>

        {step === 'enter-email' && (
          <Body>
            <StepLabel>{t('emailChange.step1Title')}</StepLabel>
            <Description>{t('emailChange.step1Desc')}</Description>
            <Field>
              <FieldLabel>{t('basic.email')}</FieldLabel>
              <ReadOnly>{currentEmail}</ReadOnly>
            </Field>
            <Field>
              <FieldLabel>{t('emailChange.step1Title')}</FieldLabel>
              <Input
                type="email"
                placeholder={t('emailChange.newEmailPlaceholder') || ''}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendCode(); }}
                autoFocus
              />
            </Field>
            {error && <ErrorBox>{error}</ErrorBox>}
            <Footer>
              <SecondaryBtn type="button" onClick={onClose}>{t('emailChange.cancel')}</SecondaryBtn>
              <PrimaryBtn type="button" onClick={sendCode} disabled={submitting}>
                {submitting ? t('emailChange.sending') : t('emailChange.sendCodeBtn')}
              </PrimaryBtn>
            </Footer>
          </Body>
        )}

        {step === 'enter-code' && (
          <Body>
            <StepLabel>{t('emailChange.step2Title')}</StepLabel>
            <Description>{t('emailChange.step2Desc', { email: newEmail })}</Description>
            <Field>
              <FieldLabel>{t('emailChange.codePlaceholder')}</FieldLabel>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) verify(); }}
                autoFocus
                style={{ textAlign: 'center', letterSpacing: 6, fontFamily: 'monospace', fontSize: 18 }}
              />
            </Field>
            {error && <ErrorBox>{error}</ErrorBox>}
            <Footer>
              <SecondaryBtn type="button" onClick={() => { setStep('enter-email'); setError(null); }}>
                {t('emailChange.back')}
              </SecondaryBtn>
              <PrimaryBtn type="button" onClick={verify} disabled={submitting || code.length !== 6}>
                {submitting ? t('emailChange.verifying') : t('emailChange.verifyBtn')}
              </PrimaryBtn>
            </Footer>
          </Body>
        )}
      </Dialog>
    </Backdrop>
  );
}

const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1200; padding: 16px;
`;
const Dialog = styled.div`
  background: #FFFFFF; border-radius: 14px; width: min(440px, 100%);
  max-height: 90vh; overflow: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
`;
const ModalHeader = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #E2E8F0;
`;
const Title = styled.h2`
  margin: 0; font-size: 16px; font-weight: 700; color: #0F172A;
`;
const CloseBtn = styled.button`
  background: transparent; border: none; cursor: pointer; color: #64748B;
  padding: 4px; border-radius: 6px;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`padding: 20px;`;
const StepLabel = styled.div`
  font-size: 11px; font-weight: 700; color: #64748B; letter-spacing: 0.5px;
  text-transform: uppercase; margin-bottom: 6px;
`;
const Description = styled.p`
  margin: 0 0 16px; font-size: 13px; color: #475569; line-height: 1.6;
`;
const Field = styled.div`margin-bottom: 14px;`;
const FieldLabel = styled.div`
  font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;
`;
const ReadOnly = styled.div`
  padding: 10px 12px; background: #F8FAFC; border: 1px solid #E2E8F0;
  border-radius: 8px; font-size: 14px; color: #0F172A;
`;
const Input = styled.input`
  width: 100%; padding: 10px 12px; border: 1px solid #E2E8F0;
  border-radius: 8px; font-size: 14px; color: #0F172A;
  outline: none; transition: border-color 120ms;
  &:focus { border-color: #14B8A6; }
`;
const ErrorBox = styled.div`
  padding: 10px 12px; background: #FEF2F2; border: 1px solid #FECACA;
  border-radius: 8px; color: #B91C1C; font-size: 12px; margin-bottom: 14px;
`;
const Footer = styled.div`
  display: flex; justify-content: flex-end; gap: 8px;
  padding-top: 8px; border-top: 1px solid #F1F5F9;
`;
const PrimaryBtn = styled.button`
  padding: 9px 16px; background: #0D9488; color: #FFFFFF; border: none;
  border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #94A3B8; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 9px 16px; background: #FFFFFF; color: #334155;
  border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover { background: #F8FAFC; border-color: #94A3B8; }
`;
