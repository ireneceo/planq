// 개인 보관함 (Personal Vault) — 사이클 N+9
// PERSONAL_VAULT_DESIGN.md / VISIBILITY_VOCABULARY.md
//
// 본인의 L1 자산 (uploader/author 본인 + visibility/vlevel='L1' / scope='private') 만 노출.
// "Single Source of Truth + Multiple Views" — 같은 row 가 Q file/Q docs 메뉴에도 보이지만
// 권한 배지(자물쇠)로 구분. 데이터는 한 곳, 보는 메뉴는 여러 곳.
//
// 4 탭 (MVP): 대시보드 / 문서 / 파일 / 지식
//   노트·메모 탭은 Q note 메뉴 자체가 personal — 별도 탭 추가는 v1.1 (input_type 분리 후)

import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import PageShell from '../../components/Layout/PageShell';
import EmptyState from '../../components/Common/EmptyState';
import DocsTab from '../QProject/DocsTab';  // N+30 — 개인 보관함 files 탭 풀세트 재사용
import PostsPage from '../../components/Docs/PostsPage';  // N+30 phase2 — posts 탭 풀세트 재사용
import KnowledgePage from '../Knowledge/KnowledgePage';  // N+30 phase3 — kb 탭 풀세트 재사용

// 사이클 N+14 — Q note (notes) 탭 추가
type Tab = 'dashboard' | 'posts' | 'files' | 'kb' | 'notes';
const TABS: Tab[] = ['dashboard', 'posts', 'files', 'kb', 'notes'];

interface VaultFile {
  id: number; file_name: string; mime_type: string; file_size: number; created_at: string;
}
interface VaultPost {
  id: number; title: string; category: string | null; kind: string; status: string;
  is_pinned: boolean; created_at: string; updated_at: string;
}
interface VaultKb {
  id: number; title: string; source_type: string; body: string | null; created_at: string; updated_at: string;
}
interface VaultSession {
  id: number; title: string; status: string; visibility: string;
  duration_seconds: number; utterance_count: number;
  created_at: string; updated_at: string;
}

const PersonalVaultPage: React.FC = () => {
  const { t } = useTranslation(['common', 'layout']);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const businessId = user?.business_id;

  const tabParam = sp.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(tabParam && TABS.includes(tabParam) ? tabParam : 'dashboard');
  const setTabSync = (next: Tab) => {
    setTab(next);
    const nsp = new URLSearchParams(sp);
    nsp.set('tab', next);
    setSp(nsp, { replace: true });
  };

  // 첫 진입 explainer — dismiss 영속
  const explainerKey = `pv-explainer-dismissed-${user?.id}`;
  const [explainerOpen, setExplainerOpen] = useState(
    () => typeof window !== 'undefined' && !localStorage.getItem(explainerKey)
  );
  const dismissExplainer = () => {
    localStorage.setItem(explainerKey, '1');
    setExplainerOpen(false);
  };

  const [summary, setSummary] = useState<{
    counts: { files: number; posts: number; kb_documents: number };
    recent: { files: VaultFile[]; posts: VaultPost[]; kb_documents: VaultKb[] };
  } | null>(null);
  const [posts, setPosts] = useState<VaultPost[] | null>(null);
  const [files, setFiles] = useState<VaultFile[] | null>(null);
  const [kbs, setKbs] = useState<VaultKb[] | null>(null);
  const [sessions, setSessions] = useState<VaultSession[] | null>(null);
  const [loading, setLoading] = useState(false);

  // 탭 진입 시 데이터 로드
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        if (tab === 'dashboard' && !summary) {
          const r = await apiFetch(`/api/personal-vault/${businessId}/summary`);
          const j = await r.json();
          if (!cancelled && j.success) setSummary(j.data);
        } else if (tab === 'posts' && !posts) {
          const r = await apiFetch(`/api/personal-vault/${businessId}/posts`);
          const j = await r.json();
          if (!cancelled && j.success) setPosts(j.data);
        } else if (tab === 'files' && !files) {
          const r = await apiFetch(`/api/personal-vault/${businessId}/files`);
          const j = await r.json();
          if (!cancelled && j.success) setFiles(j.data);
        } else if (tab === 'kb' && !kbs) {
          const r = await apiFetch(`/api/personal-vault/${businessId}/kb-documents`);
          const j = await r.json();
          if (!cancelled && j.success) setKbs(j.data);
        } else if (tab === 'notes' && !sessions) {
          const r = await apiFetch(`/api/personal-vault/${businessId}/sessions`);
          const j = await r.json();
          if (!cancelled && j.success) setSessions(j.data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [tab, businessId, summary, posts, files, kbs, sessions]);

  return (
    <PageShell title={t('layout:nav.personalVault', '개인 보관함') as string}>
      <SubLine>
        <SubLineIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </SubLineIcon>
        {t('common:vault.subtitle', { defaultValue: '본인만 보는 사적 영역' }) as string}
      </SubLine>
      {explainerOpen && (
        <ExplainerBox role="region">
          <ExplainerIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </ExplainerIcon>
          <ExplainerBody>
            <ExplainerTitle>{t('common:vault.explainer.title', '개인 자료만 모인 곳') as string}</ExplainerTitle>
            <ExplainerText>
              {t('common:vault.explainer.body', { defaultValue: '같은 자료가 Q file·Q docs 메뉴에도 보이지만 권한 표시(자물쇠)로 구분됩니다. 공유는 [공유하기] 버튼으로 가능합니다.' }) as string}
            </ExplainerText>
          </ExplainerBody>
          <ExplainerDismiss type="button" onClick={dismissExplainer}
            aria-label={t('common:vault.explainer.dismiss', '닫기') as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </ExplainerDismiss>
        </ExplainerBox>
      )}

      <TabRow role="tablist">
        {TABS.map(k => (
          <TabBtn key={k} type="button" role="tab" aria-selected={tab === k}
            $active={tab === k} onClick={() => setTabSync(k)}>
            {t(`common:vault.tab.${k}`, {
              defaultValue: { dashboard: '대시보드', posts: '문서', files: '파일', kb: '정보', notes: '노트' }[k]
            }) as string}
          </TabBtn>
        ))}
      </TabRow>

      {loading && !summary && !posts && !files && !kbs && (
        <LoadingSkeleton />
      )}

      {tab === 'dashboard' && summary && (
        <DashboardGrid>
          <Stat>
            <StatLabel>{t('common:vault.tab.posts', { defaultValue: '문서' }) as string}</StatLabel>
            <StatValue>{summary.counts.posts}</StatValue>
          </Stat>
          <Stat>
            <StatLabel>{t('common:vault.tab.files', { defaultValue: '파일' }) as string}</StatLabel>
            <StatValue>{summary.counts.files}</StatValue>
          </Stat>
          <Stat>
            <StatLabel>{t('common:vault.tab.kb', { defaultValue: '정보' }) as string}</StatLabel>
            <StatValue>{summary.counts.kb_documents}</StatValue>
          </Stat>
          {summary.recent.posts.length > 0 && (
            <Section>
              <SectionTitle>{t('common:vault.recent.posts', '최근 문서') as string}</SectionTitle>
              <List>
                {summary.recent.posts.map(p => (
                  <Row key={p.id} onClick={() => navigate(`/docs?post=${p.id}`)}>
                    <RowMain>{p.title}</RowMain>
                    <RowMeta>{p.kind} · {p.category || '—'}</RowMeta>
                  </Row>
                ))}
              </List>
            </Section>
          )}
          {summary.recent.files.length > 0 && (
            <Section>
              <SectionTitle>{t('common:vault.recent.files', '최근 파일') as string}</SectionTitle>
              <List>
                {summary.recent.files.map(f => (
                  <Row key={f.id} onClick={() => navigate(`/files?file=${f.id}`)}>
                    <RowMain>{f.file_name}</RowMain>
                    <RowMeta>{f.mime_type}</RowMeta>
                  </Row>
                ))}
              </List>
            </Section>
          )}
          {summary.recent.kb_documents.length > 0 && (
            <Section>
              <SectionTitle>{t('common:vault.recent.kb', '최근 정보') as string}</SectionTitle>
              <List>
                {summary.recent.kb_documents.map(k => (
                  <Row key={k.id} onClick={() => navigate(`/info?doc=${k.id}`)}>
                    <RowMain>{k.title}</RowMain>
                    <RowMeta>{k.source_type}</RowMeta>
                  </Row>
                ))}
              </List>
            </Section>
          )}
          {summary.counts.files === 0 && summary.counts.posts === 0 && summary.counts.kb_documents === 0 && (
            <EmptyWrap>
              <EmptyState
                title={t('common:vault.empty.title', '아직 개인 자료가 없어요') as string}
                description={t('common:vault.empty.body', { defaultValue: 'Q file·Q docs 에서 업로드할 때 프로젝트를 지정하지 않으면 자동으로 여기에 모입니다.' }) as string}
              />
            </EmptyWrap>
          )}
        </DashboardGrid>
      )}

      {/* N+30 phase2 — 개인 보관함 posts 탭 풀세트. PostsPage 의 scope='personal' 모드 재사용.
          fetch + 검색 + 새 글 + 편집 + 카테고리 등 풀세트 자동. backend posts.js:345 가 project_id 없으면 vlevel=L1 자동. */}
      {tab === 'posts' && businessId && (
        <PostsPage scope={{ type: 'personal', businessId }} />
      )}

      {/* N+30 — 개인 보관함 풀세트. DocsTab 의 scope='personal' 모드 재사용
          (PERSONAL_VAULT_DESIGN.md §3 컴포넌트 재사용 원칙). 업로드/검색/카드 view/⋮ 메뉴 등 풀세트 자동. */}
      {tab === 'files' && businessId && (
        <DocsTab scope={{ type: 'personal', businessId }} />
      )}

      {/* N+30 phase3 — 개인 보관함 kb 탭 풀세트. KnowledgePage embedded=true mode='personal'.
          fetchPersonalKb 자체 호출 (본인 + scope='private'). PageShell wrapping skip (부모 PageShell 안에서). */}
      {tab === 'kb' && (
        <KnowledgePage embedded mode="personal" />
      )}

      {tab === 'notes' && sessions && (
        sessions.length === 0 ? (
          <EmptyWrap>
            <EmptyState title={t('common:vault.empty.notes', '개인 노트 없음') as string}
              description={t('common:vault.empty.notesBody', { defaultValue: 'Q note 에서 만든 회의 메모·녹음·트랜스크립트가 여기에 모입니다.' }) as string} />
          </EmptyWrap>
        ) : (
          <ListWrap>
            {sessions.map(s => (
              <Card key={s.id} onClick={() => navigate(`/notes?session=${s.id}`)}>
                <CardTitle>{s.title}</CardTitle>
                <CardMeta>
                  {s.status === 'recording'
                    ? (t('common:vault.note.recording', { defaultValue: '녹음 중' }) as string)
                    : s.status === 'completed'
                      ? (t('common:vault.note.completed', { defaultValue: '완료' }) as string)
                      : s.status}
                  {s.utterance_count > 0 && ` · ${t('common:vault.note.utteranceCount', { defaultValue: '발화 {{n}}', n: s.utterance_count }) as string}`}
                  {s.duration_seconds > 0 && ` · ${t('common:vault.note.minutes', { defaultValue: '{{min}}분', min: Math.round(s.duration_seconds / 60) }) as string}`}
                </CardMeta>
              </Card>
            ))}
          </ListWrap>
        )
      )}
    </PageShell>
  );
};

export default PersonalVaultPage;

// N+30 — formatBytes 는 files 탭 자체 list 제거 (DocsTab 마운트로 대체) 후 dead code 가 됨.
// DocsTab 안에 자체 formatBytes 있으므로 제거. dashboard 의 recent.files 는 mime/size 표시 없이 제목만 노출.

const LoadingSkeleton: React.FC = () => (
  <SkWrap>
    {[1,2,3].map(i => <SkRow key={i} />)}
  </SkWrap>
);

// ─── styles ──────────────────────────────────────────────────────────────
const SubLine = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: #64748B; margin-bottom: 16px;
`;
const SubLineIcon = styled.svg` width: 14px; height: 14px; color: #94A3B8; `;

const ExplainerBox = styled.div`
  display: flex; gap: 12px; align-items: flex-start;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 12px;
  padding: 14px 16px; margin-bottom: 20px;
`;
const ExplainerIcon = styled.svg` width: 20px; height: 20px; color: #0F766E; flex-shrink: 0; margin-top: 2px; `;
const ExplainerBody = styled.div` flex: 1; min-width: 0; `;
const ExplainerTitle = styled.div` font-size: 13px; font-weight: 700; color: #0F766E; margin-bottom: 2px; `;
const ExplainerText = styled.div` font-size: 12px; color: #115E59; line-height: 1.5; `;
const ExplainerDismiss = styled.button`
  background: none; border: none; color: #0F766E; cursor: pointer; padding: 4px;
  display: flex; align-items: center; justify-content: center; border-radius: 4px;
  &:hover { background: #CCFBF1; }
`;

const TabRow = styled.div`
  display: flex; gap: 4px; border-bottom: 1px solid #E2E8F0;
  margin-bottom: 20px;
  overflow-x: auto;
  &::-webkit-scrollbar { display: none; }
`;
const TabBtn = styled.button<{ $active: boolean }>`
  padding: 10px 16px; background: transparent; border: none; cursor: pointer;
  font-size: 13px; font-weight: 600;
  color: ${p => p.$active ? '#0F172A' : '#64748B'};
  border-bottom: 2px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  margin-bottom: -1px;
  white-space: nowrap;
  &:hover { color: ${p => p.$active ? '#0F172A' : '#334155'}; }
`;

const DashboardGrid = styled.div`
  display: flex; flex-direction: column; gap: 24px;
`;
const Stat = styled.div`
  display: inline-flex; gap: 12px; align-items: baseline;
  padding: 12px 16px; background: #F8FAFC; border-radius: 10px;
`;
const StatLabel = styled.div` font-size: 12px; color: #64748B; font-weight: 600; `;
const StatValue = styled.div` font-size: 20px; color: #0F172A; font-weight: 700; `;

const Section = styled.section``;
const SectionTitle = styled.h3` font-size: 13px; font-weight: 700; color: #0F172A; margin: 0 0 8px; `;
const List = styled.ul` list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; `;
const Row = styled.li`
  display: flex; align-items: baseline; gap: 12px;
  padding: 8px 12px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px;
  cursor: pointer;
  &:hover { border-color: #CBD5E1; background: #F8FAFC; }
`;
const RowMain = styled.span` font-size: 13px; color: #0F172A; font-weight: 500; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; `;
const RowMeta = styled.span` font-size: 11px; color: #94A3B8; flex-shrink: 0; `;

const ListWrap = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  @media (max-width: 640px) { grid-template-columns: 1fr; }
`;
const Card = styled.div`
  padding: 16px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
  &:hover { border-color: #CBD5E1; background: #F8FAFC; }
`;
const CardTitle = styled.div` font-size: 14px; color: #0F172A; font-weight: 600; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; `;
const CardMeta = styled.div` font-size: 11px; color: #94A3B8; `;

const EmptyWrap = styled.div`
  padding: 48px 16px;
  display: flex; align-items: center; justify-content: center;
  min-height: 280px;
`;

const SkWrap = styled.div` display: flex; flex-direction: column; gap: 8px; `;
const SkRow = styled.div`
  height: 56px; background: linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%);
  background-size: 200% 100%; animation: pq-sk 1.6s linear infinite; border-radius: 8px;
  @keyframes pq-sk { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`;
