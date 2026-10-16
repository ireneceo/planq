// 문의 추가(고객응대 내역 추가) — 저장하면 문의 고객(prospect)이 생긴다. SalePage 에서 분리(2026-10-16, 동작 그대로).
import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import PlanQSelect from '../Common/PlanQSelect';
import ActionButton from '../Common/ActionButton';
import InteractionFields, { emptyInteraction, type InteractionValue } from './InteractionFields';
import EmailInput, { isEmailUsable } from '../Common/EmailInput';
import PhoneInput, { isPhoneUsable } from '../Common/PhoneInput';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
import { saveAsClient, SALE_SOURCES, type SaleSource } from '../../services/sale';

// ─── 문의 추가 ────────────────────────────────────────────────────
export default function AddInquiryModal({ open, businessId, onClose, onDone }: {
  open: boolean; businessId: number | null; onClose: () => void; onDone: (clientId: number) => void;
}) {
  const { t } = useTranslation('qsale');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState<SaleSource>('manual');
  // 첫 상담 기록 — 전화·방문 내용은 **등록하는 그 순간**에만 손에 있다(Irene 2026-09-12).
  //   여기서 안 받으면 저장 후 상세로 들어가 한 번 더 써야 하고, 대개 안 쓴다.
  // 응대 내역 값 — 공용 칸(InteractionFields)이 쓰는 모양 그대로
  const [rec, setRec] = useState<InteractionValue>(() => emptyInteraction());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 붙여넣은 글·상담 메모는 길다 — 쓰다 닫아도 남는다(입력 초안 계약).
  //   대상이 하나뿐인 폼이라 entityId 는 고정값이고, 비우는 것은 **저장 성공**뿐이다.
  const note = useDraftText(useDraftKey('sale-inquiry-add', 'note', businessId));

  const sourceOptions = useMemo(() => SALE_SOURCES.map((x) => ({ value: x as string, label: t(`source.${x}`) as string })), [t]);

  useEffect(() => {
    // ★ 초안(붙여넣은 글·메모)은 **여기서 비우지 않는다** — 열 때마다 지우면 초안이 아니다.
    if (open) { setName(''); setCompany(''); setPhone(''); setEmail(''); setSource('manual'); setRec(emptyInteraction()); setErr(null); }
  }, [open]);

  const submit = async () => {
    if (!businessId || saving) return;              // 중복 제출 가드
    if (!name.trim() && !company.trim()) { setErr(t('inquiry.nameRequired') as string); return; }
    // 형식이 틀린 값은 **보내지 않는다** — 서버 400 을 받고 나서 말하면 사용자는 무엇이 틀렸는지 모른다
    if (!isEmailUsable(email)) { setErr(t('inquiry.invalidEmail') as string); return; }
    if (!isPhoneUsable(phone)) { setErr(t('inquiry.invalidPhone') as string); return; }
    setSaving(true);
    try {
      const body = note.text.trim();
      const out = await saveAsClient(businessId, {
        from: 'manual',
        display_name: name.trim() || undefined,
        company_name: company.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        sales_source: source,
        // 내용이 있을 때만 기록을 만든다(빈 기록은 원장을 더럽힌다)
        // 시각·제목·길이까지 같이 보낸다 — 칸이 생겼는데 안 보내면 사용자가 적은 것이 사라진다
        interaction: body ? {
          kind: rec.kind, body,
          direction: rec.direction || 'inbound',
          occurred_at: rec.date && rec.time ? `${rec.date}T${rec.time}` : undefined,
          title: rec.title.trim() || undefined,
          duration_minutes: rec.minutes ? Number(rec.minutes) : undefined,
        } : undefined,
      });
      // 저장이 끝난 뒤에만 초안을 비운다 — 실패를 삼키고 비우면 저장 실패가 곧 글 삭제다
      note.clear();
      onDone(out.client.id);
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg === 'invalid_email' ? (t('inquiry.invalidEmail') as string)
        : msg === 'prospects_quota_exceeded' ? (t('quota.header') as string)
          : (t('error.saveFailed') as string));
    } finally {
      setSaving(false);
    }
  };

  return (
    <StandardModal open={open} onClose={onClose} title={t('action.addRecord') as string} size="sm"
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose}>{t('inquiry.cancel') as string}</ActionButton>
          <ActionButton tone="primary" size="md" loading={saving} onClick={submit} data-testid="sale-inquiry-submit">
            {t('inquiry.submit') as string}
          </ActionButton>
        </>
      )}>
      <Field>
        <FieldLabel htmlFor="sale-inq-name">{t('inquiry.nameLabel') as string}</FieldLabel>
        <TextInput id="sale-inq-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-inq-company">{t('inquiry.companyLabel') as string}</FieldLabel>
        <TextInput id="sale-inq-company" value={company} onChange={(e) => setCompany(e.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-inq-phone">{t('inquiry.phoneLabel') as string}</FieldLabel>
        <PhoneInput id="sale-inq-phone" value={phone} onChange={setPhone} />
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-inq-email">{t('inquiry.emailLabel') as string}</FieldLabel>
        <EmailInput id="sale-inq-email" value={email} onChange={setEmail} />
      </Field>
      <Field>
        <FieldLabel>{t('inquiry.sourceLabel') as string}</FieldLabel>
        <PlanQSelect size="md" isSearchable={false}
          aria-label={t('inquiry.sourceLabel') as string}
          options={sourceOptions}
          value={sourceOptions.find((o) => o.value === source)}
          onChange={(opt: unknown) => {
            const v = (opt as { value?: string } | null)?.value;
            if (v) setSource(v as SaleSource);
          }} />
      </Field>
      {/* ★ 응대 내역 칸은 **공용 한 벌**(InteractionFields) — `RecordModal` 과 같은 것을 쓴다.
          2026-09-13 이전엔 여기만 종류·내용 둘뿐이라, 어디서 적느냐에 따라 남는 정보가 달랐다. */}
      <InteractionFields
        idPrefix="sale-inq"
        value={rec}
        onChange={(patch) => setRec((v) => ({ ...v, ...patch }))}
        bodySlot={(
          <TextArea id="sale-inq-body" rows={3} data-draft-kind="sale-inquiry-add"
            placeholder={t('inquiry.notePlaceholder') as string}
            value={note.text} onChange={(e) => note.setText(e.target.value)} />
        )}
      />
      {err && <ErrText role="alert">{err}</ErrText>}
    </StandardModal>
  );
}


const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const FieldLabel = styled.label`font-size: 0.75rem; font-weight: 600; color: #475569;`;
const TextInput = styled.input`
  height: 40px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.875rem; color: #0F172A;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
const TextArea = styled.textarea`
  width: 100%; padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; font-family: inherit; line-height: 1.5; resize: vertical;
  &:focus { outline: none; border-color: #5EEAD4; }
  &::placeholder { color: #94A3B8; }
`;
const ErrText = styled.div`font-size: 0.8125rem; color: #B91C1C;`;

// [상담 진행] — 머리줄 보조 액션. 주 액션(HeaderCta)과 **같은 높이**여야 줄이 들쭉날쭉하지 않는다.
