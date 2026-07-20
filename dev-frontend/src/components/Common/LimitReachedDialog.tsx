// 한도 도달 시 글로벌 모달. apiFetch 인터셉터가 'planq:limit-reached' 이벤트 dispatch.
// CTA: ① add-on 으로 늘리기 ② 플랜 업그레이드. 둘 다 /business/settings/plan 으로 이동.
//
// 2026-05-05 도입.
import { useEffect, useState } from 'react';
import { useChromeNav } from '../../hooks/useChromeNav';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { canPurchaseInApp } from '../../utils/purchase';

interface LimitDetail {
  code?: string;
  message?: string;
  message_en?: string;
  limit?: number | null;
  current?: number;
  upgrade_url?: string;
  alternatives?: string[];
}

const CODE_TO_KEY: Record<string, { titleKey: string; descKey: string; addonHintKey?: string }> = {
  members_quota_exceeded:       { titleKey: 'limit.members.title',   descKey: 'limit.members.desc',   addonHintKey: 'limit.members.addon' },
  clients_quota_exceeded:       { titleKey: 'limit.clients.title',   descKey: 'limit.clients.desc',   addonHintKey: 'limit.clients.addon' },
  projects_quota_exceeded:      { titleKey: 'limit.projects.title',  descKey: 'limit.projects.desc' },
  conversations_quota_exceeded: { titleKey: 'limit.conv.title',      descKey: 'limit.conv.desc' },
  storage_quota_exceeded:       { titleKey: 'limit.storage.title',   descKey: 'limit.storage.desc',   addonHintKey: 'limit.storage.addon' },
  file_size_exceeded:           { titleKey: 'limit.fileSize.title',  descKey: 'limit.fileSize.desc' },
  cue_quota_exceeded:           { titleKey: 'limit.cue.title',       descKey: 'limit.cue.desc',       addonHintKey: 'limit.cue.addon' },
  qnote_quota_exceeded:         { titleKey: 'limit.qnote.title',     descKey: 'limit.qnote.desc',     addonHintKey: 'limit.qnote.addon' },
  feature_not_in_plan:          { titleKey: 'limit.feature.title',   descKey: 'limit.feature.desc' },
  subscription_inactive:        { titleKey: 'limit.inactive.title',  descKey: 'limit.inactive.desc' },
};

const LimitReachedDialog: React.FC = () => {
  const { t } = useTranslation('common');
  const navigate = useChromeNav();
  const [detail, setDetail] = useState<LimitDetail | null>(null);

  useEffect(() => {
    const onEvent = (e: Event) => {
      const ce = e as CustomEvent<LimitDetail>;
      setDetail(ce.detail || null);
    };
    window.addEventListener('planq:limit-reached', onEvent as EventListener);
    return () => window.removeEventListener('planq:limit-reached', onEvent as EventListener);
  }, []);

  if (!detail) return null;

  const code = detail.code || '';
  const map = CODE_TO_KEY[code] || { titleKey: 'limit.generic.title', descKey: 'limit.generic.desc' };
  const title = t(map.titleKey, detail.message || code);
  const desc = t(map.descKey, detail.message_en || '');
  const addonHint = map.addonHintKey ? t(map.addonHintKey, '') : '';

  const upgradeUrl = detail.upgrade_url || '/business/settings/plan';
  const close = () => setDetail(null);

  return (
    <Backdrop role="dialog" aria-modal="true" onClick={close}>
      <Card onClick={e => e.stopPropagation()}>
        <Title>{title}</Title>
        {desc && <Desc>{desc}</Desc>}
        {(detail.limit != null || detail.current != null) && (
          <Stats>
            {detail.current != null && (<span>{t('limit.current', '현재')}: <b>{detail.current}</b></span>)}
            {detail.limit != null && (<span>{t('limit.maximum', '한도')}: <b>{detail.limit}</b></span>)}
          </Stats>
        )}
        {addonHint && <AddonHint>{addonHint}</AddonHint>}
        {detail.alternatives && detail.alternatives.length > 0 && (
          <AltList>{detail.alternatives.map((a, i) => <li key={i}>{a}</li>)}</AltList>
        )}
        {/* 사용량 페이지로 이동 — 비용 가드에서 어떤 항목이 얼마나 차감되는지 확인 가능. */}
        <UsageLink type="button" onClick={() => { close(); navigate('/business/settings/plan#usage'); }}>
          {t('limit.usageLink', '이번 달 사용량 자세히 보기 →')}
        </UsageLink>
        <Actions>
          <SecondaryBtn type="button" onClick={close}>{t('limit.close', '닫기')}</SecondaryBtn>
          {/* App Store 3.1.1 — 네이티브에선 구매 유도 CTA 숨김 */}
          {canPurchaseInApp() && (
            <PrimaryBtn type="button" onClick={() => { close(); navigate(upgradeUrl); }}>
              {t('limit.cta', '플랜·Add-on 보기')}
            </PrimaryBtn>
          )}
        </Actions>
      </Card>
    </Backdrop>
  );
};

export default LimitReachedDialog;

const Backdrop = styled.div`
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999; padding: 16px;
`;
const Card = styled.div`
  background: #FFFFFF;
  border-radius: 12px;
  padding: 28px 28px 20px;
  max-width: 440px; width: 100%;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 20px 60px rgba(15,23,42,0.25);
`;
const Title = styled.div` font-size: 17px; font-weight: 700; color: #0F172A; `;
const Desc = styled.div` font-size: 14px; color: #475569; line-height: 1.6; `;
const Stats = styled.div`
  display: flex; gap: 16px; padding: 10px 12px;
  background: #F8FAFC; border-radius: 8px;
  font-size: 13px; color: #64748B;
  b { color: #0F172A; font-weight: 600; }
`;
const AddonHint = styled.div`
  font-size: 13px; color: #0D9488;
  background: #F0FDFA; border: 1px solid #99F6E4;
  padding: 10px 12px; border-radius: 8px;
`;
const AltList = styled.ul`
  margin: 0; padding: 0 0 0 18px;
  font-size: 13px; color: #475569; line-height: 1.7;
`;
const Actions = styled.div`
  display: flex; justify-content: flex-end; gap: 8px;
  margin-top: 8px;
`;
// 사용량 페이지로 이동하는 보조 링크 — 본문과 액션 사이 인라인.
const UsageLink = styled.button`
  align-self: flex-start;
  background: none; border: 0; padding: 4px 0;
  color: #0D9488; font-size: 13px; font-weight: 600;
  cursor: pointer; text-decoration: underline;
  &:hover { color: #0F766E; }
`;
const PrimaryBtn = styled.button`
  padding: 10px 18px; border-radius: 8px;
  background: #14B8A6; color: #FFFFFF; border: 0;
  font-size: 14px; font-weight: 600;
  cursor: pointer;
  &:hover { background: #0D9488; }
`;
const SecondaryBtn = styled.button`
  padding: 10px 18px; border-radius: 8px;
  background: #FFFFFF; color: #334155;
  border: 1px solid #CBD5E1;
  font-size: 14px; font-weight: 500;
  cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
