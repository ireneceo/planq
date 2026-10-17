// 내 명함 공개 페이지 — /c/:token (로그인 불필요). 설계 docs/BUSINESS_CARD_DESIGN.md §4
//
// 받는 사람이 할 수 있는 것: 명함 보기 · [연락처에 저장](.vcf — 폰 주소록) · 로그인 상태면 [내 명함첩에 보관].
// ★ PublicPageShell 의 «card» 틀을 쓰지 않는다 — 그 틀은 그 자체가 흰 카드라 명함(CardFace)이 카드 안의 카드가 된다.
//   명함은 화면의 주인공이고 위 툴바(PlanQ 로고)도 받는 사람에게는 소음이다. 배경·폭은 PublicPageShell 과 같은 값(#F8FAFC · sm 420px).
//   없음·오류 같은 상태 화면은 PublicPageShell 을 그대로 쓴다.
// ★ 검색 색인 차단의 정본은 서버(nginx `location ^~ /c/` · ogMeta) — 아래 head 의 noindex 는 JS 를 돌리는 크롤러용 받침일 뿐이다.
// ★ 다시 읽기(규칙 16-P): 탭 복귀·60초 — 주인이 고치거나 링크를 끄면 따라간다.
import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PublicPageShell, { PublicCenter, PublicBtn } from '../../components/Layout/PublicPageShell';
import CardFace from '../../components/NameCard/CardFace';
import { useAuth } from '../../contexts/AuthContext';
import { usePublicRevalidate } from '../../hooks/usePublicRevalidate';
import { publicCardUrl, publicPhotoUrl, publicVcfUrl, saveCardByToken, CardApiError, type CardView } from '../../services/nameCards';

type State = 'loading' | 'ready' | 'notfound' | 'error';

const PublicCardPage = () => {
  const { t } = useTranslation('cards');
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [view, setView] = useState<CardView | null>(null);
  const [state, setState] = useState<State>('loading');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'own' | 'error'>('idle');

  const load = useCallback(async (silent = false) => {
    if (!silent) setState('loading');
    try {
      const r = await fetch(publicCardUrl(token), { credentials: 'omit' });
      if (r.status === 404) { setState('notfound'); setView(null); return; }
      const j = await r.json();
      if (!r.ok || !j.success) { if (!silent) setState('error'); return; }
      setView(j.data); setState('ready');
    } catch { if (!silent) setState('error'); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  usePublicRevalidate(() => load(true), { enabled: state === 'ready' });

  // 받쳐 주는 층 — 검색 차단의 정본은 서버(nginx `location ^~ /c/` X-Robots-Tag)지만, 그 설정이 아직 안 들어간 서버에서도
  //   JS 를 돌리는 크롤러(Googlebot)는 이 태그를 존중한다(Fable 완료 검증 권고). 화면을 떠나면 지운다.
  useEffect(() => {
    const m = document.createElement('meta');
    m.name = 'robots';
    m.content = 'noindex, nofollow';
    m.setAttribute('data-name-card', '');
    document.head.appendChild(m);
    return () => { m.remove(); };
  }, []);

  useEffect(() => {
    if (!view) return;
    const prev = document.title;
    document.title = [view.name, view.company].filter(Boolean).join(' · ') || 'PlanQ';
    return () => { document.title = prev; };
  }, [view]);

  const saveToWallet = async () => {
    if (!isAuthenticated) {
      navigate(`/login?redirect=${encodeURIComponent(`/c/${token}`)}`);
      return;
    }
    setSaveState('saving');
    try {
      await saveCardByToken(token);
      setSaveState('saved');
    } catch (e) {
      setSaveState(e instanceof CardApiError && e.code === 'own_card' ? 'own' : 'error');
    }
  };

  if (state === 'loading') {
    return <PublicPageShell layout="card" width="sm" center brand={false}><PublicCenter aria-busy="true" /></PublicPageShell>;
  }
  if (state !== 'ready' || !view) {
    const nf = state === 'notfound';
    return (
      <PublicPageShell layout="card" width="sm" center>
        <PublicCenter data-testid={nf ? 'card-notfound' : 'card-error'}>
          <strong>{nf ? t('public.notFound') : t('public.error')}</strong>
          {nf ? <span>{t('public.notFoundHint')}</span> : (
            <PublicBtn type="button" onClick={() => void load()}>{t('public.retry')}</PublicBtn>
          )}
        </PublicCenter>
      </PublicPageShell>
    );
  }

  return (
    <Page>
      <Column>
        <CardFace view={view} photoSrc={publicPhotoUrl(token, view)} testId="public-card" />
        <Actions>
          <ActionLink href={publicVcfUrl(token)} data-testid="card-save-contact" $primary>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
            {t('public.saveContact')}
          </ActionLink>
          {saveState === 'saved' ? (
            <ActionBtn type="button" onClick={() => navigate('/me/cards?tab=saved')} data-testid="card-open-wallet">
              {t('public.saved')} · {t('public.openWallet')}
            </ActionBtn>
          ) : (
            <ActionBtn type="button" onClick={() => void saveToWallet()} disabled={saveState === 'saving' || saveState === 'own'}
              data-testid="card-save-wallet">
              {saveState === 'own' ? t('public.ownCard')
                : isAuthenticated ? t('public.saveWallet') : t('public.loginToSave')}
            </ActionBtn>
          )}
          {saveState === 'error' && <ErrorText role="alert">{t('public.saveFail')}</ErrorText>}
        </Actions>
        <MadeWith href="https://planq.kr" target="_blank" rel="noopener noreferrer">{t('public.madeWith')}</MadeWith>
      </Column>
    </Page>
  );
};

export default PublicCardPage;

const Page = styled.div`
  min-height: 100vh; min-height: 100dvh; background: #F8FAFC;
  padding: 40px 16px calc(32px + var(--pq-safe-bottom, 0px));
  box-sizing: border-box;
  @media (max-width: 640px) { padding-top: 16px; }
`;
const Column = styled.main`
  width: 100%; max-width: 420px; margin: 0 auto;
  display: flex; flex-direction: column; gap: 16px;
`;
const Actions = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const actionCss = `
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 48px; padding: 10px 16px; border-radius: 12px; box-sizing: border-box;
  font-size: 0.9375rem; font-weight: 700; cursor: pointer; text-decoration: none; width: 100%;
`;
const ActionLink = styled.a<{ $primary?: boolean }>`
  ${actionCss}
  color: #FFFFFF; background: #14B8A6; border: none;
  &:hover { background: #0D9488; }
`;
const ActionBtn = styled.button`
  ${actionCss}
  color: #334155; background: #FFFFFF; border: 1px solid #E2E8F0;
  &:hover:not(:disabled) { border-color: #14B8A6; color: #0F766E; }
  &:disabled { opacity: 0.6; cursor: default; }
`;
const ErrorText = styled.div`font-size: 0.8125rem; color: #B91C1C; text-align: center;`;
const MadeWith = styled.a`
  align-self: center; font-size: 0.75rem; color: #94A3B8; text-decoration: none; padding: 8px;
  &:hover { color: #64748B; }
`;
