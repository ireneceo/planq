// 권한 정책 — 워크스페이스 > 권한 탭
// PERMISSION_MATRIX.md §4 — 토글 3축 (financial/schedule/client_info), 기본값 "all" (열린 문화).
// 변경은 owner 만 가능 (탭 자체는 모두 조회 — 투명성).
// UX: AutoSave, disabled+툴팁, 실시간 프리뷰, 권장 배지.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';

type ToggleKey = 'financial' | 'schedule' | 'client_info';
type ToggleValue = 'all' | 'pm';
interface Permissions { financial: ToggleValue; schedule: ToggleValue; client_info: ToggleValue; }

interface MemberStat { total: number; pmTotal: number; }

interface Props {
  businessId: number;
  isOwner: boolean;
}

const DEFAULT_PERMS: Permissions = { financial: 'all', schedule: 'all', client_info: 'all' };

// ───────────────────────────────────────────────────────────
// 아이콘 (인라인 SVG — 외부 라이브러리 없이)
// ───────────────────────────────────────────────────────────
const IconFinancial = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M7 10v.01M17 14v.01" />
  </svg>
);
const IconSchedule = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);
const IconClientInfo = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
  </svg>
);
const IconCheck = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12l5 5 9-11" />
  </svg>
);

// ───────────────────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────────────────
const PermissionsSettings: React.FC<Props> = ({ businessId, isOwner }) => {
  const { t } = useTranslation('settings');

  const [perms, setPerms] = useState<Permissions>(DEFAULT_PERMS);
  const [loaded, setLoaded] = useState(false);
  const [stats, setStats] = useState<MemberStat>({ total: 0, pmTotal: 0 });
  const [saveState, setSaveState] = useState<Record<ToggleKey, 'idle' | 'saving' | 'saved' | 'error'>>({
    financial: 'idle', schedule: 'idle', client_info: 'idle',
  });

  // ─── 초기 로드 ───
  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch(`/api/businesses/${businessId}/permissions`);
        const j = await r.json();
        if (j.success && j.data?.permissions) {
          setPerms({
            financial: j.data.permissions.financial || 'all',
            schedule: j.data.permissions.schedule || 'all',
            client_info: j.data.permissions.client_info || 'all',
          });
        }
        if (j.success && j.data?.stats) {
          setStats({
            total: Number(j.data.stats.memberTotal) || 0,
            pmTotal: Number(j.data.stats.pmTotal) || 0,
          });
        }
      } catch { /* noop — 기본값 유지 */ }
      setLoaded(true);
    })();
  }, [businessId]);

  // ─── 저장 (AutoSave, 300ms debounce) ───
  const saveTimers = useRef<Record<ToggleKey, number | null>>({ financial: null, schedule: null, client_info: null });

  const saveToggle = (key: ToggleKey, nextPerms: Permissions) => {
    if (saveTimers.current[key]) window.clearTimeout(saveTimers.current[key] as number);
    setSaveState(s => ({ ...s, [key]: 'saving' }));
    saveTimers.current[key] = window.setTimeout(async () => {
      try {
        const r = await apiFetch(`/api/businesses/${businessId}/permissions`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ permissions: nextPerms }),
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message || 'Failed');
        setSaveState(s => ({ ...s, [key]: 'saved' }));
        window.setTimeout(() => setSaveState(s => ({ ...s, [key]: s[key] === 'saved' ? 'idle' : s[key] })), 2000);
      } catch {
        setSaveState(s => ({ ...s, [key]: 'error' }));
        window.setTimeout(() => setSaveState(s => ({ ...s, [key]: 'idle' })), 3000);
      }
    }, 300);
  };

  const handleChange = (key: ToggleKey, value: ToggleValue) => {
    if (!isOwner) return;
    const next = { ...perms, [key]: value };
    setPerms(next);
    saveToggle(key, next);
  };

  // ─── 프리뷰 텍스트 ───
  const previewOf = (key: ToggleKey) => {
    const v = perms[key];
    if (v === 'all') return t('permissions.preview_all', { total: stats.total });
    return t('permissions.preview_pm', { pm: stats.pmTotal });
  };

  // ─── 카드 정의 ───
  const cards = useMemo(() => ([
    { key: 'financial' as const, Icon: IconFinancial, tone: '#0EA5A4' },
    { key: 'schedule' as const, Icon: IconSchedule, tone: '#6366F1' },
    { key: 'client_info' as const, Icon: IconClientInfo, tone: '#F43F5E' },
  ]), []);

  return (
    <Wrap>
      <Header>
        <Title>{t('permissions.title')}</Title>
        <Subtitle>{t('permissions.subtitle')}</Subtitle>
        {!isOwner && (
          <OwnerHint>
            <IconCheck /> {t('permissions.owner_only_hint')}
          </OwnerHint>
        )}
      </Header>

      <Grid>
        {cards.map(({ key, Icon, tone }) => (
          <Card key={key} $disabled={!isOwner}>
            <CardHeader>
              <IconCircle $tone={tone}><Icon /></IconCircle>
              <div>
                <CardTitle>{t(`permissions.${key}.title`)}</CardTitle>
                <CardDesc>{t(`permissions.${key}.desc`)}</CardDesc>
              </div>
              <SaveBadge $state={saveState[key]}>
                {saveState[key] === 'saving' && <span>{t('permissions.saving')}</span>}
                {saveState[key] === 'saved' && <><IconCheck /><span>{t('permissions.saved')}</span></>}
                {saveState[key] === 'error' && <span>!</span>}
              </SaveBadge>
            </CardHeader>

            <Options>
              <Option
                $selected={perms[key] === 'all'}
                $disabled={!isOwner}
                onClick={() => handleChange(key, 'all')}
                title={!isOwner ? (t('permissions.owner_only_hint') as string) : undefined}
              >
                <Radio $selected={perms[key] === 'all'} />
                <OptionBody>
                  <OptionLabel>
                    {t('permissions.option_all')}
                    <RecommendBadge>{t('permissions.option_all_badge')}</RecommendBadge>
                  </OptionLabel>
                </OptionBody>
              </Option>

              <Option
                $selected={perms[key] === 'pm'}
                $disabled={!isOwner}
                onClick={() => handleChange(key, 'pm')}
                title={!isOwner ? (t('permissions.owner_only_hint') as string) : undefined}
              >
                <Radio $selected={perms[key] === 'pm'} />
                <OptionBody>
                  <OptionLabel>{t('permissions.option_pm')}</OptionLabel>
                </OptionBody>
              </Option>
            </Options>

            <Preview $tone={tone}>
              <PreviewDot $tone={tone} />
              {loaded ? previewOf(key) : t('permissions.loading')}
            </Preview>
          </Card>
        ))}
      </Grid>
    </Wrap>
  );
};

export default PermissionsSettings;

// ───────────────────────────────────────────────────────────
// Styles
// ───────────────────────────────────────────────────────────
const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 20px;
`;
const Header = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;
const Title = styled.h2`
  font-size: 18px; font-weight: 700; color: #0F172A; margin: 0;
`;
const Subtitle = styled.p`
  font-size: 13px; color: #64748B; margin: 0; line-height: 1.6;
`;
const OwnerHint = styled.div`
  margin-top: 8px;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 12px;
  background: #FEF3C7; border: 1px solid #FDE68A; color: #92400E;
  border-radius: 8px; font-size: 12px; font-weight: 500;
  width: fit-content;
  svg { color: #B45309; }
`;
const Grid = styled.div`
  display: grid; grid-template-columns: 1fr; gap: 16px;
`;
const Card = styled.div<{ $disabled: boolean }>`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 20px; display: flex; flex-direction: column; gap: 16px;
  transition: opacity 0.2s;
  ${p => p.$disabled && css`opacity: 0.82;`}
`;
const CardHeader = styled.div`
  display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: flex-start;
`;
const IconCircle = styled.div<{ $tone: string }>`
  width: 40px; height: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: ${p => p.$tone}14;
  color: ${p => p.$tone};
  flex-shrink: 0;
`;
const CardTitle = styled.div`
  font-size: 15px; font-weight: 600; color: #0F172A; margin-bottom: 2px;
`;
const CardDesc = styled.div`
  font-size: 12px; color: #64748B; line-height: 1.5;
`;
const fadeOut = keyframes`
  from { opacity: 1; }
  to { opacity: 0; }
`;
const SaveBadge = styled.div<{ $state: 'idle' | 'saving' | 'saved' | 'error' }>`
  display: flex; align-items: center; gap: 4px;
  height: 22px; padding: 0 8px; border-radius: 999px;
  font-size: 11px; font-weight: 500;
  ${p => p.$state === 'idle' && css`display: none;`}
  ${p => p.$state === 'saving' && css`background: #F1F5F9; color: #64748B;`}
  ${p => p.$state === 'saved' && css`
    background: #ECFDF5; color: #059669;
    animation: ${fadeOut} 0.3s ease-out 1.7s forwards;
  `}
  ${p => p.$state === 'error' && css`background: #FEF2F2; color: #B91C1C;`}
`;
const Options = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  @media (max-width: 560px) { grid-template-columns: 1fr; }
`;
const Option = styled.button<{ $selected: boolean; $disabled: boolean }>`
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-radius: 10px;
  background: ${p => p.$selected ? '#F0FDFA' : '#F8FAFC'};
  border: 1.5px solid ${p => p.$selected ? '#14B8A6' : '#E2E8F0'};
  cursor: ${p => p.$disabled ? 'not-allowed' : 'pointer'};
  text-align: left;
  transition: background 0.15s, border-color 0.15s;
  ${p => !p.$disabled && css`
    &:hover { background: ${p.$selected ? '#F0FDFA' : '#F1F5F9'}; }
  `}
`;
const Radio = styled.span<{ $selected: boolean }>`
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid ${p => p.$selected ? '#14B8A6' : '#CBD5E1'};
  background: #fff;
  position: relative; flex-shrink: 0;
  ${p => p.$selected && css`
    &::after {
      content: ''; position: absolute; inset: 3px;
      border-radius: 50%; background: #14B8A6;
    }
  `}
`;
const OptionBody = styled.div` flex: 1; min-width: 0; `;
const OptionLabel = styled.div`
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 500; color: #0F172A;
`;
const RecommendBadge = styled.span`
  display: inline-flex; align-items: center;
  height: 18px; padding: 0 6px; border-radius: 4px;
  background: #F0FDFA; color: #0F766E;
  font-size: 10px; font-weight: 600;
`;
const Preview = styled.div<{ $tone: string }>`
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: 8px;
  background: ${p => p.$tone}0A;
  font-size: 12px; color: #475569;
  line-height: 1.5;
`;
const PreviewDot = styled.span<{ $tone: string }>`
  width: 6px; height: 6px; border-radius: 50%;
  background: ${p => p.$tone}; flex-shrink: 0;
`;
