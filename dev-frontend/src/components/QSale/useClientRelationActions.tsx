// 고객 «관계» 액션 — 초대 보내기 · 계정 없이 정식 고객으로(직접 관리) (ClientPanel 에서 분리 2026-10-15)
//   할 수 있는가는 서버가 정한다 — `can_invite`(services/clientAccess.canInviteClient). 화면이 status 로 판정하지 않는다.
//   둘 다 되돌리기 어려운 일이라(메일 발송 · 한도 계수) 확인창을 거친다. 설계 docs/CLIENT_MANAGED_DESIGN.md
import { useCallback, useState } from 'react';
import type { TFunction } from 'i18next';
import { apiFetch } from '../../contexts/AuthContext';
import ConfirmDialog from '../Common/ConfirmDialog';
import type { SaleClientDetail } from '../../services/sale';

interface Args {
  businessId: number;
  cid: number | null | undefined;
  data: SaleClientDetail | null;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: boolean) => void;
  reload: () => Promise<void>;
  t: TFunction;
  /** 관리 행위(보관·되살리기)를 할 수 있는가 — 대표·플랫폼 관리자(서버 archive 라우트와 같은 술어) */
  canManage?: boolean;
  /** 거절 이유를 패널 안내줄에 — 토스트 금지 */
  setNotice?: (msg: string | null) => void;
}

export function useClientRelationActions({ businessId, cid, data, busy, setBusy, setError, reload, t, canManage = false, setNotice }: Args) {
  const [inviteAsk, setInviteAsk] = useState(false);
  const [managedAsk, setManagedAsk] = useState(false);

  const inviteEmail = data?.contact?.invite_email || data?.contact?.account_email || data?.email || '';
  // 우리 고객으로 들여오는 문 — 계정이 아직 없으면 초대를 보낼 수 있다(문의·직접 관리 고객)
  const canInvite = !!cid && !!data?.can_invite && !!inviteEmail;
  // 문의 고객 → 직접 관리 고객. 영업 단계는 그대로 두고 관계 축만 바꾼다
  const canRegisterManaged = !!cid && data?.status === 'prospect';
  // 보관 — 문의 고객은 보관하지 않는다(서버 409 prospect_use_stage · 종결은 «무산» 단계). 2026-10-16 설정 > 고객 에서 옮겼다
  const canArchive = !!cid && canManage && !!data?.status && data.status !== 'prospect';
  const archived = data?.status === 'archived';

  const run = useCallback(async (fn: () => Promise<Response>) => {
    if (!cid || busy) return;
    setBusy(true);
    try {
      const r = await fn();
      if (!r.ok) { setError(true); return; }
      await reload();
    } catch { setError(true); } finally { setBusy(false); }
  }, [cid, busy, setBusy, setError, reload]);

  // 초대 — 기존 라우트를 그대로 부른다(초대 메일·토큰·중복 판정이 전부 거기 있다)
  //   행 id 가 정본 — 그 행을 invited 로 올린다(새 행 X)
  const sendInvite = useCallback(() => run(() => apiFetch(`/api/clients/${businessId}/invite`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: data?.display_name || data?.company_name || inviteEmail,
      email: inviteEmail,
      company_name: data?.company_name || undefined,
      client_id: cid,
    }),
  })), [run, businessId, data, inviteEmail, cid]);

  const registerManaged = useCallback(() => run(() => apiFetch(
    `/api/clients/${businessId}/${cid}/register-managed`, { method: 'POST' },
  )), [run, businessId, cid]);

  const dialogs = (
    <>
      {/* ★ 발송 전 확인 — 주소를 **보여주고** 묻는다. "정말?" 만 묻는 창은 확인이 아니다. */}
      <ConfirmDialog
        isOpen={inviteAsk}
        title={t('action.inviteConfirmTitle') as string}
        message={t('action.inviteConfirmBody', { email: inviteEmail }) as string}
        confirmText={t('action.invite') as string}
        cancelText={t('inquiry.cancel') as string}
        variant="info"
        onClose={() => setInviteAsk(false)}
        onConfirm={() => { setInviteAsk(false); void sendInvite(); }}
      />
      <ConfirmDialog
        isOpen={managedAsk}
        title={t('action.registerManagedTitle') as string}
        message={t('action.registerManagedBody') as string}
        confirmText={t('action.registerManaged') as string}
        cancelText={t('inquiry.cancel') as string}
        variant="info"
        onClose={() => setManagedAsk(false)}
        onConfirm={() => { setManagedAsk(false); void registerManaged(); }}
      />
    </>
  );

  // 보관 ↔ 되살리기 — 되살릴 상태는 서버가 증거로 정한다(계정 → 활성 · 초대 흔적 → 초대됨 · 그 외 → 직접 관리)
  const setArchived = useCallback(async (next: 'archived' | 'active') => {
    if (!cid || busy) return;
    setBusy(true); setNotice?.(null);
    try {
      const r = await apiFetch(`/api/clients/${businessId}/${cid}/archive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        setNotice?.(t(`action.archiveError.${j?.message || 'failed'}`, { defaultValue: t('action.archiveError.failed') as string }) as string);
        return;
      }
      await reload();
    } catch { setError(true); } finally { setBusy(false); }
  }, [businessId, cid, busy, setBusy, setError, setNotice, reload, t]);
  const toggleArchive = useCallback(() => { void setArchived(archived ? 'active' : 'archived'); }, [setArchived, archived]);

  // 안정된 참조 — 부르는 쪽 useMemo(⋯ 메뉴 항목) 가 매 렌더 다시 만들어지지 않게
  const askInvite = useCallback(() => setInviteAsk(true), []);
  const askManaged = useCallback(() => setManagedAsk(true), []);
  return { canInvite, canRegisterManaged, askInvite, askManaged, dialogs, canArchive, archived, toggleArchive };
}
