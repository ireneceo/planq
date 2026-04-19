// 프로세스 파트 탭 — 계층 테이블 + 커스텀 상태/컬럼
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import PlanQSelect from '../../components/Common/PlanQSelect';

interface StatusOpt { id: number; status_key: string; label: string; color: string | null; order_index: number; }
interface CustomCol { id: number; col_key: string; label: string; col_type: 'text' | 'date' | 'select' | 'number'; order_index: number; }
interface PartRow {
  id: number; project_id: number;
  depth1: string | null; depth2: string | null; depth3: string | null;
  description: string | null; status_key: string | null;
  link: string | null; notes: string | null;
  extra: Record<string, unknown> | null;
  order_index: number;
}

type Props = { projectId: number };

const ProcessPartsTab: React.FC<Props> = ({ projectId }) => {
  const [rows, setRows] = useState<PartRow[]>([]);
  const [statusOpts, setStatusOpts] = useState<StatusOpt[]>([]);
  const [customCols, setCustomCols] = useState<CustomCol[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusEditOpen, setStatusEditOpen] = useState(false);
  const [colEditOpen, setColEditOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pr, sr, cr] = await Promise.all([
        apiFetch(`/api/projects/${projectId}/process-parts`).then(r => r.json()),
        apiFetch(`/api/projects/${projectId}/status-options`).then(r => r.json()),
        apiFetch(`/api/projects/${projectId}/process-columns`).then(r => r.json()),
      ]);
      if (pr.success) setRows(pr.data || []);
      if (sr.success) setStatusOpts(sr.data || []);
      if (cr.success) setCustomCols(cr.data || []);
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const addRow = async () => {
    const r = await apiFetch(`/api/projects/${projectId}/process-parts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ depth1: '새 항목' }),
    });
    const j = await r.json();
    if (j.success) setRows(prev => [...prev, j.data]);
  };

  const updateRow = async (id: number, patch: Partial<PartRow>) => {
    setRows(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
    await apiFetch(`/api/projects/${projectId}/process-parts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
  };

  const delRow = async (id: number) => {
    setRows(prev => prev.filter(x => x.id !== id));
    await apiFetch(`/api/projects/${projectId}/process-parts/${id}`, { method: 'DELETE' });
  };

  // 드래그 앤 드롭 순서 변경
  const [dragId, setDragId] = useState<number | null>(null);
  const onDragStart = (id: number) => setDragId(id);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = async (targetId: number) => {
    if (dragId == null || dragId === targetId) return;
    const fromIdx = rows.findIndex(r => r.id === dragId);
    const toIdx = rows.findIndex(r => r.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...rows];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    // re-index
    const reindexed = next.map((r, i) => ({ ...r, order_index: i + 1 }));
    setRows(reindexed);
    setDragId(null);
    // 서버에 각 행 순서 저장 (백그라운드)
    await Promise.all(reindexed.map(r =>
      apiFetch(`/api/projects/${projectId}/process-parts/${r.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_index: r.order_index })
      })
    ));
  };

  const statusByKey = useMemo(() => {
    const m: Record<string, StatusOpt> = {};
    for (const s of statusOpts) m[s.status_key] = s;
    return m;
  }, [statusOpts]);

  if (loading) return <Empty>로드 중...</Empty>;

  return (
    <Wrap>
      <Toolbar>
        <ToolbarBtn type="button" onClick={addRow}>+ 행 추가</ToolbarBtn>
        <ToolbarBtn type="button" onClick={() => setStatusEditOpen(true)}>⚙ 상태 관리</ToolbarBtn>
        <ToolbarBtn type="button" onClick={() => setColEditOpen(true)}>⊞ 컬럼 관리</ToolbarBtn>
      </Toolbar>

      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th $w={24}></Th>
              <Th $w={140}>1depth</Th>
              <Th $w={140}>2depth</Th>
              <Th $w={140}>3depth</Th>
              <Th>설명</Th>
              <Th $w={110}>상태</Th>
              <Th $w={160}>URL</Th>
              <Th $w={140}>비고</Th>
              {customCols.map(c => <Th key={c.id} $w={120}>{c.label}</Th>)}
              <Th $w={40}></Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><Td colSpan={8 + customCols.length + 1} style={{ textAlign: 'center', color: '#94A3B8', padding: 24 }}>행이 없습니다. [+ 행 추가]</Td></tr>
            )}
            {rows.map(row => (
              <tr key={row.id}
                draggable
                onDragStart={() => onDragStart(row.id)}
                onDragOver={onDragOver}
                onDrop={() => onDrop(row.id)}
                style={{ cursor: 'grab' }}
              >
                <Td><DragHandle title="드래그하여 순서 변경">⋮⋮</DragHandle></Td>
                <Td><CellInput defaultValue={row.depth1 || ''} onBlur={e => updateRow(row.id, { depth1: e.target.value || null })} /></Td>
                <Td><CellInput defaultValue={row.depth2 || ''} onBlur={e => updateRow(row.id, { depth2: e.target.value || null })} /></Td>
                <Td><CellInput defaultValue={row.depth3 || ''} onBlur={e => updateRow(row.id, { depth3: e.target.value || null })} /></Td>
                <Td><CellInput defaultValue={row.description || ''} onBlur={e => updateRow(row.id, { description: e.target.value || null })} /></Td>
                <Td>
                  <StatusWrap style={{ background: statusByKey[row.status_key || '']?.color ? statusByKey[row.status_key || '']!.color + '22' : '#F8FAFC' }}>
                    <PlanQSelect size="sm" isClearable isSearchable={false}
                      menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                      value={row.status_key ? { value: row.status_key, label: statusByKey[row.status_key]?.label || row.status_key } : null}
                      onChange={(v) => {
                        const val = (v as { value?: string } | null)?.value || null;
                        updateRow(row.id, { status_key: val });
                      }}
                      options={statusOpts.map(s => ({ value: s.status_key, label: s.label }))} />
                  </StatusWrap>
                </Td>
                <Td><CellInput defaultValue={row.link || ''} onBlur={e => updateRow(row.id, { link: e.target.value || null })} placeholder="https://" /></Td>
                <Td><CellInput defaultValue={row.notes || ''} onBlur={e => updateRow(row.id, { notes: e.target.value || null })} /></Td>
                {customCols.map(c => (
                  <Td key={c.id}>
                    <CellInput
                      type={c.col_type === 'date' ? 'date' : c.col_type === 'number' ? 'number' : 'text'}
                      defaultValue={String((row.extra || {})[c.col_key] ?? '')}
                      onBlur={e => {
                        const extra = { ...(row.extra || {}), [c.col_key]: e.target.value };
                        updateRow(row.id, { extra });
                      }}
                    />
                  </Td>
                ))}
                <Td><DelBtn type="button" onClick={() => delRow(row.id)}>×</DelBtn></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      {statusEditOpen && (
        <StatusEditor
          projectId={projectId}
          opts={statusOpts}
          onClose={() => setStatusEditOpen(false)}
          onChange={setStatusOpts}
        />
      )}
      {colEditOpen && (
        <ColumnEditor
          projectId={projectId}
          cols={customCols}
          onClose={() => setColEditOpen(false)}
          onChange={setCustomCols}
        />
      )}
    </Wrap>
  );
};

// ──────────────────────────
// 상태 관리 모달
// ──────────────────────────
const StatusEditor: React.FC<{
  projectId: number; opts: StatusOpt[]; onClose: () => void; onChange: (list: StatusOpt[]) => void;
}> = ({ projectId, opts, onClose, onChange }) => {
  const [local, setLocal] = useState<StatusOpt[]>(opts);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#94A3B8');

  const add = async () => {
    if (!newKey.trim() || !newLabel.trim()) return;
    const r = await apiFetch(`/api/projects/${projectId}/status-options`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status_key: newKey.trim(), label: newLabel.trim(), color: newColor }),
    });
    const j = await r.json();
    if (j.success) {
      const next = [...local, j.data];
      setLocal(next); onChange(next);
      setNewKey(''); setNewLabel(''); setNewColor('#94A3B8');
    }
  };
  const update = async (id: number, patch: Partial<StatusOpt>) => {
    setLocal(prev => { const next = prev.map(x => x.id === id ? { ...x, ...patch } : x); onChange(next); return next; });
    await apiFetch(`/api/projects/${projectId}/status-options/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
  };
  const remove = async (id: number) => {
    setLocal(prev => { const next = prev.filter(x => x.id !== id); onChange(next); return next; });
    await apiFetch(`/api/projects/${projectId}/status-options/${id}`, { method: 'DELETE' });
  };

  return (
    <Backdrop onClick={onClose}>
      <Modal onClick={e => e.stopPropagation()}>
        <ModalTitle>상태 관리</ModalTitle>
        <ModalList>
          {local.map(s => (
            <Row2 key={s.id}>
              <ColorPicker type="color" value={s.color || '#94A3B8'} onChange={e => update(s.id, { color: e.target.value })} />
              <RowInput defaultValue={s.label} onBlur={e => update(s.id, { label: e.target.value })} />
              <KeyHint>{s.status_key}</KeyHint>
              <RowDel type="button" onClick={() => remove(s.id)}>×</RowDel>
            </Row2>
          ))}
        </ModalList>
        <AddRow>
          <ColorPicker type="color" value={newColor} onChange={e => setNewColor(e.target.value)} />
          <RowInput value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="key (영문 소문자)" />
          <RowInput value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="라벨" />
          <AddBtn type="button" onClick={add}>+ 추가</AddBtn>
        </AddRow>
        <ModalBtnRow>
          <ModalPrimary type="button" onClick={onClose}>완료</ModalPrimary>
        </ModalBtnRow>
      </Modal>
    </Backdrop>
  );
};

// ──────────────────────────
// 사용자 정의 컬럼 관리 모달
// ──────────────────────────
const ColumnEditor: React.FC<{
  projectId: number; cols: CustomCol[]; onClose: () => void; onChange: (list: CustomCol[]) => void;
}> = ({ projectId, cols, onClose, onChange }) => {
  const [local, setLocal] = useState<CustomCol[]>(cols);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState<CustomCol['col_type']>('text');

  const add = async () => {
    if (!newKey.trim() || !newLabel.trim()) return;
    const r = await apiFetch(`/api/projects/${projectId}/process-columns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ col_key: newKey.trim(), label: newLabel.trim(), col_type: newType }),
    });
    const j = await r.json();
    if (j.success) {
      const next = [...local, j.data];
      setLocal(next); onChange(next);
      setNewKey(''); setNewLabel(''); setNewType('text');
    }
  };
  const remove = async (id: number) => {
    setLocal(prev => { const next = prev.filter(x => x.id !== id); onChange(next); return next; });
    await apiFetch(`/api/projects/${projectId}/process-columns/${id}`, { method: 'DELETE' });
  };

  return (
    <Backdrop onClick={onClose}>
      <Modal onClick={e => e.stopPropagation()}>
        <ModalTitle>사용자 정의 컬럼</ModalTitle>
        <ModalList>
          {local.map(c => (
            <Row2 key={c.id}>
              <RowText><strong>{c.label}</strong><KeyHint>{c.col_key} · {c.col_type}</KeyHint></RowText>
              <RowDel type="button" onClick={() => remove(c.id)}>×</RowDel>
            </Row2>
          ))}
        </ModalList>
        <AddRow>
          <RowInput value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="key" />
          <RowInput value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="라벨" />
          <div style={{ flex: '0 0 110px' }}>
            <PlanQSelect size="sm"
              value={{ value: newType, label: { text: '텍스트', date: '날짜', number: '숫자', select: '선택' }[newType] }}
              onChange={(v) => setNewType(((v as { value?: CustomCol['col_type'] } | null)?.value) || 'text')}
              options={[
                { value: 'text', label: '텍스트' },
                { value: 'date', label: '날짜' },
                { value: 'number', label: '숫자' },
                { value: 'select', label: '선택' },
              ]} />
          </div>
          <AddBtn type="button" onClick={add}>+ 추가</AddBtn>
        </AddRow>
        <ModalBtnRow>
          <ModalPrimary type="button" onClick={onClose}>완료</ModalPrimary>
        </ModalBtnRow>
      </Modal>
    </Backdrop>
  );
};

export default ProcessPartsTab;

// ─── styled ───
const Wrap = styled.div``;
const Toolbar = styled.div`display:flex;gap:6px;margin-bottom:10px;`;
const ToolbarBtn = styled.button`padding:6px 12px;border:1px solid #CBD5E1;background:#FFF;color:#334155;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;&:hover{border-color:#14B8A6;color:#0F766E;}`;
const TableWrap = styled.div`background:#FFF;border:1px solid #E2E8F0;border-radius:8px;overflow:auto;`;
const Table = styled.table`width:100%;border-collapse:collapse;font-size:12px;`;
const Th = styled.th<{$w?:number}>`text-align:left;padding:8px 10px;font-size:11px;font-weight:700;color:#64748B;background:#F8FAFC;border-bottom:1px solid #E2E8F0;${p=>p.$w?`width:${p.$w}px;`:''}`;
const Td = styled.td`padding:4px 6px;border-bottom:1px solid #F1F5F9;vertical-align:middle;`;
const CellInput = styled.input`width:100%;padding:4px 6px;border:1px solid transparent;border-radius:4px;font-size:12px;color:#0F172A;background:transparent;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;background:#FFF;}&:hover{background:#F8FAFC;}`;
const StatusWrap = styled.div`padding:1px 2px;border-radius:4px;min-width:90px;`;
const DelBtn = styled.button`width:24px;height:24px;border:none;background:transparent;color:#94A3B8;cursor:pointer;border-radius:4px;font-size:14px;&:hover{background:#FEE2E2;color:#DC2626;}`;
const Empty = styled.div`padding:40px;text-align:center;color:#94A3B8;font-size:12px;`;
const DragHandle = styled.span`display:inline-block;color:#CBD5E1;cursor:grab;user-select:none;font-size:14px;line-height:1;&:hover{color:#14B8A6;}`;

const Backdrop = styled.div`position:fixed;inset:0;background:rgba(15,23,42,0.4);z-index:100;display:flex;align-items:center;justify-content:center;`;
const Modal = styled.div`background:#FFF;border-radius:10px;padding:20px;width:480px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;gap:10px;`;
const ModalTitle = styled.h3`margin:0;font-size:16px;font-weight:700;color:#0F172A;`;
const ModalList = styled.div`display:flex;flex-direction:column;gap:6px;flex:1;overflow-y:auto;`;
const Row2 = styled.div`display:flex;align-items:center;gap:8px;padding:6px 8px;background:#F8FAFC;border-radius:6px;`;
const RowInput = styled.input`flex:1 1 120px;min-width:0;height:32px;padding:0 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;font-family:inherit;box-sizing:border-box;&:focus{outline:none;border-color:#14B8A6;}`;
const RowText = styled.div`flex:1;display:flex;flex-direction:column;gap:2px;strong{font-size:13px;color:#0F172A;}`;
const KeyHint = styled.span`font-size:10px;color:#94A3B8;font-family:monospace;`;
const ColorPicker = styled.input`flex:0 0 32px;width:32px;height:32px;padding:0;border:1px solid #E2E8F0;border-radius:6px;cursor:pointer;`;
const RowDel = styled.button`width:24px;height:24px;border:none;background:transparent;color:#94A3B8;cursor:pointer;font-size:14px;&:hover{color:#DC2626;}`;
const AddRow = styled.div`display:flex;gap:6px;padding-top:12px;border-top:1px solid #E2E8F0;flex-wrap:wrap;align-items:stretch;`;
const AddBtn = styled.button`flex:0 0 auto;padding:0 14px;height:32px;background:#FFF;color:#334155;border:1px solid #CBD5E1;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;&:hover:not(:disabled){border-color:#14B8A6;color:#0F766E;background:#F8FAFC;}&:disabled{opacity:0.5;cursor:not-allowed;}`;
const ModalBtnRow = styled.div`display:flex;justify-content:flex-end;`;
const ModalPrimary = styled.button`padding:7px 14px;background:#14B8A6;color:#FFF;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;&:hover{background:#0D9488;}`;
