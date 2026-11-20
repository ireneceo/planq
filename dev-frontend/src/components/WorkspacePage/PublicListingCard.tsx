// PublicListingCard — 설정 › 공개 페이지 «공개» 카드 (P3 · 2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §7 ②)
//
//   ( ○ 링크를 받은 사람만  ● PlanQ «회사 찾기» 와 검색에 공개 ) · 업종·지역·검색 키워드·회사 주소 · 상태 · 최소 기준.
//   Irene 결정 ④ 첫 공개는 PlanQ 승인(공개 신청 → 승인 대기) · ⑤ 유료 + 체험 중만.
// ★ 데이터·판정은 서버(routes/public_page_owner.js) — 화면은 서버가 준 criteria·eligible·status 만 그린다(스스로 세지 않는다).
// ★ 공개로 바꿀 때 확인 창은 **누구나 볼 수 있는 항목 목록과 주소**를 적는다(무엇이 나가는지 모르면 확인이 아니다).
//   끌 때는 «검색 결과에서 사라지는 데 며칠~몇 주» 를 적는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { isEnterAction } from '../../utils/imeKey';
import AutoSaveField, { type AutoSaveHandle } from '../Common/AutoSaveField';
import ConfirmDialog from '../Common/ConfirmDialog';

type State = {
  status: 'off' | 'pending' | 'public' | 'blocked';
  category: string | null; region: string | null; slug: string; slug_problem: string | null;
  tags: string[]; block_reason: string | null; criteria: { key: string; ok: boolean }[]; criteria_ok: boolean;
  eligible: boolean; switch_on: boolean; public_url: string; categories: string[]; regions: string[];
};

export default function PublicListingCard({ businessId, isOwner, shownItems, onChanged }: {
  businessId: number; isOwner: boolean; shownItems: string[]; onChanged?: () => void;
}) {
  const { t } = useTranslation('settings');
  const { t: tw } = useTranslation('wspage');
  const [st, setSt] = useState<State | null>(null);
  const [cat, setCat] = useState('');
  const [region, setRegion] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | 'on' | 'off' | 'slug'>(null);
  const ref = useRef({ cat, region, tags });
  const tagsSave = useRef<AutoSaveHandle>(null);
  ref.current = { cat, region, tags };

  const apply = (d: State) => {
    setSt(d); setCat(d.category || ''); setRegion(d.region || ''); setTags(d.tags || []); setSlug(d.slug);
  };
  const load = useCallback(async () => {
    const r = await apiFetch(`/api/businesses/${businessId}/public-page`);
    const j = await r.json().catch(() => null);
    if (j?.success) apply(j.data);
  }, [businessId]);
  useEffect(() => { void load(); }, [load]);

  const put = async (body: Record<string, unknown>) => {
    const r = await apiFetch(`/api/businesses/${businessId}/public-page`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) throw new Error(j?.message || `save_failed_${r.status}`);
    setSt((prev) => (prev ? { ...prev, ...j.data } : j.data));
    onChanged?.();
  };
  const saveCat = useCallback(async () => { await put({ category: ref.current.cat || null }); }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveRegion = useCallback(async () => { await put({ region: ref.current.region || null }); }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveTags = useCallback(async () => { await put({ tags: ref.current.tags }); }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (kind: 'request' | 'off') => {
    setBusy(true); setErr(null);
    try {
      // 주소를 글자 그대로 적는다(호출처 가드가 라우트와 짝을 찾는다)
      const url = kind === 'request' ? `/api/businesses/${businessId}/public-page/request` : `/api/businesses/${businessId}/public-page/off`;
      const r = await apiFetch(url, { method: 'POST' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || `error_${r.status}`); return; }
      apply(j.data); onChanged?.();
    } catch { setErr('network'); } finally { setBusy(false); setAsk(null); }
  };
  const saveSlug = async () => {
    setBusy(true); setErr(null);
    try { await put({ slug }); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); setAsk(null); }
  };

  if (!st) return null;
  const on = st.status === 'pending' || st.status === 'public';
  const canRequest = isOwner && st.status === 'off' && st.criteria_ok && st.eligible && st.switch_on && !st.slug_problem;
  const addTag = () => {
    const v = tagInput.trim().slice(0, 20);
    if (!v || tags.includes(v) || tags.length >= 5) { setTagInput(''); return; }
    setTags([...tags, v]); setTagInput('');
    tagsSave.current?.triggerSave();
  };

  return (
    <Card data-testid="wspage-listing">
      <Head>
        <Title>{t('wspage.listTitle', '공개')}</Title>
        <Desc>{t('wspage.listDesc', '켜면 PlanQ «회사 찾기» 와 검색·AI 검색에 이 페이지가 나옵니다. 처음 공개는 PlanQ 가 확인한 뒤 열립니다(보통 1영업일).')}</Desc>
      </Head>

      <Radios role="radiogroup">
        <Radio $on={!on}>
          <input type="radio" name="wslist" checked={!on} disabled={!isOwner || st.status === 'blocked' || busy}
            onChange={() => { if (on) setAsk('off'); }} data-testid="wspage-listing-off" />
          {t('wspage.listOff', '링크를 받은 사람만')}
        </Radio>
        <Radio $on={on}>
          <input type="radio" name="wslist" checked={on} disabled={!canRequest || busy}
            onChange={() => { if (!on) setAsk('on'); }} data-testid="wspage-listing-on" />
          {t('wspage.listOn', 'PlanQ «회사 찾기» 와 검색에 공개')}
        </Radio>
      </Radios>

      <StatusLine $s={st.status} data-testid="wspage-listing-status">
        {st.status === 'pending' && t('wspage.statusPending', '승인 대기 중 — PlanQ 가 확인하면 공개됩니다 (보통 1영업일)')}
        {st.status === 'public' && t('wspage.statusPublic', '공개 중')}
        {st.status === 'blocked' && t('wspage.statusBlocked', { reason: st.block_reason || '-', defaultValue: 'PlanQ 가 내렸어요 — 사유: {{reason}}. 다시 공개하려면 PlanQ 에 문의해 주세요.' })}
        {st.status === 'off' && (st.block_reason
          ? t('wspage.statusReturned', { reason: st.block_reason, defaultValue: '공개 신청이 돌려보내졌어요 — {{reason}}' })
          : t('wspage.statusOff', '지금은 링크를 받은 사람만 볼 수 있어요.'))}
      </StatusLine>
      {st.status === 'public' && <UrlLink href={st.public_url} target="_blank" rel="noopener noreferrer" data-testid="wspage-listing-url">{st.public_url}</UrlLink>}
      {!st.eligible && <Warn>{t('wspage.notEligible', '«회사 찾기» 공개는 유료 플랜과 체험 중인 워크스페이스만 할 수 있어요. 링크·문의 폼은 그대로 쓸 수 있어요.')}</Warn>}
      {!st.switch_on && <Warn>{t('wspage.switchOff', 'PlanQ 가 지금 공개 페이지를 잠시 닫아 두었어요.')}</Warn>}

      <Grid>
        <Field>
          <Lbl htmlFor="wslist-cat">{t('wspage.category', '업종')} *</Lbl>
          <AutoSaveField type="select" key={`wslist-cat-${businessId}`} onSave={saveCat}>
            <Sel id="wslist-cat" data-testid="wspage-listing-category" value={cat} disabled={!isOwner} onChange={(e) => setCat(e.target.value)}>
              <option value="">{t('wspage.choose', '고르기')}</option>
              {st.categories.map((c) => <option key={c} value={c}>{tw(`category.${c}`)}</option>)}
            </Sel>
          </AutoSaveField>
        </Field>
        <Field>
          <Lbl htmlFor="wslist-region">{t('wspage.region', '지역')}</Lbl>
          <AutoSaveField type="select" key={`wslist-region-${businessId}`} onSave={saveRegion}>
            <Sel id="wslist-region" value={region} disabled={!isOwner} onChange={(e) => setRegion(e.target.value)}>
              <option value="">{t('wspage.choose', '고르기')}</option>
              {st.regions.map((r) => <option key={r} value={r}>{tw(`region.${r}`)}</option>)}
            </Sel>
          </AutoSaveField>
        </Field>
      </Grid>

      <Field>
        <Lbl>{t('wspage.tags', '검색 키워드 (최대 5개)')}</Lbl>
        <AutoSaveField type="list" ref={tagsSave} key={`wslist-tags-${businessId}`} onSave={saveTags}>
          <TagRow>
            {tags.map((g) => (
              <TagChip key={g}>{g}{isOwner && <X type="button" aria-label={t('wspage.delete', '삭제') as string} onClick={() => { setTags(tags.filter((x) => x !== g)); tagsSave.current?.triggerSave(); }}>×</X>}</TagChip>
            ))}
            {isOwner && tags.length < 5 && (
              <TagIn value={tagInput} maxLength={20} data-testid="wspage-listing-tag-input"
                placeholder={t('wspage.tagPh', '예: 브랜딩 (Enter)') as string}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (isEnterAction(e)) { e.preventDefault(); addTag(); } }}
                onBlur={addTag} />
            )}
          </TagRow>
        </AutoSaveField>
      </Field>

      <Field>
        <Lbl htmlFor="wslist-slug">{t('wspage.slug', '공개 주소')}</Lbl>
        <SlugRow>
          <Prefix>planq.kr/w/</Prefix>
          {/* autosave-exempt: 주소 바꾸기는 [저장] 을 눌러야 한다 — 공개 중이면 옛 주소가 바로 끊겨 확인이 먼저다 */}
          <SlugIn id="wslist-slug" value={slug} maxLength={40} disabled={!isOwner || busy} data-testid="wspage-listing-slug"
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
          {isOwner && slug !== st.slug && (
            <Btn type="button" $primary disabled={busy} onClick={() => (st.status === 'public' ? setAsk('slug') : void saveSlug())}
              data-testid="wspage-listing-slug-save">{t('wspage.save', '저장')}</Btn>
          )}
        </SlugRow>
        {st.slug_problem && <Warn>{t(`wspage.err.${st.slug_problem}`, st.slug_problem)}</Warn>}
      </Field>

      <Checks data-testid="wspage-listing-criteria">
        {st.criteria.map((c) => (
          <CheckItem key={c.key} $ok={c.ok}>{c.ok ? '✓' : '✗'} {t(`wspage.criteria.${c.key}`)}</CheckItem>
        ))}
      </Checks>
      {!st.criteria_ok && st.status === 'off' && <Hint>{t('wspage.criteriaHint', '✗ 항목을 채우면 공개를 신청할 수 있어요.')}</Hint>}
      {err && <Warn role="alert">{t(`wspage.err.${err}`, err)}</Warn>}

      <ConfirmDialog
        isOpen={ask === 'on'}
        title={t('wspage.confirmOnTitle', '«회사 찾기» 공개를 신청할까요?') as string}
        message={`${t('wspage.confirmOnBody', '승인되면 아래 정보를 누구나 볼 수 있고, 검색·AI 검색에 나옵니다.')}\n\n${st.public_url}\n· ${shownItems.join('\n· ')}`}
        confirmText={t('wspage.confirmOnOk', '공개 신청') as string}
        cancelText={t('common.cancel', '취소') as string}
        variant="info"
        onConfirm={() => void act('request')}
        onClose={() => setAsk(null)}
      />
      <ConfirmDialog
        isOpen={ask === 'off'}
        title={t('wspage.confirmOffTitle', '공개를 끌까요?') as string}
        message={t('wspage.confirmOffBody', { url: st.public_url, defaultValue: '{{url}} 주소가 바로 닫힙니다. 검색 결과에서 사라지는 데는 며칠~몇 주 걸립니다. 고객 링크·문의 폼은 그대로입니다.' }) as string}
        confirmText={t('wspage.confirmOffOk', '공개 끄기') as string}
        cancelText={t('common.cancel', '취소') as string}
        variant="warning"
        onConfirm={() => void act('off')}
        onClose={() => setAsk(null)}
      />
      <ConfirmDialog
        isOpen={ask === 'slug'}
        title={t('wspage.confirmSlugTitle', '공개 주소를 바꿀까요?') as string}
        message={t('wspage.confirmSlugBody', { from: st.public_url, defaultValue: '{{from}} 은(는) 바로 열리지 않게 됩니다. 이미 알린 주소·검색 결과의 옛 주소도 끊깁니다.' }) as string}
        confirmText={t('wspage.save', '저장') as string}
        cancelText={t('common.cancel', '취소') as string}
        variant="warning"
        onConfirm={() => void saveSlug()}
        onClose={() => setAsk(null)}
      />
    </Card>
  );
}

const Card = styled.div`background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;display:flex;flex-direction:column;gap:12px;min-width:0;
  @media (max-width:640px){ padding:14px; }`;
const Head = styled.div`display:flex;flex-direction:column;gap:4px;`;
const Title = styled.h3`margin:0;font-size:0.9375rem;font-weight:700;color:#0f172a;`;
const Desc = styled.p`margin:0;font-size:0.75rem;color:#64748b;line-height:1.5;`;
const Radios = styled.div`display:flex;flex-wrap:wrap;gap:8px;`;
const Radio = styled.label<{ $on: boolean }>`display:flex;align-items:center;gap:8px;min-height:40px;padding:0 12px;border-radius:10px;cursor:pointer;
  border:1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};background:${(p) => (p.$on ? '#F0FDFA' : '#fff')};font-size:0.8125rem;font-weight:600;color:#334155;
  input{accent-color:#14B8A6;}`;
const StatusLine = styled.div<{ $s: string }>`font-size:0.8125rem;font-weight:600;
  color:${(p) => (p.$s === 'public' ? '#0F766E' : p.$s === 'pending' ? '#B45309' : p.$s === 'blocked' ? '#B91C3C' : '#64748B')};`;
const UrlLink = styled.a`font-size:0.8125rem;color:#0D9488;word-break:break-all;`;
const Grid = styled.div`display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:10px;`;
const Field = styled.div`display:flex;flex-direction:column;gap:4px;min-width:0;`;
const Lbl = styled.label`font-size:0.75rem;font-weight:600;color:#475569;`;
const Sel = styled.select`height:36px;padding:0 10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;font-size:0.8125rem;width:100%;`;
const TagRow = styled.div`display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:36px;`;
const TagChip = styled.span`display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 10px;border-radius:999px;background:#F1F5F9;font-size:0.75rem;font-weight:600;color:#334155;`;
const X = styled.button`border:none;background:none;cursor:pointer;color:#94A3B8;font-size:0.875rem;padding:0;`;
const TagIn = styled.input`height:32px;padding:0 10px;border:1px dashed #CBD5E1;border-radius:8px;font-size:0.75rem;width:150px;`;
const SlugRow = styled.div`display:flex;align-items:center;gap:6px;flex-wrap:wrap;`;
const Prefix = styled.span`font-size:0.8125rem;color:#64748B;`;
const SlugIn = styled.input`height:36px;padding:0 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:0.8125rem;flex:1;min-width:140px;max-width:280px;`;
const Btn = styled.button<{ $primary?: boolean }>`height:36px;padding:0 12px;border-radius:8px;cursor:pointer;font-size:0.8125rem;font-weight:600;
  border:1px solid ${(p) => (p.$primary ? '#14B8A6' : '#cbd5e1')};background:${(p) => (p.$primary ? '#14B8A6' : '#fff')};color:${(p) => (p.$primary ? '#fff' : '#334155')};
  &:disabled{opacity:.55;}`;
const Checks = styled.div`display:flex;flex-wrap:wrap;gap:10px;`;
const CheckItem = styled.span<{ $ok: boolean }>`font-size:0.75rem;font-weight:600;color:${(p) => (p.$ok ? '#0F766E' : '#B91C3C')};`;
const Hint = styled.div`font-size:0.75rem;color:#94A3B8;`;
const Warn = styled.div`padding:8px 12px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;font-size:0.75rem;color:#9A3412;line-height:1.5;`;
