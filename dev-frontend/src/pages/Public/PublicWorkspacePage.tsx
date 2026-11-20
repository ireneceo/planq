// 공개 회사 페이지 — `/w/<회사주소>` · `/en/w/<회사주소>` (P3 · 2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §3·§7 ①)
//
//   공개를 켜고 PlanQ 가 승인한 워크스페이스만 열린다(서버 isPubliclyListed 한 술어 — 아니면 404 = 없는 주소와 같다).
// ★ 본문은 창구 «안내» 와 **같은 컴포넌트**(EntryInfoView) — 한 화면·한 데이터(설계 §3). 탭이 없고 한 장으로 흐른다.
//   데스크탑은 오른쪽에 따라오는 문의 카드, 1024 이하는 맨 아래.
// ★ [상담 예약] 은 그 회사 창구(인증 뒤)로 보낸다 — 창구 링크가 없거나 예약이 꺼져 있으면 버튼이 없다.
// ★ 건네받은 창구 링크(/g/)와 달리 여기는 «회사 찾기» 에서 온 사람도 있다 — 경로 줄과 «같은 업종 다른 회사» 가 있다.
// ★ 공개(무인증) 화면 — 소켓 대신 usePublicRevalidate(탭 복귀·보이는 동안 60초 재조회, 실패는 보던 내용 유지).
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import EntryInfoView from '../Guest/EntryInfoView';
import type { EntryInfo } from '../Guest/GuestWorkspacePage';
import { usePublicRevalidate } from '../../hooks/usePublicRevalidate';
import ReportDialog from './PublicWorkspaceReport';

type PageView = EntryInfo & {
  name: string; logo_url: string | null; slug: string;
  category: string | null; region: string | null; entry_url: string | null;
};

export default function PublicWorkspacePage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { pathname } = useLocation();
  const isEn = pathname.startsWith('/en/');
  const pre = isEn ? '/en' : '';
  const { t, i18n } = useTranslation('wspage');
  const lang = isEn || (i18n.language || '').startsWith('en') ? 'en' : 'ko';
  const [view, setView] = useState<PageView | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'gone' | 'error'>('loading');
  const [report, setReport] = useState(false);

  const load = useCallback(async (silent = false) => {
    try {
      const r = await fetch(`/api/public/workspaces/${encodeURIComponent(slug)}?lang=${lang}`);
      if (r.status === 404) { if (!silent) setState('gone'); return; }
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { if (!silent) setState('error'); return; }
      setView(j.data); setState('ok');
    } catch { if (!silent) setState('error'); }
  }, [slug, lang]);
  useEffect(() => { void load(); }, [load]);
  usePublicRevalidate(() => load(true), { enabled: state === 'ok' });

  // 회사 찾기의 [문의하기](#inquiry) — 열리면 문의 폼으로 내려간다
  const { hash } = useLocation();
  useEffect(() => {
    if (state !== 'ok' || hash !== '#inquiry') return;
    const id = window.setTimeout(() => document.querySelector('[data-testid="entry-inquiry-form"]')?.scrollIntoView({ block: 'start' }), 300);
    return () => window.clearTimeout(id);
  }, [state, hash]);
  useEffect(() => {
    if (!view) return;
    const cat = view.category ? t(`category.${view.category}`) : '';
    document.title = `${view.name}${cat ? ` — ${cat}` : ''} | PlanQ`;
  }, [view, t]);

  if (state === 'loading') return <Shell><Muted>{t('loading', '불러오는 중…')}</Muted></Shell>;
  if (state === 'gone') {
    return (
      <Shell>
        <Card data-testid="wspage-public-gone">
          <H1>{t('gone.title', '찾을 수 없는 페이지예요')}</H1>
          <Muted>{t('gone.body', '주소가 바뀌었거나 공개가 꺼진 페이지일 수 있어요.')}</Muted>
          <GoLink to={`${pre}/directory`}>{t('gone.directory', '회사 찾기로 가기 →')}</GoLink>
        </Card>
      </Shell>
    );
  }
  if (state === 'error' || !view) return <Shell><Muted>{t('error', '불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')}</Muted></Shell>;

  const bookingOn = !!view.booking?.enabled && !!view.entry_url;
  const goForm = () => document.querySelector('[data-testid="entry-inquiry-form"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const goBook = () => { if (view.entry_url) window.location.assign(`${view.entry_url}?tab=book`); };

  return (
    <Shell>
      <Crumbs aria-label={t('crumbsAria', '경로') as string}>
        <Link to={`${pre}/`}>PlanQ</Link><Sep>›</Sep>
        <Link to={`${pre}/directory`}>{t('directory', '회사 찾기')}</Link>
        {view.category && (<><Sep>›</Sep><Link to={`${pre}/directory/${view.category}`}>{t(`category.${view.category}`)}</Link></>)}
        <Sep>›</Sep><span>{view.name}</span>
      </Crumbs>
      <Head data-testid="wspage-public-head">
        {view.logo_url ? <Logo src={`${view.logo_url}?w=160`} alt="" /> : <Initial aria-hidden>{view.name.charAt(0)}</Initial>}
        <HeadText>
          <H1>{view.name}</H1>
          {view.tagline && <Tagline>{view.tagline}</Tagline>}
          {(view.category || view.region) && (
            <Meta>{[view.category ? t(`category.${view.category}`) : null, view.region ? t(`region.${view.region}`) : null].filter(Boolean).join(' · ')}</Meta>
          )}
        </HeadText>
        <HeadBtns>
          {view.form?.enabled && <Primary type="button" onClick={goForm} data-testid="wspage-public-ask">{t('ask', '문의하기')}</Primary>}
          {bookingOn && <Ghost type="button" onClick={goBook} data-testid="wspage-public-book">{t('book', '상담 예약')}</Ghost>}
        </HeadBtns>
      </Head>
      <Body>
        <EntryInfoView entry={view} bookingOn={bookingOn} onAsk={goForm} onBook={goBook}
          inquiryUrl={`/api/public/workspaces/${encodeURIComponent(view.slug)}/inquiries`}
          workspaceName={view.name} hideActions splitForm />
      </Body>
      <Foot>
        <span>{t('poweredBy', 'PlanQ 로 운영되는 페이지')}</span>
        <FootBtn type="button" onClick={() => setReport(true)} data-testid="wspage-public-report">{t('report.open', '이 페이지 신고')}</FootBtn>
        {view.category && <Link to={`${pre}/directory/${view.category}`}>{t('sameCategory', '같은 업종 다른 회사 보기 →')}</Link>}
      </Foot>
      <ReportDialog open={report} onClose={() => setReport(false)} slug={view.slug} lang={lang} />
    </Shell>
  );
}

const Page = styled.div`min-height:100vh;background:#F8FAFC;`;
const Inner = styled.div`padding:16px 20px 40px;box-sizing:border-box;
  display:flex;flex-direction:column;gap:14px;max-width:1120px;margin:0 auto;
  @media (max-width:640px){ padding:12px 14px 32px; }`;
// 배경은 화면 전체, 본문은 가운데 1120
const Shell = ({ children }: { children: React.ReactNode }) => <Page><Inner>{children}</Inner></Page>;
const Crumbs = styled.nav`display:flex;flex-wrap:wrap;gap:6px;font-size:0.75rem;color:#64748B;
  a{color:#64748B;text-decoration:none;&:hover{color:#0D9488;}}`;
const Sep = styled.span`color:#CBD5E1;`;
const Head = styled.header`display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:18px 20px;`;
const Logo = styled.img`width:56px;height:56px;border-radius:12px;object-fit:contain;background:#fff;border:1px solid #E2E8F0;flex-shrink:0;`;
const Initial = styled.span`width:56px;height:56px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;
  background:#14B8A6;color:#fff;font-size:1.25rem;font-weight:700;flex-shrink:0;`;
const HeadText = styled.div`flex:1;min-width:200px;display:flex;flex-direction:column;gap:3px;`;
const H1 = styled.h1`margin:0;font-size:1.375rem;font-weight:800;color:#0F172A;letter-spacing:-0.3px;word-break:keep-all;overflow-wrap:anywhere;`;
const Tagline = styled.div`font-size:0.9375rem;color:#334155;`;
const Meta = styled.div`font-size:0.8125rem;color:#64748B;`;
const HeadBtns = styled.div`display:flex;gap:8px;flex-wrap:wrap;`;
const Primary = styled.button`min-height:44px;padding:0 18px;border-radius:10px;border:none;cursor:pointer;background:#14B8A6;color:#fff;font-size:0.9375rem;font-weight:700;
  &:hover{background:#0D9488;}&:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}`;
const Ghost = styled.button`min-height:44px;padding:0 18px;border-radius:10px;cursor:pointer;border:1px solid #CBD5E1;background:#fff;color:#334155;font-size:0.9375rem;font-weight:700;
  &:hover{border-color:#14B8A6;}&:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}`;
const Body = styled.main`background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:18px;
  @media (max-width:640px){ padding:14px; }`;
const Foot = styled.footer`display:flex;flex-wrap:wrap;gap:14px;align-items:center;font-size:0.75rem;color:#94A3B8;
  a{color:#0D9488;text-decoration:none;font-weight:600;}`;
const FootBtn = styled.button`border:none;background:none;padding:0;cursor:pointer;color:#64748B;font-size:0.75rem;text-decoration:underline;`;
const Card = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:24px;display:flex;flex-direction:column;gap:10px;align-items:flex-start;`;
const Muted = styled.div`font-size:0.875rem;color:#64748B;`;
const GoLink = styled(Link)`color:#0D9488;font-weight:600;text-decoration:none;font-size:0.875rem;`;
