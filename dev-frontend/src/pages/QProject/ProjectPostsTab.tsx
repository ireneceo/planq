// 프로젝트 detail 안의 "문서" 탭 — 인라인 위젯 (Sidebar 없음)
// 패턴: 헤더(검색·카테고리 chips·새 문서 CTA) → 카드 그리드 → 클릭 시 인라인 마스터-디테일
// 의존: PostsPage 의 핵심 빌딩블록 (PostEditor·PostShareModal·KindIcon) 그대로 재사용
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import {
  fetchPosts, fetchPost, createPost, updatePost, deletePost,
  attachToPost, detachFromPost,
  type PostRow, type PostDetail,
} from '../../services/posts';
import PostEditor from '../../components/Docs/PostEditor';
import PostShareModal from '../../components/Docs/PostShareModal';
import PostSignatureModal from '../../components/Docs/PostSignatureModal';
import PostAiModal from '../../components/Docs/PostAiModal';
import SignatureProgressSection from '../../components/Docs/SignatureProgressSection';
import KindIcon from '../../components/Docs/KindIcon';
import type { DocKind } from '../../services/docs';
import InlineAttachPicker from '../../components/Docs/InlineAttachPicker';
import { uploadProjectFile } from '../../services/files';
import { listTemplates, type DocTemplate, KIND_LABELS_KO } from '../../services/docs';
import { useAuth } from '../../contexts/AuthContext';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import EmptyState from '../../components/Common/EmptyState';

interface Props {
  businessId: number;
  projectId: number;
}

type Mode = 'list' | 'view' | 'edit' | 'new';

function inferKindFromTitle(title: string, category: string | null): 'contract' | 'nda' | 'sow' | 'proposal' | 'quote' | 'other' {
  const t = ((title || '') + ' ' + (category || '')).toLowerCase();
  if (/계약|contract/.test(t)) return 'contract';
  if (/nda|기밀|비밀유지/.test(t)) return 'nda';
  if (/sow|작업|명세/.test(t)) return 'sow';
  if (/제안|proposal/.test(t)) return 'proposal';
  if (/견적|quote|quotation/.test(t)) return 'quote';
  return 'other';
}

const ProjectPostsTab: React.FC<Props> = ({ businessId, projectId }) => {
  const { t } = useTranslation('qdocs');
  const { formatDate } = useTimeFormat();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  // AI / 템플릿 모달
  const [aiOpen, setAiOpen] = useState(false);
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [tplSearch, setTplSearch] = useState('');

  const [mode, setMode] = useState<Mode>('list');
  const [rows, setRows] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const [titleDraft, setTitleDraft] = useState('');
  const [contentDraft, setContentDraft] = useState<unknown>(null);
  const [categoryDraft, setCategoryDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<File[]>([]);
  const [pendingExistingIds, setPendingExistingIds] = useState<number[]>([]);
  const [pendingExistingMeta, setPendingExistingMeta] = useState<Record<number, { name: string; size: number }>>({});
  const submittingRef = useRef(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [signReloadKey, setSignReloadKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<PostDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchPosts(businessId, { projectId, query: query.trim() || undefined });
      setRows(list);
    } finally { setLoading(false); }
  }, [businessId, projectId, query]);

  useEffect(() => { load(); }, [load]);

  // 카테고리 목록 (rows 에서 추출 — 별도 meta 호출 안 함)
  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.category) m.set(r.category, (m.get(r.category) || 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!categoryFilter) return rows;
    return rows.filter(r => r.category === categoryFilter);
  }, [rows, categoryFilter]);

  const pinnedRows = useMemo(() => filteredRows.filter(r => r.is_pinned), [filteredRows]);
  const otherRows = useMemo(() => filteredRows.filter(r => !r.is_pinned), [filteredRows]);

  // 템플릿 모달 열기 (시스템 + 사용자 템플릿)
  const openTemplateModal = async () => {
    if (!businessId) return;
    setTplModalOpen(true);
    setTplSearch('');
    try {
      const list = await listTemplates(businessId);
      setTemplates(list);
    } catch { /* ignore */ }
  };

  // mustache 클라이언트 치환 (PostsPage 와 동일 — business/today 만)
  const renderTemplateClient = (html: string): string => {
    const today = new Date().toISOString().slice(0, 10);
    const todayPlus30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const ctx: Record<string, string> = {
      'business.name': user?.business_name || '',
      'business.brand_name': user?.business_name || '',
      'party_a.name': user?.business_name || '',
      'issued_at': today,
      'effective_date': today,
      'valid_until': todayPlus30,
      'duration_months': '24',
      'title': '',
    };
    return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => ctx[p] ?? '');
  };

  const startFromAi = ({ title, bodyHtml }: { title: string; bodyHtml: string }) => {
    setActiveId(null);
    setDetail(null);
    setMode('new');
    setTitleDraft(title);
    setContentDraft(bodyHtml as unknown);
    // 카테고리는 현재 활성 필터가 있으면 따라가고, 없으면 빈 값
    setCategoryDraft(categoryFilter || '');
    setPendingUploads([]); setPendingExistingIds([]); setPendingExistingMeta({});
    setError(null);
    setAiOpen(false);
  };

  const startFromTemplate = (tpl: DocTemplate) => {
    setActiveId(null);
    setDetail(null);
    setMode('new');
    setTitleDraft(tpl.name);
    const html = tpl.body_template ? renderTemplateClient(tpl.body_template) : '';
    setContentDraft(html as unknown);
    setCategoryDraft(categoryFilter || KIND_LABELS_KO[tpl.kind] || '');
    setPendingUploads([]); setPendingExistingIds([]); setPendingExistingMeta({});
    setError(null);
    setTplModalOpen(false);
  };

  const filteredTemplates = useMemo(() => {
    const q = tplSearch.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(t =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.kind || '').toLowerCase().includes(q)
    );
  }, [templates, tplSearch]);

  // URL ?new=1&category=quote 진입 시 자동 new 모드 + 카테고리 prefill (Phase D+1 거래 탭 followup)
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const isNew = sp.get('new') === '1';
    if (!isNew) return;
    const cat = sp.get('category') || '';
    setMode('new');
    setActiveId(null);
    setDetail(null);
    setTitleDraft('');
    setContentDraft(null);
    setCategoryDraft(cat);
    setError(null);
    // URL 정리 (재진입 방지)
    sp.delete('new'); sp.delete('category');
    navigate(`${location.pathname}${sp.toString() ? `?${sp.toString()}` : ''}`, { replace: true });
  }, [location.search, location.pathname, navigate]);

  // 상세 로드
  useEffect(() => {
    if (!activeId) { setDetail(null); return; }
    let cancelled = false;
    (async () => {
      const d = await fetchPost(activeId);
      if (cancelled) return;
      setDetail(d);
      if (d) {
        setTitleDraft(d.title);
        setContentDraft(d.content_json);
        setCategoryDraft(d.category || '');
      }
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  const openPost = (id: number) => {
    if (activeId === id && mode === 'view') { setActiveId(null); setMode('list'); return; }
    setActiveId(id); setMode('view');
  };

  const startNew = () => {
    setActiveId(null); setDetail(null);
    setTitleDraft(''); setContentDraft(null);
    setCategoryDraft(categoryFilter || '');
    setPendingUploads([]); setPendingExistingIds([]); setPendingExistingMeta({});
    setError(null);
    setMode('new');
  };

  const startEdit = () => {
    if (!detail) return;
    setTitleDraft(detail.title); setContentDraft(detail.content_json); setCategoryDraft(detail.category || '');
    setError(null);
    setMode('edit');
  };

  const cancel = () => {
    if (mode === 'new') {
      setMode('list');
      setPendingUploads([]); setPendingExistingIds([]); setPendingExistingMeta({});
    } else if (mode === 'edit' && detail) {
      setMode('view');
      setTitleDraft(detail.title); setContentDraft(detail.content_json); setCategoryDraft(detail.category || '');
    } else {
      setMode('list'); setActiveId(null);
    }
    setError(null);
  };

  const submit = async () => {
    if (submittingRef.current) return;
    if (!titleDraft.trim()) { setError(t('validation.titleRequired', '제목을 입력하세요') as string); return; }
    submittingRef.current = true;
    setSaving(true); setError(null);
    try {
      const categoryVal = categoryDraft.trim() || null;
      if (mode === 'new') {
        const created = await createPost({
          business_id: businessId,
          project_id: projectId, // 자동 강제
          title: titleDraft.trim(),
          content_json: contentDraft as { type: 'doc'; content: unknown[] } | null,
          category: categoryVal,
        });
        const fileIdsToAttach: number[] = [...pendingExistingIds];
        if (pendingUploads.length > 0) {
          for (const f of pendingUploads) {
            const result = await uploadProjectFile(businessId, projectId, f);
            if (result.success && result.file) {
              const fid = Number(result.file.id.replace(/^direct-/, ''));
              if (fid) fileIdsToAttach.push(fid);
            }
          }
        }
        let final = created;
        if (fileIdsToAttach.length > 0) {
          await attachToPost(created.id, fileIdsToAttach);
          final = (await fetchPost(created.id)) || created;
        }
        setDetail(final); setActiveId(final.id); setMode('view');
        setPendingUploads([]); setPendingExistingIds([]); setPendingExistingMeta({});
        await load();
      } else if (mode === 'edit' && detail) {
        const patched = await updatePost(detail.id, {
          title: titleDraft.trim(),
          content_json: contentDraft as { type: 'doc'; content: unknown[] } | null,
          category: categoryVal,
        });
        setDetail(patched); setMode('view');
        await load();
      }
    } catch (e) { setError((e as Error).message); }
    finally { submittingRef.current = false; setSaving(false); }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    await deletePost(deleteTarget.id);
    setDeleteTarget(null); setActiveId(null); setMode('list'); setDetail(null);
    await load();
  };

  const handlePickFiles = (files: File[]) => { setPendingUploads(prev => [...prev, ...files]); };
  const handlePickExisting = (ids: number[], metaMap?: Record<number, { name: string; size: number }>) => {
    setPendingExistingIds(prev => Array.from(new Set([...prev, ...ids])));
    if (metaMap) setPendingExistingMeta(prev => ({ ...prev, ...metaMap }));
  };
  const detachOne = async (attId: number) => {
    if (!detail) return;
    await detachFromPost(detail.id, attId);
    const fresh = await fetchPost(detail.id);
    if (fresh) setDetail(fresh);
  };

  // ─── 렌더 ───
  if (mode === 'list') {
    return (
      <Wrap>
        <Toolbar>
          <SearchBox>
            <SearchIcon>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            </SearchIcon>
            <SearchInput
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('project.docs.searchPh', '제목·내용 검색') as string}
            />
          </SearchBox>
          <AiBtn type="button" onClick={() => setAiOpen(true)} title={t('ai.openHint', 'AI 가 문서 본문을 자동 작성') as string}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
            {t('ai.btn', 'AI')}
          </AiBtn>
          <TemplateBtn type="button" onClick={openTemplateModal} title={t('templates.openHint', '템플릿에서 시작') as string}>
            {t('templates.btn', '템플릿')}
          </TemplateBtn>
          <NewBtn type="button" onClick={startNew}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {t('project.docs.new', '새 문서')}
          </NewBtn>
        </Toolbar>

        {categories.length > 0 && (
          <ChipRow>
            <Chip $active={categoryFilter === null} onClick={() => setCategoryFilter(null)}>
              {t('project.docs.all', '전체')} · {rows.length}
            </Chip>
            {categories.map(c => (
              <Chip key={c.name} $active={categoryFilter === c.name} onClick={() => setCategoryFilter(c.name === categoryFilter ? null : c.name)}>
                #{c.name} · {c.count}
              </Chip>
            ))}
          </ChipRow>
        )}

        {loading ? (
          <Center>{t('project.docs.loading', '문서 불러오는 중…')}</Center>
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon={(
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            )}
            title={t('project.docs.empty', '아직 작성된 문서가 없습니다') as string}
            description={t('project.docs.emptyDesc', '이 프로젝트에 회의록·제안서·NDA 등 문서를 작성해 보세요.') as string}
            ctaLabel={t('project.docs.new', '새 문서') as string}
            onCta={startNew}
          />
        ) : (
          <>
            {pinnedRows.length > 0 && (
              <Section>
                <SectionLabel>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M16 9V4l1 0a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2l1 0v5a5 5 0 0 0-3 5h6v6l1 1l1-1v-6h6a5 5 0 0 0-3-5z"/></svg>
                  {t('project.docs.pinned', '고정됨')}
                </SectionLabel>
                <Grid>
                  {pinnedRows.map(r => <PostCard key={r.id} row={r} onClick={() => openPost(r.id)} formatDate={formatDate} />)}
                </Grid>
              </Section>
            )}
            <Section>
              {pinnedRows.length > 0 && <SectionLabel>{t('project.docs.allDocs', '문서')} · {otherRows.length}</SectionLabel>}
              <Grid>
                {otherRows.map(r => <PostCard key={r.id} row={r} onClick={() => openPost(r.id)} formatDate={formatDate} />)}
              </Grid>
            </Section>
          </>
        )}

        {/* AI 작성 모달 — list 모드에서도 열려야 함 */}
        {aiOpen && (
          <PostAiModal
            open={aiOpen}
            onClose={() => setAiOpen(false)}
            onGenerate={startFromAi}
            businessId={businessId}
          />
        )}

        {/* 템플릿 모달 — list 모드에서도 열려야 함 */}
        {tplModalOpen && (
          <TplBackdrop onClick={() => setTplModalOpen(false)}>
            <TplDialog
              role="dialog"
              aria-modal="true"
              aria-label={t('templates.modalTitle', '템플릿 선택') as string}
              onClick={e => e.stopPropagation()}
            >
              <TplHead>
                <TplTitle>{t('templates.modalTitle', '템플릿에서 시작')}</TplTitle>
                <TplClose type="button" onClick={() => setTplModalOpen(false)} aria-label={t('close', '닫기') as string}>×</TplClose>
              </TplHead>
              <TplSub>{t('templates.modalSub', '본문이 자동으로 채워집니다. 자유롭게 편집한 후 저장하세요.')}</TplSub>
              <TplSearchWrap>
                <input
                  type="text"
                  value={tplSearch}
                  onChange={e => setTplSearch(e.target.value)}
                  placeholder={t('templates.searchPh', '템플릿 검색') as string}
                />
              </TplSearchWrap>
              <TplGrid>
                {filteredTemplates.length === 0 ? (
                  <TplEmpty>{t('templates.empty', '템플릿이 없습니다')}</TplEmpty>
                ) : filteredTemplates.map(tpl => (
                  <TplCard key={tpl.id} type="button" onClick={() => startFromTemplate(tpl)}>
                    <TplCardKind>{KIND_LABELS_KO[tpl.kind] || tpl.kind}</TplCardKind>
                    <TplCardName>{tpl.name}</TplCardName>
                    {tpl.description && <TplCardDesc>{tpl.description}</TplCardDesc>}
                  </TplCard>
                ))}
              </TplGrid>
            </TplDialog>
          </TplBackdrop>
        )}
      </Wrap>
    );
  }

  // 보기 / 편집 / 신규 모드
  return (
    <Wrap>
      <DetailHeader>
        <BackBtn type="button" onClick={cancel}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          {mode === 'view' ? t('project.docs.back', '목록') : t('cancel', '취소')}
        </BackBtn>
        <DetailActions>
          {mode === 'view' && detail && (
            <>
              <SignTabBtn type="button" onClick={() => setSignOpen(true)} title={t('sign.headerHint', '서명자에게 이메일로 서명 요청') as string}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
                {t('sign.button', '서명 받기')}
              </SignTabBtn>
              <ShareBtn type="button" onClick={() => setShareOpen(true)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                {t('share.button', '공유')}
              </ShareBtn>
              <SecondaryBtn type="button" onClick={() => window.print()} title={t('actions.print', 'PDF / 인쇄') as string} aria-label={t('actions.print', 'PDF / 인쇄') as string}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              </SecondaryBtn>
              <SecondaryBtn type="button" onClick={startEdit}>{t('edit', '편집')}</SecondaryBtn>
              <DangerBtn type="button" onClick={() => setDeleteTarget(detail)}>{t('delete', '삭제')}</DangerBtn>
            </>
          )}
          {(mode === 'edit' || mode === 'new') && (
            <>
              <SecondaryBtn type="button" disabled={saving} onClick={cancel}>{t('cancel', '취소')}</SecondaryBtn>
              <PrimaryBtn type="button" disabled={saving || !titleDraft.trim()} onClick={submit}>
                {saving ? t('saving', '저장 중…') : t('save', '저장')}
              </PrimaryBtn>
            </>
          )}
        </DetailActions>
      </DetailHeader>

      {mode === 'view' && detail && (
        <DetailBody>
          <DetailMeta>
            <span>{detail.author?.name || '—'}</span>
            <span>·</span>
            <span>{formatDate(detail.created_at)}</span>
            {detail.editor && detail.editor.id !== detail.author?.id && (
              <><span>·</span><span>{t('editedBy', '수정: {{name}}', { name: detail.editor.name })}</span></>
            )}
            {detail.category && <CategoryTag>#{detail.category}</CategoryTag>}
            {detail.share_token && (
              <ShareTag title={t('share.publicHint', '공개 링크가 활성화되어 있습니다') as string}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/></svg>
                {t('share.publicBadge', '공유 중')}
              </ShareTag>
            )}
          </DetailMeta>
          <DetailTitle>{detail.title}</DetailTitle>
          <div data-print-area>
            <PrintOnlyTitle>{detail.title}</PrintOnlyTitle>
            <PostEditor value={detail.content_json} onChange={() => {}} editable={false} />
          </div>
          <SignatureProgressSection
            postId={detail.id}
            postTitle={detail.title}
            inferredKind={inferKindFromTitle(detail.title, detail.category)}
            reloadTrigger={signReloadKey}
            onAddMore={() => setSignOpen(true)}
          />
          <AttachSection>
            <AttachTitle>{t('attachments', '첨부 파일')}</AttachTitle>
            {detail.attachments.length > 0 && (
              <AttachList>
                {detail.attachments.map(a => (
                  <AttachRow key={a.id}>
                    <AttachLink href={a.file?.download_url || '#'} target="_blank" rel="noreferrer">
                      {a.file?.file_name || '—'}
                    </AttachLink>
                    <RemoveBtn type="button" onClick={() => detachOne(a.id)} title={t('attach.remove', '제거') as string} aria-label={t('attach.remove', '제거') as string}>×</RemoveBtn>
                  </AttachRow>
                ))}
              </AttachList>
            )}
            <InlineAttachPicker
              businessId={businessId}
              excludeIds={detail.attachments?.map(a => a.file_id).filter((x): x is number => !!x) || []}
              onPickFiles={handlePickFiles}
              onPickExisting={handlePickExisting}
            />
          </AttachSection>
        </DetailBody>
      )}

      {(mode === 'edit' || mode === 'new') && (
        <DetailBody>
          <TitleInput
            autoFocus={mode === 'new'}
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            placeholder={t('titlePlaceholder', '문서 제목') as string}
            maxLength={200}
          />
          <CategoryInput
            value={categoryDraft}
            onChange={e => setCategoryDraft(e.target.value)}
            placeholder={t('categoryPlaceholder', '카테고리 (예: 회의록, 제안서)') as string}
            maxLength={40}
          />
          {error && <ErrorBar>{error}</ErrorBar>}
          <PostEditor value={contentDraft} onChange={setContentDraft} placeholder={t('contentPlaceholder', '본문을 작성하세요…') as string} />
          <AttachSection>
            <AttachTitle>{t('attachments', '첨부 파일')}</AttachTitle>
            {mode === 'edit' && detail && detail.attachments.length > 0 && (
              <AttachList>
                {detail.attachments.map(a => (
                  <AttachRow key={a.id}>
                    <AttachLink href={a.file?.download_url || '#'} target="_blank" rel="noreferrer">
                      {a.file?.file_name || '—'}
                    </AttachLink>
                    <RemoveBtn type="button" onClick={() => detachOne(a.id)} title={t('attach.remove', '제거') as string} aria-label={t('attach.remove', '제거') as string}>×</RemoveBtn>
                  </AttachRow>
                ))}
              </AttachList>
            )}
            {mode === 'new' && (pendingUploads.length > 0 || pendingExistingIds.length > 0) && (
              <AttachList>
                {pendingUploads.map((f, i) => (
                  <AttachRow key={`u-${i}`}>
                    <AttachLink as="span">{f.name}</AttachLink>
                    <RemoveBtn type="button" onClick={() => setPendingUploads(prev => prev.filter((_, idx) => idx !== i))}>×</RemoveBtn>
                  </AttachRow>
                ))}
                {pendingExistingIds.map(fid => (
                  <AttachRow key={`e-${fid}`}>
                    <AttachLink as="span">{pendingExistingMeta[fid]?.name || `file #${fid}`}</AttachLink>
                    <RemoveBtn type="button" onClick={() => {
                      setPendingExistingIds(prev => prev.filter(x => x !== fid));
                      setPendingExistingMeta(prev => { const c = { ...prev }; delete c[fid]; return c; });
                    }}>×</RemoveBtn>
                  </AttachRow>
                ))}
              </AttachList>
            )}
            <InlineAttachPicker
              businessId={businessId}
              excludeIds={[
                ...(detail?.attachments?.map(a => a.file_id).filter((x): x is number => !!x) || []),
                ...pendingExistingIds,
              ]}
              onPickFiles={handlePickFiles}
              onPickExisting={handlePickExisting}
            />
          </AttachSection>
        </DetailBody>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={onDelete}
        title={t('deleteTitle', '문서 삭제') as string}
        message={t('deleteMessage', '"{{title}}" 문서를 삭제할까요? 이 작업은 되돌릴 수 없습니다.', { title: deleteTarget?.title || '' }) as string}
        confirmText={t('delete', '삭제') as string}
        cancelText={t('cancel', '취소') as string}
        variant="danger"
      />

      {detail && signOpen && (
        <PostSignatureModal
          open={signOpen}
          onClose={() => setSignOpen(false)}
          post={detail}
          onSent={() => setSignReloadKey(k => k + 1)}
        />
      )}

      {detail && shareOpen && (
        <PostShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          post={detail}
          onChanged={updated => setDetail(updated)}
        />
      )}

      {/* AI 작성 모달 */}
      {aiOpen && (
        <PostAiModal
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          onGenerate={startFromAi}
          businessId={businessId}
        />
      )}

      {/* 템플릿 모달 */}
      {tplModalOpen && (
        <TplBackdrop onClick={() => setTplModalOpen(false)}>
          <TplDialog
            role="dialog"
            aria-modal="true"
            aria-label={t('templates.modalTitle', '템플릿 선택') as string}
            onClick={e => e.stopPropagation()}
          >
            <TplHead>
              <TplTitle>{t('templates.modalTitle', '템플릿에서 시작')}</TplTitle>
              <TplClose type="button" onClick={() => setTplModalOpen(false)} aria-label={t('close', '닫기') as string}>×</TplClose>
            </TplHead>
            <TplSub>{t('templates.modalSub', '본문이 자동으로 채워집니다. 자유롭게 편집한 후 저장하세요.')}</TplSub>
            <TplSearchWrap>
              <input
                type="text"
                value={tplSearch}
                onChange={e => setTplSearch(e.target.value)}
                placeholder={t('templates.searchPh', '템플릿 검색') as string}
              />
            </TplSearchWrap>
            <TplGrid>
              {filteredTemplates.length === 0 ? (
                <TplEmpty>{t('templates.empty', '템플릿이 없습니다')}</TplEmpty>
              ) : filteredTemplates.map(tpl => (
                <TplCard key={tpl.id} type="button" onClick={() => startFromTemplate(tpl)}>
                  <TplCardKind>{KIND_LABELS_KO[tpl.kind] || tpl.kind}</TplCardKind>
                  <TplCardName>{tpl.name}</TplCardName>
                  {tpl.description && <TplCardDesc>{tpl.description}</TplCardDesc>}
                </TplCard>
              ))}
            </TplGrid>
          </TplDialog>
        </TplBackdrop>
      )}
    </Wrap>
  );
};

export default ProjectPostsTab;

// ─── 카드 ───
interface PostCardProps {
  row: PostRow;
  onClick: () => void;
  formatDate: (iso: string) => string;
}
const PostCard: React.FC<PostCardProps> = ({ row, onClick, formatDate }) => (
  <Card type="button" onClick={onClick}>
    <CardHead>
      <CardKindIcon>
        <KindIcon kind={inferKind(row.title)} size={16} />
      </CardKindIcon>
      {row.is_pinned && <PinDot title="pinned" />}
    </CardHead>
    <CardTitle>{row.title}</CardTitle>
    {row.content_preview && <CardPreview>{row.content_preview}</CardPreview>}
    <CardFooter>
      <CardAuthor>{row.author?.name || '—'}</CardAuthor>
      <CardDate>{formatDate(row.updated_at)}</CardDate>
      {row.category && <CardCat>#{row.category}</CardCat>}
    </CardFooter>
  </Card>
);

// 제목/카테고리에서 kind 추정 (KindIcon 재사용)
function inferKind(title: string): DocKind {
  const t = title.toLowerCase();
  if (/회의록|meeting|회의/.test(t)) return 'meeting_note';
  if (/nda|기밀/.test(t)) return 'nda';
  if (/제안|proposal/.test(t)) return 'proposal';
  if (/견적|quote/.test(t)) return 'quote';
  if (/청구|invoice|세금/.test(t)) return 'invoice';
  if (/계약|contract/.test(t)) return 'contract';
  return 'custom';
}

// ─── styled ───
const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 16px; min-height: 0;
`;
const Toolbar = styled.div`
  display: flex; align-items: center; gap: 8px;
  @media (max-width: 640px) { flex-wrap: wrap; }
`;
const SearchBox = styled.div`
  flex: 1; min-width: 200px; position: relative; display: flex; align-items: center;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
  &:focus-within { border-color: #14B8A6; }
`;
const SearchIcon = styled.span`
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: #94A3B8;
`;
const SearchInput = styled.input`
  flex: 1; height: 36px; padding: 0 12px 0 32px; font-size: 13px; color: #0F172A;
  border: none; background: transparent; outline: none;
  &::placeholder { color: #94A3B8; }
`;
const NewBtn = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  height: 36px; padding: 0 16px;
  font-size: 13px; font-weight: 700; color: #fff; background: #14B8A6;
  border: none; border-radius: 10px; cursor: pointer; white-space: nowrap;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
const AiBtn = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  height: 36px; padding: 0 12px;
  font-size: 12px; font-weight: 700; color: #0F766E; background: #fff;
  border: 1px solid #5EEAD4; border-radius: 10px; cursor: pointer; white-space: nowrap;
  transition: all 0.15s;
  & svg { color: #14B8A6; }
  &:hover { background: #F0FDFA; border-color: #14B8A6; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const TemplateBtn = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  height: 36px; padding: 0 12px;
  font-size: 12px; font-weight: 700; color: #334155; background: #fff;
  border: 1px solid #E2E8F0; border-radius: 10px; cursor: pointer; white-space: nowrap;
  transition: all 0.15s;
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const TplBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.5);
  display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 100;
`;
const TplDialog = styled.div`
  background: #fff; border-radius: 14px; width: 100%; max-width: 720px;
  max-height: 88vh; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(15,23,42,0.25);
`;
const TplHead = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 24px 8px;
`;
const TplTitle = styled.h3`font-size: 16px; font-weight: 700; color: #0F172A; margin: 0;`;
const TplClose = styled.button`
  background: none; border: none; font-size: 24px; line-height: 1; color: #94A3B8; cursor: pointer; padding: 0 6px;
  &:hover { color: #475569; }
`;
const TplSub = styled.div`padding: 0 24px; font-size: 13px; color: #64748B;`;
const TplSearchWrap = styled.div`
  padding: 12px 24px;
  & input {
    width: 100%; padding: 9px 12px; font-size: 13px;
    background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
    &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  }
`;
const TplGrid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;
  padding: 0 24px 20px; overflow-y: auto;
`;
const TplCard = styled.button`
  display: flex; flex-direction: column; gap: 4px; align-items: flex-start;
  padding: 14px 16px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
  cursor: pointer; text-align: left;
  transition: background 0.12s, border-color 0.12s;
  &:hover { background: #F0FDFA; border-color: #14B8A6; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const TplCardKind = styled.span`font-size: 10px; font-weight: 700; color: #0F766E; text-transform: uppercase; letter-spacing: 0.4px;`;
const TplCardName = styled.span`font-size: 13px; font-weight: 700; color: #0F172A;`;
const TplCardDesc = styled.span`font-size: 11px; color: #64748B; line-height: 1.4;`;
const TplEmpty = styled.div`grid-column: 1 / -1; text-align: center; padding: 24px; color: #94A3B8; font-size: 13px;`;
const ChipRow = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
`;
const Chip = styled.button<{ $active: boolean }>`
  height: 28px; padding: 0 12px;
  font-size: 12px; font-weight: 600;
  background: ${p => p.$active ? '#0F766E' : '#fff'};
  color: ${p => p.$active ? '#fff' : '#475569'};
  border: 1px solid ${p => p.$active ? '#0F766E' : '#E2E8F0'};
  border-radius: 999px; cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  &:hover { border-color: ${p => p.$active ? '#0D9488' : '#CBD5E1'}; }
`;

const Section = styled.section`display: flex; flex-direction: column; gap: 10px;`;
const SectionLabel = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;
`;
const Grid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px;
`;
const Card = styled.button`
  all: unset; cursor: pointer; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 8px;
  padding: 16px; min-height: 144px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
  &:hover {
    border-color: #14B8A6; transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(20,184,166,0.08);
  }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const CardHead = styled.div`display:flex;align-items:center;justify-content:space-between;`;
const CardKindIcon = styled.span`
  width: 28px; height: 28px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #F0FDFA; color: #0F766E;
`;
const PinDot = styled.span`
  width: 6px; height: 6px; border-radius: 50%; background: #F43F5E;
`;
const CardTitle = styled.h3`
  font-size: 14px; font-weight: 700; color: #0F172A; margin: 0;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; line-height: 1.4;
`;
const CardPreview = styled.p`
  font-size: 12px; color: #64748B; margin: 0; line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
`;
const CardFooter = styled.div`
  margin-top: auto; display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: #94A3B8;
`;
const CardAuthor = styled.span`color:#64748B;font-weight:600;`;
const CardDate = styled.span``;
const CardCat = styled.span`
  margin-left: auto; padding: 2px 8px; background: #F0FDFA; color: #0F766E;
  border-radius: 999px; font-weight: 600;
`;

const Center = styled.div`
  min-height: 200px; display: flex; align-items: center; justify-content: center;
  color: #64748B; font-size: 13px;
`;

// ─── 보기/편집/신규 ───
const DetailHeader = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding-bottom: 8px; border-bottom: 1px solid #E2E8F0;
`;
const BackBtn = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  height: 32px; padding: 0 12px;
  font-size: 13px; font-weight: 600; color: #334155;
  background: transparent; border: 1px solid transparent; border-radius: 8px; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const DetailActions = styled.div`display:flex;align-items:center;gap:6px;`;
const PrimaryBtn = styled.button`
  height: 32px; padding: 0 16px; font-size: 13px; font-weight: 700; color: #fff;
  background: #14B8A6; border: none; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  height: 32px; padding: 0 14px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  &:hover { border-color: #CBD5E1; background: #F8FAFC; }
`;
const ShareBtn = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  height: 32px; padding: 0 14px;
  font-size: 13px; font-weight: 700; color: #fff; background: #14B8A6;
  border: none; border-radius: 8px; cursor: pointer;
  &:hover { background: #0D9488; }
`;
const SignTabBtn = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  height: 32px; padding: 0 14px;
  font-size: 13px; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border: 1px solid #14B8A6; border-radius: 8px; cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.15s;
  &:hover:not(:disabled) { background: #14B8A6; color: #fff; transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
const DangerBtn = styled.button`
  height: 32px; padding: 0 12px;
  font-size: 13px; font-weight: 600; color: #DC2626;
  background: #fff; border: 1px solid #EF4444; border-radius: 8px; cursor: pointer;
  &:hover { background: #FEF2F2; }
`;
const DetailBody = styled.div`
  display: flex; flex-direction: column; gap: 12px; padding: 8px 0 24px;
`;
const DetailTitle = styled.h1`font-size:24px;font-weight:700;color:#0F172A;margin:0;`;
const DetailMeta = styled.div`
  display: flex; align-items: center; gap: 6px; font-size: 12px; color: #94A3B8; flex-wrap: wrap;
`;
const CategoryTag = styled.span`
  display: inline-flex; padding: 2px 8px; background: #F0FDFA; color: #0F766E;
  border-radius: 999px; font-size: 11px; font-weight: 600;
`;
const ShareTag = styled.span`
  display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px;
  background: #FFF7ED; color: #C2410C; border: 1px solid #FED7AA; border-radius: 999px;
  font-size: 10px; font-weight: 700;
`;
const TitleInput = styled.input`
  width: 100%; padding: 8px 0; font-size: 22px; font-weight: 700; color: #0F172A;
  border: none; border-bottom: 1px solid #E2E8F0; background: transparent;
  &:focus { outline: none; border-bottom-color: #14B8A6; }
  &::placeholder { color: #CBD5E1; }
`;
const CategoryInput = styled.input`
  width: 100%; padding: 6px 0; font-size: 13px; color: #475569;
  border: none; background: transparent;
  &:focus { outline: none; }
  &::placeholder { color: #94A3B8; }
`;
const ErrorBar = styled.div`
  font-size: 12px; color: #DC2626; background: #FEF2F2; padding: 8px 10px;
  border-radius: 6px;
`;
const PrintOnlyTitle = styled.h1`
  display: none;
  @media print { display: block; font-size: 24px; font-weight: 700; color: #0F172A; margin: 0 0 16px 0; }
`;
const AttachSection = styled.section`
  margin-top: 12px; padding-top: 16px;
  border-top: 1px solid #EEF2F6;
  display: flex; flex-direction: column; gap: 12px;
`;
const AttachTitle = styled.div`font-size: 13px; font-weight: 700; color: #334155;`;
const AttachList = styled.div`display:flex;flex-direction:column;`;
const AttachRow = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; background: #fff; border: 1px solid #EEF2F6; border-radius: 8px;
  & + & { margin-top: 6px; }
`;
const AttachLink = styled.a`
  flex: 1; min-width: 0; font-size: 13px; color: #0F766E;
  text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  &:hover { text-decoration: underline; }
`;
const RemoveBtn = styled.button`
  width: 24px; height: 24px; padding: 0;
  background: transparent; border: none; cursor: pointer;
  font-size: 16px; color: #94A3B8;
  &:hover { color: #DC2626; }
`;
