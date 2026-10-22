// 고객 «담당자» 절 — 고객(회사) 아래 추가 담당자(명함) 목록. 설계 docs/NAME_CARD_V3_STRATEGY.md 9절 결정 2
//   Q sale 패널·상세 페이지가 ClientRecordSections 로 같이 얹는다. 대표 담당자는 위 프로필 칸(고객 행)이다.
//   행을 누르면 그 자리에서 칸이 펼쳐진다(자동저장 — 칸마다 AutoSaveField, 담당자마다 key 로 인스턴스를 가른다).
//   쓰기는 서버 qsale write 판정 그대로(canEdit 은 화면 표시용). 실시간: client:updated 신호 → 다시 읽는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AutoSaveField from '../Common/AutoSaveField';
import ActionButton from '../Common/ActionButton';
import StandardModal from '../Common/StandardModal';
import ConfirmDialog from '../Common/ConfirmDialog';
import LetterAvatar from '../Common/LetterAvatar';
import { onSocket } from '../../services/socket';
import { useAuthedImageSrc } from '../../hooks/useAuthedImageSrc';
import {
  listClientContacts, createClientContact, patchClientContact, deleteClientContact, makeContactBilling,
  type ClientContact, type ContactField,
} from '../../services/sale';
import { Section, SectionTitle, SectionTitleRow, Helper, Dim } from './clientDetailStyles';

interface Props {
  businessId: number;
  clientId: number;
  canEdit: boolean;
  onSaved?: () => void;
}

const KNOWN_ERRORS = ['name_required', 'invalid_email', 'too_many_contacts'];

export default function ClientContactsSection({ businessId, clientId, canEdit, onSaved }: Props) {
  const { t } = useTranslation('clients');
  const [items, setItems] = useState<ClientContact[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState<ClientContact | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const errText = (e: unknown) => {
    const code = e instanceof Error ? e.message : '';
    return t(`contacts.errors.${KNOWN_ERRORS.includes(code) ? code : 'generic'}`) as string;
  };
  const load = useCallback(async () => {
    try { setItems(await listClientContacts(businessId, clientId)); } catch { /* 다음 갱신에 */ }
  }, [businessId, clientId]);
  useEffect(() => { setItems(null); setOpenId(null); void load(); }, [load]);
  useEffect(() => onSocket('client:updated', (p: { id?: number }) => { if (Number(p?.id) === clientId) void load(); }), [load, clientId]);

  const create = async () => {
    if (busy || !newName.trim()) return;
    setBusy(true); setErr(null);
    try {
      const c = await createClientContact(businessId, clientId, { name: newName.trim() });
      setItems((prev) => [...(prev || []), c]);
      setAdding(false); setNewName(''); setOpenId(c.id);
      onSaved?.();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const remove = async (c: ClientContact) => {
    setErr(null);
    try { await deleteClientContact(businessId, clientId, c.id); setItems((prev) => (prev || []).filter((x) => x.id !== c.id)); setOpenId(null); onSaved?.(); }
    catch (e) { setErr(errText(e)); }
  };
  const toBilling = async (c: ClientContact) => {
    setErr(null); setNotice(null);
    try { await makeContactBilling(businessId, clientId, c.id); setNotice(t('contacts.billingDone', { name: c.name }) as string); onSaved?.(); }
    catch (e) { setErr(errText(e)); }
  };

  return (
    <Section data-testid="client-contacts-section">
      <SectionTitleRow>
        <SectionTitle>{t('contacts.title')}{items && items.length > 0 ? ` ${items.length}` : ''}</SectionTitle>
        {canEdit && (
          <ActionButton tone="secondary" size="sm" onClick={() => { setNewName(''); setErr(null); setAdding(true); }} data-testid="client-contact-add">
            + {t('contacts.add')}
          </ActionButton>
        )}
      </SectionTitleRow>
      <Helper>{t('contacts.helper')}</Helper>
      {err && <ErrLine role="alert">{err}</ErrLine>}
      {notice && <NoticeLine aria-live="polite">{notice}</NoticeLine>}
      {items && items.length === 0 && <Dim>{t('contacts.empty')}</Dim>}
      {items && items.length > 0 && (
        <List>
          {items.map((c) => (
            <Item key={c.id} $open={c.id === openId}>
              <RowBtn type="button" onClick={() => setOpenId(c.id === openId ? null : c.id)} aria-expanded={c.id === openId} data-testid={`client-contact-row-${c.id}`}>
                {c.photo_file_id ? <CardThumb businessId={businessId} fileId={c.photo_file_id} /> : <LetterAvatar name={c.name} size={32} />}
                <RowMain>
                  <RowName>{c.name}{(c.job_title || c.department) && <RowRole>{[c.job_title, c.department].filter(Boolean).join(' · ')}</RowRole>}</RowName>
                  <RowSub>{[c.email, c.mobile || c.phone].filter(Boolean).join(' · ') || t('contacts.noReach')}</RowSub>
                </RowMain>
                {(c.source === 'name_card' || c.source === 'photo') && <SourceChip>{t(c.source === 'photo' ? 'contacts.fromPhoto' : 'contacts.fromCard')}</SourceChip>}
              </RowBtn>
              {c.id === openId && (
                <ContactForm key={c.id} businessId={businessId} clientId={clientId} contact={c} disabled={!canEdit}
                  onChanged={(next) => { setItems((prev) => (prev || []).map((x) => (x.id === next.id ? next : x))); onSaved?.(); }}
                  onBilling={() => void toBilling(c)} onDelete={() => setAskDelete(c)} errText={errText} />
              )}
            </Item>
          ))}
        </List>
      )}

      <StandardModal open={adding} onClose={() => setAdding(false)} title={t('contacts.add')} size="sm"
        footer={(
          <>
            <ActionButton tone="secondary" size="md" onClick={() => setAdding(false)}>{t('contacts.cancel')}</ActionButton>
            <ActionButton tone="primary" size="md" onClick={() => void create()} loading={busy} disabled={busy || !newName.trim()} data-testid="client-contact-create">{t('contacts.create')}</ActionButton>
          </>
        )}>
        <FieldLabel htmlFor={`contact-new-${clientId}`}>{t('contacts.field.name')}</FieldLabel>
        <TextInput id={`contact-new-${clientId}`} value={newName} maxLength={100} autoFocus data-testid="client-contact-new-name"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void create(); }} />
        {err && <ErrLine role="alert">{err}</ErrLine>}
      </StandardModal>

      <ConfirmDialog isOpen={!!askDelete} onClose={() => setAskDelete(null)} variant="danger"
        title={t('contacts.deleteTitle')} message={t('contacts.deleteMsg', { name: askDelete?.name || '' })}
        confirmText={t('contacts.delete') as string} cancelText={t('contacts.cancel') as string}
        onConfirm={() => { const c = askDelete; setAskDelete(null); if (c) void remove(c); }} />
    </Section>
  );
}

const FIELD_ROWS: Array<{ key: ContactField; max: number; mode?: 'email' | 'tel' }> = [
  { key: 'name', max: 100 }, { key: 'name_en', max: 100 },
  { key: 'job_title', max: 100 }, { key: 'department', max: 100 },
  { key: 'email', max: 200, mode: 'email' }, { key: 'mobile', max: 40, mode: 'tel' },
  { key: 'phone', max: 40, mode: 'tel' }, { key: 'fax', max: 40, mode: 'tel' },
  { key: 'address', max: 300 }, { key: 'memo', max: 500 },
];

function ContactForm({ businessId, clientId, contact, disabled, onChanged, onBilling, onDelete, errText }: {
  businessId: number; clientId: number; contact: ClientContact; disabled: boolean;
  onChanged: (c: ClientContact) => void; onBilling: () => void; onDelete: () => void; errText: (e: unknown) => string;
}) {
  const { t } = useTranslation('clients');
  return (
    <Form>
      {contact.photo_file_id && <CardPhoto businessId={businessId} fileId={contact.photo_file_id} alt={t('contacts.photoAlt', { name: contact.name }) as string} />}
      <Grid>
        {FIELD_ROWS.map((f) => (
          <ContactInput key={`${contact.id}-${f.key}`} label={t(`contacts.field.${f.key}`) as string} field={f.key} max={f.max} mode={f.mode}
            initial={contact[f.key] || ''} disabled={disabled} wide={f.key === 'address' || f.key === 'memo'}
            onSave={async (v) => onChanged(await patchClientContact(businessId, clientId, contact.id, { [f.key]: v || null }))}
            errText={errText} />
        ))}
      </Grid>
      {!disabled && (
        <FormActions>
          <ActionButton tone="secondary" size="sm" onClick={onBilling} data-testid={`client-contact-billing-${contact.id}`}>{t('contacts.makeBilling')}</ActionButton>
          <ActionButton tone="danger" size="sm" onClick={onDelete} data-testid={`client-contact-delete-${contact.id}`}>{t('contacts.delete')}</ActionButton>
        </FormActions>
      )}
    </Form>
  );
}

// 명함 사진 — 고객 파일(File)이라 인증된 주소로만 그린다(목록 32px · 펼친 칸 큰 사진)
function CardThumb({ businessId, fileId }: { businessId: number; fileId: number }) {
  const src = useAuthedImageSrc(`/api/files/${businessId}/${fileId}/download?w=96`);
  return src ? <Thumb src={src} alt="" /> : <ThumbBlank aria-hidden />;
}
function CardPhoto({ businessId, fileId, alt }: { businessId: number; fileId: number; alt: string }) {
  const src = useAuthedImageSrc(`/api/files/${businessId}/${fileId}/download?w=800`);
  return src ? <Photo src={src} alt={alt} data-testid="client-contact-photo" /> : null;
}

function ContactInput({ label, field, max, mode, initial, disabled, wide, onSave, errText }: {
  label: string; field: ContactField; max: number; mode?: 'email' | 'tel'; initial: string; disabled: boolean; wide: boolean;
  onSave: (v: string) => Promise<void>; errText: (e: unknown) => string;
}) {
  const [v, setV] = useState(initial);
  const ref = useRef(v);
  ref.current = v;
  const [err, setErr] = useState<string | null>(null);
  const id = useRef(`cc-${field}-${Math.random().toString(36).slice(2)}`).current;
  return (
    <Cell $wide={wide}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <AutoSaveField onSave={async () => {
        setErr(null);
        try { await onSave(ref.current.trim()); } catch (e) { setErr(errText(e)); throw e; }
      }}>
        <TextInput id={id} value={v} maxLength={max} disabled={disabled} inputMode={mode}
          type={mode === 'email' ? 'email' : mode === 'tel' ? 'tel' : 'text'}
          onChange={(e) => setV(e.target.value)} />
      </AutoSaveField>
      {err && <ErrLine role="alert">{err}</ErrLine>}
    </Cell>
  );
}

const List = styled.div`display:flex;flex-direction:column;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;background:#FFF;`;
const Item = styled.div<{ $open: boolean }>`
  border-bottom:1px solid #F1F5F9; &:last-child{border-bottom:none;}
  background:${(p) => (p.$open ? '#F8FAFC' : '#FFF')};
`;
const RowBtn = styled.button`
  display:flex;align-items:center;gap:10px;width:100%;text-align:left;cursor:pointer;
  padding:8px 12px;min-height:52px;box-sizing:border-box;border:none;background:transparent;
  &:hover{background:#F8FAFC;}
`;
const Thumb = styled.img`width:44px;height:32px;border-radius:6px;object-fit:cover;flex-shrink:0;border:1px solid #E2E8F0;background:#F8FAFC;`;
const ThumbBlank = styled.span`width:44px;height:32px;border-radius:6px;flex-shrink:0;background:#F1F5F9;`;
const Photo = styled.img`display:block;width:100%;max-height:240px;object-fit:contain;border-radius:8px;border:1px solid #E2E8F0;background:#F8FAFC;`;
const RowMain = styled.div`flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;`;
const RowName = styled.div`display:flex;align-items:baseline;gap:6px;min-width:0;font-size:0.8125rem;font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
const RowRole = styled.span`font-size:0.75rem;font-weight:500;color:#64748B;overflow:hidden;text-overflow:ellipsis;`;
const RowSub = styled.div`font-size:0.75rem;color:#64748B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
const SourceChip = styled.span`flex-shrink:0;font-size:0.6875rem;font-weight:600;color:#0F766E;background:#F0FDFA;border:1px solid #99F6E4;border-radius:999px;padding:1px 8px;`;
const Form = styled.div`display:flex;flex-direction:column;gap:10px;padding:4px 12px 12px;`;
const Grid = styled.div`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 10px;@media (max-width:640px){grid-template-columns:minmax(0,1fr);}`;
const Cell = styled.div<{ $wide: boolean }>`display:flex;flex-direction:column;gap:4px;min-width:0;${(p) => (p.$wide ? 'grid-column:1 / -1;' : '')}`;
const FieldLabel = styled.label`font-size:0.6875rem;font-weight:600;color:#64748B;`;
const TextInput = styled.input`
  width:100%;box-sizing:border-box;height:36px;padding:0 28px 0 10px;border:1px solid #E2E8F0;border-radius:8px;
  font-size:0.8125rem;color:#0F172A;background:#FFF;font-family:inherit;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.1);}
  &:disabled{background:#F8FAFC;color:#64748B;}
`;
const FormActions = styled.div`display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;`;
const ErrLine = styled.div`font-size:0.75rem;color:#B91C1C;`;
const NoticeLine = styled.div`font-size:0.75rem;color:#0F766E;`;
