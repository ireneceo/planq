// 한글 조합(IME) 중의 Enter 를 행동으로 오인하지 않기 위한 공용 판정.
//
// ★ 2026-09-01 (Irene: "모바일에서 입력이 엉망이야")
//   한글·일본어·중국어는 Enter 가 **조합을 확정하는 키**로도 쓰인다. "회의" 를 치고 마지막
//   글자를 확정하려 Enter 를 누르면, 조합 확정과 동시에 keydown 이 그대로 흘러 내려가
//   전송·저장·blur 같은 행동이 **사용자가 원하지 않은 시점에** 실행된다.
//   실제로 앱 전체 Enter 핸들러 104곳 중 이 판정을 하던 곳은 5곳뿐이었다 —
//   나머지는 한글 사용자에게 "받는사람이 반쯤 입력된 채로 확정됨", "태그가 두 번 만들어짐",
//   "이름 고치는 중에 저장돼 버림" 으로 나타난다.
//
//   `isComposing` 하나만 보면 안 된다 — 브라우저·OS 조합에 따라 false 로 들어오는 경우가
//   있어 legacy `keyCode === 229` 를 같이 본다 (ChatPanel 이 먼저 그렇게 하고 있었다).
//
//   사용법:
//     import { isEnterAction } from 'utils/imeKey';
//     onKeyDown={(e) => { if (isEnterAction(e)) submit(); }}

type AnyKeyEvent = {
  key: string;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
  isComposing?: boolean;
  keyCode?: number;
};

/** IME 조합이 열려 있는가 (React SyntheticEvent · 네이티브 KeyboardEvent 양쪽 지원) */
export function isComposingEvent(e: AnyKeyEvent): boolean {
  const n = e.nativeEvent;
  return !!(n?.isComposing ?? e.isComposing) || (n?.keyCode ?? e.keyCode) === 229;
}

/** "사용자가 행동으로서 누른 Enter" 인가 — 조합 확정용 Enter 는 false */
export function isEnterAction(e: AnyKeyEvent): boolean {
  return e.key === 'Enter' && !isComposingEvent(e);
}
