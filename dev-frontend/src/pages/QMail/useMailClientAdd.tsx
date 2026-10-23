// Q mail «고객 추가» — 주소 메뉴·우측 패널 [+ 고객 추가] 가 같은 드로어를 **메일 화면 안에서** 연다(2026-10-23).
//   기본 «추가»(메일 없음) · 서명으로 빈 칸을 채우고(fromMail) · 저장하면 서버가 이 메일(과 같은 주소의 메일)을 그 고객에 붙인다(source).
//   설계 docs/CLIENT_ADD_INVITE_DESIGN.md §2. MailPage 가 커서 따로 둔다.
import { useCallback, useState } from 'react';
import ClientAddDrawer from '../../components/Clients/ClientAddDrawer';
import { tabStore } from '../../stores/tabStore';

interface Target { email: string; name: string | null; threadId: number | null }

export function useMailClientAdd(businessId: number | null | undefined, onLinked: (threadId: number) => void) {
  const [target, setTarget] = useState<Target | null>(null);
  const open = useCallback((email: string, name: string | null, threadId: number | null) => setTarget({ email, name, threadId }), []);
  const node = businessId ? (
    <ClientAddDrawer open={!!target} onClose={() => setTarget(null)} businessId={businessId}
      prefill={target ? { email: target.email || undefined, name: target.name || undefined } : null}
      fromMail={target?.threadId ? { threadId: target.threadId } : null}
      source={target?.threadId ? { kind: 'email_thread', id: target.threadId } : null}
      onDone={() => { if (target?.threadId) onLinked(target.threadId); }}
      onOpenExisting={(cid) => tabStore.openInNewTab(`/sale/${cid}`)} />
  ) : null;
  return { open, node };
}

export const openClientTab = (clientId: number) => tabStore.openInNewTab(`/sale/${clientId}`);
