// 받은 명함(명함첩) — 목록 + 우측 상세(URL ?saved=:id). 설계 docs/BUSINESS_CARD_DESIGN.md §3·§4
//   보관본은 보관한 순간의 스냅샷이다 — 주인이 바꾸면 «바뀐 내용 있음» 을 보여 주고, [새로 받기] 로만 갱신한다.
//   원본 주소는 목록 응답에 없다(서버가 토큰을 싣지 않는다) — [원본 열기] 를 누를 때 한 번 묻는다.
import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../../components/Common/DetailDrawer';
import AutoSaveField from '../../components/Common/AutoSaveField';
import ActionButton from '../../components/Common/ActionButton';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import SearchBox from '../../components/Common/SearchBox';
import EmptyState from '../../components/Common/EmptyState';
import CardFace from '../../components/NameCard/CardFace';
import { useAuthedImageSrc } from '../../hooks/useAuthedImageSrc';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import {
  patchSavedMemo, refreshSavedCard, savedOpenLink, deleteSavedCard, downloadSavedVcf, savedPhotoUrl,
  type SavedCard,
} from '../../services/nameCards';

interface Props {
  items: SavedCard[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onChanged: (s: SavedCard) => void;
  onDeleted: (id: number) => void;
}

const SavedCardsPanel: React.FC<Props> = ({ items, selectedId, onSelect, onChanged, onDeleted }) => {
  const { t } = useTranslation('cards');
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return items;
    return items.filter((s) => [s.card.name, s.card.name_en, s.card.company, s.card.job_title, s.card.email, s.memo]
      .some((v) => (v || '').toLowerCase().includes(n)));
  }, [items, q]);
  const selected = items.find((s) => s.id === selectedId) || null;

  if (!items.length) {
    return <EmptyState title={t('saved.emptyTitle')} description={t('saved.emptyHint')} />;
  }
  return (
    <>
      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder={t('saved.searchPlaceholder') as string} size="sm" width="100%" ariaLabel={t('saved.searchPlaceholder') as string} />
      </Toolbar>
      {filtered.length === 0 ? <NoMatch>{t('saved.noMatch')}</NoMatch> : (
        <List data-testid="saved-list">
          {filtered.map((s) => (
            <SavedRow key={s.id} item={s} active={s.id === selectedId}
              onClick={() => onSelect(s.id === selectedId ? null : s.id)} />
          ))}
        </List>
      )}
      <DetailDrawer open={!!selected} onClose={() => onSelect(null)} ariaLabel={t('saved.aria') as string}>
        {selected && <SavedDetail key={selected.id} item={selected} onClose={() => onSelect(null)} onChanged={onChanged} onDeleted={onDeleted} />}
      </DetailDrawer>
    </>
  );
};
export default SavedCardsPanel;

const SavedRow: React.FC<{ item: SavedCard; active: boolean; onClick: () => void }> = ({ item, active, onClick }) => {
  const { t } = useTranslation('cards');
  const { formatDate } = useTimeFormat();
  const photo = useAuthedImageSrc(savedPhotoUrl(item));
  const c = item.card;
  const sub = [c.company, c.job_title].filter(Boolean).join(' · ');
  return (
    <Row type="button" $active={active} onClick={onClick} data-testid={`saved-row-${item.id}`}>
      {photo && item.has_photo ? <Thumb src={photo} alt="" /> : <ThumbBlank aria-hidden>{(c.name || '?').slice(0, 1)}</ThumbBlank>}
      <RowMain>
        <RowName>{c.name || '—'}</RowName>
        {sub && <RowSub>{sub}</RowSub>}
      </RowMain>
      <RowSide>
        {item.source_changed && <Badge $tone="mint">{t('saved.changed')}</Badge>}
        {!item.source_alive && <Badge $tone="gray">{t('saved.closed')}</Badge>}
        <RowDate>{t('saved.savedAt', { date: formatDate(item.saved_at) })}</RowDate>
      </RowSide>
    </Row>
  );
};

const SavedDetail: React.FC<{ item: SavedCard; onClose: () => void; onChanged: (s: SavedCard) => void; onDeleted: (id: number) => void }> = ({ item, onClose, onChanged, onDeleted }) => {
  const { t } = useTranslation('cards');
  const photo = useAuthedImageSrc(savedPhotoUrl(item));
  const [memo, setMemo] = useState(item.memo || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState(false);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setMsg(null);
    try { await fn(); } catch { setMsg(t('editor.errors.generic')); } finally { setBusy(null); }
  };
  const openOriginal = () => run('open', async () => {
    // 새 탭은 클릭 순간에 연다 — 주소를 받은 뒤 window.open 하면 팝업 차단에 걸린다
    const w = window.open('', '_blank');
    try {
      const { url } = await savedOpenLink(item.id);
      if (w) { w.opener = null; w.location.href = url; } else window.location.href = url;
    } catch (e) { if (w) w.close(); throw e; }
  });

  return (
    <>
      <DetailDrawer.Header onClose={onClose}><HeadTitle>{item.card.name || '—'}</HeadTitle></DetailDrawer.Header>
      <DetailDrawer.Body>
        {item.source_changed && (
          <Banner>
            <span>{t('saved.refreshHint')}</span>
            <ActionButton tone="primary" size="sm" loading={busy === 'refresh'} disabled={!!busy} data-testid="saved-refresh"
              onClick={() => void run('refresh', async () => onChanged(await refreshSavedCard(item.id)))}>{t('saved.refresh')}</ActionButton>
          </Banner>
        )}
        {!item.source_alive && <Muted>{t('saved.closedHint')}</Muted>}
        <CardFace view={item.card} photoSrc={photo} testId="saved-card-face" />
        <Actions>
          <ActionButton tone="primary" size="md" loading={busy === 'vcf'} disabled={!!busy} data-testid="saved-vcf"
            onClick={() => void run('vcf', () => downloadSavedVcf(item))}>{t('saved.vcf')}</ActionButton>
          {item.source_alive && (
            <ActionButton tone="secondary" size="md" disabled={!!busy} onClick={() => void openOriginal()} data-testid="saved-open">{t('saved.openOriginal')}</ActionButton>
          )}
        </Actions>
        {msg && <Err role="alert">{msg}</Err>}
        <Field>
          <Label htmlFor={`saved-memo-${item.id}`}>{t('saved.memo')}</Label>
          <AutoSaveField onSave={async () => onChanged(await patchSavedMemo(item.id, memo))}>
            <TextArea id={`saved-memo-${item.id}`} value={memo} rows={3} maxLength={500} placeholder={t('saved.memoPlaceholder') as string}
              data-testid="saved-memo" onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMemo(e.target.value)} />
          </AutoSaveField>
        </Field>
      </DetailDrawer.Body>
      <DetailDrawer.Footer>
        <ActionButton tone="danger" size="md" onClick={() => setAskDelete(true)} data-testid="saved-delete">{t('saved.delete')}</ActionButton>
      </DetailDrawer.Footer>
      <ConfirmDialog isOpen={askDelete} onClose={() => setAskDelete(false)} variant="danger"
        title={t('saved.deleteTitle')} message={t('saved.deleteMsg')}
        confirmText={t('saved.delete') as string} cancelText={t('confirm.cancel') as string}
        onConfirm={() => { setAskDelete(false); void run('delete', async () => { await deleteSavedCard(item.id); onDeleted(item.id); }); }} />
    </>
  );
};

const Toolbar = styled.div`display: flex; gap: 8px; margin-bottom: 12px; max-width: 420px;`;
const NoMatch = styled.div`padding: 24px; text-align: center; color: #94A3B8; font-size: 0.875rem;`;
const List = styled.div`display: flex; flex-direction: column; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;`;
const Row = styled.button<{ $active: boolean }>`
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; cursor: pointer;
  padding: 12px 16px; min-height: 64px; box-sizing: border-box;
  background: ${(p) => (p.$active ? '#F0FDFA' : '#FFFFFF')}; border: none; border-bottom: 1px solid #F1F5F9;
  &:last-child { border-bottom: none; }
  &:hover { background: ${(p) => (p.$active ? '#F0FDFA' : '#F8FAFC')}; }
`;
const Thumb = styled.img`width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0;`;
const ThumbBlank = styled.span`
  width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  background: #F1F5F9; color: #64748B; font-weight: 700; font-size: 0.875rem;
`;
const RowMain = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const RowName = styled.div`font-size: 0.9375rem; font-weight: 600; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const RowSub = styled.div`font-size: 0.8125rem; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const RowSide = styled.div`
  display: flex; align-items: center; gap: 6px; flex-shrink: 0;
  @media (max-width: 640px) { flex-direction: column; align-items: flex-end; gap: 4px; }
`;
const RowDate = styled.span`font-size: 0.75rem; color: #94A3B8; white-space: nowrap;`;
const Badge = styled.span<{ $tone: 'mint' | 'gray' }>`
  font-size: 0.6875rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; white-space: nowrap;
  ${(p) => (p.$tone === 'mint' ? 'background:#F0FDFA;color:#0F766E;border:1px solid #99F6E4;' : 'background:#F8FAFC;color:#64748B;border:1px solid #E2E8F0;')}
`;
const HeadTitle = styled.h2`margin: 0; font-size: 1rem; font-weight: 700; color: #0F172A; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Banner = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 10px 12px; border-radius: 8px; background: #F0FDFA; border: 1px solid #99F6E4; color: #0F766E; font-size: 0.8125rem;
`;
const Muted = styled.div`font-size: 0.8125rem; color: #64748B; line-height: 1.5;`;
const Actions = styled.div`display: flex; gap: 8px; flex-wrap: wrap;`;
const Err = styled.div`font-size: 0.8125rem; color: #B91C1C;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #64748B;`;
const TextArea = styled.textarea`
  width: 100%; box-sizing: border-box; padding: 9px 12px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.875rem; color: #0F172A; font-family: inherit; resize: vertical; outline: none; line-height: 1.5;
  &:focus { border-color: #14B8A6; }
  &::placeholder { color: #CBD5E1; }
`;
