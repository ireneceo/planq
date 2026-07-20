// 계정 삭제(회원 탈퇴) — 개인 설정 Danger Zone. ACCOUNT_DELETION_DESIGN.
//   App Store 5.1.1(v). preflight 로 차단 사유 표시, 확인 모달(이메일 타이핑+비밀번호)로 삭제 요청.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import DetailDrawer from '../../components/Common/DetailDrawer';
import ActionButton from '../../components/Common/ActionButton';

interface Blocker { code: string; businesses?: { id: number; name: string }[] }
interface Preflight {
  can_delete: boolean;
  blockers: Blocker[];
  warnings: { code: string; count: number }[];
  solo_workspaces_to_delete: { id: number; name: string }[];
  data_summary: { private_files: number; external_connections: number; email_accounts: number };
  grace_days: number;
}

const AccountDeletionSection: React.FC = () => {
  const { t } = useTranslation('profile');
  const { user, logout } = useAuth();
  const [pf, setPf] = useState<Preflight | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/users/me/deletion-preflight');
      if (!res.ok) { setPf(null); return; }
      const j = await res.json();
      setPf(j?.data || null);
    } catch { setPf(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const emailMatches = !!user?.email && emailInput.trim().toLowerCase() === user.email.toLowerCase();
  const canSubmit = emailMatches && password.length > 0 && !submitting;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/api/users/me/deletion-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (res.status === 403) setError(t('accountDeletion.errWrongPassword'));
        else if (j?.code === 'deletion_blocked') setError(t('accountDeletion.errBlocked'));
        else if (j?.message?.includes('oauth_otp')) setError(t('accountDeletion.errOauth'));
        else setError(t('accountDeletion.errGeneric'));
        setSubmitting(false);
        return;
      }
      // 성공 — 유예 진입. 로그아웃 후 안내(로그인 시 복구 가능).
      await logout();
      window.location.href = '/login?deleted=1';
    } catch {
      setError(t('accountDeletion.errGeneric'));
      setSubmitting(false);
    }
  }, [canSubmit, password, logout, t]);

  const close = () => { if (!submitting) { setOpen(false); setEmailInput(''); setPassword(''); setError(null); } };

  if (loading) return null;

  const transferBlocker = pf?.blockers.find((b) => b.code === 'transfer_required');
  const adminBlocker = pf?.blockers.find((b) => b.code === 'last_platform_admin');

  return (
    <Zone>
      <ZoneTitle>{t('accountDeletion.title')}</ZoneTitle>
      <ZoneDesc>{t('accountDeletion.desc', { days: pf?.grace_days ?? 30 })}</ZoneDesc>

      {/* 반출 안내 (강제 아님) */}
      <ExportHint>
        {t('accountDeletion.exportHint')}{' '}
        <ExportLink href="/business/settings/data-export">{t('accountDeletion.exportLink')}</ExportLink>
      </ExportHint>

      {transferBlocker && (
        <BlockCard>
          <BlockTitle>{t('accountDeletion.blockTransferTitle')}</BlockTitle>
          <BlockBody>{t('accountDeletion.blockTransferBody')}</BlockBody>
          {transferBlocker.businesses?.map((b) => (
            <BlockWs key={b.id}>· {b.name}</BlockWs>
          ))}
        </BlockCard>
      )}
      {adminBlocker && (
        <BlockCard>
          <BlockTitle>{t('accountDeletion.blockAdminTitle')}</BlockTitle>
          <BlockBody>{t('accountDeletion.blockAdminBody')}</BlockBody>
        </BlockCard>
      )}

      {pf?.can_delete && pf.solo_workspaces_to_delete.length > 0 && (
        <SoloHint>
          {t('accountDeletion.soloWarn')}
          {pf.solo_workspaces_to_delete.map((w) => <SoloWs key={w.id}>· {w.name}</SoloWs>)}
        </SoloHint>
      )}

      <DeleteBtn
        type="button"
        disabled={!pf?.can_delete}
        onClick={() => setOpen(true)}
        title={pf?.can_delete ? '' : t('accountDeletion.blockedTooltip')}
      >
        {t('accountDeletion.deleteButton')}
      </DeleteBtn>

      <DetailDrawer open={open} onClose={close} width={460} ariaLabel={t('accountDeletion.confirmTitle')}>
        <DetailDrawer.Header onClose={close}>{t('accountDeletion.confirmTitle')}</DetailDrawer.Header>
        <DetailDrawer.Body>
          <ConfirmWarn>{t('accountDeletion.confirmWarn', { days: pf?.grace_days ?? 30 })}</ConfirmWarn>
          <FieldLabel>{t('accountDeletion.typeEmail', { email: user?.email || '' })}</FieldLabel>
          <Input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder={user?.email || ''}
            autoComplete="off"
          />
          <FieldLabel>{t('accountDeletion.password')}</FieldLabel>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {error && <ErrText>{error}</ErrText>}
        </DetailDrawer.Body>
        <DetailDrawer.Footer>
          <ActionButton tone="secondary" onClick={close} disabled={submitting}>
            {t('accountDeletion.cancel')}
          </ActionButton>
          <ActionButton tone="danger" onClick={submit} disabled={!canSubmit} loading={submitting}>
            {t('accountDeletion.confirmDelete')}
          </ActionButton>
        </DetailDrawer.Footer>
      </DetailDrawer>
    </Zone>
  );
};

export default AccountDeletionSection;

// ─── Styled ───
const Zone = styled.div`
  grid-column: 1 / -1;
  margin-top: 8px;
  padding: 20px;
  border: 1px solid #fecaca;
  border-radius: 12px;
  background: #fff;
`;
const ZoneTitle = styled.h3`font-size: 15px; font-weight: 700; color: #b91c1c; margin: 0 0 6px;`;
const ZoneDesc = styled.p`font-size: 13px; color: #64748b; margin: 0 0 12px; line-height: 1.5;`;
const ExportHint = styled.p`font-size: 12.5px; color: #475569; margin: 0 0 14px;`;
const ExportLink = styled.a`color: #0f766e; font-weight: 600; text-decoration: none; &:hover { text-decoration: underline; }`;
const BlockCard = styled.div`
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
  padding: 12px 14px; margin-bottom: 12px;
`;
const BlockTitle = styled.div`font-size: 13px; font-weight: 700; color: #b91c1c; margin-bottom: 4px;`;
const BlockBody = styled.div`font-size: 12.5px; color: #7f1d1d; line-height: 1.5;`;
const BlockWs = styled.div`font-size: 12.5px; color: #7f1d1d; margin-top: 2px;`;
const SoloHint = styled.div`
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;
  padding: 10px 14px; margin-bottom: 12px; font-size: 12.5px; color: #92400e; line-height: 1.5;
`;
const SoloWs = styled.div`margin-top: 2px;`;
const DeleteBtn = styled.button`
  height: 40px; padding: 0 18px; border-radius: 8px;
  border: 1px solid #ef4444; background: #fff; color: #dc2626;
  font-size: 13.5px; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #fef2f2; }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
`;
const ConfirmWarn = styled.p`
  font-size: 13px; color: #7f1d1d; background: #fef2f2; border: 1px solid #fecaca;
  border-radius: 8px; padding: 12px 14px; margin: 0 0 16px; line-height: 1.5;
`;
const FieldLabel = styled.label`display: block; font-size: 12.5px; font-weight: 600; color: #334155; margin: 0 0 6px;`;
const Input = styled.input`
  width: 100%; height: 40px; padding: 0 12px; margin-bottom: 16px;
  border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px;
  &:focus { outline: none; border-color: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,0.12); }
`;
const ErrText = styled.p`font-size: 12.5px; color: #dc2626; margin: -6px 0 8px;`;
