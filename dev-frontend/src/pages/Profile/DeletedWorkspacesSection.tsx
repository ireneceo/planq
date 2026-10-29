// 삭제 예정 워크스페이스 — 대표가 지운 곳을 30일 안에 되살린다. docs/WORKSPACE_DELETION_DESIGN.md ⑤-3
//   지운 워크스페이스의 /api/businesses/:id 는 닫혀 있어서 복구 문은 /api/users/me 아래에 있다.
//   목록이 비면 아무것도 그리지 않는다(있을 때만 보인다).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import ActionButton from '../../components/Common/ActionButton';
import { Zone, ZoneTitle, ZoneDesc, ErrText } from '../../components/Common/dangerZoneShell';
import { formatDay } from '../../utils/dateFormat';

interface Row { id: number; name: string; deleted_at: string; purge_after: string }

const DeletedWorkspacesSection: React.FC = () => {
  const { t } = useTranslation('profile');
  const { refreshUser } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/users/me/deleted-workspaces');
      if (!res.ok) return;
      const j = await res.json();
      setRows(Array.isArray(j?.data) ? j.data : []);
    } catch { /* 목록을 못 읽으면 칸을 그리지 않는다 */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const restore = useCallback(async (id: number) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      const res = await apiFetch(`/api/users/me/deleted-workspaces/${id}/restore`, { method: 'POST' });
      if (!res.ok) { setError(t('deletedWorkspaces.errRestore')); return; }
      await refreshUser();   // 스위처에 다시 나타난다
      await load();
    } catch {
      setError(t('deletedWorkspaces.errRestore'));
    } finally { setBusy(null); }
  }, [busy, load, refreshUser, t]);

  if (!rows.length) return null;
  return (
    <Zone data-testid="deleted-workspaces">
      <ZoneTitle>{t('deletedWorkspaces.title')}</ZoneTitle>
      <ZoneDesc>{t('deletedWorkspaces.desc')}</ZoneDesc>
      {rows.map((r) => (
        <Item key={r.id}>
          <ItemText>
            <ItemName>{r.name}</ItemName>
            <ItemMeta>{t('deletedWorkspaces.until', { date: formatDay(r.purge_after) })}</ItemMeta>
          </ItemText>
          <ActionButton tone="secondary" data-testid={`deleted-workspace-restore-${r.id}`}
            onClick={() => restore(r.id)} disabled={busy !== null} loading={busy === r.id}>
            {t('deletedWorkspaces.restore')}
          </ActionButton>
        </Item>
      ))}
      {error && <ErrText role="alert">{error}</ErrText>}
    </Zone>
  );
};

export default DeletedWorkspacesSection;

const Item = styled.div`
  display: flex; align-items: center; gap: 12px; justify-content: space-between;
  padding: 10px 0; border-top: 1px solid #f1f5f9;
  &:first-of-type { border-top: none; }
`;
const ItemText = styled.div`min-width: 0;`;
const ItemName = styled.div`font-size: 0.875rem; font-weight: 600; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const ItemMeta = styled.div`font-size: 0.75rem; color: #64748b; margin-top: 2px;`;
