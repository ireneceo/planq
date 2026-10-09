// services/calendarPermission.js — 일정 편집 권한 판정 **단일 원천**.
//
// 왜 이 모듈이 있는가
//   여태 이 판정은 `routes/calendar.js` PUT 안에만 있었다. 역방향 동기화(구글→PlanQ)가
//   같은 판정을 필요로 하는데, 거기에 한 벌 더 쓰면 **두 벌이 반드시 어긋난다** —
//   이 저장소에서 이미 여러 번 겪은 패턴이다(권한 규칙이 갈라지면 한쪽만 고쳐진다).
//   라우트와 동기화가 **같은 함수**를 부르게 고정한다.
//
// 판정 규칙 (PERMISSION_MATRIX 정합)
//   · client        → 불가 (일정 편집 권한 없음)
//   · role='ai'     → 불가 (Cue 는 위임자 권한으로만 움직이고, 직접 편집자는 아니다)
//   · 작성자        → 가능
//   · owner / admin → 가능
//   · 그 외 member  → 불가

/** 이 멤버십이 일정을 편집할 수 있는가. bm 은 BusinessMember 인스턴스 또는 { role } 형태. */
function canEditEvent(event, bm, userId) {
  if (!event || !bm) return false;
  const role = bm.role;
  if (role === 'client' || role === 'ai') return false;
  // ★ owner/admin 도 남의 «나만 보기»(L1·옛 personal) 일정은 고치거나 지우지 못한다 — 볼 수도 없다
  //   (2026-10-09 보안 점검 2차 D2, 목록·상세와 같은 선).
  const privateOfOther = (event.vlevel === 'L1' || (!event.vlevel && event.visibility === 'personal'))
    && Number(event.created_by) !== Number(userId);
  if (role === 'owner' || role === 'admin') return !privateOfOther;
  return Number(event.created_by) === Number(userId);
}

/** 거절 사유 코드 — 라우트가 그대로 응답 메시지로 쓴다(문구 두 벌 금지). */
function editDenyReason(event, bm, userId) {
  if (!bm || bm.role === 'client' || bm.role === 'ai') return 'forbidden';
  if (!canEditEvent(event, bm, userId)) return 'only_creator_or_owner';
  return null;
}

module.exports = { canEditEvent, editDenyReason };
