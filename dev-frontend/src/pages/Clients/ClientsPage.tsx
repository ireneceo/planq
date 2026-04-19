import { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import LetterAvatar from '../../components/Common/LetterAvatar';
import PageShell from '../../components/Layout/PageShell';

type ClientRow = {
  id: number;
  business_id: number;
  user_id: number;
  display_name: string | null;
  company_name: string | null;
  notes: string | null;
  invited_at: string | null;
  created_at: string;
  user?: {
    id: number;
    name: string;
    email: string;
    phone: string | null;
  };
};

export default function ClientsPage() {
  const { t } = useTranslation('clients');
  const { user } = useAuth();
  const { formatDate } = useTimeFormat();
  const businessId = user?.business_id || 0;
  const isAdmin = user?.business_role === 'owner' || user?.platform_role === 'platform_admin';

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/clients/${businessId}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed');
      setClients(Array.isArray(data.data) ? data.data : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const filtered = clients.filter((c) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const name = (c.display_name || c.user?.name || '').toLowerCase();
    const company = (c.company_name || '').toLowerCase();
    const email = (c.user?.email || '').toLowerCase();
    return name.includes(q) || company.includes(q) || email.includes(q);
  });

  return (
    <PageShell
      title={t('page.title')}
      count={filtered.length}
      actions={
        <>
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder') || ''}
          />
          {isAdmin && (
            <InviteButton type="button" disabled title={t('inviteTooltip') || ''}>
              {t('invite')}
            </InviteButton>
          )}
        </>
      }
    >
        {loading && <Empty>{t('loading')}</Empty>}
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {!loading && !error && filtered.length === 0 && (
          <Empty>{query ? t('noResults') : t('empty')}</Empty>
        )}

        {!loading && !error && filtered.length > 0 && (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th style={{ width: 44 }} />
                  <Th>{t('col.name')}</Th>
                  <Th>{t('col.company')}</Th>
                  <Th>{t('col.email')}</Th>
                  <Th>{t('col.phone')}</Th>
                  <Th style={{ width: 120 }}>{t('col.invitedAt')}</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const name = c.display_name || c.user?.name || '—';
                  return (
                    <Tr key={c.id}>
                      <Td>
                        <LetterAvatar name={name} size={32} variant="neutral" />
                      </Td>
                      <Td><strong>{name}</strong></Td>
                      <Td>{c.company_name || '—'}</Td>
                      <Td>{c.user?.email || '—'}</Td>
                      <Td>{c.user?.phone || '—'}</Td>
                      <Td>
                        {formatDate(c.invited_at || c.created_at)}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
    </PageShell>
  );
}

// ─────────────────────────────────────────────
// Styled (페이지 고유 요소만)
// ─────────────────────────────────────────────
const SearchInput = styled.input`
  width: 220px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  color: #0f172a;
  background: #f8fafc;
  outline: none;
  &:focus { border-color: #14b8a6; background: #fff; }
  &::placeholder { color: #94a3b8; }
`;

const InviteButton = styled.button`
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid #14b8a6;
  background: #14b8a6;
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 120ms;
  &:hover:not(:disabled) { background: #0d9488; border-color: #0d9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const TableWrap = styled.div`
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
`;

const Th = styled.th`
  text-align: left;
  padding: 12px 16px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #64748b;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
`;

const Tr = styled.tr`
  &:not(:last-child) { border-bottom: 1px solid #f1f5f9; }
  &:hover { background: #f8fafc; }
`;

const Td = styled.td`
  padding: 12px 16px;
  color: #0f172a;
  vertical-align: middle;
  strong { font-weight: 600; }
`;

const Empty = styled.div`
  padding: 60px 20px;
  text-align: center;
  color: #94a3b8;
  font-size: 14px;
`;

const ErrorBanner = styled.div`
  padding: 12px 16px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  border-radius: 8px;
  font-size: 13px;
  margin: 0 0 16px;
`;
