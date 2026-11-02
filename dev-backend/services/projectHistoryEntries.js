// services/projectHistoryEntries.js — 수동 히스토리(주요 이슈) 한 항목 고치기 (2026-11-02)
//   Irene: *"자동기록 히스토리를 수동으로 수정하고 싶어 … 각 항목별 글자 수정"* — 사람이 적은 항목은 덮어쓰기가 아니라
//   **그 행 자체**를 고친다(docs/HISTORY_OVERRIDE_DESIGN.md §5, Fable 설계 판정).
//   routes/projects.js 는 god-file 래칫이라 본체를 여기 둔다 — 라우트는 부르기만 한다.
//
//   권한: «고객 링크에 보이기»(client_visible) 만 바꾸는 것은 종전대로 멤버 전원.
//         제목·본문·날짜를 바꾸는 것은 지우기와 같은 선 — 적은 사람 또는 owner/admin/platform_admin.
//   client_visible 인 항목이면 바뀐 제목·본문이 고객 프로젝트 링크에도 보인다(같은 행을 읽는다 — services/guestHistory).
const { createAuditLog } = require('../middleware/audit');

/** → { ok:true, data, changed } | { ok:false, http, code } */
async function updateEntry({ project, role, user, entryId, body }) {
  const b = body || {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(b, 'client_visible')) {
    if (typeof b.client_visible !== 'boolean') return { ok: false, http: 400, code: 'client_visible_required' };
    patch.client_visible = b.client_visible;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'title')) {
    const title = String(b.title || '').trim();
    if (!title) return { ok: false, http: 400, code: 'title_required' };
    if (title.length > 200) return { ok: false, http: 400, code: 'title_too_long' };
    patch.title = title;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'body')) {
    const text = b.body == null ? '' : String(b.body).trim();
    if (text.length > 5000) return { ok: false, http: 400, code: 'body_too_long' };
    patch.body = text || null;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'occurred_at')) {
    const at = new Date(b.occurred_at);
    if (!b.occurred_at || Number.isNaN(at.getTime())) return { ok: false, http: 400, code: 'invalid_occurred_at' };
    // POST 와 같은 검사 — 히스토리는 있었던 일이다
    if (at.getTime() > Date.now() + 60 * 1000) return { ok: false, http: 400, code: 'occurred_in_future' };
    patch.occurred_at = at;
  }
  const keys = Object.keys(patch);
  if (!keys.length) return { ok: false, http: 400, code: 'nothing_to_update' };

  const { ProjectHistoryEntry } = require('../models');
  const row = await ProjectHistoryEntry.findOne({
    where: { id: Number(entryId), business_id: project.business_id, project_id: project.id, deleted_at: null },
  });
  if (!row) return { ok: false, http: 404, code: 'not_found' };

  const textual = keys.some((k) => k !== 'client_visible');
  if (textual) {
    const isAuthor = Number(row.created_by) === Number(user.id);
    const isManager = role === 'owner' || role === 'admin' || user.platform_role === 'platform_admin';
    if (!isAuthor && !isManager) return { ok: false, http: 403, code: 'forbidden' };
  }

  const oldValue = { id: row.id };
  const newValue = { id: row.id };
  const changes = {};
  for (const k of keys) {
    const cur = row[k];
    const want = patch[k];
    const same = (cur instanceof Date && want instanceof Date) ? cur.getTime() === want.getTime() : (k === 'client_visible' ? !!cur === want : cur === want);
    if (same) continue;
    changes[k] = want;
    oldValue[k] = cur;
    newValue[k] = want;
  }
  const changed = Object.keys(changes).length > 0;
  if (changed) {
    await row.update(changes);
    // 종전 «고객 공개» 만 바꾸던 감사 action 은 이름을 그대로 둔다(그 action 으로 거르는 화면이 있다).
    const onlyVisible = Object.keys(changes).length === 1 && 'client_visible' in changes;
    createAuditLog({
      userId: user.id, businessId: project.business_id,
      action: onlyVisible ? 'project.history_entry.client_visible' : 'project.history_entry.update',
      targetType: 'project', targetId: project.id, oldValue, newValue,
    });
  }
  return {
    ok: true, changed,
    data: { id: row.id, title: row.title, body: row.body, occurred_at: row.occurred_at, client_visible: !!row.client_visible },
  };
}

module.exports = { updateEntry };
