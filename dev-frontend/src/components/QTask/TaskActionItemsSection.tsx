// TaskActionItemsSection — 업무 상세 «결과물 액션» 칸 (2026-10-12, 설계 docs/TASK_ACTIONS_DESIGN.md §4.1)
//
// Irene: *"결과물을 문서로 만들어야 하면 문서작성하게 보내고 … 일정을 추가하게 보내고 … 액션추가라고 해서
//   결과적으로 할 일을 넣어두고 안내하면 더 쉬울 것 같은데"*
//
// 자리: 결과물 Section 바로 위. 업무에 «만들 것» 을 적어 두고(작성자·담당자·owner·admin),
//   담당자가 [문서 만들기 ↗]·[일정 추가 ↗] 로 그 화면에 **새 탭**으로 가서 만든다 — 저장되면 서버가 이 행에 건다.
//   체크를 손으로 눌러 완료하는 것은 없다 — 완료는 «만들어진 것» 으로만 된다(결과물에 뭐가 들어갔는지 모르는 완료를 만들지 않는다).
// 판정은 서버(services/taskActionItems) 한 곳 — 화면은 응답의 can_edit·can_perform 만 본다(스스로 세지 않는다).
// 실시간: 다른 탭에서 문서를 만들거나 발행하면 서버가 task:updated 를 쏜다 → 이 칸이 다시 읽는다(§16).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import { onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { tabStore } from '../../stores/tabStore';
import OverflowMenu, { type OverflowItem } from '../Common/OverflowMenu';
import ConfirmDialog from '../Common/ConfirmDialog';
import AutoSaveField from '../Common/AutoSaveField';
import { isComposingEvent } from '../../utils/imeKey';

type Kind = 'doc' | 'event' | 'mail' | 'project';
type Status = 'pending' | 'active' | 'completed' | 'skipped';
interface Target {
  type: 'post' | 'calendar_event' | 'email_thread' | 'project';
  id: number;
  hidden?: boolean;
  deleted?: boolean;
  title?: string;
  status?: string;
  start_at?: string;
  all_day?: boolean;
}
interface ActionItem {
  id: number;
  kind: Kind;
  label: string;
  note: string | null;
  status: Status;
  linked_entity_type: Target['type'] | null;
  linked_entity_id: number | null;
  target: Target | null;
}
interface ListData {
  items: ActionItem[];
  can_edit: boolean;
  can_perform: boolean;
  has_assignee: boolean;
  is_recurring_parent: boolean;
  kinds: Kind[];
}
interface PickRow { id: number; title: string; sub?: string }

interface Props { taskId: number; businessId: number | null }

// 종류 → 만들러 가는 주소 · 연 것을 여는 주소. 화면 주소는 여기 한 곳.
const goPath = (it: ActionItem) => (it.kind === 'doc' ? `/docs?from_action=${it.id}` : `/calendar?new=1&from_action=${it.id}`);
const openPath = (it: ActionItem) => (it.linked_entity_type === 'post' ? `/docs?post=${it.linked_entity_id}` : `/calendar?event=${it.linked_entity_id}`);

const fmtWhen = (iso?: string, allDay?: boolean) => {
  if (!iso) return '';
  const d = new Date(iso);
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return allDay ? md : `${md} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const TaskActionItemsSection: React.FC<Props> = ({ taskId, businessId }) => {
  const { t } = useTranslation('qtask');
  const [data, setData] = useState<ListData | null>(null);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<Kind>('doc');
  const [newLabel, setNewLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const renameRef = useRef('');
  const [confirmDel, setConfirmDel] = useState<ActionItem | null>(null);
  const [picking, setPicking] = useState<ActionItem | null>(null);
  const [pickQ, setPickQ] = useState('');
  const [pickRows, setPickRows] = useState<PickRow[]>([]);
  const [pickBusy, setPickBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/tasks/${taskId}/actions`);
      const j = await r.json().catch(() => null);
      if (r.ok && j?.success) setData(j.data as ListData);
      else setData(null);
    } catch { /* 다음 갱신에 다시 */ }
  }, [taskId]);

  useEffect(() => { setData(null); setAdding(false); setPicking(null); setRenaming(null); void load(); }, [load]);
  // §16 — 다른 탭에서 문서·일정을 만들면 서버가 task:updated 를 쏜다(이 업무만 다시 읽는다)
  useEffect(() => {
    let timer: number | null = null;
    const off = onSocket<{ id?: number }>('task:updated', (row) => {
      if (Number(row?.id) !== taskId) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void load(); }, 250);
    });
    return () => { off(); if (timer) window.clearTimeout(timer); };
  }, [taskId, load]);
  useVisibilityRefresh(load);

  const doneCount = useMemo(() => (data?.items || []).filter((i) => i.status === 'completed').length, [data]);
  const activeTotal = useMemo(() => (data?.items || []).filter((i) => i.status !== 'skipped').length, [data]);

  const call = useCallback(async (method: string, path: string, body?: unknown): Promise<boolean> => {
    setErr(null);
    const r = await apiFetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) {
      const code = j?.message || 'failed';
      setErr(t(`resultActions.error.${code}`, { defaultValue: t('resultActions.error.failed') as string }) as string);
      return false;
    }
    return true;
  }, [t]);

  const submitNew = async () => {
    if (submitting || !newLabel.trim()) return;
    setSubmitting(true);
    try {
      if (await call('POST', `/api/tasks/${taskId}/actions`, { kind: newKind, label: newLabel.trim() })) {
        setNewLabel(''); setAdding(false); await load();
      }
    } finally { setSubmitting(false); }
  };

  const go = (it: ActionItem) => tabStore.openInNewTab(goPath(it));
  const open = (it: ActionItem) => tabStore.openInNewTab(openPath(it));

  // «기존 것 연결» — 문서는 Q docs 검색, 일정은 앞뒤 기간 목록을 제목으로 거른다. 볼 수 있는 것만 서버가 준다.
  useEffect(() => {
    if (!picking || !businessId) return;
    let alive = true;
    const h = window.setTimeout(async () => {
      setPickBusy(true);
      try {
        if (picking.kind === 'doc') {
          const q = pickQ.trim();
          const r = await apiFetch(`/api/posts?business_id=${businessId}&limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`);
          const j = await r.json().catch(() => null);
          const rows = (j?.data || []) as Array<{ id: number; title: string; status?: string; kind?: string }>;
          if (alive) setPickRows(rows.filter((p) => p.kind !== 'template').map((p) => ({ id: p.id, title: p.title, sub: p.status === 'draft' ? (t('resultActions.status.active') as string) : undefined })));
        } else {
          const start = new Date(Date.now() - 60 * 86400000).toISOString();
          const end = new Date(Date.now() + 180 * 86400000).toISOString();
          const r = await apiFetch(`/api/calendar/by-business/${businessId}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
          const j = await r.json().catch(() => null);
          const seen = new Set<number>();
          const q = pickQ.trim().toLowerCase();
          const rows = ((j?.data || []) as Array<{ id: number; title: string; start_at: string; all_day?: boolean }>)
            .filter((e) => { if (seen.has(e.id)) return false; seen.add(e.id); return !q || String(e.title || '').toLowerCase().includes(q); })
            .slice(0, 20)
            .map((e) => ({ id: e.id, title: e.title, sub: fmtWhen(e.start_at, e.all_day) }));
          if (alive) setPickRows(rows);
        }
      } catch { if (alive) setPickRows([]); }
      finally { if (alive) setPickBusy(false); }
    }, 250);
    return () => { alive = false; window.clearTimeout(h); };
  }, [picking, pickQ, businessId, t]);

  const linkExisting = async (row: PickRow) => {
    if (!picking || submitting) return;
    setSubmitting(true);
    try {
      const ok = await call('POST', `/api/tasks/${taskId}/actions/${picking.id}/link`, {
        entity_type: picking.kind === 'doc' ? 'post' : 'calendar_event', entity_id: row.id,
      });
      if (ok) { setPicking(null); setPickQ(''); await load(); }
    } finally { setSubmitting(false); }
  };

  if (!data) return null;
  const { items, can_edit: canEdit, can_perform: canPerform, has_assignee: hasAssignee } = data;
  if (!items.length && !canEdit) return null;   // 적을 수 없고 적힌 것도 없으면 칸을 그리지 않는다

  const kindIcon = (k: Kind) => (k === 'doc' ? <DocIcon /> : <CalIcon />);
  const goDisabledReason = !hasAssignee ? t('resultActions.noAssignee') : t('resultActions.assigneeOnly');

  return (
    <Wrap data-testid="task-actions">
      <Head>
        <Title>{t('resultActions.title')}</Title>
        {activeTotal > 0 && <Count data-testid="task-actions-count">{doneCount}/{activeTotal}</Count>}
        {canEdit && !adding && (
          <AddBtn type="button" data-testid="task-actions-add" onClick={() => { setAdding(true); setNewKind(data.kinds[0] || 'doc'); setErr(null); }}>
            <PlusIcon />{t('resultActions.add')}
          </AddBtn>
        )}
      </Head>

      {adding && (
        <AddForm>
          <KindRow role="radiogroup" aria-label={t('resultActions.kindLabel') as string}>
            {data.kinds.map((k) => (
              <KindBtn key={k} type="button" role="radio" aria-checked={newKind === k} $on={newKind === k}
                data-testid={`task-actions-kind-${k}`} onClick={() => setNewKind(k)}>
                {kindIcon(k)}{t(`resultActions.kind.${k}`)}
              </KindBtn>
            ))}
          </KindRow>
          {/* draft-exempt: 한 줄 이름(최대 200자) — 누르면 바로 추가되는 짧은 입력, Esc/취소로 버린다 */}
          <LabelInput
            autoFocus
            data-testid="task-actions-label"
            value={newLabel}
            maxLength={200}
            placeholder={t('resultActions.labelPlaceholder') as string}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (isComposingEvent(e)) return;
              if (e.key === 'Escape') { setAdding(false); setNewLabel(''); }
              // Enter 단독 저장 금지 — Ctrl/⌘+Enter 만
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submitNew(); }
            }}
          />
          <FormBtns>
            <GhostBtn type="button" onClick={() => { setAdding(false); setNewLabel(''); }}>{t('common.cancel', '취소')}</GhostBtn>
            <PrimaryBtn type="button" data-testid="task-actions-submit" disabled={submitting || !newLabel.trim()} onClick={() => void submitNew()}>
              {t('resultActions.addSubmit')}
            </PrimaryBtn>
          </FormBtns>
        </AddForm>
      )}

      {err && <ErrLine role="alert">{err}</ErrLine>}

      {items.length === 0 && !adding && <Empty>{t('resultActions.empty')}</Empty>}

      <List>
        {items.map((it) => {
          const linked = !!it.linked_entity_id;
          const tg = it.target;
          const menu: OverflowItem[] = [];
          if (canEdit) menu.push({ key: 'rename', label: t('resultActions.rename'), testId: `task-action-rename-${it.id}`, onClick: () => { setRenaming(it.id); setRenameVal(it.label); renameRef.current = it.label; } });
          if (canEdit && !linked) {
            if (it.status === 'skipped') menu.push({ key: 'unskip', label: t('resultActions.unskip'), onClick: () => { void call('PATCH', `/api/tasks/${taskId}/actions/${it.id}`, { status: 'pending' }).then(load); } });
            else menu.push({ key: 'skip', label: t('resultActions.skip'), testId: `task-action-skip-${it.id}`, onClick: () => { void call('PATCH', `/api/tasks/${taskId}/actions/${it.id}`, { status: 'skipped' }).then(load); } });
          }
          if (canPerform && linked) menu.push({ key: 'unlink', label: t('resultActions.unlink'), testId: `task-action-unlink-${it.id}`, onClick: () => { void call('DELETE', `/api/tasks/${taskId}/actions/${it.id}/link`).then(load); } });
          if (canEdit && !linked) menu.push({ key: 'del', label: t('resultActions.delete'), danger: true, dividerBefore: menu.length > 0, testId: `task-action-delete-${it.id}`, onClick: () => setConfirmDel(it) });
          return (
            <Row key={it.id} data-testid={`task-action-row-${it.id}`} data-status={it.status} $skipped={it.status === 'skipped'}>
              <RowMain>
                <StatusMark $s={it.status} aria-label={t(`resultActions.status.${it.status}`) as string} title={t(`resultActions.status.${it.status}`) as string} />
                <KindMark aria-hidden>{kindIcon(it.kind)}</KindMark>
                {renaming === it.id ? (
                  <RenameWrap>
                    <AutoSaveField key={`rename-${it.id}`} type="input" onSave={async () => {
                      const v = renameRef.current.trim();
                      if (!v || v === it.label) return;
                      const ok = await call('PATCH', `/api/tasks/${taskId}/actions/${it.id}`, { label: v });
                      if (!ok) throw new Error('rename_failed');
                      await load();
                    }}>
                      <LabelInput
                        autoFocus
                        value={renameVal}
                        maxLength={200}
                        aria-label={t('resultActions.rename') as string}
                        onChange={(e) => { setRenameVal(e.target.value); renameRef.current = e.target.value; }}
                        onKeyDown={(e) => { if (isComposingEvent(e)) return; if (e.key === 'Escape' || e.key === 'Enter') setRenaming(null); }}
                        onBlur={() => setRenaming(null)}
                      />
                    </AutoSaveField>
                  </RenameWrap>
                ) : (
                  <Label title={it.label} $skipped={it.status === 'skipped'}>{it.label}</Label>
                )}
                {menu.length > 0 && (
                  <MenuSlot>
                    <OverflowMenu items={menu} label={t('resultActions.more') as string} data-testid={`task-action-more-${it.id}`} />
                  </MenuSlot>
                )}
              </RowMain>
              <RowSub>
                {it.status === 'pending' && (
                  <>
                    <GoBtn type="button" data-testid={`task-action-go-${it.id}`} disabled={!canPerform}
                      title={!canPerform ? goDisabledReason as string : undefined}
                      onClick={() => go(it)}>
                      {t(`resultActions.go.${it.kind}`)} <ExtIcon />
                    </GoBtn>
                    {canPerform && (
                      <GhostBtn type="button" data-testid={`task-action-link-existing-${it.id}`}
                        onClick={() => { setPicking(picking?.id === it.id ? null : it); setPickQ(''); setPickRows([]); }}>
                        {t('resultActions.linkExisting')}
                      </GhostBtn>
                    )}
                    {!canPerform && <Hint>{goDisabledReason}</Hint>}
                  </>
                )}
                {linked && tg && (
                  tg.deleted ? <MutedChip>{t('resultActions.deleted')}</MutedChip>
                    : tg.hidden ? <MutedChip>{t('resultActions.hidden')}</MutedChip>
                      : (
                        <OpenLink type="button" data-testid={`task-action-open-${it.id}`} onClick={() => open(it)} title={tg.title}>
                          {it.status === 'active' && <ActiveTag>{t('resultActions.status.active')}</ActiveTag>}
                          <OpenText>{tg.title}{tg.start_at ? ` · ${fmtWhen(tg.start_at, tg.all_day)}` : ''}</OpenText>
                          <ExtIcon />
                        </OpenLink>
                      )
                )}
              </RowSub>
              {picking?.id === it.id && (
                <Picker>
                  {/* draft-exempt: 검색어 — 저장할 글이 아니다 */}
                  <LabelInput autoFocus value={pickQ} data-testid={`task-action-pick-q-${it.id}`}
                    placeholder={t(it.kind === 'doc' ? 'resultActions.pickDocPlaceholder' : 'resultActions.pickEventPlaceholder') as string}
                    onChange={(e) => setPickQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setPicking(null); }} />
                  {pickBusy ? <Empty>{t('resultActions.searching')}</Empty>
                    : pickRows.length === 0 ? <Empty>{t('resultActions.pickEmpty')}</Empty>
                      : (
                        <PickList>
                          {pickRows.map((r) => (
                            <PickItem key={r.id} type="button" disabled={submitting} onClick={() => void linkExisting(r)}>
                              <PickTitle>{r.title}</PickTitle>{r.sub && <PickSub>{r.sub}</PickSub>}
                            </PickItem>
                          ))}
                        </PickList>
                      )}
                </Picker>
              )}
            </Row>
          );
        })}
      </List>

      {data.is_recurring_parent && items.length > 0 && <Hint as="p">{t('resultActions.recurringHint')}</Hint>}

      <ConfirmDialog
        isOpen={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => {
          const it = confirmDel; setConfirmDel(null);
          if (it) void call('DELETE', `/api/tasks/${taskId}/actions/${it.id}`).then(load);
        }}
        title={t('resultActions.delete')}
        message={t('resultActions.deleteConfirm', { label: confirmDel?.label || '' })}
        confirmText={t('resultActions.delete') as string}
        variant="danger"
      />
    </Wrap>
  );
};

export default TaskActionItemsSection;

// ─── 아이콘 ───
const DocIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>);
const CalIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>);
const ExtIcon = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>);
const PlusIcon = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>);

// ─── Styled ───
const Wrap = styled.div`display:flex;flex-direction:column;gap:8px;`;
const Head = styled.div`display:flex;align-items:center;gap:8px;min-height:32px;`;
const Title = styled.h4`margin:0;font-size:0.8125rem;font-weight:600;color:#475569;`;
const Count = styled.span`display:inline-flex;align-items:center;justify-content:center;min-width:28px;padding:1px 6px;line-height:1.45;border-radius:8px;background:#F1F5F9;color:#475569;font-size:0.6875rem;font-weight:700;`;
const AddBtn = styled.button`
  margin-left:auto;display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 12px;
  background:transparent;color:#0F766E;border:1px dashed #CBD5E1;border-radius:8px;
  font-size:0.75rem;font-weight:500;cursor:pointer;font-family:inherit;
  &:hover{background:#F0FDFA;border-color:#14B8A6;border-style:solid;}
  @media (max-width:640px){height:40px;}
`;
const AddForm = styled.div`display:flex;flex-direction:column;gap:8px;padding:10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;`;
const KindRow = styled.div`display:flex;gap:6px;flex-wrap:wrap;`;
const KindBtn = styled.button<{ $on: boolean }>`
  display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;cursor:pointer;font-family:inherit;
  font-size:0.75rem;font-weight:600;border:1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};
  background:${(p) => (p.$on ? '#F0FDFA' : '#fff')};color:${(p) => (p.$on ? '#0F766E' : '#475569')};
  @media (max-width:640px){height:40px;}
`;
const LabelInput = styled.input`
  width:100%;box-sizing:border-box;height:36px;padding:0 10px;border:1px solid #CBD5E1;border-radius:6px;
  font-size:0.8125rem;color:#0F172A;background:#fff;font-family:inherit;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}
`;
const FormBtns = styled.div`display:flex;justify-content:flex-end;gap:6px;`;
const GhostBtn = styled.button`
  display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 12px;border:1px solid #E2E8F0;background:#fff;border-radius:6px;
  font-size:0.75rem;font-weight:500;color:#475569;cursor:pointer;font-family:inherit;white-space:nowrap;
  &:hover{background:#F1F5F9;}
  @media (max-width:640px){height:40px;}
`;
const PrimaryBtn = styled(GhostBtn)`
  background:#14B8A6;border-color:#14B8A6;color:#fff;font-weight:600;
  &:hover:not(:disabled){background:#0D9488;}
  &:disabled{opacity:0.5;cursor:not-allowed;}
`;
const ErrLine = styled.div`font-size:0.75rem;color:#DC2626;`;
const Empty = styled.div`padding:4px 0;font-size:0.75rem;color:#94A3B8;`;
const List = styled.div`display:flex;flex-direction:column;gap:6px;`;
const Row = styled.div<{ $skipped: boolean }>`
  display:flex;flex-direction:column;gap:6px;padding:8px 10px;border:1px solid #E2E8F0;border-radius:8px;background:#fff;
  opacity:${(p) => (p.$skipped ? 0.6 : 1)};
`;
const RowMain = styled.div`display:flex;align-items:center;gap:8px;min-width:0;`;
const StatusMark = styled.span<{ $s: Status }>`
  flex-shrink:0;width:14px;aspect-ratio:1;border-radius:4px;box-sizing:border-box;
  border:2px solid ${(p) => (p.$s === 'completed' ? '#14B8A6' : p.$s === 'active' ? '#14B8A6' : '#CBD5E1')};
  background:${(p) => (p.$s === 'completed' ? '#14B8A6' : p.$s === 'active' ? 'linear-gradient(90deg,#14B8A6 50%,#fff 50%)' : '#fff')};
  ${(p) => (p.$s === 'skipped' ? 'background:repeating-linear-gradient(45deg,#E2E8F0 0 2px,#fff 2px 4px);' : '')}
`;
const KindMark = styled.span`flex-shrink:0;display:inline-flex;color:#64748B;`;
const Label = styled.span<{ $skipped: boolean }>`
  flex:1;min-width:0;font-size:0.8125rem;color:#0F172A;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  ${(p) => (p.$skipped ? 'text-decoration:line-through;color:#94A3B8;' : '')}
`;
const RenameWrap = styled.div`flex:1;min-width:0;`;
const MenuSlot = styled.div`flex-shrink:0;margin-left:auto;`;
const RowSub = styled.div`
  display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-left:22px;
  &:empty{display:none;}
  @media (max-width:640px){padding-left:0;}
`;
const GoBtn = styled(PrimaryBtn)`
  @media (max-width:640px){flex:1 1 auto;justify-content:center;}
`;
const Hint = styled.span`font-size:0.75rem;color:#94A3B8;margin:0;`;
const MutedChip = styled.span`display:inline-flex;align-items:center;padding:3px 8px;line-height:1.5;border-radius:6px;background:#F1F5F9;color:#94A3B8;font-size:0.75rem;`;
const OpenLink = styled.button`
  display:inline-flex;align-items:center;gap:6px;max-width:100%;min-height:32px;padding:2px 8px;border-radius:6px;
  border:1px solid #CCFBF1;background:#F0FDFA;color:#0F766E;font-size:0.75rem;font-weight:500;cursor:pointer;font-family:inherit;
  &:hover{background:#CCFBF1;}
  @media (max-width:640px){min-height:40px;}
`;
const OpenText = styled.span`overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;`;
const ActiveTag = styled.span`flex-shrink:0;padding:0 6px;border-radius:4px;background:#FEF3C7;color:#92400E;font-size:0.6875rem;font-weight:600;`;
const Picker = styled.div`display:flex;flex-direction:column;gap:6px;padding:8px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;`;
const PickList = styled.div`display:flex;flex-direction:column;gap:2px;max-height:220px;overflow-y:auto;`;
const PickItem = styled.button`
  display:flex;align-items:center;gap:8px;min-height:36px;padding:6px 10px;background:#fff;border:1px solid #E2E8F0;border-radius:6px;
  cursor:pointer;text-align:left;font-family:inherit;
  &:hover:not(:disabled){background:#F0FDFA;border-color:#14B8A6;}
  &:disabled{opacity:0.5;cursor:not-allowed;}
`;
const PickTitle = styled.span`flex:1;min-width:0;font-size:0.8125rem;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const PickSub = styled.span`flex-shrink:0;font-size:0.6875rem;color:#94A3B8;`;
