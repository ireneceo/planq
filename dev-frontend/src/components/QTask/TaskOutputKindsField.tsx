// TaskOutputKindsField — 업무 상세의 «산출물» 칸 (docs/TASK_DELIVERABLES_DESIGN.md §6.1·6.2)
//
//   드로어(god-file)에 인라인하지 않고 여기 한 벌 — 라벨 줄(«산출물» + 멤버에게 «목록 관리») ·
//   고칠 수 있으면 Picker(이 칸이 직접 PUT 저장, 반복 업무면 범위를 묻는다) · 아니면 칩(읽기).
//   고칠 수 있는 사람 = 태그와 같은 축(작성자·담당자·owner·admin, 고객 제외 — 서버 setOutputKinds 와 같은 집합).
//   값이 비었고 고칠 수도 없으면 줄 전체를 그리지 않는다.
//   고객이면 사전 API 를 부르지 않는다(403 — 치지도 않는다).
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField, { type AutoSaveHandle } from '../Common/AutoSaveField';
import OutputKindPicker from './OutputKindPicker';
import OutputKindChips from './OutputKindChips';
import OutputKindManageModal from './OutputKindManageModal';
import SeriesScopeDialog, { type SeriesScope } from './SeriesScopeDialog';
import { useTaskOutputKindDict } from './useTaskOutputKindDict';
import type { OutputKindLite } from './outputKindLabel';
import { MetaLock } from './metaLock';

interface Props {
  bizId: number | null;
  taskId: number;
  value: OutputKindLite[];
  canEdit: boolean;
  /** 고객 보기 — 칩만, 사전 호출 없음 */
  isClient: boolean;
  /** 반복 시리즈면 저장 전에 범위를 묻는다(태그와 같은 창) */
  isSeries: boolean;
  dueDate?: string | null;
  onSaved: (next: OutputKindLite[]) => void;
}

const TaskOutputKindsField: React.FC<Props> = ({ bizId, taskId, value, canEdit, isClient, isSeries, dueDate, onSaved }) => {
  const { t } = useTranslation('qtask');
  const editable = canEdit && !isClient;
  const dict = useTaskOutputKindDict(bizId, !isClient);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<OutputKindLite[] | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  // 자동저장 — stage(화면만) / persist(저장)를 가른다. 최신값·범위는 ref 로 읽는다(클로저는 바뀌기 전 값을 본다).
  const [local, setLocal] = useState<OutputKindLite[]>(value);
  useEffect(() => { setLocal(value); }, [value]);
  const latestRef = useRef<{ list: OutputKindLite[]; scope?: SeriesScope }>({ list: value });
  const saveRef = useRef<AutoSaveHandle>(null);

  const stage = (next: OutputKindLite[], scope?: SeriesScope) => {
    if (!scope && isSeries) { setAsk(next); return; }
    setLocal(next); setErr(null);
    latestRef.current = { list: next, scope };
    saveRef.current?.triggerSave();
  };
  const persist = async () => {
    const { list, scope } = latestRef.current;
    const r = await apiFetch(`/api/tasks/${taskId}/output-kinds`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output_kind_ids: list.map((k) => k.id), ...(scope ? { series_scope: scope } : {}) }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) {
      setErr(t('outputs.saveFailed', '산출물을 저장하지 못했습니다') as string);
      setLocal(value);
      throw new Error('save_failed');   // 던져야 ! 표시가 뜬다
    }
    onSaved((j.data?.output_kinds || []) as OutputKindLite[]);
  };

  if (!editable && value.length === 0) return null;

  return (
    <Wrap data-testid="task-output-kinds">
      <Head>
        <Label>{t('outputs.label', '산출물')}</Label>
        {!editable && <MetaLock title={t('detail.readOnly', '읽기 전용') as string} aria-label={t('detail.readOnly', '읽기 전용') as string} />}
        {!isClient && (
          <ManageBtn type="button" onClick={() => setManageOpen(true)} data-testid="task-output-kinds-manage">
            {t('outputs.manage', '목록 관리')}
          </ManageBtn>
        )}
      </Head>
      {editable ? (
        <>
          {/* 업무마다 드로어가 이 칸을 key 로 갈라 다시 그린다 — 떠난 업무의 대기분이 새 업무로 가지 않게 */}
          <AutoSaveField key={`ok-${taskId}`} ref={saveRef} type="select" onSave={persist} style={{ display: 'block' }}>
            <OutputKindPicker bizId={bizId} rows={dict.rows} pendingPresets={dict.pendingPresets} value={local}
              onChange={(next) => stage(next)} onDictAdd={dict.add} testId="task-output-kinds-picker" />
          </AutoSaveField>
          <Hint>{t('outputs.clientHint', '고객이 보는 업무에서는 산출물 이름이 고객에게도 보입니다')}</Hint>
        </>
      ) : (
        <OutputKindChips items={value} />
      )}
      {err && <ErrText role="alert">{err}</ErrText>}
      <SeriesScopeDialog open={!!ask} variant="content" dueDate={dueDate ?? null}
        onClose={() => setAsk(null)}
        onPick={(scope) => { const next = ask; setAsk(null); if (next) stage(next, scope); }} />
      {!isClient && (
        <OutputKindManageModal open={manageOpen} onClose={() => setManageOpen(false)} bizId={bizId}
          rows={dict.rows} onChanged={() => { void dict.reload(); }} />
      )}
    </Wrap>
  );
};

export default TaskOutputKindsField;

const Wrap = styled.div`margin-top:12px;display:flex;flex-direction:column;gap:6px;min-width:0;`;
const Head = styled.div`display:flex;align-items:center;gap:6px;`;
const Label = styled.span`font-size:0.6875rem;font-weight:600;color:#64748B;`;
const ManageBtn = styled.button`
  margin-left:auto;border:none;background:none;padding:2px 4px;font-size:0.6875rem;font-weight:600;color:#0D9488;cursor:pointer;
  &:hover{text-decoration:underline;}
`;
const Hint = styled.div`font-size:0.6875rem;color:#94A3B8;`;
const ErrText = styled.div`font-size:0.75rem;color:#DC2626;`;
