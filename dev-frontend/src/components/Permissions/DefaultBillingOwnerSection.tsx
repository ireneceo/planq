// DefaultBillingOwnerSection — 기본 청구 담당 (사이클 N+21)
// Q Bill write 권한자만 후보. 새 청구서 발행 시 자동 pre-fill.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import { listBillingOwnerCandidates, setDefaultBillingOwner, type BillingOwnerCandidate } from '../../services/permissions';
import { apiFetch } from '../../contexts/AuthContext';

interface Props { businessId: number; isOwner: boolean; refreshKey?: number; }

const DefaultBillingOwnerSection: React.FC<Props> = ({ businessId, isOwner, refreshKey }) => {
  const { t } = useTranslation('settings');
  const [candidates, setCandidates] = useState<BillingOwnerCandidate[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, biz] = await Promise.all([
        listBillingOwnerCandidates(businessId),
        apiFetch(`/api/businesses/${businessId}`).then(r => r.json()).then(r => r?.data || null),
      ]);
      setCandidates(c);
      setCurrent(biz?.default_billing_owner_id ?? null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const onChange = async (uid: number | null) => {
    try {
      await setDefaultBillingOwner(businessId, uid);
      setCurrent(uid);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) { setError((e as Error).message); }
  };

  if (loading) return <Card><Empty>{t('billing.loading', 'Loading...')}</Empty></Card>;

  const opts: PlanQSelectOption[] = [
    { value: '', label: t('billing.noneOption', '지정 안 함') as string },
    ...candidates.map(c => ({
      value: String(c.user_id),
      label: `${c.name}${c.role === 'owner' ? ' · ' + (t('role.owner') as string) : c.role === 'admin' ? ' · ' + (t('role.admin') as string) : ''}`,
    })),
  ];
  const currentOpt = opts.find(o => String(o.value) === String(current ?? '')) || opts[0];

  return (
    <Card>
      <Header>
        <Title>{t('billing.title')}</Title>
        <Desc>{t('billing.desc')}</Desc>
      </Header>
      {error && <ErrorMsg>{error}</ErrorMsg>}
      <Row>
        <Label>{t('billing.label')}</Label>
        <Selector>
          <PlanQSelect
            size="sm"
            isDisabled={!isOwner}
            value={currentOpt}
            options={opts}
            onChange={(opt) => {
              const v = (opt as PlanQSelectOption)?.value;
              onChange(v ? Number(v) : null);
            }}
          />
          {saved && <SavedChip>✓ {t('common.saved', '저장됨')}</SavedChip>}
        </Selector>
      </Row>
      <Hint>{t('billing.hint', { count: candidates.length, defaultValue: 'Q Bill 쓰기 권한자 {{count}}명 중 선택. 새 청구서 발행 시 자동 owner 로 지정됩니다.' })}</Hint>
    </Card>
  );
};

export default DefaultBillingOwnerSection;

const Card = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 20px 24px; margin-top: 16px;
`;
const Header = styled.div` margin-bottom: 12px; `;
const Title = styled.h3` margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #0F172A; `;
const Desc = styled.p` margin: 0; font-size: 13px; color: #64748B; line-height: 1.5; `;
const Row = styled.div`
  display: flex; align-items: center; gap: 14px;
  @media (max-width: 640px) { flex-direction: column; align-items: stretch; gap: 8px; }
`;
const Label = styled.div` font-size: 13px; font-weight: 600; color: #475569; min-width: 140px; `;
const Selector = styled.div` flex: 1; max-width: 320px; display: inline-flex; align-items: center; gap: 10px; `;
const SavedChip = styled.span` font-size: 11px; color: #0F766E; font-weight: 600; `;
const Hint = styled.div`
  font-size: 12px; color: #64748B; margin-top: 8px; padding-left: 154px;
  @media (max-width: 640px) { padding-left: 0; }
`;
const ErrorMsg = styled.div`
  background: #FEE2E2; color: #B91C1C; padding: 8px 12px;
  border-radius: 8px; font-size: 12px; margin-bottom: 10px;
`;
const Empty = styled.div` padding: 20px; text-align: center; color: #94A3B8; font-size: 13px; `;
