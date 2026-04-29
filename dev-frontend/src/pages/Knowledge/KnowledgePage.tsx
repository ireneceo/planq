// Q knowledge — 워크스페이스 지식 베이스. Cue / aiGenerate / Q note 가 참조하는 RAG 소스.
// 30년차 UX:
//   - 카테고리 탭으로 분류 (정책/매뉴얼/사고/FAQ/소개/가격)
//   - 스코프 chip (workspace/project/client) — 어느 범위에 적용되는지 한눈
//   - HelpDot 으로 사용 의도 안내
import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import PageShell from '../../components/Layout/PageShell';
import HelpDot from '../../components/Common/HelpDot';
import EmptyState from '../../components/Common/EmptyState';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import {
  listKnowledge, createKnowledge, deleteKnowledge,
  type KbDocumentRow, type KbCategory, type KbScope,
} from '../../services/knowledge';
import { listProjects, listWorkspaceClients, type ApiProject, type WorkspaceClientRow } from '../../services/qtalk';

const CATEGORIES: KbCategory[] = ['policy', 'manual', 'incident', 'faq', 'about', 'pricing'];
const SCOPES: KbScope[] = ['workspace', 'project', 'client'];

const KnowledgePage = () => {
  const { t } = useTranslation('knowledge');
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;

  const [docs, setDocs] = useState<KbDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<KbCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    title: '', body: '',
    category: 'manual' as KbCategory, scope: 'workspace' as KbScope,
    project_id: null as number | null, client_id: null as number | null,
  });
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [clients, setClients] = useState<WorkspaceClientRow[]>([]);

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const list = await listKnowledge(businessId, { q: search || undefined });
      setDocs(list);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [businessId]);

  // 프로젝트·고객 selector 데이터 (모달 첫 오픈 시 fetch)
  useEffect(() => {
    if (!modalOpen || !businessId) return;
    if (projects.length || clients.length) return; // 이미 로드됨
    Promise.all([
      listProjects(businessId).catch(() => [] as ApiProject[]),
      listWorkspaceClients(businessId).catch(() => [] as WorkspaceClientRow[]),
    ]).then(([p, c]) => {
      setProjects(p);
      setClients(c.filter(x => x.status !== 'archived'));
    });
    // eslint-disable-next-line
  }, [modalOpen, businessId]);

  const filtered = useMemo(() => {
    let list = docs;
    if (activeCat !== 'all') list = list.filter(d => d.category === activeCat);
    return list;
  }, [docs, activeCat]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: docs.length };
    for (const cat of CATEGORIES) c[cat] = docs.filter(d => d.category === cat).length;
    return c;
  }, [docs]);

  const submitNew = async () => {
    if (!businessId) return;
    if (!draft.title.trim() || !draft.body.trim()) return;
    if (draft.scope === 'project' && !draft.project_id) {
      setSubmitError(t('modal.errProjectRequired', '프로젝트 스코프는 프로젝트를 선택해야 합니다') as string);
      return;
    }
    if (draft.scope === 'client' && !draft.client_id) {
      setSubmitError(t('modal.errClientRequired', '고객 스코프는 고객을 선택해야 합니다') as string);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createKnowledge(businessId, {
        title: draft.title.trim(),
        body: draft.body.trim(),
        category: draft.category,
        scope: draft.scope,
        project_id: draft.scope === 'project' ? draft.project_id : null,
        client_id: draft.scope === 'client' ? draft.client_id : null,
      });
      setModalOpen(false);
      setDraft({ title: '', body: '', category: 'manual', scope: 'workspace', project_id: null, client_id: null });
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      setSubmitError(t('modal.errSave', '저장 실패: {{msg}}', { msg }) as string);
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (id: number) => {
    if (!businessId) return;
    try { await deleteKnowledge(businessId, id); await load(); } catch { /* ignore */ }
  };

  if (!businessId) return null;

  return (
    <PageShell
      title={t('page.title', 'Q 지식')}
      count={docs.length}
      helpDot={<HelpDot askCue={t('help.cuePrefill', 'Q 지식의 카테고리와 스코프가 Cue 답변에 어떻게 영향을 주는지 알려줘') as string} topic="qknowledge">
        {t('help.body', 'Cue·AI 작성·Q note 답변 찾기가 참조하는 회사 지식 DB. 카테고리(6종)로 분류하고 스코프(워크스페이스/프로젝트/고객)로 적용 범위 한정. 좁은 스코프가 더 정확.')}
      </HelpDot>}
      actions={<>
        <SearchInput value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load(); }}
          placeholder={t('page.searchPh', '제목 검색...') as string} />
        <NewBtn type="button" onClick={() => setModalOpen(true)}>{t('page.new', '+ 새 지식')}</NewBtn>
      </>}
    >
      <Tabs>
        <Tab type="button" $active={activeCat === 'all'} onClick={() => setActiveCat('all')}>
          {t('cat.all', '전체')} <Cnt>{counts.all || 0}</Cnt>
        </Tab>
        {CATEGORIES.map(cat => (
          <Tab key={cat} type="button" $active={activeCat === cat} onClick={() => setActiveCat(cat)}>
            {t(`cat.${cat}`)} <Cnt>{counts[cat] || 0}</Cnt>
          </Tab>
        ))}
      </Tabs>

      {loading ? <Loading>{t('page.loading', '로드 중…')}</Loading> :
       filtered.length === 0 ? (
         <EmptyState
           icon={<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6.253v13"/><path d="M12 6.253C10.832 5.477 9.246 5 7.5 5 5.754 5 4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253"/><path d="M12 6.253C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18s-3.332.477-4.5 1.253"/></svg>}
           title={t('empty.title', '아직 지식 자료가 없습니다')}
           description={t('empty.desc', 'Cue 가 답변을 찾을 회사 자료를 등록해 보세요.')}
           ctaLabel={t('empty.cta', '+ 새 지식 등록') as string}
           onCta={() => setModalOpen(true)}
         />
       ) : (
         <List>
           {filtered.map(d => (
             <Row key={d.id}>
               <RowMain>
                 <RowTitle>{d.title}</RowTitle>
                 <RowMeta>
                   <Chip $kind="category">{t(`cat.${d.category}`)}</Chip>
                   <Chip $kind="scope">{t(`scope.${d.scope}`)}</Chip>
                   <Status $s={d.status}>{t(`status.${d.status}`, d.status)}</Status>
                   <span>· {d.chunk_count} chunks</span>
                   <span>· {new Date(d.updated_at).toLocaleDateString()}</span>
                 </RowMeta>
               </RowMain>
               <DelBtn type="button" onClick={() => handleDelete(d.id)} aria-label={t('row.delete', '삭제') as string}>×</DelBtn>
             </Row>
           ))}
         </List>
       )}

      {modalOpen && (
        <Backdrop onClick={() => !submitting && setModalOpen(false)}>
          <Modal onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <ModalHeader>{t('modal.title', '새 지식 등록')}</ModalHeader>
            <ModalBody>
              <Field>
                <Label>{t('modal.titleLabel', '제목')}</Label>
                <TextInput value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                  placeholder={t('modal.titlePh', '예: 환불 정책 v1') as string} maxLength={300} />
              </Field>
              <Field>
                <Label>{t('modal.body', '내용')}</Label>
                <TextArea value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
                  placeholder={t('modal.bodyPh', '본문을 입력하세요. 인덱싱 후 Cue 답변에 활용됩니다.') as string}
                  rows={6} />
              </Field>
              <FieldRow>
                <Field>
                  <Label>{t('modal.category', '카테고리')}</Label>
                  <PlanQSelect size="sm" isSearchable={false}
                    value={{ value: draft.category, label: t(`cat.${draft.category}`) as string }}
                    onChange={(opt) => setDraft(d => ({ ...d, category: ((opt as PlanQSelectOption | null)?.value as KbCategory) || 'manual' }))}
                    options={CATEGORIES.map(c => ({ value: c, label: t(`cat.${c}`) as string }))} />
                </Field>
                <Field>
                  <Label>{t('modal.scope', '적용 범위')}</Label>
                  <PlanQSelect size="sm" isSearchable={false}
                    value={{ value: draft.scope, label: t(`scope.${draft.scope}`) as string }}
                    onChange={(opt) => setDraft(d => ({ ...d, scope: ((opt as PlanQSelectOption | null)?.value as KbScope) || 'workspace' }))}
                    options={SCOPES.map(s => ({ value: s, label: t(`scope.${s}`) as string }))} />
                </Field>
              </FieldRow>
              {draft.scope === 'project' && (
                <Field>
                  <Label>{t('modal.projectPick', '프로젝트 선택')}</Label>
                  <PlanQSelect size="sm" isSearchable
                    placeholder={t('modal.projectPh', '프로젝트를 선택하세요') as string}
                    value={draft.project_id
                      ? { value: String(draft.project_id), label: projects.find(p => p.id === draft.project_id)?.name || `Project #${draft.project_id}` }
                      : null}
                    onChange={(opt) => setDraft(d => ({ ...d, project_id: (opt as PlanQSelectOption | null)?.value ? Number((opt as PlanQSelectOption).value) : null }))}
                    options={projects.map(p => ({ value: String(p.id), label: p.name }))} />
                </Field>
              )}
              {draft.scope === 'client' && (
                <Field>
                  <Label>{t('modal.clientPick', '고객 선택')}</Label>
                  <PlanQSelect size="sm" isSearchable
                    placeholder={t('modal.clientPh', '고객을 선택하세요') as string}
                    value={draft.client_id
                      ? { value: String(draft.client_id), label: (() => { const c = clients.find(x => x.id === draft.client_id); return c?.display_name || c?.biz_name || c?.company_name || `Client #${draft.client_id}`; })() }
                      : null}
                    onChange={(opt) => setDraft(d => ({ ...d, client_id: (opt as PlanQSelectOption | null)?.value ? Number((opt as PlanQSelectOption).value) : null }))}
                    options={clients.map(c => ({ value: String(c.id), label: c.display_name || c.biz_name || c.company_name || `Client #${c.id}` }))} />
                </Field>
              )}
              {submitError && <ErrorBox>{submitError}</ErrorBox>}
            </ModalBody>
            <ModalFooter>
              <SecondaryBtn type="button" onClick={() => setModalOpen(false)} disabled={submitting}>
                {t('modal.cancel', '취소')}
              </SecondaryBtn>
              <PrimaryBtn type="button" onClick={submitNew} disabled={submitting || !draft.title.trim() || !draft.body.trim()}>
                {submitting ? t('modal.saving', '저장 중…') : t('modal.save', '등록')}
              </PrimaryBtn>
            </ModalFooter>
          </Modal>
        </Backdrop>
      )}
    </PageShell>
  );
};

export default KnowledgePage;

// ─── styled ───
const SearchInput = styled.input`
  width: 200px; height: 32px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 13px; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const NewBtn = styled.button`
  height: 32px; padding: 0 14px;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 6px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover { background: #0D9488; }
`;
const Tabs = styled.div`display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap;`;
const Tab = styled.button<{ $active?: boolean }>`
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 12px;
  background: ${p => p.$active ? '#0F766E' : '#F1F5F9'};
  color: ${p => p.$active ? '#FFFFFF' : '#475569'};
  border: none; border-radius: 999px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  &:hover { background: ${p => p.$active ? '#0F766E' : '#E2E8F0'}; }
`;
const Cnt = styled.span`
  font-size: 11px; padding: 1px 6px; border-radius: 999px;
  background: rgba(255,255,255,0.25); color: inherit;
`;
const Loading = styled.div`padding: 40px; text-align: center; color: #94A3B8;`;
const List = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Row = styled.div`
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 14px 16px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 10px;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:hover { border-color: #CBD5E1; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
`;
const RowMain = styled.div`flex: 1; min-width: 0;`;
const RowTitle = styled.div`font-size: 14px; font-weight: 600; color: #0F172A; margin-bottom: 6px;`;
const RowMeta = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; color: #64748B;`;
const Chip = styled.span<{ $kind: 'category' | 'scope' }>`
  padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600;
  ${p => p.$kind === 'category' ? 'background:#F0FDFA;color:#0F766E;' : 'background:#FEF2F2;color:#9F1239;'}
`;
const Status = styled.span<{ $s: string }>`
  padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;
  ${p => p.$s === 'ready' ? 'background:#D1FAE5;color:#065F46;' :
        p.$s === 'indexing' ? 'background:#FEF3C7;color:#92400E;' :
        p.$s === 'failed' ? 'background:#FEE2E2;color:#B91C1C;' :
        'background:#F1F5F9;color:#64748B;'}
`;
const DelBtn = styled.button`
  width: 28px; height: 28px;
  border: none; background: transparent;
  font-size: 18px; color: #94A3B8; cursor: pointer; border-radius: 6px;
  &:hover { background: #FEF2F2; color: #DC2626; }
`;
const Backdrop = styled.div`position: fixed; inset: 0; background: rgba(15,23,42,0.40); z-index: 50; display: flex; align-items: center; justify-content: center; padding: 20px;`;
const Modal = styled.div`width: 100%; max-width: 560px; background: #FFFFFF; border-radius: 14px; box-shadow: 0 24px 48px rgba(15,23,42,0.18); display: flex; flex-direction: column; max-height: 90vh; overflow: hidden;`;
const ModalHeader = styled.div`padding: 18px 22px; border-bottom: 1px solid #E2E8F0; font-size: 16px; font-weight: 700; color: #0F172A;`;
const ModalBody = styled.div`padding: 20px 22px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px;`;
const ModalFooter = styled.div`padding: 14px 22px; border-top: 1px solid #E2E8F0; display: flex; justify-content: flex-end; gap: 8px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px; flex: 1;`;
const FieldRow = styled.div`display: flex; gap: 12px;`;
const Label = styled.label`font-size: 13px; font-weight: 600; color: #0F172A;`;
const ErrorBox = styled.div`
  padding: 8px 12px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px;
  font-size: 12px; color: #B91C1C;
`;
const TextInput = styled.input`height: 36px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 13px; color: #0F172A; &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }`;
const TextArea = styled.textarea`padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 13px; color: #0F172A; font-family: inherit; resize: vertical; &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }`;
const PrimaryBtn = styled.button`height: 36px; padding: 0 18px; background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; &:disabled { background: #CBD5E1; cursor: not-allowed; } &:hover:not(:disabled) { background: #0D9488; }`;
const SecondaryBtn = styled.button`height: 36px; padding: 0 14px; background: transparent; color: #475569; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; &:hover { background: #F8FAFC; border-color: #CBD5E1; }`;
