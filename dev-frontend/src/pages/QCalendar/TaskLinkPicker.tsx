// 일정 «업무 연결» 고르기 (2026-10-07) — 등록 창 · 상세가 같은 부품을 쓴다.
//   ★ 새 API 를 만들지 않는다 — 관련 업무·전체 업무 찾기가 쓰는 /api/tasks/by-business/:biz/search 가
//     이미 권한 범위 안에서 찾는다. 저장할 때 서버가 같은 술어(canAccessTask)로 다시 본다.
//   둘째 줄에 프로젝트를 보여 준다 — 같은 제목 업무를 가르기 위해서다.
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { apiFetch } from '../../contexts/AuthContext';

interface Hit { id: number; title: string; Project?: { id: number; name: string } | null }
interface Props {
  businessId: number;
  value: { id: number; title?: string | null; hidden?: boolean } | null;
  onChange: (task: { id: number; title: string } | null) => void;
  disabled?: boolean;
}

const TaskLinkPicker: React.FC<Props> = ({ businessId, value, onChange, disabled }) => {
  const { t } = useTranslation('qcalendar');
  const [opts, setOpts] = useState<PlanQSelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const timer = useRef<number | null>(null);

  const search = (q: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const my = ++seq.current;
      setLoading(true);
      try {
        const r = await apiFetch(`/api/tasks/by-business/${businessId}/search?q=${encodeURIComponent(q.trim())}&limit=20`);
        const j = await r.json().catch(() => null);
        if (my !== seq.current) return;
        const hits: Hit[] = Array.isArray(j?.data) ? j.data : [];
        setOpts(hits.map((h) => ({ value: h.id, label: h.title, subline: h.Project?.name || undefined })));
      } finally { if (my === seq.current) setLoading(false); }
    }, 250);
  };
  useEffect(() => { search(''); return () => { if (timer.current) window.clearTimeout(timer.current); }; }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = value ? (value.hidden ? (t('taskLink.hidden', { defaultValue: '볼 수 없는 업무' }) as string) : (value.title || `#${value.id}`)) : '';
  return (
    <div data-testid="event-task-link">
    <PlanQSelect
      size="sm"
      isClearable
      isDisabled={disabled}
      isLoading={loading}
      placeholder={t('taskLink.placeholder', { defaultValue: '업무 검색해서 연결' }) as string}
      noOptionsMessage={() => t('taskLink.empty', { defaultValue: '찾는 업무가 없습니다' }) as string}
      options={opts}
      filterOption={() => true}
      value={value ? { value: value.id, label } : null}
      onInputChange={(v, meta) => { if (meta.action === 'input-change') search(v); }}
      onChange={(o) => {
        const opt = o as PlanQSelectOption | null;
        onChange(opt ? { id: Number(opt.value), title: String(opt.label) } : null);
      }}
    />
    </div>
  );
};

export default TaskLinkPicker;
