// 랜딩 마케팅 측정 — 주소를 지켜보며 싣기·페이지뷰·CTA·동의 띠/설정을 맡는다 (2026-10-17).
//   판정·전송은 services/marketingTags 한 곳. 설계 docs/MARKETING_TRACKING_DESIGN.md.
//
// ★ 자리: ShellApp(BrowserRouter) 안 한 곳. 랜딩·가입 화면은 로그인 전이라 언제나 셸 트리로 그려진다
//   (탭 모드는 로그인 + 앱 경로에서만 — ModeGate). 그래서 탭 모드 트리에 둘 필요가 없다.
import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { useAuth } from '../../contexts/AuthContext';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';
import { Switch, SwitchKnob } from '../Common/switchShell';
import {
  CONSENT_CHANGED_EVENT, CONSENT_OPEN_EVENT, ctaTargetOf, effectiveConsent, ensureLoaded, isKoreanVisitor,
  isSignupDone, isTrackable, leaveScope, loadContainerId, pageTypeOf, readConsent, saveConsent, tagsLoaded, track,
} from '../../services/marketingTags';

const MarketingTags: React.FC = () => {
  const { t } = useTranslation('landing');
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const loggedIn = !!user;
  const inScope = !isLoading && isTrackable(location.pathname, location.search, loggedIn);
  const [hasId, setHasId] = useState(false);
  const [decided, setDecided] = useState(() => !!readConsent());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lastPathRef = useRef<string | null>(null);

  // 주소가 바뀔 때 — 범위 밖이면(실었던 문서면) 새로 읽고, 안이면 싣고 페이지뷰.
  useEffect(() => {
    if (isLoading) return;
    if (!inScope) { leaveScope(); return; }
    const key = location.pathname;
    let alive = true;
    void (async () => {
      const id = await loadContainerId();
      if (!alive) return;
      setHasId(!!id);
      if (!id || isSignupDone(location.pathname, location.search)) return;   // 가입 완료는 RegisterPage 가 보낸다
      if (!(await ensureLoaded()) || !alive) return;
      if (lastPathRef.current === key) return;
      lastPathRef.current = key;
      const type = pageTypeOf(location.pathname) || 'other';
      track('pq_page_view', { page_type: type, page_title: document.title.slice(0, 120) });
      if (type === 'pricing') track('pq_view_pricing');
      if (type === 'service') track('pq_view_service');
      if (type === 'register') {
        track('pq_signup_view', { trial_plan: new URLSearchParams(location.search).get('plan') || undefined });
      }
    })();
    return () => { alive = false; };
  }, [isLoading, inScope, location.pathname, location.search]);

  // 동의가 바뀌면(띠·설정) 다시 판정 — 허용하면 그 자리에서 싣고 지금 페이지를 센다.
  useEffect(() => {
    const onChange = () => {
      setDecided(!!readConsent());
      if (!inScope || tagsLoaded()) return;
      void ensureLoaded().then((ok) => {
        if (!ok) return;
        lastPathRef.current = location.pathname;
        track('pq_page_view', { page_type: pageTypeOf(location.pathname) || 'other', page_title: document.title.slice(0, 120) });
      });
    };
    const onOpen = () => setSettingsOpen(true);
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    window.addEventListener(CONSENT_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
      window.removeEventListener(CONSENT_OPEN_EVENT, onOpen);
    };
  }, [inScope, location.pathname]);

  // 전환으로 가는 링크 클릭 — 링크 주소로 판정한다(링크마다 표시를 달지 않는다).
  useEffect(() => {
    if (!inScope) return;
    const onClick = (e: MouseEvent) => {
      if (!tagsLoaded()) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      const target = ctaTargetOf(a.href);
      if (!target) return;
      const tagged = a.closest('[data-pq-cta]')?.getAttribute('data-pq-cta');
      const where = tagged || (a.closest('header') ? 'header' : a.closest('footer') ? 'footer' : 'body');
      track('pq_cta_click', { cta_location: where.slice(0, 40), cta_target: target });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [inScope]);

  const showBanner = inScope && hasId && !decided && !isSignupDone(location.pathname, location.search);
  const korean = isKoreanVisitor();

  return (
    <>
      {showBanner && (
        <Banner role="region" aria-label={t('consent.bannerLabel')} data-testid="consent-banner">
          <BannerText>{korean ? t('consent.bannerNotice') : t('consent.bannerAsk')}</BannerText>
          <BannerActions>
            <ActionButton size="sm" tone="secondary" type="button" onClick={() => setSettingsOpen(true)} data-testid="consent-settings">
              {t('consent.settings')}
            </ActionButton>
            {!korean && (
              <ActionButton size="sm" tone="secondary" type="button" onClick={() => saveConsent(false, false)} data-testid="consent-reject">
                {t('consent.reject')}
              </ActionButton>
            )}
            <ActionButton size="sm" tone="primary" type="button" onClick={() => saveConsent(true, true)} data-testid="consent-accept">
              {korean ? t('consent.ok') : t('consent.accept')}
            </ActionButton>
          </BannerActions>
        </Banner>
      )}
      {settingsOpen && <ConsentSettings onClose={() => setSettingsOpen(false)} />}
    </>
  );
};

const ConsentSettings: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation('landing');
  const init = effectiveConsent() || { analytics: false, ads: false };
  const [analytics, setAnalytics] = useState(init.analytics);
  const [ads, setAds] = useState(init.ads);
  // autosave-exempt: 저장 버튼으로 확정하는 동의 선택 — 서버 저장이 아니라 이 브라우저의 선택이다
  const row = (label: string, desc: string, on: boolean, set: (v: boolean) => void, id: string) => (
    <Row>
      <RowText><strong>{label}</strong><span>{desc}</span></RowText>
      <Switch type="button" role="switch" aria-checked={on} aria-label={label} $on={on} onClick={() => set(!on)} data-testid={id}>
        <SwitchKnob $on={on} />
      </Switch>
    </Row>
  );
  return (
    <StandardModal
      open
      onClose={onClose}
      size="sm"
      title={t('consent.modalTitle')}
      footer={(
        <>
          <ActionButton tone="secondary" type="button" onClick={onClose}>{t('consent.cancel')}</ActionButton>
          <ActionButton tone="primary" type="button" data-testid="consent-save" onClick={() => { saveConsent(analytics, ads); onClose(); }}>
            {t('consent.save')}
          </ActionButton>
        </>
      )}
    >
      <Intro>{t('consent.modalIntro')}</Intro>
      <Row>
        <RowText><strong>{t('consent.essential')}</strong><span>{t('consent.essentialDesc')}</span></RowText>
        <Always>{t('consent.always')}</Always>
      </Row>
      {row(t('consent.analytics'), t('consent.analyticsDesc'), analytics, setAnalytics, 'consent-analytics')}
      {row(t('consent.ads'), t('consent.adsDesc'), ads, setAds, 'consent-ads')}
      <PolicyLink href="/privacy" target="_blank" rel="noopener noreferrer">{t('consent.privacyLink')}</PolicyLink>
    </StandardModal>
  );
};

export default MarketingTags;

const Banner = styled.div`
  position: fixed; z-index: 900;
  left: 16px; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  max-width: 720px; margin: 0 auto;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 12px 14px; border-radius: 12px;
  background: #fff; border: 1px solid #E2E8F0; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
`;
const BannerText = styled.p`
  margin: 0; flex: 1 1 260px; min-width: 0;
  font-size: 0.8125rem; line-height: 1.5; color: #334155;
`;
const BannerActions = styled.div`
  display: flex; gap: 8px; flex-shrink: 0; margin-left: auto;
`;
const Intro = styled.p`margin: 0; font-size: 0.8125rem; line-height: 1.6; color: #475569;`;
const Row = styled.div`
  display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid #F1F5F9;
`;
const RowText = styled.div`
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
  strong { font-size: 0.875rem; color: #0F172A; }
  span { font-size: 0.75rem; line-height: 1.5; color: #64748B; }
`;
const Always = styled.span`font-size: 0.75rem; color: #64748B; flex-shrink: 0;`;
const PolicyLink = styled.a`font-size: 0.75rem; color: #0F766E; text-decoration: underline; align-self: flex-start;`;
