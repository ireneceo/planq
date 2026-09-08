// utils/crashTrail.ts — 크래시 직전에 **무엇을 눌렀는지** 남긴다 (2026-09-08).
//
// Irene: *"플랫폼 관리자 여전히 에러야."* — 오늘 크래시 보고가 처음 도착해
//   "어디서(경로·컴포넌트)" 는 알게 됐다. 그런데 **"무엇을 눌렀을 때"** 를 몰라
//   재현을 세 번 실패했다(왕복 이동 · 임시 platform_admin 으로 관리자 진입 · 16화면 크롤).
//   React #185(무한 setState)는 특정 조작에서만 나는 일이 많다 — 그 조작을 같이 보낸다.
//
// 설계
//   · **React state 를 쓰지 않는다.** 크래시 순간에도 살아 있어야 하므로 모듈 링버퍼다.
//   · 클릭만 잡는다(capture 단계). 키 입력은 안 잡는다 — 비밀번호가 섞인다.
//   · **입력 요소의 값은 절대 담지 않는다** (input·textarea·contenteditable 은 라벨도 안 읽는다).
//   · 라벨은 `data-testid` > `aria-label` > `title` 순, 없으면 태그명 + 짧은 글자(24자).
//     긴 본문을 담지 않는다 — 진단에 필요한 것은 "무엇을 눌렀나" 이지 내용이 아니다.
//   · 경로를 항목마다 같이 적는다 — 이동이 섞인 순서가 그대로 보인다.

const MAX = 8;
const trail: string[] = [];

function labelOf(el: Element): string {
  const testid = el.getAttribute('data-testid');
  if (testid) return `#${testid}`;
  const aria = el.getAttribute('aria-label') || el.getAttribute('title');
  if (aria) return aria.slice(0, 24);
  const tag = el.tagName.toLowerCase();
  // ★ 값이 들어 있는 요소는 글자를 읽지 않는다 — 비밀번호·메모가 섞일 수 있다.
  if (tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable) return tag;
  const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
  return txt ? `${tag}:${txt.slice(0, 24)}` : tag;
}

/** 누른 것을 한 줄로 남긴다. 앱 시작 시 한 번만 부른다. */
export function installCrashTrail(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __pqTrail?: boolean };
  if (w.__pqTrail) return;           // 중복 설치 방지(StrictMode 이중 실행 포함)
  w.__pqTrail = true;
  document.addEventListener('click', (e) => {
    try {
      const t = e.target as Element | null;
      if (!t || !t.closest) return;
      // 실제로 누른 것 = 가장 가까운 조작 요소. 없으면 타깃 자체.
      const el = (t.closest('button,a,[role="button"],[data-testid],input,label,li') || t) as Element;
      const at = new Date().toISOString().slice(11, 19);
      trail.push(`${at} ${location.pathname} ${labelOf(el)}`);
      while (trail.length > MAX) trail.shift();
    } catch { /* 흔적 남기기가 화면을 방해하면 안 된다 */ }
  }, true);
}

/** 최근 조작을 한 문자열로. 크래시 보고가 쓴다. */
export function getCrashTrail(cap = 600): string {
  return trail.join(' → ').slice(-cap);
}
