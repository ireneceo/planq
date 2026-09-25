// utils/rowTimestamps.js — 응답 행의 **시각 이름을 한 곳에서** 맞춘다 (2026-09-25 박제)
//
// 이 저장소에는 같은 값에 두 이름이 있다. 원인은 `models/index.js:165` 의 전역
// `Model.prototype.toJSON` override 다 — **최상위 결과만** `createdAt → created_at` 으로 바꾸고,
// 부모의 toJSON 안에 **중첩된 include 행은 camelCase 그대로** 남는다. 그래서:
//
//   · `GET /api/tasks/:id/detail`   → `comments[].createdAt`   (중첩 → camelCase)
//   · `POST /api/tasks/:id/comments`→ `created_at`             (최상위 → snake_case)
//   · `GET /api/tasks/:id/workflow` → `history[].created_at`   (`h.toJSON()` 최상위 → snake_case)
//
// 화면은 어느 이름이 올지 알 수 없다. 실제로 두 번 샜다:
//   ① 업무 댓글 (2026-09-25 신고) — Irene: *"댓글을 달았는데 아래로 안 붙고 위로 붙어서
//      올라간 줄 몰랐어."* 저장 응답을 목록에 덧붙이니 그 한 줄만 시각이 `''` 이 되고,
//      빈 문자열은 모든 날짜보다 작아 **정렬 맨 위로** 갔다. 표시 시각도 빈칸이 됐다.
//   ② 업무 히스토리 — 화면이 `h.createdAt` 을 읽는데 라우트는 `created_at` 을 보낸다.
//      **2026-04-25 부터 5개월간 시각이 빈칸**이었다(실측: 업무 #692 히스토리 2건 모두 `""`).
//      아무도 신고하지 않았다 — 빈칸은 «고장» 으로 보이지 않기 때문이다.
//
// 규칙: **행을 최상위로 내보낼 때는 이 함수를 거친다.** 두 이름을 함께 싣는다
// (`created_at` 은 API 규약, `createdAt` 은 중첩 응답과의 정합).
// memory feedback_save_response_narrower_than_get · feedback_same_value_multiple_formulas
//
// ★ 전역 override 를 중첩까지 재귀시키는 방식은 쓰지 않는다 — 조회 응답의 중첩 행 이름이
//   한꺼번에 바뀌어 `createdAt` 을 읽는 화면들이 동시에 시각을 잃는다. 넓히는 쪽이 위험하다.

/** 모델 인스턴스 또는 toJSON 결과를 받아 시각을 **두 이름으로** 싣는다. 입력을 변형하지 않는다. */
function withBothTimestamps(row) {
  if (!row) return row;
  const o = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
  // 어느 이름으로 들어왔든 둘 다 채운다 (둘 다 없으면 만들지 않는다 — 없는 시각을 위조하지 않는다)
  const created = o.created_at !== undefined ? o.created_at : o.createdAt;
  const updated = o.updated_at !== undefined ? o.updated_at : o.updatedAt;
  if (created !== undefined) { o.created_at = created; o.createdAt = created; }
  if (updated !== undefined) { o.updated_at = updated; o.updatedAt = updated; }
  return o;
}

/** 업무 댓글 — 조회(`GET /detail`)와 같은 모양으로. 저장·편집·소켓 세 지점이 같이 쓴다. */
const serializeTaskComment = withBothTimestamps;

module.exports = { withBothTimestamps, serializeTaskComment };
