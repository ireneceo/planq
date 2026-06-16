// 운영 #54 — Q Note 세션 분류/태그 편집 바 (메모·음성 공통).
//   클릭하여 분류 입력, 태그 칩 추가/삭제. 변경 시 updateSession 즉시 저장(자동저장 패턴).
//   소유자만 편집 가능, 비소유자는 읽기 전용 배지.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { updateSession } from '../../services/qnote';

interface Props {
  sessionId: number;
  category: string | null;
  tags: string[] | null;
  editable: boolean;
  onChange?: (patch: { category?: string | null; tags?: string[] }) => void;
}

const SessionTaxonomyBar: React.FC<Props> = ({ sessionId, category, tags, editable, onChange }) => {
  const { t } = useTranslation('qnote');
  const [editingCat, setEditingCat] = useState(false);
  const [catDraft, setCatDraft] = useState(category || '');
  const [tagDraft, setTagDraft] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const list = tags || [];

  const saveCategory = async (val: string) => {
    const next = val.trim() || null;
    setEditingCat(false);
    if (next === (category || null)) return;
    onChange?.({ category: next });
    try { await updateSession(sessionId, { category: next }); } catch { /* 인라인 자동저장 — 조용히 */ }
  };

  const commitTags = async (next: string[]) => {
    onChange?.({ tags: next });
    try { await updateSession(sessionId, { tags: next }); } catch { /* noop */ }
  };
  const addTag = async () => {
    const v = tagDraft.trim();
    setTagDraft(''); setAddingTag(false);
    if (!v || v.length > 40 || list.some((x) => x.toLowerCase() === v.toLowerCase()) || list.length >= 20) return;
    await commitTags([...list, v]);
  };
  const removeTag = async (tg: string) => { await commitTags(list.filter((x) => x !== tg)); };

  if (!editable && !category && list.length === 0) return null;

  return (
    <Bar>
      {/* 분류 */}
      {editingCat ? (
        <CatInput
          autoFocus value={catDraft}
          placeholder={t('taxonomy.categoryPh', { defaultValue: '분류' }) as string}
          onChange={(e) => setCatDraft(e.target.value)}
          onBlur={(e) => saveCategory(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') saveCategory((e.target as HTMLInputElement).value); if (e.key === 'Escape') { setCatDraft(category || ''); setEditingCat(false); } }}
        />
      ) : category ? (
        <CatChip $clickable={editable} onClick={() => editable && setEditingCat(true)}>{category}</CatChip>
      ) : editable ? (
        <AddBtn type="button" onClick={() => { setCatDraft(''); setEditingCat(true); }}>
          + {t('taxonomy.addCategory', { defaultValue: '분류' }) as string}
        </AddBtn>
      ) : null}

      {/* 태그 */}
      {list.map((tg) => (
        <Tag key={tg}>
          #{tg}
          {editable && <TagX type="button" onClick={() => removeTag(tg)} aria-label={t('taxonomy.removeTag', { defaultValue: '태그 삭제' }) as string}>×</TagX>}
        </Tag>
      ))}
      {editable && (addingTag ? (
        <TagInput
          autoFocus value={tagDraft}
          placeholder={t('taxonomy.tagPh', { defaultValue: '태그' }) as string}
          onChange={(e) => setTagDraft(e.target.value)}
          onBlur={addTag}
          onKeyDown={(e) => { if (e.key === 'Enter') addTag(); if (e.key === 'Escape') { setTagDraft(''); setAddingTag(false); } }}
        />
      ) : list.length < 20 && (
        <AddBtn type="button" onClick={() => setAddingTag(true)}>+ {t('taxonomy.addTag', { defaultValue: '태그' }) as string}</AddBtn>
      ))}
    </Bar>
  );
};

export default SessionTaxonomyBar;

const Bar = styled.div`display: flex; align-items: center; flex-wrap: wrap; gap: 6px;`;
const CatChip = styled.span<{ $clickable: boolean }>`
  font-size: 11px; font-weight: 700; color: #0F766E; background: #F0FDFA;
  border-radius: 999px; padding: 3px 10px; cursor: ${p => p.$clickable ? 'pointer' : 'default'};
`;
const Tag = styled.span`
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; font-weight: 500; color: #475569; background: #F1F5F9;
  border-radius: 999px; padding: 3px 8px;
`;
const TagX = styled.button`
  border: none; background: none; cursor: pointer; color: #94A3B8; font-size: 13px;
  line-height: 1; padding: 0; &:hover { color: #DC2626; }
`;
const AddBtn = styled.button`
  border: 1px dashed #CBD5E1; background: none; cursor: pointer;
  font-size: 11px; font-weight: 600; color: #64748B; border-radius: 999px; padding: 3px 10px;
  &:hover { border-color: #14B8A6; color: #0F766E; }
`;
const CatInput = styled.input`
  font-size: 11px; padding: 3px 8px; border: 1px solid #14B8A6; border-radius: 999px;
  outline: none; width: 100px;
`;
const TagInput = styled.input`
  font-size: 11px; padding: 3px 8px; border: 1px solid #14B8A6; border-radius: 999px;
  outline: none; width: 80px;
`;
