// 파일 메타 편집 (이름 · 설명 · 태그) — 저장 버튼 없이 자동저장.
// 파일명은 검색의 1차 열쇠다. 잘못 올라온 이름을 고칠 수 없으면 그 자료는 영영 못 찾는다.
import React, { useCallback, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AutoSaveField, { type AutoSaveHandle } from '../../../components/Common/AutoSaveField';
import { updateFileMeta, type ProjectFile } from '../../../services/files';

export const FileMetaEditor: React.FC<{
  businessId: number;
  file: ProjectFile;
  onSaved: (m: { file_name: string; description: string | null; tags: string[] }) => void;
}> = ({ businessId, file, onSaved }) => {
  const { t } = useTranslation('qproject');
  const [name, setName] = useState(file.file_name);
  const [desc, setDesc] = useState(file.description || '');
  const [tags, setTags] = useState<string[]>(file.tags || []);
  const [tagDraft, setTagDraft] = useState('');
  const tagSaveRef = useRef<AutoSaveHandle>(null);

  const save = useCallback(async (patch: { file_name?: string; description?: string | null; tags?: string[] }) => {
    const m = await updateFileMeta(businessId, file.id, patch);
    if (!m) throw new Error('save_failed');   // AutoSaveField 가 ! 뱃지를 띄운다
    setName(m.file_name);
    onSaved(m);
  }, [businessId, file.id, onSaved]);

  const commitTags = useCallback((next: string[]) => {
    setTags(next);
    tagSaveRef.current?.triggerSave();
  }, []);

  const addTagFromDraft = useCallback(() => {
    const v = tagDraft.trim().replace(/\s+/g, ' ');
    setTagDraft('');
    if (!v) return;
    if (tags.some(x => x.toLowerCase() === v.toLowerCase())) return;
    if (tags.length >= 20) return;
    commitTags([...tags, v]);
  }, [tagDraft, tags, commitTags]);

  return (
    <MetaEditWrap>
      <MetaEditRow>
        <SectionLabel>{t('docs.meta.name', '파일명')}</SectionLabel>
        <AutoSaveField onSave={() => save({ file_name: name })}>
          <MetaInput value={name} maxLength={255}
            onChange={e => setName(e.target.value)}
            aria-label={t('docs.meta.name', '파일명') as string} />
        </AutoSaveField>
        <MetaHint>{t('docs.meta.nameHint', '확장자는 유지됩니다')}</MetaHint>
      </MetaEditRow>

      <MetaEditRow>
        <SectionLabel>{t('docs.meta.desc', '설명')}</SectionLabel>
        <AutoSaveField onSave={() => save({ description: desc.trim() || null })}>
          <MetaTextarea value={desc} rows={2} maxLength={500}
            placeholder={t('docs.meta.descPh', '이 파일이 무엇인지 한 줄로') as string}
            onChange={e => setDesc(e.target.value)}
            aria-label={t('docs.meta.desc', '설명') as string} />
        </AutoSaveField>
      </MetaEditRow>

      <MetaEditRow>
        <SectionLabel>{t('docs.meta.tags', '태그')}</SectionLabel>
        <AutoSaveField ref={tagSaveRef} type="list" onSave={() => save({ tags })}>
          <TagBox>
            {tags.map(tg => (
              <TagChip key={tg}>
                {tg}
                <TagX type="button" onClick={() => commitTags(tags.filter(x => x !== tg))}
                  aria-label={t('docs.meta.tagRemove', '태그 삭제') as string}>&#215;</TagX>
              </TagChip>
            ))}
            <TagInput value={tagDraft} maxLength={40}
              placeholder={tags.length === 0 ? (t('docs.meta.tagsPh', '태그 입력 후 Enter') as string) : ''}
              onChange={e => {
                const v = e.target.value;
                if (v.includes(',')) { setTagDraft(v.replace(/,/g, '')); setTimeout(addTagFromDraft, 0); return; }
                setTagDraft(v);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); addTagFromDraft(); }
                else if (e.key === 'Backspace' && !tagDraft && tags.length) commitTags(tags.slice(0, -1));
              }}
              onBlur={addTagFromDraft}
              aria-label={t('docs.meta.tags', '태그') as string} />
          </TagBox>
        </AutoSaveField>
      </MetaEditRow>
    </MetaEditWrap>
  );
};

// ─── 프리뷰 ───

const MetaEditWrap = styled.div`
  display:flex;flex-direction:column;gap:14px;margin-top:14px;
  padding:14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;
`;
const MetaEditRow = styled.div`display:flex;flex-direction:column;gap:6px;`;
const MetaInput = styled.input`
  width:100%;height:2.5rem;padding:0 32px 0 12px;box-sizing:border-box;
  background:#fff;border:1px solid #CBD5E1;border-radius:8px;
  font-size:13.5px;color:#0F172A;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,.15);}
`;
const MetaTextarea = styled.textarea`
  width:100%;padding:9px 32px 9px 12px;box-sizing:border-box;resize:vertical;
  background:#fff;border:1px solid #CBD5E1;border-radius:8px;
  font-size:13.5px;line-height:1.5;color:#0F172A;font-family:inherit;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,.15);}
`;
const MetaHint = styled.div`font-size:12px;color:#94A3B8;`;
const TagBox = styled.div`
  display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:2.5rem;
  padding:6px 8px;box-sizing:border-box;
  background:#fff;border:1px solid #CBD5E1;border-radius:8px;
  &:focus-within{border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,.15);}
`;
const TagChip = styled.span`
  display:inline-flex;align-items:center;gap:4px;min-height:1.625rem;padding:2px 4px 2px 10px;
  background:#CCFBF1;color:#0F766E;border-radius:999px;font-size:12.5px;font-weight:600;
`;
const TagX = styled.button`
  display:inline-flex;align-items:center;justify-content:center;
  width:1.125rem;height:1.125rem;padding:0;background:transparent;border:none;border-radius:50%;
  color:#0F766E;font-size:15px;line-height:1;cursor:pointer;
  &:hover{background:rgba(15,118,110,.15);}
`;
const TagInput = styled.input`
  flex:1;min-width:100px;height:1.625rem;border:none;outline:none;background:transparent;
  font-size:13px;color:#0F172A;
`;
const SectionLabel = styled.div`font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;`;

export default FileMetaEditor;
