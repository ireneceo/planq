// 업무 참조자 고르기 — 업무 추가 폼(TaskCreateForm)·업무 상세(TaskDetailDrawer)가 같이 쓴다(2026-10-27).
//   Irene «컨펌은 아닌데 알아야 하거나 일부 도와줘야 하는 사람» · Fable 설계 판정.
//   · 후보는 **내부 멤버만**(고객·외부 파트너·AI(Cue) 제외) — 서버 addWatcher 가 같은 선으로 400 을 준다.
//     부모의 멤버 목록에는 Cue 가 섞여 있어(담당자 후보) 여기서 워크스페이스 멤버를 따로 읽어 역할로 거른다.
//   · 한 사람 한 역할 — 담당·작성·요청·컨펌자는 후보에서 뺀다(excludeIds · 서버 409 와 같은 규칙).
//   · 저장은 부모가 한다(onChange 로 다음 id 목록만 준다) — 상세는 차이만 POST/DELETE, 추가 폼은 만든 뒤 한 명씩.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PlanQSelect from '../Common/PlanQSelect';
import { apiFetch } from '../../contexts/AuthContext';

interface Candidate { user_id: number; name: string }

const cache = new Map<number, Candidate[]>();

interface Props {
  businessId: number | null;
  value: number[];
  /** 이 업무에 이미 이름 박힌 사람(담당·작성·요청·컨펌) — 후보에서 뺀다 */
  excludeIds?: Array<number | null | undefined>;
  /** 이미 고른 사람의 이름(서버가 표시명으로 준 것) — 후보 목록보다 먼저 쓴다 */
  names?: Record<number, string>;
  myId?: number | null;
  disabled?: boolean;
  variant?: 'box' | 'inline';
  placeholder?: string;
  onChange: (nextIds: number[]) => void;
}

export default function TaskWatcherSelect({ businessId, value, excludeIds = [], names = {}, myId, disabled, variant = 'box', placeholder, onChange }: Props) {
  const { t } = useTranslation('qtask');
  const [cands, setCands] = useState<Candidate[]>(() => (businessId ? cache.get(businessId) || [] : []));
  useEffect(() => {
    if (!businessId) return undefined;
    if (cache.has(businessId)) { setCands(cache.get(businessId) || []); return undefined; }
    let alive = true;
    (async () => {
      const r = await apiFetch(`/api/businesses/${businessId}/members`);
      if (!r.ok) return;
      const j = await r.json().catch(() => null);
      if (!j?.success) return;
      const list: Candidate[] = (j.data || [])
        .filter((m: { user_id: number | null; role?: string; user?: { is_ai?: boolean } }) =>
          m.user_id != null && ['owner', 'admin', 'member'].includes(m.role || '') && !m.user?.is_ai)
        .map((m: { user_id: number; name?: string | null; user?: { name?: string } }) => ({
          user_id: m.user_id, name: m.name || m.user?.name || `user ${m.user_id}`,
        }));
      cache.set(businessId, list);
      if (alive) setCands(list);
    })();
    return () => { alive = false; };
  }, [businessId]);

  const me = (id: number) => (id === myId ? t('detail.meSuffix', ' (나)') : '');
  const nameOf = (id: number) => names[id] || cands.find((c) => c.user_id === id)?.name || `user ${id}`;
  const excluded = new Set(excludeIds.filter((x): x is number => x != null).map(Number));
  return (
    <PlanQSelect<true> size="sm" variant={variant} isMulti isClearable={false} isSearchable
      isDisabled={disabled}
      placeholder={placeholder ?? (t('watchers.placeholder', '선택 — 알아야 하거나 일부 도울 사람') as string)}
      value={value.map((id) => ({ value: String(id), label: nameOf(id) + me(id) }))}
      onChange={(v) => onChange((v || []).map((o) => Number(o.value)))}
      options={cands.filter((c) => !excluded.has(c.user_id))
        .map((c) => ({ value: String(c.user_id), label: c.name + me(c.user_id) }))} />
  );
}
