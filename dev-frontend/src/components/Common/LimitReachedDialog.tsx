// 한도 도달 시 글로벌 모달. apiFetch 인터셉터가 'planq:limit-reached' 이벤트 dispatch.
// CTA: ① add-on 으로 늘리기 ② 플랜 업그레이드. 둘 다 /business/settings/plan 으로 이동.
//
// 2026-05-05 도입.
import { useEffect, useState } from 'react';
import { useChromeNav } from '../../hooks/useChromeNav';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { canPurchaseInApp, purchaseCopyKeys } from '../../utils/purchase';
import { useAuth, apiFetch } from '../../contexts/AuthContext';

interface LimitDetail {
  code?: string;
  message?: string;
  message_en?: string;
  limit?: number | null;
  current?: number;
  upgrade_url?: string;
  alternatives?: string[];
  // 결제 면제 워크스페이스 (운영 #275) — 업그레이드 CTA 가 서버에서 400 이라 막다른 길이 된다.
  exempt?: boolean;
}

const CODE_TO_KEY: Record<string, { titleKey: string; descKey: string; addonHintKey?: string }> = {
  members_quota_exceeded:       { titleKey: 'limit.members.title',   descKey: 'limit.members.desc',   addonHintKey: 'limit.members.addon' },
  clients_quota_exceeded:       { titleKey: 'limit.clients.title',   descKey: 'limit.clients.desc',   addonHintKey: 'limit.clients.addon' },
  projects_quota_exceeded:      { titleKey: 'limit.projects.title',  descKey: 'limit.projects.desc' },
  conversations_quota_exceeded: { titleKey: 'limit.conv.title',      descKey: 'limit.conv.desc' },
  storage_quota_exceeded:       { titleKey: 'limit.storage.title',   descKey: 'limit.storage.desc',   addonHintKey: 'limit.storage.addon' },
  file_size_exceeded:           { titleKey: 'limit.fileSize.title',  descKey: 'limit.fileSize.desc' },
  // 영상 등 큰 파일 — 자체 스토리지 한도를 넘으면 Drive 연결이 필요하다 (Irene 확정 2026-08-24)
  needs_drive_for_large_file:   { titleKey: 'limit.needsDrive.title', descKey: 'limit.needsDrive.desc' },
  cue_quota_exceeded:           { titleKey: 'limit.cue.title',       descKey: 'limit.cue.desc',       addonHintKey: 'limit.cue.addon' },
  qnote_quota_exceeded:         { titleKey: 'limit.qnote.title',     descKey: 'limit.qnote.desc',     addonHintKey: 'limit.qnote.addon' },
  feature_not_in_plan:          { titleKey: 'limit.feature.title',   descKey: 'limit.feature.desc' },
  subscription_inactive:        { titleKey: 'limit.inactive.title',  descKey: 'limit.inactive.desc' },
};

const LimitReachedDialog: React.FC = () => {
  const { t } = useTranslation('common');
  const navigate = useChromeNav();
  const [detail, setDetail] = useState<LimitDetail | null>(null);
  const { user } = useAuth();
  // 체험 중 멤버 한도 → «팀 체험으로 바꾸기» (2026-10-09 Fable 설계 6). 가능 여부는 서버 판정
  //   (/status 의 trial_plan_switch = POST trial-plan 과 같은 함수)만 본다 — 화면이 체험·결제 이력으로 스스로 판정하지 않는다.
  const [trialSwitch, setTrialSwitch] = useState<{ next: 'basic' | 'pro' } | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchErr, setSwitchErr] = useState('');
  const bizId = user?.business_id || null;
  const isOwner = user?.business_role === 'owner';
  useEffect(() => {
    setTrialSwitch(null); setSwitchErr('');
    if (!detail || detail.code !== 'members_quota_exceeded' || !bizId) return;
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/plan/${bizId}/status`);
        const j = await r.json();
        const d = j?.data;
        if (!alive || !d?.trial_plan_switch?.available) return;
        const cur = d.plan?.code;
        if (cur === 'starter') setTrialSwitch({ next: 'basic' });
        else if (cur === 'basic') setTrialSwitch({ next: 'pro' });
      } catch { /* 버튼 없이 종전 창 */ }
    })();
    return () => { alive = false; };
  }, [detail, bizId]);

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
  // 버튼(아래 CTA)은 이미 숨기지만 설명문이 "상위 플랜으로 업그레이드하세요" 라고 말한다 —
  // App Store 3.1.1 은 유도 문구 자체를 금지하므로 네이티브에선 _native 변형으로 대체한다.
  const desc = t(purchaseCopyKeys(map.descKey), { defaultValue: detail.message_en || '' }) as string;
  // App Store 3.1.1 — add-on 안내 문구는 가격·구매 방법을 담고 있어 네이티브에선 숨긴다.
  // "구매를 웹으로 안내하는 문구도 두지 않는다"(utils/purchase) 원칙과 정렬.
  const addonHint = (canPurchaseInApp() && map.addonHintKey) ? t(map.addonHintKey, '') : '';

  const upgradeUrl = detail.upgrade_url || '/business/settings/plan';
  const close = () => setDetail(null);
  const doTrialSwitch = async () => {
    if (!trialSwitch || !bizId || switching) return;
    setSwitching(true); setSwitchErr('');
    try {
      const r = await apiFetch(`/api/plan/${bizId}/trial-plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_code: trialSwitch.next }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || j?.success === false) throw new Error(j?.message || 'failed');
      // 플랜 화면·사용량 카드가 다시 읽게 알린다. 초대 창은 그대로 — 다시 누르면 들어간다.
      window.dispatchEvent(new CustomEvent('planq:plan-changed', { detail: { business_id: bizId } }));
      close();
    } catch {
      setSwitchErr(t('limit.trialSwitch.error', '바꾸지 못했어요. 잠시 뒤 다시 시도하거나 플랜 화면에서 바꿔 주세요.') as string);
    } finally { setSwitching(false); }
  };

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
        {/* 결제 면제 워크스페이스는 업그레이드가 불가능하므로 한도 조정 경로를 문구로 준다. */}
        {detail.exempt && (
          <AddonHint>{t('limit.exemptHint', '이 워크스페이스는 구독료가 면제되어 있습니다. 한도 조정이 필요하면 플랫폼 관리자에게 문의해 주세요.')}</AddonHint>
        )}
        {trialSwitch && (
          <AddonHint data-testid="limit-trial-switch-hint">
            {isOwner
              ? t(`limit.trialSwitch.hint_${trialSwitch.next}`)
              : t('limit.trialSwitch.memberHint', '지금은 체험 중이에요. 워크스페이스 대표가 팀 체험으로 바꾸면 더 초대할 수 있어요.')}
          </AddonHint>
        )}
        {switchErr && <Desc>{switchErr}</Desc>}
        <Actions>
          <SecondaryBtn type="button" onClick={close}>{t('limit.close', '닫기')}</SecondaryBtn>
          {/* App Store 3.1.1 — 네이티브에선 구매 유도 CTA 숨김.
              면제 워크스페이스도 같이 숨긴다 — 눌러도 체크아웃이 400 이라 막다른 길. */}
          {trialSwitch && isOwner ? (
            <PrimaryBtn type="button" data-testid="limit-trial-switch" disabled={switching} onClick={doTrialSwitch}>
              {t(`limit.trialSwitch.cta_${trialSwitch.next}`)}
            </PrimaryBtn>
          ) : canPurchaseInApp() && !detail.exempt && (
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
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  background: #FFFFFF;
  border-radius: 12px;
  padding: 28px 28px 20px;
  max-width: 440px; width: 100%;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 20px 60px rgba(15,23,42,0.25);
  @media (max-width: 640px) { padding: 22px 20px 16px; }
`;
const Title = styled.div` font-size: 1.0625rem; font-weight: 700; color: #0F172A; `;
const Desc = styled.div` font-size: 0.875rem; color: #475569; line-height: 1.6; `;
const Stats = styled.div`
  display: flex; gap: 16px; padding: 10px 12px;
  background: #F8FAFC; border-radius: 8px;
  font-size: 0.8125rem; color: #64748B;
  b { color: #0F172A; font-weight: 600; }
`;
const AddonHint = styled.div`
  font-size: 0.8125rem; color: #0D9488;
  background: #F0FDFA; border: 1px solid #99F6E4;
  padding: 10px 12px; border-radius: 8px;
`;
const AltList = styled.ul`
  margin: 0; padding: 0 0 0 18px;
  font-size: 0.8125rem; color: #475569; line-height: 1.7;
`;
const Actions = styled.div`
  display: flex; justify-content: flex-end; gap: 8px;
  margin-top: 8px;
`;
// 사용량 페이지로 이동하는 보조 링크 — 본문과 액션 사이 인라인.
const UsageLink = styled.button`
  align-self: flex-start;
  background: none; border: 0; padding: 4px 0;
  color: #0D9488; font-size: 0.8125rem; font-weight: 600;
  cursor: pointer; text-decoration: underline;
  &:hover { color: #0F766E; }
`;
const PrimaryBtn = styled.button`
  padding: 10px 18px; border-radius: 8px;
  background: #14B8A6; color: #FFFFFF; border: 0;
  font-size: 0.875rem; font-weight: 600;
  cursor: pointer;
  &:hover { background: #0D9488; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  flex-shrink: 0; white-space: nowrap;   /* 폰에서 «닫기» 가 세로로 꺾였다(2026-10-09 실측) */
  padding: 10px 18px; border-radius: 8px;
  background: #FFFFFF; color: #334155;
  border: 1px solid #CBD5E1;
  font-size: 0.875rem; font-weight: 500;
  cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
