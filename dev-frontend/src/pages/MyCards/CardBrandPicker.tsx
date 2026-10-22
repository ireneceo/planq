// 명함 편집 — «브랜드» 칸. 설계 docs/NAME_CARD_V2_DESIGN.md 결정 1
//   고를 수 있는 것 = 내 개인 브랜드 + 내가 멤버인 워크스페이스 브랜드(서버 /api/name-cards/brand-options 가 같은 판정으로 준다).
//   고른 순서가 표시 순서(첫 브랜드가 회사 자리). 최대 4. 저장은 AutoSaveField 한 번(고르면 화면만 바꾸고 래퍼가 저장).
//   개인 브랜드는 여기서 만들고 고친다(설정의 워크스페이스 브랜드와 같은 BrandForm).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AutoSaveField, { type AutoSaveHandle } from '../../components/Common/AutoSaveField';
import StandardModal from '../../components/Common/StandardModal';
import ActionButton from '../../components/Common/ActionButton';
import BrandForm from '../../components/Brand/BrandForm';
import { onSocket } from '../../services/socket';
import { myBrandApi } from '../../services/brands';
import { listBrandOptions, patchCard, CardApiError, type BrandItem, type MyCard } from '../../services/nameCards';

const MAX = 4;

interface Props { card: MyCard; onChanged: (c: MyCard) => void }

const CardBrandPicker: React.FC<Props> = ({ card, onChanged }) => {
  const { t } = useTranslation('cards');
  const api = useMemo(() => myBrandApi(), []);
  const [opts, setOpts] = useState<BrandItem[]>([]);
  const [sel, setSel] = useState<number[]>(card.brand_ids || []);
  const selRef = useRef(sel);
  selRef.current = sel;
  const saveRef = useRef<AutoSaveHandle>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: 'new' } | { mode: 'edit'; id: number } | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { try { setOpts(await listBrandOptions()); } catch { /* 다음 갱신에 */ } }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => onSocket('brand:updated', () => { void load(); }), [load]);

  const stage = (next: number[]) => { setSel(next); saveRef.current?.triggerSave(); };
  const toggle = (id: number) => {
    setErr(null);
    if (sel.includes(id)) stage(sel.filter((x) => x !== id));
    else if (sel.length >= MAX) setErr(t('brand.errors.too_many_brands_card', { max: MAX }));
    else stage([...sel, id]);
  };
  const toFront = (id: number) => stage([id, ...sel.filter((x) => x !== id)]);
  const persist = async () => {
    setErr(null);
    try { onChanged(await patchCard(card.id, { brand_ids: selRef.current })); }
    catch (e) { setErr(e instanceof CardApiError && e.code === 'too_many_brands' ? t('brand.errors.too_many_brands_card', { max: MAX }) : t('brand.errors.generic')); throw e; }
  };

  const groups = useMemo(() => {
    const mine = opts.filter((b) => b.owner_kind === 'user');
    const byBiz = new Map<number, { name: string; items: BrandItem[] }>();
    for (const b of opts.filter((x) => x.owner_kind === 'business')) {
      const k = b.business_id || 0;
      if (!byBiz.has(k)) byBiz.set(k, { name: b.business_name || '', items: [] });
      byBiz.get(k)!.items.push(b);
    }
    return { mine, biz: [...byBiz.values()] };
  }, [opts]);

  const createPersonal = async () => {
    if (busy || !newName.trim()) return;
    setBusy(true);
    try {
      const b = await api.create({ name: newName.trim() });
      setOpts((p) => [b, ...p]);
      setNewName('');
      setModal({ mode: 'edit', id: b.id });
    } catch { setErr(t('brand.errors.generic')); } finally { setBusy(false); }
  };
  const editing = modal && modal.mode === 'edit' ? opts.find((b) => b.id === modal.id) || null : null;

  const row = (b: BrandItem) => {
    const idx = sel.indexOf(b.id);
    return (
      <Option key={b.id} $on={idx >= 0}>
        <Check type="checkbox" checked={idx >= 0} onChange={() => toggle(b.id)} aria-label={b.name} data-testid={`card-brand-opt-${b.id}`} />
        {b.logo_url ? <Logo src={b.logo_url} alt="" /> : <LogoBlank aria-hidden>{(b.name || '?').slice(0, 1)}</LogoBlank>}
        <OptMain onClick={() => toggle(b.id)}>
          <OptName>{b.name}{b.is_default && b.owner_kind === 'business' && <Mini>{t('brand.default')}</Mini>}</OptName>
          {b.tagline && <OptSub>{b.tagline}</OptSub>}
        </OptMain>
        {idx > 0 && <SmallBtn type="button" onClick={() => toFront(b.id)}>{t('brand.toFront')}</SmallBtn>}
        {idx === 0 && sel.length > 1 && <Order>{t('brand.first')}</Order>}
        {b.owner_kind === 'user' && <SmallBtn type="button" onClick={() => setModal({ mode: 'edit', id: b.id })}>{t('card.edit')}</SmallBtn>}
      </Option>
    );
  };

  return (
    <Field>
      <Hint>{t('brand.pickerHint')}</Hint>
      <AutoSaveField ref={saveRef} type="list" onSave={persist}>
        <Groups data-testid="card-brand-picker">
          {groups.biz.map((g) => (
            <Group key={g.name}>
              <GroupTitle>{g.name}</GroupTitle>
              {g.items.map(row)}
            </Group>
          ))}
          <Group>
            <GroupTitle>{t('brand.personal')}</GroupTitle>
            {groups.mine.map(row)}
            <AddBtn type="button" onClick={() => { setNewName(''); setModal({ mode: 'new' }); }} data-testid="card-brand-personal-add">+ {t('brand.personalAdd')}</AddBtn>
          </Group>
        </Groups>
      </AutoSaveField>
      {err && <Hint $warn role="alert">{err}</Hint>}

      <StandardModal open={!!modal} onClose={() => setModal(null)} title={modal?.mode === 'new' ? t('brand.personalAdd') : (editing?.name || t('brand.personal'))} size="md"
        footer={modal?.mode === 'new' ? (
          <>
            <ActionButton tone="secondary" size="md" onClick={() => setModal(null)}>{t('create.cancel')}</ActionButton>
            <ActionButton tone="primary" size="md" onClick={() => void createPersonal()} loading={busy} disabled={busy || !newName.trim()} data-testid="card-brand-personal-create">{t('create.submit')}</ActionButton>
          </>
        ) : (
          <>
            {editing && (
              <ActionButton tone="danger" size="md" onClick={() => void (async () => {
                try { await api.remove(editing.id); setSel((p) => p.filter((x) => x !== editing.id)); setModal(null); await load(); } catch { setErr(t('brand.errors.generic')); }
              })()}>{t('brand.delete')}</ActionButton>
            )}
            <ActionButton tone="primary" size="md" onClick={() => setModal(null)}>{t('brand.done')}</ActionButton>
          </>
        )}>
        {modal?.mode === 'new' ? (
          <>
            <Label htmlFor="card-brand-new-name">{t('brand.name')}</Label>
            <TextInput id="card-brand-new-name" value={newName} maxLength={100} autoFocus data-testid="card-brand-new-name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void createPersonal(); }} />
            <Hint>{t('brand.personalHint')}</Hint>
          </>
        ) : editing ? (
          <BrandForm key={editing.id} brand={editing} api={api} onChanged={(b) => setOpts((p) => p.map((x) => (x.id === b.id ? { ...x, ...b } : x)))} />
        ) : null}
      </StandardModal>
    </Field>
  );
};
export default CardBrandPicker;

const Field = styled.div`display: flex; flex-direction: column; gap: 8px; min-width: 0;`;
const Hint = styled.div<{ $warn?: boolean }>`font-size: 0.75rem; line-height: 1.5; color: ${(p) => (p.$warn ? '#B91C1C' : '#94A3B8')};`;
const Groups = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const Group = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const GroupTitle = styled.div`font-size: 0.75rem; font-weight: 700; color: #475569;`;
const Option = styled.div<{ $on: boolean }>`
  display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 6px 8px; border-radius: 10px; box-sizing: border-box;
  border: 1px solid ${(p) => (p.$on ? '#99F6E4' : '#E2E8F0')}; background: ${(p) => (p.$on ? '#F0FDFA' : '#FFFFFF')};
`;
// 체크박스는 컨트롤 줄(행 48)이 높이를 정한다 — 상자 자체는 정사각(가로만 적는다)
const Check = styled.input`width: 18px; aspect-ratio: 1; margin: 0; accent-color: #14B8A6; flex-shrink: 0; cursor: pointer;`;
const Logo = styled.img`width: 32px; height: 32px; object-fit: contain; border-radius: 6px; flex-shrink: 0;`;
const LogoBlank = styled.span`
  width: 32px; height: 32px; border-radius: 6px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  background: #F1F5F9; color: #64748B; font-weight: 700; font-size: 0.75rem;
`;
const OptMain = styled.div`flex: 1; min-width: 0; cursor: pointer;`;
const OptName = styled.div`display: flex; align-items: center; gap: 6px; font-size: 0.875rem; font-weight: 600; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const OptSub = styled.div`font-size: 0.75rem; color: #64748B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Mini = styled.span`font-size: 0.6875rem; font-weight: 600; color: #0F766E; background: #CCFBF1; border-radius: 999px; padding: 0 6px;`;
const Order = styled.span`font-size: 0.6875rem; color: #0F766E; font-weight: 600; flex-shrink: 0;`;
const SmallBtn = styled.button`
  flex-shrink: 0; min-height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid #E2E8F0; background: #FFFFFF;
  font-size: 0.75rem; font-weight: 600; color: #475569; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; }
  @media (max-width: 640px) { min-height: 36px; }
`;
const AddBtn = styled.button`
  align-self: flex-start; min-height: 36px; padding: 0 12px; border: 1px dashed #CBD5E1; border-radius: 8px;
  background: #FFFFFF; color: #0F766E; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  &:hover { border-color: #14B8A6; }
`;
const Label = styled.label`font-size: 0.8125rem; font-weight: 600; color: #475569;`;
const TextInput = styled.input`
  width: 100%; box-sizing: border-box; padding: 9px 12px; min-height: 40px;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; color: #0F172A; outline: none; font-family: inherit;
  &:focus { border-color: #14B8A6; }
`;
