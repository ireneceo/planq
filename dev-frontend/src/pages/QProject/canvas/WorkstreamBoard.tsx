// 핵심 추진과제 보드 (D3 #65) — MECE 워크스트림 카드. 생성·수정·삭제·정렬.
import { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  createWorkstream, updateWorkstream, deleteWorkstream, reorderWorkstreams,
  wsColor, type Workstream,
} from '../../../services/projectCanvas';
import { PlusIcon, TrashIcon } from '../../../components/Common/Icons';
import PlanQSelect from '../../../components/Common/PlanQSelect';

interface Props {
  projectId: number;
  workstreams: Workstream[];
  onChanged: () => void;
  readOnly?: boolean;   // 개요 탭 보기전용(#167) — 추가·수정·삭제·정렬 어포던스 숨김
}

export default function WorkstreamBoard({ projectId, workstreams, onChanged, readOnly = false }: Props) {
  const { t } = useTranslation('qproject');
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDel, setConfirmDel] = useState<number | null>(null);

  const submitNew = async () => {
    if (!newTitle.trim() || busy) return;
    setBusy(true);
    try { await createWorkstream(projectId, { title: newTitle.trim() }); setNewTitle(''); setAdding(false); onChanged(); }
    finally { setBusy(false); }
  };
  const saveEdit = async (ws: Workstream) => {
    const title = editTitle.trim();
    setEditId(null);
    if (title && title !== ws.title) { await updateWorkstream(projectId, ws.id, { title }); onChanged(); }
  };
  const setStatus = async (ws: Workstream, status: string) => { await updateWorkstream(projectId, ws.id, { status }); onChanged(); };
  const doDelete = async (id: number) => { setConfirmDel(null); await deleteWorkstream(projectId, id); onChanged(); };
  const move = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= workstreams.length) return;
    const ids = workstreams.map((w) => w.id);
    [ids[idx], ids[target]] = [ids[target], ids[idx]];
    await reorderWorkstreams(projectId, ids);
    onChanged();
  };

  // 개요(readOnly) — 추진과제 없으면 편집 안내 대신 숨긴다(Irene).
  if (readOnly && workstreams.length === 0) return null;

  return (
    <div>
      {workstreams.length === 0 && !adding && <Empty>{t('canvas.workstreams.empty')}</Empty>}
      <Grid>
        {workstreams.map((ws, idx) => {
          const c = wsColor(ws, idx);
          const r = ws.rollup;
          return (
            <Card key={ws.id} $dim={ws.status === 'dropped'}>
              <Bar style={{ background: c }} />
              <CardBody>
                <TitleRow>
                  {editId === ws.id ? (
                    <TitleInput autoFocus value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => saveEdit(ws)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditId(null); }} />
                  ) : (
                    <Title as={readOnly ? 'div' : undefined} style={readOnly ? { cursor: 'default' } : undefined}
                      onClick={readOnly ? undefined : () => { setEditId(ws.id); setEditTitle(ws.title); }}>{ws.title}</Title>
                  )}
                  {!readOnly && (
                    <Reorder>
                      <MiniBtn type="button" disabled={idx === 0} onClick={() => move(idx, -1)} title="↑">↑</MiniBtn>
                      <MiniBtn type="button" disabled={idx === workstreams.length - 1} onClick={() => move(idx, 1)} title="↓">↓</MiniBtn>
                    </Reorder>
                  )}
                </TitleRow>
                {ws.description && <Desc>{ws.description}</Desc>}
                <ProgressTrack><ProgressFill style={{ width: `${r.progress_pct}%`, background: c }} /></ProgressTrack>
                <Meta>
                  <span>{r.total} {t('canvas.workstreams.tasks')}</span>
                  <Dot />{r.completed} {t('canvas.workstreams.done')}
                  <Dot />{r.in_progress} {t('canvas.workstreams.inProgress')}
                  {r.overdue > 0 && <><Dot /><Over>{r.overdue} {t('canvas.workstreams.overdue')}</Over></>}
                </Meta>
                {readOnly ? (
                  <Footer><StatusStatic>{t(`canvas.workstreams.status.${ws.status}`)}</StatusStatic></Footer>
                ) : (
                <Footer>
                  <StatusSelWrap>
                    <PlanQSelect size="sm" isSearchable={false}
                      value={{ value: ws.status, label: t(`canvas.workstreams.status.${ws.status}`) as string }}
                      options={['active', 'done', 'dropped'].map((s) => ({ value: s, label: t(`canvas.workstreams.status.${s}`) as string }))}
                      onChange={(v) => setStatus(ws, (v as { value: string }).value)} />
                  </StatusSelWrap>
                  {confirmDel === ws.id ? (
                    <ConfirmRow>
                      <ConfirmHint>{t('canvas.workstreams.delConfirm')}</ConfirmHint>
                      <DelYes type="button" onClick={() => doDelete(ws.id)}>{t('canvas.workstreams.del')}</DelYes>
                    </ConfirmRow>
                  ) : (
                    <IconBtn type="button" onClick={() => setConfirmDel(ws.id)} title={t('canvas.workstreams.del') as string}><TrashIcon size={14} /></IconBtn>
                  )}
                </Footer>
                )}
              </CardBody>
            </Card>
          );
        })}

        {readOnly ? null : adding ? (
          <AddCard>
            <AddInput autoFocus value={newTitle} placeholder={t('canvas.workstreams.titlePh') as string}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitNew(); if (e.key === 'Escape') { setAdding(false); setNewTitle(''); } }} />
            <AddActions>
              <SaveBtn type="button" disabled={busy || !newTitle.trim()} onClick={submitNew}>{t('canvas.workstreams.save')}</SaveBtn>
            </AddActions>
          </AddCard>
        ) : (
          <AddTile type="button" onClick={() => setAdding(true)}>
            <PlusIcon size={18} /><span>{t('canvas.workstreams.add')}</span>
          </AddTile>
        )}
      </Grid>
    </div>
  );
}

const Empty = styled.div`font-size:13px;color:#94A3B8;padding:8px 0 14px;`;
const Grid = styled.div`display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;`;
const Card = styled.div<{ $dim?: boolean }>`display:flex;background:#fff;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;opacity:${(p) => (p.$dim ? 0.6 : 1)};transition:box-shadow .15s;&:hover{box-shadow:0 4px 12px rgba(15,23,42,.06);}`;
const Bar = styled.div`width:5px;flex-shrink:0;`;
const CardBody = styled.div`flex:1;min-width:0;padding:14px 16px;`;
const TitleRow = styled.div`display:flex;align-items:center;gap:8px;`;
const Title = styled.div`flex:1;font-size:14px;font-weight:700;color:#0F172A;cursor:text;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const TitleInput = styled.input`flex:1;font-size:14px;font-weight:700;color:#0F172A;border:1px solid #14B8A6;border-radius:6px;padding:3px 8px;&:focus{outline:none;box-shadow:0 0 0 3px rgba(20,184,166,.15);}`;
const Reorder = styled.div`display:flex;gap:2px;flex-shrink:0;`;
const MiniBtn = styled.button`width:22px;height:22px;border:none;background:#F1F5F9;color:#64748B;border-radius:5px;font-size:12px;cursor:pointer;&:hover:not(:disabled){background:#E2E8F0;}&:disabled{opacity:.4;cursor:default;}`;
const Desc = styled.div`font-size:12px;color:#64748B;margin:6px 0 0;line-height:1.5;`;
const ProgressTrack = styled.div`height:6px;background:#F1F5F9;border-radius:999px;margin:12px 0 8px;overflow:hidden;`;
const ProgressFill = styled.div`height:100%;border-radius:999px;transition:width .3s;`;
const Meta = styled.div`display:flex;align-items:center;flex-wrap:wrap;gap:4px;font-size:11px;color:#64748B;`;
const Dot = styled.span`width:3px;height:3px;border-radius:50%;background:#CBD5E1;margin:0 3px;`;
const Over = styled.span`color:#EF4444;font-weight:600;`;
const Footer = styled.div`display:flex;align-items:center;gap:8px;margin-top:12px;`;
const StatusSelWrap = styled.div`min-width:104px;`;
const StatusStatic = styled.span`font-size:11px;font-weight:700;color:#64748B;background:#F1F5F9;border-radius:999px;padding:3px 10px;`;
const IconBtn = styled.button`display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;margin-left:auto;border:none;background:transparent;color:#CBD5E1;border-radius:6px;cursor:pointer;&:hover{background:#FEF2F2;color:#EF4444;}`;
const ConfirmRow = styled.div`display:flex;align-items:center;gap:8px;margin-left:auto;`;
const ConfirmHint = styled.span`font-size:11px;color:#64748B;`;
const DelYes = styled.button`height:28px;padding:0 10px;border:1px solid #EF4444;background:#fff;color:#EF4444;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;&:hover{background:#EF4444;color:#fff;}`;
const AddCard = styled.div`display:flex;flex-direction:column;justify-content:center;gap:8px;border:1px dashed #CBD5E1;border-radius:12px;padding:16px;`;
const AddInput = styled.input`height:36px;border:1px solid #E2E8F0;border-radius:8px;padding:0 10px;font-size:13px;&:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,.15);}`;
const AddActions = styled.div`display:flex;justify-content:flex-end;`;
const SaveBtn = styled.button`height:32px;padding:0 14px;border:none;background:#14B8A6;color:#fff;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;&:hover:not(:disabled){background:#0D9488;}&:disabled{opacity:.5;cursor:default;}`;
const AddTile = styled.button`display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:120px;border:1px dashed #CBD5E1;border-radius:12px;background:#fff;color:#64748B;font-size:13px;font-weight:600;cursor:pointer;&:hover{border-color:#14B8A6;color:#0F766E;background:#F0FDFA;}`;
