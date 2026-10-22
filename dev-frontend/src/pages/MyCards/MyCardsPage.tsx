// 내 명함 — /me/cards (내 계정). 설계 docs/BUSINESS_CARD_DESIGN.md
//
// Irene 2026-10-17: «내 계정에 내 명함 메뉴 … 자동으로 불러올 거 불러오고 … 종류마다 다르게 쓰게 추가 … 웹페이지에 제대로 나오게 …
//   링크랑 큐알 … 명함마다 다르게 … 사진도 넣으면 나오고 안넣으면 안나오고 … 받은 사람은 다운받아서 저장 … 명함 보관처럼»
//
// 탭 «내 명함 / 받은 명함»(?tab=saved) · 편집 드로어 ?card=:id · 받은 명함 상세 ?saved=:id — 주소에서 매 렌더 읽는다(keep-alive 탭에서도 걸리게).
// 실시간(규칙 16): 서버가 `user:<나>` 방에 `namecard:changed` 신호만 보낸다 → 다시 읽는다 · 탭 복귀에도 다시 읽는다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import { SegmentedToggle, SegmentedBtn } from '../../components/Common/segmentedToggle';
import { HeaderCta } from '../../components/Common/headerCta';
import EmptyState from '../../components/Common/EmptyState';
import OverflowMenu, { type OverflowItem } from '../../components/Common/OverflowMenu';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import ActionButton from '../../components/Common/ActionButton';
import CardFace from '../../components/NameCard/CardFace';
import { useAuth } from '../../contexts/AuthContext';
import { useAuthedImageSrc } from '../../hooks/useAuthedImageSrc';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { onSocket } from '../../services/socket';
import {
  listMyCards, listSavedCards, listPrefillSources, patchCard, deleteCard, rotateCardToken, duplicateCard, reorderCards, myCardPhotoUrl,
  setDefaultCard, unsetDefaultCard,
  type MyCard, type SavedCard, type PrefillSource,
} from '../../services/nameCards';
import CardEditorDrawer from './CardEditorDrawer';
import CardQrModal from '../../components/NameCard/CardQrModal';
import CreateCardModal from './CreateCardModal';
import SavedCardsPanel from './SavedCardsPanel';

type Ask = { kind: 'delete' | 'rotate'; card: MyCard } | null;

const MyCardsPage: React.FC = () => {
  const { t } = useTranslation('cards');
  const { t: tl } = useTranslation('layout');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'saved' ? 'saved' : 'mine';
  const editId = Number(params.get('card')) || null;
  const savedId = Number(params.get('saved')) || null;

  const [cards, setCards] = useState<MyCard[] | null>(null);
  const [saved, setSaved] = useState<SavedCard[] | null>(null);
  const [sources, setSources] = useState<PrefillSource[]>([]);
  const [loadErr, setLoadErr] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [qrId, setQrId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([listMyCards(), listSavedCards()]);
      setCards(c); setSaved(s); setLoadErr(false);
    } catch { setLoadErr(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { listPrefillSources().then(setSources).catch(() => setSources([])); }, []);
  useVisibilityRefresh(load);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    const kick = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { void load(); }, 250);
    };
    // 브랜드를 고치면(설정·개인) 명함에 실린 브랜드도 바뀐다 — 같이 다시 읽는다
    const offA = onSocket('namecard:changed', kick);
    const offB = onSocket('brand:updated', kick);
    return () => { offA(); offB(); };
  }, [load]);

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v == null) next.delete(k); else next.set(k, v); }
    setParams(next, { replace: false });
  };

  const upsert = (c: MyCard) => setCards((prev) => {
    if (!prev) return [c];
    return prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c];
  });

  const copyLink = async (c: MyCard) => {
    try {
      await navigator.clipboard.writeText(c.url);
      setCopiedId(c.id);
      window.setTimeout(() => setCopiedId((id) => (id === c.id ? null : id)), 1800);
    } catch { setActionErr(c.url); }
  };

  const act = async (fn: () => Promise<void>) => {
    setActionErr(null);
    try { await fn(); } catch { setActionErr(t('editor.errors.generic') as string); }
  };

  const move = (c: MyCard, dir: -1 | 1) => act(async () => {
    if (!cards) return;
    const i = cards.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cards.length) return;
    const next = [...cards];
    [next[i], next[j]] = [next[j], next[i]];
    setCards(next);
    await reorderCards(next.map((x) => x.id));
  });

  const menuFor = (c: MyCard, idx: number): OverflowItem[] => [
    { key: 'open', label: t('card.openPage'), onClick: () => window.open(c.url, '_blank', 'noopener'), disabled: !c.link_open },
    { key: 'pub', label: c.is_public ? t('card.turnOff') : t('card.turnOn'), onClick: () => void act(async () => upsert(await patchCard(c.id, { is_public: !c.is_public }))) },
    { key: 'rotate', label: t('card.rotate'), onClick: () => setAsk({ kind: 'rotate', card: c }) },
    // 워크스페이스 기본 명함(v2 결정 3) — 그 워크스페이스 동료가 사람 팝오버·멤버 상세·조직도에서 이 명함을 본다
    ...sources.map((w, i) => (c.default_for.includes(w.business_id)
      ? { key: `undef-${w.business_id}`, label: t('defaultCard.unset', { name: w.name }), onClick: () => void act(async () => upsert(await unsetDefaultCard(c.id, w.business_id))), dividerBefore: i === 0, testId: `card-undefault-${c.id}-${w.business_id}` }
      : { key: `def-${w.business_id}`, label: t('defaultCard.set', { name: w.name }), onClick: () => void act(async () => { await setDefaultCard(c.id, w.business_id); await load(); }), dividerBefore: i === 0, testId: `card-default-${c.id}-${w.business_id}` })),
    { key: 'dup', label: t('card.duplicate'), onClick: () => void act(async () => upsert(await duplicateCard(c.id))), dividerBefore: true },
    { key: 'up', label: t('card.moveUp'), onClick: () => void move(c, -1), disabled: idx === 0 },
    { key: 'down', label: t('card.moveDown'), onClick: () => void move(c, 1), disabled: !cards || idx === cards.length - 1 },
    { key: 'del', label: t('card.delete'), onClick: () => setAsk({ kind: 'delete', card: c }), danger: true, dividerBefore: true, testId: `card-delete-${c.id}` },
  ];

  const editing = cards?.find((c) => c.id === editId) || null;
  const qrCard = cards?.find((c) => c.id === qrId) || null;

  return (
    <PageShell
      title={tl('nav.myCards', '내 명함') as string}
      actions={(
        <>
          <SegmentedToggle role="tablist">
            <SegmentedBtn type="button" role="tab" aria-selected={tab === 'mine'} $active={tab === 'mine'} data-testid="cards-tab-mine"
              onClick={() => setParam({ tab: null, saved: null })}>
              {t('page.tabMine')}{cards ? ` ${cards.length}` : ''}
            </SegmentedBtn>
            <SegmentedBtn type="button" role="tab" aria-selected={tab === 'saved'} $active={tab === 'saved'} data-testid="cards-tab-saved"
              onClick={() => setParam({ tab: 'saved', card: null })}>
              {t('page.tabSaved')}{saved ? ` ${saved.length}` : ''}
            </SegmentedBtn>
          </SegmentedToggle>
          {tab === 'mine' && (
            <HeaderCta type="button" $collapseOnPhone aria-label={t('page.add') as string} data-testid="cards-add"
              onClick={() => setCreateOpen(true)}>+ <span>{t('page.add')}</span></HeaderCta>
          )}
        </>
      )}
    >
      {actionErr && <ErrBar role="alert">{actionErr}</ErrBar>}
      {loadErr && !cards ? (
        <EmptyState title={t('page.loadError')} ctaLabel={t('public.retry') as string} onCta={() => void load()} />
      ) : tab === 'saved' ? (
        saved && <SavedCardsPanel items={saved} selectedId={savedId}
          onSelect={(id) => setParam({ saved: id ? String(id) : null })}
          onChanged={(s) => setSaved((prev) => (prev ? prev.map((x) => (x.id === s.id ? s : x)) : [s]))}
          onDeleted={(id) => { setSaved((prev) => (prev ? prev.filter((x) => x.id !== id) : prev)); setParam({ saved: null }); }} />
      ) : cards && cards.length === 0 ? (
        <EmptyState title={t('page.emptyTitle')} description={t('page.emptyHint')} ctaLabel={`+ ${t('page.add')}`} onCta={() => setCreateOpen(true)} ctaTestId="cards-empty-add" />
      ) : (
        <Grid data-testid="cards-grid">
          {(cards || []).map((c, idx) => (
            <CardTile key={c.id} card={c} active={c.id === editId} copied={copiedId === c.id}
              defaultNames={c.default_for.map((id) => sources.find((w) => w.business_id === id)?.name).filter(Boolean) as string[]}
              onEdit={() => setParam({ card: c.id === editId ? null : String(c.id) })}
              onQr={() => setQrId(c.id)} onCopy={() => void copyLink(c)}
              menu={<OverflowMenu label={t('card.more') as string} items={menuFor(c, idx)} />} />
          ))}
        </Grid>
      )}

      <CardEditorDrawer card={editing} sources={sources} onClose={() => setParam({ card: null })} onChanged={upsert} />
      <CardQrModal card={qrCard} onClose={() => setQrId(null)} onCopy={(c) => void copyLink(c)} copied={!!qrCard && copiedId === qrCard.id} />
      <CreateCardModal open={createOpen} sources={sources} defaultSource={user?.business_id ?? null}
        onClose={() => setCreateOpen(false)}
        onCreated={(c) => { setCreateOpen(false); upsert(c); setParam({ card: String(c.id) }); }} />
      <ConfirmDialog isOpen={!!ask} onClose={() => setAsk(null)} variant={ask?.kind === 'delete' ? 'danger' : 'warning'}
        title={ask?.kind === 'delete' ? t('confirm.deleteTitle') : t('confirm.rotateTitle')}
        message={ask?.kind === 'delete' ? t('confirm.delete') : t('confirm.rotate')}
        confirmText={(ask?.kind === 'delete' ? t('confirm.deleteBtn') : t('confirm.rotateBtn')) as string}
        cancelText={t('confirm.cancel') as string}
        onConfirm={() => {
          const a = ask; setAsk(null);
          if (!a) return;
          if (a.kind === 'delete') {
            void act(async () => {
              await deleteCard(a.card.id);
              setCards((prev) => (prev ? prev.filter((x) => x.id !== a.card.id) : prev));
              if (editId === a.card.id) setParam({ card: null });
            });
          } else void act(async () => upsert(await rotateCardToken(a.card.id)));
        }} />
    </PageShell>
  );
};
export default MyCardsPage;

const CardTile: React.FC<{
  card: MyCard; active: boolean; copied: boolean; menu: React.ReactNode; defaultNames: string[];
  onEdit: () => void; onQr: () => void; onCopy: () => void;
}> = ({ card, active, copied, menu, defaultNames, onEdit, onQr, onCopy }) => {
  const { t } = useTranslation('cards');
  const photo = useAuthedImageSrc(myCardPhotoUrl(card));
  return (
    <Tile $active={active} data-testid={`card-tile-${card.id}`}>
      <TileHead>
        <TileLabel title={card.label}>{card.label}</TileLabel>
        {!card.link_open && <ClosedChip title={card.closed_reason ? (t(`card.closed.${card.closed_reason}`) as string) : undefined}>{t('card.publicOff')}</ClosedChip>}
        {menu}
      </TileHead>
      {defaultNames.length > 0 && (
        <DefaultChips>{defaultNames.map((n) => <DefaultChip key={n} data-testid={`card-default-chip-${card.id}`}>{t('defaultCard.chip', { name: n })}</DefaultChip>)}</DefaultChips>
      )}
      <FaceBtn type="button" onClick={onEdit} aria-label={`${t('card.edit')} — ${card.label}`}>
        <CardFace view={card} photoSrc={photo} variant="compact" />
      </FaceBtn>
      {!card.link_open && card.closed_reason && card.closed_reason !== 'not_public' && (
        <ClosedHint>{t(`card.closed.${card.closed_reason}`)}</ClosedHint>
      )}
      <TileActions>
        <ActionButton tone="secondary" size="sm" onClick={onCopy} data-testid={`card-copy-${card.id}`}>{copied ? t('card.linkCopied') : t('card.linkCopy')}</ActionButton>
        <ActionButton tone="secondary" size="sm" onClick={onQr} data-testid={`card-qr-${card.id}`}>{t('card.qr')}</ActionButton>
        <ActionButton tone="primary" size="sm" onClick={onEdit} data-testid={`card-edit-${card.id}`}>{t('card.edit')}</ActionButton>
      </TileActions>
    </Tile>
  );
};

const Grid = styled.div`
  display: grid; gap: 16px;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
`;
const Tile = styled.div<{ $active: boolean }>`
  display: flex; flex-direction: column; gap: 10px; min-width: 0;
  padding: 12px; border-radius: 14px; background: #FFFFFF;
  border: 1px solid ${(p) => (p.$active ? '#14B8A6' : '#E2E8F0')};
  box-shadow: ${(p) => (p.$active ? '0 0 0 3px rgba(20,184,166,0.12)' : 'none')};
`;
const TileHead = styled.div`display: flex; align-items: center; gap: 8px; min-width: 0;`;
const TileLabel = styled.div`flex: 1; min-width: 0; font-size: 0.875rem; font-weight: 700; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const ClosedChip = styled.span`
  flex-shrink: 0; font-size: 0.6875rem; font-weight: 600; padding: 2px 8px; border-radius: 999px;
  background: #FFFBEB; color: #B45309; border: 1px solid #FDE68A;
`;
const DefaultChips = styled.div`display: flex; flex-wrap: wrap; gap: 4px; margin-top: -4px;`;
const DefaultChip = styled.span`
  font-size: 0.6875rem; font-weight: 600; padding: 2px 8px; border-radius: 999px;
  background: #F0FDFA; color: #0F766E; border: 1px solid #99F6E4; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const ClosedHint = styled.div`font-size: 0.75rem; color: #B45309;`;
const FaceBtn = styled.button`
  display: block; width: 100%; padding: 0; border: none; background: none; text-align: left; cursor: pointer; border-radius: 12px;
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const TileActions = styled.div`
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px;
  & > button { width: 100%; }
`;
const ErrBar = styled.div`margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; background: #FEF2F2; color: #B91C1C; font-size: 0.8125rem; word-break: break-all;`;
