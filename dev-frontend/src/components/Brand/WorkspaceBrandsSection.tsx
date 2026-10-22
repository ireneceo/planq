// 설정 > 워크스페이스 — «브랜드» 목록. 설계 docs/NAME_CARD_V2_DESIGN.md 결정 1·2 (Fable 2026-10-22)
//   회사(워크스페이스) 하나에 브랜드 여럿. 기본 브랜드 = 워크스페이스 이름·소개·로고(위 칸들과 같은 값 — 서버가 사본을 맞춘다).
//   행 = 로고·이름·소개·링크 n·[기본] 칩 · 누르면 우측 DetailDrawer 에서 BrandForm(명함의 개인 브랜드와 같은 폼).
//   쓰기는 대표·관리자만(서버도 같은 판정) — 멤버는 읽기만(명함에 고를 수 있다).
//   실시간: brand:updated 신호 → 다시 읽는다.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../Common/DetailDrawer';
import ActionButton from '../Common/ActionButton';
import ConfirmDialog from '../Common/ConfirmDialog';
import StandardModal from '../Common/StandardModal';
import BrandForm from './BrandForm';
import { onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { workspaceBrandApi } from '../../services/brands';
import { CardApiError, type BrandItem } from '../../services/nameCards';

interface Props { businessId: number; canEdit: boolean; onDefaultChanged?: () => void }

const WorkspaceBrandsSection: React.FC<Props> = ({ businessId, canEdit, onDefaultChanged }) => {
  const { t } = useTranslation('cards');
  const api = useMemo(() => workspaceBrandApi(businessId), [businessId]);
  const [items, setItems] = useState<BrandItem[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState<BrandItem | null>(null);

  const load = useCallback(async () => {
    try { setItems(await api.list()); } catch { /* 목록 실패는 다음 갱신에 맡긴다 */ }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useVisibilityRefresh(load);
  useEffect(() => onSocket('brand:updated', () => { void load(); }), [load]);

  const open = items?.find((b) => b.id === openId) || null;
  const upsert = (b: BrandItem) => {
    setItems((prev) => (prev ? prev.map((x) => (x.id === b.id ? { ...x, ...b } : x)) : [b]));
    if (b.is_default) onDefaultChanged?.();
  };

  const create = async () => {
    if (busy || !newName.trim()) return;
    setBusy(true); setErr(null);
    try {
      const b = await api.create({ name: newName.trim() });
      setItems((prev) => [...(prev || []), b]);
      setAdding(false); setNewName(''); setOpenId(b.id);
    } catch (e) {
      setErr(e instanceof CardApiError && e.code === 'too_many_brands' ? t('brand.errors.too_many_brands') : t('brand.errors.generic'));
    } finally { setBusy(false); }
  };
  const makeDefault = async (b: BrandItem) => {
    if (!api.setDefault) return;
    setErr(null);
    try { await api.setDefault(b.id); await load(); onDefaultChanged?.(); } catch { setErr(t('brand.errors.generic')); }
  };
  const remove = async (b: BrandItem) => {
    setErr(null);
    try { await api.remove(b.id); setOpenId(null); await load(); if (b.is_default) onDefaultChanged?.(); }
    catch (e) { setErr(e instanceof CardApiError && e.code === 'last_brand' ? t('brand.errors.last_brand') : t('brand.errors.generic')); }
  };

  return (
    <Card data-testid="ws-brands">
      <Head>
        <div>
          <Title>{t('brand.sectionTitle')}</Title>
          <Desc>{t('brand.sectionDesc')}</Desc>
        </div>
        {canEdit && <ActionButton tone="secondary" size="sm" onClick={() => { setAdding(true); setErr(null); }} data-testid="ws-brand-add">+ {t('brand.add')}</ActionButton>}
      </Head>
      {err && <Err role="alert">{err}</Err>}
      <List>
        {(items || []).map((b) => (
          <Row key={b.id} type="button" $active={b.id === openId} onClick={() => setOpenId(b.id === openId ? null : b.id)} data-testid={`ws-brand-row-${b.id}`}>
            {b.logo_url ? <Logo src={b.logo_url} alt="" /> : <LogoBlank aria-hidden>{(b.name || '?').slice(0, 1)}</LogoBlank>}
            <Main>
              <Name>{b.name}{b.is_default && <DefaultChip>{t('brand.default')}</DefaultChip>}</Name>
              {b.tagline && <Sub>{b.tagline}</Sub>}
            </Main>
            <Meta>
              {b.links.length > 0 && <span>{t('brand.linkCount', { count: b.links.length })}</span>}
              {!!b.card_count && <span>{t('brand.cardCount', { count: b.card_count })}</span>}
            </Meta>
          </Row>
        ))}
      </List>

      <DetailDrawer open={!!open} onClose={() => setOpenId(null)} ariaLabel={t('brand.drawerAria') as string}>
        {open && (
          <>
            <DetailDrawer.Header onClose={() => setOpenId(null)}><DrawerTitle>{open.name}</DrawerTitle></DetailDrawer.Header>
            <DetailDrawer.Body>
              {open.is_default && <Note>{t('brand.defaultNote')}</Note>}
              <BrandForm key={open.id} brand={open} api={api} readOnly={!canEdit} onChanged={upsert} />
            </DetailDrawer.Body>
            {canEdit && (
              <DetailDrawer.Footer>
                {!open.is_default && <ActionButton tone="secondary" size="md" onClick={() => void makeDefault(open)} data-testid="ws-brand-make-default">{t('brand.makeDefault')}</ActionButton>}
                <ActionButton tone="danger" size="md" onClick={() => setAskDelete(open)} data-testid="ws-brand-delete">{t('brand.delete')}</ActionButton>
              </DetailDrawer.Footer>
            )}
          </>
        )}
      </DetailDrawer>

      <StandardModal open={adding} onClose={() => setAdding(false)} title={t('brand.add')} size="sm"
        footer={(
          <>
            <ActionButton tone="secondary" size="md" onClick={() => setAdding(false)}>{t('create.cancel')}</ActionButton>
            <ActionButton tone="primary" size="md" onClick={() => void create()} loading={busy} disabled={busy || !newName.trim()} data-testid="ws-brand-create">{t('create.submit')}</ActionButton>
          </>
        )}>
        <FieldLabel htmlFor="ws-brand-new-name">{t('brand.name')}</FieldLabel>
        <TextInput id="ws-brand-new-name" value={newName} maxLength={100} autoFocus data-testid="ws-brand-new-name"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void create(); }} />
      </StandardModal>

      <ConfirmDialog isOpen={!!askDelete} onClose={() => setAskDelete(null)} variant="danger"
        title={t('brand.deleteTitle')}
        message={askDelete?.card_count ? t('brand.deleteMsgCards', { count: askDelete.card_count }) : t('brand.deleteMsg')}
        confirmText={t('brand.delete') as string} cancelText={t('confirm.cancel') as string}
        onConfirm={() => { const b = askDelete; setAskDelete(null); if (b) void remove(b); }} />
    </Card>
  );
};
export default WorkspaceBrandsSection;

const Card = styled.section`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 20px; margin-top: 16px;
  display: flex; flex-direction: column; gap: 12px;
`;
const Head = styled.div`display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap;`;
const Title = styled.h2`margin: 0 0 4px; font-size: 1rem; font-weight: 700; color: #0F172A;`;
const Desc = styled.p`margin: 0; font-size: 0.8125rem; color: #64748B; line-height: 1.5;`;
const Err = styled.div`font-size: 0.8125rem; color: #B91C1C;`;
const List = styled.div`display: flex; flex-direction: column; border: 1px solid #F1F5F9; border-radius: 10px; overflow: hidden;`;
const Row = styled.button<{ $active: boolean }>`
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; cursor: pointer;
  padding: 10px 12px; min-height: 56px; box-sizing: border-box; border: none; border-bottom: 1px solid #F1F5F9;
  background: ${(p) => (p.$active ? '#F0FDFA' : '#FFFFFF')};
  &:last-child { border-bottom: none; }
  &:hover { background: ${(p) => (p.$active ? '#F0FDFA' : '#F8FAFC')}; }
`;
const Logo = styled.img`width: 36px; height: 36px; object-fit: contain; border-radius: 8px; border: 1px solid #E2E8F0; background: #FFFFFF; flex-shrink: 0;`;
const LogoBlank = styled.span`
  width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  background: #F1F5F9; color: #64748B; font-weight: 700; font-size: 0.875rem;
`;
const Main = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const Name = styled.div`display: flex; align-items: center; gap: 6px; font-size: 0.875rem; font-weight: 600; color: #0F172A; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Sub = styled.div`font-size: 0.75rem; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const Meta = styled.div`
  display: flex; gap: 8px; flex-shrink: 0; font-size: 0.75rem; color: #94A3B8;
  @media (max-width: 640px) { flex-direction: column; align-items: flex-end; gap: 2px; }
`;
const DefaultChip = styled.span`
  flex-shrink: 0; font-size: 0.6875rem; font-weight: 600; padding: 1px 8px; border-radius: 999px;
  background: #F0FDFA; color: #0F766E; border: 1px solid #99F6E4;
`;
const DrawerTitle = styled.h2`margin: 0; font-size: 1rem; font-weight: 700; color: #0F172A; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Note = styled.div`padding: 10px 12px; border-radius: 8px; background: #F0FDFA; border: 1px solid #99F6E4; color: #0F766E; font-size: 0.8125rem; line-height: 1.5;`;
const FieldLabel = styled.label`font-size: 0.8125rem; font-weight: 600; color: #475569;`;
const TextInput = styled.input`
  width: 100%; box-sizing: border-box; padding: 9px 12px; min-height: 40px;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; color: #0F172A; outline: none; font-family: inherit;
  &:focus { border-color: #14B8A6; }
`;
