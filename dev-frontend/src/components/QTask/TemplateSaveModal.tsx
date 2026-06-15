// 현재 프로젝트 → 템플릿 저장 모달 (사이클 N+1 Phase 3)
// 디자인: /docs PostAiModal 패턴 1:1 동일.
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ModalActionButton from '../Common/ModalActionButton';
import { apiFetch } from '../../contexts/AuthContext';
import { mapApiError } from '../../utils/apiError';

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  projectId: number;
  projectName: string;
  onSaved: (templateId: number) => void;
}

export default function TemplateSaveModal({ open, onClose, businessId, projectId, projectName, onSaved }: Props) {
  const { t } = useTranslation('qtask');
  const { t: tErr } = useTranslation('errors');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingCats, setExistingCats] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setName(projectName ? t('templateSave.defaultName', { defaultValue: '{{name}} 템플릿', name: projectName }) : '');
      setDescription('');
      setCategory('');
      setError(null);
      setSubmitting(false);
      // 워크스페이스의 기존 카테고리 fetch (자동완성용)
      apiFetch(`/api/task-templates?business_id=${businessId}`)
        .then(r => r.json())
        .then(j => {
          if (j.success) {
            const set = new Set<string>();
            (j.data || []).forEach((t: { category?: string }) => { if (t.category) set.add(t.category); });
            setExistingCats(Array.from(set).sort());
          }
        }).catch(() => null);
    }
  }, [open, projectName, businessId]);

  if (!open) return null;

  const submit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/task-templates/from-project/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      onSaved(j.data?.id);
      onClose();
    } catch (e) {
      setError(mapApiError(e, tErr));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Backdrop onClick={onClose}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('tplSave.title', '템플릿으로 저장') as string}>
        <Header>
          <Title>{t('tplSave.title', '템플릿으로 저장')}</Title>
          <CloseBtn type="button" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </CloseBtn>
        </Header>
        <Body>
          <Hint>{t('tplSave.hint', '현재 프로젝트의 업무 일정 (시작·마감 날짜 있는 것만) 을 템플릿으로 저장합니다. 시작일은 가장 빠른 업무 기준으로 자동 변환됩니다.')}</Hint>
          <FieldRow>
            <FieldLabel>{t('tplSave.name', '템플릿 이름')} *</FieldLabel>
            <FieldInput
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder={t('tplSave.namePh', '예: WordPress 사이트 표준 흐름') as string}
              maxLength={200}
            />
          </FieldRow>
          <FieldRow>
            <FieldLabel>{t('tplSave.desc', '설명 (선택)')}</FieldLabel>
            <FieldTextarea
              rows={3} value={description} onChange={e => setDescription(e.target.value)}
              placeholder={t('tplSave.descPh', '어떤 상황에서 이 템플릿을 쓰는지 간단히 설명') as string}
            />
          </FieldRow>
          <FieldRow>
            <FieldLabel>{t('tplSave.category', '카테고리 (선택)')}</FieldLabel>
            <FieldInput
              type="text"
              list="tpl-save-category-list"
              value={category}
              onChange={e => setCategory(e.target.value)}
              placeholder={t('tplSave.categoryPh', '예: 웹 개발, 마케팅, 교육 사업 (자유 입력)') as string}
              maxLength={50}
            />
            <datalist id="tpl-save-category-list">
              {existingCats.map(c => <option key={c} value={c} />)}
            </datalist>
            <Hint>{t('tplSave.categoryHint', '같은 카테고리끼리 자동으로 그룹됩니다. 새 카테고리를 입력하면 새 그룹이 만들어져요.')}</Hint>
          </FieldRow>
          {error && <ErrorMsg>{error}</ErrorMsg>}
        </Body>
        <Footer>
          <ModalActionButton variant="secondary" onClick={onClose}>{t('tplSave.cancel', '취소')}</ModalActionButton>
          <ModalActionButton variant="primary" onClick={submit} disabled={!name.trim() || submitting}>
            {submitting ? t('tplSave.saving', '저장 중...') : t('tplSave.save', '저장')}
          </ModalActionButton>
        </Footer>
      </Dialog>
    </Backdrop>
  );
}

const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 20px;
  @media (max-width: 640px) { padding: 0; align-items: stretch; }
`;
const Dialog = styled.div`
  background: #fff; border-radius: 14px;
  width: 100%; max-width: 560px; max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  @media (max-width: 640px) {
    max-width: none; max-height: none; border-radius: 0;
    margin-top: 60px; height: calc(100vh - 60px); height: calc(100dvh - 60px);
  }
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px 14px; border-bottom: 1px solid #F1F5F9;
  flex-shrink: 0;
`;
const Title = styled.h2`font-size: 16px; font-weight: 700; color: #0F172A; margin: 0;`;
const CloseBtn = styled.button`
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px;
  color: #64748B; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`
  padding: 16px 22px 12px;
  flex: 1; overflow-y: auto; min-height: 0;
  display: flex; flex-direction: column; gap: 14px;
`;
const Footer = styled.div`
  display: flex; justify-content: flex-end; gap: 6px;
  padding: 12px 22px 18px;
  flex-shrink: 0;
  border-top: 1px solid #F1F5F9; background: #fff;
`;
const FieldRow = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const FieldLabel = styled.label`font-size: 12px; font-weight: 600; color: #0F172A;`;
const FieldInput = styled.input`
  width: 100%; padding: 8px 10px; font-size: 13px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFF;
  &:focus { outline: none; border-color: #14B8A6; }
  &::placeholder { color: #CBD5E1; }
`;
const FieldTextarea = styled.textarea`
  width: 100%; padding: 8px 10px; font-size: 13px; color: #0F172A; line-height: 1.5;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFF; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; }
  &::placeholder { color: #CBD5E1; }
`;
const Hint = styled.div`
  padding: 10px 12px; background: #F8FAFC; color: #475569;
  border-radius: 6px; font-size: 12px; line-height: 1.5;
`;
const ErrorMsg = styled.div`font-size: 12px; color: #DC2626; background: #FEF2F2; padding: 8px 10px; border-radius: 6px;`;
