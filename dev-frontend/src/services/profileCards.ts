// 채팅 «고객 정보·멤버 정보» 카드 — 서버 routes/profile_cards.js. 설계 docs/CHAT_PROFILE_CARDS_DESIGN.md
//   메시지에는 card_type·id 만 실린다. 카드 본문은 볼 때마다 보는 사람 권한으로 서버에서 다시 읽는다.
import { apiFetch } from '../contexts/AuthContext';

export type ProfileCardKind = 'client' | 'member';
export type ProfileCardState = 'ok' | 'no_permission' | 'not_available';

export interface ClientProfileView {
  id: number; name: string | null; company: string | null; job_title: string | null; department: string | null;
  phone: string | null; email: string | null; assigned_member: { user_id: number; name: string } | null;
}
export interface MemberProfileView {
  user_id: number; name: string | null; job_title: string | null;
  department: { name: string; name_en: string | null } | null; team: { name: string; name_en: string | null } | null;
  organization: string | null; email: string | null; phone: string | null; avatar_url: string | null;
}
export interface ProfileCardResolved { state: ProfileCardState; view: ClientProfileView | MemberProfileView | null }
export interface ProfileCardRoom { allowed: boolean; reason: string | null; can_send_client: boolean }

async function unwrap<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) throw Object.assign(new Error(j?.message || `HTTP ${r.status}`), { code: j?.message, status: r.status });
  return j.data as T;
}

export async function getProfileCardRoom(businessId: number, conversationId: number): Promise<ProfileCardRoom> {
  return unwrap(await apiFetch(`/api/businesses/${businessId}/conversations/${conversationId}/profile-card-room`));
}

export async function sendProfileCard(businessId: number, conversationId: number, type: ProfileCardKind, targetId: number): Promise<{ message_id: number }> {
  return unwrap(await apiFetch(`/api/businesses/${businessId}/profile-card-messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: conversationId, type, target_id: targetId }),
  }));
}

// 같은 화면에 같은 카드가 여러 장이면 한 번만 묻는다(짧게 — 프로필이 바뀌면 30초 안에 따라온다).
const cache = new Map<string, { at: number; p: Promise<ProfileCardResolved> }>();
const TTL = 30_000;
export function getProfileCard(businessId: number, type: ProfileCardKind, id: number): Promise<ProfileCardResolved> {
  const key = `${businessId}:${type}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = apiFetch(`/api/businesses/${businessId}/profile-cards/${type}/${id}`)
    .then((r) => unwrap<{ state: ProfileCardState; view: ProfileCardResolved['view'] }>(r))
    .then((d) => ({ state: d.state, view: d.view }))
    .catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { at: Date.now(), p });
  return p;
}
