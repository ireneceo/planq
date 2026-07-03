// platform_admin 사용자 관리 — 검색·사칭·데이터 export
// 라우트: /admin/users
import { useEffect, useState, useCallback } from 'react';
import { downloadBlob } from '../../utils/download';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import SearchBox from '../../components/Common/SearchBox';
import EmptyState from '../../components/Common/EmptyState';
import { apiFetch, getAccessToken, useAuth } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';

interface UserRow {
  id: number;
  email: string;
  name: string | null;
  username: string | null;
  platform_role: 'platform_admin' | 'user';
  status: 'active' | 'suspended' | 'deleted';
  email_verified_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

const AdminUsersPage = () => {
  const { t } = useTranslation('common');
  const tf = useTimeFormat();
  const { user: currentUser } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (search.trim()) sp.set('q', search.trim());
      const r = await apiFetch(`/api/admin/users?${sp.toString()}`);
      const j = await r.json();
      if (j.success) setRows(j.data || []);
    } finally { setLoading(false); }
  }, [search]);

  useEffect(() => { void load(); }, [load]);

  const onImpersonate = async (target: UserRow) => {
    // 클릭 = 의도 명확 + AuditLog 강제 기록이라 별도 confirm 모달 불필요
    try {
      const r = await apiFetch(`/api/admin/users/${target.id}/impersonate`, { method: 'POST' });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      // 새 탭에서 사칭 토큰으로 진입 — sessionStorage 에 저장 후 새 탭 열기
      const token = j.data.access_token;
      window.sessionStorage.setItem('impersonate_pending', JSON.stringify({
        token, target_id: target.id, target_email: target.email, original_token: getAccessToken(),
      }));
      window.open('/dashboard?_impersonate=1', '_blank', 'noopener');
    } catch (e) {
      console.warn('impersonate failed', e);
    }
  };

  const onDataExport = async (target: UserRow) => {
    try {
      const r = await apiFetch(`/api/admin/users/${target.id}/data-export`);
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      // JSON 다운로드
      const blob = new Blob([JSON.stringify(j.data, null, 2)], { type: 'application/json' });
      await downloadBlob(blob, `planq-user-${target.id}-data-${new Date().toISOString().slice(0,10)}.json`);
    } catch (e) {
      console.warn('export failed', e);
    }
  };

  return (
    <PageShell
      title={t('adminUsers.title', '사용자 관리') as string}
      count={rows.length}
      actions={
        <SearchBox value={search} onChange={setSearch} placeholder={t('adminUsers.searchPh', '이메일·이름 검색') as string} width={240} />
      }
    >
      {loading ? (
        <Loading>{t('common.loading', '불러오는 중...')}</Loading>
      ) : rows.length === 0 ? (
        <EmptyState icon="inbox" title={t('adminUsers.empty', '사용자가 없습니다') as string} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('adminUsers.col.email', '이메일')}</Th>
              <Th>{t('adminUsers.col.name', '이름')}</Th>
              <Th>{t('adminUsers.col.role', '역할')}</Th>
              <Th>{t('adminUsers.col.verified', '인증')}</Th>
              <Th>{t('adminUsers.col.created', '가입')}</Th>
              <Th>{t('adminUsers.col.lastLogin', '최근 로그인')}</Th>
              <Th>{t('adminUsers.col.actions', '액션')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(u => (
              <Row key={u.id}>
                <Td><EmailText>{u.email}</EmailText></Td>
                <Td>{u.name || '—'}</Td>
                <Td>
                  <RoleTag $admin={u.platform_role === 'platform_admin'}>
                    {u.platform_role === 'platform_admin' ? t('adminUsers.roleAdmin', '관리자') : t('adminUsers.roleUser', '사용자')}
                  </RoleTag>
                  {u.status !== 'active' && <StatusTag>{u.status}</StatusTag>}
                </Td>
                <Td>{u.email_verified_at ? '✓' : <UnverifiedTag>{t('adminUsers.unverified', '미인증')}</UnverifiedTag>}</Td>
                <Td>{tf.formatDate(u.created_at)}</Td>
                <Td>{u.last_login_at ? tf.formatDate(u.last_login_at) : '—'}</Td>
                <Td>
                  <ActionRow>
                    {String(u.id) !== String(currentUser?.id) && u.status === 'active' && (
                      <ActionBtn type="button" onClick={() => onImpersonate(u)} title={t('adminUsers.impersonateTip', '이 사용자로 보기 (30분)') as string}>
                        {t('adminUsers.impersonate', '사칭')}
                      </ActionBtn>
                    )}
                    <ActionBtn type="button" onClick={() => onDataExport(u)} title={t('adminUsers.exportTip', '개인정보 데이터 다운로드 (GDPR)') as string}>
                      {t('adminUsers.export', '데이터')}
                    </ActionBtn>
                  </ActionRow>
                </Td>
              </Row>
            ))}
          </tbody>
        </Table>
      )}
    </PageShell>
  );
};

export default AdminUsersPage;

const Loading = styled.div`padding: 40px; text-align: center; color: #64748B;`;
const Table = styled.table`width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px;`;
const Th = styled.th`padding: 10px 12px; text-align: left; background: #F8FAFC; border-bottom: 1px solid #E2E8F0; font-weight: 700; font-size: 11px; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;`;
const Row = styled.tr`&:hover { background: #F8FAFC; }`;
const Td = styled.td`padding: 10px 12px; border-bottom: 1px solid #F1F5F9; color: #334155; vertical-align: middle;`;
const EmailText = styled.span`font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;`;
const RoleTag = styled.span<{ $admin: boolean }>`
  display: inline-block; padding: 2px 8px;
  background: ${p => p.$admin ? '#FFF1F2' : '#F0FDFA'};
  color: ${p => p.$admin ? '#9F1239' : '#0F766E'};
  border: 1px solid ${p => p.$admin ? '#FECDD3' : '#99F6E4'};
  border-radius: 999px; font-size: 11px; font-weight: 700;
`;
const StatusTag = styled.span`
  display: inline-block; margin-left: 4px; padding: 2px 8px;
  background: #FEF2F2; color: #B91C1C; border: 1px solid #FECACA;
  border-radius: 999px; font-size: 11px; font-weight: 600;
`;
const UnverifiedTag = styled.span`
  display: inline-block; padding: 2px 6px;
  background: #FEF3C7; color: #92400E; border: 1px solid #FDE68A;
  border-radius: 4px; font-size: 11px; font-weight: 600;
`;
const ActionRow = styled.div`display: flex; gap: 6px;`;
const ActionBtn = styled.button`
  padding: 4px 10px; font-size: 11px; font-weight: 600; color: #475569;
  border: 1px solid #E2E8F0; background: #FFFFFF; border-radius: 6px; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; background: #F0FDFA; }
`;
