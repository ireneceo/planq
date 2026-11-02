// 자동 히스토리 한 줄의 «설명 줄» — 보기 + 고치기 + 원래대로 (2026-11-02)
//
// Irene: *"프로젝트나 업무상세 같은 곳에 남는 자동기록 히스토리를 수동으로 수정하고 싶어 …
//         자동생성이 다시 또 되면서 엉망이 안되게 … 각 항목별 글자 수정"*
// 설계 docs/HISTORY_OVERRIDE_DESIGN.md (Fable 설계 판정). 서버 `services/historyOverrides` 가 원장은 그대로 두고
// 고친 글을 읽을 때 덧입힌다 — 그래서 자동 기록이 다시 만들어져도 고친 글이 남는다.
//
// 쓰는 곳(같은 컴포넌트 한 벌): 프로젝트 > 히스토리 탭 · 업무 상세 히스토리 · 프로젝트 상세정보 «상태 이력» 카드.
// ★ 부모 줄은 `position: relative` 여야 한다 — 설명이 없는 줄의 [＋ 설명] 단추는 줄 오른쪽 위에 겹쳐 놓는다
//   (줄마다 한 줄을 더 먹으면 히스토리가 두 배로 길어진다).
// ★ 줄이 링크(<a>)면 고치는 동안 부모가 링크를 끈다 — onEditingChange 로 알린다(입력칸이 링크 안에 있으면 누르는 순간 이동한다).
import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from './ActionButton';
import { apiFetch } from '../../contexts/AuthContext';
import { formatDayTime } from '../../utils/dateFormat';
// 쓰다 만 설명은 남는다(가드 --category=draft)
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';

export interface HistoryRef { source_table: string; source_id: number; }

/** 서버가 주는 칸 — 고칠 수 있는 줄에만 history_ref·editable 이 온다(고객에게는 안 온다) */
export interface HistoryNoteFields {
  note?: string | null;
  note_original?: string | null;
  edited_by_name?: string | null;
  edited_at?: string | null;
  editable?: string[];
  history_ref?: HistoryRef;
}

interface Props {
  row: HistoryNoteFields;
  /** qnote·상담 기록처럼 원장만으로 프로젝트가 정해지지 않는 줄의 프로젝트 */
  projectId?: number;
  /** 이 글을 고객도 보는가 — 편집기에 한 줄 안내 */
  clientSees?: boolean;
  /** 저장·원래대로 뒤 — 부모가 목록을 다시 읽는다(소켓 신호도 오지만 내 화면은 바로) */
  onChanged?: () => void;
  onEditingChange?: (editing: boolean) => void;
  /** 부모가 열림을 쥘 때(제어) — 줄이 링크↔상자로 바뀌며 다시 그려져도 편집기가 닫히지 않게 */
  editing?: boolean;
  /** 설명 줄 모양 — 줄마다 배경이 다르다(히스토리 탭·업무 타임라인·상태 카드) */
  variant?: 'box' | 'inline';
}

const MAX = 1000;
const stop = (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); };

export default function HistoryNote({ row, projectId, clientSees, onChanged, onEditingChange, editing: editingProp, variant = 'box' }: Props) {
  const { t } = useTranslation('common');
  const canEdit = !!row.history_ref && !!row.editable?.includes('note');
  const edited = row.note_original !== undefined;
  // ★ 제어/비제어 — 히스토리 탭은 고치는 동안 줄을 링크에서 상자로 바꾼다. 그 순간 이 컴포넌트가 다시 그려지므로
  //   열림을 안에만 두면 연필을 누르자마자 닫혔다(3폭 실측: 편집기 0). 부모가 쥐면(editing prop) 그 값을 따른다.
  const [editingLocal, setEditingLocal] = useState(false);
  const controlled = editingProp !== undefined;
  const editing = controlled ? !!editingProp : editingLocal;
  const setEditing = (v: boolean) => {
    if (!controlled) setEditingLocal(v);
    onEditingChange?.(v);
  };
  const [showOrig, setShowOrig] = useState(false);

  const open = (e: React.SyntheticEvent) => { stop(e); setEditing(true); };

  if (editing && row.history_ref) {
    return (
      <NoteEditor row={row} historyRef={row.history_ref} projectId={projectId} clientSees={clientSees} edited={edited}
        onDone={() => { setEditing(false); onChanged?.(); }} onCancel={() => setEditing(false)} />
    );
  }

  const editedTitle = edited
    ? (t('historyNote.editedBy', { defaultValue: '{{name}} · {{at}} 수정', name: row.edited_by_name || '—', at: row.edited_at ? formatDayTime(row.edited_at, { year: 'always' }) : '' }) as string)
    : undefined;

  if (!row.note) {
    if (!canEdit) return null;
    return (
      <AddBtn type="button" data-testid="history-note-add" onClick={open}
        aria-label={t('historyNote.add', '설명 남기기') as string}
        title={t('historyNote.add', '설명 남기기') as string}>
        <PencilIcon />
      </AddBtn>
    );
  }

  return (
    <NoteRow $variant={variant} data-testid="history-note">
      <NoteText>{row.note}</NoteText>
      {edited && (
        <EditedTag type="button" title={editedTitle} aria-label={editedTitle} data-testid="history-note-edited"
          onClick={(e) => { stop(e); setShowOrig((v) => !v); }}>
          {t('historyNote.edited', '수정됨') as string}
        </EditedTag>
      )}
      {canEdit && (
        <EditBtn type="button" data-testid="history-note-edit" onClick={open}
          aria-label={t('historyNote.edit', '설명 고치기') as string} title={t('historyNote.edit', '설명 고치기') as string}>
          <PencilIcon />
        </EditBtn>
      )}
      {edited && showOrig && (
        <OrigInline>
          {editedTitle}
          {row.note_original ? ` — ${t('historyNote.original', '원래 글')}: ${row.note_original}` : ` — ${t('historyNote.originalEmpty', '원래 설명 없음')}`}
        </OrigInline>
      )}
    </NoteRow>
  );
}

/** 고치는 동안만 뜨는 편집기 — 쓰다 만 글은 남는다(초안 kind 'history-note', 원문이 바뀌면 옛 초안을 버린다) */
function NoteEditor({ row, historyRef, projectId, clientSees, edited, onDone, onCancel }: {
  row: HistoryNoteFields; historyRef: HistoryRef; projectId?: number; clientSees?: boolean; edited: boolean;
  onDone: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation('common');
  const draft = useDraftText(useDraftKey('history-note', `${historyRef.source_table}:${historyRef.source_id}`, null), { base: row.note ?? '' });
  const [busy, setBusy] = useState<'save' | 'restore' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const path = `/api/history-overrides/${historyRef.source_table}/${historyRef.source_id}`;

  // 처음 열 때 — 남겨 둔 초안이 없으면 지금 글에서 시작한다
  useEffect(() => {
    if (!draft.restored && !draft.text && row.note) draft.setText(row.note);
    // 터치 기기는 열자마자 키보드가 폼을 덮지 않게 — 마우스일 때만 커서를 넣는다
    if (window.matchMedia?.('(pointer: fine)').matches) setTimeout(() => areaRef.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [draft.text]);

  const cancel = (e?: React.SyntheticEvent) => { if (e) stop(e); draft.clear(); onCancel(); };   // 명시 취소 = 초안도 버린다

  const save = async (e: React.SyntheticEvent) => {
    stop(e);
    const note = draft.text.trim();
    if (busy || !note || note.length > MAX) return;     // 중복 제출 가드
    setBusy('save'); setErr(null);
    try {
      const r = await apiFetch(path, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, ...(projectId ? { project_id: projectId } : {}) }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(t('historyNote.failed', '저장하지 못했어요.') as string); return; }
      draft.clear();                                     // 비우는 곳은 성공뿐
      onDone();
    } catch {
      setErr(t('historyNote.failed', '저장하지 못했어요.') as string);
    } finally { setBusy(null); }
  };

  const restore = async (e: React.SyntheticEvent) => {
    stop(e);
    if (busy) return;
    setBusy('restore'); setErr(null);
    try {
      const q = projectId ? `?project_id=${projectId}` : '';
      const r = await apiFetch(`${path}${q}`, { method: 'DELETE' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(t('historyNote.failed', '저장하지 못했어요.') as string); return; }
      draft.clear();
      onDone();
    } catch {
      setErr(t('historyNote.failed', '저장하지 못했어요.') as string);
    } finally { setBusy(null); }
  };

  const len = draft.text.trim().length;
  return (
    // 링크 줄 안에서도 눌러 이동하지 않게 — 편집기 안의 모든 누름을 여기서 멈춘다
    <Editor data-testid="history-note-editor" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      {/* autosave-exempt: 한 줄 설명은 [저장] 을 누를 때 보낸다 — 원래대로·취소가 같이 있는 작은 편집기(쓰다 만 글은 초안으로 남는다) */}
      <Area ref={areaRef} rows={2} maxLength={MAX + 200} data-testid="history-note-input" data-draft-kind="history-note"
        placeholder={t('historyNote.placeholder', '이 줄에 남길 설명') as string}
        {...draft.bind}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(e);
        }} />
      <Meta>
        <Count $over={len > MAX}>{len}/{MAX}</Count>
        {clientSees && <Notice>{t('historyNote.clientSees', '이 업무를 볼 수 있는 고객이 있으면 같은 글을 봅니다.') as string}</Notice>}
      </Meta>
      {edited && row.note_original && (
        <Orig>{t('historyNote.original', '원래 글') as string}: {row.note_original}</Orig>
      )}
      {err && <Err role="alert">{err}</Err>}
      <Actions>
        {edited && (
          <ActionButton tone="secondary" size="sm" loading={busy === 'restore'} disabled={!!busy}
            data-testid="history-note-restore" onClick={restore}>
            {t('historyNote.restore', '원래대로') as string}
          </ActionButton>
        )}
        <RightGroup>
          <ActionButton tone="secondary" size="sm" disabled={!!busy} onClick={cancel}>
            {t('historyNote.cancel', '취소') as string}
          </ActionButton>
          <ActionButton tone="primary" size="sm" loading={busy === 'save'} disabled={!!busy || !len || len > MAX}
            data-testid="history-note-save" onClick={save}>
            {t('historyNote.save', '저장') as string}
          </ActionButton>
        </RightGroup>
      </Actions>
    </Editor>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

const NoteRow = styled.div<{ $variant: 'box' | 'inline' }>`
  margin-top: 3px; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px 6px;
  ${(p) => (p.$variant === 'box'
    ? 'padding:4px 4px 4px 10px;background:#F8FAFC;border-left:2px solid #CBD5E1;border-radius:0 6px 6px 0;'
    : 'padding:0;')}
  font-size: 0.78125rem; color: #475569; line-height: 1.5;
`;
const NoteText = styled.span`flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word; padding-top: 2px;`;
const EditedTag = styled.button`
  flex-shrink: 0; margin-top: 2px; padding: 1px 6px; border: 1px solid #E2E8F0; border-radius: 999px;
  background: #fff; color: #64748B; font-size: 0.6875rem; line-height: 1.5; cursor: pointer; font-family: inherit;
  &:hover { border-color: #5EEAD4; color: #0F766E; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 1px; }
`;
const iconBtn = `
  flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border: none; border-radius: 6px; background: transparent;
  color: #94A3B8; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F766E; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 1px; color: #0F766E; }
  @media (max-width: 640px) { width: 40px; height: 40px; }
`;
const EditBtn = styled.button`${iconBtn} margin: -4px 0;`;
/* 설명이 없는 줄 — 줄 오른쪽 위에 겹친다(부모 position:relative). 마우스 기기에선 줄에 올렸을 때만, 터치 기기에선 늘 보인다 */
const AddBtn = styled.button`
  ${iconBtn}
  position: absolute; top: 4px; right: 4px; z-index: 1;
  @media (hover: hover) and (pointer: fine) {
    opacity: 0;
    [data-history-row]:hover &, &:focus-visible { opacity: 1; }
  }
`;
const OrigInline = styled.div`flex-basis: 100%; font-size: 0.6875rem; color: #94A3B8; white-space: pre-wrap; word-break: break-word;`;

const Editor = styled.div`
  margin-top: 6px; display: flex; flex-direction: column; gap: 6px; width: 100%;
  padding: 8px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; cursor: default;
`;
const Area = styled.textarea`
  width: 100%; min-height: 56px; padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 6px; resize: none;
  font-size: 0.8125rem; color: #0F172A; font-family: inherit; line-height: 1.5; background: #fff;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
const Meta = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const Count = styled.span<{ $over: boolean }>`font-size: 0.6875rem; color: ${(p) => (p.$over ? '#B91C1C' : '#94A3B8')};`;
const Notice = styled.span`font-size: 0.6875rem; color: #B45309;`;
const Orig = styled.div`font-size: 0.6875rem; color: #64748B; white-space: pre-wrap; word-break: break-word;`;
const Err = styled.div`font-size: 0.75rem; color: #B91C1C;`;
const Actions = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const RightGroup = styled.span`margin-left: auto; display: inline-flex; gap: 6px;`;
