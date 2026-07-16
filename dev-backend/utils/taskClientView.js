'use strict';

// ============================================================
// §8.5 — Client-facing task serializer
// ------------------------------------------------------------
// 고객(Client)에게 task 를 응답할 때 내부 운영 데이터를 제거한다.
// PERMISSION_MATRIX §7 (멀티테넌트 격리) — 고객은 자기 관련 업무를
// 조회할 수 있지만, 사업자 내부 운영 지표(공수 예측/실제 투입 시간,
// AI 예측 출처, 일별 진행 스냅샷, 내부 Cue 메타)는 보면 안 된다.
//
// 노출 유지: title/description/body/status/priority/due_date/
//            start_date/progress_percent(진행률은 고객 신뢰·투명성 위해 유지),
//            assignee/creator/requester 표시명, shared 댓글
//
// 차단: estimated_hours, actual_hours, actual_source,
//       latest_estimation_source, daily_progress[] (시간 포함),
//       cue_meta / cue_* 내부 AI 메타
//
// Irene 결정 (2026-06-08): 진행률(progress_percent)은 보여줌, 시간 공수는 무조건 차단.
// ============================================================

// 고객에게서 제거할 최상위 필드.
const BLOCKED_FIELDS = [
  'estimated_hours',
  'actual_hours',
  'actual_source',
  'latest_estimation_source',
  'daily_progress',
  'cue_meta',
  'cue_kind',
  'cue_context_ref',
  'cue_status',
  'created_via',   // Cue 등 내부 생성 경로 provenance — 고객에겐 숨김(멤버 표시 전용)
];

// 단일 task plain object 를 고객용으로 정제 (in-place 아님 — 얕은 복사 후 반환).
function serializeTaskForClient(json) {
  if (!json || typeof json !== 'object') return json;
  const out = { ...json };

  for (const f of BLOCKED_FIELDS) {
    if (f in out) delete out[f];
  }

  // 댓글: shared(고객 공유) 만 노출. internal/personal 차단.
  if (Array.isArray(out.comments)) {
    out.comments = out.comments.filter((c) => c && c.visibility === 'shared');
  }

  return out;
}

// 배열 정제 헬퍼.
function serializeTasksForClient(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.map(serializeTaskForClient);
}

module.exports = { serializeTaskForClient, serializeTasksForClient, BLOCKED_FIELDS };
