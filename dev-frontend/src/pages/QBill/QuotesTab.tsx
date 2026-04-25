import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import SearchBox from '../../components/Common/SearchBox';
import EmptyState from '../../components/Common/EmptyState';
import { mockQuotes, type QuoteStatus, type MockQuote, quoteStatusColor, formatMoney } from './mock';
import QuoteEditor from './QuoteEditor';

const STATUS_KEYS: (QuoteStatus | 'all')[] = ['all', 'draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'converted'];

export default function QuotesTab() {
  const { t } = useTranslation('qbill');
  const location = useLocation();
  const navigate = useNavigate();

  const editingId = (() => {
    const v = new URLSearchParams(location.search).get('quote');
    if (!v) return null;
    if (v === 'new') return 'new' as const;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  })();

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'all'>('all');

  const filtered = useMemo<MockQuote[]>(() => {
    let list = mockQuotes;
    if (statusFilter !== 'all') list = list.filter((q) => q.status === statusFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((x) =>
        x.quote_number.toLowerCase().includes(q) ||
        x.client_name.toLowerCase().includes(q) ||
        (x.title || '').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => b.issued_at.localeCompare(a.issued_at));
  }, [query, statusFilter]);

  const openQuote = (id: number | 'new') => {
    const sp = new URLSearchParams(location.search);
    sp.set('tab', 'quotes');
    sp.set('quote', String(id));
    navigate(`${location.pathname}?${sp.toString()}`, { replace: true });
  };
  const closeEditor = () => {
    const sp = new URLSearchParams(location.search);
    sp.delete('quote');
    sp.set('tab', 'quotes');
    navigate(`${location.pathname}?${sp.toString()}`, { replace: true });
  };

  if (editingId !== null) {
    const quote = editingId === 'new' ? null : mockQuotes.find((q) => q.id === editingId) ?? null;
    return <QuoteEditor quote={quote} onClose={closeEditor} />;
  }

  return (
    <>
      <Toolbar>
        <SearchBox value={query} onChange={setQuery} placeholder={t('quotes.searchPlaceholder') as string} width={260} size="md" />
        <FilterRow>
          {STATUS_KEYS.map((k) => (
            <Chip key={k} $active={statusFilter === k} onClick={() => setStatusFilter(k)}>
              {t(`quotes.filter.${k}`)}
              {k !== 'all' && (
                <ChipCount>
                  {mockQuotes.filter((q) => q.status === k).length}
                </ChipCount>
              )}
            </Chip>
          ))}
        </FilterRow>
        <NewBtn type="button" onClick={() => openQuote('new')}>{t('quotes.newQuote')}</NewBtn>
      </Toolbar>

      {filtered.length === 0 ? (
        <EmptyState
          icon={
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          }
          title={t('quotes.title')}
          description={t('quotes.empty')}
          ctaLabel={t('quotes.newQuote') as string}
          onCta={() => openQuote('new')}
        />
      ) : (
        <Table>
          <THead>
            <Th>{t('quotes.col.number')}</Th>
            <Th>{t('quotes.col.client')}</Th>
            <Th $flex>{t('quotes.col.title')}</Th>
            <Th $right>{t('quotes.col.amount')}</Th>
            <Th $w={100}>{t('quotes.col.status')}</Th>
            <Th $w={100}>{t('quotes.col.issued')}</Th>
            <Th $w={100}>{t('quotes.col.validUntil')}</Th>
          </THead>
          <TBody>
            {filtered.map((q) => {
              const c = quoteStatusColor(q.status);
              return (
                <TRow key={q.id} onClick={() => openQuote(q.id)}>
                  <Td><Mono>{q.quote_number}</Mono></Td>
                  <Td>{q.client_name}</Td>
                  <Td $flex>{q.title}</Td>
                  <Td $right><Strong>{formatMoney(q.total_amount, q.currency)}</Strong></Td>
                  <Td $w={100}><StatusPill style={{ background: c.bg, color: c.fg }}>{t(`quotes.status.${q.status}`)}</StatusPill></Td>
                  <Td $w={100}><Muted>{q.issued_at}</Muted></Td>
                  <Td $w={100}><Muted>{q.valid_until}</Muted></Td>
                </TRow>
              );
            })}
          </TBody>
        </Table>
      )}
    </>
  );
}

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
`;
const FilterRow = styled.div`
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  flex: 1;
`;
const Chip = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid ${(p) => (p.$active ? '#0D9488' : '#E2E8F0')};
  background: ${(p) => (p.$active ? '#F0FDFA' : '#FFFFFF')};
  color: ${(p) => (p.$active ? '#0F766E' : '#475569')};
  font-size: 12px;
  font-weight: ${(p) => (p.$active ? 700 : 500)};
  cursor: pointer;
  &:hover { border-color: #0D9488; color: #0F766E; }
`;
const ChipCount = styled.span`
  font-size: 10px;
  color: #94A3B8;
  background: #F1F5F9;
  padding: 1px 5px;
  border-radius: 8px;
  font-weight: 700;
`;
const NewBtn = styled.button`
  padding: 8px 14px;
  background: #0D9488;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  height: 32px;
  &:hover { background: #0F766E; }
`;

const Table = styled.div`
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
`;
const THead = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: #F8FAFC;
  border-bottom: 1px solid #E2E8F0;
  font-size: 11px;
  font-weight: 700;
  color: #64748B;
  text-transform: uppercase;
  letter-spacing: 0.4px;
`;
const TBody = styled.div``;
const TRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #F1F5F9;
  cursor: pointer;
  transition: background 0.1s;
  &:last-child { border-bottom: none; }
  &:hover { background: #F8FAFC; }
`;
const Th = styled.div<{ $w?: number; $flex?: boolean; $right?: boolean }>`
  ${(p) => (p.$flex ? 'flex: 1; min-width: 120px;' : p.$w ? `width: ${p.$w}px;` : 'min-width: 110px;')}
  ${(p) => p.$right && 'text-align: right;'}
`;
const Td = styled.div<{ $w?: number; $flex?: boolean; $right?: boolean }>`
  ${(p) => (p.$flex ? 'flex: 1; min-width: 120px;' : p.$w ? `width: ${p.$w}px;` : 'min-width: 110px;')}
  ${(p) => p.$right && 'text-align: right;'}
  font-size: 13px;
  color: #0F172A;
`;
const Mono = styled.span`
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #475569;
`;
const Strong = styled.span` font-weight: 700; `;
const Muted = styled.span` color: #64748B; font-size: 12px; `;
const StatusPill = styled.span`
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
  border-radius: 999px;
`;
