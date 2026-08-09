// TagPicker — 업무 태그 선택 + 새 태그 만들기 (#250 ③청크).
//
//   태그는 **사전에서 고른다**(자유 입력 아님) — 오타로 '긴급'/'긴급 '/'긴근' 이 갈라지면
//   필터도 나열도 무의미해진다. 대신 사전에 없으면 여기서 바로 만들 수 있게 해야 한다.
//   만들 경로가 없으면 기능이 통째로 죽는다("완료인데 죽어있던 기능" 계열 회귀).
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
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    const name = draft.trim();
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
      setDraft(''); setCreating(false);
    } finally { setBusy(false); }
  };

  return (
    <>
      <PlanQSelect size="sm" isMulti isClearable isSearchable
        isDisabled={disabled}
        placeholder={t('detail.meta.tagsPh', '태그 선택') as string}
        value={value.map(tg => ({ value: String(tg.id), label: tg.name }))}
        onChange={(v) => {
          const arr = (Array.isArray(v) ? v : []) as Array<{ value: string }>;
          onChange(arr.map(o => Number(o.value)));
        }}
        options={dict.map(g => ({ value: String(g.id), label: g.name }))} />
      {!disabled && (creating ? (
        <CreateRow>
          <CreateInput
            autoFocus
            value={draft}
            maxLength={30}
            placeholder={t('tags.newPh', '새 태그 이름') as string}
            onChange={(e) => { setDraft(e.target.value); setErr(null); }}
            /* Enter 단독 저장 허용 — 한 줄 입력이라 UI_DESIGN_GUIDE §1.8 의 "본문 폼" 제약 대상이 아니다 */
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); create(); }
              if (e.key === 'Escape') { setCreating(false); setDraft(''); setErr(null); }
            }} />
          <CreateBtn type="button" disabled={busy || !draft.trim()} onClick={create}>
            {busy ? t('tags.creating', '만드는 중…') : t('tags.create', '만들기')}
          </CreateBtn>
        </CreateRow>
      ) : (
        <AddLink type="button" onClick={() => setCreating(true)}>
          + {t('tags.new', '새 태그')}
        </AddLink>
      ))}
      {err && <ErrText role="alert">{err}</ErrText>}
    </>
  );
};

export default TagPicker;

const CreateRow = styled.div`
  display: flex; align-items: center; gap: 6px; margin-top: 6px;
`;
const CreateInput = styled.input`
  flex: 1; min-width: 0; height: 30px; padding: 0 8px;
  border: 1px solid #E2E8F0; border-radius: 6px; font-size: 12px; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
const CreateBtn = styled.button`
  flex-shrink: 0; height: 30px; padding: 0 10px;
  border: 0; border-radius: 6px; background: #14B8A6; color: #fff;
  font-size: 12px; font-weight: 700; cursor: pointer;
  &:disabled { background: #CBD5E1; cursor: default; }
`;
const AddLink = styled.button`
  margin-top: 6px; padding: 0; border: 0; background: transparent;
  font-size: 11px; font-weight: 600; color: #0F766E; cursor: pointer;
  &:hover { text-decoration: underline; }
`;
const ErrText = styled.div`
  margin-top: 4px; font-size: 11px; color: #DC2626;
`;
