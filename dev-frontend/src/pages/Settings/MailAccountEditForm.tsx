// MailAccountEditForm — 메일 계정 등록·편집 폼 (EmailAccountSettings 의 DetailDrawer 안).
//   2026-11-14 EmailAccountSettings.tsx 에서 동작 그대로 옮겼다(god-file 래칫).
// draft-sensitive-reviewed: 비밀번호(imap/smtp) 두 칸은 초안 값에서 뺀다 — 남는 것은 주소·서버·포트·아이디 같은 비밀 아닌 설정값
//   입력 초안(2026-11-14 Irene «정보를 많이 넣는 화면 … 다 날라가서 너무 불편해»): 닫기(✕·바깥·Esc·[취소])·새로고침·연결 실패에도
//   남고, 다시 열면 복원 줄과 함께 채운다. 지우는 곳은 저장 성공과 복원 줄의 [지우기] 뿐.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useLocalDraft, useDraftKey } from '../../hooks/useLocalDraft';
import FormDraftNote from '../../components/Common/FormDraftNote';
import DetailDrawer from '../../components/Common/DetailDrawer';
import TrustNote from '../../components/Common/TrustNote';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import {
  createEmailAccount, updateEmailAccount, MAIL_PRESETS,
  type EmailAccountRow, type EmailAccountInput,
} from '../../services/mail';
import {
  APP_PASSWORD_GUIDES, IMAP_ERROR_GUIDE, hostToGuideKey, detectPresetByEmail, ConnectGuide,
  type TwoStepAnswer, type MailFormField,
} from './MailConnectGuide';
// ─── 등록/편집 form ─────────────────────────────
type FormState = EmailAccountInput & { imap_password: string; smtp_password: string };
type FormNoSecret = Omit<FormState, 'imap_password' | 'smtp_password'>;
interface MailAccountDraft { form: FormNoSecret; preset: string; base: string }

// 편집 대상의 «서버 설정값» 지문 — 이것이 바뀌면(다른 사람이 고침) 옛 초안을 버린다
const draftBaseOf = (a: EmailAccountRow): string => JSON.stringify([
  a.email, a.display_name, a.imap_host, a.imap_port, a.imap_username, a.imap_tls, a.imap_folder,
  a.smtp_host, a.smtp_port, a.smtp_username, a.smtp_tls, a.is_active,
]);
// 복원은 알려진 칸만 · 비밀번호 칸은 어떤 경우에도 받지 않는다(옛 저장본에 섞여 있어도)
const DRAFT_FIELDS: Array<keyof FormNoSecret> = [
  'email', 'display_name', 'imap_host', 'imap_port', 'imap_username', 'imap_tls', 'imap_folder',
  'smtp_host', 'smtp_port', 'smtp_username', 'smtp_tls', 'is_active',
];
const pickFormFields = (v: Partial<FormNoSecret>, isEdit: boolean): Partial<FormNoSecret> => {
  const out: Record<string, unknown> = {};
  for (const k of DRAFT_FIELDS) {
    if (isEdit && k === 'email') continue; // 편집에서는 주소를 못 바꾼다
    if (v[k] !== undefined) out[k] = v[k];
  }
  return out as Partial<FormNoSecret>;
};

interface FormProps {
  initial: EmailAccountRow | null;
  businessId: number;
  scope: 'team' | 'personal';
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}

const MailAccountEditForm: React.FC<FormProps> = ({ initial, businessId, scope, onSaved, onClose }) => {
  const { t } = useTranslation('qmail');
  const isEdit = !!initial;
  const [preset, setPreset] = useState<string>(isEdit ? 'custom' : 'gmail');
  const initialForm = (): FormState => ({
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
  const [form, setForm] = useState<FormState>(initialForm);

  // ─── 입력 초안 (비밀번호 제외) ───
  //   base = 편집 대상의 서버 설정값. updated_at 은 동기화마다 바뀌어 쓰지 않는다.
  const base = isEdit ? draftBaseOf(initial!) : '';
  const draftKey = useDraftKey('mail-account-form', isEdit ? initial!.id : `new-${scope}`, businessId) || '';
  const { imap_password: _ip, smtp_password: _sp, ...formNoSecret } = form;
  const draftValue: MailAccountDraft = { form: formNoSecret, preset, base };
  const pristine = useRef<string>(JSON.stringify({ form: (({ imap_password: _a, smtp_password: _b, ...r }) => r)(initialForm()), preset }));
  const draft = useLocalDraft<MailAccountDraft>({
    key: draftKey, value: draftValue, enabled: !!draftKey,
    isEmpty: (v) => JSON.stringify({ form: v.form, preset: v.preset }) === pristine.current,
  });
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  useEffect(() => {
    const r = draft.restored;
    if (!r || !r.value || typeof r.value.form !== 'object') return;
    if ((r.value.base || '') !== base) { draft.clear(); return; } // 그 사이 설정이 바뀌었으면 옛 초안을 버린다
    setForm((prev) => ({ ...prev, ...pickFormFields(r.value.form, isEdit) }));
    if (!isEdit && typeof r.value.preset === 'string') setPreset(r.value.preset);
    setRestoredAt(r.savedAt || Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const discardDraft = () => {
    draft.clear();
    setForm(initialForm());
    setPreset(isEdit ? 'custom' : 'gmail');
    setRestoredAt(null);
    setError(null);
  };
  const [submitting, setSubmitting] = useState(false);
  // ★ 실패는 «어느 칸» 과 함께 둔다 — 옛날엔 폼 맨 아래 상자 하나라 데스크탑·태블릿에서는 스크롤 밖에 떠
  //   «눌렀는데 아무 일도 안 일어남» 으로 읽혔다(2026-11-06 Irene «경고문구가 맨 아래에 떠서 모르는데»).
  //   빈칸·형식(화면 검사) = 그 칸으로 보내고 칸 밑에 이유 / 서버 거절 = 드로어 맨 위 경고 줄 + 문제 칸 표시 + [해당 칸으로 이동].
  const [error, setError] = useState<{ msg: string; field: MailFormField | null; server: boolean } | null>(null);
  const [twoStep, setTwoStep] = useState<TwoStepAnswer>(null);
  const [guideEmph, setGuideEmph] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const fieldRefs = useRef<Partial<Record<MailFormField, HTMLInputElement | null>>>({});
  const bindField = (f: MailFormField) => (el: HTMLInputElement | null) => { fieldRefs.current[f] = el; };
  const focusField = useCallback((f: MailFormField | null) => {
    const el = f ? fieldRefs.current[f] : null;
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!error) return;
    if (error.server) {
      // 경고는 폼 첫 줄이다 — 굴러가는 상자를 맨 위로 올린다. scrollIntoView 는 폰에서 상자 안 고정 머리줄(뒤로·제목)
      //   밑으로 경고를 밀어 넣어 가렸다(390 실측). 상자를 못 찾으면 그때만 scrollIntoView.
      const el = alertRef.current;
      let box: HTMLElement | null = el?.parentElement || null;
      while (box && !(box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      if (box) box.scrollTo({ top: 0, behavior: 'smooth' });
      else el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    } else {
      focusField(error.field);
    }
  }, [error, focusField]);
  const isBad = (f: MailFormField) => error?.field === f;
  // 그 칸을 다시 고치기 시작하면 표시를 거둔다(다른 칸을 고칠 때는 그대로)
  const touch = (f: MailFormField) => { if (error?.field === f) { setError(null); setGuideEmph(false); } };
  const fieldError = (f: MailFormField) => (error && !error.server && error.field === f)
    ? <FieldError data-testid={`mail-field-error-${f}`}>{error.msg}</FieldError> : null;

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

  // Gmail·Naver·Outlook·iCloud 는 계정 비밀번호로 IMAP 연결이 안 되고 앱 비밀번호를 발급해야 한다.
  // 항목명을 "비밀번호" 로만 두면 계정 비밀번호를 넣고 실패하는 사고가 반복 → 항목명 자체를 바꾼다.
  const appPwHost = hostToGuideKey(form.imap_host);
  const usesAppPassword = appPwHost === 'gmail' || appPwHost === 'naver' || appPwHost === 'outlook' || appPwHost === 'icloud';
  const passwordLabel = usesAppPassword
    ? (t('settings.fieldAppPassword', '앱 비밀번호') as string)
    : (t('settings.fieldPassword', '비밀번호') as string);

  const onSubmit = async () => {
    setError(null);
    setGuideEmph(false);
    const local = (msg: string, field: MailFormField) => setError({ msg, field, server: false });
    if (!form.email || !form.email.includes('@')) {
      local(t('settings.emailInvalid', '올바른 이메일을 입력하세요') as string, 'email');
      return;
    }
    if (!form.imap_host) { local(t('settings.imapHostRequired') as string, 'imap_host'); return; }
    if (!form.imap_username) { local(t('settings.imapUserRequired') as string, 'imap_username'); return; }
    if (!isEdit && !form.imap_password) {
      local(usesAppPassword
        ? (t('settings.appPasswordRequired', '앱 비밀번호를 입력하세요') as string)
        : (t('settings.passwordRequired', '비밀번호를 입력하세요') as string), 'imap_password');
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
      draft.clear();
      await onSaved();
    } catch (e) {
      const code = (e as Error).message;
      const guide = IMAP_ERROR_GUIDE[code];
      if (guide?.preset && guide.preset !== preset) setPreset(guide.preset); // 해당 provider 안내 박스 표시
      if (guide?.twoStepOff) setTwoStep('off');   // 구글이 거절 = 2단계 인증부터 의심 → 그 안내를 펼친다
      setGuideEmph(!!guide?.preset && guide.field === 'imap_password');
      setError({ msg: guide ? (t(guide.key, guide.def) as string) : code, field: guide?.field || null, server: true });
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
          {restoredAt !== null && (
            <FormDraftNote
              savedAt={restoredAt} onDiscard={discardDraft} testId="mail-account-draft-restored"
              hint={t('settings.draftNoPassword', '비밀번호는 저장하지 않아요 — 다시 넣어 주세요.') as string}
            />
          )}
          {error?.server && (
            <ErrorBox ref={alertRef} role="alert" tabIndex={-1} data-testid="mail-form-alert">
              <span>{error.msg}</span>
              {error.field && (
                <JumpBtn type="button" onClick={() => focusField(error.field)}>
                  {t('settings.jumpToField') as string}
                </JumpBtn>
              )}
            </ErrorBox>
          )}
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
                <ConnectGuide guide={APP_PASSWORD_GUIDES[preset]} twoStep={twoStep} onTwoStep={setTwoStep} emphasize={guideEmph} />
              )}
            </Field>
          )}
          {isEdit && hostToGuideKey(form.imap_host) && APP_PASSWORD_GUIDES[hostToGuideKey(form.imap_host)!] && (
            <ConnectGuide guide={APP_PASSWORD_GUIDES[hostToGuideKey(form.imap_host)!]} twoStep={twoStep} onTwoStep={setTwoStep} emphasize={guideEmph} />
          )}

          <Field>
            <Label>{t('settings.fieldEmail', '이메일') as string} <Required>*</Required></Label>
            <Input
              type="email" value={form.email} data-testid="mail-account-email"
              ref={bindField('email')} $invalid={isBad('email')} aria-invalid={isBad('email') || undefined}
              onChange={e => {
                touch('email');
                const email = e.target.value;
                // ★ 아이디 칸은 이메일을 **계속 따라간다**(사용자가 따로 고치기 전까지). 여태 `빈 칸일 때만` 채워서
                //   첫 글자에서 멈췄다 — 운영 네이버 계정의 보내기 아이디가 한 글자로 저장돼 발송이 전부 거절됐다.
                const follows = (v?: string | null) => !v || v === form.email;
                setForm({
                  ...form, email,
                  imap_username: follows(form.imap_username) ? email : form.imap_username,
                  smtp_username: follows(form.smtp_username) ? email : form.smtp_username,
                });
                // 도메인 자동 감지 → 서버 정보 자동 완성 + provider 안내 표시
                const auto = detectPresetByEmail(email);
                if (!isEdit && auto && auto !== preset) onPresetChange(auto);
              }}
              placeholder={t('settings.emailPh', 'contact@회사.com') as string}
              disabled={isEdit}
            />
            {fieldError('email')}
          </Field>

          <Field>
            {/* 이 값이 그대로 고객 메일함의 발신자 이름이 된다 — 항목명을 표시 이름이라고만 두니
                구글이 정한 계정명(예: IRENE WP)이 브랜드 대신 나가는 사고가 났다. */}
            <Label>{t('settings.fieldFromName', '발신 이름') as string}</Label>
            <Input
              type="text" value={form.display_name || ''} data-testid="mail-account-from-name"
              onChange={e => setForm({ ...form, display_name: e.target.value })}
              placeholder={t('settings.fromNamePh', '예: PlanQ · 회사 고객지원') as string}
            />
            <FieldHint>{t('settings.fromNameHint', '받는 사람 메일함에 이 이름으로 표시돼요. 비우면 메일 주소만 보입니다.') as string}</FieldHint>
          </Field>

          <SectionTitle>{t('settings.imapSection', '받기 (IMAP)') as string}</SectionTitle>
          <Grid2>
            <Field>
              <Label>{t('settings.fieldHost', '서버') as string} <Required>*</Required></Label>
              <Input
                type="text" value={form.imap_host}
                ref={bindField('imap_host')} $invalid={isBad('imap_host')} aria-invalid={isBad('imap_host') || undefined}
                onChange={e => { touch('imap_host'); setForm({ ...form, imap_host: e.target.value }); }}
                placeholder={t('settings.imapHostPh', 'imap.회사.com') as string}
              />
              {fieldError('imap_host')}
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
            <Label>{t('settings.fieldUsername', '로그인 아이디') as string} <Required>*</Required></Label>
            <Input
              type="text" value={form.imap_username} data-testid="mail-account-imap-user"
              ref={bindField('imap_username')} $invalid={isBad('imap_username')} aria-invalid={isBad('imap_username') || undefined}
              onChange={e => { touch('imap_username'); setForm({ ...form, imap_username: e.target.value }); }}
              placeholder={form.email}
            />
            <FieldHint>{t('settings.loginIdHint', '메일 서비스에 로그인할 때 쓰는 아이디예요. Gmail·네이버·Outlook 은 위 이메일 주소와 같아요(자동으로 채워져요).') as string}</FieldHint>
            {fieldError('imap_username')}
          </Field>
          <Field>
            <Label>
              {passwordLabel}
              {!isEdit && <Required>*</Required>}
              {isEdit && <PasswordHint>{t('settings.passwordEditHint', '(비워두면 기존 유지)') as string}</PasswordHint>}
            </Label>
            <Input
              type="password" value={form.imap_password} data-testid="mail-account-imap-pw"
              ref={bindField('imap_password')} $invalid={isBad('imap_password')} aria-invalid={isBad('imap_password') || undefined}
              /* 앱비밀번호 provider 만 공백 제거 — 일반 IMAP 은 중간 공백이 유효한 비밀번호일 수 있어
                 입력 자체를 막으면 안 된다 (백엔드 normalizeImapPassword 와 같은 기준). */
              onChange={e => (touch('imap_password'), setForm({
                ...form,
                imap_password: usesAppPassword ? e.target.value.replace(/[\s\u00A0]/g, '') : e.target.value,
              }))}
              autoComplete="new-password"
              placeholder={usesAppPassword ? (t('settings.appPasswordPh', '계정 비밀번호가 아닌, 발급받은 앱 비밀번호') as string) : undefined}
            />
            {fieldError('imap_password')}
          </Field>

          <SectionTitle>{t('settings.smtpSection', '보내기 (SMTP)') as string} <Optional>{t('settings.optional', '선택') as string}</Optional></SectionTitle>
          <SmtpHint>{t('settings.smtpHint', 'SMTP 정보를 비우면 PlanQ 기본 발송 서버를 사용합니다.') as string}</SmtpHint>
          <Grid2>
            <Field>
              <Label>{t('settings.fieldHost', '서버') as string}</Label>
              <Input
                type="text" value={form.smtp_host || ''}
                ref={bindField('smtp_host')} $invalid={isBad('smtp_host')} aria-invalid={isBad('smtp_host') || undefined}
                onChange={e => { touch('smtp_host'); setForm({ ...form, smtp_host: e.target.value }); }}
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
            <Label>{t('settings.fieldUsername', '로그인 아이디') as string}</Label>
            <Input
              type="text" value={form.smtp_username || ''}
              ref={bindField('smtp_username')} $invalid={isBad('smtp_username')} aria-invalid={isBad('smtp_username') || undefined}
              onChange={e => { touch('smtp_username'); setForm({ ...form, smtp_username: e.target.value }); }}
              placeholder={form.imap_username || undefined}
            />
            <FieldHint>{t('settings.smtpLoginIdHint', '비우면 받기의 로그인 아이디를 그대로 써요.') as string}</FieldHint>
          </Field>
          <Field>
            <Label>{passwordLabel} {isEdit && <PasswordHint>{t('settings.passwordEditHint', '(비워두면 기존 유지)') as string}</PasswordHint>}</Label>
            <Input
              type="password" value={form.smtp_password} data-testid="mail-account-smtp-pw"
              ref={bindField('smtp_password')} $invalid={isBad('smtp_password')} aria-invalid={isBad('smtp_password') || undefined}
              onChange={e => { touch('smtp_password'); setForm({ ...form, smtp_password: e.target.value }); }}
              autoComplete="new-password"
            />
          </Field>

          <TrustNote spot="mailConnect" />
        </Form>
      </DetailDrawer.Body>
      <DetailDrawer.Footer>
        <ActionBtn type="button" data-testid="mail-account-cancel" onClick={onClose} disabled={submitting}>
          {t('settings.cancel', '취소') as string}
        </ActionBtn>
        <PrimaryBtn type="button" data-testid="mail-account-submit" onClick={onSubmit} disabled={submitting}>
          {submitting ? t('settings.saving', '저장 중...') as string : isEdit ? t('settings.save', '저장') as string : t('settings.add', '등록') as string}
        </PrimaryBtn>
      </DetailDrawer.Footer>
    </>
  );
};

export default MailAccountEditForm;

// ─── styled ────────────────────────────────────
// 버튼 셋은 목록 화면(EmailAccountSettings)도 이 파일에서 가져다 쓴다 — 한 벌.
export const AddBtn = styled.button`
  height: 36px; padding: 0 14px;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px;
  font-size: 0.8125rem; font-weight: 600;
  cursor: pointer;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
export const PrimaryBtn = styled(AddBtn)``;
export const ActionBtn = styled.button`
  height: 30px; padding: 0 12px;
  background: transparent; color: #475569;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 0.75rem; font-weight: 600;
  cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; border-color: #CBD5E1; color: #0F172A; }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const DrawerTitle = styled.div`font-size: 1rem; font-weight: 700; color: #0F172A;`;
const Form = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 5px;`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #475569; display: flex; align-items: center; gap: 4px;`;
const FieldHint = styled.span`font-size: 0.6875rem; font-weight: 500; color: #94A3B8; line-height: 1.5;`;
const Required = styled.span`color: #EF4444;`;
const PasswordHint = styled.span`font-size: 0.6875rem; color: #94A3B8; font-weight: 500; margin-left: 4px;`;
const Optional = styled.span`font-size: 0.6875rem; color: #94A3B8; font-weight: 500; margin-left: 4px;`;
const Input = styled.input<{ $invalid?: boolean }>`
  height: 36px; padding: 0 10px;
  border: 1px solid ${p => p.$invalid ? '#FCA5A5' : '#E2E8F0'}; border-radius: 6px;
  background: ${p => p.$invalid ? '#FEF2F2' : '#FFFFFF'};
  font-size: 0.8125rem; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  &:disabled { background: #F8FAFC; color: #94A3B8; cursor: not-allowed; }
`;
const Grid2 = styled.div`display: grid; grid-template-columns: 2fr 1fr; gap: 10px;`;
const SectionTitle = styled.div`
  font-size: 0.8125rem; font-weight: 700; color: #0F172A;
  margin-top: 8px; padding-top: 12px;
  border-top: 1px solid #E2E8F0;
  display: flex; align-items: center;
`;
const SmtpHint = styled.div`font-size: 0.6875rem; color: #64748B; line-height: 1.5; padding: 8px 10px; background: #F8FAFC; border-radius: 6px;`;
const ErrorBox = styled.div`
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  padding: 10px 12px; line-height: 1.55;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px;
  font-size: 0.75rem; color: #B91C1C;
  &:focus { outline: none; }
`;
const JumpBtn = styled.button`
  all: unset; cursor: pointer; font-weight: 700; color: #991B1B; text-decoration: underline;
  &:focus-visible { outline: 2px solid #FCA5A5; outline-offset: 2px; border-radius: 2px; }
`;
const FieldError = styled.span`font-size: 0.6875rem; font-weight: 600; color: #B91C1C; line-height: 1.5;`;
const ScopeNote = styled.div<{ $personal: boolean }>`
  font-size: 0.75rem; font-weight: 600; line-height: 1.5;
  padding: 10px 12px; border-radius: 8px;
  background: ${p => p.$personal ? '#F8FAFC' : '#EFF6FF'};
  color: ${p => p.$personal ? '#475569' : '#1E40AF'};
  border: 1px solid ${p => p.$personal ? '#E2E8F0' : '#BFDBFE'};
`;
