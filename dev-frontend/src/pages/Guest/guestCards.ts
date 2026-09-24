// 게스트 문서·파일 **카드 그리드** — docs/GUEST_PROJECT_VIEW_DECISIONS.md §D.
//
// ★ 값은 Q file 카드와 **같은 숫자**다(pages/QProject/DocsTab.tsx 의 Grid·Card·Thumb·CardName·CardMeta,
//   2026-09-24 기준 2743~2785줄). 설계 문서가 적은 근사값(1px·4:3)이 아니라 실제 값을 옮겼다 —
//   같은 자료가 앱과 고객 화면에서 다른 카드로 보이면 다른 것으로 읽힌다.
// ★ 후속: 두 곳이 components/Common/cardGridShell 한 벌을 쓰게 뺀다(Q file 쪽은 선택·끌기 상태가 얹혀
//   있어 이번에는 옮기지 않았다). 그 전까지 숫자를 바꿀 때는 **두 곳을 같이** 본다.
import styled from 'styled-components';

export const CardGrid = styled.div`
  display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;
  /* ★ 폰만 다르다 — 180 이면 375 폭(본문 343)에 **1열**이라 카드가 아니라 긴 줄이 된다.
     설계 §D 가 «375 폭 2열» 을 정했다. Q file 은 그대로 둔다(이 한 줄이 두 곳의 유일한 차이다). */
  @media (max-width:640px){ grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; }
`;
export const Card = styled.button<{ $dim?: boolean }>`
  position:relative;background:#fff;border:2px solid #E2E8F0;border-radius:10px;overflow:hidden;
  display:flex;flex-direction:column;text-align:left;padding:0;cursor:pointer;min-width:0;
  font:inherit;color:inherit;
  opacity:${p => (p.$dim ? 0.72 : 1)};
  transition:border-color .15s, box-shadow .15s;
  &:hover{border-color:#14B8A6;box-shadow:0 2px 8px rgba(20,184,166,.08);}
  &:focus-visible{outline:2px solid #0d9488;outline-offset:2px;}
`;
export const Thumb = styled.div`
  position:relative;aspect-ratio:16/10;background:#F8FAFC;overflow:hidden;
  display:flex;align-items:center;justify-content:center;
  color:#94A3B8;font-size:0.75rem;font-weight:700;letter-spacing:.4px;
`;
export const ThumbImg = styled.img`width:100%;height:100%;object-fit:contain;display:block;`;
export const CardName = styled.div<{ $clamp?: boolean }>`
  padding:8px 10px 2px;font-size:0.875rem;font-weight:600;color:#0F172A;
  @media(max-width:640px){font-size:0.9375rem;}
  display:flex;align-items:flex-start;gap:6px;min-width:0;
  > span:last-child {
    min-width:0;overflow:hidden;
    ${p => (p.$clamp
    ? 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;'
    : 'white-space:nowrap;text-overflow:ellipsis;')}
  }
`;
export const CardMeta = styled.div`
  padding:0 10px 10px;font-size:0.6875rem;color:#64748B;display:flex;gap:6px;
  align-items:center;flex-wrap:nowrap;min-width:0;white-space:nowrap;overflow:hidden;
  > span { overflow:hidden;text-overflow:ellipsis;min-width:0; }
`;
/** 용량·날짜 — **줄어들지 않는다**(Q file 의 MetaFixed 와 같은 계약). 줄어드는 것은 이름(작성자·올린 사람)뿐이다.
 *  2026-09-24 Fable F2 — 전부 줄게 두었더니 «로그인 후 받기» 꼬리표 옆에서 용량·날짜가 «8…» «9/24/…» 로 잘렸다. */
export const MetaFixed = styled.span`flex-shrink:0;`;
export const CardChipRow = styled.div`display:flex;gap:4px;padding:10px 10px 0;min-width:0;`;
export const CardChip = styled.span`
  flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  padding:2px 8px;border-radius:999px;background:#F1F5F9;color:#475569;font-size:0.625rem;font-weight:700;
`;
/** 받기 꼬리표 — **썸네일 위 오른쪽**에 얹는다(Q file 이 분류 칩을 썸네일 위에 얹는 것과 같은 자리 규칙).
 *  ★ 2026-09-24 Fable F6 — 메타 줄 끝에 두었더니 150px 카드 한 줄에 «용량 · 날짜 · 로그인 후 받기» 가 안 들어가
 *    꼬리표가 카드 밖으로 밀려 **잘렸다**(영어 폰 12장 전부). 이 꼬리표는 «받을 수 있는가» 의 유일한 안내라
 *    잘리면 카드가 뜻을 잃는다. 메타 줄과 자리를 다투지 않게 썸네일 위로 옮겼다. 흰 테두리로 그림 위에서도 읽힌다. */
export const CardTag = styled.span<{ $on: boolean }>`
  position:absolute;top:8px;right:8px;max-width:calc(100% - 16px);
  padding:2px 8px;border-radius:999px;font-size:0.625rem;font-weight:700;white-space:nowrap;
  box-shadow:0 0 0 1px #fff;
  background:${p => (p.$on ? '#ccfbf1' : '#f1f5f9')};color:${p => (p.$on ? '#0f766e' : '#64748b')};
`;
export const LockCaption = styled.div`padding:0 10px 10px;font-size:0.6875rem;color:#94A3B8;`;
