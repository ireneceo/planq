// 공용 로딩 자리표시 — "화면이 비어 있는 순간" 을 없애기 위한 최소 프리미티브.
//
// 왜 공용으로 뽑는가
//   같은 것을 8곳이 각자 만들어 두고 있었다(Insights·DocsTab·ProjectCanvas·StorageSettings·
//   PlanSettings·AdminSubscriptions…). 베낀 컴포넌트는 반드시 갈라진다 — 실제로 모서리 반경도
//   맥동 속도도 제각각이다. 새로 만드는 곳은 여기를 쓰고, 기존 것은 손댈 때 옮긴다.
//
// 왜 필요한가 (2026-08-29 실측)
//   API 를 1.2초 지연시켜 앱 안에서 이동해 보니 /projects·/files·/docs 는 스켈레톤이 뜨는데
//   **/tasks·/mail 은 본문이 완전히 비어** 사이드바만 남았다. 사용자에겐 "안 눌린 것" 처럼 보인다.
//
// 접근성: 움직임 줄이기 설정이면 맥동을 끈다. 스크린리더에는 진행 중임을 알린다.
import styled, { keyframes, css } from 'styled-components';

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
`;

const base = css`
  background: #EEF2F6;
  border-radius: 8px;
  animation: ${pulse} 1.5s ease-in-out infinite;
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;

/** 한 줄짜리 자리표시. 폭은 내용 길이를 흉내 내라 — 전부 100% 면 표처럼 보여 더 어색하다. */
export const SkeletonLine = styled.div<{ $w?: string; $h?: number }>`
  ${base};
  width: ${(p) => p.$w || '100%'};
  height: ${(p) => p.$h || 12}px;
`;

/** 카드·썸네일 등 덩어리. */
export const SkeletonBlock = styled.div<{ $h?: number; $r?: number }>`
  ${base};
  width: 100%;
  height: ${(p) => p.$h || 96}px;
  border-radius: ${(p) => p.$r ?? 12}px;
`;

const ListWrap = styled.div`
  display: flex; flex-direction: column; gap: 10px; padding: 16px 20px;
`;
const RowWrap = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border: 1px solid #E2E8F0; border-radius: 10px; background: #fff;
`;
const RowMain = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px;`;

/** 목록 화면용 — 행 n개. 실제 행 높이와 비슷해야 로딩이 끝날 때 덜 튄다. */
export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    // ★ data-skeleton 은 검사 하니스와의 **계약**이다. styled-components 는 클래스명을 해시로
    //   만들고 스켈레톤에는 글자가 없어서, 이 표식이 없으면 검사기가 "빈 화면" 과 구별하지 못한다
    //   (실측: 붙이기 전에는 스켈레톤을 띄워도 '이전화면유지' 로 잘못 분류됐다).
    <ListWrap data-skeleton="true" role="status" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <RowWrap key={i}>
          <SkeletonBlock $h={28} $r={6} style={{ width: 28, flex: '0 0 28px' }} />
          <RowMain>
            {/* 폭을 조금씩 다르게 — 진짜 목록처럼 보이게 */}
            <SkeletonLine $w={`${68 - (i % 3) * 12}%`} $h={13} />
            <SkeletonLine $w={`${42 - (i % 2) * 10}%`} $h={10} />
          </RowMain>
          <SkeletonLine $w="56px" $h={20} />
        </RowWrap>
      ))}
    </ListWrap>
  );
}

export default SkeletonList;
