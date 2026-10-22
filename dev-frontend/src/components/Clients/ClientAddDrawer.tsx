// 고객 추가 — «초대 보내기 / 직접 관리로 등록» 한 폼(같은 CreateDrawer). 드로어 «이 고객 초대» 도 같은 폼을 그 고객으로 연다.
//   2026-10-16 설정 > 고객 화면에서 **빼서** Q sale > 고객 탭이 쓴다(docs/CLIENT_SCREENS_MERGE_DESIGN.md).
//   서버: POST /api/clients/:biz/invite (client_id 가 있으면 같은 행 승격) · POST /api/clients/:biz/managed (메일 없음).
//   2026-10-22 받은 명함 → 고객(docs/NAME_CARD_V3_STRATEGY.md 9절 결정 1): 명함 값으로 채워 «직접 관리» 로 열고,
//   이미 있는 고객이면 [그 고객의 담당자로 붙이기] 를 먼저 보인다. 같은 워크스페이스 멤버의 명함은 고객으로 넣지 않는다.
import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { attachCardToClient, type CardIntake } from '../../services/sale';
import CreateDrawer from '../Common/CreateDrawer';
import PlanQSelect from '../Common/PlanQSelect';
import { SegmentedToggle, SegmentedBtn } from '../Common/segmentedToggle';
import { usePartnerKindLabel } from '../Common/PartnerKindBadge';
import { Helper } from './clientDetailStyles';

type Kind = 'customer' | 'vendor' | 'freelancer' | 'other';

export interface InviteTarget {
  id: number;
  display_name: string | null;
  company_name: string | null;
  invite_email?: string | null;
  email?: string | null;
  kind?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  /** 메일 «고객으로 저장» 등 바깥에서 채워 여는 값 */
  prefill?: { name?: string; email?: string; company?: string; phone?: string; job_title?: string; department?: string } | null;
  /** 받은 명함에서 왔을 때 — 보관본 id 와 서버 판정(동료 명함·이미 있는 고객) */
  fromCard?: { savedCardId: number; colleague: boolean; match: CardIntake['match'] } | null;
  /** 있으면 «이 고객 초대» — 그 행을 승격한다(새 행 X). 모드는 초대로 고정 */
  inviteFor?: InviteTarget | null;
  /** 끝난 뒤 — 새로 만든 고객 id(직접 관리) 또는 승격한 고객 id */
  onDone?: (clientId: number | null) => void;
  /** 409 «이미 있는 고객» 에서 [그 고객 열기] */
  onOpenExisting?: (clientId: number) => void;
}

export default function ClientAddDrawer({ open, onClose, businessId, prefill, fromCard, inviteFor, onDone, onOpenExisting }: Props) {
  const { t } = useTranslation('clients');
  const kindLabel = usePartnerKindLabel();
  const kindOptions = useMemo(() => (['customer', 'vendor', 'freelancer', 'other'] as Kind[]).map((k) => ({ value: k, label: kindLabel(k) })), [kindLabel]);

  const [mode, setMode] = useState<'invite' | 'managed'>('invite');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [kind, setKind] = useState<Kind>('customer');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<number | null>(null);
  // 초대는 만들어졌지만 메일이 안 나간 경우(0-F) — 닫지 않고 이유와 다음 행동을 말한다
  const [mailWarn, setMailWarn] = useState(false);

  // 열릴 때마다 처음부터 — 대상(inviteFor)·채움값(prefill)을 반영한다
  useEffect(() => {
    if (!open) return;
    // 명함에서 왔으면 «직접 관리» 로 연다 — 받은 명함은 아직 초대할 사이가 아닌 경우가 대부분이다
    setMode(fromCard ? 'managed' : 'invite'); setError(null); setExistingId(null); setMailWarn(false);
    setPhone(prefill?.phone || ''); setJobTitle(prefill?.job_title || ''); setDepartment(prefill?.department || '');
    if (inviteFor) {
      setName(inviteFor.display_name || inviteFor.company_name || '');
      setEmail(inviteFor.invite_email || inviteFor.email || '');
      setCompany(inviteFor.company_name || '');
      setKind(((inviteFor.kind as Kind) || 'customer'));
    } else {
      setName(prefill?.name || ''); setEmail(prefill?.email || ''); setCompany(prefill?.company || ''); setKind('customer');
    }
    // ★ 값으로 비교한다 — 부르는 쪽이 객체를 새로 만들어 넘기면 입력 중에 폼이 비워진다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inviteFor?.id, prefill?.name, prefill?.email, fromCard?.savedCardId]);

  const managed = mode === 'managed' && !inviteFor;
  const disabled = !!fromCard?.colleague || (managed ? (!name.trim() && !company.trim()) : (!name.trim() || !email.trim()));

  // 이미 있는 고객에 이 명함을 담당자로 붙인다(서버가 대표/추가를 가른다) — 끝나면 그 고객을 연다
  const attachTo = async (clientId: number) => {
    if (!fromCard || attaching) return;
    setAttaching(true); setError(null);
    try {
      await attachCardToClient(businessId, clientId, fromCard.savedCardId);
      onClose();
      onOpenExisting?.(clientId);
    } catch (e) {
      setError((e as Error).message === 'already_member' ? t('fromCard.colleague') : t('fromCard.attachFailed'));
    } finally { setAttaching(false); }
  };

  const submitManaged = async () => {
    if (!name.trim() && !company.trim()) { setError(t('addModal.errNameOrCompany')); return; }
    const res = await apiFetch(`/api/clients/${businessId}/managed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim() || null, company_name: company.trim() || null,
        email: email.trim() || null, phone: phone.trim() || null, kind,
        job_title: jobTitle.trim() || null, department: department.trim() || null,
      }),
    });
    const j = await res.json().catch(() => null);
    if (res.status === 409 && j?.existing_client_id) {
      setExistingId(Number(j.existing_client_id));
      setError(t('addModal.errExists'));
      return;
    }
    if (!res.ok || !j?.success) {
      throw new Error(j?.message === 'invalid_email' ? t('addModal.errInvalidEmail') : (j?.message || t('inviteModal.errFailed')));
    }
    onClose();
    onDone?.(j.data?.id ?? null);
  };

  const submitInvite = async () => {
    if (!name.trim() || !email.trim()) { setError(t('inviteModal.errRequired')); return; }
    const res = await apiFetch(`/api/clients/${businessId}/invite`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(), email: email.trim(), company_name: company.trim() || null, kind,
        ...(inviteFor ? { client_id: inviteFor.id } : {}),
      }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.success) throw new Error(j?.message || t('inviteModal.errFailed'));
    const id = (j.data?.id as number | undefined) ?? null;
    if (j.data && j.data.invite_email_sent === false) { setMailWarn(true); onDone?.(id); return; }
    onClose();
    onDone?.(id);
  };

  const submit = async () => {
    if (submitting) return;
    setError(null); setExistingId(null); setMailWarn(false);
    setSubmitting(true);
    try {
      if (managed) await submitManaged(); else await submitInvite();
    } catch (e) {
      setError((e as Error).message);
    } finally { setSubmitting(false); }
  };

  return (
    <CreateDrawer
      open={open}
      onClose={onClose}
      title={inviteFor ? t('addModal.inviteThisTitle') : managed ? t('addModal.titleManaged') : t('inviteModal.title')}
      onSubmit={submit}
      submitting={submitting}
      submitLabel={managed ? t('addModal.submitManaged') : t('inviteModal.submit')}
      submitDisabled={disabled}
    >
      {fromCard?.colleague && <WarnBlock role="alert" data-testid="clients-add-card-colleague">{t('fromCard.colleague')}</WarnBlock>}
      {fromCard && !fromCard.colleague && fromCard.match && (
        <InfoBlock data-testid="clients-add-card-match">
          <span>{t('fromCard.matchFound', { name: fromCard.match.name || `#${fromCard.match.id}` })}</span>
          <AttachBtn type="button" disabled={attaching} onClick={() => void attachTo(fromCard.match!.id)} data-testid="clients-add-card-attach">
            {t('fromCard.attach')}
          </AttachBtn>
        </InfoBlock>
      )}
      {!inviteFor && (
        <ModeRow>
          <SegmentedToggle role="tablist" aria-label={t('addClient') as string}>
            <SegmentedBtn type="button" role="tab" aria-selected={mode === 'invite'} $active={mode === 'invite'}
              data-testid="clients-add-mode-invite" onClick={() => { setMode('invite'); setError(null); setExistingId(null); }}>
              {t('addModal.modeInvite')}
            </SegmentedBtn>
            <SegmentedBtn type="button" role="tab" aria-selected={mode === 'managed'} $active={mode === 'managed'}
              data-testid="clients-add-mode-managed" onClick={() => { setMode('managed'); setError(null); setExistingId(null); }}>
              {t('addModal.modeManaged')}
            </SegmentedBtn>
          </SegmentedToggle>
          <Helper>{managed ? t('addModal.modeManagedHelp') : t('addModal.modeInviteHelp')}</Helper>
        </ModeRow>
      )}
      <Field><FieldLabel>{t('inviteModal.name')} {!managed && <Req>*</Req>}</FieldLabel><FieldInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('inviteModal.namePlaceholder') as string} /></Field>
      <Field><FieldLabel>{managed ? t('addModal.emailOptional') : <>{t('inviteModal.email')} <Req>*</Req></>}</FieldLabel><FieldInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" type="email" /></Field>
      {managed && (
        <Field><FieldLabel>{t('addModal.phone')}</FieldLabel><FieldInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-1234-5678" type="tel" inputMode="tel" /></Field>
      )}
      <Field><FieldLabel>{t('inviteModal.company')}</FieldLabel><FieldInput value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t('inviteModal.companyPlaceholder') as string} /></Field>
      {managed && (
        <>
          <Field><FieldLabel>{t('contacts.field.job_title')}</FieldLabel><FieldInput value={jobTitle} maxLength={100} onChange={(e) => setJobTitle(e.target.value)} data-testid="clients-add-job-title" /></Field>
          <Field><FieldLabel>{t('contacts.field.department')}</FieldLabel><FieldInput value={department} maxLength={100} onChange={(e) => setDepartment(e.target.value)} data-testid="clients-add-department" /></Field>
        </>
      )}
      <Field><FieldLabel>{t('kind.label', { defaultValue: '유형' }) as string}</FieldLabel>
        <PlanQSelect size="md" isClearable={false} isSearchable={false}
          value={kindOptions.find((o) => o.value === kind)} options={kindOptions}
          onChange={(o) => setKind((((o as { value?: string })?.value) as Kind) || 'customer')} />
      </Field>
      {!managed && <Helper>{t('inviteModal.helper')}</Helper>}
      {error && (
        <WarnBlock role="alert" data-testid="clients-add-error">
          {error}
          {existingId != null && fromCard && !fromCard.colleague && (
            <ExistingLink type="button" disabled={attaching} onClick={() => void attachTo(existingId)} data-testid="clients-add-card-attach-existing">
              {t('fromCard.attach')}
            </ExistingLink>
          )}
          {existingId != null && onOpenExisting && (
            <ExistingLink type="button" onClick={() => { const id = existingId; onClose(); onOpenExisting(id); }}>
              {t('addModal.openExisting')}
            </ExistingLink>
          )}
        </WarnBlock>
      )}
      {mailWarn && <WarnBlock role="alert" data-testid="clients-invite-mail-failed">{t('inviteModal.emailFailed')}</WarnBlock>}
    </CreateDrawer>
  );
}

const ModeRow = styled.div`display:flex;flex-direction:column;align-items:flex-start;gap:8px;`;
const Field = styled.div`display:flex;flex-direction:column;gap:4px;`;
const FieldLabel = styled.label`font-size:0.75rem;font-weight:600;color:#0F172A;`;
const FieldInput = styled.input`height:38px;padding:0 12px;border:1px solid #E2E8F0;border-radius:8px;font-size:0.8125rem;color:#0F172A;font-family:inherit;background:#FFF;&:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.1);}&::placeholder{color:#CBD5E1;}`;
const Req = styled.span`color:#F43F5E;margin-left:2px;`;
const WarnBlock = styled.div`margin-top:4px;padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:0.75rem;`;
const InfoBlock = styled.div`display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 12px;background:#F0FDFA;border:1px solid #99F6E4;border-radius:8px;color:#0F766E;font-size:0.75rem;`;
const AttachBtn = styled.button`flex-shrink:0;min-height:32px;padding:0 12px;border-radius:8px;border:1px solid #0D9488;background:#0D9488;color:#FFF;font-size:0.75rem;font-weight:600;cursor:pointer;&:disabled{opacity:0.6;cursor:default;}`;
const ExistingLink = styled.button`margin-left:8px;padding:0;border:none;background:none;color:#0F766E;font-weight:600;font-size:inherit;cursor:pointer;text-decoration:underline;`;
