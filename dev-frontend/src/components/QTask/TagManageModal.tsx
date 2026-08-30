// TagManageModal — 업무 태그 사전 관리(추가·이름 변경·삭제) (#250 ③청크, Fable 구현 게이트 F4)
//
//   왜 필요한가: 수정·삭제가 없으면 오타 태그를 지울 길이 없고, 워크스페이스 100개
//   상한과 결합해 사전이 쓰레기로 잠긴다. `PUT/DELETE /api/tasks/tags/:id` 는 그 전까지
//   호출자가 없는 **죽은 표면**이었다.
//
//   ★ 삭제는 백엔드가 CASCADE 다(태그는 레코드가 아니라 라벨). 대신 **몇 개 업무에서 제거되는지**를
//     반드시 보여준다 — 사용자가 결과를 모르고 지우면 안 된다.
//   ★ 확인은 **인라인 행**으로 한다. window.confirm 은 금지(CLAUDE.md)고, 모달 위에 모달을
//     띄우는 것도 금지다(팝업 안에 팝업).
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import { apiFetch } from '../../contexts/AuthContext';
import type { TaskTagLite } from './TagChips';

export interface TagDictEntry extends TaskTagLite {
  usage_count?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 새 태그를 만들 워크스페이스 */
  bizId: number | null;
  dict: TagDictEntry[];
  /** 사전이 바뀌면 호출측이 다시 읽는다 (소켓 task_tag:updated 도 오지만 본인 창은 즉시) */
  onChanged: () => void;
}

const TagManageModal: React.FC<Props> = ({ open, onClose, bizId, dict, onChanged }) => {
  const { t } = useTranslation('qtask');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addTag = async () => {
    const name = newName.trim();
    if (!name || adding || !bizId) return;
    setAdding(true); setErr(null);
    try {
      const r = await apiFetch('/api/tasks/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: bizId, name }),
      });
      const j = await r.json().catch(() => null);
      // apiFetch 는 throw 하지 않는다 — 중복(409)·상한(400) 을 그대로 보여준다.
      if (!r.ok || !j?.success) { setErr(j?.message || (t('tags.createFailed', '태그를 만들지 못했습니다') as string)); return; }
      setNewName('');
      onChanged();
    } finally { setAdding(false); }
  };

  const rename = async (tag: TagDictEntry) => {
    const name = draft.trim();
    if (!name || name === tag.name) { setEditingId(null); return; }
    setBusyId(tag.id); setErr(null);
    try {
      const r = await apiFetch(`/api/tasks/tags/${tag.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const j = await r.json().catch(() => null);
      // apiFetch 는 throw 하지 않는다 — 중복(409)·길이(400) 을 그대로 보여준다(조용한 실패 금지)
      if (!r.ok || !j?.success) { setErr(j?.message || (t('tags.renameFailed', '이름을 바꾸지 못했습니다') as string)); return; }
      setEditingId(null);
      onChanged();
    } finally { setBusyId(null); }
  };

  const remove = async (tag: TagDictEntry) => {
    setBusyId(tag.id); setErr(null);
    try {
      const r = await apiFetch(`/api/tasks/tags/${tag.id}`, { method: 'DELETE' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || (t('tags.deleteFailed', '삭제하지 못했습니다') as string)); return; }
      setConfirmId(null);
      onChanged();
    } finally { setBusyId(null); }
  };

  return (
    <StandardModal open={open} onClose={onClose} size="sm" title={t('tags.manageTitle', '태그 관리') as string}>
      {/* ★ 추가가 없어 "여기선 아무것도 못 한다" 로 읽혔다 (Irene: "추가도 삭제도 못하게 할 게 아니라
          그냥 없거나 문서 리스트처럼 다되게 하거나"). 이름 변경·삭제는 원래 있었고 추가만 없었다.
          업무 상세에서도 만들 수 있지만, 관리 화면에서 못 만드는 게 더 이상하다. */}
      <AddRow>
        <NameInput
          value={newName} maxLength={30}
          placeholder={t('tags.newPh', '새 태그 이름') as string}
          onChange={(e) => { setNewName(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addTag(); } }} />
        <SmallBtn type="button" $tone="primary" disabled={adding || !newName.trim()} onClick={() => void addTag()}>
          {adding ? t('tags.creating', '만드는 중…') : t('tags.create', '만들기')}
        </SmallBtn>
      </AddRow>
      {dict.length === 0 ? (
        <Empty>{t('tags.manageEmpty', '아직 태그가 없습니다. 업무 상세에서 만들 수 있어요.')}</Empty>
      ) : (
        <List>
          {dict.map((tag) => (
            <Item key={tag.id}>
              {editingId === tag.id ? (
                <Row>
                  <NameInput
                    autoFocus value={draft} maxLength={30}
                    onChange={(e) => { setDraft(e.target.value); setErr(null); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); rename(tag); }
                      if (e.key === 'Escape') { setEditingId(null); setErr(null); }
                    }} />
                  <SmallBtn type="button" $tone="primary" disabled={busyId === tag.id} onClick={() => rename(tag)}>
                    {t('common.save', '저장')}
                  </SmallBtn>
                  <SmallBtn type="button" onClick={() => { setEditingId(null); setErr(null); }}>
                    {t('common.cancel', '취소')}
                  </SmallBtn>
                </Row>
              ) : confirmId === tag.id ? (
                <Row>
                  {/* 결과를 숫자로 알린 뒤 지운다 — "N개 업무에서 제거됩니다" */}
                  <ConfirmText>
                    {t('tags.deleteConfirm', '“{{name}}” 태그를 {{count}}개 업무에서 제거하고 삭제할까요?', {
                      name: tag.name, count: tag.usage_count ?? 0,
                    })}
                  </ConfirmText>
                  <SmallBtn type="button" $tone="danger" disabled={busyId === tag.id} onClick={() => remove(tag)}>
                    {busyId === tag.id ? t('tags.deleting', '삭제 중…') : t('common.delete', '삭제')}
                  </SmallBtn>
                  <SmallBtn type="button" onClick={() => setConfirmId(null)}>{t('common.cancel', '취소')}</SmallBtn>
                </Row>
              ) : (
                <Row>
                  <NameText>{tag.name}</NameText>
                  <Usage>{t('tags.usageCount', '업무 {{count}}개', { count: tag.usage_count ?? 0 })}</Usage>
                  <SmallBtn type="button" onClick={() => { setEditingId(tag.id); setDraft(tag.name); setConfirmId(null); setErr(null); }}>
                    {t('tags.rename', '이름 변경')}
                  </SmallBtn>
                  <SmallBtn type="button" $tone="danger" onClick={() => { setConfirmId(tag.id); setEditingId(null); setErr(null); }}>
                    {t('common.delete', '삭제')}
                  </SmallBtn>
                </Row>
              )}
            </Item>
          ))}
        </List>
      )}
      {err && <ErrText role="alert">{err}</ErrText>}
    </StandardModal>
  );
};

export default TagManageModal;

const List = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Item = styled.div`
  padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
`;
const Row = styled.div`display: flex; align-items: center; gap: 8px; min-width: 0;`;
const NameText = styled.span`
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 0.8125rem; font-weight: 700; color: #0F172A;
`;
const Usage = styled.span`flex-shrink: 0; font-size: 0.6875rem; color: #94A3B8;`;
const ConfirmText = styled.span`flex: 1; min-width: 0; font-size: 0.75rem; color: #B91C1C;`;
const NameInput = styled.input`
  flex: 1; min-width: 0; height: 30px; padding: 0 8px;
  border: 1px solid #E2E8F0; border-radius: 6px; font-size: 0.8125rem; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
const SmallBtn = styled.button<{ $tone?: 'primary' | 'danger' }>`
  flex-shrink: 0; height: 28px; padding: 0 10px; border-radius: 6px; cursor: pointer;
  font-size: 0.75rem; font-weight: 700;
  border: 1px solid ${({ $tone }) => ($tone === 'danger' ? '#FECACA' : $tone === 'primary' ? '#14B8A6' : '#E2E8F0')};
  background: ${({ $tone }) => ($tone === 'primary' ? '#14B8A6' : '#fff')};
  color: ${({ $tone }) => ($tone === 'primary' ? '#fff' : $tone === 'danger' ? '#DC2626' : '#475569')};
  &:disabled { opacity: 0.5; cursor: default; }
  &:hover:not(:disabled) { border-color: ${({ $tone }) => ($tone === 'danger' ? '#DC2626' : '#94A3B8')}; }
`;
const AddRow = styled.div`
  display: flex; align-items: center; gap: 6px; margin-bottom: 10px;
  padding-bottom: 10px; border-bottom: 1px solid #F1F5F9;
`;
const Empty = styled.div`padding: 24px 8px; text-align: center; font-size: 0.8125rem; color: #94A3B8;`;
const ErrText = styled.div`margin-top: 10px; font-size: 0.75rem; color: #DC2626;`;
