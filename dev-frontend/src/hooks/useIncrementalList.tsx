// 긴 목록을 **나눠서 그린다** — 처음 N 개만 그리고, 끝에 닿으면 N 개씩 더 (2026-10-07).
//
//   왜: Q file 이 파일을 전부 한 번에 그렸다. 검사 계정 1,909개 · 운영 최대 워크스페이스 1,050개 —
//   폰에서 Q file 에 다시 들어갈 때마다 화면이 약 2초 멈췄다(전체 검사 mobileboot «재진입 즉시 표시» 실측:
//   다시 들어가고 3.3초 뒤에야 첫 그림). 데이터는 그대로 다 가지고 있고(검색·전체 선택·건수는 전부 기준),
//   **그리는 것만** 나눈다.
//
//   사용: const { items, more, sentinelRef } = useIncrementalList(visible, `${query}|${sort}|${folder}`);
//         items.map(...) 뒤에 {more && <IncrementalSentinel ref={sentinelRef} />}
//   resetKey(필터·검색·폴더)가 바뀌면 처음 N 개부터 다시. 배경 갱신은 깊이를 유지한다.
import { useEffect, useState } from 'react';
import styled from 'styled-components';

export function useIncrementalList<T>(all: T[], resetKey: string, step = 120) {
  const [limit, setLimit] = useState(step);
  // 처음부터 다시 = **사람이 조건을 바꿨을 때만**(검색·정렬·폴더·보기). 데이터 배열이 새로 와서가 아니다 —
  //   소켓 새 파일·탭 복귀 갱신마다 120개로 되돌리면 내려 보던 자리를 잃는다(Fable 게이트 2026-10-08 차단 지적).
  useEffect(() => { setLimit(step); }, [resetKey, step]);
  // 콜백 ref — 끝 표시가 새로 그려질 때마다 관찰 대상을 갈아 끼운다
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const more = all.length > limit;
  useEffect(() => {
    if (!more || !node) return;
    const io = new IntersectionObserver((ents) => {
      if (ents.some((e) => e.isIntersecting)) setLimit((n) => n + step);
    }, { rootMargin: '600px 0px' });
    io.observe(node);
    return () => io.disconnect();
  }, [more, node, limit, step]);
  const items = more ? all.slice(0, limit) : all;
  return { items, more, sentinelRef: setNode };
}

// 끝 표시 — 화면(+600px)에 닿으면 더 그린다. 1px 빈 칸이라 레이아웃을 바꾸지 않는다. 격자에서는 한 줄을 다 쓴다.
export const IncrementalSentinel = styled.div.attrs({ 'aria-hidden': true, 'data-testid': 'incremental-more' })`
  height: 1px;
  grid-column: 1 / -1;
`;
