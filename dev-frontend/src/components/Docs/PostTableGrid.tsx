// Post (kind='table') 본문에 임베드되는 Q record 그리드.
//
// 이번 사이클 재작성 (사이클 N+2 / 2026-05-10):
//   - 컬럼 헤더 클릭 → ColumnSettings popover (이름·타입 변경 / select 옵션 / 삭제)
//   - 중간 컬럼 삭제
//   - select / multi_select 옵션 사용자 정의
//   - 'attach' 신규 컬럼 타입 — 셀에 파일/문서 chip + 모달로 업로드/연결/AI 새 작성
//   - 빈 상태 (컬럼 0) 안내 + 첫 컬럼 추가 CTA
import React, { useEffect, useRef, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import {
  fetchRecord, updateRecord, createRow, updateRow, deleteRow, revealSecret,
  type QRecordDetail, type QRecordColumn, type QRecordColumnType, type QRecordAggregate,
} from '../../services/qrecord';
import { uploadMyFile, fetchWorkspaceFiles, type ProjectFile } from '../../services/files';
import { fetchPosts, type PostRow } from '../../services/posts';
import { apiFetch } from '../../contexts/AuthContext';
import PostAiModal from './PostAiModal';
import AiActionButton from '../Common/AiActionButton';

const TYPES: { value: QRecordColumnType; tk: string; ko: string }[] = [
  { value: 'text',         tk: 'colType.text',        ko: '텍스트' },
  { value: 'longtext',     tk: 'colType.longtext',    ko: '긴 텍스트' },
  { value: 'number',       tk: 'colType.number',      ko: '숫자' },
  { value: 'date',         tk: 'colType.date',        ko: '날짜' },
  { value: 'datetime',     tk: 'colType.datetime',    ko: '날짜·시간' },
  { value: 'checkbox',     tk: 'colType.checkbox',    ko: '체크' },
  { value: 'url',          tk: 'colType.url',         ko: 'URL' },
  { value: 'email',        tk: 'colType.email',       ko: '이메일' },
  { value: 'phone',        tk: 'colType.phone',       ko: '전화' },
  { value: 'select',       tk: 'colType.select',      ko: '단일 선택' },
  { value: 'multi_select', tk: 'colType.multiSelect', ko: '다중 선택' },
  { value: 'secret',       tk: 'colType.secret',      ko: '시크릿' },
  { value: 'attach',       tk: 'colType.attach',      ko: '첨부' },
  { value: 'row_sum',      tk: 'colType.rowSum',      ko: '행 합계 (자동)' },
  { value: 'row_avg',      tk: 'colType.rowAvg',      ko: '행 평균 (자동)' },
  { value: 'row_min',      tk: 'colType.rowMin',      ko: '행 최소 (자동)' },
  { value: 'row_max',      tk: 'colType.rowMax',      ko: '행 최대 (자동)' },
];

const ROW_AGG_TYPES: QRecordColumnType[] = ['row_sum', 'row_avg', 'row_min', 'row_max'];

// 행 자동 계산 — 같은 행의 모든 number 컬럼 값으로 sum/avg/min/max
const computeRowAggregate = (
  colType: QRecordColumnType,
  rowValues: Record<string, unknown>,
  allColumns: QRecordColumn[],
): string => {
  const numCols = allColumns.filter(c => c.type === 'number');
  const nums = numCols.map(c => Number(rowValues?.[c.id])).filter(n => Number.isFinite(n));
  if (nums.length === 0) return '—';
  if (colType === 'row_sum') return formatAgg(nums.reduce((s, n) => s + n, 0));
  if (colType === 'row_avg') return formatAgg(nums.reduce((s, n) => s + n, 0) / nums.length);
  if (colType === 'row_min') return formatAgg(Math.min(...nums));
  if (colType === 'row_max') return formatAgg(Math.max(...nums));
  return '';
};

const newColId = () => 'c' + Math.random().toString(36).slice(2, 10);

interface AttachItem { kind: 'file' | 'post'; id: number; label?: string }

// 컬럼 타입별 가용 집계 옵션 — number 와 row_* (자동 계산) 컬럼은 sum/avg/min/max 모두 가능
const NUMERIC_TYPES: QRecordColumnType[] = ['number', 'row_sum', 'row_avg', 'row_min', 'row_max'];
const aggregateOptions = (type: QRecordColumnType): QRecordAggregate[] => {
  if (NUMERIC_TYPES.includes(type)) return ['none', 'count', 'sum', 'avg', 'min', 'max', 'empty', 'filled'];
  return ['none', 'count', 'empty', 'filled'];
};

type TFn = (key: string, options?: { defaultValue?: string }) => string;
const aggregateLabel = (agg: QRecordAggregate, t: TFn): string => {
  const m: Record<QRecordAggregate, string> = {
    none: '',
    count: t('agg.count', { defaultValue: '값 있는 행 수' }),
    sum: t('agg.sum', { defaultValue: '합계' }),
    avg: t('agg.avg', { defaultValue: '평균' }),
    min: t('agg.min', { defaultValue: '최소' }),
    max: t('agg.max', { defaultValue: '최대' }),
    empty: t('agg.empty', { defaultValue: '비어있는 비율' }),
    filled: t('agg.filled', { defaultValue: '채워진 비율' }),
  };
  return m[agg] || '';
};

// 셀 값을 숫자로 변환 — 빈 값/비숫자 무시
const cellNumber = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// 셀이 채워졌는지 — 타입 무관하게 truthy + 빈 배열/빈 객체 제외
const cellFilled = (v: unknown): boolean => {
  if (v == null || v === '' || v === false) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
};

const formatAgg = (n: number, asPercent = false): string => {
  if (asPercent) return `${(n * 100).toFixed(0)}%`;
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const computeAggregate = (col: QRecordColumn, rows: QRecordDetail['rows'], allColumns: QRecordColumn[] = []): string => {
  const agg = col.aggregate || 'none';
  if (agg === 'none') return '';
  // row_* 자동 계산 컬럼 — 각 행의 자동 계산값을 number 배열로 (저장된 cell 값이 없으므로)
  const isRowAgg = ROW_AGG_TYPES.includes(col.type);
  const values = isRowAgg
    ? rows.map(r => {
        const computed = computeRowAggregate(col.type, r.values || {}, allColumns);
        const n = Number(computed.replace(/[^\d.-]/g, ''));
        return Number.isFinite(n) ? n : null;
      })
    : rows.map(r => (r.values || {})[col.id]);
  const total = values.length;
  if (total === 0) return '0';

  if (agg === 'count') return formatAgg(values.filter(cellFilled).length);
  if (agg === 'empty') return formatAgg(values.filter(v => !cellFilled(v)).length / total, true);
  if (agg === 'filled') return formatAgg(values.filter(cellFilled).length / total, true);

  const nums = isRowAgg
    ? (values as (number | null)[]).filter((n): n is number => n != null)
    : values.map(cellNumber).filter((n): n is number => n != null);
  if (nums.length === 0) return '—';
  if (agg === 'sum') return formatAgg(nums.reduce((s, n) => s + n, 0));
  if (agg === 'avg') return formatAgg(nums.reduce((s, n) => s + n, 0) / nums.length);
  if (agg === 'min') return formatAgg(Math.min(...nums));
  if (agg === 'max') return formatAgg(Math.max(...nums));
  return '';
};

interface Props {
  recordId: number;
  businessId: number;
  // 보기 모드 — 모든 입력/추가/삭제 비활성. 편집 모드 (default) 만 수정 가능.
  readOnly?: boolean;
}

const PostTableGrid: React.FC<Props> = ({ recordId, businessId, readOnly = false }) => {
  const { t } = useTranslation('qrecord');
  const [rec, setRec] = useState<QRecordDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [headerEditId, setHeaderEditId] = useState<string | null>(null);
  const [headerEditDraft, setHeaderEditDraft] = useState('');
  const [settingsForId, setSettingsForId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [attachContext, setAttachContext] = useState<{ rowId: number; colId: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchRecord(recordId);
      setRec(r);
    } finally { setLoading(false); }
  }, [recordId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading>{t('detail.loading', '불러오는 중...')}</Loading>;
  if (!rec) return <Loading>{t('detail.notFound', '테이블을 찾을 수 없습니다')}</Loading>;

  const saveColumns = async (cols: QRecordColumn[]) => {
    const next = await updateRecord(rec.id, { columns: cols });
    setRec({ ...rec, columns: next.columns });
  };

  const addColumn = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newCol: QRecordColumn = {
      id: newColId(), name: trimmed, type: 'text', order: rec.columns.length,
    };
    await saveColumns([...rec.columns, newCol]);
  };

  const renameColumn = async (colId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) { setHeaderEditId(null); return; }
    const cols = rec.columns.map(c => c.id === colId ? { ...c, name: trimmed } : c);
    await saveColumns(cols);
    setHeaderEditId(null);
  };

  const updateColumn = async (colId: string, patch: Partial<QRecordColumn>) => {
    const cols = rec.columns.map(c => c.id === colId ? { ...c, ...patch } : c);
    await saveColumns(cols);
  };

  const deleteColumn = async (colId: string) => {
    const cols = rec.columns.filter(c => c.id !== colId).map((c, i) => ({ ...c, order: i }));
    await saveColumns(cols);
    setSettingsForId(null);
  };

  const handleAddRow = async () => {
    const row = await createRow(rec.id, {});
    setRec({ ...rec, rows: [...rec.rows, row] });
  };

  const handleCellChange = async (rowId: number, colId: string, value: unknown) => {
    const row = rec.rows.find(r => r.id === rowId);
    if (!row) return;
    const newValues = { ...(row.values || {}), [colId]: value };
    const updated = await updateRow(rec.id, rowId, { values: newValues });
    setRec({ ...rec, rows: rec.rows.map(r => r.id === rowId ? updated : r) });
  };

  const handleDeleteRow = async (rowId: number) => {
    await deleteRow(rec.id, rowId);
    setRec({ ...rec, rows: rec.rows.filter(r => r.id !== rowId) });
  };

  const handleReveal = async (rowId: number, colId: string) => {
    try {
      const plain = await revealSecret(rec.id, rowId, colId);
      setRevealed(prev => ({ ...prev, [`${rowId}:${colId}`]: plain }));
    } catch { /* skip */ }
  };

  // 빈 상태 — 컬럼 0개
  if (rec.columns.length === 0) {
    if (readOnly) {
      return <EmptyWrap><EmptyHint>{t('empty.readOnlyEmpty', { defaultValue: '아직 표 데이터가 없습니다.' }) as string}</EmptyHint></EmptyWrap>;
    }
    return (
      <EmptyWrap>
        <EmptyTitle>{t('empty.firstColumn', '컬럼을 추가해 표를 시작하세요')}</EmptyTitle>
        <EmptyHint>{t('empty.firstColumnHint', '예: 회사명, 담당자, 상태, 마감일')}</EmptyHint>
        <FirstColumnInput
          autoFocus
          placeholder={t('empty.firstColumnPh', '첫 컬럼 이름 (Enter)') as string}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = (e.currentTarget.value || '').trim();
              if (v) addColumn(v);
              e.currentTarget.value = '';
            }
          }}
        />
      </EmptyWrap>
    );
  }

  const settingsCol = settingsForId ? rec.columns.find(c => c.id === settingsForId) : null;

  return (
    <GridWrap>
      <GridScroll>
        <GridTable>
          <thead>
            <tr>
              <RowNumHeader />
              {rec.columns.map(c => (
                <ColHead key={c.id}>
                  <ColHeadInner>
                    {!readOnly && headerEditId === c.id ? (
                      <HeaderEditInput
                        autoFocus value={headerEditDraft}
                        onChange={e => setHeaderEditDraft(e.target.value)}
                        onBlur={() => renameColumn(c.id, headerEditDraft)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') setHeaderEditId(null);
                        }}
                      />
                    ) : (
                      <ColNameLabel
                        as={readOnly ? 'span' : 'div'}
                        onClick={readOnly ? undefined : () => setSettingsForId(c.id)}
                        title={readOnly ? '' : (t('column.editHint', '클릭해서 편집') as string)}
                        $readOnly={readOnly}
                      >
                        {c.name}
                      </ColNameLabel>
                    )}
                    <ColType>{(() => { const tp = TYPES.find(tp => tp.value === c.type); return tp ? t(tp.tk, { defaultValue: tp.ko }) : c.type; })()}</ColType>
                  </ColHeadInner>
                </ColHead>
              ))}
              {!readOnly && (
                <AddColHead
                  onClick={() => {
                    const next = rec.columns.length + 1;
                    addColumn(t('column.defaultName', { defaultValue: '컬럼 {{n}}', n: next }) as string);
                  }}
                  title={t('column.addHint', '컬럼 추가') as string}
                >+</AddColHead>
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
                      value={(row.values || {})[c.id]}
                      rowValues={row.values || {}}
                      allColumns={rec.columns}
                      revealedValue={revealed[`${row.id}:${c.id}`]}
                      readOnly={readOnly}
                      onChange={(v) => handleCellChange(row.id, c.id, v)}
                      onReveal={() => handleReveal(row.id, c.id)}
                      onAttachOpen={() => setAttachContext({ rowId: row.id, colId: c.id })}
                    />
                  </Cell>
                ))}
                {!readOnly && <Cell />}
                <ActionsCell>
                  {!readOnly && (
                    <DeleteRowBtn type="button" onClick={() => handleDeleteRow(row.id)} title={t('row.deleteHint', '행 삭제') as string} aria-label={t('row.deleteHint', '행 삭제') as string}>×</DeleteRowBtn>
                  )}
                </ActionsCell>
              </tr>
            ))}
            {!readOnly && (
              <tr>
                <td colSpan={rec.columns.length + 3}>
                  <AddRowBtn type="button" onClick={handleAddRow}>
                    + {t('actions.addRow', '행 추가')}
                  </AddRowBtn>
                </td>
              </tr>
            )}
          </tbody>
          {rec.columns.some(c => c.aggregate && c.aggregate !== 'none') && (
            <tfoot>
              <tr>
                <FooterLabelCell>Σ</FooterLabelCell>
                {rec.columns.map(c => (
                  <FooterCell key={c.id}>
                    {c.aggregate && c.aggregate !== 'none'
                      ? <FooterValue>{aggregateLabel(c.aggregate, t as TFn)} <strong>{computeAggregate(c, rec.rows, rec.columns)}</strong></FooterValue>
                      : null}
                  </FooterCell>
                ))}
                <FooterCell />
                <FooterCell />
              </tr>
            </tfoot>
          )}
        </GridTable>
      </GridScroll>

      {settingsCol && (
        <ColumnSettingsPopover
          column={settingsCol}
          onClose={() => setSettingsForId(null)}
          onCommit={(patch) => updateColumn(settingsCol.id, patch)}
          onDelete={() => deleteColumn(settingsCol.id)}
        />
      )}

      {attachContext && (
        <AttachPickerModal
          businessId={businessId}
          existing={(rec.rows.find(r => r.id === attachContext.rowId)?.values?.[attachContext.colId] as AttachItem[]) || []}
          onClose={() => setAttachContext(null)}
          onConfirm={async (items) => {
            await handleCellChange(attachContext.rowId, attachContext.colId, items);
            setAttachContext(null);
          }}
        />
      )}
    </GridWrap>
  );
};

// ─── 셀 에디터 ───
const CellEditor: React.FC<{
  column: QRecordColumn;
  value: unknown;
  rowValues?: Record<string, unknown>;
  allColumns?: QRecordColumn[];
  revealedValue?: string;
  readOnly?: boolean;
  onChange: (v: unknown) => void;
  onReveal?: () => void;
  onAttachOpen?: () => void;
}> = ({ column, value, rowValues, allColumns, revealedValue, readOnly, onChange, onReveal, onAttachOpen }) => {
  const { t } = useTranslation('qrecord');
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(value == null ? '' : String(value)); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (String(draft) !== String(value || '')) onChange(draft);
  };

  // 행 자동 계산 — number 컬럼 합산/평균/최소/최대. 사용자 입력 X (read-only 표시).
  if (ROW_AGG_TYPES.includes(column.type)) {
    const computed = computeRowAggregate(column.type, rowValues || {}, allColumns || []);
    return <ReadCell><ComputedValue>{computed === '—' ? <Dim>—</Dim> : computed}</ComputedValue></ReadCell>;
  }

  if (column.type === 'checkbox') {
    return (<CheckboxLabel><input type="checkbox" checked={!!value} disabled={readOnly} onChange={(e) => onChange(e.target.checked)} /></CheckboxLabel>);
  }

  if (column.type === 'select') {
    const opts: PlanQSelectOption[] = (column.options || []).map(o => ({ value: o, label: o }));
    if (readOnly) return <ReadCell>{value ? String(value) : <Dim>—</Dim>}</ReadCell>;
    return (
      <PlanQSelect size="sm" isClearable isSearchable={opts.length > 6}
        options={opts}
        value={value ? { value: String(value), label: String(value) } : null}
        onChange={(opt) => onChange(opt ? String((opt as PlanQSelectOption).value) : null)}
        placeholder={opts.length === 0 ? (t('cell.selectEmptyPh', '옵션 없음 — 컬럼 설정에서 추가') as string) : ''}
      />
    );
  }

  if (column.type === 'multi_select') {
    const opts: PlanQSelectOption[] = (column.options || []).map(o => ({ value: o, label: o }));
    const arr = Array.isArray(value) ? (value as string[]) : [];
    if (readOnly) return <ReadCell>{arr.length > 0 ? arr.join(', ') : <Dim>—</Dim>}</ReadCell>;
    return (
      <PlanQSelect size="sm" isMulti isClearable isSearchable={opts.length > 6}
        options={opts}
        value={arr.map(v => ({ value: v, label: v }))}
        onChange={(opt) => onChange(Array.isArray(opt) ? opt.map(o => String((o as PlanQSelectOption).value)) : [])}
        placeholder={opts.length === 0 ? (t('cell.selectEmptyPh', '옵션 없음 — 컬럼 설정에서 추가') as string) : ''}
      />
    );
  }

  if (column.type === 'secret') {
    const plain = revealedValue;
    if (readOnly) {
      return <ReadCell>{value ? <SecretMask>••••••</SecretMask> : <Dim>—</Dim>}</ReadCell>;
    }
    return (
      <SecretCell>
        {plain ? (
          <SecretInput type="text" value={plain} onChange={(e) => onChange(e.target.value)} />
        ) : value ? (
          <>
            <SecretMask>••••••</SecretMask>
            <RevealBtn type="button" onClick={() => onReveal?.()}>{t('cell.reveal', '보기')}</RevealBtn>
          </>
        ) : (
          <SecretInput type="text" placeholder={t('cell.secretEnterPh', '시크릿 입력') as string} onChange={(e) => onChange(e.target.value)} />
        )}
      </SecretCell>
    );
  }

  if (column.type === 'attach') {
    const items: AttachItem[] = Array.isArray(value) ? (value as AttachItem[]) : [];
    const itemHref = (it: AttachItem) =>
      it.kind === 'file' ? `/files?file=${it.id}` : `/docs?post=${it.id}`;
    const itemTitle = (it: AttachItem) =>
      `${it.kind === 'file' ? t('attach.openFile', { defaultValue: '파일 열기' }) : t('attach.openDoc', { defaultValue: '문서 열기' })} (${t('attach.newTab', { defaultValue: '새 창' }) as string})`;

    if (readOnly) {
      return (
        <ReadCell>
          {items.length === 0 ? <Dim>—</Dim> : (
            <AttachChips>
              {items.map((it, i) => (
                <AttachChipLink
                  key={i}
                  href={itemHref(it)}
                  target="_blank"
                  rel="noopener noreferrer"
                  $kind={it.kind}
                  title={itemTitle(it) as string}
                >
                  {it.kind === 'file' ? '📎' : '📄'} {it.label || (it.kind === 'file' ? `${t('attach.fileNum', { defaultValue: '파일' }) as string} #${it.id}` : `${t('attach.docNum', { defaultValue: '문서' }) as string} #${it.id}`)}
                </AttachChipLink>
              ))}
            </AttachChips>
          )}
        </ReadCell>
      );
    }
    return (
      <AttachCellWrap>
        {items.length === 0 ? (
          <AttachEmptyBtn type="button" onClick={() => onAttachOpen?.()} title={t('cell.attachHint', '파일/문서 첨부 추가/수정') as string}>
            + {t('cell.attachAdd', { defaultValue: '파일/문서 첨부' }) as string}
          </AttachEmptyBtn>
        ) : (
          <AttachChips>
            {items.map((it, i) => (
              <AttachChipLink
                key={i}
                href={itemHref(it)}
                target="_blank"
                rel="noopener noreferrer"
                $kind={it.kind}
                title={itemTitle(it) as string}
                onClick={(e) => e.stopPropagation()}
              >
                {it.kind === 'file' ? '📎' : '📄'} {it.label || (it.kind === 'file' ? `${t('attach.fileNum', { defaultValue: '파일' }) as string} #${it.id}` : `${t('attach.docNum', { defaultValue: '문서' }) as string} #${it.id}`)}
              </AttachChipLink>
            ))}
            <AttachAddIcon type="button" onClick={(e) => { e.stopPropagation(); onAttachOpen?.(); }} title={t('cell.attachHint', '파일/문서 첨부 추가/수정') as string}>+</AttachAddIcon>
          </AttachChips>
        )}
      </AttachCellWrap>
    );
  }

  if (column.type === 'longtext') {
    if (readOnly) return <ReadCell>{value != null && value !== '' ? String(value) : <Dim>—</Dim>}</ReadCell>;
    return (<CellTextarea value={editing ? draft : (value == null ? '' : String(value))}
      onChange={(e) => { setEditing(true); setDraft(e.target.value); }} onBlur={commit} rows={1} />);
  }

  if (readOnly) return <ReadCell>{value != null && value !== '' ? String(value) : <Dim>—</Dim>}</ReadCell>;

  const inputType =
    column.type === 'number' ? 'number' :
    column.type === 'date' ? 'date' :
    column.type === 'datetime' ? 'datetime-local' :
    column.type === 'url' ? 'url' :
    column.type === 'email' ? 'email' :
    column.type === 'phone' ? 'tel' :
    'text';
  return (
    <CellInput type={inputType} value={editing ? draft : (value == null ? '' : String(value))}
      onChange={(e) => { setEditing(true); setDraft(e.target.value); }} onBlur={commit} />
  );
};

// ─── 컬럼 설정 popover ───
const ColumnSettingsPopover: React.FC<{
  column: QRecordColumn;
  onClose: () => void;
  // #96 — 이름·타입·옵션·집계를 한 번에 commit. 옛: 4개 콜백 각각 updateColumn 호출 → 같은 stale 스냅샷으로
  //   동시 저장돼 race(마지막만 반영). "타입을 첨부로 바꿔도 적용 안 됨, 다시 설정하면 됨" 회귀의 근본.
  onCommit: (patch: Partial<QRecordColumn>) => void;
  onDelete: () => void;
}> = ({ column, onClose, onCommit, onDelete }) => {
  const { t } = useTranslation('qrecord');
  const [name, setName] = useState(column.name);
  const [type, setType] = useState<QRecordColumnType>(column.type);
  const [optionsText, setOptionsText] = useState((column.options || []).join('\n'));
  const [aggregate, setAggregate] = useState<QRecordAggregate>(column.aggregate || 'none');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setName(column.name);
    setType(column.type);
    setOptionsText((column.options || []).join('\n'));
    setAggregate(column.aggregate || 'none');
  }, [column.id, column.name, column.type, column.options, column.aggregate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const commit = () => {
    // #96 — 변경된 필드를 하나의 patch 로 합쳐 단일 저장 (race 차단).
    const patch: Partial<QRecordColumn> = {};
    if (name.trim() && name.trim() !== column.name) patch.name = name.trim();
    if (type !== column.type) patch.type = type;
    if (type === 'select' || type === 'multi_select') {
      const next = optionsText.split('\n').map(s => s.trim()).filter(Boolean);
      const prev = column.options || [];
      if (JSON.stringify(next) !== JSON.stringify(prev)) patch.options = next;
    }
    if (aggregate !== (column.aggregate || 'none')) patch.aggregate = aggregate;
    if (Object.keys(patch).length > 0) onCommit(patch);
    onClose();
  };

  const typeOptions: PlanQSelectOption[] = TYPES.map(tp => ({ value: tp.value, label: t(tp.tk, { defaultValue: tp.ko }) as string }));
  const showOptions = type === 'select' || type === 'multi_select';
  const aggOpts: PlanQSelectOption[] = aggregateOptions(type).map(a => ({
    value: a,
    label: a === 'none' ? (t('agg.none', { defaultValue: '없음' }) as string) : aggregateLabel(a, t as TFn),
  }));

  return (
    <PopoverBackdrop onClick={onClose}>
      <PopoverDialog ref={ref} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('column.editTitle', '컬럼 편집') as string}>
        <PopoverHeader>
          <PopoverTitle>{t('column.editTitle', '컬럼 편집')}</PopoverTitle>
          <PopoverClose type="button" onClick={onClose} aria-label={t('actions.cancel', '취소') as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </PopoverClose>
        </PopoverHeader>
        <PopoverBody>
          <Field>
            <FieldLabel>{t('column.nameLabel', '컬럼 이름')}</FieldLabel>
            <FieldInput type="text" value={name} onChange={e => setName(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(); }} />
          </Field>
          <Field>
            <FieldLabel>{t('column.typeLabel', '타입')}</FieldLabel>
            <PlanQSelect size="sm"
              options={typeOptions}
              value={typeOptions.find(o => o.value === type) || null}
              onChange={(opt) => setType(((opt as PlanQSelectOption)?.value as QRecordColumnType) || 'text')}
              isSearchable={false}
            />
          </Field>
          {showOptions && (
            <Field>
              <FieldLabel>{t('column.optionsLabel', '선택지 (한 줄에 하나)')}</FieldLabel>
              <FieldTextarea
                rows={5}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder={t('column.optionsPh', '예:\n진행 중\n검토\n완료') as string}
              />
            </Field>
          )}
          <Field>
            <FieldLabel>{t('column.aggregateLabel', { defaultValue: '열 자동 계산 (표 하단)' }) as string}</FieldLabel>
            <PlanQSelect size="sm"
              options={aggOpts}
              value={aggOpts.find(o => o.value === aggregate) || null}
              onChange={(opt) => setAggregate(((opt as PlanQSelectOption)?.value as QRecordAggregate) || 'none')}
              isSearchable={false}
            />
            <FieldHint>{t('column.aggregateHint', { defaultValue: '이 열의 값들을 표 맨 아래 줄에 합계·평균·최소·최대 등으로 자동 계산해 보여줍니다.' }) as string}</FieldHint>
          </Field>
        </PopoverBody>
        <PopoverFooter>
          <DangerSection>
            {!confirmDelete ? (
              <DangerLinkBtn type="button" onClick={() => setConfirmDelete(true)}>
                {t('column.delete', '컬럼 삭제')}
              </DangerLinkBtn>
            ) : (
              <DangerConfirm>
                <DangerHint>{t('column.deleteConfirm', '이 컬럼의 모든 셀 데이터가 사라집니다.')}</DangerHint>
                <DangerBtn type="button" onClick={onDelete}>{t('column.deleteYes', '삭제')}</DangerBtn>
                <DangerCancel type="button" onClick={() => setConfirmDelete(false)}>{t('actions.cancel', '취소')}</DangerCancel>
              </DangerConfirm>
            )}
          </DangerSection>
          <PopoverActions>
            <SecondaryBtn type="button" onClick={onClose}>{t('actions.cancel', '취소')}</SecondaryBtn>
            <PrimaryBtn type="button" onClick={commit}>{t('actions.save', '저장')}</PrimaryBtn>
          </PopoverActions>
        </PopoverFooter>
      </PopoverDialog>
    </PopoverBackdrop>
  );
};

// ─── 첨부 picker 모달 ───
const AttachPickerModal: React.FC<{
  businessId: number;
  existing: AttachItem[];
  onClose: () => void;
  onConfirm: (items: AttachItem[]) => void;
}> = ({ businessId, existing, onClose, onConfirm }) => {
  const { t } = useTranslation('qrecord');
  const [items, setItems] = useState<AttachItem[]>(existing);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchWorkspaceFiles(businessId).then(fs => setFiles(fs.filter(f => f.source === 'direct'))).catch(() => {});
    fetchPosts(businessId, {}).then(ps => setPosts(ps)).catch(() => {});
  }, [businessId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    try {
      const next = [...items];
      for (const f of Array.from(fileList)) {
        const r = await uploadMyFile(businessId, f);
        if (r.success && r.file) {
          const numId = Number(String(r.file.id).replace('direct-', ''));
          if (Number.isFinite(numId)) next.push({ kind: 'file', id: numId, label: f.name });
        }
      }
      setItems(next);
    } finally { setBusy(false); }
  };

  const addExistingFile = (id: number) => {
    if (items.some(it => it.kind === 'file' && it.id === id)) return;
    const f = files.find(x => Number(String(x.id).replace('direct-', '')) === id);
    setItems([...items, { kind: 'file', id, label: f?.file_name }]);
  };

  const addExistingPost = (id: number) => {
    if (items.some(it => it.kind === 'post' && it.id === id)) return;
    const p = posts.find(x => x.id === id);
    setItems([...items, { kind: 'post', id, label: p?.title }]);
  };

  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const fileOptions: PlanQSelectOption[] = files.map(f => {
    const numId = Number(String(f.id).replace('direct-', ''));
    return { value: numId, label: f.file_name };
  });
  const postOptions: PlanQSelectOption[] = posts.map(p => ({ value: p.id, label: p.title }));

  // AI 새 작성 → 결과로 새 post 생성 후 첨부
  const handleAiGenerate = async (result: { title: string; bodyHtml: string }) => {
    setBusy(true);
    try {
      const r = await apiFetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          title: result.title,
          content_html: result.bodyHtml,
          kind: 'doc',
          ai_generated: true,
        }),
      });
      const j = await r.json();
      if (j.success && j.data?.id) {
        setItems([...items, { kind: 'post', id: j.data.id, label: result.title }]);
        // 새로 만든 post 가 후속 검색에서도 보이게 갱신
        fetchPosts(businessId, {}).then(ps => setPosts(ps)).catch(() => {});
        // 새 창에서 편집 페이지 열기 (사용자가 즉시 검토/수정 가능)
        try { window.open(`/docs?post=${j.data.id}`, '_blank', 'noopener,noreferrer'); } catch { /* popup blocked */ }
      }
    } finally {
      setBusy(false);
      setAiOpen(false);
    }
  };

  // 새 빈 문서 작성 → 즉시 빈 post 생성 후 첨부 + 새 창에서 편집 페이지 열기
  const handleBlankNew = async () => {
    setBusy(true);
    try {
      const r = await apiFetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          title: t('attach.blankPostTitle', '새 문서') as string,
          kind: 'doc',
        }),
      });
      const j = await r.json();
      if (j.success && j.data?.id) {
        setItems([...items, { kind: 'post', id: j.data.id, label: j.data.title }]);
        fetchPosts(businessId, {}).then(ps => setPosts(ps)).catch(() => {});
        // 새 창에서 편집 페이지 열기 (사용자가 즉시 작성 가능)
        try { window.open(`/docs?post=${j.data.id}`, '_blank', 'noopener,noreferrer'); } catch { /* popup blocked */ }
      }
    } finally { setBusy(false); }
  };

  return (
    <PopoverBackdrop onClick={() => !busy && onClose()}>
      <AttachDialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('attach.title', { defaultValue: '파일/문서 첨부' }) as string}>
        <PopoverHeader>
          <PopoverTitle>{t('attach.title', { defaultValue: '파일/문서 첨부' }) as string}</PopoverTitle>
          <PopoverClose type="button" onClick={onClose} disabled={busy} aria-label={t('actions.cancel', '취소') as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </PopoverClose>
        </PopoverHeader>
        <PopoverBody>
          {items.length > 0 && (
            <>
              <SectionTitle>{t('attach.currentSection', { defaultValue: '연결된 첨부' }) as string}</SectionTitle>
              <CurrentList>
                {items.map((it, i) => (
                  <CurrentItem key={i}>
                    <CurrentItemLink
                      href={it.kind === 'file' ? `/files?file=${it.id}` : `/docs?post=${it.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t('attach.openInNewTab', { defaultValue: '새 창에서 열기' }) as string}
                    >
                      {it.kind === 'file' ? '📎' : '📄'} {it.label || `${it.kind === 'file' ? t('attach.fileNum', { defaultValue: '파일' }) : t('attach.docNum', { defaultValue: '문서' })} #${it.id}`}
                      <ExternalIcon>↗</ExternalIcon>
                    </CurrentItemLink>
                    <RemoveItemBtn type="button" onClick={() => removeItem(i)} aria-label={t('attach.remove', '제거') as string}>×</RemoveItemBtn>
                  </CurrentItem>
                ))}
              </CurrentList>
            </>
          )}

          <SectionTitle>📎 {t('attach.uploadSection', { defaultValue: '파일 업로드 (새 파일)' }) as string}</SectionTitle>
          <DropZone type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {t('attach.uploadHint', '클릭하거나 파일을 끌어다 놓으세요')}
          </DropZone>
          <input
            ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
            onChange={(e) => { handleUpload(e.target.files); e.target.value = ''; }}
          />

          <SectionTitle>📎 {t('attach.fileSection', { defaultValue: '워크스페이스 파일 연결' }) as string}</SectionTitle>
          <PlanQSelect size="sm" isSearchable
            options={fileOptions}
            value={null}
            onChange={(opt) => opt && addExistingFile(Number((opt as PlanQSelectOption).value))}
            placeholder={t('attach.filePh', { defaultValue: '기존 파일 검색·선택' }) as string}
          />

          <SectionTitle>📄 {t('attach.docSection', { defaultValue: '기존 문서 연결' }) as string}</SectionTitle>
          <PlanQSelect size="sm" isSearchable
            options={postOptions}
            value={null}
            onChange={(opt) => opt && addExistingPost(Number((opt as PlanQSelectOption).value))}
            placeholder={t('attach.docPh', { defaultValue: '기존 문서 검색·선택' }) as string}
          />

          <SectionTitle>📄 {t('attach.newSection', { defaultValue: '새 문서 작성 + 자동 연결' }) as string}</SectionTitle>
          <SectionHelp>{t('attach.newHint', { defaultValue: '새 문서가 생성되어 이 셀에 자동 연결되고, 새 창에서 편집 페이지가 열립니다.' }) as string}</SectionHelp>
          <NewDocActions>
            <NewDocBtn type="button" onClick={handleBlankNew} disabled={busy}>
              {t('attach.newBlank', { defaultValue: '빈 문서로 시작' }) as string}
            </NewDocBtn>
            <AiActionButton
              onClick={() => setAiOpen(true)}
              disabled={busy}
              label={t('attach.newAi', { defaultValue: 'AI 자동 작성' }) as string}
              title={t('attach.newAiHint', { defaultValue: 'AI 가 문서 본문을 자동 작성합니다' }) as string}
            />
          </NewDocActions>
        </PopoverBody>
        <PopoverFooter>
          <PopoverActions>
            <SecondaryBtn type="button" onClick={onClose} disabled={busy}>{t('actions.cancel', '취소')}</SecondaryBtn>
            <PrimaryBtn type="button" onClick={() => onConfirm(items)} disabled={busy}>{t('actions.save', '저장')}</PrimaryBtn>
          </PopoverActions>
        </PopoverFooter>

        {aiOpen && (
          <PostAiModal
            open={aiOpen}
            onClose={() => setAiOpen(false)}
            businessId={businessId}
            intent="ai"
            onGenerate={handleAiGenerate}
          />
        )}
      </AttachDialog>
    </PopoverBackdrop>
  );
};

export default PostTableGrid;

// ─── styled ───
const Loading = styled.div`padding: 40px; text-align: center; color: #94A3B8; font-size: 13px;`;
const GridWrap = styled.div`width: 100%;`;
const GridScroll = styled.div`overflow-x: auto; border: 1px solid #E2E8F0; border-radius: 10px; background: #fff;`;
const GridTable = styled.table`
  width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px;
  background: #fff;
  th, td { border-right: 1px solid #E2E8F0; border-bottom: 1px solid #E2E8F0; vertical-align: top; }
  thead th { background: #F8FAFC; font-weight: 600; color: #0F172A; padding: 8px 10px; text-align: left; white-space: nowrap; }
  tbody td { padding: 0; background: #fff; }
  tbody tr:hover td { background: #F8FAFC; }
  tr:last-child td { border-bottom: none; }
`;
const RowNumHeader = styled.th`width: 40px; min-width: 40px;`;
const RowNumCell = styled.td`width: 40px; text-align: center; color: #94A3B8; font-size: 11px; padding: 8px 0; background: #F8FAFC;`;
const ColHead = styled.th`min-width: 140px; cursor: default;`;
const ColHeadInner = styled.div`display: flex; flex-direction: column; gap: 2px;`;
const ColNameLabel = styled.div<{ $readOnly?: boolean }>`
  font-size: 13px; font-weight: 600; color: #0F172A;
  cursor: ${p => p.$readOnly ? 'default' : 'pointer'};
  padding: 2px 4px; border-radius: 4px;
  ${p => p.$readOnly ? '' : `&:hover { background: #F0FDFA; }`}
`;
const HeaderEditInput = styled.input`
  font-size: 13px; font-weight: 600; color: #0F172A;
  border: 1px solid #14B8A6; border-radius: 4px; padding: 2px 4px; outline: none;
  width: 100%; box-sizing: border-box;
`;
const ColType = styled.div`font-size: 10px; color: #94A3B8; font-weight: 500; padding: 0 4px;`;
const AddColHead = styled.th`
  width: 36px; text-align: center; cursor: pointer; color: #64748B; font-size: 18px; font-weight: 400;
  &:hover { background: #F0FDFA; color: #0F766E; }
`;
const ActionsHead = styled.th`width: 32px;`;
const Cell = styled.td`min-width: 140px; padding: 0;`;
const ActionsCell = styled.td`width: 32px; text-align: center; padding: 0; background: #F8FAFC;`;
const DeleteRowBtn = styled.button`
  width: 22px; height: 22px; border: none; background: transparent; cursor: pointer;
  color: #94A3B8; border-radius: 4px; font-size: 14px; line-height: 1;
  &:hover { background: #FEF2F2; color: #DC2626; }
`;
const AddRowBtn = styled.button`
  width: 100%; padding: 10px; border: none; background: transparent; cursor: pointer;
  color: #14B8A6; font-size: 13px; font-weight: 600; text-align: left;
  &:hover { background: #F0FDFA; }
`;
const CellInput = styled.input`
  width: 100%; height: 100%; padding: 8px 10px; border: none; background: transparent;
  font-size: 13px; color: #0F172A; box-sizing: border-box;
  &:focus { outline: 2px solid #14B8A6; outline-offset: -2px; }
`;
const ReadCell = styled.div`
  padding: 8px 10px; font-size: 13px; color: #0F172A; line-height: 1.5;
  min-height: 36px; word-break: break-word;
`;
const Dim = styled.span`color: #CBD5E1;`;
const ComputedValue = styled.div`
  display: inline-flex; align-items: center; gap: 4px;
  font-weight: 600; color: #0F766E; font-variant-numeric: tabular-nums;
  &::before {
    content: 'fx'; font-size: 9px; font-weight: 700; padding: 2px 5px;
    background: #CCFBF1; color: #0F766E; border-radius: 4px;
  }
`;
const CellTextarea = styled.textarea`
  width: 100%; padding: 8px 10px; border: none; background: transparent;
  font-size: 13px; color: #0F172A; font-family: inherit; resize: vertical; box-sizing: border-box; line-height: 1.5;
  &:focus { outline: 2px solid #14B8A6; outline-offset: -2px; }
`;
const CheckboxLabel = styled.label`display: flex; align-items: center; justify-content: center; padding: 8px;`;
const SecretCell = styled.div`display: flex; align-items: center; gap: 6px; padding: 8px 10px;`;
const SecretMask = styled.span`color: #64748B; font-family: monospace;`;
const SecretInput = styled.input`flex: 1; border: none; background: transparent; font-size: 13px; outline: none;`;
const RevealBtn = styled.button`
  font-size: 11px; padding: 2px 8px; border: 1px solid #E2E8F0; background: #fff;
  color: #475569; border-radius: 4px; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
const AttachCellWrap = styled.div`
  width: 100%; min-height: 36px; padding: 6px 10px;
  display: flex; align-items: center;
`;
const AttachEmptyBtn = styled.button`
  width: 100%; min-height: 24px; background: transparent; border: 1px dashed #CBD5E1;
  border-radius: 6px; padding: 4px 8px; cursor: pointer; font-family: inherit;
  color: #64748B; font-size: 12px; text-align: left;
  &:hover { background: #F0FDFA; border-color: #14B8A6; color: #0F766E; }
`;
const AttachAddIcon = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  background: transparent; border: 1px solid #E2E8F0; border-radius: 50%;
  color: #64748B; font-size: 14px; font-weight: 600; cursor: pointer;
  flex-shrink: 0;
  &:hover { background: #F0FDFA; border-color: #14B8A6; color: #0F766E; }
`;
const AttachChips = styled.div`display: flex; flex-wrap: wrap; gap: 4px; align-items: center;`;
const AttachChipLink = styled.a<{ $kind: 'file' | 'post' }>`
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px;
  background: ${p => p.$kind === 'file' ? '#FEF3C7' : '#DBEAFE'};
  color: ${p => p.$kind === 'file' ? '#92400E' : '#1E40AF'};
  border-radius: 6px; font-size: 11px; font-weight: 600;
  max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  text-decoration: none; cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  &:hover {
    background: ${p => p.$kind === 'file' ? '#FDE68A' : '#BFDBFE'};
    transform: translateY(-1px);
  }
`;
// 빈 상태
const EmptyWrap = styled.div`
  padding: 36px 24px; background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 10px;
  text-align: center;
`;
const EmptyTitle = styled.div`font-size: 14px; font-weight: 600; color: #0F172A; margin-bottom: 4px;`;
const EmptyHint = styled.div`font-size: 12px; color: #64748B; margin-bottom: 14px;`;
const FirstColumnInput = styled.input`
  width: min(320px, 80%); padding: 10px 14px; font-size: 14px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #fff; text-align: center;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;

// Popover (컬럼 설정)
const PopoverBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 1100; padding: 20px;
`;
const PopoverDialog = styled.div`
  background: #fff; border-radius: 12px; max-width: 420px; width: 100%;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(15,23,42,0.2);
`;
const AttachDialog = styled.div`
  background: #fff; border-radius: 12px; max-width: 520px; width: 100%; max-height: 88vh;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(15,23,42,0.2);
  @media (max-width: 640px) { max-height: 100vh; height: 100vh; border-radius: 0; }
`;
const PopoverHeader = styled.div`display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #F1F5F9; flex-shrink: 0;`;
const PopoverTitle = styled.h3`font-size: 14px; font-weight: 700; color: #0F172A; margin: 0;`;
const PopoverClose = styled.button`
  width: 26px; height: 26px; background: transparent; border: none;
  display: flex; align-items: center; justify-content: center;
  color: #64748B; cursor: pointer; border-radius: 6px;
  &:hover:not(:disabled) { background: #F1F5F9; color: #0F172A; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const PopoverBody = styled.div`padding: 16px 18px; flex: 1; overflow-y: auto; min-height: 0; display: flex; flex-direction: column; gap: 14px;`;
const PopoverFooter = styled.div`padding: 12px 18px; border-top: 1px solid #F1F5F9; flex-shrink: 0;`;
const PopoverActions = styled.div`display: flex; justify-content: flex-end; gap: 8px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const FieldLabel = styled.label`font-size: 12px; font-weight: 600; color: #0F172A;`;
const FieldInput = styled.input`
  width: 100%; padding: 8px 12px; font-size: 13px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const FieldTextarea = styled.textarea`
  width: 100%; padding: 8px 12px; font-size: 13px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
  font-family: inherit; line-height: 1.5; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const FieldHint = styled.div`font-size: 11px; color: #94A3B8; line-height: 1.4;`;
// footer (집계)
const FooterLabelCell = styled.td`
  width: 40px; text-align: center; padding: 8px 0;
  background: #F8FAFC; color: #94A3B8; font-size: 12px; font-weight: 700;
  border-top: 2px solid #E2E8F0;
`;
const FooterCell = styled.td`
  padding: 8px 10px; background: #F8FAFC;
  border-top: 2px solid #E2E8F0; vertical-align: middle;
`;
const FooterValue = styled.span`
  display: inline-flex; gap: 6px; align-items: baseline;
  font-size: 11px; color: #64748B;
  > strong { font-size: 13px; color: #0F172A; font-weight: 700; }
`;
const SecondaryBtn = styled.button`
  padding: 8px 14px; font-size: 13px; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { border-color: #CBD5E1; background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const PrimaryBtn = styled.button`
  padding: 8px 16px; font-size: 13px; font-weight: 700; color: #fff;
  background: #14B8A6; border: none; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const DangerSection = styled.div`margin-bottom: 12px;`;
const DangerLinkBtn = styled.button`
  font-size: 12px; padding: 4px 0; background: transparent; border: none;
  color: #DC2626; font-weight: 600; cursor: pointer;
  &:hover { text-decoration: underline; }
`;
const DangerConfirm = styled.div`display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #FEF2F2; border-radius: 8px;`;
const DangerHint = styled.span`flex: 1; font-size: 12px; color: #991B1B;`;
const DangerBtn = styled.button`
  padding: 6px 12px; font-size: 12px; font-weight: 700; color: #fff;
  background: #DC2626; border: none; border-radius: 6px; cursor: pointer;
  &:hover { background: #B91C1C; }
`;
const DangerCancel = styled.button`
  padding: 6px 10px; font-size: 12px; font-weight: 600; color: #475569;
  background: transparent; border: none; cursor: pointer;
  &:hover { color: #0F172A; }
`;

// 첨부 picker 내부
const CurrentList = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const CurrentItem = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  background: #F0FDFA; border-radius: 6px; font-size: 12px; color: #0F172A;
  > span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
const CurrentItemLink = styled.a`
  flex: 1; display: inline-flex; align-items: center; gap: 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #0F172A; text-decoration: none; font-weight: 500;
  &:hover { color: #0F766E; }
`;
const ExternalIcon = styled.span`
  font-size: 10px; color: #94A3B8; margin-left: 2px;
`;
const SectionHelp = styled.div`
  font-size: 11px; color: #64748B; line-height: 1.5;
  padding: 4px 0;
`;
const RemoveItemBtn = styled.button`
  width: 20px; height: 20px; background: transparent; border: none;
  color: #64748B; cursor: pointer; border-radius: 4px; line-height: 1;
  &:hover { background: #fff; color: #DC2626; }
`;
const SectionTitle = styled.div`font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 6px;`;
const DropZone = styled.button`
  width: 100%; padding: 14px; border: 1px dashed #CBD5E1; border-radius: 8px;
  background: #F8FAFC; color: #64748B; font-size: 12px; cursor: pointer;
  &:hover:not(:disabled) { border-color: #14B8A6; background: #F0FDFA; color: #0F766E; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const NewDocActions = styled.div`display: flex; gap: 8px;`;
const NewDocBtn = styled.button<{ $accent?: boolean }>`
  flex: 1; padding: 10px 14px; font-size: 13px; font-weight: 600;
  background: ${p => p.$accent ? 'linear-gradient(135deg, #F43F5E 0%, #BE185D 100%)' : '#fff'};
  color: ${p => p.$accent ? '#fff' : '#334155'};
  border: ${p => p.$accent ? 'none' : '1px solid #E2E8F0'};
  border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { ${p => p.$accent ? 'transform: translateY(-1px);' : 'border-color: #CBD5E1; background: #F8FAFC;'} }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
