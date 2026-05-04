// Q record 상세 — Notion DB 패턴 그리드.
// 헤더 (컬럼명, 클릭 → 이름·타입 변경/삭제) + 우측 끝 + → 컬럼 추가 + 행 인라인 편집 + 하단 + → 행 추가.
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import Button from '../../components/Common/Button';
import Spinner from '../../components/Common/Spinner';
import StandardModal from '../../components/Common/StandardModal';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import {
  fetchRecord, updateRecord, createRow, updateRow, deleteRow, revealSecret,
  type QRecordDetail, type QRecordColumn, type QRecordColumnType,
} from '../../services/qrecord';

const TYPES: { value: QRecordColumnType; label: string }[] = [
  { value: 'text',     label: '텍스트' },
  { value: 'longtext', label: '긴 텍스트' },
  { value: 'number',   label: '숫자' },
  { value: 'date',     label: '날짜' },
  { value: 'url',      label: 'URL' },
  { value: 'email',    label: '이메일' },
  { value: 'phone',    label: '전화' },
  { value: 'select',   label: '단일 선택' },
  { value: 'checkbox', label: '체크' },
  { value: 'secret',   label: '시크릿 (마스킹)' },
];

const QRecordDetailPage: React.FC = () => {
  const { t } = useTranslation('qrecord');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [rec, setRec] = useState<QRecordDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [columnEdit, setColumnEdit] = useState<QRecordColumn | null>(null);
  // 인라인 컬럼 추가 (모달 X — Q file 처럼 즉석 추가)
  const [addColumnDraft, setAddColumnDraft] = useState<string | null>(null);
  // 인라인 헤더 rename — column id → 편집 중인 이름
  const [headerEditId, setHeaderEditId] = useState<string | null>(null);
  const [headerEditDraft, setHeaderEditDraft] = useState('');
  const [revealed, setRevealed] = useState<Record<string, string>>({}); // `${rowId}:${colId}` → plaintext

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const r = await fetchRecord(Number(id));
      setRec(r);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const saveColumns = async (cols: QRecordColumn[]) => {
    if (!rec) return;
    const next = await updateRecord(rec.id, { columns: cols });
    setRec({ ...rec, columns: next.columns });
  };

  // 인라인 컬럼 즉석 추가 (기본 type=text, 이름 입력 후 Enter)
  const commitAddColumn = async () => {
    if (!rec || !addColumnDraft || !addColumnDraft.trim()) { setAddColumnDraft(null); return; }
    const newCol: QRecordColumn = {
      id: `c${Math.random().toString(36).slice(2, 10)}`,
      name: addColumnDraft.trim(),
      type: 'text',
      order: rec.columns.length,
    };
    await saveColumns([...rec.columns, newCol]);
    setAddColumnDraft(null);
  };

  // 인라인 헤더 rename
  const startHeaderEdit = (col: QRecordColumn) => {
    setHeaderEditId(col.id);
    setHeaderEditDraft(col.name);
  };
  const commitHeaderEdit = async () => {
    if (!rec || !headerEditId) { setHeaderEditId(null); return; }
    const trimmed = headerEditDraft.trim();
    if (trimmed) {
      const cols = rec.columns.map(c => c.id === headerEditId ? { ...c, name: trimmed } : c);
      await saveColumns(cols);
    }
    setHeaderEditId(null);
  };

  const handleAddRow = async () => {
    if (!rec) return;
    const row = await createRow(rec.id, {});
    setRec({ ...rec, rows: [...rec.rows, row] });
  };

  const handleCellChange = async (rowId: number, colId: string, value: unknown) => {
    if (!rec) return;
    const row = rec.rows.find(r => r.id === rowId);
    if (!row) return;
    const newValues = { ...(row.values || {}), [colId]: value };
    const updated = await updateRow(rec.id, rowId, { values: newValues });
    setRec({ ...rec, rows: rec.rows.map(r => r.id === rowId ? updated : r) });
  };

  const handleDeleteRow = async (rowId: number) => {
    if (!rec) return;
    await deleteRow(rec.id, rowId);
    setRec({ ...rec, rows: rec.rows.filter(r => r.id !== rowId) });
  };

  const handleReveal = async (rowId: number, colId: string) => {
    if (!rec) return;
    try {
      const plain = await revealSecret(rec.id, rowId, colId);
      setRevealed(prev => ({ ...prev, [`${rowId}:${colId}`]: plain }));
    } catch { /* skip */ }
  };

  if (loading) return <PageShell title={t('detail.loading', '불러오는 중...')}><Center><Spinner /></Center></PageShell>;
  if (!rec) return <PageShell title={t('detail.notFound', '테이블을 찾을 수 없습니다')}><div /></PageShell>;

  return (
    <PageShell
      title={rec.name}
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={() => navigate('/records')}>← {t('actions.list', '목록')}</Button>
          <Button variant="primary" size="sm" onClick={handleAddRow}>+ {t('actions.addRow', '행 추가')}</Button>
        </>
      }
    >
      <GridWrap>
        <GridScroll>
          <GridTable>
            <thead>
              <tr>
                <RowNumHeader />
                {rec.columns.map(c => (
                  <ColHead key={c.id} title={t('column.headerHint', '이름 클릭=변경 · 타입은 톱니') as string}>
                    {headerEditId === c.id ? (
                      <HeaderEditInput
                        autoFocus
                        value={headerEditDraft}
                        onChange={e => setHeaderEditDraft(e.target.value)}
                        onBlur={commitHeaderEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.currentTarget.blur(); }
                          if (e.key === 'Escape') { setHeaderEditId(null); }
                        }}
                      />
                    ) : (
                      <ColNameLabel onClick={() => startHeaderEdit(c)}>{c.name}</ColNameLabel>
                    )}
                    <ColTypeBtn type="button" onClick={() => setColumnEdit(c)} title={t('column.typeHint', '타입 변경 / 삭제') as string}>
                      {TYPES.find(t => t.value === c.type)?.label || c.type}
                    </ColTypeBtn>
                  </ColHead>
                ))}
                {addColumnDraft !== null ? (
                  <ColHead>
                    <HeaderEditInput
                      autoFocus
                      value={addColumnDraft}
                      placeholder={t('column.namePh', '컬럼명 (Enter)') as string}
                      onChange={e => setAddColumnDraft(e.target.value)}
                      onBlur={commitAddColumn}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.currentTarget.blur(); }
                        if (e.key === 'Escape') { setAddColumnDraft(null); }
                      }}
                    />
                  </ColHead>
                ) : (
                  <AddColHead onClick={() => setAddColumnDraft('')} title={t('column.addHint', '컬럼 추가') as string}>+</AddColHead>
                )}
                <ActionsHead />
              </tr>
            </thead>
            <tbody>
              {rec.rows.map((row, idx) => (
                <tr key={row.id}>
                  <RowNumCell>{idx + 1}</RowNumCell>
                  {rec.columns.map(c => (
                    <Cell key={c.id}>
                      <CellEditor
                        column={c}
                        rowId={row.id}
                        value={(row.values || {})[c.id]}
                        revealedValue={revealed[`${row.id}:${c.id}`]}
                        onChange={(v) => handleCellChange(row.id, c.id, v)}
                        onReveal={() => handleReveal(row.id, c.id)}
                      />
                    </Cell>
                  ))}
                  <Cell />
                  <ActionsCell>
                    <DeleteRowBtn type="button" onClick={() => handleDeleteRow(row.id)} title={t('row.deleteHint', '행 삭제') as string}>×</DeleteRowBtn>
                  </ActionsCell>
                </tr>
              ))}
              <tr>
                <td colSpan={rec.columns.length + 3}>
                  <AddRowBtn type="button" onClick={handleAddRow}>
                    + {t('actions.addRow', '행 추가')}
                  </AddRowBtn>
                </td>
              </tr>
            </tbody>
          </GridTable>
        </GridScroll>
      </GridWrap>

      {columnEdit && (
        <ColumnEditModal
          column={columnEdit}
          onClose={() => setColumnEdit(null)}
          onSave={async (next) => {
            const cols = rec.columns.map(c => c.id === next.id ? next : c);
            await saveColumns(cols);
            setColumnEdit(null);
          }}
          onDelete={async () => {
            const cols = rec.columns.filter(c => c.id !== columnEdit.id);
            await saveColumns(cols);
            setColumnEdit(null);
          }}
        />
      )}
    </PageShell>
  );
};

// ─── 셀 에디터 ───
const CellEditor: React.FC<{
  column: QRecordColumn;
  rowId: number;
  value: unknown;
  revealedValue?: string;
  onChange: (v: unknown) => void;
  onReveal?: () => void;
}> = ({ column, rowId, value, revealedValue, onChange, onReveal }) => {
  const { t } = useTranslation('qrecord');
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(value == null ? '' : String(value)); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (String(draft) !== String(value || '')) onChange(draft);
  };

  if (column.type === 'checkbox') {
    return (
      <CheckboxLabel>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      </CheckboxLabel>
    );
  }
  if (column.type === 'select') {
    const opts: PlanQSelectOption[] = (column.options || []).map(o => ({ value: o, label: o }));
    return (
      <PlanQSelect
        size="sm" isClearable isSearchable={opts.length > 6}
        options={opts}
        value={value ? { value: String(value), label: String(value) } : null}
        onChange={(opt) => onChange(opt ? String((opt as PlanQSelectOption).value) : null)}
        placeholder=""
      />
    );
  }
  if (column.type === 'secret') {
    const plain = revealedValue;
    return (
      <SecretCell>
        {plain ? (
          <SecretInput
            type="text" value={plain}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('cell.secretPh', '값 입력 (저장 시 마스킹)') as string}
          />
        ) : (
          <>
            <SecretMask>{value ? '••••••' : ''}</SecretMask>
            {value
              ? <RevealBtn type="button" onClick={() => onReveal?.()}>{t('cell.reveal', '보기')}</RevealBtn>
              : <SecretInput type="text" placeholder={t('cell.secretEnterPh', '시크릿 입력') as string}
                  onChange={(e) => onChange(e.target.value)} />}
          </>
        )}
      </SecretCell>
    );
  }
  if (column.type === 'longtext') {
    return (
      <CellTextarea
        value={editing ? draft : (value == null ? '' : String(value))}
        onChange={(e) => { setEditing(true); setDraft(e.target.value); }}
        onBlur={commit}
        rows={1}
      />
    );
  }
  // text / number / date / url / email / phone
  const inputType: string =
    column.type === 'number' ? 'number' :
    column.type === 'date' ? 'date' :
    column.type === 'datetime' ? 'datetime-local' :
    column.type === 'url' ? 'url' :
    column.type === 'email' ? 'email' :
    column.type === 'phone' ? 'tel' :
    'text';
  return (
    <CellInput
      type={inputType}
      value={editing ? draft : (value == null ? '' : String(value))}
      onChange={(e) => { setEditing(true); setDraft(e.target.value); }}
      onBlur={commit}
      data-row={rowId}
    />
  );
};

// ─── 컬럼 편집 모달 ───
const ColumnEditModal: React.FC<{
  column: QRecordColumn | null;
  onClose: () => void;
  onSave: (col: QRecordColumn) => Promise<void>;
  onDelete?: () => Promise<void>;
}> = ({ column, onClose, onSave, onDelete }) => {
  const { t } = useTranslation('qrecord');
  const [name, setName] = useState(column?.name || '');
  const [type, setType] = useState<QRecordColumnType>(column?.type || 'text');
  const [optionsText, setOptionsText] = useState((column?.options || []).join('\n'));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const options = type === 'select' || type === 'multi_select'
        ? optionsText.split('\n').map(s => s.trim()).filter(Boolean)
        : undefined;
      await onSave({
        id: column?.id || `c${Math.random().toString(36).slice(2, 10)}`,
        name: name.trim(),
        type, options,
        order: column?.order ?? 0,
      });
    } finally { setBusy(false); }
  };

  return (
    <StandardModal
      open
      onClose={onClose}
      title={column ? t('column.editTitle', '컬럼 편집') : t('column.addTitle', '컬럼 추가')}
      size="sm"
      footer={
        <FooterRow>
          {column && onDelete && (
            <Button variant="danger" onClick={onDelete} disabled={busy}>{t('actions.delete', '삭제')}</Button>
          )}
          <Spacer />
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('actions.cancel', '취소')}</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !name.trim()}>{t('actions.save', '저장')}</Button>
        </FooterRow>
      }
    >
      <Field>
        <Label>{t('column.nameLabel', '컬럼 이름')} *</Label>
        <TextInput type="text" value={name} onChange={e => setName(e.target.value)} maxLength={100} autoFocus />
      </Field>
      <Field>
        <Label>{t('column.typeLabel', '타입')}</Label>
        <PlanQSelect
          size="sm" isSearchable={false}
          options={TYPES.map(t => ({ value: t.value, label: t.label }))}
          value={{ value: type, label: TYPES.find(t => t.value === type)?.label || type }}
          onChange={(opt) => setType(((opt as PlanQSelectOption)?.value as QRecordColumnType) || 'text')}
        />
      </Field>
      {(type === 'select' || type === 'multi_select') && (
        <Field>
          <Label>{t('column.optionsLabel', '선택지 (한 줄에 하나)')}</Label>
          <CellTextarea rows={5} value={optionsText} onChange={e => setOptionsText(e.target.value)} />
        </Field>
      )}
    </StandardModal>
  );
};

export default QRecordDetailPage;

// ─── styled ───
const Center = styled.div`display: flex; justify-content: center; padding: 60px;`;

const GridWrap = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  overflow: hidden;
`;
const GridScroll = styled.div`overflow-x: auto;`;
const GridTable = styled.table`
  width: 100%; border-collapse: collapse;
  font-size: 13px; color: #0F172A;
`;
const RowNumHeader = styled.th`
  width: 40px; padding: 10px 8px;
  background: #F8FAFC; border-bottom: 1px solid #E2E8F0;
`;
const ColHead = styled.th`
  text-align: left;
  padding: 10px 12px;
  background: #F8FAFC;
  border-bottom: 1px solid #E2E8F0;
  border-right: 1px solid #F1F5F9;
  cursor: pointer;
  min-width: 160px;
  user-select: none;
  &:hover { background: #F0FDFA; }
`;
const ColNameLabel = styled.div`
  font-size: 12px; font-weight: 700; color: #0F172A; cursor: text;
  padding: 2px 4px; border-radius: 4px;
  &:hover { background: #FFFFFF; }
`;
const ColTypeBtn = styled.button`
  font-size: 10px; font-weight: 500; color: #94A3B8; margin-top: 2px;
  background: transparent; border: none; padding: 2px 6px;
  border-radius: 4px; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F766E; }
`;
const HeaderEditInput = styled.input`
  width: 100%; padding: 4px 6px;
  border: 1px solid #14B8A6; border-radius: 4px;
  font-size: 12px; font-weight: 700; color: #0F172A;
  background: #FFFFFF;
  &:focus { outline: none; box-shadow: 0 0 0 2px rgba(20,184,166,0.2); }
`;
const AddColHead = styled.th`
  width: 40px; padding: 10px;
  background: #F8FAFC; border-bottom: 1px solid #E2E8F0;
  cursor: pointer;
  font-size: 16px; font-weight: 700; color: #14B8A6;
  &:hover { background: #F0FDFA; }
`;
const ActionsHead = styled.th`
  width: 40px; background: #F8FAFC; border-bottom: 1px solid #E2E8F0;
`;
const RowNumCell = styled.td`
  padding: 8px 12px;
  font-size: 11px; color: #94A3B8;
  background: #F8FAFC; border-bottom: 1px solid #F1F5F9;
  text-align: right;
`;
const Cell = styled.td`
  padding: 0;
  border-bottom: 1px solid #F1F5F9;
  border-right: 1px solid #F1F5F9;
  background: #FFFFFF;
  &:hover { background: #F8FAFC; }
`;
const ActionsCell = styled.td`
  padding: 4px;
  border-bottom: 1px solid #F1F5F9;
  background: #FFFFFF;
  text-align: center;
`;
const DeleteRowBtn = styled.button`
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 4px;
  color: #CBD5E1; cursor: pointer; font-size: 14px;
  &:hover { background: #FEE2E2; color: #DC2626; }
`;
const CellInput = styled.input`
  width: 100%; padding: 10px 12px;
  border: none; outline: none;
  background: transparent;
  font-size: 13px; color: #0F172A; font-family: inherit;
  &:focus { background: #FFFFFF; box-shadow: inset 0 0 0 2px #14B8A6; }
`;
const CellTextarea = styled.textarea`
  width: 100%; padding: 10px 12px;
  border: 1px solid #E2E8F0; border-radius: 6px; outline: none;
  background: #FFFFFF;
  font-size: 13px; color: #0F172A; font-family: inherit; resize: vertical;
  &:focus { border-color: #14B8A6; }
`;
const CheckboxLabel = styled.label`
  display: flex; align-items: center; justify-content: center;
  padding: 10px;
  input { width: 16px; height: 16px; accent-color: #14B8A6; cursor: pointer; }
`;
const SecretCell = styled.div`
  display: flex; align-items: center; gap: 6px; padding: 6px 10px;
`;
const SecretMask = styled.span`
  font-family: monospace; font-size: 13px; color: #475569;
`;
const SecretInput = styled.input`
  flex: 1; padding: 6px 8px;
  border: 1px solid #E2E8F0; border-radius: 4px;
  font-family: monospace; font-size: 12px; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const RevealBtn = styled.button`
  height: 22px; padding: 0 8px;
  font-size: 11px; font-weight: 600; color: #0F766E;
  background: #F0FDFA; border: 1px solid #CCFBF1; border-radius: 4px;
  cursor: pointer;
  &:hover { background: #14B8A6; color: #fff; }
`;
const AddRowBtn = styled.button`
  width: 100%; padding: 10px;
  background: transparent; border: none;
  font-size: 12px; font-weight: 500; color: #94A3B8;
  cursor: pointer;
  &:hover { background: #F0FDFA; color: #0F766E; }
`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Label = styled.label`font-size: 13px; font-weight: 600; color: #0F172A;`;
const TextInput = styled.input`
  height: 36px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 13px; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const FooterRow = styled.div`display: flex; gap: 8px; align-items: center; width: 100%;`;
const Spacer = styled.div`flex: 1;`;
