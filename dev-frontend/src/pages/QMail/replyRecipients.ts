// 답장 받는 사람 계산 — «보낸 사람에게만» / «전체 답장» (2026-11-13, Irene «메일 답장할 때 참조까지 넣어서 모두에게
//   가게 할지 그냥 당사자에게만 답장할지 선택하게 할 수 있어야»).
//
// 기준 메일 = 마지막 받은 메일. 받은 메일이 없는 대화(우리가 먼저 보냄)면 마지막 보낸 메일 — 서버 기본값과 같은 규칙
//   (routes/email_threads.js POST …/messages). 일반 메일 프로그램과 같은 배치:
//   · 보낸 사람에게만: 받는 사람 = 보낸 사람
//   · 전체 답장: 받는 사람 = 보낸 사람 + 원래 받는 사람들 · 참조 = 원래 참조
//   · 우리 주소(메일함 본주소·별칭)는 빼고, 같은 주소는 한 번만.
import { toAddrList, type Message } from './mailTypes';

export type ReplyMode = 'sender' | 'all';

export interface ReplyRecipients { to: string[]; cc: string[] }

const norm = (e: string) => String(e || '').trim().toLowerCase();

export function replyBaseMessage(messages: Message[] | undefined | null): Message | null {
  const list = messages || [];
  const rev = [...list].reverse();
  return rev.find((m) => m.direction === 'inbound') || rev.find((m) => m.direction === 'outbound') || null;
}

export function computeReplyRecipients(
  messages: Message[] | undefined | null,
  selfEmails: string[],
  mode: ReplyMode,
): ReplyRecipients {
  const base = replyBaseMessage(messages);
  if (!base) return { to: [], cc: [] };
  const self = new Set(selfEmails.map(norm).filter(Boolean));
  const seen = new Set<string>();
  const take = (list: string[]) => {
    const out: string[] = [];
    for (const raw of list) {
      const e = String(raw || '').trim();
      const k = norm(e);
      if (!k || !k.includes('@') || self.has(k) || seen.has(k)) continue;
      seen.add(k); out.push(e);
    }
    return out;
  };
  if (base.direction === 'inbound') {
    const sender = base.from_email ? [base.from_email] : [];
    if (mode === 'sender') return { to: take(sender), cc: [] };
    const to = take([...sender, ...toAddrList(base.to_emails)]);
    const cc = take(toAddrList(base.cc_emails));
    return { to, cc };
  }
  // 우리가 마지막으로 보낸 메일 — 같은 사람들에게 다시
  const to = take(toAddrList(base.to_emails));
  const cc = mode === 'all' ? take(toAddrList(base.cc_emails)) : [];
  return { to, cc };
}

/** 전체 답장이 «보낸 사람에게만» 과 다른가 — 같으면 고르게 할 이유가 없다(버튼을 숨긴다) */
export function hasReplyAllExtra(messages: Message[] | undefined | null, selfEmails: string[]): boolean {
  const a = computeReplyRecipients(messages, selfEmails, 'all');
  const s = computeReplyRecipients(messages, selfEmails, 'sender');
  return a.to.length + a.cc.length > s.to.length + s.cc.length;
}
