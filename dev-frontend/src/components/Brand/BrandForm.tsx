// 브랜드 편집 폼 — 설정 > 워크스페이스 «브랜드» 목록의 드로어와 내 명함의 «개인 브랜드» 창이 **같은 폼**을 쓴다.
//   설계 docs/NAME_CARD_V2_DESIGN.md 결정 1. 칸마다 자동저장(AutoSaveField) · 실패는 던져 ! 뱃지 + 칸 아래 문장.
//   어느 쪽 브랜드인지 모른다 — 저장 문은 BrandApi(워크스페이스/개인)로 받는다.
//   ★ 칸 인스턴스는 브랜드마다 key 로 가른다(다른 브랜드로 바뀌어도 떠난 브랜드의 입력이 새 브랜드에 저장되지 않게).
import React, { useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AutoSaveField, { type AutoSaveHandle } from '../Common/AutoSaveField';
import ActionButton from '../Common/ActionButton';
import PlanQSelect from '../Common/PlanQSelect';
import type { BrandApi, BrandPatch } from '../../services/brands';
import { CardApiError, type BrandItem, type BrandLink, type BrandLinkKind } from '../../services/nameCards';

const KINDS: BrandLinkKind[] = ['website', 'instagram', 'facebook', 'x', 'youtube', 'linkedin', 'threads', 'tiktok', 'blog', 'kakao', 'other'];

interface Props {
  brand: BrandItem;
  api: BrandApi;
  readOnly?: boolean;
  onChanged: (b: BrandItem) => void;
}

function errText(t: (k: string) => string, e: unknown): string {
  const code = e instanceof CardApiError ? e.code : 'generic';
  const known = ['invalid_url', 'name_required', 'too_many_links', 'image_unreadable', 'logo_too_large'];
  return t(`brand.errors.${known.includes(code) ? code : 'generic'}`);
}

const BrandForm: React.FC<Props> = ({ brand, api, readOnly, onChanged }) => {
  const { t } = useTranslation('cards');
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState<string | null>(null);
  const save = async (p: BrandPatch) => { onChanged(await api.update(brand.id, p)); };
  const k = (f: string) => `${brand.id}-${f}`;

  const onLogo = async (f: File) => {
    setBusy(true); setLogoMsg(null);
    try { onChanged(await api.uploadLogo(brand.id, f)); } catch (e) { setLogoMsg(errText(t as unknown as (k: string) => string, e)); } finally { setBusy(false); }
  };
  const removeLogo = async () => {
    setBusy(true); setLogoMsg(null);
    try { onChanged(await api.removeLogo(brand.id)); } catch (e) { setLogoMsg(errText(t as unknown as (k: string) => string, e)); } finally { setBusy(false); }
  };

  return (
    <Wrap>
      <Text key={k('name')} label={t('brand.name')} value={brand.name} max={100} required disabled={readOnly} onSave={(v) => save({ name: v })} testId="brand-field-name" />
      <Text key={k('name_en')} label={t('brand.nameEn')} value={brand.name_en} max={100} disabled={readOnly} onSave={(v) => save({ name_en: v || null })} />
      <Text key={k('tagline')} label={t('brand.tagline')} value={brand.tagline} max={200} placeholder={t('brand.taglinePlaceholder') as string} disabled={readOnly} onSave={(v) => save({ tagline: v || null })} testId="brand-field-tagline" />
      <Text key={k('tagline_en')} label={t('brand.taglineEn')} value={brand.tagline_en} max={200} disabled={readOnly} onSave={(v) => save({ tagline_en: v || null })} />

      <Field>
        <Label as="div">{t('brand.logo')}</Label>
        <LogoRow>
          {brand.logo_url && <LogoImg src={brand.logo_url} alt="" />}
          {!readOnly && (
            <>
              <ActionButton tone="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy} loading={busy} data-testid="brand-logo-pick">
                {brand.logo_url ? t('brand.logoChange') : t('brand.logoAdd')}
              </ActionButton>
              {brand.logo_url && <ActionButton tone="secondary" size="sm" onClick={() => void removeLogo()} disabled={busy}>{t('brand.logoRemove')}</ActionButton>}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-testid="brand-logo-input"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onLogo(f); }} />
            </>
          )}
        </LogoRow>
        <Hint $warn={!!logoMsg}>{logoMsg || t('brand.logoHint')}</Hint>
      </Field>

      <LinksEditor key={k('links')} value={brand.links} disabled={readOnly} onSave={(links) => save({ links })} />
    </Wrap>
  );
};
export default BrandForm;

const Text: React.FC<{
  label: string; value: string | null; max: number; onSave: (v: string) => Promise<void>;
  required?: boolean; disabled?: boolean; placeholder?: string; testId?: string;
}> = ({ label, value, max, onSave, required, disabled, placeholder, testId }) => {
  const { t } = useTranslation('cards');
  const [v, setV] = useState(value || '');
  const [err, setErr] = useState<string | null>(null);
  const id = useRef(`bf-${Math.random().toString(36).slice(2)}`).current;
  const persist = async () => {
    setErr(null);
    if (required && !v.trim()) { setErr(t('brand.errors.name_required')); throw new Error('name_required'); }
    try { await onSave(v); } catch (e) { setErr(errText(t as unknown as (k: string) => string, e)); throw e; }
  };
  return (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <AutoSaveField onSave={persist}>
        <Input id={id} value={v} maxLength={max} placeholder={placeholder} disabled={disabled} data-testid={testId}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setV(e.target.value)} />
      </AutoSaveField>
      {err && <Hint $warn role="alert">{err}</Hint>}
    </Field>
  );
};

const LinksEditor: React.FC<{ value: BrandLink[]; disabled?: boolean; onSave: (l: BrandLink[]) => Promise<void> }> = ({ value, disabled, onSave }) => {
  const { t } = useTranslation('cards');
  const [rows, setRows] = useState<BrandLink[]>(value || []);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<AutoSaveHandle>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const change = (next: BrandLink[]) => { setRows(next); ref.current?.triggerSave(); };
  const persist = async () => {
    setErr(null);
    try { await onSave(rowsRef.current.filter((r) => r.url.trim())); } catch (e) { setErr(errText(t as unknown as (k: string) => string, e)); throw e; }
  };
  const kindOptions = KINDS.map((k) => ({ value: k, label: t(`brand.kind.${k}`) as string }));
  return (
    <Field>
      <Label as="div">{t('brand.links')}</Label>
      <AutoSaveField ref={ref} type="list" debounceMs={1500} onSave={persist}>
        <LinkList>
          {rows.map((r, i) => (
            <LinkRow key={i}>
              <KindCell>
                <PlanQSelect size="sm" isSearchable={false} isDisabled={disabled} aria-label={t('brand.linkKind') as string}
                  options={kindOptions} value={kindOptions.find((o) => o.value === r.kind) || kindOptions[kindOptions.length - 1]}
                  onChange={(o) => change(rows.map((x, j) => (j === i ? { ...x, kind: ((o as { value: BrandLinkKind } | null)?.value || 'other') } : x)))} />
              </KindCell>
              <Input value={r.url} maxLength={300} placeholder="https://" inputMode="url" aria-label="URL" disabled={disabled}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => change(rows.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              {!disabled && (
                <RemoveBtn type="button" aria-label={t('brand.linkRemove') as string} title={t('brand.linkRemove') as string}
                  onClick={() => change(rows.filter((_, j) => j !== i))}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
                </RemoveBtn>
              )}
            </LinkRow>
          ))}
          {!disabled && rows.length < 8 && (
            <AddLink type="button" data-testid="brand-link-add" onClick={() => setRows([...rows, { kind: rows.length ? 'other' : 'website', label: '', url: '' }])}>+ {t('brand.linkAdd')}</AddLink>
          )}
        </LinkList>
      </AutoSaveField>
      <Hint $warn={!!err}>{err || t('brand.linksHint')}</Hint>
    </Field>
  );
};

const Wrap = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px; min-width: 0;`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #64748B;`;
const Hint = styled.div<{ $warn?: boolean }>`font-size: 0.75rem; line-height: 1.5; color: ${(p) => (p.$warn ? '#B91C1C' : '#94A3B8')};`;
const Input = styled.input`
  width: 100%; box-sizing: border-box; padding: 9px 12px; min-height: 40px;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; color: #0F172A; background: #FFFFFF;
  outline: none; font-family: inherit;
  &:focus { border-color: #14B8A6; }
  &:disabled { background: #F8FAFC; color: #64748B; }
  &::placeholder { color: #CBD5E1; }
`;
const LogoRow = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const LogoImg = styled.img`width: 40px; height: 40px; object-fit: contain; border-radius: 8px; border: 1px solid #E2E8F0; background: #FFFFFF;`;
const LinkList = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const LinkRow = styled.div`
  display: grid; grid-template-columns: 140px minmax(0, 1fr) 36px; gap: 6px; align-items: center;
  @media (max-width: 640px) { grid-template-columns: minmax(0, 1fr) 40px; & > :nth-child(2) { grid-column: 1; grid-row: 2; } & > button { grid-row: 1 / span 2; grid-column: 2; } }
`;
const KindCell = styled.div`min-width: 0;`;
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
