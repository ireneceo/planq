// TagPicker — 업무 태그 선택 + 새 태그 만들기 (#250 ③청크).
//
//   태그는 **사전에서 고른다**(자유 입력 아님) — 오타로 '긴급'/'긴급 '/'긴근' 이 갈라지면
//   필터도 나열도 무의미해진다. 대신 사전에 없으면 여기서 바로 만들 수 있게 해야 한다.
//   만들 경로가 없으면 기능이 통째로 죽는다("완료인데 죽어있던 기능" 계열 회귀).
//
//   ★ 2026-08-19 — "새 태그" 를 **입력창 안에서** 만든다. 옛 방식은 셀렉트 아래 별도 링크와
//     별도 입력줄이라 사용자가 두 곳을 오갔고 세로로도 길어졌다
//     (Irene: "새태그는 왜 만들기 따로 나와? 문서 카테고리처럼 나와야 하는 거 아니야?").
//     문서 카테고리와 같은 감각 — 치면 후보가 좁혀지고, 없으면 '만들기' 항목이 그 자리에 뜬다.
//
//   TaskDetailDrawer(2,5xx줄) 안에 인라인으로 넣지 않고 분리한 이유는 god-file 래칫 +
//   다른 표면(향후 업무 추가 폼 등)에서 그대로 재사용하기 위함이다.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect from '../Common/PlanQSelect';
import { apiFetch } from '../../contexts/AuthContext';
import type { TaskTagLite } from './TagChips';

interface Props {
  bizId: number | null;
  /** 워크스페이스 태그 사전 */
  dict: TaskTagLite[];
  /** 이 업무에 붙은 태그 */
  value: TaskTagLite[];
  disabled?: boolean;
  /** 선택 변경 — tag_ids 를 저장한다 */
  onChange: (tagIds: number[]) => void;
  /** 사전이 늘어났을 때(새 태그 생성) 호출측 사전 갱신 */
  onDictAdd: (tag: TaskTagLite) => void;
}

const TagPicker: React.FC<Props> = ({ bizId, dict, value, disabled, onChange, onDictAdd }) => {
  const { t } = useTranslation('qtask');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async (raw?: string) => {
    const name = String(raw ?? draft).trim().slice(0, 30);
    if (!name || busy || !bizId) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch('/api/tasks/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: bizId, name }),
      });
      const j = await r.json().catch(() => null);
      // apiFetch 는 throw 하지 않는다 — res.ok 를 반드시 본다.
      //   중복(409)·상한(400) 은 사용자에게 그대로 보여야 한다(조용한 실패 금지).
      if (!r.ok || !j?.success) { setErr(j?.message || (t('tags.createFailed', '태그를 만들지 못했습니다') as string)); return; }
      const tag = j.data as TaskTagLite;
      onDictAdd(tag);
      onChange([...value.map(v => v.id), tag.id]);   // 만들자마자 이 업무에 붙인다
      setDraft('');
    } finally { setBusy(false); }
  };

  return (
    <>
      <PlanQSelect size="sm" isMulti isClearable isSearchable
        creatable
        isDisabled={disabled || busy}
        isLoading={busy}
        placeholder={t('detail.meta.tagsPh', '태그 선택') as string}
        value={value.map(tg => ({ value: String(tg.id), label: tg.name }))}
        onChange={(v) => {
          const arr = (Array.isArray(v) ? v : []) as Array<{ value: string }>;
          // 만들기로 생긴 임시 항목은 create() 가 서버 id 로 바꿔 넣는다 — 여기서는 숫자 id 만 넘긴다.
          onChange(arr.map(o => Number(o.value)).filter(n => Number.isFinite(n)));
        }}
        onCreateOption={(input: string) => { setDraft(input); void create(input); }}
        formatCreateLabel={(input: string) => t('tags.createNamed', { defaultValue: '\'{{name}}\' 태그 만들기', name: input }) as string}
        options={dict.map(g => ({ value: String(g.id), label: g.name }))} />
      {err && <ErrText role="alert">{err}</ErrText>}
    </>
  );
};

export default TagPicker;

const ErrText = styled.div`
  margin-top: 4px; font-size: 0.6875rem; color: #DC2626;
`;
