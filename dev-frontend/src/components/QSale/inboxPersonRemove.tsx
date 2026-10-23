// inboxPersonRemove — 상담 ✕ 를 누르면 **같은 고객의 다른 상담도** 한 번에 치울지 묻는다 (2026-10-23)
//
// Irene: *"상담 하나 지울 때 이 고객 거 다 지우냐고 물어봐. 한번에 지우게."*
//
// ★ 새 서버 문을 만들지 않는다 — 행마다 **지금 ✕ 가 부르는 문 그대로**(보관·채팅 빼기·단계 없음·영구 빼기)를
//   차례로 부른다. 그래서 권한·기록·되돌리기는 한 건씩 치울 때와 완전히 같다(일괄 문이 넓어질 자리가 없다).
// ★ «같은 고객» = 같은 등록 고객(client_id) 또는 같은 이메일 주소. 둘 다 없으면 묶지 않는다(이름만으로는 묶지 않는다).
// ★ 버튼에 적는 수 = 실제로 부르는 수 = 지금 목록에 보이는 그 사람의 행(CLAUDE.md Q mail ④ — 수는 약속이다).
//   단계 없음은 고객 단위라 같은 고객 행이 여럿이어도 한 번만 부른다(행은 모두 빠진다).
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../Common/ConfirmDialog';
import { dismissInboxItem, purgeInboxItem, setSaleStage, forEachInboxThread, type SaleInboxItem } from '../../services/sale';

export type RemovalKind = 'purge' | 'demote_chat' | 'dismiss_mail' | 'clear_stage';

/** 이 행의 ✕ 가 하는 일 — SaleInboxList 의 ✕ 분기와 같은 순서·같은 판정 */
export function removalOf(it: SaleInboxItem): RemovalKind | null {
  if (it.source === 'dismissed') return it.ref.kind === 'email_thread' ? 'purge' : null;
  if (it.ref.kind === 'conversation' && it.meta?.promoted) return 'demote_chat';
  if (it.ref.kind === 'email_thread') return 'dismiss_mail';
  return clientIdOf(it) ? 'clear_stage' : null; // 고객이 없는 행에 단계를 걸면 고객이 새로 생긴다 — 묶음에서는 빼둔다
}

function clientIdOf(it: SaleInboxItem): number | null {
  return it.client_id ?? (it.ref.kind === 'client' ? it.ref.id : null);
}

export function personKeyOf(it: SaleInboxItem): string | null {
  const cid = clientIdOf(it);
  if (cid) return `c:${cid}`;
  const em = (it.email || '').trim().toLowerCase();
  return em ? `e:${em}` : null;
}

/** 같은 사람의 다른 행(치울 수 있는 것만) — 보관함이면 보관함 행끼리, 상담이면 상담 행끼리 */
export function siblingsOf(it: SaleInboxItem, rows: SaleInboxItem[]): SaleInboxItem[] {
  const key = personKeyOf(it);
  if (!key) return [];
  const inArchive = it.source === 'dismissed';
  return rows.filter((r) => r.id !== it.id
    && (r.source === 'dismissed') === inArchive
    && removalOf(r) !== null
    && personKeyOf(r) === key);
}

/** 한 행 치우기 — 단건 ✕ 확인창이 부르던 것과 같은 문 */
export async function removeOne(businessId: number, it: SaleInboxItem): Promise<void> {
  const kind = removalOf(it);
  // 메일 줄은 그 사람의 스레드 묶음이다 — 묶음 전부에 같은 문(services/sale.forEachInboxThread)
  if (kind === 'purge') await forEachInboxThread(it, (id) => purgeInboxItem(businessId, 'email_thread', id));
  else if (kind === 'demote_chat') await dismissInboxItem(businessId, 'conversation', it.ref.id);
  else if (kind === 'dismiss_mail') await forEachInboxThread(it, (id) => dismissInboxItem(businessId, 'email_thread', id));
  else if (kind === 'clear_stage') {
    const cid = clientIdOf(it) as number;
    await setSaleStage(businessId, cid, { to: 'none', source_ref: { kind: it.ref.kind, id: it.ref.id, title: it.title || it.preview || null } });
  }
}

/** 여러 행 치우기 — 고객 단위 동작(단계 없음)은 고객마다 한 번. 실패가 있으면 던진다(삼키지 않는다). */
export async function removeMany(businessId: number, rows: SaleInboxItem[]): Promise<void> {
  const stageDone = new Set<number>();
  let failed = 0;
  for (const it of rows) {
    if (removalOf(it) === 'clear_stage') {
      const cid = clientIdOf(it) as number;
      if (stageDone.has(cid)) continue;
      stageDone.add(cid);
    }
    try { await removeOne(businessId, it); } catch { failed += 1; }
  }
  if (failed) throw new Error(`remove_failed:${failed}`);
}

/** «이 고객의 상담 N건을 모두 치울까요?» — [취소] [이것만] [모두 치우기 (N)] */
export const PersonRemoveDialog: React.FC<{
  ask: { it: SaleInboxItem; rows: SaleInboxItem[] } | null;
  onClose: () => void;
  onOnlyThis: (it: SaleInboxItem) => void;
  onAll: (rows: SaleInboxItem[]) => void;
}> = ({ ask, onClose, onOnlyThis, onAll }) => {
  const { t } = useTranslation('qsale');
  const n = ask ? ask.rows.length : 0;
  const archive = ask?.it.source === 'dismissed';
  return (
    <ConfirmDialog
      isOpen={!!ask}
      title={t(archive ? 'inbox.personPurgeTitle' : 'inbox.personRemoveTitle', { n, who: ask?.it.who || ask?.it.email || '—' }) as string}
      message={t(archive ? 'inbox.personPurgeBody' : 'inbox.personRemoveBody') as string}
      confirmText={t(archive ? 'inbox.personPurgeAll' : 'inbox.personRemoveAll', { n }) as string}
      secondaryText={t('inbox.personRemoveOnly') as string}
      cancelText={t('inquiry.cancel') as string}
      variant="danger"
      onClose={onClose}
      onSecondary={() => { if (ask) onOnlyThis(ask.it); }}
      onConfirm={() => { if (ask) onAll(ask.rows); }}
    />
  );
};

/** 목록이 쓰는 한 벌 — ✕ 를 누르면 묶을 행이 있는지 보고, 있으면 위 창을 띄운다. */
export function usePersonRemove({ businessId, rows, busyId, setBusyId, setActionError, errorText, selectedId, clearSelected, reload }: {
  businessId: number; rows: SaleInboxItem[]; busyId: string | null;
  setBusyId: (v: string | null) => void; setActionError: (v: string | null) => void; errorText: string;
  selectedId: string | null; clearSelected: () => void; reload: () => Promise<void> | void;
}) {
  const [ask, setAsk] = useState<{ it: SaleInboxItem; rows: SaleInboxItem[] } | null>(null);
  const askRemove = useCallback((it: SaleInboxItem, single: () => void) => {
    const sib = siblingsOf(it, rows);
    if (sib.length) setAsk({ it, rows: [it, ...sib] }); else single();
  }, [rows]);
  const run = useCallback(async (targets: SaleInboxItem[], fn: () => Promise<void>) => {
    setAsk(null);
    if (busyId) return;
    setBusyId(targets[0].id); setActionError(null);
    try { await fn(); } catch { setActionError(errorText); }
    finally {
      if (selectedId && targets.some((r) => r.id === selectedId)) clearSelected();
      setBusyId(null);
      await reload();
    }
  }, [busyId, setBusyId, setActionError, errorText, selectedId, clearSelected, reload]);
  const personDialog = (
    <PersonRemoveDialog ask={ask} onClose={() => setAsk(null)}
      onOnlyThis={(it) => { void run([it], () => removeOne(businessId, it)); }}
      onAll={(rs) => { void run(rs, () => removeMany(businessId, rs)); }} />
  );
  return { askRemove, personDialog };
}
