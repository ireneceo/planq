// Q docs — 워크스페이스 문서 + 받은 서명 archive
//
// 상위 탭:
//   [문서] 워크스페이스 전역 문서 (PostsPage)
//   [받은 서명 N] 본인이 받은 서명 요청 — cross-workspace archive
//
// URL: /docs                          → 문서 탭
//      /docs?tab=received-signatures  → 받은 서명

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import PostsPage from '../../components/Docs/PostsPage';
import ReceivedSignaturesTab from './ReceivedSignaturesTab';
import { useAuth, apiFetch } from '../../contexts/AuthContext';

type Tab = 'documents' | 'received-signatures';

const TABS: Tab[] = ['documents', 'received-signatures'];

function readTab(search: string): Tab {
  const t = new URLSearchParams(search).get('tab') as Tab | null;
  return t && TABS.includes(t) ? t : 'documents';
}

const QDocsPage: React.FC = () => {
  const { t } = useTranslation('qdocs');
  const { user } = useAuth();
  const businessId = user?.business_id;
  const location = useLocation();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>(() => readTab(location.search));
  useEffect(() => { setTab(readTab(location.search)); }, [location.search]);

  const switchTab = (k: Tab) => {
    const sp = new URLSearchParams(location.search);
    if (k === 'documents') sp.delete('tab'); else sp.set('tab', k);
    navigate(`${location.pathname}${sp.toString() ? `?${sp.toString()}` : ''}`, { replace: true });
  };

  // 받은 서명 카운트 (탭 배지) — pending(sent/viewed) 만 (action 필요)
  const [receivedCount, setReceivedCount] = useState<number>(0);
  const refreshCount = useCallback(async () => {
    try {
      const r = await apiFetch('/api/signatures/received?status=sent&limit=1');
      const j = await r.json();
      if (j.success) setReceivedCount(j.data.total || 0);
    } catch { /* noop */ }
  }, []);
  useEffect(() => { refreshCount(); }, [refreshCount]);

  const scope = useMemo(
    () => (businessId ? { type: 'workspace' as const, businessId: Number(businessId) } : null),
    [businessId]
  );

  return (
    <FullHeight>
      <TabsHeader>
        <TabBar role="tablist">
          {TABS.map((k) => (
            <TabBtn type="button" key={k} role="tab" aria-selected={tab === k} $active={tab === k} onClick={() => switchTab(k)}>
              <span>{t(`tabs.${k}`)}</span>
              {k === 'received-signatures' && receivedCount > 0 && (
                <Badge $active={tab === k}>{receivedCount}</Badge>
              )}
            </TabBtn>
          ))}
        </TabBar>
      </TabsHeader>

      {tab === 'documents' && (
        scope ? <PostsPage scope={scope} /> : <Fallback>{t('page.noWorkspace')}</Fallback>
      )}
      {tab === 'received-signatures' && (
        <PageShell title={t('tabs.received-signatures')}>
          <ReceivedSignaturesTab />
        </PageShell>
      )}
    </FullHeight>
  );
};

export default QDocsPage;

const FullHeight = styled.div`
  height: 100vh;
  display: flex;
  flex-direction: column;
  @media (max-width: 768px) { height: calc(100vh - 56px); }
`;
const Fallback = styled.div`padding: 40px; text-align: center; color: #94A3B8; font-size: 13px;`;
const TabsHeader = styled.div`
  background: #FFFFFF;
  border-bottom: 1px solid #E2E8F0;
  flex-shrink: 0;
`;
const TabBar = styled.div`
  display: flex; gap: 4px; padding: 0 20px;
  overflow-x: auto;
  &::-webkit-scrollbar { height: 6px; }
`;
const TabBtn = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 14px 16px; background: transparent; border: none;
  border-bottom: 2px solid ${p => p.$active ? '#0D9488' : 'transparent'};
  color: ${p => p.$active ? '#0F172A' : '#64748B'};
  font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
  &:hover { color: #0F172A; }
`;
const Badge = styled.span<{ $active: boolean }>`
  padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 700;
  background: ${p => p.$active ? '#0D9488' : '#FECACA'};
  color: ${p => p.$active ? '#FFFFFF' : '#B91C1C'};
`;
