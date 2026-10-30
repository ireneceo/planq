// 메일 상세 «사칭 의심» 안내 줄 — 신호별 «왜» + (관리자) 관계사 도메인을 «안전한 도메인» 으로 등록.
//   설계: docs/MAIL_IMPERSONATION_DESIGN.md §3 · §10 (Fable 2026-10-27).
//   등록 버튼은 서버가 고른 후보(trust_candidate — 경고 스레드의 From 유사 도메인)가 있을 때만. 격리본에는 없다(먼저 [스팸 아님]).
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { trustMailDomain } from '../../services/mail';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { ImpersonationNote } from './MailPage.styles';
import type { Thread } from './mailTypes';

interface Props {
  thread: Thread;
  businessId: number;
  onChanged: () => void;
}

const MailImpersonationNote: React.FC<Props> = ({ thread, businessId, onChanged }) => {
  const { t } = useTranslation('qmail');
  const { user } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imp = thread.impersonation;
  if (!imp) return null;
  const canManage = user?.business_role === 'owner' || user?.business_role === 'admin' || user?.platform_role === 'platform_admin';
  const cand = imp.trust_candidate || null;
  const quarantined = thread.status === 'spam' && thread.spam_origin === 'impersonation';

  const register = async () => {
    setBusy(true);
    setError(null);
    try {
      await trustMailDomain(businessId, thread.id);
      setConfirmOpen(false);
      onChanged();
    } catch {
      setError(t('impersonation.trust.failed') as string);
    } finally { setBusy(false); }
  };

  return (
    <ImpersonationNote role="note" data-testid="mail-impersonation-note">
      <strong>
        {t(quarantined ? 'impersonation.noteQuarantined' : imp.released
          ? 'impersonation.noteReleased' : 'impersonation.noteWarn') as string}
      </strong>
      <ul>
        {[...new Set((imp.signals || []).map((sg) => sg.code))].map((code) => (
          <li key={code}>{t(`impersonation.signal.${code}`) as string}</li>
        ))}
      </ul>
      {imp.known && <span>{t('impersonation.knownHint') as string} </span>}
      <a href="/guide/a/qmail-spam-impersonation" target="_blank" rel="noopener noreferrer">
        {t('impersonation.learnMore') as string}
      </a>
      {cand && canManage && (
        <TrustRow>
          <span>{t('impersonation.trust.hint', { domain: cand.domain }) as string}</span>
          <TrustButton type="button" data-testid="mail-impersonation-trust" disabled={busy} onClick={() => setConfirmOpen(true)}>
            {t('impersonation.trust.button') as string}
          </TrustButton>
        </TrustRow>
      )}
      {error && <TrustError role="alert">{error}</TrustError>}
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={register}
        variant="warning"
        title={t('impersonation.trust.confirmTitle') as string}
        message={cand ? t('impersonation.trust.confirmMessage', { domain: cand.domain, like: cand.like }) as string : ''}
        confirmText={t('impersonation.trust.confirm') as string}
      />
    </ImpersonationNote>
  );
};

export default MailImpersonationNote;

const TrustRow = styled.div`
  margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  span { flex: 1 1 200px; min-width: 0; }
`;
const TrustButton = styled.button`
  min-height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid #FCA5A5;
  background: #FFFFFF; color: #991B1B; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #FEE2E2; }
  &:disabled { opacity: 0.6; cursor: default; }
`;
const TrustError = styled.div`
  margin-top: 6px; font-size: 0.75rem; color: #B91C1C;
`;
