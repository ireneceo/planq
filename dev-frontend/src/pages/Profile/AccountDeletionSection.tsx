// 계정 삭제(회원 탈퇴) — 개인 설정 Danger Zone. ACCOUNT_DELETION_DESIGN.
//   App Store 5.1.1(v). preflight 로 차단 사유 표시, 확인 모달(이메일 타이핑+비밀번호)로 삭제 요청.
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import DetailDrawer from '../../components/Common/DetailDrawer';
import ActionButton from '../../components/Common/ActionButton';
import {
  Zone, ZoneTitle, ZoneDesc, ExportHint, ExportLink, BlockCard, BlockTitle, BlockBody, BlockWs,
  SoloHint, SoloWs, DeleteBtn, ConfirmWarn, FieldLabel, Input, ErrText,
} from '../../components/Common/dangerZoneShell';

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
      await logout({ flush: false });   // 지워진 계정으로 대기 중인 자동저장을 보내지 않는다
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

      <DetailDrawer open={open} onClose={close} ariaLabel={t('accountDeletion.confirmTitle')}>
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
