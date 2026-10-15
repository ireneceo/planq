// DictManageModal — 워크스페이스 «사전» 관리 창(추가·이름 변경·삭제) 한 벌 (2026-10-15)
//
//   업무 태그(TagManageModal)와 역할(RoleManageModal)이 같이 쓴다. 원래 태그 관리창이었던 것을
//   그대로 옮겨 왔다 — 역할 관리창을 새로 그리면 확인 방식·버튼·빈 상태가 곧 갈라진다
//   (CLAUDE.md «껍데기는 빼서 같이 쓴다»). 무엇을 부르고 무엇이라 적는지는 호출측 어댑터가 정한다.
//
//   ★ 삭제는 결과를 숫자로 알린 뒤 한다(호출측 deleteConfirm 문구). window.confirm 금지 · 모달 위 모달 금지 → 인라인 행.
import { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from './StandardModal';
import { isEnterAction } from '../../utils/imeKey';

export interface DictEntry { id: number; name: string }

/** 서버 호출 결과 — 실패면 message 를 그대로 보여준다(조용한 실패 금지). */
export interface DictResult { ok: boolean; message?: string | null }

export interface DictAdapter<E extends DictEntry> {
  create: (name: string) => Promise<DictResult>;
  rename: (entry: E, name: string) => Promise<DictResult>;
  remove: (entry: E) => Promise<DictResult>;
}

export interface DictTexts<E extends DictEntry> {
  title: string;
  newPh: string;
  empty: string;
  usage: (entry: E) => string;
  deleteConfirm: (entry: E) => string;
  createFailed: string;
  renameFailed: string;
  deleteFailed: string;
}

interface Props<E extends DictEntry> {
  open: boolean;
  onClose: () => void;
  dict: E[];
  adapter: DictAdapter<E>;
  texts: DictTexts<E>;
  /** 추가 가능(기본 true) */
  canCreate?: boolean;
  /** 이름 변경·삭제 가능(기본 true) */
  canManage?: boolean;
  maxLength?: number;
  /** 바뀐 뒤 호출측이 다시 읽는다(소켓도 오지만 본인 창은 즉시) */
  onChanged: () => void;
  testId?: string;
}

function DictManageModal<E extends DictEntry>({
  open, onClose, dict, adapter, texts, canCreate = true, canManage = true, maxLength = 30, onChanged, testId,
}: Props<E>) {
  const { t } = useTranslation('common');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true); setErr(null);
    try {
      const r = await adapter.create(name);
      if (!r.ok) { setErr(r.message || texts.createFailed); return; }
      setNewName('');
      onChanged();
    } finally { setAdding(false); }
  };

  const rename = async (entry: E) => {
    const name = draft.trim();
    if (!name || name === entry.name) { setEditingId(null); return; }
    setBusyId(entry.id); setErr(null);
    try {
      const r = await adapter.rename(entry, name);
      if (!r.ok) { setErr(r.message || texts.renameFailed); return; }
      setEditingId(null);
      onChanged();
    } finally { setBusyId(null); }
  };

  const remove = async (entry: E) => {
    setBusyId(entry.id); setErr(null);
    try {
      const r = await adapter.remove(entry);
      if (!r.ok) { setErr(r.message || texts.deleteFailed); return; }
      setConfirmId(null);
      onChanged();
    } finally { setBusyId(null); }
  };

  return (
    <StandardModal open={open} onClose={onClose} size="sm" title={texts.title}>
      <div data-testid={testId}>
        {canCreate && (
          <AddRow>
            <NameInput
              value={newName} maxLength={maxLength}
              placeholder={texts.newPh}
              data-testid={testId ? `${testId}-new` : undefined}
              onChange={(e) => { setNewName(e.target.value); setErr(null); }}
              onKeyDown={(e) => { if (isEnterAction(e)) { e.preventDefault(); void add(); } }} />
            <SmallBtn type="button" $tone="primary" disabled={adding || !newName.trim()} onClick={() => void add()}
              data-testid={testId ? `${testId}-add` : undefined}>
              {adding ? t('dict.creating', '만드는 중…') : t('dict.create', '만들기')}
            </SmallBtn>
          </AddRow>
        )}
        {dict.length === 0 ? (
          <Empty>{texts.empty}</Empty>
        ) : (
          <List>
            {dict.map((entry) => (
              <Item key={entry.id} data-testid={testId ? `${testId}-item` : undefined}>
                {editingId === entry.id ? (
                  <Row>
                    <NameInput
                      autoFocus value={draft} maxLength={maxLength}
                      onChange={(e) => { setDraft(e.target.value); setErr(null); }}
                      onKeyDown={(e) => {
                        if (isEnterAction(e)) { e.preventDefault(); void rename(entry); }
                        if (e.key === 'Escape') { setEditingId(null); setErr(null); }
                      }} />
                    <SmallBtn type="button" $tone="primary" disabled={busyId === entry.id} onClick={() => void rename(entry)}>
                      {t('dict.save', '저장')}
                    </SmallBtn>
                    <SmallBtn type="button" onClick={() => { setEditingId(null); setErr(null); }}>
                      {t('dict.cancel', '취소')}
                    </SmallBtn>
                  </Row>
                ) : confirmId === entry.id ? (
                  <Row>
                    <ConfirmText>{texts.deleteConfirm(entry)}</ConfirmText>
                    <SmallBtn type="button" $tone="danger" disabled={busyId === entry.id} onClick={() => void remove(entry)}>
                      {busyId === entry.id ? t('dict.deleting', '삭제 중…') : t('dict.delete', '삭제')}
                    </SmallBtn>
                    <SmallBtn type="button" onClick={() => setConfirmId(null)}>{t('dict.cancel', '취소')}</SmallBtn>
                  </Row>
                ) : (
                  <Row>
                    <NameText>{entry.name}</NameText>
                    <Usage>{texts.usage(entry)}</Usage>
                    {canManage && (
                      <>
                        <SmallBtn type="button" onClick={() => { setEditingId(entry.id); setDraft(entry.name); setConfirmId(null); setErr(null); }}>
                          {t('dict.rename', '이름 변경')}
                        </SmallBtn>
                        <SmallBtn type="button" $tone="danger" onClick={() => { setConfirmId(entry.id); setEditingId(null); setErr(null); }}>
                          {t('dict.delete', '삭제')}
                        </SmallBtn>
                      </>
                    )}
                  </Row>
                )}
              </Item>
            ))}
          </List>
        )}
        {err && <ErrText role="alert">{err}</ErrText>}
      </div>
    </StandardModal>
  );
}

export default DictManageModal;

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
