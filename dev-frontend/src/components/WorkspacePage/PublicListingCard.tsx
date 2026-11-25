// PublicListingCard — 설정 › 공개 페이지 «공개» 카드 (P3 · 2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §7 ②)
//
//   ( ○ 링크를 받은 사람만  ● PlanQ «회사 찾기» 와 검색에 공개 ) · 업종·지역·검색 키워드·회사 주소 · 상태 · 최소 기준.
//   Irene 결정 ④ 첫 공개는 PlanQ 승인(공개 신청 → 승인 대기) · ⑤ 유료 + 체험 중만.
// ★ 데이터·판정은 서버(routes/public_page_owner.js) — 화면은 서버가 준 criteria·eligible·status 만 그린다(스스로 세지 않는다).
// ★ 공개로 바꿀 때 확인 창은 **누구나 볼 수 있는 항목 목록과 주소**를 적는다(무엇이 나가는지 모르면 확인이 아니다).
//   끌 때는 «검색 결과에서 사라지는 데 며칠~몇 주» 를 적는다.
// ★ 2026-11-25 Irene «여기서 한번에 안되고 워크스페이스 설정에서 바꿔야 해? 여기서도 되게 해줘» —
//   기준 미달이어도 «공개» 를 누를 수 있다(누르면 신청 대신 «아래 N개를 채워 주세요» + 첫 ✗ 칸으로).
//   기준 목록은 토글 바로 아래 · ✗ 는 눌러서 고치는 자리로 · «한 줄 소개» 는 이 카드에서 바로(PUT /brand 한 문 — 브랜드 탭과 같은 정본).
//   기준·자격 판정은 서버 그대로(서버가 criteria_unmet 으로 다시 거절한다).
import { useCallback, useEffect, useRef, useState } from 'react';
import { tabStore } from '../../stores/tabStore';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { isEnterAction } from '../../utils/imeKey';
import AutoSaveField, { type AutoSaveHandle } from '../Common/AutoSaveField';
import ConfirmDialog from '../Common/ConfirmDialog';
import PlanQSelect from '../Common/PlanQSelect';

type State = {
  status: 'off' | 'pending' | 'public' | 'blocked';
  category: string | null; region: string | null; slug: string; slug_problem: string | null;
  tags: string[]; block_reason: string | null; criteria: { key: string; ok: boolean }[]; criteria_ok: boolean;
  eligible: boolean; switch_on: boolean; public_url: string; categories: string[]; regions: string[];
};

/** 부모(설정 › 공개 페이지)가 맡는 기준 칸 — 소개글·서비스·문의 폼은 같은 화면 다른 카드에 있다. */
export type CriteriaGoKey = 'intro' | 'services' | 'contact';

export default function PublicListingCard({ businessId, isOwner, shownItems, onChanged, onGoTo, reloadKey = 0 }: {
  businessId: number; isOwner: boolean; shownItems: string[]; onChanged?: () => void;
  /** ✗ 기준을 누르면 그 칸으로 — 부모가 스크롤·포커스 */
  onGoTo?: (key: CriteriaGoKey) => void;
  /** 부모가 소개글·서비스·문의 폼을 저장할 때마다 올린다 — 기준(✓/✗)을 다시 받는다 */
  reloadKey?: number;
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
  const [need, setNeed] = useState(false); // 기준 미달에 «공개» 를 눌렀다 — 안내 줄
  const [tagline, setTagline] = useState('');
  const [taglineOpen, setTaglineOpen] = useState(false); // 한 번 열리면 채워도 닫지 않는다(쓰는 중에 칸이 사라지지 않게)
  const taglineRef = useRef(tagline);
  taglineRef.current = tagline;
  const taglineInput = useRef<HTMLInputElement>(null);
  const ref = useRef({ cat, region, tags });
  const tagsSave = useRef<AutoSaveHandle>(null);
  ref.current = { cat, region, tags };

  const apply = (d: State) => {
    setSt(d); setCat(d.category || ''); setRegion(d.region || ''); setTags(d.tags || []); setSlug(d.slug);
    if (d.criteria?.some((c) => c.key === 'tagline' && !c.ok)) setTaglineOpen(true);
    if (d.criteria_ok && !d.slug_problem) setNeed(false);
  };
  const load = useCallback(async () => {
    const r = await apiFetch(`/api/businesses/${businessId}/public-page`);
    const j = await r.json().catch(() => null);
    if (j?.success) apply(j.data);
  }, [businessId]);
  useEffect(() => { void load(); }, [load, reloadKey]);

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
  /** 한 줄 소개 — 브랜드 탭과 같은 문(PUT /brand). 저장 뒤 기준을 다시 받는다. */
  const saveTagline = useCallback(async () => {
    const r = await apiFetch(`/api/businesses/${businessId}/brand`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand_tagline: taglineRef.current.trim() || null }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) throw new Error(j?.message || `save_failed_${r.status}`);
    await load();
    onChanged?.();
  }, [businessId, load, onChanged]);

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
  // 누를 수 있느냐(≠ 신청할 수 있느냐) — 기준 미달·주소 문제는 눌러서 무엇을 채울지 알려 준다.
  const onLocked = !isOwner || busy || st.status === 'blocked' || !st.eligible || !st.switch_on;
  const missing = st.criteria.filter((c) => !c.ok);
  const goTo = (key: string) => {
    if (key === 'tagline') { setTaglineOpen(true); setTimeout(() => taglineInput.current?.focus(), 0); return; }
    if (key === 'category') { document.getElementById('wslist-cat')?.focus(); return; }
    if (key === 'slug') { document.getElementById('wslist-slug')?.focus(); return; }
    if (key === 'owner_email') { tabStore.newTab('/profile'); return; }
    if (key === 'name') { tabStore.newTab('/business/settings/brand'); return; }
    if (key === 'intro' || key === 'services' || key === 'contact') onGoTo?.(key);
  };
  const pressOn = () => {
    if (on) return;
    if (canRequest) { setAsk('on'); return; }
    setNeed(true);
    goTo(missing[0]?.key || (st.slug_problem ? 'slug' : ''));
  };
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
          <input type="radio" name="wslist" checked={on} disabled={onLocked}
            onChange={pressOn} data-testid="wspage-listing-on" />
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

      {/* 공개 기준 — 토글 바로 아래. ✗ 는 누르면 고치는 자리로 */}
      {need && st.status === 'off' && (missing.length > 0 || st.slug_problem) && (
        <Need role="status" data-testid="wspage-listing-need">
          {missing.length > 0
            ? t('wspage.needCriteria', { n: missing.length, defaultValue: '공개하려면 아래 ✗ {{n}}개를 채워 주세요. 모두 이 화면에서 채울 수 있어요.' })
            : t('wspage.needSlug', '공개하려면 아래 공개 주소를 먼저 고쳐 주세요.')}
        </Need>
      )}
      <Checks data-testid="wspage-listing-criteria">
        {st.criteria.map((c) => (c.ok || !isOwner
          ? <CheckItem key={c.key} $ok={c.ok}>{c.ok ? '✓' : '✗'} {t(`wspage.criteria.${c.key}`)}</CheckItem>
          : (
            <CheckBtn key={c.key} type="button" onClick={() => goTo(c.key)} data-testid={`wspage-listing-fix-${c.key}`}
              title={t('wspage.fixGo', '채우러 가기') as string}>
              ✗ {t(`wspage.criteria.${c.key}`)} <span aria-hidden>›</span>
            </CheckBtn>
          )))}
      </Checks>
      {!st.criteria_ok && st.status === 'off' && !need && <Hint>{t('wspage.criteriaHint', '✗ 항목을 채우면 공개를 신청할 수 있어요.')}</Hint>}

      {isOwner && taglineOpen && (
        <Field>
          <Lbl htmlFor="wslist-tagline">{t('wspage.taglineLabel', '한 줄 소개')} *</Lbl>
          <AutoSaveField key={`wslist-tagline-${businessId}`} onSave={saveTagline}>
            <TextIn id="wslist-tagline" ref={taglineInput} value={tagline} maxLength={100} data-testid="wspage-listing-tagline"
              placeholder={t('wspage.taglinePh', '예: 작은 브랜드의 첫 로고부터 패키지까지') as string}
              onChange={(e) => setTagline(e.target.value)} />
          </AutoSaveField>
          <Hint>{t('wspage.taglineHint', '설정 › 브랜드의 «한 줄 소개» 와 같은 값이에요.')}</Hint>
        </Field>
      )}

      <Grid>
        <Field>
          <Lbl htmlFor="wslist-cat">{t('wspage.category', '업종')} *</Lbl>
          <AutoSaveField type="select" key={`wslist-cat-${businessId}`} onSave={saveCat}>
            <PlanQSelect inputId="wslist-cat" name="public_category" isSearchable={false} isDisabled={!isOwner}
              placeholder={t('wspage.choose', '고르기') as string}
              options={st.categories.map((c) => ({ value: c, label: tw(`category.${c}`) as string }))}
              value={cat ? { value: cat, label: tw(`category.${cat}`) as string } : null}
              onChange={(opt: unknown) => setCat(String((opt as { value?: string } | null)?.value ?? ''))} />
          </AutoSaveField>
        </Field>
        <Field>
          <Lbl htmlFor="wslist-region">{t('wspage.region', '지역')}</Lbl>
          <AutoSaveField type="select" key={`wslist-region-${businessId}`} onSave={saveRegion}>
            <PlanQSelect inputId="wslist-region" name="public_region" isSearchable={false} isDisabled={!isOwner}
              placeholder={t('wspage.choose', '고르기') as string}
              options={st.regions.map((r) => ({ value: r, label: tw(`region.${r}`) as string }))}
              value={region ? { value: region, label: tw(`region.${region}`) as string } : null}
              onChange={(opt: unknown) => setRegion(String((opt as { value?: string } | null)?.value ?? ''))} />
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
const Checks = styled.div`display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center;`;
const CheckItem = styled.span<{ $ok: boolean }>`font-size:0.75rem;font-weight:600;color:${(p) => (p.$ok ? '#0F766E' : '#B91C3C')};`;
const CheckBtn = styled.button`display:inline-flex;align-items:center;gap:4px;min-height:32px;padding:0 10px;border-radius:999px;cursor:pointer;
  border:1px solid #FECDD3;background:#FFF1F2;font-size:0.75rem;font-weight:600;color:#B91C3C;
  &:hover{background:#FFE4E6;} &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}`;
const Need = styled.div`padding:8px 12px;background:#FFF1F2;border:1px solid #FECDD3;border-radius:8px;font-size:0.8125rem;font-weight:600;color:#B91C3C;line-height:1.5;`;
const TextIn = styled.input`height:36px;padding:0 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:0.8125rem;width:100%;max-width:480px;box-sizing:border-box;`;
const Hint = styled.div`font-size:0.75rem;color:#94A3B8;`;
const Warn = styled.div`padding:8px 12px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;font-size:0.75rem;color:#9A3412;line-height:1.5;`;
