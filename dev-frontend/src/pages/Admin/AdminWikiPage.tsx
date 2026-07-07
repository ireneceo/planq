// Q위키 (Q Wiki) 관리 — Platform Admin (A1/A2).
//   좌측 글 목록(카테고리 필터·검색·새 글) / 우측 편집기(메타 + 블록 에디터 + 발행·캡처·미리보기·삭제).
//   카테고리 관리 모달. 본문은 plain-text 블록(text/heading/step/callout/image) — body_ko/body_en 병렬.
//   백엔드: /api/admin/wiki/* (platform_admin 전용).
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../../components/Layout/PageShell';
import SearchBox from '../../components/Common/SearchBox';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import ActionButton from '../../components/Common/ActionButton';
import StandardModal from '../../components/Common/StandardModal';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { mapApiError } from '../../utils/apiError';
import { apiFetch } from '../../contexts/AuthContext';
import {
  listWikiCategories, createWikiCategory, updateWikiCategory, deleteWikiCategory,
  listWikiArticles, getWikiArticle, createWikiArticle, updateWikiArticle, deleteWikiArticle,
  captureWikiArticle, reembedWiki, blocksFromBodies, bodiesFromBlocks,
  type WikiCategoryAdmin, type WikiArticleAdmin, type WikiEditBlock, type WikiBlockType,
} from '../../services/adminWiki';

const BLOCK_TYPES: WikiBlockType[] = ['text', 'heading', 'step', 'callout', 'image'];

interface ArticleForm {
  id: number | null;
  category_id: number | null;
  title_ko: string; title_en: string;
  slug: string;
  summary_ko: string; summary_en: string;
  visibility: 'public' | 'authenticated';
  linked_route: string;
  est_minutes: string;
  sort_order: string;
  is_published: boolean;
}

const emptyForm = (categoryId: number | null): ArticleForm => ({
  id: null, category_id: categoryId, title_ko: '', title_en: '', slug: '',
  summary_ko: '', summary_en: '', visibility: 'authenticated', linked_route: '',
  est_minutes: '', sort_order: '0', is_published: false,
});

const AdminWikiPage = () => {
  const { t } = useTranslation('common');
  const { t: tErr } = useTranslation('errors');
  const [cats, setCats] = useState<WikiCategoryAdmin[]>([]);
  const [articles, setArticles] = useState<WikiArticleAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('article') ? Number(params.get('article')) : null;
  const isNew = params.get('article') === 'new';

  const [form, setForm] = useState<ArticleForm>(emptyForm(null));
  const [blocks, setBlocks] = useState<WikiEditBlock[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [catModal, setCatModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // KNOWLEDGE_LOOP 축3 — 랜딩 블로그 발행 상태 (form 저장과 별개 즉시 API)
  const [blog, setBlog] = useState<{ published: boolean; category: string }>({ published: false, category: 'insights' });
  const [blogBusy, setBlogBusy] = useState(false);

  const loadCats = useCallback(() => { listWikiCategories().then(setCats).catch(() => {}); }, []);
  const loadArticles = useCallback(() => {
    setLoading(true);
    listWikiArticles({ category: catFilter !== 'all' ? Number(catFilter) : undefined, q: search || undefined })
      .then(setArticles).catch(() => {}).finally(() => setLoading(false));
  }, [catFilter, search]);

  useEffect(() => { loadCats(); }, [loadCats]);
  useEffect(() => { loadArticles(); }, [loadArticles]);

  // 선택 변경 → 편집기 로드
  useEffect(() => {
    setMsg(null); setErr(null);
    setBlog({ published: false, category: 'insights' });
    if (isNew) {
      setForm(emptyForm(catFilter !== 'all' ? Number(catFilter) : (cats[0]?.id ?? null)));
      setBlocks([]);
      return;
    }
    if (!selectedId) { setForm(emptyForm(null)); setBlocks([]); return; }
    getWikiArticle(selectedId).then((a) => {
      const ax = a as WikiArticleAdmin & { blog_published_at?: string | null; blog_category?: string | null };
      setBlog({ published: !!ax.blog_published_at, category: ax.blog_category || 'insights' });
      setForm({
        id: a.id, category_id: a.category_id,
        title_ko: a.title_ko || '', title_en: a.title_en || '', slug: a.slug || '',
        summary_ko: a.summary_ko || '', summary_en: a.summary_en || '',
        visibility: a.visibility, linked_route: a.linked_route || '',
        est_minutes: a.est_minutes != null ? String(a.est_minutes) : '',
        sort_order: String(a.sort_order ?? 0), is_published: !!a.is_published,
      });
      setBlocks(blocksFromBodies(a.body_ko, a.body_en));
    }).catch((e) => setErr(mapApiError(e, tErr)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, isNew]);

  // KNOWLEDGE_LOOP 축3 — 블로그 발행/해제 (public+발행 글만 백엔드에서 허용)
  const setBlogState = async (published: boolean, category: string) => {
    if (!form.id || blogBusy) return;
    setBlogBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/api/admin/wiki/articles/${form.id}/blog`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published, category }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) {
        setErr(j.message === 'blog_requires_public_published'
          ? (t('adminWiki.blogRequiresPublic', '블로그 발행은 "공개(public) + 발행됨" 글만 가능합니다. 위 설정을 먼저 저장하세요.') as string)
          : (j.message || 'failed'));
        return;
      }
      setBlog({ published: !!j.data.blog_published_at, category: j.data.blog_category || category });
    } finally { setBlogBusy(false); }
  };

  const openArticle = (id: number | 'new') => {
    setParams(prev => {
      const n = new URLSearchParams(prev);
      if (n.get('article') === String(id)) n.delete('article');
      else n.set('article', String(id));
      return n;
    });
  };
  const closeEditor = () => setParams(prev => { const n = new URLSearchParams(prev); n.delete('article'); return n; });

  const catOptions: PlanQSelectOption[] = [
    { value: 'all', label: t('adminWiki.allCategories') as string },
    ...cats.map(c => ({ value: String(c.id), label: c.title_ko })),
  ];
  const catSelectOptions: PlanQSelectOption[] = cats.map(c => ({ value: String(c.id), label: `${c.title_ko} / ${c.title_en}` }));
  const visOptions: PlanQSelectOption[] = [
    { value: 'authenticated', label: t('adminWiki.visAuthenticated') as string },
    { value: 'public', label: t('adminWiki.visPublic') as string },
  ];

  const editorOpen = isNew || !!selectedId;

  // ─── 블록 편집 ───
  const addBlock = (type: WikiBlockType) => setBlocks(prev => [...prev, { type, text_ko: '', text_en: '', caption_ko: '', caption_en: '', file_id: null }]);
  const updateBlock = (i: number, patch: Partial<WikiEditBlock>) => setBlocks(prev => prev.map((b, idx) => idx === i ? { ...b, ...patch } : b));
  const removeBlock = (i: number) => setBlocks(prev => prev.filter((_, idx) => idx !== i));
  const moveBlock = (i: number, dir: -1 | 1) => setBlocks(prev => {
    const j = i + dir;
    if (j < 0 || j >= prev.length) return prev;
    const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  const save = useCallback(async () => {
    if (saving) return;
    if (!form.title_ko.trim() || !form.title_en.trim()) { setErr(t('adminWiki.titleRequired') as string); return; }
    if (!form.category_id) { setErr(t('adminWiki.categoryRequired') as string); return; }
    setSaving(true); setErr(null); setMsg(null);
    const { body_ko, body_en } = bodiesFromBlocks(blocks);
    const payload: Partial<WikiArticleAdmin> = {
      category_id: form.category_id,
      title_ko: form.title_ko.trim(), title_en: form.title_en.trim(),
      slug: form.slug.trim() || undefined,
      summary_ko: form.summary_ko.trim() || null, summary_en: form.summary_en.trim() || null,
      body_ko, body_en,
      visibility: form.visibility,
      linked_route: form.linked_route.trim() || null,
      est_minutes: form.est_minutes ? Number(form.est_minutes) : null,
      sort_order: Number(form.sort_order) || 0,
      is_published: form.is_published,
    };
    try {
      if (form.id) {
        const a = await updateWikiArticle(form.id, payload);
        setMsg(t('adminWiki.saved') as string);
        setForm(f => ({ ...f, slug: a.slug }));
      } else {
        const a = await createWikiArticle(payload);
        setMsg(t('adminWiki.created') as string);
        loadArticles(); loadCats();
        setParams(prev => { const n = new URLSearchParams(prev); n.set('article', String(a.id)); return n; });
      }
      loadArticles();
      window.setTimeout(() => setMsg(null), 4000);
    } catch (e) { setErr(mapApiError(e, tErr)); }
    finally { setSaving(false); }
  }, [form, blocks, saving, t, tErr, loadArticles, loadCats, setParams]);

  const doDelete = useCallback(async () => {
    if (!form.id) return;
    setConfirmDelete(false);
    try {
      await deleteWikiArticle(form.id);
      closeEditor(); loadArticles(); loadCats();
    } catch (e) { setErr(mapApiError(e, tErr)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id, tErr, loadArticles, loadCats]);

  const onCapture = useCallback(async () => {
    if (!form.id) return;
    setErr(null);
    try { await captureWikiArticle(form.id); setMsg(t('adminWiki.capturing') as string); window.setTimeout(() => setMsg(null), 5000); }
    catch (e) { setErr(mapApiError(e, tErr)); }
  }, [form.id, t, tErr]);

  const onReembed = useCallback(async () => {
    setErr(null);
    try { await reembedWiki(); setMsg(t('adminWiki.reembedStarted') as string); window.setTimeout(() => setMsg(null), 5000); }
    catch (e) { setErr(mapApiError(e, tErr)); }
  }, [t, tErr]);

  const catTitle = (id: number) => cats.find(c => c.id === id)?.title_ko || '—';

  return (
    <PageShell
      title={t('adminWiki.title') as string}
      count={articles.length}
      bodyPadding="0"
      actions={
        <Filters>
          <SearchBox placeholder={t('adminWiki.searchPh') as string} value={search} onChange={setSearch} width={180} size="sm" />
          <SelWrap>
            <PlanQSelect size="sm" isClearable={false} isSearchable={false}
              value={catOptions.find(o => o.value === catFilter)} options={catOptions}
              onChange={(o) => setCatFilter(String((o as PlanQSelectOption)?.value ?? 'all'))} />
          </SelWrap>
          <ActionButton tone="secondary" size="sm" onClick={() => setCatModal(true)}>{t('adminWiki.manageCategories') as string}</ActionButton>
          <ActionButton tone="secondary" size="sm" onClick={onReembed}>{t('adminWiki.reembedAll') as string}</ActionButton>
          <ActionButton tone="primary" size="sm" onClick={() => openArticle('new')}>{t('adminWiki.newArticle') as string}</ActionButton>
        </Filters>
      }
    >
      <Split>
        <ListPane $detailOpen={editorOpen}>
          {loading ? (
            <Empty>{t('adminWiki.loading') as string}</Empty>
          ) : articles.length === 0 ? (
            <Empty>{t('adminWiki.empty') as string}</Empty>
          ) : (
            articles.map(a => (
              <ListRow key={a.id} $active={selectedId === a.id} type="button" onClick={() => openArticle(a.id)}>
                <RowTop>
                  <CatChip>{a.category?.title_ko || catTitle(a.category_id)}</CatChip>
                  {a.is_published
                    ? <Badge $bg="#DCFCE7" $fg="#166534">{t('adminWiki.published') as string}</Badge>
                    : <Badge $bg="#F1F5F9" $fg="#64748B">{t('adminWiki.draft') as string}</Badge>}
                  {a.visibility === 'public' && <Badge $bg="#DBEAFE" $fg="#1E40AF">{t('adminWiki.visPublicShort') as string}</Badge>}
                </RowTop>
                <RowTitle>{a.title_ko}</RowTitle>
                <RowSlug>/{a.slug}</RowSlug>
              </ListRow>
            ))
          )}
        </ListPane>

        <EditorPane $detailOpen={editorOpen}>
          {!editorOpen ? (
            <EditorEmpty>{t('adminWiki.selectPrompt') as string}</EditorEmpty>
          ) : (
            <>
              <EditorHeader>
                <BackBtn type="button" onClick={closeEditor} aria-label={t('adminWiki.backToList') as string}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </BackBtn>
                <EditorTitle>{form.id ? form.title_ko || t('adminWiki.editArticle') : t('adminWiki.newArticle')}</EditorTitle>
                {form.id && form.slug && (
                  <PreviewLink href={`/wiki/a/${form.slug}`} target="_blank" rel="noopener noreferrer">{t('adminWiki.preview') as string} ↗</PreviewLink>
                )}
              </EditorHeader>
              <EditorBody>
                <Grid2>
                  <Field>
                    <Label>{t('adminWiki.category') as string} *</Label>
                    <PlanQSelect size="sm" isClearable={false} isSearchable={false}
                      value={catSelectOptions.find(o => o.value === String(form.category_id))} options={catSelectOptions}
                      onChange={(o) => setForm(f => ({ ...f, category_id: Number((o as PlanQSelectOption)?.value) || null }))} />
                  </Field>
                  <Field>
                    <Label>{t('adminWiki.visibility') as string}</Label>
                    <PlanQSelect size="sm" isClearable={false} isSearchable={false}
                      value={visOptions.find(o => o.value === form.visibility)} options={visOptions}
                      onChange={(o) => setForm(f => ({ ...f, visibility: (o as PlanQSelectOption)?.value === 'public' ? 'public' : 'authenticated' }))} />
                  </Field>
                </Grid2>
                <Grid2>
                  <Field><Label>{t('adminWiki.titleKo') as string} *</Label><Input value={form.title_ko} onChange={e => setForm(f => ({ ...f, title_ko: e.target.value }))} /></Field>
                  <Field><Label>{t('adminWiki.titleEn') as string} *</Label><Input value={form.title_en} onChange={e => setForm(f => ({ ...f, title_en: e.target.value }))} /></Field>
                </Grid2>
                <Field><Label>{t('adminWiki.slug') as string}</Label><Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder={t('adminWiki.slugPh') as string} /></Field>
                <Grid2>
                  <Field><Label>{t('adminWiki.summaryKo') as string}</Label><Input value={form.summary_ko} onChange={e => setForm(f => ({ ...f, summary_ko: e.target.value }))} /></Field>
                  <Field><Label>{t('adminWiki.summaryEn') as string}</Label><Input value={form.summary_en} onChange={e => setForm(f => ({ ...f, summary_en: e.target.value }))} /></Field>
                </Grid2>
                <Grid3>
                  <Field><Label>{t('adminWiki.linkedRoute') as string}</Label><Input value={form.linked_route} onChange={e => setForm(f => ({ ...f, linked_route: e.target.value }))} placeholder="/tasks" /></Field>
                  <Field><Label>{t('adminWiki.estMinutes') as string}</Label><Input type="number" value={form.est_minutes} onChange={e => setForm(f => ({ ...f, est_minutes: e.target.value }))} /></Field>
                  <Field><Label>{t('adminWiki.sortOrder') as string}</Label><Input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} /></Field>
                </Grid3>
                <ToggleRow>
                  <Toggle type="button" role="switch" aria-checked={form.is_published} $on={form.is_published}
                    onClick={() => setForm(f => ({ ...f, is_published: !f.is_published }))}>
                    <Knob $on={form.is_published} />
                  </Toggle>
                  <div>
                    <ToggleLabel>{t('adminWiki.publishToggle') as string}</ToggleLabel>
                    <ToggleHint>{t('adminWiki.publishHint') as string}</ToggleHint>
                  </div>
                </ToggleRow>

                {/* KNOWLEDGE_LOOP 축3 — 랜딩 블로그 발행 (저장된 글만, 즉시 반영) */}
                {form.id && (
                  <ToggleRow>
                    <Toggle type="button" role="switch" aria-checked={blog.published} $on={blog.published}
                      onClick={() => setBlogState(!blog.published, blog.category)}>
                      <Knob $on={blog.published} />
                    </Toggle>
                    <div>
                      <ToggleLabel>{t('adminWiki.blogToggle', '랜딩 인사이트(/insights)에 발행') as string}</ToggleLabel>
                      <ToggleHint>{t('adminWiki.blogHint', '공개(public) + 발행됨 글만 가능 · 발행 시 planq.kr/insights 에 즉시 노출') as string}</ToggleHint>
                    </div>
                    <SelWrapSm>
                      <PlanQSelect size="sm" isClearable={false} isSearchable={false}
                        value={{ value: blog.category, label: t(`adminWiki.blogCat.${blog.category}`, blog.category) as string }}
                        options={['guide-video', 'brand-video', 'how-to', 'insights', 'cases'].map((c) => ({ value: c, label: t(`adminWiki.blogCat.${c}`, c) as string }))}
                        onChange={(o) => {
                          const cat = ((o as PlanQSelectOption)?.value as string) || 'insights';
                          if (blog.published) setBlogState(true, cat);
                          else setBlog((b) => ({ ...b, category: cat }));
                        }} />
                    </SelWrapSm>
                  </ToggleRow>
                )}

                {/* 본문 블록 에디터 */}
                <BlockSection>
                  <Label>{t('adminWiki.body') as string}</Label>
                  {blocks.length === 0 && <BlockEmpty>{t('adminWiki.bodyEmpty') as string}</BlockEmpty>}
                  {blocks.map((b, i) => (
                    <BlockCard key={i}>
                      <BlockBar>
                        <SelWrapSm>
                          <PlanQSelect size="sm" isClearable={false} isSearchable={false}
                            value={{ value: b.type, label: t(`adminWiki.block.${b.type}`) as string }}
                            options={BLOCK_TYPES.map(bt => ({ value: bt, label: t(`adminWiki.block.${bt}`) as string }))}
                            onChange={(o) => updateBlock(i, { type: ((o as PlanQSelectOption)?.value as WikiBlockType) || 'text' })} />
                        </SelWrapSm>
                        <BlockBtns>
                          <MiniBtn type="button" onClick={() => moveBlock(i, -1)} disabled={i === 0} aria-label={t('adminWiki.moveUp') as string}>↑</MiniBtn>
                          <MiniBtn type="button" onClick={() => moveBlock(i, 1)} disabled={i === blocks.length - 1} aria-label={t('adminWiki.moveDown') as string}>↓</MiniBtn>
                          <MiniBtn type="button" $danger onClick={() => removeBlock(i)} aria-label={t('adminWiki.removeBlock') as string}>×</MiniBtn>
                        </BlockBtns>
                      </BlockBar>
                      {b.type === 'image' ? (
                        <>
                          {b.file_id
                            ? <BlockImg src={`/api/wiki/image/${b.file_id}`} alt="" />
                            : <ImgHint>{t('adminWiki.imageFromCapture') as string}</ImgHint>}
                          <BlockTextarea rows={1} value={b.caption_ko} onChange={e => updateBlock(i, { caption_ko: e.target.value })} placeholder={t('adminWiki.captionKo') as string} />
                          <BlockTextarea rows={1} value={b.caption_en} onChange={e => updateBlock(i, { caption_en: e.target.value })} placeholder={t('adminWiki.captionEn') as string} />
                        </>
                      ) : (
                        <>
                          <BlockTextarea rows={2} value={b.text_ko} onChange={e => updateBlock(i, { text_ko: e.target.value })} placeholder={t('adminWiki.textKo') as string} />
                          <BlockTextarea rows={2} value={b.text_en} onChange={e => updateBlock(i, { text_en: e.target.value })} placeholder={t('adminWiki.textEn') as string} />
                        </>
                      )}
                    </BlockCard>
                  ))}
                  <AddBlockRow>
                    {BLOCK_TYPES.map(bt => (
                      <AddBlockBtn key={bt} type="button" onClick={() => addBlock(bt)}>+ {t(`adminWiki.block.${bt}`) as string}</AddBlockBtn>
                    ))}
                  </AddBlockRow>
                </BlockSection>

                {err && <ErrMsg>{err}</ErrMsg>}
                {msg && <OkMsg>{msg}</OkMsg>}
              </EditorBody>
              <EditorFooter>
                <FooterLeft>
                  {form.id && <ActionButton tone="danger" size="sm" onClick={() => setConfirmDelete(true)}>{t('adminWiki.delete') as string}</ActionButton>}
                  {form.id && form.linked_route && <ActionButton tone="secondary" size="sm" onClick={onCapture}>{t('adminWiki.capture') as string}</ActionButton>}
                </FooterLeft>
                <ActionButton tone="primary" size="md" loading={saving} onClick={save}>{t('adminWiki.save') as string}</ActionButton>
              </EditorFooter>
            </>
          )}
        </EditorPane>
      </Split>

      {catModal && (
        <CategoryModal cats={cats} onClose={() => setCatModal(false)} onChanged={() => { loadCats(); loadArticles(); }} />
      )}
      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
        title={t('adminWiki.delete') as string}
        message={t('adminWiki.confirmDelete') as string}
        confirmText={t('adminWiki.delete') as string}
        cancelText={t('cancel', '취소') as string}
        variant="danger"
      />
    </PageShell>
  );
};

export default AdminWikiPage;

// ─── 카테고리 관리 모달 ───
const CategoryModal = ({ cats, onClose, onChanged }: { cats: WikiCategoryAdmin[]; onClose: () => void; onChanged: () => void }) => {
  const { t } = useTranslation('common');
  const { t: tErr } = useTranslation('errors');
  const [titleKo, setTitleKo] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [catToDelete, setCatToDelete] = useState<WikiCategoryAdmin | null>(null);

  const add = async () => {
    if (!titleKo.trim() || !titleEn.trim() || busy) return;
    setBusy(true); setErr(null);
    try { await createWikiCategory({ title_ko: titleKo.trim(), title_en: titleEn.trim() }); setTitleKo(''); setTitleEn(''); onChanged(); }
    catch (e) { setErr(mapApiError(e, tErr)); }
    finally { setBusy(false); }
  };
  const rename = async (c: WikiCategoryAdmin, ko: string, en: string) => {
    try { await updateWikiCategory(c.id, { title_ko: ko, title_en: en }); onChanged(); }
    catch (e) { setErr(mapApiError(e, tErr)); }
  };
  const askRemove = (c: WikiCategoryAdmin) => {
    if (c.article_count > 0) { setErr(t('adminWiki.catNotEmpty') as string); return; }
    setErr(null); setCatToDelete(c);
  };
  const doRemove = async () => {
    if (!catToDelete) return;
    const c = catToDelete; setCatToDelete(null);
    try { await deleteWikiCategory(c.id); onChanged(); }
    catch (e) { setErr(mapApiError(e, tErr)); }
  };

  return (
    <StandardModal open onClose={onClose} title={t('adminWiki.manageCategories') as string} size="md">
      <CatList>
        {cats.map(c => (
          <CatRow key={c.id}>
            <CatInput defaultValue={c.title_ko} onBlur={e => e.target.value !== c.title_ko && rename(c, e.target.value, c.title_en)} />
            <CatInput defaultValue={c.title_en} onBlur={e => e.target.value !== c.title_en && rename(c, c.title_ko, e.target.value)} />
            <CatCount>{c.article_count}</CatCount>
            <MiniBtn type="button" $danger onClick={() => askRemove(c)} aria-label={t('adminWiki.delete') as string}>×</MiniBtn>
          </CatRow>
        ))}
      </CatList>
      <CatAddRow>
        <CatInput value={titleKo} onChange={e => setTitleKo(e.target.value)} placeholder={t('adminWiki.titleKo') as string} />
        <CatInput value={titleEn} onChange={e => setTitleEn(e.target.value)} placeholder={t('adminWiki.titleEn') as string} />
        <ActionButton tone="primary" size="sm" loading={busy} disabled={!titleKo.trim() || !titleEn.trim()} onClick={add}>{t('adminWiki.addCategory') as string}</ActionButton>
      </CatAddRow>
      {err && <ErrMsg>{err}</ErrMsg>}
      <ConfirmDialog
        isOpen={!!catToDelete}
        onClose={() => setCatToDelete(null)}
        onConfirm={doRemove}
        title={t('adminWiki.manageCategories') as string}
        message={t('adminWiki.confirmDeleteCat') as string}
        confirmText={t('adminWiki.delete') as string}
        cancelText={t('cancel', '취소') as string}
        variant="danger"
      />
    </StandardModal>
  );
};

// ─── styled ───
const Filters = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const SelWrap = styled.div`min-width: 150px;`;
const SelWrapSm = styled.div`min-width: 120px;`;
const Split = styled.div`display: flex; height: 100%; min-height: 0;`;
const ListPane = styled.div<{ $detailOpen: boolean }>`
  width: 340px; flex-shrink: 0; border-right: 1px solid #e2e8f0; background: #fff;
  overflow-y: auto; display: flex; flex-direction: column;
  @media (max-width: 1024px) { width: 100%; border-right: none; display: ${p => p.$detailOpen ? 'none' : 'flex'}; }
`;
const EditorPane = styled.div<{ $detailOpen: boolean }>`
  flex: 1; min-width: 0; background: #f8fafc; display: flex; flex-direction: column; min-height: 0;
  @media (max-width: 1024px) { display: ${p => p.$detailOpen ? 'flex' : 'none'}; }
`;
const Empty = styled.div`padding: 40px 20px; text-align: center; font-size: 13px; color: #94a3b8;`;
const EditorEmpty = styled.div`flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px; text-align: center; font-size: 13px; color: #94a3b8;`;
const ListRow = styled.button<{ $active: boolean }>`
  all: unset; cursor: pointer; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px;
  padding: 14px 16px; border-bottom: 1px solid #f1f5f9;
  background: ${p => p.$active ? '#f0fdfa' : 'transparent'};
  border-left: 3px solid ${p => p.$active ? '#14b8a6' : 'transparent'};
  transition: background 0.15s;
  &:hover { background: ${p => p.$active ? '#f0fdfa' : '#f8fafc'}; }
`;
const RowTop = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const CatChip = styled.span`font-size: 11px; font-weight: 700; color: #0f766e; background: #f0fdfa; border-radius: 999px; padding: 2px 8px;`;
const Badge = styled.span<{ $bg: string; $fg: string }>`font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 8px; background: ${p => p.$bg}; color: ${p => p.$fg};`;
const RowTitle = styled.div`font-size: 13px; font-weight: 600; color: #0f172a; line-height: 1.4;`;
const RowSlug = styled.div`font-size: 11px; color: #94a3b8; font-family: ui-monospace, monospace;`;
const EditorHeader = styled.div`flex-shrink: 0; display: flex; align-items: center; gap: 10px; padding: 16px 20px; background: #fff; border-bottom: 1px solid #e2e8f0;`;
const BackBtn = styled.button`
  display: none; width: 32px; height: 32px; flex-shrink: 0; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 8px; color: #64748b; cursor: pointer;
  &:hover { background: #f1f5f9; color: #0f172a; }
  @media (max-width: 1024px) { display: inline-flex; }
`;
const EditorTitle = styled.h2`flex: 1; min-width: 0; font-size: 16px; font-weight: 700; color: #0f172a; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const PreviewLink = styled.a`font-size: 12px; font-weight: 600; color: #0d9488; text-decoration: none; flex-shrink: 0; &:hover { text-decoration: underline; }`;
const EditorBody = styled.div`flex: 1; min-height: 0; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px;`;
const Grid2 = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 12px; @media (max-width: 640px) { grid-template-columns: 1fr; }`;
const Grid3 = styled.div`display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; @media (max-width: 640px) { grid-template-columns: 1fr; }`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px; min-width: 0;`;
const Label = styled.label`font-size: 12px; font-weight: 700; color: #475569;`;
const Input = styled.input`
  padding: 9px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; color: #0f172a; font-family: inherit;
  &:focus { outline: none; border-color: #14b8a6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const ToggleRow = styled.div`display: flex; align-items: center; gap: 12px;`;
const Toggle = styled.button<{ $on: boolean }>`
  width: 40px; height: 24px; flex-shrink: 0; border: none; cursor: pointer; padding: 0;
  border-radius: 999px; background: ${p => p.$on ? '#14b8a6' : '#cbd5e1'}; transition: background 0.15s; position: relative;
`;
const Knob = styled.span<{ $on: boolean }>`
  position: absolute; top: 3px; left: ${p => p.$on ? '19px' : '3px'}; width: 18px; height: 18px;
  background: #fff; border-radius: 50%; transition: left 0.15s;
`;
const ToggleLabel = styled.div`font-size: 13px; font-weight: 600; color: #0f172a;`;
const ToggleHint = styled.div`font-size: 12px; color: #64748b;`;
const BlockSection = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const BlockEmpty = styled.div`font-size: 12px; color: #94a3b8; padding: 8px 0;`;
const BlockCard = styled.div`border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; padding: 12px; display: flex; flex-direction: column; gap: 8px;`;
const BlockBar = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px;`;
const BlockBtns = styled.div`display: flex; gap: 4px;`;
const MiniBtn = styled.button<{ $danger?: boolean }>`
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; cursor: pointer; font-size: 14px;
  color: ${p => p.$danger ? '#b91c1c' : '#475569'};
  &:hover:not(:disabled) { background: ${p => p.$danger ? '#fee2e2' : '#f1f5f9'}; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;
const BlockTextarea = styled.textarea`
  padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; color: #0f172a; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14b8a6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
const BlockImg = styled.img`max-width: 100%; border-radius: 8px; border: 1px solid #e2e8f0;`;
const ImgHint = styled.div`font-size: 12px; color: #94a3b8; padding: 8px; background: #f8fafc; border-radius: 6px;`;
const AddBlockRow = styled.div`display: flex; flex-wrap: wrap; gap: 6px;`;
const AddBlockBtn = styled.button`
  all: unset; cursor: pointer; padding: 6px 12px; border-radius: 999px; background: #f0fdfa; border: 1px solid #ccfbf1;
  font-size: 12px; font-weight: 600; color: #0f766e; &:hover { background: #ccfbf1; }
`;
const EditorFooter = styled.div`flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; background: #fff; border-top: 1px solid #e2e8f0;`;
const FooterLeft = styled.div`display: flex; gap: 8px;`;
const ErrMsg = styled.div`padding: 10px 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-size: 13px; color: #b91c1c;`;
const OkMsg = styled.div`padding: 10px 12px; background: #f0fdfa; border: 1px solid #5eead4; border-radius: 8px; font-size: 13px; color: #0f766e;`;
const CatList = styled.div`display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;`;
const CatRow = styled.div`display: flex; align-items: center; gap: 8px;`;
const CatInput = styled.input`
  flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; color: #0f172a; font-family: inherit;
  &:focus { outline: none; border-color: #14b8a6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
const CatCount = styled.span`font-size: 11px; font-weight: 700; color: #64748b; background: #f1f5f9; border-radius: 999px; padding: 2px 8px; flex-shrink: 0;`;
const CatAddRow = styled.div`display: flex; align-items: center; gap: 8px; padding-top: 12px; border-top: 1px solid #e2e8f0;`;
