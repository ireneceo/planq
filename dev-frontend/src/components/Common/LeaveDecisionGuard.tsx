// 로그아웃 전에 확인 — 범위를 골라야 저장되는 글(반복 업무 설명)이 남았을 때 (2026-09-11, 입력 초안 라운드 2)
//
// Irene 결정: 반복 업무 설명을 쓰다 저장 전에 로그아웃하면 "로그아웃 전에 확인" — 글이 조용히 사라지지 않게.
//   로그아웃은 그 사람 초안을 지운다(공용 PC 보호, D-C5). 반복 업무 설명은 적용 범위를 물어야 서버로 갈 수 있어
//   떠나는 순간 보낼 방법이 없다. 그래서 로그아웃이 **멈추고 여기서 묻는다.**
//
// 흐름: AuthContext.logout → flushPendingSaves(열린 업무 드로어가 걸려 있던 설명을 로컬 초안으로 넘긴다)
//       → series 초안이 있으면 LOGOUT_BLOCKED_EVENT → 이 창.
//   항목마다 범위를 골라 [저장] — 서버 원문이 **초안을 쓰기 시작할 때의 원문**과 같을 때만 저장한다
//   (그 사이 누가 고쳤으면 덮어쓰지 않는다) · [버리고 로그아웃] · [취소]. 전부 저장되면 로그아웃을 이어 간다.
// ★ App 루트 한 곳에 둔다 — ModeGate 가 탭·셸 두 렌더 트리로 갈라져 안쪽에 두면 한쪽 창에서만 뜬다.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from './StandardModal';
import ActionButton from './ActionButton';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { listDraftRecords, clearDraftRecord } from '../../services/draftStore';
import { LOGOUT_BLOCKED_EVENT } from '../../services/pendingSaves';
import type { SeriesScope } from '../QTask/SeriesScopeDialog';

type ItemStatus = 'idle' | 'saving' | 'saved' | 'changed' | 'failed';
interface Item {
  key: string;
  biz: string;
  taskId: number;
  label: string;
  value: string;
  base: string;
  scope: SeriesScope | null;
  status: ItemStatus;
}

const SCOPES: SeriesScope[] = ['single', 'future', 'all'];
const norm = (s: string) => s.replace(/<p>\s*<\/p>/gi, '').trim();

const LeaveDecisionGuard: React.FC = () => {
  const { t } = useTranslation('common');
  const { t: tq } = useTranslation('qtask');
  const { user, logout } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const collect = useCallback((): Item[] => {
    if (!user?.id) return [];
    return listDraftRecords<string>(['task-description'], user.id)
      .filter((d) => d.record.series && typeof d.record.value === 'string' && Number(d.entity) > 0)
      .map((d) => ({
        key: d.key, biz: d.biz, taskId: Number(d.entity), label: d.record.label || '',
        value: d.record.value, base: d.record.base ?? '', scope: null, status: 'idle' as ItemStatus,
      }));
  }, [user?.id]);

  useEffect(() => {
    const onBlocked = () => { const list = collect(); if (list.length) setItems(list); };
    window.addEventListener(LOGOUT_BLOCKED_EVENT, onBlocked);
    return () => window.removeEventListener(LOGOUT_BLOCKED_EVENT, onBlocked);
  }, [collect]);

  // 전부 저장되면 로그아웃을 이어 간다(남은 초안이 없으니 이번에는 멈추지 않는다)
  useEffect(() => {
    if (!items || !items.length || !items.every((i) => i.status === 'saved')) return;
    setItems(null);
    void logout();
  }, [items, logout]);

  const patchItem = (key: string, patch: Partial<Item>) =>
    setItems((prev) => (prev ? prev.map((i) => (i.key === key ? { ...i, ...patch } : i)) : prev));

  const save = async (it: Item) => {
    if (!it.scope || it.status === 'saving' || it.status === 'saved') return;
    patchItem(it.key, { status: 'saving' });
    try {
      const dr = await apiFetch(`/api/tasks/${it.taskId}/detail`);
      if (!dr.ok) { patchItem(it.key, { status: 'failed' }); return; }
      const dj = await dr.json().catch(() => null);
      const server = String(dj?.data?.description || '');
      // 이미 같은 글이 서버에 있다 — 보낼 것이 없다
      if (norm(server) === norm(it.value)) { clearDraftRecord(it.key); patchItem(it.key, { status: 'saved' }); return; }
      // 그 사이 다른 곳에서 설명이 바뀌었다 — 덮어쓰지 않는다
      if (norm(server) !== norm(it.base)) { patchItem(it.key, { status: 'changed' }); return; }
      const r = await apiFetch(`/api/tasks/by-business/${it.biz}/${it.taskId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: it.value, series_scope: it.scope }),
      });
      if (!r.ok) { patchItem(it.key, { status: 'failed' }); return; }
      clearDraftRecord(it.key);
      patchItem(it.key, { status: 'saved' });
    } catch {
      patchItem(it.key, { status: 'failed' });
    }
  };

  const discard = async () => {
    if (!items || discarding) return;
    setDiscarding(true);
    items.forEach((i) => clearDraftRecord(i.key));
    setItems(null);
    try { await logout({ discardUnsaved: true }); } finally { setDiscarding(false); }
  };

  if (!items) return null;
  const anySaving = items.some((i) => i.status === 'saving');

  return (
    <StandardModal
      open
      onClose={() => { if (!anySaving) setItems(null); }}
      title={t('draft.leaveTitle', '저장하지 않은 반복 업무 설명이 있어요') as string}
      size="md"
      closeOnBackdrop={false}
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={() => setItems(null)} disabled={anySaving || discarding} data-testid="leave-cancel">
            {t('draft.leaveCancel', '취소')}
          </ActionButton>
          <ActionButton tone="danger" size="md" onClick={() => void discard()} disabled={anySaving || discarding} data-testid="leave-discard">
            {t('draft.leaveDiscard', '버리고 로그아웃')}
          </ActionButton>
        </>
      )}
    >
      <Wrap data-testid="leave-decision">
        <Desc>{t('draft.leaveDesc', '반복 업무의 설명은 어디까지 반영할지 골라야 저장돼요. 저장하거나 버린 뒤 로그아웃할 수 있어요.')}</Desc>
        {items.map((it) => {
          const locked = it.status === 'saving' || it.status === 'saved';
          return (
            <Row key={it.key} data-testid="leave-item">
              <Name>{it.label || t('draft.leaveUntitled', { id: it.taskId, defaultValue: '업무 #{{id}}' })}</Name>
              <Scopes role="radiogroup" aria-label={t('draft.leaveScope', '적용 범위') as string}>
                {SCOPES.map((s) => (
                  <ScopeBtn
                    key={s} type="button" role="radio" aria-checked={it.scope === s} $on={it.scope === s}
                    disabled={locked}
                    onClick={() => patchItem(it.key, { scope: s, status: it.status === 'failed' ? 'idle' : it.status })}
                    data-testid={`leave-scope-${s}`}
                  >
                    {tq(`series.${s}`)}
                  </ScopeBtn>
                ))}
              </Scopes>
              <RowFoot>
                {it.status === 'changed' && <Msg $err>{t('draft.leaveChanged', '그 사이 다른 곳에서 설명이 바뀌어 덮어쓰지 않았어요. 업무에서 확인해 주세요.')}</Msg>}
                {it.status === 'failed' && <Msg $err>{t('draft.leaveFailed', '저장하지 못했어요. 다시 시도해 주세요.')}</Msg>}
                {it.status === 'saved'
                  ? <Msg>{t('draft.leaveSaved', '저장했어요')}</Msg>
                  : (
                    <ActionButton
                      tone="primary" size="sm" onClick={() => void save(it)}
                      disabled={!it.scope || it.status === 'saving' || it.status === 'changed'}
                      data-testid="leave-save"
                    >
                      {it.status === 'saving' ? t('draft.leaveSaving', '저장 중…') : t('draft.leaveSave', '저장')}
                    </ActionButton>
                  )}
              </RowFoot>
            </Row>
          );
        })}
      </Wrap>
    </StandardModal>
  );
};

export default LeaveDecisionGuard;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const Desc = styled.p`margin: 0; font-size: 0.8125rem; color: #64748B; line-height: 1.5;`;
const Row = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; border: 1px solid #E2E8F0; border-radius: 10px; background: #F8FAFC;
`;
const Name = styled.div`font-size: 0.875rem; font-weight: 600; color: #0F172A; overflow-wrap: anywhere;`;
const Scopes = styled.div`display: flex; flex-wrap: wrap; gap: 6px;`;
const ScopeBtn = styled.button<{ $on: boolean }>`
  min-height: 36px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
  font-size: 0.8125rem; font-weight: 600;
  border: 1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};
  background: ${(p) => (p.$on ? '#F0FDFA' : '#fff')};
  color: ${(p) => (p.$on ? '#0F766E' : '#334155')};
  &:disabled { cursor: default; opacity: 0.6; }
  &:focus-visible { outline: 2px solid #99F6E4; outline-offset: 1px; }
`;
const RowFoot = styled.div`display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap;`;
const Msg = styled.span<{ $err?: boolean }>`font-size: 0.75rem; color: ${(p) => (p.$err ? '#B91C1C' : '#0F766E')};`;
