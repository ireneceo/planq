// services/postAttachmentView.js — 문서 첨부를 **보는 사람 기준**으로 다시 거른다 (2026-11-25 · docs/FILE_USAGE_DESIGN.md §11·12)
//
// 공유·참조 규칙 5: «붙일 때 원본 읽기 권한, 보여줄 때 보는 사람 기준». postSerialize 는 첨부를 거르지 않아서
//   ⓐ 휴지통에 넣은 파일이 이름 그대로 남고 누르면 404 ⓑ 나중에 «나만 보기» 로 바꾼 파일(또는 처음부터 개인 파일)이
//   팀원에게 이름은 보이고 누르면 403 이었다(2026-11-25 실호출 재현).
//
// 행마다:
//   살아 있고 읽을 수 있음        → 그대로
//   휴지통(복구 가능)·등급상 읽을 수 있는 멤버 → {state:'trashed', file:{id,file_name}, can_restore} — 내려받기 주소 없음
//   영구삭제                    → 뺀다
//   읽을 수 없음                 → 뺀다. 멤버 이상에게만 hidden_attachment_count
//   고객·게스트                  → 휴지통·숨김 모두 자리 없이 뺀다(숫자도 없음)
// 첨부 저장은 붙이기/떼기 라우트 따로라(통째 교체 없음) 숨긴 행이 저장으로 지워지지 않는다(설계 13 — 확인함).

async function applyViewerAttachments(out, post, viewer) {
  if (!out || !Array.isArray(out.attachments)) return out;
  const as = require('../middleware/access_scope');
  const scope = await as.getUserScope(viewer.id, post.business_id, viewer.platform_role);
  const isClient = !!scope.isClient || !as.isMemberOrAbove(scope);
  const raw = new Map((post.attachments || []).map((a) => [a.id, a.file]));
  let canMutate = null;
  const kept = []; let hidden = 0;
  for (const a of out.attachments) {
    const f = raw.get(a.id);
    if (!f || f.purged_at) continue;
    const readable = await as.canDownloadFile(scope, viewer.id, f);
    if (!f.deleted_at) {
      if (readable) kept.push(a); else if (!isClient) hidden += 1;
      continue;
    }
    // 휴지통 — 고객에게는 자리 없음, 멤버라도 등급상 못 보던 파일이면 숨김 숫자로만
    if (isClient) continue;
    if (!readable) { hidden += 1; continue; }
    if (!canMutate) canMutate = await mutateChecker(scope, viewer);
    const { isRestorable } = require('../routes/files');
    kept.push({
      id: a.id, file_id: a.file_id, sort_order: a.sort_order, state: 'trashed',
      file: { id: f.id, file_name: f.file_name, mime_type: f.mime_type },
      can_restore: (await canMutate(f)) && isRestorable(f),
    });
  }
  out.attachments = kept;
  if (!isClient) out.hidden_attachment_count = hidden;
  return out;
}

/** routes/files.js canMutateFile 과 같은 술어(대표·올린 사람·그 프로젝트 PM·플랫폼 관리자) — req 없이 부르는 판. */
async function mutateChecker(scope, viewer) {
  const { ProjectMember } = require('../models');
  return async (f) => {
    if (viewer.platform_role === 'platform_admin' || scope.isPlatformAdmin || scope.isOwner) return true;
    if (Number(f.uploader_id) === Number(viewer.id)) return true;
    if (f.project_id) {
      const pm = await ProjectMember.findOne({ where: { project_id: f.project_id, user_id: viewer.id, is_pm: true }, attributes: ['id'] });
      if (pm) return true;
    }
    return false;
  };
}

module.exports = { applyViewerAttachments };
