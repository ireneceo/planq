// EmailAccountSettings — Q Mail M1 사용자 등록 UI
// 워크스페이스 설정 → 메일 계정. admin 전용.
// PageShell + 계정 목록 + 등록/수정 모달 (DetailDrawer) + 서비스 preset + 연결 테스트.
import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import DetailDrawer from '../../components/Common/DetailDrawer';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { useAuth } from '../../contexts/AuthContext';
import {
  listEmailAccounts, createEmailAccount, updateEmailAccount, deleteEmailAccount,
  testEmailAccount, setDefaultEmailAccount, syncNowEmailAccount,
  MAIL_PRESETS,
  type EmailAccountRow, type EmailAccountInput,
} from '../../services/mail';

const EmailAccountSettings: React.FC = () => {
  const { t } = useTranslation('qmail');
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;

  const [accounts, setAccounts] = useState<EmailAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EmailAccountRow | 'new' | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<Record<number, { ok: boolean; error: string | null }>>({});

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const rows = await listEmailAccounts(businessId);
      setAccounts(rows);
    } catch (_) { /* skip */ } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  if (!businessId) {
    return (
      <PageShell title={t('settings.title', 'Q Mail 계정') as string}>
        <Empty>{t('settings.noWorkspace', '워크스페이스를 먼저 선택하세요') as string}</Empty>
      </PageShell>
    );
  }

  const handleTest = async (id: number) => {
    setTestingId(id);
    try {
      const r = await testEmailAccount(businessId, id);
      setTestResult(prev => ({ ...prev, [id]: r }));
    } catch (e) {
      setTestResult(prev => ({ ...prev, [id]: { ok: false, error: (e as Error).message } }));
    } finally {
      setTestingId(null);
    }
  };

  const handleSetDefault = async (id: number) => {
    try {
      await setDefaultEmailAccount(businessId, id);
      await load();
    } catch (_) { /* skip */ }
  };

  const handleSyncNow = async (id: number) => {
    try {
      await syncNowEmailAccount(businessId, id);
      await load();
    } catch (_) { /* skip */ }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteEmailAccount(businessId, id);
      await load();
      setDeletingId(null);
    } catch (_) { /* skip */ }
  };

  const formatLastSync = (iso: string | null): string => {
    if (!iso) return t('settings.neverSynced', '아직 sync 안 됨') as string;
    const d = new Date(iso);
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return t('settings.justNow', '방금') as string;
    if (mins < 60) return t('settings.minutesAgo', '{{n}}분 전', { n: mins }) as string;
    if (mins < 1440) return t('settings.hoursAgo', '{{n}}시간 전', { n: Math.floor(mins / 60) }) as string;
    return d.toLocaleDateString();
  };

  return (
    <PageShell
      title={t('settings.title', 'Q Mail 계정') as string}
      actions={<AddBtn type="button" onClick={() => setEditing('new')}>+ {t('settings.add', '계정 추가') as string}</AddBtn>}
    >
      <Hint>{t('settings.hint', '회사 메일 계정을 등록하면 PlanQ 인박스에서 메일을 받고 답장할 수 있어요. (5분마다 자동 동기화)') as string}</Hint>

      {loading ? (
        <Loading>{t('settings.loading', '로드 중...') as string}</Loading>
      ) : accounts.length === 0 ? (
        <EmptyCard>
          <EmptyIcon>📬</EmptyIcon>
          <EmptyTitle>{t('settings.emptyTitle', '등록된 메일 계정이 없어요') as string}</EmptyTitle>
          <EmptyDesc>{t('settings.emptyDesc', 'Gmail · Outlook · 회사 메일 등 IMAP/SMTP 지원 계정을 등록하세요') as string}</EmptyDesc>
          <PrimaryBtn type="button" onClick={() => setEditing('new')}>{t('settings.addFirst', '첫 계정 등록') as string}</PrimaryBtn>
        </EmptyCard>
      ) : (
        <AccountList>
          {accounts.map(acc => (
            <AccountCard key={acc.id}>
              <CardHeader>
                <EmailInfo>
                  <EmailRow>
                    <Email>{acc.email}</Email>
                    {acc.is_default && <DefaultBadge>{t('settings.default', '기본') as string}</DefaultBadge>}
                    {!acc.is_active && <InactiveBadge>{t('settings.inactive', '비활성') as string}</InactiveBadge>}
                  </EmailRow>
                  {acc.display_name && <DisplayName>{acc.display_name}</DisplayName>}
                  <MetaRow>
                    <MetaItem>IMAP: {acc.imap_host}:{acc.imap_port}</MetaItem>
                    <MetaItem>•</MetaItem>
                    <MetaItem>{t('settings.lastSync', '마지막 동기화') as string}: {formatLastSync(acc.last_sync_at)}</MetaItem>
                    {acc.fail_count > 0 && <ErrorBadge>{t('settings.failCount', '{{n}}회 실패', { n: acc.fail_count }) as string}</ErrorBadge>}
                  </MetaRow>
                  {acc.last_sync_error && <ErrorMsg>⚠️ {acc.last_sync_error}</ErrorMsg>}
                  {testResult[acc.id] && (
                    testResult[acc.id].ok ? (
                      <TestSuccess>✓ {t('settings.testOk', '연결 성공') as string}</TestSuccess>
                    ) : (
                      <TestError>✗ {testResult[acc.id].error || t('settings.testFail', '연결 실패') as string}</TestError>
                    )
                  )}
                </EmailInfo>
                <CardActions>
                  <ActionBtn type="button" onClick={() => handleTest(acc.id)} disabled={testingId === acc.id}>
                    {testingId === acc.id ? t('settings.testing', '테스트 중...') as string : t('settings.test', '연결 테스트') as string}
                  </ActionBtn>
                  {!acc.is_default && (
                    <ActionBtn type="button" onClick={() => handleSetDefault(acc.id)}>
                      {t('settings.setDefault', '기본으로') as string}
                    </ActionBtn>
                  )}
                  <ActionBtn type="button" onClick={() => handleSyncNow(acc.id)}>
                    {t('settings.syncNow', '지금 동기화') as string}
                  </ActionBtn>
                  <ActionBtn type="button" onClick={() => setEditing(acc)}>
                    {t('settings.edit', '편집') as string}
                  </ActionBtn>
                  <DangerActionBtn type="button" onClick={() => setDeletingId(acc.id)}>
                    {t('settings.deactivate', '비활성화') as string}
                  </DangerActionBtn>
                </CardActions>
              </CardHeader>
            </AccountCard>
          ))}
        </AccountList>
      )}

      {/* 등록/편집 모달 */}
      <DetailDrawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        width={560}
        ariaLabel={editing === 'new' ? '메일 계정 등록' : '메일 계정 편집'}
      >
        {editing !== null && (
          <AccountEditForm
            initial={editing === 'new' ? null : editing}
            businessId={businessId}
            onSaved={async () => { setEditing(null); await load(); }}
            onClose={() => setEditing(null)}
          />
        )}
      </DetailDrawer>

      {/* 삭제 확인 */}
      {deletingId !== null && (
        <ConfirmBackdrop onClick={() => setDeletingId(null)}>
          <ConfirmCard onClick={e => e.stopPropagation()}>
            <ConfirmTitle>{t('settings.confirmDeactivate', '계정을 비활성화할까요?') as string}</ConfirmTitle>
            <ConfirmDesc>{t('settings.confirmDeactivateDesc', '메일 동기화가 중단되지만 기존 메일은 보존됩니다.') as string}</ConfirmDesc>
            <ConfirmActions>
              <ActionBtn type="button" onClick={() => setDeletingId(null)}>{t('settings.cancel', '취소') as string}</ActionBtn>
              <DangerBtn type="button" onClick={() => handleDelete(deletingId)}>{t('settings.deactivate', '비활성화') as string}</DangerBtn>
            </ConfirmActions>
          </ConfirmCard>
        </ConfirmBackdrop>
      )}
    </PageShell>
  );
};

// ─── 등록/편집 form ─────────────────────────────
interface FormProps {
  initial: EmailAccountRow | null;
  businessId: number;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}

const AccountEditForm: React.FC<FormProps> = ({ initial, businessId, onSaved, onClose }) => {
  const { t } = useTranslation('qmail');
  const isEdit = !!initial;
  const [preset, setPreset] = useState<string>(isEdit ? 'custom' : 'gmail');
  const [form, setForm] = useState<EmailAccountInput & { imap_password: string; smtp_password: string }>({
    email: initial?.email || '',
    display_name: initial?.display_name || '',
    imap_host: initial?.imap_host || MAIL_PRESETS[0].imap_host,
    imap_port: initial?.imap_port || MAIL_PRESETS[0].imap_port,
    imap_username: initial?.imap_username || '',
    imap_password: '',
    imap_tls: initial?.imap_tls ?? true,
    imap_folder: initial?.imap_folder || 'INBOX',
    smtp_host: initial?.smtp_host || MAIL_PRESETS[0].smtp_host,
    smtp_port: initial?.smtp_port || MAIL_PRESETS[0].smtp_port,
    smtp_username: initial?.smtp_username || '',
    smtp_password: '',
    smtp_tls: initial?.smtp_tls ?? true,
    is_active: initial?.is_active ?? true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPresetChange = (key: string) => {
    setPreset(key);
    const p = MAIL_PRESETS.find(x => x.key === key);
    if (p && p.imap_host) {
      setForm(prev => ({
        ...prev,
        imap_host: p.imap_host,
        imap_port: p.imap_port,
        smtp_host: p.smtp_host,
        smtp_port: p.smtp_port,
      }));
    }
  };

  const onSubmit = async () => {
    setError(null);
    if (!form.email || !form.email.includes('@')) {
      setError(t('settings.emailInvalid', '올바른 이메일을 입력하세요') as string);
      return;
    }
    if (!form.imap_host || !form.imap_username) {
      setError(t('settings.imapRequired', 'IMAP 서버와 사용자명을 입력하세요') as string);
      return;
    }
    if (!isEdit && !form.imap_password) {
      setError(t('settings.passwordRequired', '비밀번호를 입력하세요') as string);
      return;
    }
    setSubmitting(true);
    try {
      const payload: EmailAccountInput = {
        email: form.email,
        display_name: form.display_name || null,
        imap_host: form.imap_host,
        imap_port: form.imap_port,
        imap_username: form.imap_username,
        imap_tls: form.imap_tls,
        imap_folder: form.imap_folder,
        smtp_host: form.smtp_host || null,
        smtp_port: form.smtp_port || null,
        smtp_username: form.smtp_username || null,
        smtp_tls: form.smtp_tls,
        is_active: form.is_active,
      };
      // 비밀번호는 입력된 경우에만 전송 (편집 시 변경 안 함)
      if (form.imap_password) payload.imap_password = form.imap_password;
      if (form.smtp_password) payload.smtp_password = form.smtp_password;

      if (isEdit) {
        await updateEmailAccount(businessId, initial!.id, payload);
      } else {
        await createEmailAccount(businessId, payload);
      }
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const currentPreset = MAIL_PRESETS.find(p => p.key === preset);

  return (
    <>
      <DetailDrawer.Header onClose={onClose}>
        <DrawerTitle>{isEdit ? t('settings.editTitle', '메일 계정 편집') as string : t('settings.addTitle', '메일 계정 등록') as string}</DrawerTitle>
      </DetailDrawer.Header>
      <DetailDrawer.Body>
        <Form>
          {!isEdit && (
            <Field>
              <Label>{t('settings.preset', '서비스') as string}</Label>
              <PlanQSelect
                size="sm" isSearchable={false}
                value={{ value: preset, label: currentPreset?.label || 'Custom' }}
                onChange={(opt) => onPresetChange((opt as PlanQSelectOption | null)?.value as string || 'custom')}
                options={MAIL_PRESETS.map(p => ({ value: p.key, label: p.label }))}
              />
              {currentPreset?.hint && (
                <PresetHint>
                  {currentPreset.key === 'gmail' && t('settings.gmailHint', 'Gmail 2단계 인증 사용 시 "앱 비밀번호" 발급 필요 (Google 계정 → 보안 → 앱 비밀번호)') as string}
                  {currentPreset.key === 'icloud' && t('settings.icloudHint', 'iCloud 는 "앱 전용 비밀번호" 발급 필요 (Apple ID → 보안)') as string}
                </PresetHint>
              )}
            </Field>
          )}

          <Field>
            <Label>{t('settings.fieldEmail', '이메일') as string} <Required>*</Required></Label>
            <Input
              type="email" value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value, imap_username: form.imap_username || e.target.value, smtp_username: form.smtp_username || e.target.value })}
              placeholder="contact@회사.com"
              disabled={isEdit}
            />
          </Field>

          <Field>
            <Label>{t('settings.fieldDisplayName', '표시 이름') as string}</Label>
            <Input
              type="text" value={form.display_name || ''}
              onChange={e => setForm({ ...form, display_name: e.target.value })}
              placeholder={t('settings.displayNamePh', '예: 회사 고객지원') as string}
            />
          </Field>

          <SectionTitle>{t('settings.imapSection', '받기 (IMAP)') as string}</SectionTitle>
          <Grid2>
            <Field>
              <Label>{t('settings.fieldHost', '서버') as string} <Required>*</Required></Label>
              <Input
                type="text" value={form.imap_host}
                onChange={e => setForm({ ...form, imap_host: e.target.value })}
                placeholder="imap.회사.com"
              />
            </Field>
            <Field>
              <Label>{t('settings.fieldPort', '포트') as string}</Label>
              <Input
                type="number" value={form.imap_port}
                onChange={e => setForm({ ...form, imap_port: Number(e.target.value) || 993 })}
              />
            </Field>
          </Grid2>
          <Field>
            <Label>{t('settings.fieldUsername', '사용자명') as string} <Required>*</Required></Label>
            <Input
              type="text" value={form.imap_username}
              onChange={e => setForm({ ...form, imap_username: e.target.value })}
              placeholder={form.email}
            />
          </Field>
          <Field>
            <Label>
              {t('settings.fieldPassword', '비밀번호') as string}
              {!isEdit && <Required>*</Required>}
              {isEdit && <PasswordHint>{t('settings.passwordEditHint', '(비워두면 기존 유지)') as string}</PasswordHint>}
            </Label>
            <Input
              type="password" value={form.imap_password}
              onChange={e => setForm({ ...form, imap_password: e.target.value })}
              autoComplete="new-password"
            />
          </Field>

          <SectionTitle>{t('settings.smtpSection', '보내기 (SMTP)') as string} <Optional>{t('settings.optional', '선택') as string}</Optional></SectionTitle>
          <SmtpHint>{t('settings.smtpHint', 'SMTP 정보를 비우면 PlanQ 기본 발송 서버를 사용합니다.') as string}</SmtpHint>
          <Grid2>
            <Field>
              <Label>{t('settings.fieldHost', '서버') as string}</Label>
              <Input
                type="text" value={form.smtp_host || ''}
                onChange={e => setForm({ ...form, smtp_host: e.target.value })}
                placeholder="smtp.회사.com"
              />
            </Field>
            <Field>
              <Label>{t('settings.fieldPort', '포트') as string}</Label>
              <Input
                type="number" value={form.smtp_port || ''}
                onChange={e => setForm({ ...form, smtp_port: Number(e.target.value) || null })}
              />
            </Field>
          </Grid2>
          <Field>
            <Label>{t('settings.fieldUsername', '사용자명') as string}</Label>
            <Input
              type="text" value={form.smtp_username || ''}
              onChange={e => setForm({ ...form, smtp_username: e.target.value })}
            />
          </Field>
          <Field>
            <Label>{t('settings.fieldPassword', '비밀번호') as string} {isEdit && <PasswordHint>{t('settings.passwordEditHint', '(비워두면 기존 유지)') as string}</PasswordHint>}</Label>
            <Input
              type="password" value={form.smtp_password}
              onChange={e => setForm({ ...form, smtp_password: e.target.value })}
              autoComplete="new-password"
            />
          </Field>

          {error && <ErrorBox>{error}</ErrorBox>}
        </Form>
      </DetailDrawer.Body>
      <DetailDrawer.Footer>
        <ActionBtn type="button" onClick={onClose} disabled={submitting}>
          {t('settings.cancel', '취소') as string}
        </ActionBtn>
        <PrimaryBtn type="button" onClick={onSubmit} disabled={submitting}>
          {submitting ? t('settings.saving', '저장 중...') as string : isEdit ? t('settings.save', '저장') as string : t('settings.add', '등록') as string}
        </PrimaryBtn>
      </DetailDrawer.Footer>
    </>
  );
};

export default EmailAccountSettings;

// ─── styled ────────────────────────────────────
const Hint = styled.p`font-size: 13px; color: #64748B; margin: 0 0 20px; line-height: 1.6;`;
const Loading = styled.div`padding: 40px; text-align: center; color: #94A3B8;`;
const EmptyCard = styled.div`
  padding: 40px 24px; text-align: center;
  background: #FFFFFF; border: 1px dashed #CBD5E1; border-radius: 12px;
`;
const EmptyIcon = styled.div`font-size: 40px; margin-bottom: 12px;`;
const EmptyTitle = styled.div`font-size: 16px; font-weight: 700; color: #0F172A; margin-bottom: 6px;`;
const EmptyDesc = styled.div`font-size: 13px; color: #64748B; margin-bottom: 16px;`;
const Empty = styled.div`padding: 40px; text-align: center; color: #94A3B8;`;
const AddBtn = styled.button`
  height: 36px; padding: 0 14px;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const PrimaryBtn = styled(AddBtn)``;

const AccountList = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const AccountCard = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 18px 20px;
`;
const CardHeader = styled.div`display: flex; gap: 16px; justify-content: space-between; flex-wrap: wrap;`;
const EmailInfo = styled.div`display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 240px;`;
const EmailRow = styled.div`display: flex; align-items: center; gap: 8px;`;
const Email = styled.div`font-size: 15px; font-weight: 700; color: #0F172A;`;
const DefaultBadge = styled.span`
  font-size: 11px; font-weight: 700; padding: 2px 8px;
  background: #CCFBF1; color: #0F766E; border-radius: 12px;
`;
const InactiveBadge = styled.span`
  font-size: 11px; font-weight: 700; padding: 2px 8px;
  background: #FEE2E2; color: #B91C1C; border-radius: 12px;
`;
const DisplayName = styled.div`font-size: 13px; color: #475569;`;
const MetaRow = styled.div`display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 4px;`;
const MetaItem = styled.span`font-size: 11px; color: #94A3B8;`;
const ErrorBadge = styled.span`
  font-size: 11px; font-weight: 600; padding: 2px 6px;
  background: #FEF3C7; color: #92400E; border-radius: 10px;
`;
const ErrorMsg = styled.div`font-size: 12px; color: #B91C1C; margin-top: 6px; line-height: 1.4;`;
const TestSuccess = styled.div`font-size: 12px; color: #0F766E; font-weight: 600; margin-top: 6px;`;
const TestError = styled.div`font-size: 12px; color: #B91C1C; font-weight: 600; margin-top: 6px;`;
const CardActions = styled.div`display: flex; gap: 6px; flex-wrap: wrap; align-items: flex-start;`;
const ActionBtn = styled.button`
  height: 30px; padding: 0 12px;
  background: transparent; color: #475569;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; border-color: #CBD5E1; color: #0F172A; }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const DangerActionBtn = styled(ActionBtn)`
  color: #B91C1C; border-color: #FECACA;
  &:hover:not(:disabled) { background: #FEF2F2; border-color: #FCA5A5; color: #991B1B; }
`;
const DangerBtn = styled(AddBtn)`
  background: #EF4444;
  &:hover { background: #DC2626; }
`;
// 모달 (DetailDrawer)
const DrawerTitle = styled.div`font-size: 16px; font-weight: 700; color: #0F172A;`;
const Form = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 5px;`;
const Label = styled.label`font-size: 12px; font-weight: 600; color: #475569; display: flex; align-items: center; gap: 4px;`;
const Required = styled.span`color: #EF4444;`;
const PasswordHint = styled.span`font-size: 11px; color: #94A3B8; font-weight: 500; margin-left: 4px;`;
const Optional = styled.span`font-size: 11px; color: #94A3B8; font-weight: 500; margin-left: 4px;`;
const Input = styled.input`
  height: 36px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 13px; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  &:disabled { background: #F8FAFC; color: #94A3B8; cursor: not-allowed; }
`;
const Grid2 = styled.div`display: grid; grid-template-columns: 2fr 1fr; gap: 10px;`;
const SectionTitle = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
  margin-top: 8px; padding-top: 12px;
  border-top: 1px solid #E2E8F0;
  display: flex; align-items: center;
`;
const SmtpHint = styled.div`font-size: 11px; color: #64748B; line-height: 1.5; padding: 8px 10px; background: #F8FAFC; border-radius: 6px;`;
const PresetHint = styled.div`font-size: 11px; color: #92400E; line-height: 1.5; padding: 8px 10px; background: #FEF3C7; border: 1px solid #FCD34D; border-radius: 6px; margin-top: 4px;`;
const ErrorBox = styled.div`
  padding: 10px 12px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px;
  font-size: 12px; color: #B91C1C;
`;
// confirm modal
const ConfirmBackdrop = styled.div`
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(15,23,42,0.5);
  display: flex; align-items: center; justify-content: center; padding: 16px;
`;
const ConfirmCard = styled.div`
  background: #FFFFFF; border-radius: 12px;
  padding: 20px; max-width: 420px; width: 100%;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 12px 40px rgba(15,23,42,0.2);
`;
const ConfirmTitle = styled.div`font-size: 15px; font-weight: 700; color: #0F172A;`;
const ConfirmDesc = styled.div`font-size: 12px; color: #64748B; line-height: 1.5;`;
const ConfirmActions = styled.div`display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px;`;
