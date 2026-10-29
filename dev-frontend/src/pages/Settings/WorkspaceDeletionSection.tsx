// 워크스페이스 삭제 — 설정 일반(브랜드) 탭 맨 아래 Danger Zone. docs/WORKSPACE_DELETION_DESIGN.md
//   대표(owner)만 보인다 — 서버 preflight 가 403 이면 아무것도 그리지 않는다(화면 판정을 믿지 않는다).
//   확인 = 워크스페이스 이름 그대로 + 비밀번호(서버가 다시 본다). 30일 안에는 «내 프로필 → 삭제 예정 워크스페이스» 에서 되살린다.
//   껍데기는 계정 탈퇴와 같은 것(dangerZoneShell + DetailDrawer).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import DetailDrawer from '../../components/Common/DetailDrawer';
import ActionButton from '../../components/Common/ActionButton';
import { clearPageCache } from '../../lib/pageCache';
import {
  Zone, ZoneTitle, ZoneDesc, BlockCard, BlockTitle, BlockBody, DeleteBtn, ConfirmWarn, FieldLabel, Input, ErrText,
} from '../../components/Common/dangerZoneShell';

interface Summary {
  members: number;
  clients: number;
  unpaid_invoices: number;
  unpaid_by_currency: Record<string, number>;
  subscription_days_left: number;
}
interface Preflight { name: string; grace_days: number; oauth_only: boolean; summary: Summary }

const norm = (s: string) => s.normalize('NFC').trim();

const WorkspaceDeletionSection: React.FC<{ businessId: number }> = ({ businessId }) => {
  const { t, i18n } = useTranslation('settings');
  const [pf, setPf] = useState<Preflight | null>(null);
  const [open, setOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/businesses/${businessId}/deletion-preflight`);
      if (!res.ok) { setPf(null); return; }
      const j = await res.json();
      setPf(j?.data || null);
    } catch { setPf(null); }
  }, [businessId]);
  useEffect(() => { void load(); }, [load]);

  const canSubmit = !!pf && norm(nameInput) === norm(pf.name) && password.length > 0 && !submitting;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/businesses/${businessId}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirm_name: nameInput }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (res.status === 403 && j?.message === 'invalid_password') setError(t('wsDeletion.errWrongPassword'));
        else if (j?.code === 'name_mismatch') setError(t('wsDeletion.errName'));
        else if (j?.code === 'oauth_otp_required') setError(t('wsDeletion.errOauth'));
        else setError(t('wsDeletion.errGeneric'));
        setSubmitting(false);
        return;
      }
      // 서버가 정본(active_business_id)을 비웠다 — 다시 부팅하면 남은 워크스페이스로 착지한다.
      clearPageCache();
      window.location.href = '/talk';
    } catch {
      setError(t('wsDeletion.errGeneric'));
      setSubmitting(false);
    }
  }, [canSubmit, businessId, password, nameInput, t]);

  const close = () => { if (!submitting) { setOpen(false); setNameInput(''); setPassword(''); setError(null); } };

  if (!pf) return null;
  const s = pf.summary;
  const money = Object.entries(s.unpaid_by_currency || {})
    .map(([cur, amt]) => {
      try { return new Intl.NumberFormat(i18n.language, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(amt); }
      catch { return `${amt} ${cur}`; }
    })
    .join(' · ');
  const lossLines = [
    s.members > 0 ? t('wsDeletion.lossMembers', { count: s.members }) : null,
    s.clients > 0 ? t('wsDeletion.lossClients', { count: s.clients }) : null,
    s.unpaid_invoices > 0 ? t('wsDeletion.lossUnpaid', { count: s.unpaid_invoices, amount: money }) : null,
    s.subscription_days_left > 0 ? t('wsDeletion.lossSubscription', { days: s.subscription_days_left }) : null,
  ].filter(Boolean) as string[];

  return (
    <Zone data-testid="ws-delete-zone">
      <ZoneTitle>{t('wsDeletion.title')}</ZoneTitle>
      <ZoneDesc>{t('wsDeletion.desc', { days: pf.grace_days })}</ZoneDesc>

      {pf.oauth_only && (
        <BlockCard>
          <BlockTitle>{t('wsDeletion.oauthTitle')}</BlockTitle>
          <BlockBody>{t('wsDeletion.oauthBody')}</BlockBody>
        </BlockCard>
      )}

      <DeleteBtn type="button" data-testid="ws-delete-open" disabled={pf.oauth_only} onClick={() => setOpen(true)}>
        {t('wsDeletion.deleteButton')}
      </DeleteBtn>

      <DetailDrawer open={open} onClose={close} ariaLabel={t('wsDeletion.confirmTitle')}>
        <DetailDrawer.Header onClose={close}>{t('wsDeletion.confirmTitle')}</DetailDrawer.Header>
        <DetailDrawer.Body>
          <ConfirmWarn>{t('wsDeletion.confirmWarn', { name: pf.name, days: pf.grace_days })}</ConfirmWarn>
          {lossLines.length > 0 && (
            <Loss data-testid="ws-delete-loss">
              <LossTitle>{t('wsDeletion.lossTitle')}</LossTitle>
              {lossLines.map((l) => <LossLine key={l}>· {l}</LossLine>)}
            </Loss>
          )}
          <Kept>{t('wsDeletion.kept')}</Kept>
          {s.subscription_days_left > 0 && <Kept>{t('wsDeletion.refundNote')}</Kept>}
          <FieldLabel htmlFor="ws-delete-name">{t('wsDeletion.typeName', { name: pf.name })}</FieldLabel>
          <Input
            id="ws-delete-name"
            data-testid="ws-delete-name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder={pf.name}
            autoComplete="off"
          />
          <FieldLabel htmlFor="ws-delete-password">{t('wsDeletion.password')}</FieldLabel>
          <Input
            id="ws-delete-password"
            data-testid="ws-delete-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {error && <ErrText role="alert">{error}</ErrText>}
        </DetailDrawer.Body>
        <DetailDrawer.Footer>
          <ActionButton tone="secondary" onClick={close} disabled={submitting}>
            {t('wsDeletion.cancel')}
          </ActionButton>
          <ActionButton tone="danger" data-testid="ws-delete-submit" onClick={submit} disabled={!canSubmit} loading={submitting}>
            {t('wsDeletion.confirmDelete')}
          </ActionButton>
        </DetailDrawer.Footer>
      </DetailDrawer>
    </Zone>
  );
};

export default WorkspaceDeletionSection;

const Loss = styled.div`
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;
  padding: 10px 14px; margin-bottom: 12px; font-size: 0.78125rem; color: #92400e; line-height: 1.5;
`;
const LossTitle = styled.div`font-weight: 700; margin-bottom: 2px;`;
const LossLine = styled.div`margin-top: 2px;`;
const Kept = styled.p`font-size: 0.78125rem; color: #475569; margin: 0 0 12px; line-height: 1.5;`;
