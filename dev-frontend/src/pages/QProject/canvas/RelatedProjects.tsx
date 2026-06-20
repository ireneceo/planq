// 관련 프로젝트 (R1 §3.5) — 프로젝트 ↔ 프로젝트 연결. 연결된 프로젝트만 카드로 표시.
//   project_links(양방향 1행). 연결/해제 + status·진행률·health·D- 요약. popup-on-popup 금지 → 인라인 검색.
import { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../contexts/AuthContext';
import { PlusIcon, SearchIcon } from '../../../components/Common/Icons';
import {
  getRelatedProjects, linkProject, unlinkProject, type RelatedProject,
} from '../../../services/projectTimeline';

interface Props { projectId: number; businessId: number; refreshSignal?: number; }

const HEALTH: Record<'green' | 'yellow' | 'red', { bg: string; fg: string }> = {
  green: { bg: '#DCFCE7', fg: '#15803D' },
  yellow: { bg: '#FEF9C3', fg: '#A16207' },
  red: { bg: '#FEE2E2', fg: '#B91C1C' },
};

export default function RelatedProjects({ projectId, businessId, refreshSignal }: Props) {
  const { t } = useTranslation('qproject');
  const navigate = useNavigate();
  const [links, setLinks] = useState<RelatedProject[]>([]);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<{ id: number; name: string; status: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setLinks(await getRelatedProjects(projectId)); } catch { /* keep current */ }
  }, [projectId]);
  useEffect(() => { load(); }, [load, refreshSignal]);

  const openPicker = useCallback(async () => {
    setPicking(true); setQuery('');
    try {
      const r = await apiFetch(`/api/projects?business_id=${businessId}&status=active`);
      const j = await r.json();
      setCandidates(j.success && Array.isArray(j.data)
        ? j.data.map((p: { id: number; name: string; status: string }) => ({ id: p.id, name: p.name, status: p.status }))
        : []);
    } catch { setCandidates([]); }
  }, [businessId]);

  const linkedIds = useMemo(() => new Set(links.map((l) => l.project.id)), [links]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates
      .filter((c) => c.id !== projectId && !linkedIds.has(c.id) && (!q || c.name.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [candidates, query, projectId, linkedIds]);

  const doLink = async (targetId: number) => {
    if (busy) return; setBusy(true);
    try { await linkProject(projectId, targetId); await load(); setPicking(false); } catch { /* ignore */ } finally { setBusy(false); }
  };
  const doUnlink = async (targetId: number) => {
    if (busy) return; setBusy(true);
    try { await unlinkProject(projectId, targetId); await load(); } catch { /* ignore */ } finally { setBusy(false); }
  };

  return (
    <Section>
      <Head>
        <Title>{t('canvas.related.title')}<Hint>{t('canvas.related.hint')}</Hint></Title>
        <LinkBtn type="button" onClick={picking ? () => setPicking(false) : openPicker} $on={picking}>
          <PlusIcon size={14} />{t('canvas.related.link')}
        </LinkBtn>
      </Head>

      {picking && (
        <Picker>
          <SearchRow>
            <SearchIcon size={15} />
            <SearchInput autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t('canvas.related.searchPh')} />
          </SearchRow>
          {results.length === 0 ? (
            <NoResults>{t('canvas.related.noResults')}</NoResults>
          ) : (
            <ResultList>
              {results.map((c) => (
                <ResultRow key={c.id} type="button" disabled={busy} onClick={() => doLink(c.id)}>
                  <ResultName>{c.name}</ResultName>
                  <PlusIcon size={14} />
                </ResultRow>
              ))}
            </ResultList>
          )}
        </Picker>
      )}

      {links.length === 0 ? (
        <Empty>{t('canvas.related.empty')}</Empty>
      ) : (
        <Grid>
          {links.map((l) => {
            const p = l.project;
            const h = HEALTH[p.health] || HEALTH.yellow;
            return (
              <PCard key={l.link_id}>
                <CardTop>
                  <PName type="button" onClick={() => navigate(`/projects/p/${p.id}`)}>{p.name}</PName>
                  <Unlink type="button" aria-label={t('canvas.related.unlink')} title={t('canvas.related.unlink')}
                    disabled={busy} onClick={() => doUnlink(p.id)}>×</Unlink>
                </CardTop>
                {l.relation_label && <RelLabel>{l.relation_label}</RelLabel>}
                <BarTrack><BarFill style={{ width: `${p.progress_percent}%` }} /></BarTrack>
                <MetaRow>
                  <Pct>{p.progress_percent}%</Pct>
                  <HealthBadge style={{ background: h.bg, color: h.fg }}>{t(`canvas.related.health.${p.health}`)}</HealthBadge>
                  {p.overdue_count > 0 && <OverdueChip>{t('canvas.related.overdue', { n: p.overdue_count })}</OverdueChip>}
                  {p.d_day != null && <DDay>{p.d_day >= 0 ? `D-${p.d_day}` : `D+${-p.d_day}`}</DDay>}
                </MetaRow>
              </PCard>
            );
          })}
        </Grid>
      )}
    </Section>
  );
}

const Section = styled.div`display:flex;flex-direction:column;gap:10px;`;
const Head = styled.div`display:flex;align-items:center;justify-content:space-between;gap:12px;`;
const Title = styled.div`font-size:14px;font-weight:700;color:#0F172A;`;
const Hint = styled.span`font-size:11px;font-weight:500;color:#94A3B8;margin-left:8px;`;
const LinkBtn = styled.button<{ $on: boolean }>`display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};background:${(p) => (p.$on ? '#F0FDFA' : '#fff')};color:${(p) => (p.$on ? '#0F766E' : '#475569')};&:hover{border-color:#14B8A6;color:#0F766E;}`;
const Picker = styled.div`background:#fff;border:1px solid #99F6E4;border-radius:12px;padding:12px;`;
const SearchRow = styled.div`display:flex;align-items:center;gap:8px;padding:0 10px;height:38px;border:1px solid #E2E8F0;border-radius:8px;color:#94A3B8;&:focus-within{border-color:#14B8A6;}`;
const SearchInput = styled.input`flex:1;border:none;background:transparent;font-size:13px;color:#334155;&:focus{outline:none;}&::placeholder{color:#94A3B8;}`;
const ResultList = styled.div`display:flex;flex-direction:column;gap:2px;margin-top:8px;max-height:240px;overflow-y:auto;`;
const ResultRow = styled.button`display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:none;background:transparent;border-radius:8px;cursor:pointer;color:#475569;text-align:left;&:hover{background:#F0FDFA;color:#0F766E;}&:disabled{opacity:.5;cursor:default;}`;
const ResultName = styled.span`flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const NoResults = styled.div`font-size:12px;color:#94A3B8;padding:12px 4px;text-align:center;`;
const Empty = styled.div`font-size:13px;color:#94A3B8;padding:10px 0;`;
const Grid = styled.div`display:grid;grid-template-columns:repeat(3,1fr);gap:12px;@media (max-width:1024px){grid-template-columns:repeat(2,1fr);}@media (max-width:640px){grid-template-columns:1fr;}`;
const PCard = styled.div`display:flex;flex-direction:column;gap:8px;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px;`;
const CardTop = styled.div`display:flex;align-items:flex-start;gap:8px;`;
const PName = styled.button`flex:1;text-align:left;border:none;background:none;padding:0;font-family:inherit;font-size:13px;font-weight:700;color:#0F172A;line-height:1.4;cursor:pointer;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;&:hover{color:#0F766E;}&:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}`;
const Unlink = styled.button`flex-shrink:0;width:22px;height:22px;border:none;background:transparent;border-radius:6px;font-size:17px;line-height:1;color:#CBD5E1;cursor:pointer;&:hover{background:#FEE2E2;color:#B91C1C;}&:disabled{opacity:.5;cursor:default;}`;
const RelLabel = styled.span`font-size:11px;font-weight:600;color:#0F766E;background:#CCFBF1;border-radius:999px;padding:2px 8px;align-self:flex-start;`;
const BarTrack = styled.div`height:6px;background:#F1F5F9;border-radius:999px;overflow:hidden;`;
const BarFill = styled.div`height:100%;background:linear-gradient(90deg,#99F6E4,#14B8A6);border-radius:999px;`;
const MetaRow = styled.div`display:flex;align-items:center;gap:6px;flex-wrap:wrap;`;
const Pct = styled.span`font-size:12px;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;`;
const HealthBadge = styled.span`font-size:10px;font-weight:700;border-radius:999px;padding:2px 8px;`;
const OverdueChip = styled.span`font-size:10px;font-weight:700;color:#B91C1C;background:#FEE2E2;border-radius:999px;padding:2px 8px;`;
const DDay = styled.span`margin-left:auto;font-size:11px;font-weight:700;color:#64748B;`;
