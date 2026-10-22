// 사람 화면의 이메일(components/People/EmailLink)이 연 작성 — `?compose=1&to=<주소>&back=<연 탭 id | 1>` (2026-10-22, Fable 판정 2)
//   MailPage 는 읽고(readComposeIntent) 닫힐 때 돌아간다(returnAfterCompose). 여기 두 함수가 그 계약 한 벌이다.
import { tabStore } from '../../stores/tabStore';

// 받는 주소 — 모양이 아니면 버린다(주소창으로 아무 글자나 받는 사람 칸에 심지 않는다)
const COMPOSE_TO_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** ?to= 가 쓸 수 있는 주소면 그 주소, 아니면 null · back 은 그대로(없으면 null) */
export function readComposeIntent(sp: URLSearchParams): { to: string | null; back: string | null } {
  const to = (sp.get('to') || '').trim();
  return { to: to && COMPOSE_TO_RE.test(to) ? to : null, back: sp.get('back') || null };
}

/** 보내거나 닫은 뒤 — 폰(미러) = 뒤로 · 탭 모드 = 이 작성 탭을 닫고 연 탭으로(옆 탭으로 떨어지지 않게) */
export function returnAfterCompose(back: string): void {
  const snap = tabStore.getSnapshot();
  if (snap.mirror) { if (window.history.length > 1) window.history.back(); return; }
  if (!snap.activeId) return;
  const me = snap.activeId;
  if (snap.tabs.some((x) => x.id === back && x.id !== me)) tabStore.setActive(back);
  tabStore.closeTab(me);
}
