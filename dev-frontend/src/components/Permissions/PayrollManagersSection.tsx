// 급여 담당자 지정 — 대표 외에 급여·계약을 보고 관리할 멤버(docs/PAYROLL_DESIGN.md §4).
//   ★ admin 역할이라도 여기 없으면 못 본다. 지정·해제는 대표만(서버 PUT /api/payroll/:biz/managers — owner_only).
//   급여 기능이 꺼져 있으면 섹션 자체를 그리지 않는다(서버도 404).
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import AutoSaveField from '../Common/AutoSaveField';
import PlanQSelect from '../Common/PlanQSelect';
import { payrollApi } from '../../pages/Payroll/payrollApi';

interface MemberRow { user_id: number; role: string; user?: { name?: string; display_name?: string | null } | null }
interface Opt { value: string; label: string }

export default function PayrollManagersSection({ businessId }: { businessId: number }) {
  const { t } = useTranslation('payroll');
  const { user } = useAuth();
  const isOwner = user?.business_role === 'owner';
  const moduleOn = !!user?.modules?.payroll;
  const [options, setOptions] = useState<Opt[]>([]);
  const [selected, setSelected] = useState<Opt[]>([]);
  const ref = useRef<number[]>([]);

  const load = useCallback(async () => {
    try {
      const [mr, cur] = await Promise.all([
        apiFetch(`/api/businesses/${businessId}/members`).then((r) => r.json()),
        payrollApi.managers(businessId),
      ]);
      const opts: Opt[] = ((mr?.data || []) as MemberRow[])
        .filter((m) => m.role === 'member' || m.role === 'admin')   // 대표는 늘 볼 수 있다 — 고를 필요 없음
        .map((m) => ({ value: String(m.user_id), label: m.user?.display_name || m.user?.name || String(m.user_id) }));
      setOptions(opts);
      const sel = opts.filter((o) => cur.manager_user_ids.includes(Number(o.value)));
      setSelected(sel); ref.current = sel.map((o) => Number(o.value));
    } catch { /* 섹션은 빈 채로 — 서버가 403/404 면 관리자가 아니거나 기능이 꺼진 것 */ }
  }, [businessId]);
  useEffect(() => { if (moduleOn) load(); }, [moduleOn, load]);

  if (!moduleOn) return null;
  return (
    <Card data-testid="payroll-managers-section">
      <Title>{t('managers.title')}</Title>
      <Desc>{t('managers.desc')}</Desc>
      <AutoSaveField key={`payroll-managers-${businessId}`} type="select"
        onSave={async () => { await payrollApi.setManagers(businessId, ref.current); }}>
        <PlanQSelect<true> size="sm" isMulti isDisabled={!isOwner} placeholder={t('managers.placeholder') as string}
          value={selected} options={options}
          onChange={(v) => { const arr = (v as readonly Opt[]) || []; setSelected([...arr]); ref.current = arr.map((o) => Number(o.value)); }} />
      </AutoSaveField>
      {!isOwner && <Hint>{t('managers.ownerOnly')}</Hint>}
    </Card>
  );
}

const Card = styled.div`background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 20px 24px; margin-top: 16px;`;
const Title = styled.h3`margin: 0 0 4px; font-size: 1rem; font-weight: 700; color: #0F172A;`;
const Desc = styled.p`margin: 0 0 12px; font-size: 0.8125rem; color: #64748B; line-height: 1.5;`;
const Hint = styled.div`margin-top: 8px; font-size: 0.75rem; color: #94A3B8;`;
