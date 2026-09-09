// 휴가 종류 — **한 곳**에서만 정의한다.
//   서버(services/leaveTransition.js LEAVE_CATEGORIES)와 같은 순서·같은 값이어야 한다.
//   두 벌로 적으면 화면에만 있는 종류가 생기고, 그걸 고르면 서버가 400 을 낸다.
//   ★ 유급/무급(leave_type)과 **다른 축**이다 — 이건 "무슨 휴가냐", 그건 "잔여를 깎느냐".
export const LEAVE_CATEGORY_KEYS = ['annual', 'sick', 'family', 'other'] as const;
export type LeaveCategory = (typeof LEAVE_CATEGORY_KEYS)[number];
