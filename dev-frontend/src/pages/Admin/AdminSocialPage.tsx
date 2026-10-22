// 플랫폼 관리자 > SNS 발송 (2026-10-22) — 인사이트 글을 채널별 SNS 소재로. 서버: dev-backend/routes/admin_social.js
//   설계 docs/SNS_PUBLISH_DESIGN.md · 단계 1: 링크 미리보기 이미지 · 카드 4장 · 채널 6곳 본문 · 승인 · 반자동(네이버·카카오) 게시함 표시.
//   외부 발송 없음 — LinkedIn·Facebook·Instagram·Threads 는 계정 연결(단계 2) 뒤 예약 발송.
//   Irene 10-21: «인사이트에 있는 글을 하나씩 SNS에 … 플랫폼관리자에서 계정연결 … 보낼 수 있게 안내도» · «스레드 꼭 넣어줘»
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import EmptyState from '../../components/Common/EmptyState';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { SegmentedToggle, SegmentedBtn } from '../../components/Common/segmentedToggle';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { listRowTitleCss } from '../../theme/tokens';
import { formatDay } from '../../utils/dateFormat';
import { onSocket } from '../../services/socket';
import SocialArticleDrawer from './social/SocialArticleDrawer';
import { SOCIAL_API, socialCall, type SocialAccount, type SocialArticleRow, type SocialChannel } from './social/socialApi';

interface Overview { channels: SocialChannel[]; accounts: SocialAccount[]; publish_enabled: boolean }

export default function AdminSocialPage() {
  const { t } = useTranslation('admin');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'channels' ? 'channels' : 'articles';
  const articleId = Number(params.get('article')) || null;
  const [category, setCategory] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [rows, setRows] = useState<SocialArticleRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openGuide, setOpenGuide] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ov, list] = await Promise.all([
        socialCall<Overview>(`${SOCIAL_API}/overview`),
        socialCall<SocialArticleRow[]>(`${SOCIAL_API}/articles${category ? `?category=${encodeURIComponent(category)}` : ''}`),
      ]);
      setOverview(ov); setRows(list); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, [category]);
  useEffect(() => { void load(); }, [load]);
  useVisibilityRefresh(() => { void load(); });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onSocket('social:changed', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void load(); }, 250);
    });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, [load]);

  const setQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v == null) next.delete(k); else next.set(k, v); }
    setParams(next, { replace: true });
  };
  const openArticle = (id: number) => setQuery({ article: articleId === id ? null : String(id) }); // 재클릭 = 닫기

  const catOptions: PlanQSelectOption[] = [
    { value: '', label: t('social.catAll') as string },
    { value: 'insights', label: t('social.cat.insights') as string },
    { value: 'updates', label: t('social.cat.updates') as string },
  ];
  const catLabel = (c: string | null) => (c && ['insights', 'updates'].includes(c) ? t(`social.cat.${c}`) : c || t('social.cat.none'));
  const channels = overview?.channels || [];

  return (
    <PageShell
      title={t('social.title') as string}
      count={tab === 'articles' && rows ? rows.length : undefined}
      actions={(
        <SegmentedToggle role="tablist">
          <SegmentedBtn type="button" role="tab" $active={tab === 'articles'} aria-selected={tab === 'articles'}
            onClick={() => setQuery({ tab: null })}>{t('social.tabArticles')}</SegmentedBtn>
          <SegmentedBtn type="button" role="tab" $active={tab === 'channels'} aria-selected={tab === 'channels'}
            data-testid="social-tab-channels" onClick={() => setQuery({ tab: 'channels', article: null })}>{t('social.tabChannels')}</SegmentedBtn>
        </SegmentedToggle>
      )}
    >
      <Note>{t('social.stageNote')}</Note>
      {err && <ErrLine role="alert">{t(`social.err.${err}`, { defaultValue: t('social.err.generic', { code: err }) })}</ErrLine>}

      {tab === 'articles' ? (
        <>
          <Filters>
            <AxisLabel>{t('social.category')}</AxisLabel>
            <SelWrap>
              <PlanQSelect size="sm" isSearchable={false} isClearable={false}
                value={catOptions.find((o) => o.value === category)} options={catOptions}
                onChange={(o) => setCategory(String((o as PlanQSelectOption)?.value || ''))} />
            </SelWrap>
          </Filters>
          {!rows ? <Dim>{t('social.loading')}</Dim> : rows.length === 0 ? (
            <EmptyState title={t('social.emptyTitle') as string} description={t('social.emptyDesc') as string} />
          ) : (
            <List>
              {rows.map((r) => {
                const c = r.post_counts || {};
                const any = Object.values(c).some((n) => (n || 0) > 0);
                return (
                  <Row key={r.id} type="button" $active={articleId === r.id} onClick={() => openArticle(r.id)} data-testid={`social-article-${r.id}`}>
                    {r.og_image_url ? <OgThumb src={r.og_image_url} alt="" loading="lazy" /> : <OgThumbEmpty>{t('social.ogMissing')}</OgThumbEmpty>}
                    <RowMain>
                      <RowTitle>{r.title_ko}</RowTitle>
                      <RowMeta>
                        <CatChip>{catLabel(r.blog_category)}</CatChip>
                        {r.published_at && <span>{formatDay(r.published_at)}</span>}
                      </RowMeta>
                      <Counts>
                        {!any && <span className="dim">{t('social.noPosts')}</span>}
                        {(['draft', 'approved', 'sent'] as const).map((s) => ((c[s] || 0) > 0
                          ? <CountChip key={s} $s={s}>{t(`social.count.${s}`, { count: c[s] })}</CountChip> : null))}
                      </Counts>
                    </RowMain>
                  </Row>
                );
              })}
            </List>
          )}
        </>
      ) : (
        <ChannelGrid>
          {channels.map((ch) => {
            const acc = overview?.accounts.find((a) => a.provider === ch.provider && a.status === 'active');
            const semi = ch.mode === 'semi';
            return (
              <ChannelCard key={ch.provider} data-testid={`social-channel-${ch.provider}`}>
                <ChHead>
                  <ChName>{t(`social.provider.${ch.provider}`)}</ChName>
                  <ChState $ok={semi || !!acc}>
                    {semi ? t('social.mode.semi') : acc ? t('social.channels.connected') : t('social.channels.notConnected')}
                  </ChState>
                </ChHead>
                <ChDesc>{semi ? t('social.channels.semiReady') : acc ? acc.display_name : t('social.channels.autoLater')}</ChDesc>
                <GuideToggle type="button" aria-expanded={openGuide === ch.provider}
                  onClick={() => setOpenGuide(openGuide === ch.provider ? null : ch.provider)}>
                  {t('social.channels.howTo')} {openGuide === ch.provider ? '▴' : '▾'}
                </GuideToggle>
                {openGuide === ch.provider && <Guide>{t(`social.channels.guide.${ch.provider}`)}</Guide>}
              </ChannelCard>
            );
          })}
        </ChannelGrid>
      )}

      <SocialArticleDrawer
        articleId={tab === 'articles' ? articleId : null}
        channels={channels}
        onClose={() => setQuery({ article: null })}
        onListChanged={() => { void load(); }}
      />
    </PageShell>
  );
}

const Note = styled.p`
  margin: 0 0 16px; padding: 12px 14px; border-radius: 10px; background: #F0FDFA; color: #134E4A;
  font-size: 0.8125rem; line-height: 1.6;
`;
const ErrLine = styled.div`margin-bottom: 12px; padding: 10px 12px; border-radius: 8px; background: #FFF1F2; color: #BE123C; font-size: 0.8125rem;`;
const Dim = styled.div`color: #94A3B8; font-size: 0.8125rem; padding: 24px 0;`;
const Filters = styled.div`display: flex; align-items: center; gap: 8px; margin-bottom: 12px;`;
const AxisLabel = styled.span`font-size: 0.8125rem; color: #64748B;`;
const SelWrap = styled.div`width: 160px;`;
const List = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Row = styled.button<{ $active: boolean }>`
  display: flex; gap: 14px; align-items: center; width: 100%; text-align: left; cursor: pointer;
  padding: 10px; border-radius: 12px; background: #fff; font: inherit;
  border: 1px solid ${(p) => (p.$active ? '#14B8A6' : '#E2E8F0')};
  box-shadow: ${(p) => (p.$active ? '0 0 0 3px rgba(20,184,166,.12)' : 'none')};
  &:hover { border-color: #5EEAD4; }
  @media (max-width: 640px) { gap: 10px; }
`;
const OgThumb = styled.img`flex: none; width: 152px; aspect-ratio: 1200 / 630; object-fit: cover; border-radius: 8px; border: 1px solid #E2E8F0;
  @media (max-width: 640px) { width: 96px; }`;
const OgThumbEmpty = styled.div`
  flex: none; width: 152px; aspect-ratio: 1200 / 630; border-radius: 8px; border: 1px dashed #CBD5E1; background: #F8FAFC;
  display: flex; align-items: center; justify-content: center; text-align: center; font-size: 0.75rem; color: #94A3B8; padding: 4px;
  @media (max-width: 640px) { width: 96px; font-size: 0.75rem; }
`;
const RowMain = styled.div`flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px;`;
const RowTitle = styled.div`${listRowTitleCss} color: #0F172A; line-height: 1.4; overflow-wrap: anywhere;`;
const RowMeta = styled.div`display: flex; align-items: center; gap: 8px; font-size: 0.75rem; color: #64748B;`;
const CatChip = styled.span`padding: 1px 8px; border-radius: 999px; background: #F1F5F9; color: #475569; font-size: 0.75rem;`;
const Counts = styled.div`display: flex; gap: 6px; flex-wrap: wrap; font-size: 0.75rem; .dim { color: #94A3B8; }`;
const COUNT_COLOR: Record<string, [string, string]> = { draft: ['#F1F5F9', '#475569'], approved: ['#CCFBF1', '#0F766E'], sent: ['#DCFCE7', '#15803D'] };
const CountChip = styled.span<{ $s: string }>`
  padding: 1px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;
  background: ${(p) => COUNT_COLOR[p.$s][0]}; color: ${(p) => COUNT_COLOR[p.$s][1]};
`;
const ChannelGrid = styled.div`display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px;`;
const ChannelCard = styled.section`border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px; background: #fff; display: flex; flex-direction: column; gap: 8px;`;
const ChHead = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px;`;
const ChName = styled.h3`margin: 0; font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const ChState = styled.span<{ $ok: boolean }>`
  font-size: 0.75rem; padding: 2px 10px; border-radius: 999px;
  background: ${(p) => (p.$ok ? '#FEF3C7' : '#F1F5F9')}; color: ${(p) => (p.$ok ? '#92400E' : '#64748B')};
`;
const ChDesc = styled.p`margin: 0; font-size: 0.8125rem; color: #475569; line-height: 1.5;`;
const GuideToggle = styled.button`
  align-self: flex-start; height: 32px; padding: 0 10px; border-radius: 6px; border: 1px solid #E2E8F0; background: #fff;
  font-size: 0.75rem; color: #0D9488; cursor: pointer; &:hover { border-color: #14B8A6; }
`;
const Guide = styled.p`margin: 0; font-size: 0.75rem; color: #475569; line-height: 1.6; background: #F8FAFC; border-radius: 8px; padding: 10px 12px;`;
