// 워크스페이스 저장 사용량의 **참값**을 데이터에서 다시 센다.
//
// Irene 2026-09-20: *"스토리지 집계 29MB 차이 나는 거 고쳐."*
//
// 왜 어긋나나 — 사용량을 올리고 내리는 곳이 **여럿**이다(파일 업로드 · 업무 첨부 · 채팅 첨부 ·
// 메일 첨부 수집 · 휴지통 복원 · 각종 삭제 경로). 한 곳이라도 감산을 빠뜨리거나 두 번 더하면
// 그때부터 값이 벌어지고, **아무도 알려주지 않는다.** 실제로 코드 주석에 같은 사고가 한 번
// 기록돼 있다(#372 — 메일 첨부가 카운터를 아예 안 올렸다).
//
// ★ 집계가 실제보다 **작으면** 쿼터가 한도에서 안 막는다(공짜로 계속 받는다).
//   **크면** 아직 여유가 있는데 업로드가 거부된다. 둘 다 사용자에게는 설명할 수 없는 고장이다.
//
// 참값의 정의 — **고유 물리 파일 경로의 합**.
//   · 우리 디스크를 쓰는 것만 센다(`storage_provider='planq'`). Drive/S3 는 남의 디스크다.
//   · 같은 `file_path` 를 여러 행이 가리킬 수 있다(SHA-256 중복제거·메일 첨부 저장). 그건 **한 파일**이다.
//     그래서 `content_hash` 가 아니라 **경로**로 접는다 — 첨부 표에는 해시 컬럼이 아예 없다.
//   · 세 표를 모두 본다: files · task_attachments · message_attachments(대화→워크스페이스로 이어 붙인다).
const { sequelize } = require('../config/database');

const TRUTH_SQL = `
  SELECT biz AS business_id, COUNT(*) AS file_count, COALESCE(SUM(sz), 0) AS bytes_used
    FROM (
      SELECT biz, path, MAX(sz) AS sz
        FROM (
          SELECT business_id AS biz, file_path AS path, file_size AS sz
            FROM files
           WHERE deleted_at IS NULL AND storage_provider = 'planq' AND file_path IS NOT NULL
          UNION ALL
          SELECT business_id AS biz, file_path AS path, file_size AS sz
            FROM task_attachments
           WHERE storage_provider = 'planq' AND file_path IS NOT NULL
          UNION ALL
          SELECT c.business_id AS biz, ma.file_path AS path, ma.file_size AS sz
            FROM message_attachments ma
            JOIN messages m ON m.id = ma.message_id
            JOIN conversations c ON c.id = m.conversation_id
           WHERE ma.storage_provider = 'planq' AND ma.file_path IS NOT NULL
        ) u
       GROUP BY biz, path
    ) d
   GROUP BY biz`;

/** 워크스페이스별 참값. `{ [business_id]: { bytes_used, file_count } }` */
async function computeTruth() {
  const [rows] = await sequelize.query(TRUTH_SQL);
  const out = {};
  for (const r of rows) out[Number(r.business_id)] = { bytes_used: Number(r.bytes_used), file_count: Number(r.file_count) };
  return out;
}

/** 집계와 참값의 차이. `{ business_id, counted, truth, diff }[]` — diff 는 집계 − 참값. */
async function drift() {
  const truth = await computeTruth();
  const [rows] = await sequelize.query('SELECT business_id, bytes_used, file_count FROM business_storage_usage');
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const b = Number(r.business_id);
    seen.add(b);
    const t = truth[b] || { bytes_used: 0, file_count: 0 };
    out.push({ business_id: b, counted: Number(r.bytes_used), truth: t.bytes_used, diff: Number(r.bytes_used) - t.bytes_used, countedFiles: Number(r.file_count), truthFiles: t.file_count });
  }
  // 집계 행이 아예 없는 워크스페이스도 드러내야 한다 — 없으면 쿼터가 0 에서 시작한다.
  for (const [b, t] of Object.entries(truth)) {
    if (!seen.has(Number(b))) out.push({ business_id: Number(b), counted: null, truth: t.bytes_used, diff: null, countedFiles: null, truthFiles: t.file_count });
  }
  return out.sort((a, b) => Math.abs(b.diff || Infinity) - Math.abs(a.diff || Infinity));
}

/** 참값으로 맞춘다. 되돌릴 필요가 없도록 **이전 값을 돌려준다**. */
async function reconcile() {
  const rows = await drift();
  const changed = [];
  for (const r of rows) {
    if (r.counted !== null && r.diff === 0) continue;
    await sequelize.query(
      `INSERT INTO business_storage_usage (business_id, bytes_used, file_count, storage_provider, created_at, updated_at)
       VALUES (:b, :bytes, :n, 'planq', NOW(), NOW())
       ON DUPLICATE KEY UPDATE bytes_used = :bytes, file_count = :n, updated_at = NOW()`,
      { replacements: { b: r.business_id, bytes: r.truth, n: r.truthFiles } },
    );
    changed.push(r);
  }
  return changed;
}

module.exports = { computeTruth, drift, reconcile };
