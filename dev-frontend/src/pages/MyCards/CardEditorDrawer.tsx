// 명함 편집 — 우측 DetailDrawer(URL ?card=:id). 설계 docs/BUSINESS_CARD_DESIGN.md §4
//   칸마다 자동저장(AutoSaveField) · 위에 실제 공개 페이지와 같은 CardFace 미리보기 · 사진 · 링크 공개 스위치 · 다시 불러오기.
//   ★ 실패는 던진다(! 뱃지) + 칸 아래 문장으로 이유를 말한다(서버 코드 그대로 보이지 않게).
//   ★ 칸 인스턴스는 명함·되채우기 회차로 가른다(key) — 다른 명함으로 바뀌어도 떠난 명함의 입력이 새 명함에 저장되지 않게.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../../components/Common/DetailDrawer';
import AutoSaveField, { type AutoSaveHandle } from '../../components/Common/AutoSaveField';
import ActionButton from '../../components/Common/ActionButton';
import PlanQSelect from '../../components/Common/PlanQSelect';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { Switch, SwitchKnob } from '../../components/Common/switchShell';
import CardFace, { ACCENT_COLORS, DEFAULT_ACCENT } from '../../components/NameCard/CardFace';
import { useAuthedImageSrc } from '../../hooks/useAuthedImageSrc';
import {
  patchCard, uploadCardPhoto, deleteCardPhoto, refillCard, myCardPhotoUrl, CardApiError,
  type MyCard, type CardField, type CardLink, type PrefillSource,
} from '../../services/nameCards';

interface Props {
  card: MyCard | null;
  sources: PrefillSource[];
  onClose: () => void;
  onChanged: (c: MyCard) => void;
}

const CardEditorDrawer: React.FC<Props> = ({ card, sources, onClose, onChanged }) => {
  const { t } = useTranslation('cards');
  return (
    <DetailDrawer open={!!card} onClose={onClose} ariaLabel={t('editor.aria') as string}>
      {card && <EditorBody key={card.id} card={card} sources={sources} onClose={onClose} onChanged={onChanged} />}
    </DetailDrawer>
  );
};
export default CardEditorDrawer;

const EditorBody: React.FC<Props & { card: MyCard }> = ({ card, sources, onClose, onChanged }) => {
  const { t } = useTranslation('cards');
  const [rev, setRev] = useState(0);   // 되채우기 뒤 칸을 서버 값으로 다시 그린다
  const photoSrc = useAuthedImageSrc(myCardPhotoUrl(card));
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const [refillSrc, setRefillSrc] = useState<number | ''>(card.source_business_id ?? '');
  const [refillBusy, setRefillBusy] = useState(false);
  const [refillAsk, setRefillAsk] = useState(false);
  const [refillMsg, setRefillMsg] = useState<string | null>(null);

  const save = async (patch: Partial<Record<CardField, unknown>> & { is_public?: boolean }) => {
    const next = await patchCard(card.id, patch);
    onChanged(next);
  };

  const onPhoto = async (f: File) => {
    setPhotoBusy(true); setPhotoMsg(null);
    try { onChanged(await uploadCardPhoto(card.id, f)); } catch (e) {
      const code = e instanceof CardApiError ? e.code : '';
      setPhotoMsg(code === 'photo_too_large' ? t('editor.photoTooLarge') : code === 'image_unreadable' || code === 'image_only' ? t('editor.photoUnreadable') : t('editor.photoFail'));
    } finally { setPhotoBusy(false); }
  };
  const removePhoto = async () => {
    setPhotoBusy(true); setPhotoMsg(null);
    try { onChanged(await deleteCardPhoto(card.id)); } catch { setPhotoMsg(t('editor.photoFail')); } finally { setPhotoBusy(false); }
  };
  const refill = async (mode: 'empty' | 'all') => {
    setRefillBusy(true); setRefillMsg(null);
    try {
      onChanged(await refillCard(card.id, refillSrc === '' ? null : Number(refillSrc), mode));
      setRev((r) => r + 1);
      setRefillMsg(t('editor.refillDone'));
    } catch { setRefillMsg(t('editor.errors.generic')); } finally { setRefillBusy(false); }
  };

  const fk = (f: string) => `${card.id}-${rev}-${f}`;

  return (
    <>
      <DetailDrawer.Header onClose={onClose}>
        <HeadTitle>{card.label}</HeadTitle>
      </DetailDrawer.Header>
      <DetailDrawer.Body>
        <Notice>{t('editor.publicNotice')}</Notice>

        <Section>
          <SectionTitle>{t('editor.preview')}</SectionTitle>
          <CardFace view={card} photoSrc={photoSrc} testId="editor-preview" />
          {!card.link_open && card.closed_reason && (
            <Closed data-testid="editor-closed">
              {t(`card.closed.${card.closed_reason}`)}
              {card.closed_reason === 'email_unverified' && <a href="/profile">{t('editor.verifyEmail')}</a>}
            </Closed>
          )}
        </Section>

        <Section>
          <ToggleLine>
            <div>
              <FieldLabel as="div">{t('editor.public')}</FieldLabel>
              <Hint>{t('editor.publicHint')}</Hint>
            </div>
            <PublicToggle key={fk('pub')} on={card.is_public} label={t('editor.public') as string} onSave={(v) => save({ is_public: v })} />
          </ToggleLine>
        </Section>

        <Section>
          <SectionTitle>{t('editor.sectionBasic')}</SectionTitle>
          <TextField key={fk('label')} label={t('editor.label')} value={card.label} max={60} onSave={(v) => save({ label: v })} testId="card-field-label" />
          <TextField key={fk('name')} label={t('editor.name')} value={card.name} max={100} onSave={(v) => save({ name: v })} testId="card-field-name" />
          <TextField key={fk('name_en')} label={t('editor.nameEn')} value={card.name_en} max={100} onSave={(v) => save({ name_en: v })} />
          <TextField key={fk('job_title')} label={t('editor.jobTitle')} value={card.job_title} max={100} onSave={(v) => save({ job_title: v })} testId="card-field-job" />
          <TextField key={fk('department')} label={t('editor.department')} value={card.department} max={100} onSave={(v) => save({ department: v })} />
          <TextField key={fk('company')} label={t('editor.company')} value={card.company} max={150} onSave={(v) => save({ company: v })} />
          <TextField key={fk('intro')} label={t('editor.intro')} value={card.intro} max={500} multiline placeholder={t('editor.introPlaceholder') as string} onSave={(v) => save({ intro: v })} testId="card-field-intro" />
        </Section>

        <Section>
          <SectionTitle>{t('editor.photo')}</SectionTitle>
          <PhotoRow>
            {photoSrc && card.has_photo && <PhotoThumb src={photoSrc} alt="" />}
            <ActionButton tone="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={photoBusy} loading={photoBusy} data-testid="card-photo-pick">
              {card.has_photo ? t('editor.photoChange') : t('editor.photoAdd')}
            </ActionButton>
            {card.has_photo && (
              <ActionButton tone="secondary" size="sm" onClick={() => void removePhoto()} disabled={photoBusy} data-testid="card-photo-remove">
                {t('editor.photoRemove')}
              </ActionButton>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden data-testid="card-photo-input"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onPhoto(f); }} />
          </PhotoRow>
          <Hint $warn={!!photoMsg}>{photoMsg || t('editor.photoHint')}</Hint>
        </Section>

        <Section>
          <SectionTitle>{t('editor.sectionContact')}</SectionTitle>
          <TextField key={fk('mobile')} label={t('editor.mobile')} value={card.mobile} max={40} inputMode="tel" onSave={(v) => save({ mobile: v })} />
          <TextField key={fk('phone')} label={t('editor.phone')} value={card.phone} max={40} inputMode="tel" onSave={(v) => save({ phone: v })} />
          <TextField key={fk('fax')} label={t('editor.fax')} value={card.fax} max={40} inputMode="tel" onSave={(v) => save({ fax: v })} />
          <TextField key={fk('email')} label={t('editor.email')} value={card.email} max={150} inputMode="email" onSave={(v) => save({ email: v })} />
          <TextField key={fk('website')} label={t('editor.website')} value={card.website} max={300} inputMode="url" placeholder="https://" onSave={(v) => save({ website: v })} />
          <TextField key={fk('address')} label={t('editor.address')} value={card.address} max={300} onSave={(v) => save({ address: v })} />
        </Section>

        <Section>
          <SectionTitle>{t('editor.sectionMore')}</SectionTitle>
          <LinksEditor key={fk('links')} value={card.links} onSave={(links) => save({ links })} />
          <Field>
            <FieldLabel as="div">{t('editor.accent')}</FieldLabel>
            <AccentField key={fk('accent')} value={card.accent_color} onSave={(c) => save({ accent_color: c })} />
          </Field>
        </Section>

        <Section>
          <SectionTitle>{t('editor.refill')}</SectionTitle>
          <Hint>{t('editor.refillHint')}</Hint>
          <RefillRow>
            <RefillSelect>
              <PlanQSelect size="sm" isSearchable={false} aria-label={t('create.source') as string}
                options={[...sources.map((x) => ({ value: x.business_id, label: x.name })), { value: '', label: t('create.sourceBlank') as string }]}
                value={refillSrc === '' ? { value: '', label: t('create.sourceBlank') as string } : (sources.filter((x) => x.business_id === refillSrc).map((x) => ({ value: x.business_id, label: x.name }))[0] || null)}
                onChange={(o) => { const v = (o as { value: string | number } | null)?.value; setRefillSrc(v === '' || v == null ? '' : Number(v)); }} />
            </RefillSelect>
            <ActionButton tone="secondary" size="sm" onClick={() => void refill('empty')} disabled={refillBusy} data-testid="card-refill-empty">{t('editor.refillEmpty')}</ActionButton>
            <ActionButton tone="secondary" size="sm" onClick={() => setRefillAsk(true)} disabled={refillBusy}>{t('editor.refillAll')}</ActionButton>
          </RefillRow>
          {refillMsg && <Hint>{refillMsg}</Hint>}
        </Section>
      </DetailDrawer.Body>
      <ConfirmDialog isOpen={refillAsk} onClose={() => setRefillAsk(false)}
        onConfirm={() => { setRefillAsk(false); void refill('all'); }}
        title={t('editor.refillAllConfirmTitle')} message={t('editor.refillAllConfirm')}
        confirmText={t('editor.refillAll') as string} cancelText={t('confirm.cancel') as string} variant="warning" />
    </>
  );
};

// ─── 칸 하나 ───
function errText(t: (k: string) => string, e: unknown): string {
  const code = e instanceof CardApiError ? e.code : 'generic';
  const known = ['invalid_url', 'invalid_phone', 'invalid_email', 'label_required', 'too_many_links'];
  return t(`editor.errors.${known.includes(code) ? code : 'generic'}`);
}

const TextField: React.FC<{
  label: string; value: string | null; max: number; onSave: (v: string) => Promise<void>;
  multiline?: boolean; placeholder?: string; inputMode?: 'tel' | 'email' | 'url'; testId?: string;
}> = ({ label, value, max, onSave, multiline, placeholder, inputMode, testId }) => {
  const { t } = useTranslation('cards');
  const [v, setV] = useState(value || '');
  const [err, setErr] = useState<string | null>(null);
  const id = useRef(`cf-${Math.random().toString(36).slice(2)}`).current;
  const persist = async () => {
    setErr(null);
    try { await onSave(v); } catch (e) { setErr(errText(t as unknown as (k: string) => string, e)); throw e; }
  };
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <AutoSaveField onSave={persist}>
        {multiline ? (
          <TextArea id={id} value={v} maxLength={max} rows={3} placeholder={placeholder} data-testid={testId}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setV(e.target.value)} />
        ) : (
          <Input id={id} value={v} maxLength={max} placeholder={placeholder} inputMode={inputMode} data-testid={testId}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setV(e.target.value)} />
        )}
      </AutoSaveField>
      {err && <Hint $warn role="alert">{err}</Hint>}
    </Field>
  );
};

const PublicToggle: React.FC<{ on: boolean; label: string; onSave: (v: boolean) => Promise<void> }> = ({ on: initial, label, onSave }) => {
  const [on, setOn] = useState(initial);
  const ref = useRef(initial);
  useEffect(() => { setOn(initial); ref.current = initial; }, [initial]);
  return (
    <AutoSaveField type="toggle" onSave={() => onSave(ref.current)}>
      <Switch type="button" role="switch" aria-checked={on} aria-label={label} $on={on} data-testid="card-public-toggle"
        onClick={() => { ref.current = !on; setOn(!on); }}>
        <SwitchKnob $on={on} />
      </Switch>
    </AutoSaveField>
  );
};

// 강조색 — 고르면 화면만 바꾸고(stage) 저장은 AutoSaveField 가 한 번(persist). 컨트롤이 저장까지 하면 두 번 나간다.
const AccentField: React.FC<{ value: string | null; onSave: (c: string | null) => Promise<void> }> = ({ value, onSave }) => {
  const [cur, setCur] = useState<string | null>(value);
  const ref = useRef<string | null>(value);
  return (
    <AutoSaveField type="select" onSave={() => onSave(ref.current)}>
      <Swatches value={cur} onChange={(c) => { ref.current = c; setCur(c); }} />
    </AutoSaveField>
  );
};

const Swatches: React.FC<{ value: string | null; onChange: (c: string | null) => void }> = ({ value, onChange }) => {
  const { t } = useTranslation('cards');
  const cur = value || DEFAULT_ACCENT;
  return (
    <SwatchRow role="radiogroup" aria-label={t('editor.accent') as string}>
      {ACCENT_COLORS.map((c) => (
        <Swatch key={c} type="button" role="radio" aria-checked={cur === c} $c={c} $on={cur === c}
          aria-label={c === DEFAULT_ACCENT ? (t('editor.accentDefault') as string) : c}
          onClick={() => onChange(c === DEFAULT_ACCENT ? null : c)} />
      ))}
    </SwatchRow>
  );
};

const LinksEditor: React.FC<{ value: CardLink[]; onSave: (links: CardLink[]) => Promise<void> }> = ({ value, onSave }) => {
  const { t } = useTranslation('cards');
  const [rows, setRows] = useState<CardLink[]>(value.length ? value : []);
  const [err, setErr] = useState<string | null>(null);
  const saveRef = useRef<AutoSaveHandle>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const change = (next: CardLink[]) => { setRows(next); saveRef.current?.triggerSave(); };
  const persist = async () => {
    setErr(null);
    // 주소가 빈 줄은 보내지 않는다(아직 쓰는 중) — 서버도 버린다
    const clean = rowsRef.current.filter((r) => r.url.trim());
    try { await onSave(clean); } catch (e) { setErr(errText(t as unknown as (k: string) => string, e)); throw e; }
  };
  return (
    <Field>
      <FieldLabel as="div">{t('editor.links')}</FieldLabel>
      <AutoSaveField ref={saveRef} type="list" debounceMs={1500} onSave={persist}>
        <LinkList>
          {rows.map((r, i) => (
            <LinkRow key={i}>
              <Input value={r.label} maxLength={40} placeholder={t('editor.linkLabel') as string} aria-label={t('editor.linkLabel') as string}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => change(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <Input value={r.url} maxLength={300} placeholder={t('editor.linkUrl') as string} inputMode="url" aria-label="URL"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => change(rows.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <RemoveBtn type="button" aria-label={t('editor.linkRemove') as string} title={t('editor.linkRemove') as string}
                onClick={() => change(rows.filter((_, j) => j !== i))}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
              </RemoveBtn>
            </LinkRow>
          ))}
          {rows.length < 6 && (
            <AddLink type="button" onClick={() => setRows([...rows, { label: '', url: '' }])} data-testid="card-link-add">+ {t('editor.linkAdd')}</AddLink>
          )}
        </LinkList>
      </AutoSaveField>
      <Hint $warn={!!err}>{err || t('editor.linksHint')}</Hint>
    </Field>
  );
};

// ─── 스타일 ───
const HeadTitle = styled.h2`margin: 0; font-size: 1rem; font-weight: 700; color: #0F172A; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Notice = styled.div`padding: 10px 12px; border-radius: 8px; background: #F0FDFA; border: 1px solid #99F6E4; color: #0F766E; font-size: 0.8125rem; line-height: 1.5;`;
const Section = styled.section`display: flex; flex-direction: column; gap: 12px;`;
const SectionTitle = styled.h3`margin: 0; font-size: 0.8125rem; font-weight: 700; color: #475569;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px; min-width: 0;`;
const FieldLabel = styled.label`font-size: 0.75rem; font-weight: 600; color: #64748B;`;
const Hint = styled.div<{ $warn?: boolean }>`font-size: 0.75rem; line-height: 1.5; color: ${(p) => (p.$warn ? '#B91C1C' : '#94A3B8')};`;
const Closed = styled.div`
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  padding: 8px 12px; border-radius: 8px; background: #FFFBEB; border: 1px solid #FDE68A; color: #B45309; font-size: 0.8125rem;
  a { color: #B45309; font-weight: 600; }
`;
const inputCss = `
  width: 100%; box-sizing: border-box; padding: 9px 12px; min-height: 40px;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; color: #0F172A; background: #FFFFFF;
  outline: none; transition: border-color 120ms; font-family: inherit;
  &:focus { border-color: #14B8A6; }
  &::placeholder { color: #CBD5E1; }
`;
const Input = styled.input`${inputCss}`;
const TextArea = styled.textarea`${inputCss} resize: vertical; line-height: 1.5;`;
const RefillSelect = styled.div`flex: 1; min-width: 180px;`;
const ToggleLine = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 16px;`;
const PhotoRow = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const PhotoThumb = styled.img`width: 48px; height: 48px; border-radius: 50%; object-fit: cover;`;
const RefillRow = styled.div`display: flex; gap: 8px; flex-wrap: wrap; align-items: center;`;
const SwatchRow = styled.div`display: flex; gap: 10px; flex-wrap: wrap;`;
const Swatch = styled.button<{ $c: string; $on: boolean }>`
  width: 32px; height: 32px; border-radius: 50%; background: ${(p) => p.$c}; cursor: pointer;
  border: 3px solid ${(p) => (p.$on ? '#FFFFFF' : 'transparent')};
  box-shadow: 0 0 0 ${(p) => (p.$on ? '2px' : '1px')} ${(p) => (p.$on ? p.$c : '#E2E8F0')};
  @media (max-width: 640px) { width: 40px; height: 40px; }
`;
const LinkList = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const LinkRow = styled.div`
  display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) 36px; gap: 6px; align-items: center;
  @media (max-width: 640px) { grid-template-columns: minmax(0, 1fr) 40px; & > input:nth-child(2) { grid-column: 1; grid-row: 2; } & > button { grid-row: 1 / span 2; grid-column: 2; } }
`;
const RemoveBtn = styled.button`
  width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFFFFF; color: #64748B; cursor: pointer;
  &:hover { color: #B91C1C; border-color: #FCA5A5; }
  @media (max-width: 640px) { width: 40px; height: 40px; }
`;
const AddLink = styled.button`
  align-self: flex-start; min-height: 36px; padding: 0 12px; border: 1px dashed #CBD5E1; border-radius: 8px;
  background: #FFFFFF; color: #0F766E; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  &:hover { border-color: #14B8A6; }
`;
