// EmailAccountSettings — Q Mail M1 사용자 등록 UI
// 워크스페이스 설정 → 메일 계정. admin 전용.
// PageShell + 계정 목록 + 등록/수정 모달 (DetailDrawer) + 서비스 preset + 연결 테스트.
import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../../components/Common/DetailDrawer';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
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
  const isAdmin = user?.business_role === 'owner' || user?.business_role === 'admin' || user?.platform_role === 'platform_admin';
  // 추가할 계정의 범위: 회사 공용(team, admin 만) | 개인(personal). 멤버 기본 = 개인.
  const [addScope, setAddScope] = useState<'team' | 'personal'>(isAdmin ? 'team' : 'personal');

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
    return <Empty>{t('settings.noWorkspace', '워크스페이스를 먼저 선택하세요') as string}</Empty>;
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

  const [connErr, setConnErr] = useState<string | null>(null);
  const connectGmail = async () => {
    // #82/#72 — apiFetch(Bearer) 로 auth_url 받아 이동. 옛 window.location 직접진입은
    // 브라우저 네비게이션이 토큰 미전달 → 401 "Access token required".
    setConnErr(null);
    const ret = encodeURIComponent('/business/settings/mail-accounts');
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-accounts/oauth/gmail/initiate?return_to=${ret}&scope=${addScope}`);
      const j = await r.json();
      if (!j.success || !j.data?.auth_url) throw new Error(j.message || 'init_failed');
      window.location.href = j.data.auth_url;
    } catch (e) {
      setConnErr((e as Error).message || (t('settings.connectFailed', { defaultValue: 'Gmail 연결을 시작하지 못했어요. 잠시 후 다시 시도해주세요.' }) as string));
    }
  };

  const renderCard = (acc: EmailAccountRow) => (
    <AccountCard key={acc.id}>
      <CardHeader>
        <EmailInfo>
          <EmailRow>
            <Email>{acc.email}</Email>
            {acc.is_personal
              ? <PersonalBadge>{t('settings.scopePersonal', '개인') as string}</PersonalBadge>
              : <TeamBadge>{t('settings.scopeTeam', '회사 공용') as string}</TeamBadge>}
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
          {!acc.is_default && !acc.is_personal && (
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
  );

  const teamAccounts = accounts.filter(a => !a.is_personal);
  const personalAccounts = accounts.filter(a => a.is_personal);

  return (
    <Wrap>
      <Toolbar>
        <ScopeToggle role="group" aria-label={t('settings.scopeToggleLabel', '추가할 계정 범위') as string}>
          <ScopeOption
            type="button"
            $active={addScope === 'team'}
            disabled={!isAdmin}
            title={!isAdmin ? (t('settings.teamAdminOnly', '회사 공용 메일은 관리자만 추가할 수 있어요') as string) : undefined}
            onClick={() => setAddScope('team')}
          >
            {t('settings.scopeTeam', '회사 공용') as string}
          </ScopeOption>
          <ScopeOption type="button" $active={addScope === 'personal'} onClick={() => setAddScope('personal')}>
            {t('settings.scopePersonal', '개인') as string}
          </ScopeOption>
        </ScopeToggle>
        <ActionsRow>
          <GoogleConnectBtn type="button" onClick={connectGmail}>
            <GoogleIcon viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </GoogleIcon>
            {t('settings.connectGmail', 'Gmail 로 연결') as string}
          </GoogleConnectBtn>
          <AddBtn type="button" onClick={() => setEditing('new')}>+ {t('settings.add', '계정 추가') as string}</AddBtn>
        </ActionsRow>
      </Toolbar>

      <Hint>{t('settings.hintScope', '회사 공용 메일은 모든 팀원이 인박스에서 함께 보고, 개인 메일은 본인에게만 보입니다. (5분마다 자동 동기화)') as string}</Hint>
      <Hint>{t('settings.hintOauth', '💡 Gmail 사용자라면 \"Gmail 로 연결\" 버튼이 가장 간편해요 — 앱 비밀번호 발급 불필요') as string}</Hint>
      {connErr && <ConnErr>{connErr}</ConnErr>}

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
        <>
          {teamAccounts.length > 0 && (
            <Group>
              <GroupTitle>{t('settings.groupTeam', '회사 공용 메일') as string}</GroupTitle>
              <AccountList>{teamAccounts.map(renderCard)}</AccountList>
            </Group>
          )}
          {personalAccounts.length > 0 && (
            <Group>
              <GroupTitle>{t('settings.groupPersonal', '내 개인 메일') as string}</GroupTitle>
              <AccountList>{personalAccounts.map(renderCard)}</AccountList>
            </Group>
          )}
        </>
      )}

      {/* 등록/편집 모달 */}
      <DetailDrawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        width={560}
        ariaLabel={editing === 'new' ? t('settings.addTitle', '메일 계정 등록') as string : t('settings.editTitle', '메일 계정 편집') as string}
      >
        {editing !== null && (
          <AccountEditForm
            initial={editing === 'new' ? null : editing}
            businessId={businessId}
            scope={editing === 'new' ? addScope : (editing.is_personal ? 'personal' : 'team')}
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
    </Wrap>
  );
};

// ─── 앱 비밀번호 연결 단계별 안내 (#72/#88 — OAuth 검증 전 작동 경로) ───
interface GuideDef {
  titleKey: string; titleDefault: string;
  steps: { key: string; default: string }[];
  link?: { url: string; labelKey: string; labelDefault: string };
}
const APP_PASSWORD_GUIDES: Record<string, GuideDef> = {
  gmail: {
    titleKey: 'settings.guide.gmail.title', titleDefault: 'Gmail 앱 비밀번호로 연결하기',
    steps: [
      { key: 'settings.guide.gmail.s1', default: '구글 계정에 2단계 인증(2-Step Verification)을 먼저 켜주세요. (앱 비밀번호는 2단계 인증이 켜져 있어야 발급됩니다)' },
      { key: 'settings.guide.gmail.s2', default: '아래 "앱 비밀번호 만들기"를 눌러 새 비밀번호를 생성하세요. 앱 이름은 "PlanQ"로 입력하면 됩니다.' },
      { key: 'settings.guide.gmail.s3', default: '생성된 16자리 비밀번호(공백 제외)를 아래 "비밀번호" 칸에 붙여넣고 저장하세요. 서버 정보는 자동 입력되어 있습니다.' },
    ],
    link: { url: 'https://myaccount.google.com/apppasswords', labelKey: 'settings.guide.gmail.link', labelDefault: '앱 비밀번호 만들기 →' },
  },
  naver: {
    titleKey: 'settings.guide.naver.title', titleDefault: 'Naver 메일 앱 비밀번호로 연결하기',
    steps: [
      { key: 'settings.guide.naver.s1', default: '네이버 메일 → 환경설정 → POP3/IMAP 설정에서 "IMAP/SMTP 사용"을 ON으로 바꿔주세요.' },
      { key: 'settings.guide.naver.s2', default: '네이버 2단계 인증을 사용 중이면 "애플리케이션 비밀번호"를 발급하세요. (내정보 → 보안설정)' },
      { key: 'settings.guide.naver.s3', default: '발급된 비밀번호(2단계 인증 미사용 시 네이버 로그인 비밀번호)를 아래 "비밀번호" 칸에 입력하고 저장하세요.' },
    ],
    link: { url: 'https://mail.naver.com', labelKey: 'settings.guide.naver.link', labelDefault: '네이버 메일 설정 열기 →' },
  },
  icloud: {
    titleKey: 'settings.guide.icloud.title', titleDefault: 'iCloud 앱 암호로 연결하기',
    steps: [
      { key: 'settings.guide.icloud.s1', default: 'Apple ID에 2단계 인증이 켜져 있어야 합니다.' },
      { key: 'settings.guide.icloud.s2', default: '아래 "앱 암호 만들기"에서 새 앱 암호를 생성하세요. (로그인 및 보안 → 앱 암호)' },
      { key: 'settings.guide.icloud.s3', default: '생성된 앱 암호를 아래 "비밀번호" 칸에 붙여넣고 저장하세요.' },
    ],
    link: { url: 'https://account.apple.com', labelKey: 'settings.guide.icloud.link', labelDefault: 'Apple ID 앱 암호 →' },
  },
};

const ConnectGuide: React.FC<{ guide: GuideDef }> = ({ guide }) => {
  const { t } = useTranslation('qmail');
  return (
  <GuideBox>
    <GuideTitle>{t(guide.titleKey, guide.titleDefault)}</GuideTitle>
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

// ─── 등록/편집 form ─────────────────────────────
interface FormProps {
  initial: EmailAccountRow | null;
  businessId: number;
  scope: 'team' | 'personal';
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}

const AccountEditForm: React.FC<FormProps> = ({ initial, businessId, scope, onSaved, onClose }) => {
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
        await createEmailAccount(businessId, { ...payload, scope });
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
            <ScopeNote $personal={scope === 'personal'}>
              {scope === 'personal'
                ? t('settings.scopeNotePersonal', '개인 메일 — 나에게만 보입니다.') as string
                : t('settings.scopeNoteTeam', '회사 공용 메일 — 모든 팀원이 인박스에서 함께 봅니다.') as string}
            </ScopeNote>
          )}
          {!isEdit && (
            <Field>
              <Label>{t('settings.preset', '서비스') as string}</Label>
              <PlanQSelect
                size="sm" isSearchable={false}
                value={{ value: preset, label: currentPreset?.label || 'Custom' }}
                onChange={(opt) => onPresetChange((opt as PlanQSelectOption | null)?.value as string || 'custom')}
                options={MAIL_PRESETS.map(p => ({ value: p.key, label: p.label }))}
              />
              {APP_PASSWORD_GUIDES[preset] && (
                <ConnectGuide guide={APP_PASSWORD_GUIDES[preset]} />
              )}
            </Field>
          )}

          <Field>
            <Label>{t('settings.fieldEmail', '이메일') as string} <Required>*</Required></Label>
            <Input
              type="email" value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value, imap_username: form.imap_username || e.target.value, smtp_username: form.smtp_username || e.target.value })}
              placeholder={t('settings.emailPh', 'contact@회사.com') as string}
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
                placeholder={t('settings.imapHostPh', 'imap.회사.com') as string}
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
                placeholder={t('settings.smtpHostPh', 'smtp.회사.com') as string}
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
const Wrap = styled.div`display: flex; flex-direction: column;`;
const Toolbar = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
`;
const ScopeToggle = styled.div`
  display: inline-flex; padding: 3px;
  background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 8px;
`;
const ScopeOption = styled.button<{ $active: boolean }>`
  height: 30px; padding: 0 14px;
  border: none; border-radius: 6px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  background: ${p => p.$active ? '#FFFFFF' : 'transparent'};
  color: ${p => p.$active ? '#0F172A' : '#64748B'};
  box-shadow: ${p => p.$active ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'};
  transition: all 0.15s;
  &:hover:not(:disabled):not([data-active="true"]) { color: #0F172A; }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const Group = styled.div`margin-bottom: 24px;`;
const GroupTitle = styled.div`
  font-size: 13px; font-weight: 700; color: #334155;
  margin-bottom: 10px;
`;
const TeamBadge = styled.span`
  font-size: 11px; font-weight: 700; padding: 2px 8px;
  background: #E0F2FE; color: #075985; border-radius: 12px;
`;
const PersonalBadge = styled.span`
  font-size: 11px; font-weight: 700; padding: 2px 8px;
  background: #F1F5F9; color: #475569; border-radius: 12px;
`;
const ScopeNote = styled.div<{ $personal: boolean }>`
  font-size: 12px; font-weight: 600; line-height: 1.5;
  padding: 10px 12px; border-radius: 8px;
  background: ${p => p.$personal ? '#F8FAFC' : '#EFF6FF'};
  color: ${p => p.$personal ? '#475569' : '#1E40AF'};
  border: 1px solid ${p => p.$personal ? '#E2E8F0' : '#BFDBFE'};
`;
const Hint = styled.p`font-size: 13px; color: #64748B; margin: 0 0 20px; line-height: 1.6;`;
const ConnErr = styled.p`font-size: 13px; color: #B91C1C; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 10px 12px; margin: 0 0 16px; line-height: 1.5;`;
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
const ActionsRow = styled.div`display: flex; gap: 8px; align-items: center;`;
const GoogleConnectBtn = styled.button`
  display: flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 14px;
  background: #FFFFFF; color: #0F172A;
  border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  &:hover { background: #F8FAFC; border-color: #94A3B8; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const GoogleIcon = styled.svg`width: 16px; height: 16px;`;

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
const GuideBox = styled.div`margin-top: 8px; padding: 14px 16px; background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 10px;`;
const GuideTitle = styled.div`font-size: 13px; font-weight: 700; color: #0F766E; margin-bottom: 10px;`;
const GuideSteps = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const GuideStep = styled.div`display: flex; gap: 10px; align-items: flex-start;`;
const GuideNum = styled.span`flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%; background: #14B8A6; color: #fff; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 1px;`;
const GuideStepText = styled.div`font-size: 12px; color: #334155; line-height: 1.55;`;
const GuideLink = styled.a`display: inline-block; margin-top: 12px; font-size: 12px; font-weight: 600; color: #0F766E; text-decoration: none; padding: 7px 12px; background: #fff; border: 1px solid #14B8A6; border-radius: 8px; transition: background 0.15s; &:hover { background: #CCFBF1; }`;
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
